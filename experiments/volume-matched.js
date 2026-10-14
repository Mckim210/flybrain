#!/usr/bin/env node
/* volume-matched.js — rule investor that trades as little as the fly (no brain simulation)
 *
 *   node experiments/volume-matched.js
 *
 * The fly beat the rule investor in every period mainly by trading less. Here
 * the rule investor is made to trade as rarely as the fly, keeping the rule's
 * direction (up -> buy, down -> sell), and the saved fly decisions are compared
 * with it. Two versions, for the six periods of PAPER.md section 4:
 *   (B) skip-rule investors: at every hour with a signal, follow the rule with
 *       probability q and hold otherwise, q = the fly's buy+sell share in that
 *       period. 10,000 investors (seed = random.seed + 2). Each fly run is
 *       compared with the skip-rule investors that executed the same number of
 *       orders (neighbouring counts pooled until at least 50, as in trade.js).
 *   (A) threshold rule: follow the rule only when |hourly return| >= X. X is
 *       picked per period (at fee 0.6%) so its executed orders are as close as
 *       possible to the fly's mean; ties go to the larger X. X is chosen after
 *       seeing the whole period, so (A) is a comparison device, not a usable
 *       strategy, and it is a single investor per period (noisy).
 * Every decision is fixed; the fee is 0.6% (the experiment) and 0% (to check
 * that the result does not depend on fees).
 * Writes experiments/results/volume-matched/table.md, table.csv, summary.json.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var market = require('./lib/market.js');
var common = require('./lib/trade-common.js');
var stats = require('./lib/stats.js');
var makeRng = require('./lib/headless-sim.js').makeRng;

var CONFIGS = ['trade-stonkfly-window-fixed1pct.json', 'periods/p20250910.json', 'periods/p20260220.json',
	'periods/p20260526.json', 'periods/p20260731.json', 'periods/p20260818.json'];
var FEES = [0.006, 0];
var SKIP_INVESTORS = 10000;

function mean(xs) { return xs.reduce(function (a, b) { return a + b; }, 0) / xs.length; }
function money(x) { return (x >= 0 ? '+$' : '−$') + Math.abs(x).toFixed(2); }
function ci(c) { return money(c.mean) + ' [' + money(c.lo) + ', ' + money(c.hi) + ']'; }

/* share of xs strictly below x plus half of ties (mid-rank percentile) */
function percentileOf(xs, x) {
	var below = 0, ties = 0;
	for (var i = 0; i < xs.length; i++) {
		if (Math.abs(xs[i] - x) <= 1e-9) ties++;
		else if (xs[i] < x) below++;
	}
	return (below + 0.5 * ties) / xs.length;
}

function loadPeriod(file) {
	var cfg = common.loadTradeConfig(path.join(__dirname, 'config', file));
	var prices = common.loadPrices(cfg);
	var points = market.decisionPoints(prices, cfg.intervalMin);
	var flyActs = [];
	for (var k = 0; k < cfg.fly.repeats; k++) {
		flyActs.push(common.readRep(cfg, k).decisions.map(function (d) { return d.action; }));
	}
	var ruleAct = market.ruleActions(points);
	var signals = mean(flyActs.map(function (a) { return a.filter(function (x) { return x !== 'hold'; }).length; }));
	var q = signals / points.length;
	var rng = makeRng(cfg.random.seed + 2), skipActs = [];
	for (var i = 0; i < SKIP_INVESTORS; i++) {
		skipActs.push(ruleAct.map(function (x) { return x !== 'hold' && rng() < q ? x : 'hold'; }));
	}
	return {
		cfg: cfg, points: points, finalPrice: prices[prices.length - 1].close,
		period: cfg.window ? cfg.window.start.slice(0, 10) : new Date(prices[0].t * 1000).toISOString().slice(0, 10),
		label: cfg.label || 'STONKFLY 기간', flyActs: flyActs, ruleAct: ruleAct, skipActs: skipActs, q: q
	};
}

/* threshold rule whose executed orders (at the experiment's fee) are closest to the fly's mean */
function pickThreshold(P, flyOrders) {
	var cands = P.points.map(function (p) { return Math.abs(p.ret); }).filter(function (x) { return x > 0; })
		.sort(function (a, b) { return b - a; });
	var best = null;
	cands.forEach(function (X) {
		var acts = thresholdActions(P, X);
		var d = Math.abs(market.simulate(acts, P.points, P.finalPrice, P.cfg.rules).orders - flyOrders);
		if (!best || d < best.d - 1e-9) best = { d: d, X: X, acts: acts };
	});
	return best;
}

function thresholdActions(P, X) {
	return P.points.map(function (p, j) { return Math.abs(p.ret) >= X ? P.ruleAct[j] : 'hold'; });
}

function analyse(P, fee, threshold) {
	var R = Object.assign({}, P.cfg.rules, { feeRate: fee });
	function sim(a) { return market.simulate(a, P.points, P.finalPrice, R); }
	var fly = P.flyActs.map(sim), rule = sim(P.ruleAct), thr = sim(threshold.acts);
	var skip = P.skipActs.map(sim);
	var skipPnl = skip.map(function (s) { return s.pnl; }), skipOrders = skip.map(function (s) { return s.orders; });
	function expectedFor(o) {
		for (var w = 0; w <= P.points.length; w++) {
			var sum = 0, n = 0;
			for (var i = 0; i < skipPnl.length; i++) if (Math.abs(skipOrders[i] - o) <= w) { sum += skipPnl[i]; n++; }
			if (n >= 50) return sum / n;
		}
		throw new Error('no skip-rule investor near ' + o + ' orders');
	}
	var flyPnl = fly.map(function (s) { return s.pnl; });
	var resid = fly.map(function (s) { return s.pnl - expectedFor(s.orders); });
	var flyMean = mean(flyPnl);
	return {
		period: P.period, label: P.label, fee: fee, repeats: fly.length, q: P.q,
		flyMean: flyMean, flyOrders: mean(fly.map(function (s) { return s.orders; })),
		rule: rule.pnl, ruleOrders: rule.orders,
		skipMean: mean(skipPnl), skipOrders: mean(skipOrders),
		residuals: resid, residualCI: stats.meanCI(resid),
		percentileInSkip: mean(flyPnl.map(function (x) { return percentileOf(skipPnl, x); })),
		threshold: threshold.X, thresholdPnl: thr.pnl, thresholdOrders: thr.orders,
		flyMinusRule: flyMean - rule.pnl, flyMinusThreshold: flyMean - thr.pnl
	};
}

function main() {
	var periods = CONFIGS.map(loadPeriod);
	var thresholds = periods.map(function (P) {
		var R = P.cfg.rules;
		var flyOrders = mean(P.flyActs.map(function (a) { return market.simulate(a, P.points, P.finalPrice, R).orders; }));
		return pickThreshold(P, flyOrders);
	});
	var rows = [], summary = [];
	var md = ['# 거래량을 맞춘 규칙 투자자와 비교', '',
		'초파리 결정은 저장된 그대로, 규칙 투자자만 초파리만큼 드물게 거래하게 함(뇌 시뮬레이션 없음). 방법은 `volume-matched.js` 맨 위 설명.', ''];
	FEES.forEach(function (fee) {
		var sub = periods.map(function (P, i) { return analyse(P, fee, thresholds[i]); });
		rows = rows.concat(sub);
		var pooled = stats.meanCI([].concat.apply([], sub.map(function (r) { return r.residuals; })));
		var perPeriod = stats.meanCI(sub.map(function (r) { return r.residualCI.mean; }));
		var thrCI = stats.meanCI(sub.map(function (r) { return r.flyMinusThreshold; }));
		var s = {
			fee: fee, flyMinusRuleMean: mean(sub.map(function (r) { return r.flyMinusRule; })),
			flyBeatsRulePeriods: sub.filter(function (r) { return r.flyMinusRule > 0; }).length,
			residualPooled: pooled, residualPeriodUnit: perPeriod,
			flyMinusThresholdPeriodUnit: thrCI, flyBeatsThresholdPeriods: sub.filter(function (r) { return r.flyMinusThreshold > 1e-9; }).length,
			periods: sub.length
		};
		summary.push(s);
		md.push('## 수수료 ' + (100 * fee).toFixed(1) + '%', '');
		md.push('| 기간 | 구분 | 초파리 평균 (주문) | 규칙 투자자 (주문) | (B) 건너뛰는 규칙 평균 (주문) | 초파리 − 같은 주문 수 (B) [95% CI] | (B) 안 초파리 백분위 | (A) 문턱 규칙 (주문, 문턱) | 초파리 − (A) |');
		md.push('|---|---|---|---|---|---|---:|---|---:|');
		sub.forEach(function (r) {
			md.push('| ' + r.period + ' | ' + r.label + ' | ' + money(r.flyMean) + ' (' + r.flyOrders.toFixed(1) + ') | ' +
				money(r.rule) + ' (' + r.ruleOrders + ') | ' + money(r.skipMean) + ' (' + r.skipOrders.toFixed(1) + ') | ' +
				ci(r.residualCI) + ' | ' + (100 * r.percentileInSkip).toFixed(0) + '% | ' +
				money(r.thresholdPnl) + ' (' + r.thresholdOrders + ', ' + (100 * r.threshold).toFixed(2) + '%) | ' + money(r.flyMinusThreshold) + ' |');
		});
		md.push('');
		md.push('- 초파리 − 규칙 투자자(매번 거래): 기간 평균 ' + money(s.flyMinusRuleMean) + ', 초파리가 나은 기간 ' + s.flyBeatsRulePeriods + '/' + s.periods);
		md.push('- 초파리 − 같은 주문 수 (B): 실행 ' + pooled.n + '회 합산 ' + ci(pooled) + ', 기간 단위(기간 ' + perPeriod.n + '개) ' + ci(perPeriod));
		md.push('- 초파리 − (A) 문턱 규칙: 기간 단위 ' + ci(thrCI) + ', 초파리가 나은 기간 ' + s.flyBeatsThresholdPeriods + '/' + s.periods);
		md.push('');
	});
	md.push('- (B)의 거래 확률 q(기간별 초파리 매수+매도 비율): ' + periods.map(function (P) { return P.period + ' ' + (100 * P.q).toFixed(1) + '%'; }).join(', '));
	md.push('- (A)의 문턱은 기간 전체를 본 뒤 고른 값이고 기간마다 투자자 1명이라 잡음이 큼. 두 수수료 모두 같은 문턱·같은 결정을 씀.');
	md.push('- 신뢰구간은 t분포(`stats.meanCI`). 같은 기간의 실행끼리는 독립이 아니므로 기간 단위 구간이 더 보수적임.');

	var csv = ['period,label,fee_rate,fly_repeats,fly_pnl_mean,fly_orders_mean,rule_pnl,rule_orders,skip_q,skip_pnl_mean,skip_orders_mean,' +
		'residual_vs_skip_same_orders,residual_lo,residual_hi,fly_percentile_in_skip,threshold_return,threshold_pnl,threshold_orders,fly_minus_threshold'];
	rows.forEach(function (r) {
		csv.push([r.period, r.label, r.fee, r.repeats, r.flyMean.toFixed(4), r.flyOrders.toFixed(2), r.rule.toFixed(4), r.ruleOrders,
			r.q.toFixed(4), r.skipMean.toFixed(4), r.skipOrders.toFixed(2), r.residualCI.mean.toFixed(4), r.residualCI.lo.toFixed(4), r.residualCI.hi.toFixed(4),
			r.percentileInSkip.toFixed(4), r.threshold.toFixed(6), r.thresholdPnl.toFixed(4), r.thresholdOrders, r.flyMinusThreshold.toFixed(4)].join(','));
	});
	var out = path.join(__dirname, 'results', 'volume-matched');
	fs.mkdirSync(out, { recursive: true });
	fs.writeFileSync(path.join(out, 'table.md'), md.join('\n') + '\n');
	fs.writeFileSync(path.join(out, 'table.csv'), csv.join('\n') + '\n');
	fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({
		configs: CONFIGS, fees: FEES, skipInvestors: SKIP_INVESTORS, summary: summary,
		rows: rows.map(function (r) { var o = Object.assign({}, r); delete o.residuals; return o; })
	}, null, 2) + '\n');
	console.log(md.join('\n'));
}

main();
