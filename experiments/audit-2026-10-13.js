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
 * 2. Small-sample CIs (record only). At the time meanCI used 1.96 for every n;
 *    it now uses Student's t (commit 04ba35e), so this section is not recomputed.
 * Writes experiments/results/audit-2026-10-13.md
 */
'use strict';

var fs = require('fs');
var path = require('path');
var market = require('./lib/market.js');
var common = require('./lib/trade-common.js');

var FEES = [0.006, 0.001, 0];
var MIN_ORDER_USD = 1;

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

/* Section 2 is a record only. When this audit ran, meanCI used 1.96 for every n;
 * commit 04ba35e switched it to Student's t and regenerated the results, so
 * recomputing "1.96 -> t" now would widen intervals that are already t-based. */
function smallSample() {
	return ['## 2. 작은 표본의 95% 신뢰구간 (기록)', '',
		'- 점검 당시 `lib/stats.js`의 `meanCI`는 표본 수와 관계없이 1.96을 써서, 10회짜리 결과의 구간이 t분포보다 약 15% 좁았다.',
		'- 같은 날 다른 세션의 수정(커밋 04ba35e)으로 `meanCI`가 t분포를 쓰게 되었고 1부 결과를 다시 만들었다. 0을 포함하는지가 바뀐 구간은 없었다.',
		'- 용량-반응 표(`sweep.js`)의 Δd 구간은 처음(커밋 afde606)부터 t분포였으므로 고칠 것이 없었다.',
		'- 시장 실험은 PLAN.md가 1.96을 미리 정했으므로 `stats.meanCIz`(1.96)를 그대로 쓴다.',
		'- 이 절의 원래 비교표(1.96 → t)는 커밋 f3334a1의 이 파일에 남아 있다. 지금 다시 계산하면 이미 t분포인 구간을 한 번 더 넓히게 되므로 다시 계산하지 않는다.'];
}

function main() {
	var md = ['# 코드 점검 메모 (2026-10-13)', '', '`node experiments/audit-2026-10-13.js`로 다시 만들 수 있음. 기존 결과 파일은 바꾸지 않음.', '']
		.concat(sizing(), [''], smallSample());
	var out = path.join(__dirname, 'results', 'audit-2026-10-13.md');
	fs.writeFileSync(out, md.join('\n') + '\n');
	console.log(md.join('\n'));
}

main();
