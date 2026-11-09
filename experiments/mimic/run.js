/* mimic/run.js — 초파리 흉내 코드 투자자 vs 초파리 (사전 계획: mimic/PLAN.md)
 *
 * 흉내 투자자는 뇌를 돌리지 않는다. 결정마다 자극 세기를 계산하고, 따로 측정해 둔 반응 곡선
 * (market/results/response-curve/curve.json)에서 매수/매도 확률을 읽어 제비뽑기만 한다.
 *
 *   node experiments/mimic/run.js   -> experiments/mimic/results/{summary.json, table.md}
 */
'use strict';
var fs = require('fs'), path = require('path');
var EXP = path.join(__dirname, '..');
var market = require(path.join(EXP, 'lib', 'market.js'));
var common = require(path.join(EXP, 'lib', 'trade-common.js'));
var M = require(path.join(EXP, 'market', 'lib', 'market-model.js'));
var emo = require(path.join(EXP, 'emotion', 'run.js'));   // CONFIGS, makeRng (mulberry32)

var N = 10000, SEED = 9201, MARGIN = 0.10, REF = 0.01;
var CURVES = {
	main: { label: '눈별 30회 곡선 (주 분석)', file: 'market/results/response-curve/curve.json', mode: 'eye' },
	pooled: { label: '좌우 합친 30회 곡선 (민감도)', file: 'market/results/response-curve/curve.json', mode: 'pooled' },
	big: { label: '큰 표본 곡선, 거래 기록 4,420회 (참고, 순환성 있음)', file: 'market/results/robustness/big-curve.json', mode: 'pooled' }
};

/* one-sided 95% t quantile (two-sided 90% CI) */
function t95(df) {
	var tab = { 1: 6.314, 2: 2.920, 3: 2.353, 4: 2.132, 5: 2.015, 6: 1.943, 7: 1.895, 8: 1.860, 9: 1.833, 10: 1.812, 20: 1.725, 30: 1.697, 40: 1.684, 60: 1.671, 80: 1.664, 120: 1.658 };
	if (tab[df]) return tab[df];
	var ks = Object.keys(tab).map(Number).sort(function (a, b) { return a - b; });
	for (var i = 1; i < ks.length; i++) if (df < ks[i]) {   // linear in 1/df
		var a = ks[i - 1], b = ks[i], w = (1 / df - 1 / a) / (1 / b - 1 / a);
		return tab[a] + w * (tab[b] - tab[a]);
	}
	return 1.645;
}
function ci90(xs) {
	var n = xs.length, m = xs.reduce(function (s, x) { return s + x; }, 0) / n, v = 0;
	xs.forEach(function (x) { v += (x - m) * (x - m); });
	var half = t95(n - 1) * Math.sqrt(v / (n - 1) / n);
	return { n: n, mean: m, lo: m - half, hi: m + half };
}
function verdict(c) {
	if (c.lo > -MARGIN && c.hi < MARGIN) return (c.lo > 0 || c.hi < 0) ? '동등 (0은 벗어남: 작은 차이)' : '동등';
	if (c.lo > 0 || c.hi < 0) return '다르다';
	return '판단 불가';
}
function mean(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }

function mimicActions(curveFn, pts, rng) {
	return pts.map(function (p) {
		var pr = M.flyProbs(curveFn, p.ret, REF, false), u = rng();
		return u < pr.buy ? 'buy' : (u < pr.buy + pr.sell ? 'sell' : 'hold');
	});
}

function readFlyRuns(name) {
	var lines = fs.readFileSync(path.join(EXP, 'results', name, 'fly_runs.csv'), 'utf8').trim().split('\n');
	var h = lines[0].split(',');
	return lines.slice(1).map(function (l) { var c = l.split(','); return { pnl: +c[h.indexOf('final_pnl_usd')], orders: +c[h.indexOf('orders')] }; });
}

var out = { plan: 'experiments/mimic/PLAN.md', investorsPerPeriod: N, seed: SEED, margin: MARGIN, curves: {} };
Object.keys(CURVES).forEach(function (ck) {
	var C = CURVES[ck], curve = JSON.parse(fs.readFileSync(path.join(EXP, C.file), 'utf8'));
	var curveFn = M.makeCurve(curve, C.mode === 'pooled' ? 'pooled' : 'eye');
	var periods = [], runDiffs = [];
	emo.CONFIGS.forEach(function (file, pi) {
		var cfg = common.loadTradeConfig(path.join(EXP, 'config', file)), R = cfg.rules;
		if (cfg.fly.fullScaleReturn !== REF) throw new Error('fullScaleReturn differs: ' + file);
		var prices = common.loadPrices(cfg), pts = market.decisionPoints(prices, cfg.intervalMin), fp = prices[prices.length - 1].close;
		var rng = emo.makeRng(SEED + pi), pnl = [], orders = [], acts = { buy: 0, sell: 0, hold: 0 };
		for (var i = 0; i < N; i++) {
			var a = mimicActions(curveFn, pts, rng);
			a.forEach(function (x) { acts[x]++; });
			var sim = market.simulate(a, pts, fp, R);
			pnl.push(sim.pnl); orders.push(sim.orders);
		}
		var fly = readFlyRuns(cfg.name), summ = JSON.parse(fs.readFileSync(path.join(EXP, 'results', cfg.name, 'summary.json'), 'utf8'));
		var mMean = mean(pnl), sorted = pnl.slice().sort(function (x, y) { return x - y; });
		var pctl = fly.map(function (r) {
			var lo = 0, hi = sorted.length; while (lo < hi) { var mid = (lo + hi) >> 1; if (sorted[mid] < r.pnl) lo = mid + 1; else hi = mid; }
			var lo2 = lo; while (lo2 < sorted.length && sorted[lo2] === r.pnl) lo2++;
			return (lo + (lo2 - lo) / 2) / sorted.length;
		});
		fly.forEach(function (r) { runDiffs.push(r.pnl - mMean); });
		// [탐색, 결과를 본 뒤 추가] 같은 주문 수의 흉내 투자자 평균과 비교 (±w 묶어 50명 이상)
		var sameK = fly.map(function (r) {
			for (var w = 0; w <= 26; w++) { var s = 0, n = 0; for (var j = 0; j < N; j++) if (Math.abs(orders[j] - r.orders) <= w) { s += pnl[j]; n++; } if (n >= 50) return r.pnl - s / n; }
			return null;
		});
		var tot = acts.buy + acts.sell + acts.hold;
		periods.push({ name: cfg.name, label: cfg.label, flyRuns: fly.length,
			fly: { pnl: mean(fly.map(function (r) { return r.pnl; })), orders: mean(fly.map(function (r) { return r.orders; })), actionRates: summ.fly.actionRates },
			mimic: { pnl: mMean, orders: mean(orders), actionRates: { buy: acts.buy / tot, sell: acts.sell / tot, hold: acts.hold / tot } },
			diff: mean(fly.map(function (r) { return r.pnl; })) - mMean, residualSameOrders: mean(sameK), flyPercentileInMimic: mean(pctl),
			controls: { rule: summ.rule.pnl, random: summ.random.pnl.mean, rateMatched: summ.randomMatched.pnl.mean } });
	});
	var res = { label: C.label, file: C.file, mode: C.mode, periods: periods };
	res.primary = ci90(periods.map(function (p) { return p.diff; })); res.primary.verdict = verdict(res.primary);
	res.runLevel = ci90(runDiffs); res.runLevel.verdict = verdict(res.runLevel);
	res.exploreSameOrders = ci90(periods.map(function (p) { return p.residualSameOrders; })); res.exploreSameOrders.verdict = verdict(res.exploreSameOrders);
	if (ck === 'main') {
		res.controls = {};
		['rule', 'random', 'rateMatched'].forEach(function (k) {
			var c = ci90(periods.map(function (p) { return p.fly.pnl - p.controls[k]; })); c.verdict = verdict(c); res.controls[k] = c;
		});
	}
	out.curves[ck] = res;
	console.log(ck, JSON.stringify(res.primary), JSON.stringify(res.runLevel));
});

var dir = path.join(__dirname, 'results');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(out, null, 2) + '\n');

function money(x) { return (x < 0 ? '−$' : '+$') + Math.abs(x).toFixed(2); }
function ci(c) { return money(c.mean) + ' [' + money(c.lo) + ', ' + money(c.hi) + ']'; }
function pct(x) { return (100 * x).toFixed(1) + '%'; }
var m = out.curves.main;
var md = ['# 초파리 흉내 코드 투자자 vs 초파리', '',
	'사전 계획: `experiments/mimic/PLAN.md`. 흉내 투자자 = 뇌 없이 반응 곡선에서 제비뽑기, 기간마다 1만 명(시드 9201~). 초파리 = 저장된 실행(STONKFLY 30회, 나머지 10회).',
	'판정: 6개 기간 차이(초파리 − 흉내)의 90% CI가 ±$0.10 안이면 동등.', '',
	'## 주 분석: ' + m.label, '',
	'| 기간 | 초파리 손익 (주문) | 흉내 손익 (주문) | 차이 | 초파리의 흉내 분포 안 백분위 | 초파리 매수/매도/보유 | 흉내 매수/매도/보유 |', '|---|---|---|---|---|---|---|'];
m.periods.forEach(function (p) {
	function r(a) { return pct(a.buy) + ' / ' + pct(a.sell) + ' / ' + pct(a.hold); }
	md.push('| ' + p.label + ' | ' + money(p.fly.pnl) + ' (' + p.fly.orders.toFixed(1) + ') | ' + money(p.mimic.pnl) + ' (' + p.mimic.orders.toFixed(1) + ') | ' + money(p.diff) + ' | ' + pct(p.flyPercentileInMimic) + ' | ' + r(p.fly.actionRates) + ' | ' + r(p.mimic.actionRates) + ' |');
});
md.push('', '| 비교 | 차이 평균 [90% CI] | 판정 |', '|---|---|---|');
md.push('| **주 판정: 초파리 − 흉내 (기간 단위, n=6)** | ' + ci(m.primary) + ' | **' + m.primary.verdict + '** |');
md.push('| 보조: 초파리 − 흉내 (실행 단위, n=' + m.runLevel.n + ') | ' + ci(m.runLevel) + ' | ' + m.runLevel.verdict + ' |');
md.push('| 대조: 초파리 − 매번 거래하는 규칙 투자자 | ' + ci(m.controls.rule) + ' | ' + m.controls.rule.verdict + ' |');
md.push('| 대조: 초파리 − 1/3 무작위 투자자 | ' + ci(m.controls.random) + ' | ' + m.controls.random.verdict + ' |');
md.push('| 참고: 초파리 − 행동 비율만 맞춘 무작위 (가격 안 봄) | ' + ci(m.controls.rateMatched) + ' | ' + m.controls.rateMatched.verdict + ' |');
md.push('', '## [탐색] 결과를 본 뒤 추가: 주문 수를 맞추면?', '',
	'흉내 투자자가 초파리보다 주문을 더 많이 해서, 초파리 실행마다 **같은 주문 수의 흉내 투자자** 평균과 비교(사전 계획에 없음).', '',
	'| 곡선 | 초파리 − 같은 주문 수 흉내 (기간 단위) [90% CI] | ±$0.10 기준 |', '|---|---|---|');
Object.keys(out.curves).forEach(function (k) { var c = out.curves[k]; md.push('| ' + c.label + ' | ' + ci(c.exploreSameOrders) + ' | ' + c.exploreSameOrders.verdict + ' |'); });
md.push('', '## 민감도 (곡선 바꾸기)', '', '| 곡선 | 기간 단위 [90% CI] | 판정 | 실행 단위 [90% CI] | 흉내 평균 주문 |', '|---|---|---|---|---|');
Object.keys(out.curves).forEach(function (k) {
	var c = out.curves[k];
	md.push('| ' + c.label + ' | ' + ci(c.primary) + ' | ' + c.primary.verdict + ' | ' + ci(c.runLevel) + ' | ' + mean(c.periods.map(function (p) { return p.mimic.orders; })).toFixed(2) + ' |');
});
md.push('', '초파리 평균 주문 ' + mean(m.periods.map(function (p) { return p.fly.orders; })).toFixed(2) + '건.');
fs.writeFileSync(path.join(dir, 'table.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
