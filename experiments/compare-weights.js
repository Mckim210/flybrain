#!/usr/bin/env node
/* compare-weights.js — robustness: adopted weightScale 20 vs weightScale 10
 *
 *   node experiments/compare-weights.js
 *
 * For each of the six periods, compares the weightScale-20 runs (first N repeats,
 * same seeds as the weightScale-10 runs) with results/robust-w10/<id>:
 *   (1) does the fly beat the rule investor?  (runs with fly P&L > rule P&L)
 *   (2) residual vs random investors with the same number of executed orders,
 *       mean and 95% CI (does it include 0?), per period and pooled
 *   (3) hold share of the fly's decisions
 * Residuals come from each run's fly_runs.csv (computed by trade.js).
 * Writes experiments/results/robust-w10/comparison.md and comparison.csv.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var stats = require('./lib/stats.js');

var R = path.join(__dirname, 'results');
var PAIRS = [
	['stonkfly', 'trade-stonkfly-window-fixed1pct', 'robust-w10/stonkfly'],
	['p20250910', 'periods/p20250910', 'robust-w10/p20250910'],
	['p20260220', 'periods/p20260220', 'robust-w10/p20260220'],
	['p20260526', 'periods/p20260526', 'robust-w10/p20260526'],
	['p20260731', 'periods/p20260731', 'robust-w10/p20260731'],
	['p20260818', 'periods/p20260818', 'robust-w10/p20260818']
];

function money(x) { return (x >= 0 ? '+$' : '−$') + Math.abs(x).toFixed(2); }
function pct(x) { return (100 * x).toFixed(0) + '%'; }

function load(dir, n) {
	var s = JSON.parse(fs.readFileSync(path.join(R, dir, 'summary.json'), 'utf8'));
	var runs = fs.readFileSync(path.join(R, dir, 'fly_runs.csv'), 'utf8').trim().split('\n').slice(1, n + 1).map(function (l) {
		var x = l.split(',');
		return { pnl: +x[1], orders: +x[3], hold: +x[7], residual: +x[12] };
	});
	var decisions = s.window.decisions;
	return {
		label: s.config.label || 'STONKFLY 기간', start: s.window.from.slice(0, 10), rule: s.rule.pnl, ruleOrders: s.rule.orders,
		weightScale: s.config.fly.weightScale, runs: runs,
		pnl: stats.meanCI(runs.map(function (r) { return r.pnl; })),
		residual: stats.meanCI(runs.map(function (r) { return r.residual; })),
		beats: runs.filter(function (r) { return r.pnl > s.rule.pnl + 1e-9; }).length,
		hold: runs.reduce(function (a, r) { return a + r.hold; }, 0) / (runs.length * decisions),
		orders: runs.reduce(function (a, r) { return a + r.orders; }, 0) / runs.length
	};
}

function main() {
	var n = 10;
	var md = [];
	md.push('| 기간 | 구분 | 규칙 투자자 | 초파리 평균 손익: 20배 → 10배 | ① 초파리 > 규칙: 20배 / 10배 | ② 잔차 [95% CI]: 20배 | ② 잔차 [95% CI]: 10배 | ③ 보유 비율: 20배 → 10배 | 주문 수: 20배 → 10배 |');
	md.push('|---|---|---:|---|---|---|---|---|---|');
	var csv = ['period,label,rule_pnl,w20_pnl_mean,w10_pnl_mean,w20_beats_rule,w10_beats_rule,w20_residual,w20_res_lo,w20_res_hi,w10_residual,w10_res_lo,w10_res_hi,w20_hold,w10_hold,w20_orders,w10_orders'];
	var pooled = { 20: [], 10: [] }, beats = { 20: 0, 10: 0 }, total = 0;
	PAIRS.forEach(function (p) {
		var a = load(p[1], n), b = load(p[2], n);
		if (a.weightScale !== 20 || b.weightScale !== 10) throw new Error('unexpected weightScale in ' + p[0]);
		function ci(c) { return money(c.mean) + ' [' + money(c.lo) + ', ' + money(c.hi) + ']' + (c.lo <= 0 && c.hi >= 0 ? '' : ' ✱'); }
		md.push('| ' + a.start + ' | ' + a.label + ' | ' + money(a.rule) + ' | ' + money(a.pnl.mean) + ' → ' + money(b.pnl.mean) + ' | ' +
			a.beats + '/' + a.runs.length + ' / ' + b.beats + '/' + b.runs.length + ' | ' + ci(a.residual) + ' | ' + ci(b.residual) + ' | ' +
			pct(a.hold) + ' → ' + pct(b.hold) + ' | ' + a.orders.toFixed(1) + ' → ' + b.orders.toFixed(1) + ' |');
		csv.push([a.start, a.label, a.rule.toFixed(4), a.pnl.mean.toFixed(4), b.pnl.mean.toFixed(4), a.beats, b.beats,
			a.residual.mean.toFixed(4), a.residual.lo.toFixed(4), a.residual.hi.toFixed(4), b.residual.mean.toFixed(4), b.residual.lo.toFixed(4), b.residual.hi.toFixed(4),
			a.hold.toFixed(4), b.hold.toFixed(4), a.orders.toFixed(2), b.orders.toFixed(2)].join(','));
		a.runs.forEach(function (r) { pooled[20].push(r.residual); });
		b.runs.forEach(function (r) { pooled[10].push(r.residual); });
		beats[20] += a.beats; beats[10] += b.beats; total += a.runs.length;
	});
	var p20 = stats.meanCI(pooled[20]), p10 = stats.meanCI(pooled[10]);
	md.push('');
	md.push('- ✱ = 95% CI가 0을 포함하지 않음. 20배는 각 기간 반복 0~' + (n - 1) + '만 사용(10배와 같은 시드).');
	md.push('- 합계: 초파리 > 규칙 20배 ' + beats[20] + '/' + total + ', 10배 ' + beats[10] + '/' + total +
		' · 잔차 20배 ' + money(p20.mean) + ' [' + money(p20.lo) + ', ' + money(p20.hi) + '], 10배 ' + money(p10.mean) + ' [' + money(p10.lo) + ', ' + money(p10.hi) + ']');
	var out = path.join(R, 'robust-w10');
	fs.writeFileSync(path.join(out, 'comparison.md'), md.join('\n') + '\n');
	fs.writeFileSync(path.join(out, 'comparison.csv'), csv.join('\n') + '\n');
	console.log(md.join('\n'));
}

main();
