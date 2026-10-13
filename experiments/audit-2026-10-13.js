#!/usr/bin/env node
/* audit-2026-10-13.js — two checks found in the 2026-10-13 code review (no brain simulation, no result file changed)
 *
 *   node experiments/audit-2026-10-13.js
 *
 * 1. Order sizing. lib/market.js keeps 2% of the starting capital as cash and
 *    buys up to $10 per order. STONKFLY commit 78ef3e0 (stonkfly/risk.py, plan())
 *    instead buys min($10, cash) / 1.02 and sells min(position, $10 / price),
 *    rejecting orders below the exchange minimum (taken as $1, as in
 *    null-model/stonkfly_random_traders.py). The saved fly decisions and the rule
 *    investor are re-priced both ways, at fees 0.6% / 0.1% / 0%.
 * 2. Small-sample CIs. lib/stats.js meanCI uses 1.96 for every n. The CIs that
 *    decide a conclusion with n = 10 or 20 are recomputed with Student's t.
 * Writes experiments/results/audit-2026-10-13.md
 */
'use strict';

var fs = require('fs');
var path = require('path');
var market = require('./lib/market.js');
var common = require('./lib/trade-common.js');

var FEES = [0.006, 0.001, 0];
var MIN_ORDER_USD = 1;
// two-sided 95% Student t quantiles for the degrees of freedom used below
var T975 = { 9: 2.262, 19: 2.093 };

function money(x) { return (x >= 0 ? '+$' : '−$') + Math.abs(x).toFixed(3); }
function mean(xs) { return xs.reduce(function (a, b) { return a + b; }, 0) / xs.length; }

/* STONKFLY 78ef3e0 sizing (paper mode fills at the decision price) */
function simulateSource(actions, points, finalPrice, rules) {
	var cash = rules.capital, btc = 0, fees = 0, orders = 0, perDay = {};
	for (var k = 0; k < points.length; k++) {
		var a = actions[k], p = points[k].price;
		var day = new Date(points[k].t * 1000).toISOString().slice(0, 10);
		if (a === 'hold' || (perDay[day] || 0) >= rules.maxOrdersPerDay) continue;
		var value;
		if (a === 'buy') {
			value = Math.min(rules.orderUsd, cash) / (1 + rules.reserveRate);
			if (value < MIN_ORDER_USD) continue;
			cash -= value * (1 + rules.feeRate);
			btc += value / p;
		} else {
			var size = Math.min(btc, rules.orderUsd / p);
			value = size * p;
			if (value < MIN_ORDER_USD) continue;
			btc -= size;
			cash += value * (1 - rules.feeRate);
		}
		fees += value * rules.feeRate;
		orders++;
		perDay[day] = (perDay[day] || 0) + 1;
	}
	return { pnl: cash + btc * finalPrice - rules.capital, orders: orders, fees: fees };
}

function sizing() {
	var files = ['trade-stonkfly-window-fixed1pct.json'].concat(fs.readdirSync(path.join(__dirname, 'config', 'periods')).sort().map(function (f) { return 'periods/' + f; }));
	var md = ['## 1. 주문 크기 규칙: `lib/market.js` vs STONKFLY 원본(78ef3e0 `risk.py`)', '',
		'- `lib/market.js`: 시작 자본의 2%($2)를 현금으로 남기고 주문당 최대 $10 매수, 최소 주문 $0.005.',
		'- 원본: 매수 금액 = min($10, 현금) ÷ 1.02(주문당 $9.80), 매도 = min(보유량, $10 ÷ 가격), 거래소 최소 주문 미만은 거부(여기서는 $1로 둠; `null-model`과 같음).',
		'- 저장된 초파리 결정과 규칙 투자자 결정은 그대로 두고 손익만 두 방식으로 다시 계산함.', '',
		'| 기간 | 초파리 평균 손익: 현재 → 원본 규칙 | 규칙 투자자: 현재 → 원본 규칙 |', '|---|---|---|'];
	var beats = {};
	FEES.forEach(function (fee) { beats[fee] = { js: 0, src: 0, n: 0 }; });
	files.forEach(function (f) {
		var cfg = common.loadTradeConfig(path.join(__dirname, 'config', f));
		var prices = common.loadPrices(cfg);
		var pts = market.decisionPoints(prices, cfg.intervalMin), fp = prices[prices.length - 1].close;
		var flyActs = [];
		for (var k = 0; k < cfg.fly.repeats; k++) {
			flyActs.push(JSON.parse(fs.readFileSync(path.join(__dirname, 'results', cfg.name, 'fly', 'rep_' + String(k).padStart(2, '0') + '.json'), 'utf8'))
				.decisions.map(function (d) { return d.action; }));
		}
		var rule = market.ruleActions(pts);
		FEES.forEach(function (fee) {
			var rules = Object.assign({}, cfg.rules, { feeRate: fee });
			var rJs = market.simulate(rule, pts, fp, rules).pnl, rSrc = simulateSource(rule, pts, fp, rules).pnl;
			var fJs = flyActs.map(function (a) { return market.simulate(a, pts, fp, rules).pnl; });
			var fSrc = flyActs.map(function (a) { return simulateSource(a, pts, fp, rules).pnl; });
			fJs.forEach(function (x, i) {
				beats[fee].n++;
				if (x > rJs + 1e-9) beats[fee].js++;
				if (fSrc[i] > rSrc + 1e-9) beats[fee].src++;
			});
			if (fee === cfg.rules.feeRate) {
				md.push('| ' + (cfg.label || 'STONKFLY 기간') + ' ' + (cfg.window ? cfg.window.start.slice(0, 10) : '2026-09-10') + ' | ' +
					money(mean(fJs)) + ' → ' + money(mean(fSrc)) + ' | ' + money(rJs) + ' → ' + money(rSrc) + ' |');
			}
		});
	});
	md.push('', '| 수수료 | 초파리 > 규칙 (현재) | 초파리 > 규칙 (원본 규칙) |', '|---:|---:|---:|');
	FEES.forEach(function (fee) {
		var b = beats[fee];
		md.push('| ' + (100 * fee).toFixed(1) + '% | ' + b.js + '/' + b.n + ' | ' + b.src + '/' + b.n + ' |');
	});
	return md;
}

function smallSample() {
	var md = ['## 2. 작은 표본의 95% 신뢰구간: 1.96 대신 t분포', '',
		'`lib/stats.js`의 `meanCI`는 표본 수와 상관없이 평균 ± 1.96 × 표준오차를 쓴다. n이 작으면 t분포보다 좁다',
		'(n = 10이면 2.262/1.96 = 1.15배, n = 20이면 1.07배). 결론에 쓰인 구간만 t분포로 다시 계산함(시장 실험은 PLAN.md가 1.96을 미리 정했으므로 그대로 둠).', '',
		'| 결과 | n | 현재 [95% CI] | t분포 [95% CI] | 0을 포함? 현재 → t |', '|---|---:|---|---|---|'];
	function row(label, n, m, lo, hi) {
		var f = T975[n - 1] / 1.959963984540054, h = (hi - lo) / 2 * f;
		function inc(a, b) { return a <= 0 && b >= 0 ? '포함' : '제외'; }
		md.push('| ' + label + ' | ' + n + ' | ' + m.toFixed(4) + ' [' + lo.toFixed(4) + ', ' + hi.toFixed(4) + '] | ' +
			m.toFixed(4) + ' [' + (m - h).toFixed(4) + ', ' + (m + h).toFixed(4) + '] | ' + inc(lo, hi) + ' → ' + inc(m - h, m + h) + ' |');
	}
	['periods', 'robust-w10'].forEach(function (dir) {
		fs.readdirSync(path.join(__dirname, 'results', dir)).filter(function (d) { return /^p\d{8}$/.test(d); }).sort().forEach(function (d) {
			var r = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', dir, d, 'summary.json'), 'utf8')).fly.residualVsSameOrders;
			if (r.n === 10) row(dir + '/' + d + ' 같은 주문 수 대비 잔차($)', r.n, r.mean, r.lo, r.hi);
		});
	});
	['dose-response', 'dose-response-weights'].forEach(function (dir) {
		var lines = fs.readFileSync(path.join(__dirname, 'results', dir, 'table.csv'), 'utf8').trim().split('\n');
		var h = lines[0].split(',');
		var n = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', dir + '.json'), 'utf8')).trials;
		lines.slice(1).forEach(function (l) {
			var c = l.split(','), g = function (k) { return c[h.indexOf(k)]; };
			if (+g('delta_lo95') === 0 && +g('delta_hi95') === 0) return;
			row(dir + ' ×' + g('weight_scale') + ' ' + g('group') + ' 세기 ' + g('intensity') + ' Δd', n, +g('delta_d'), +g('delta_lo95'), +g('delta_hi95'));
		});
	});
	return md;
}

function main() {
	var md = ['# 코드 점검 메모 (2026-10-13)', '', '`node experiments/audit-2026-10-13.js`로 다시 만들 수 있음. 기존 결과 파일은 바꾸지 않음.', '']
		.concat(sizing(), [''], smallSample());
	var out = path.join(__dirname, 'results', 'audit-2026-10-13.md');
	fs.writeFileSync(out, md.join('\n') + '\n');
	console.log(md.join('\n'));
}

main();
