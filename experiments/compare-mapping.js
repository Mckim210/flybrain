#!/usr/bin/env node
/* compare-mapping.js — original vs reversed eye mapping, period by period
 *
 *   node experiments/compare-mapping.js
 *
 * For each period, the reversed run (results/reversed/<id>) is compared with
 * the original run's first N repeats (same seeds -> same background noise):
 *   - buy / sell / hold shares of the fly's decisions
 *   - direction: of the fly's buy/sell signals, how many follow the rule
 *     investor (up -> buy) and how many follow the reverse rule (up -> sell)
 *   - P&L (fee 0.6%): fly, rule investor, reverse-rule investor, and random
 *     investors with the reversed fly's own action rates
 * Writes experiments/results/reversed/comparison.md and comparison.csv.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var market = require('./lib/market.js');
var common = require('./lib/trade-common.js');
var makeRng = require('./lib/headless-sim.js').makeRng;

var PAIRS = [
	['trade-stonkfly-window-fixed1pct.json', 'reversed/stonkfly.json'],
	['periods/p20250910.json', 'reversed/p20250910.json'],
	['periods/p20260220.json', 'reversed/p20260220.json'],
	['periods/p20260526.json', 'reversed/p20260526.json'],
	['periods/p20260731.json', 'reversed/p20260731.json'],
	['periods/p20260818.json', 'reversed/p20260818.json']
];

function mean(xs) { return xs.reduce(function (a, b) { return a + b; }, 0) / xs.length; }
function money(x) { return (x >= 0 ? '+$' : '−$') + Math.abs(x).toFixed(2); }
function pct(x) { return (100 * x).toFixed(0) + '%'; }

function load(cfgFile, n) {
	var cfg = common.loadTradeConfig(path.join(__dirname, 'config', cfgFile));
	var acts = [];
	for (var k = 0; k < n; k++) {
		var rep = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', cfg.name, 'fly', 'rep_' + String(k).padStart(2, '0') + '.json'), 'utf8'));
		acts.push(rep.decisions.map(function (d) { return d.action; }));
	}
	return { cfg: cfg, acts: acts };
}

function describe(acts, points, ruleAct, sim) {
	var c = { buy: 0, sell: 0, hold: 0 }, withRule = 0, againstRule = 0;
	acts.forEach(function (a) {
		a.forEach(function (x, j) {
			c[x]++;
			if (x === 'hold' || ruleAct[j] === 'hold') return;
			if (x === ruleAct[j]) withRule++; else againstRule++;
		});
	});
	var n = c.buy + c.sell + c.hold, trades = withRule + againstRule;
	var pnl = acts.map(function (a) { return sim(a).pnl; });
	return {
		buy: c.buy / n, sell: c.sell / n, hold: c.hold / n,
		withRule: trades ? withRule / trades : null, againstRule: trades ? againstRule / trades : null,
		pnlMean: mean(pnl), pnlMin: Math.min.apply(null, pnl), pnlMax: Math.max.apply(null, pnl),
		orders: mean(acts.map(function (a) { return sim(a).orders; }))
	};
}

function main() {
	var rows = PAIRS.map(function (pair) {
		var n = common.loadTradeConfig(path.join(__dirname, 'config', pair[1])).fly.repeats;
		var rev = load(pair[1], n);
		var orig = load(pair[0], n);
		var cfg = orig.cfg;
		var prices = common.loadPrices(cfg);
		var points = market.decisionPoints(prices, cfg.intervalMin);
		var finalPrice = prices[prices.length - 1].close;
		var sim = function (a) { return market.simulate(a, points, finalPrice, cfg.rules); };
		var ruleAct = market.ruleActions(points);
		var o = describe(orig.acts, points, ruleAct, sim);
		var r = describe(rev.acts, points, ruleAct, sim);
		var rng = makeRng(cfg.random.seed + 2), probs = { buy: r.buy, sell: r.sell, hold: r.hold }, matched = [];
		for (var i = 0; i < cfg.random.investors; i++) matched.push(sim(market.randomActions(points, rng, probs)).pnl);
		return {
			period: cfg.window ? cfg.window.start.slice(0, 10) : '2026-09-10', label: cfg.label || 'STONKFLY 기간', repeats: n,
			net: finalPrice / prices[0].close - 1, up: points.filter(function (p) { return p.ret > 0; }).length, down: points.filter(function (p) { return p.ret < 0; }).length,
			orig: o, rev: r, rule: sim(ruleAct).pnl, reverseRule: sim(market.reverseRuleActions(points)).pnl, matchedRev: mean(matched)
		};
	});

	var md = [];
	md.push('| 기간 | 구분 | 상승/하락 시간 | 매수·매도·보유: 원래 | 매수·매도·보유: 반전 | 거래 방향이 규칙과 같음: 원래 → 반전 | 초파리 손익: 원래 → 반전 | 규칙 / 반대 규칙 투자자 | 반전 초파리와 같은 행동 비율 무작위 |');
	md.push('|---|---|---|---|---|---|---|---|---:|');
	var csv = ['period,label,repeats,up_hours,down_hours,orig_buy,orig_sell,orig_hold,rev_buy,rev_sell,rev_hold,orig_with_rule,rev_with_rule,orig_pnl_mean,rev_pnl_mean,rev_pnl_min,rev_pnl_max,orig_orders,rev_orders,rule_pnl,reverse_rule_pnl,matched_random_rev_pnl'];
	rows.forEach(function (x) {
		var o = x.orig, r = x.rev;
		md.push('| ' + x.period + ' | ' + x.label + ' | ' + x.up + ' / ' + x.down + ' | ' + pct(o.buy) + ' · ' + pct(o.sell) + ' · ' + pct(o.hold) + ' | ' +
			pct(r.buy) + ' · ' + pct(r.sell) + ' · ' + pct(r.hold) + ' | ' + pct(o.withRule) + ' → ' + pct(r.withRule) + ' | ' +
			money(o.pnlMean) + ' → ' + money(r.pnlMean) + ' | ' + money(x.rule) + ' / ' + money(x.reverseRule) + ' | ' + money(x.matchedRev) + ' |');
		csv.push([x.period, x.label, x.repeats, x.up, x.down, o.buy.toFixed(4), o.sell.toFixed(4), o.hold.toFixed(4), r.buy.toFixed(4), r.sell.toFixed(4), r.hold.toFixed(4),
			o.withRule.toFixed(4), r.withRule.toFixed(4), o.pnlMean.toFixed(4), r.pnlMean.toFixed(4), r.pnlMin.toFixed(4), r.pnlMax.toFixed(4),
			o.orders.toFixed(2), r.orders.toFixed(2), x.rule.toFixed(4), x.reverseRule.toFixed(4), x.matchedRev.toFixed(4)].join(','));
	});
	var allO = mean(rows.map(function (x) { return x.orig.withRule; })), allR = mean(rows.map(function (x) { return x.rev.withRule; }));
	md.push('');
	md.push('- 거래(매수·매도) 중 규칙 투자자와 같은 방향인 비율, 기간 평균: 원래 ' + pct(allO) + ' → 반전 ' + pct(allR));
	md.push('- 원래는 각 기간 반복 0~' + (rows[0].repeats - 1) + '만 사용(반전과 같은 시드). 손익은 수수료 0.6%.');
	var out = path.join(__dirname, 'results', 'reversed');
	fs.writeFileSync(path.join(out, 'comparison.md'), md.join('\n') + '\n');
	fs.writeFileSync(path.join(out, 'comparison.csv'), csv.join('\n') + '\n');
	console.log(md.join('\n'));
}

main();
