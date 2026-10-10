#!/usr/bin/env node
/* fee-counterfactual.js — same decisions, different fee rates (no brain simulation)
 *
 *   node experiments/fee-counterfactual.js experiments/config/trade-stonkfly-window-fixed1pct.json experiments/config/periods/*.json
 *
 * For each config the saved fly decisions (results/<name>/fly/rep_*.json), the
 * rule investor's decisions and the random investors' decisions (regenerated
 * from the same seeds, so they are identical to trade.js) are kept as they are;
 * only rules.feeRate changes. Note that with a lower fee a buy can be slightly
 * larger when cash is close to the reserve, so the executed orders can differ in
 * rare cases; the decisions themselves never change.
 * Writes experiments/results/fee-counterfactual/table.md, table.csv, summary.json.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var market = require('./lib/market.js');
var common = require('./lib/trade-common.js');
var makeRng = require('./lib/headless-sim.js').makeRng;

var FEES = [0, 0.001, 0.006];

function mean(xs) { return xs.reduce(function (a, b) { return a + b; }, 0) / xs.length; }
function money(x) { return (x >= 0 ? '+$' : '−$') + Math.abs(x).toFixed(2); }

function analyse(file) {
	var cfg = common.loadTradeConfig(file);
	var prices = common.loadPrices(cfg);
	var points = market.decisionPoints(prices, cfg.intervalMin);
	var finalPrice = prices[prices.length - 1].close;
	var flyDir = path.join(__dirname, 'results', cfg.name, 'fly');
	var flyActs = [];
	for (var k = 0; k < cfg.fly.repeats; k++) {
		var rep = JSON.parse(fs.readFileSync(path.join(flyDir, 'rep_' + String(k).padStart(2, '0') + '.json'), 'utf8'));
		flyActs.push(rep.decisions.map(function (d) { return d.action; }));
	}
	var cnt = { buy: 0, sell: 0, hold: 0 };
	flyActs.forEach(function (a) { a.forEach(function (x) { cnt[x]++; }); });
	var tot = cnt.buy + cnt.sell + cnt.hold;
	var flyProbs = { buy: cnt.buy / tot, sell: cnt.sell / tot, hold: cnt.hold / tot };

	function randomDecisions(probs, seed) {
		var rng = makeRng(seed), out = [];
		for (var i = 0; i < cfg.random.investors; i++) out.push(market.randomActions(points, rng, probs));
		return out;
	}
	var randActs = randomDecisions(cfg.random.probs, cfg.random.seed);
	var matchedActs = randomDecisions(flyProbs, cfg.random.seed + 1);
	var ruleAct = market.ruleActions(points), revAct = market.reverseRuleActions(points);

	var w = cfg.window ? cfg.window.start.slice(0, 10) : new Date(prices[0].t * 1000).toISOString().slice(0, 10);
	return FEES.map(function (fee) {
		var R = Object.assign({}, cfg.rules, { feeRate: fee });
		function pnl(a) { return market.simulate(a, points, finalPrice, R); }
		var fly = flyActs.map(pnl), rule = pnl(ruleAct), rev = pnl(revAct);
		var flyP = fly.map(function (s) { return s.pnl; });
		return {
			period: w, label: cfg.label || 'STONKFLY 기간', fee: fee, repeats: flyP.length,
			flyMean: mean(flyP), flyMin: Math.min.apply(null, flyP), flyMax: Math.max.apply(null, flyP),
			flyOrders: mean(fly.map(function (s) { return s.orders; })),
			rule: rule.pnl, ruleOrders: rule.orders, reverseRule: rev.pnl,
			flyBeatsRule: flyP.filter(function (x) { return x > rule.pnl + 1e-9; }).length,
			randomMean: mean(randActs.map(function (a) { return pnl(a).pnl; })),
			matchedMean: mean(matchedActs.map(function (a) { return pnl(a).pnl; }))
		};
	});
}

function main() {
	var files = process.argv.slice(2);
	var rows = [];
	files.forEach(function (f) { rows = rows.concat(analyse(f)); });
	var md = ['| 기간 | 구분 | 수수료 | 초파리 평균 [최저~최고] | 규칙 투자자 | 초파리 − 규칙 | 초파리 > 규칙 | 반대 규칙 투자자 | 무작위 1만 명 평균 | 같은 행동 비율 무작위 평균 |',
		'|---|---|---:|---|---:|---:|---:|---:|---:|---:|'];
	var csv = ['period,label,fee_rate,fly_repeats,fly_pnl_mean,fly_pnl_min,fly_pnl_max,fly_orders_mean,rule_pnl,rule_orders,fly_minus_rule,fly_beats_rule,reverse_rule_pnl,random_pnl_mean,matched_random_pnl_mean'];
	rows.forEach(function (r) {
		md.push('| ' + r.period + ' | ' + r.label + ' | ' + (100 * r.fee).toFixed(1) + '% | ' + money(r.flyMean) + ' [' + money(r.flyMin) + ' ~ ' + money(r.flyMax) + '] | ' +
			money(r.rule) + ' | ' + money(r.flyMean - r.rule) + ' | ' + r.flyBeatsRule + '/' + r.repeats + ' | ' + money(r.reverseRule) + ' | ' +
			money(r.randomMean) + ' | ' + money(r.matchedMean) + ' |');
		csv.push([r.period, r.label, r.fee, r.repeats, r.flyMean.toFixed(4), r.flyMin.toFixed(4), r.flyMax.toFixed(4), r.flyOrders.toFixed(2),
			r.rule.toFixed(4), r.ruleOrders, (r.flyMean - r.rule).toFixed(4), r.flyBeatsRule, r.reverseRule.toFixed(4), r.randomMean.toFixed(4), r.matchedMean.toFixed(4)].join(','));
	});
	FEES.forEach(function (fee) {
		var sub = rows.filter(function (r) { return r.fee === fee; });
		var beats = sub.reduce(function (a, r) { return a + r.flyBeatsRule; }, 0), n = sub.reduce(function (a, r) { return a + r.repeats; }, 0);
		var periodsAhead = sub.filter(function (r) { return r.flyMean > r.rule; }).length;
		md.push('');
		md.push('- 수수료 ' + (100 * fee).toFixed(1) + '%: 초파리 실행 ' + n + '회 중 규칙 투자자보다 나은 회차 ' + beats + ' (' + (100 * beats / n).toFixed(0) + '%), ' +
			'초파리 평균이 규칙보다 높은 기간 ' + periodsAhead + '/' + sub.length + ', 기간 평균 차이(초파리 − 규칙) ' +
			money(mean(sub.map(function (r) { return r.flyMean - r.rule; }))));
	});
	var out = path.join(__dirname, 'results', 'fee-counterfactual');
	fs.mkdirSync(out, { recursive: true });
	fs.writeFileSync(path.join(out, 'table.md'), md.join('\n') + '\n');
	fs.writeFileSync(path.join(out, 'table.csv'), csv.join('\n') + '\n');
	fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ fees: FEES, configs: files, rows: rows }, null, 2) + '\n');
	console.log(md.join('\n'));
}

main();
