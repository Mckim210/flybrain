#!/usr/bin/env node
/* robustness.js — [exploratory] does the market result survive the response curve's uncertainty?
 *
 *   node experiments/market/robustness.js [--bootstrap 200] [--no-png]
 *
 * No brain simulation: only trials that are already saved are reused.
 *  (1) big-sample curve from the saved trade decisions (weightScale 20, ~4,400
 *      trials; left+right pooled; x = median intensity of each bin; intensity 0 =
 *      the 100 no-stimulus trials of results/confirm-w20-vis, same trial settings),
 *      then run-market.js with config-robustness-big-curve.json (base setting,
 *      reference x1, 25/50/75%) and a side-by-side table with the earlier runs
 *  (2) response-probability sweep: 50% trend investors who, when |r| exceeds the
 *      pre-registered (c) threshold, trade in the direction of r with probability p
 *      (p only; trade frequency is not re-matched)
 *  (3) parametric bootstrap of the 30-trial curve: every (eye, intensity) count is
 *      redrawn from its observed proportions (n = 30), fly market at 50%
 * Writes experiments/market/results/robustness/
 */
'use strict';

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var M = require('./lib/market-model.js');
var stats = require('../lib/stats.js');
var makeRng = require('../lib/headless-sim.js').makeRng;
var fig = require('./figures.js');

var RES = path.join(__dirname, 'results');
var OUT = path.join(RES, 'robustness');
var CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
var BIG_CONFIG = path.join(__dirname, 'config-robustness-big-curve.json');
var BASE_KEY = 'L' + CFG.base.lambda + '_S' + CFG.base.sigma;
var BINS = [[0, 0.1], [0.1, 0.2], [0.2, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.99], [0.99, 1.01]]; // as check-symmetry.js
var P_VALUES = [1.0, 0.8, 0.63, 0.45, 0.3, 0.15];
var FRACTION = 0.5;
var BOOT_SEED = 20261011;

function pct(x, d) { return (100 * x).toFixed(d === undefined ? 0 : d) + '%'; }
function median(xs) { var s = xs.slice().sort(function (a, b) { return a - b; }); var n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
function sortedQ(xs, q) { return M.quantile(xs.slice().sort(function (a, b) { return a - b; }), q); }
function prop(k, n) { var w = stats.wilson(k, n); return { p: k / n, lo: w[0], hi: w[1] }; }
function point(same, opp, none) {
	var n = same + opp + none;
	return { n: n, same: same / n, opp: opp / n, none: none / n,
		sameCI: stats.wilson(same, n), oppCI: stats.wilson(opp, n), noneCI: stats.wilson(none, n) };
}

/* ---------- (1) big-sample curve ---------- */

function findRepFiles(dir, out) {
	fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
		var p = path.join(dir, e.name);
		if (e.isDirectory()) { if (e.name !== 'robust-w10') findRepFiles(p, out); }
		else if (/^rep_\d+\.json$/.test(e.name) && path.basename(dir) === 'fly') out.push(p);
	});
	return out;
}

function buildBigCurve() {
	var files = findRepFiles(path.join(__dirname, '..', 'results'), []);
	var bins = BINS.map(function () { return { xs: [], left: [0, 0, 0], right: [0, 0, 0] }; }); // [same, opp, none]
	var total = 0;
	files.forEach(function (f) {
		JSON.parse(fs.readFileSync(f, 'utf8')).decisions.forEach(function (d) {
			if (d.eye === 'none' || !(d.intensity > 0)) return;
			var b = BINS.findIndex(function (x) { return d.intensity > x[0] && d.intensity <= x[1]; });
			if (b < 0) return;
			total++;
			bins[b].xs.push(d.intensity);
			var k = d.choice === d.eye ? 0 : (d.choice === 'none' ? 2 : 1);
			bins[b][d.eye][k]++;
		});
	});
	var base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'results', 'confirm-w20-vis', 'runs', 'none_w20_t1', 'summary.json'), 'utf8')).counts;
	var curve = {
		intensities: [0], left: [point(base.left, base.right, base.none)], right: [point(base.right, base.left, base.none)],
		pooled: [point(base.left + base.right, base.left + base.right, 2 * base.none)],
		bins: [{ range: '자극 없음', median: 0, n: base.left + base.right + base.none }],
		settings: { source: files.length + ' saved trade runs (weightScale 20; robust-w10 excluded) + results/confirm-w20-vis no-stimulus trials',
			trials: total, note: 'x = median intensity of the bin; pooled = left+right; same = choice on the stimulated side' }
	};
	bins.forEach(function (b, i) {
		var m = median(b.xs);
		curve.intensities.push(m);
		curve.left.push(point(b.left[0], b.left[1], b.left[2]));
		curve.right.push(point(b.right[0], b.right[1], b.right[2]));
		curve.pooled.push(point(b.left[0] + b.right[0], b.left[1] + b.right[1], b.left[2] + b.right[2]));
		curve.bins.push({ range: '(' + BINS[i][0] + ', ' + Math.min(1, BINS[i][1]) + ']', median: m, n: b.xs.length });
	});
	fs.writeFileSync(path.join(OUT, 'big-curve.json'), JSON.stringify(curve, null, 1) + '\n');

	var small = JSON.parse(fs.readFileSync(path.join(RES, 'response-curve', 'curve.json'), 'utf8'));
	var smallFn = M.makeCurve(small, 'pooled');
	var md = ['# [탐색] 큰 표본 반응 곡선 (좌우 합침)', '',
		'자료: 기존 거래 실험의 초파리 결정 기록 ' + files.length + '개 파일, 시행 ' + total + '회(weightScale 20, `robust-w10` 제외; `symmetry-check.md`와 같은 자료).',
		'세기 0(자극 없음)은 같은 시행 설정의 `experiments/results/confirm-w20-vis` 무자극 100회(왼 ' + base.left + '·오 ' + base.right + '·무 ' + base.none + ').',
		'각 구간의 세기는 그 구간에 든 시행 세기의 중앙값, 사이는 선형 보간. [ ] = Wilson 95% 신뢰구간. 일부 실행끼리 시드를 공유하므로 완전히 독립된 시행은 아님.', '',
		'| 구간 | 세기(중앙값) | n | 같은 방향 | 반대 방향 | 무반응 | 참고: 30회 곡선(좌우 합침, 같은 세기로 보간) 같은 방향 |',
		'|---|---:|---:|---|---|---|---:|'];
	curve.pooled.forEach(function (p, i) {
		var x = curve.intensities[i];
		md.push('| ' + curve.bins[i].range + ' | ' + x.toFixed(3) + ' | ' + p.n + ' | ' + pct(p.same) + ' [' + pct(p.sameCI[0]) + ', ' + pct(p.sameCI[1]) + '] | ' +
			pct(p.opp, 1) + ' | ' + pct(p.none) + ' | ' + pct(smallFn('left', x).same) + ' |');
	});
	var runsDir = path.join(__dirname, '..', 'results', 'confirm-w20-vis', 'runs');
	var cl = JSON.parse(fs.readFileSync(path.join(runsDir, 'VIS_R1R6_left_i1_w20_t1', 'summary.json'), 'utf8')).counts;
	var cr = JSON.parse(fs.readFileSync(path.join(runsDir, 'VIS_R1R6_right_i1_w20_t1', 'summary.json'), 'utf8')).counts;
	var nl = cl.left + cl.right + cl.none, nr = cr.left + cr.right + cr.none, cw = stats.wilson(cl.left + cr.right, nl + nr);
	md.push('', '- 세기 0은 자극한 눈이 없으므로 왼쪽·오른쪽 선택을 "같은 방향"과 "반대 방향"에 모두 넣은 값(n은 좌우 두 번 센 ' + curve.pooled[0].n + ').');
	md.push('- 상한(세기 1) 비교: 이 곡선 ' + pct(curve.pooled[curve.pooled.length - 1].same) + ', 30회 곡선 ' + pct(small.pooled[small.pooled.length - 1].same) +
		', 참고로 `confirm-w20-vis` 세기 1(왼쪽 눈 ' + cl.left + '/' + nl + '·오른쪽 눈 ' + cr.right + '/' + nr + ' → 합쳐 ' +
		pct((cl.left + cr.right) / (nl + nr)) + ' [' + pct(cw[0]) + ', ' + pct(cw[1]) + ']).');
	fs.writeFileSync(path.join(OUT, 'big-curve.md'), md.join('\n') + '\n');
	return curve;
}

/* ---------- shared: random market, calibration, condition runs ---------- */

function randomMarketReturns() {
	var pooled = [];
	for (var seed = 1; seed <= CFG.seeds; seed++) {
		var r = M.run({ investors: CFG.investors, steps: CFG.steps, lambda: CFG.base.lambda, sigma: CFG.base.sigma, fraction: 0,
			type: 'random', pBuy: CFG.random.pBuy, pSell: CFG.random.pSell, seed: seed });
		for (var i = 0; i < r.returns.length; i++) pooled.push(r.returns[i]);
	}
	var abs = pooled.map(Math.abs).sort(function (a, b) { return a - b; });
	return { pooled: pooled, abs: abs, ref: M.quantile(abs, CFG.refQuantile) };
}

function flyFreq(curveFn, rm) {
	var s = 0;
	for (var i = 0; i < rm.pooled.length; i++) { var p = M.flyProbs(curveFn, rm.pooled[i], rm.ref, false); s += p.buy + p.sell; }
	return s / rm.pooled.length;
}

function runSeeds(o) {
	var rows = [];
	for (var seed = 1; seed <= CFG.seeds; seed++) {
		var res = M.run(Object.assign({ investors: CFG.investors, steps: CFG.steps, lambda: CFG.base.lambda, sigma: CFG.base.sigma,
			pBuy: CFG.random.pBuy, pSell: CFG.random.pSell, seed: seed }, o));
		var m = M.runMetrics(res, CFG.runawayLogMove);
		m.trade = res.trendTradeShare;
		rows.push(m);
	}
	return rows;
}

function summarizeRows(rows) {
	var run = rows.filter(function (r) { return r.runaway; });
	var out = { n: rows.length, runaway: run.length, up: run.filter(function (r) { return r.runawayDir > 0; }).length,
		runawayCI: stats.wilson(run.length, rows.length), trade: rows.reduce(function (a, r) { return a + r.trade; }, 0) / rows.length };
	['volatility', 'maxDrawdown', 'acfR1', 'acfAbs1'].forEach(function (k) { out[k] = stats.meanCI(rows.map(function (r) { return r[k]; })); });
	return out;
}

/* per-seed.csv of a run-market result -> {type|fraction: {runaway, up}} for the base setting, reference x1
 * (up = runaways that first crossed upwards) */
function runawayDirections(dir) {
	var lines = fs.readFileSync(path.join(RES, dir, 'per-seed.csv'), 'utf8').trim().split('\n');
	var h = lines[0].split(','), out = {};
	function col(c, n) { return c[h.indexOf(n)]; }
	lines.slice(1).forEach(function (l) {
		var c = l.split(',');
		if (+col(c, 'lambda') !== CFG.base.lambda || +col(c, 'sigma') !== CFG.base.sigma) return;
		if (col(c, 'type') !== 'random' && +col(c, 'ref_mult') !== 1) return;
		var k = col(c, 'type') + '|' + (+col(c, 'fraction'));
		out[k] = out[k] || { runaway: 0, up: 0 };
		if (+col(c, 'runaway')) { out[k].runaway++; if (+col(c, 'runaway_direction') > 0) out[k].up++; }
	});
	return out;
}

/* ---------- (1b) side-by-side with the earlier runs ---------- */

function compare() {
	var sources = [
		{ dir: 'market', label: '30회 곡선·좌우 따로 (사전 계획)' },
		{ dir: 'market-explore-pooled', label: '30회 곡선·좌우 합침 [탐색]' },
		{ dir: 'robustness/big-curve', label: '큰 표본 곡선·좌우 합침 [탐색]' }
	];
	var TYPES = [['fly', '(a) 초파리'], ['rule', '(c) 문턱 규칙'], ['ruleSoft', '(e) 확률적 문턱 규칙']];
	sources.forEach(function (s) {
		s.S = JSON.parse(fs.readFileSync(path.join(RES, s.dir, 'summary.json'), 'utf8'));
		s.dirs = runawayDirections(s.dir);
		s.cal = s.S.calibration[BASE_KEY].byMultiplier['1'];
	});
	function cond(s, type, f) {
		return s.S.conditions.filter(function (c) { return c.key === BASE_KEY && c.type === type && c.fraction === f && c.refMult === 1; })[0];
	}
	var md = ['# [탐색] 반응 곡선을 바꿔도 같은가: 기본 설정(λ ' + CFG.base.lambda + ', σ ' + CFG.base.sigma + ', 기준값 ×1)', '',
		'세 실행은 곡선만 다르고 시장 규칙·시드·지표는 같다. (c)의 문턱과 (e)의 문턱은 각 곡선의 초파리 거래 빈도에 맞춰 다시 정해진다(PLAN.md 2절 방식).', '',
		'## 곡선별 맞추기 값', '',
		'| 곡선 | 무작위 시장에서 초파리 거래 빈도 | (c) 문턱 / 기준값 | (e) 반응 확률(곡선 상한) | (e) 문턱 / 기준값 |', '|---|---:|---:|---:|---:|'];
	sources.forEach(function (s) {
		md.push('| ' + s.label + ' | ' + pct(s.cal.flyTradeFreq, 1) + ' | ' + s.cal.thresholdOverRef.toFixed(2) + ' | ' +
			(s.cal.softProb ? pct(s.cal.softProb, 1) : '-') + ' | ' + (s.cal.thresholdSoft ? (s.cal.thresholdSoft / s.cal.ref).toFixed(2) : '-') + ' |');
	});
	md.push('', '## 지표 (시드 50개 평균 [95% CI])', '',
		'| 비율 | 곡선 | 투자자 | 시장 안 거래율 | 폭주 시드 (위/아래) | 변동성 ×1000 | 최대 낙폭 | ACF(r,1) |', '|---:|---|---|---:|---|---|---|---|');
	CFG.fractions.forEach(function (f) {
		sources.forEach(function (s) {
			TYPES.forEach(function (t) {
				var c = cond(s, t[0], f);
				if (!c) return;
				var d = s.dirs[t[0] + '|' + f], m = c.summary;
				md.push('| ' + (100 * f) + '% | ' + s.label + ' | ' + t[1] + ' | ' + pct(c.trendTradeShare, 1) + ' | **' + d.runaway + '/50** (' + d.up + '/' + (d.runaway - d.up) + ') | ' +
					(1000 * m.volatility.mean).toFixed(2) + ' [' + (1000 * m.volatility.lo).toFixed(2) + ', ' + (1000 * m.volatility.hi).toFixed(2) + '] | ' +
					pct(m.maxDrawdown.mean, 1) + ' | ' + m.acfR1.mean.toFixed(3) + ' |');
			});
		});
	});
	md.push('', '## PLAN.md 4절 기준 판정 (같은 곡선 안에서)', '', '| 곡선 | 비교 | 25% | 50% | 75% |', '|---|---|---|---|---|');
	sources.forEach(function (s) {
		['(a) vs (c)', '(a) vs (e) 탐색'].forEach(function (pair) {
			var vs = CFG.fractions.map(function (f) {
				var v = s.S.verdicts.filter(function (x) { return x.key === BASE_KEY && x.refMult === 1 && x.fraction === f && x.pair === pair; })[0];
				return v ? v.verdict + (v.differ.length ? ' (' + v.differ.length + '개)' : '') : null;
			});
			if (vs[0] !== null) md.push('| ' + s.label + ' | ' + pair.replace(' 탐색', '') + ' | ' + vs.join(' | ') + ' |');
		});
	});
	fs.writeFileSync(path.join(OUT, 'compare.md'), md.join('\n') + '\n');
	return sources;
}

/* ---------- (2) response-probability sweep ---------- */

function pSweep(rm, sources, bigCurve) {
	var prim = sources[0].cal;
	if (Math.abs(prim.ref - rm.ref) > 1e-15) throw new Error('reference value differs from the pre-registered run');
	var threshold = prim.threshold;
	var rows = P_VALUES.map(function (p) {
		return { p: p, s: summarizeRows(runSeeds({ fraction: FRACTION, type: 'ruleSoft', softProb: p, threshold: threshold })) };
	});
	// check: p = 1 must reproduce the pre-registered (c) at 50%
	var c50 = sources[0].S.conditions.filter(function (c) { return c.key === BASE_KEY && c.type === 'rule' && c.fraction === FRACTION && c.refMult === 1; })[0];
	var p1 = rows[0].s;
	var reproduced = p1.runaway === c50.summary.runaway.count && Math.abs(p1.volatility.mean - c50.summary.volatility.mean) < 1e-12;

	var small = JSON.parse(fs.readFileSync(path.join(RES, 'response-curve', 'curve.json'), 'utf8'));
	var flies = [
		{ label: '(a) 30회 곡선·좌우 따로 (사전 계획)', x: small.pooled[small.pooled.length - 1].same, src: sources[0], shape: 'diamond' },
		{ label: '(a) 30회 곡선·좌우 합침 [탐색]', x: small.pooled[small.pooled.length - 1].same, src: sources[1], shape: 'ring' },
		{ label: '(a) 큰 표본 곡선 [탐색]', x: bigCurve.pooled[bigCurve.pooled.length - 1].same, src: sources[2], shape: 'square' }
	];
	flies.forEach(function (fl) {
		var c = fl.src.S.conditions.filter(function (c) { return c.key === BASE_KEY && c.type === 'fly' && c.fraction === FRACTION && c.refMult === 1; })[0];
		var d = fl.src.dirs['fly|' + FRACTION];
		fl.s = { runaway: d.runaway, up: d.up, runawayCI: [c.summary.runaway.lo, c.summary.runaway.hi], volatility: c.summary.volatility,
			maxDrawdown: c.summary.maxDrawdown, acfR1: c.summary.acfR1, trade: c.trendTradeShare };
	});

	var csv = ['p,runaway,runaway_up,runaway_lo,runaway_hi,volatility_mean,volatility_lo,volatility_hi,max_drawdown_mean,max_drawdown_lo,max_drawdown_hi,acf_r1_mean,acf_r1_lo,acf_r1_hi,trend_trade_share'];
	rows.forEach(function (r) {
		var s = r.s;
		csv.push([r.p, s.runaway, s.up, (50 * s.runawayCI[0]).toFixed(2), (50 * s.runawayCI[1]).toFixed(2)].concat(['volatility', 'maxDrawdown', 'acfR1'].map(function (k) {
			return [s[k].mean, s[k].lo, s[k].hi].map(function (x) { return +x.toPrecision(5); }).join(',');
		})).concat([s.trade.toFixed(4)]).join(','));
	});
	fs.writeFileSync(path.join(OUT, 'p-sweep.csv'), csv.join('\n') + '\n');

	function line(label, s) {
		return '| ' + label + ' | ' + pct(s.trade, 1) + ' | **' + s.runaway + '/50** (위 ' + s.up + ') | ' +
			(1000 * s.volatility.mean).toFixed(2) + ' [' + (1000 * s.volatility.lo).toFixed(2) + ', ' + (1000 * s.volatility.hi).toFixed(2) + '] | ' +
			pct(s.maxDrawdown.mean, 1) + ' [' + pct(s.maxDrawdown.lo, 1) + ', ' + pct(s.maxDrawdown.hi, 1) + '] | ' +
			s.acfR1.mean.toFixed(3) + ' [' + s.acfR1.lo.toFixed(3) + ', ' + s.acfR1.hi.toFixed(3) + '] |';
	}
	var md = ['# [탐색] 반응 확률 p에 따른 시장 (추세 반응 투자자 50%, 기본 설정)', '',
		'규칙: |r_t| > 문턱이면 각 투자자가 확률 p로 수익률 방향 거래, 아니면 보유. 문턱은 사전 계획 (c)의 값 ' + threshold.toExponential(3) +
		'(기준값의 ' + prim.thresholdOverRef.toFixed(2) + '배)로 고정하고 p만 바꿈(거래 빈도는 다시 맞추지 않음). 시드 50개, [ ] = 95% CI.', '',
		'| p | 시장 안 거래율 | 폭주 시드 | 변동성 ×1000 | 최대 낙폭 | ACF(r,1) |', '|---|---:|---|---|---|---|'];
	rows.forEach(function (r) { md.push(line('p = ' + r.p, r.s)); });
	md.push('', '참고: 같은 시장의 초파리 (a) (곡선이 계단이 아니라 완만하고, 문턱 아래에서도 약하게 반응하므로 p 곡선 위에 정확히 놓일 필요는 없음)', '',
		'| 초파리 곡선 | 곡선 상한 | 시장 안 거래율 | 폭주 시드 | 변동성 ×1000 | 최대 낙폭 | ACF(r,1) |', '|---|---:|---:|---|---|---|---|');
	flies.forEach(function (fl) { md.push(line(fl.label + ' | ' + pct(fl.x, 1), fl.s)); });
	md.push('', '- 확인: p = 1은 사전 계획 (c) 문턱 규칙 50%와 ' + (reproduced ? '완전히 같은 결과(폭주 ' + p1.runaway + '/50, 변동성 동일)' : '**다른 결과 — 코드 확인 필요**') + '.');
	fs.writeFileSync(path.join(OUT, 'p-sweep.md'), md.join('\n') + '\n');
	if (!reproduced) throw new Error('p = 1 does not reproduce the pre-registered rule market');
	return { rows: rows, flies: flies, threshold: threshold };
}

/* ---------- (3) parametric bootstrap of the 30-trial curve ---------- */

function multinomial(rng, n, ps) {
	var c = [0, 0, 0];
	for (var i = 0; i < n; i++) {
		var u = rng();
		c[u < ps[0] ? 0 : (u < ps[0] + ps[1] ? 1 : 2)]++;
	}
	return c;
}

function bootstrap(rm, B) {
	var small = JSON.parse(fs.readFileSync(path.join(RES, 'response-curve', 'curve.json'), 'utf8'));
	var n = small.settings.trials, K = small.intensities.length;
	var rng = makeRng(BOOT_SEED);
	function curveFrom(left, right, none) {
		// left/right: per intensity (index >= 1) [same, opp, none] counts of n trials; none: [left, right, none] of n
		var c = { intensities: small.intensities, left: [], right: [], pooled: [] };
		c.left.push({ same: none[0] / n, opp: none[1] / n });
		c.right.push({ same: none[1] / n, opp: none[0] / n });
		c.pooled.push({ same: (none[0] + none[1]) / (2 * n), opp: (none[0] + none[1]) / (2 * n) });
		for (var i = 1; i < K; i++) {
			c.left.push({ same: left[i][0] / n, opp: left[i][1] / n });
			c.right.push({ same: right[i][0] / n, opp: right[i][1] / n });
			c.pooled.push({ same: (left[i][0] + right[i][0]) / (2 * n), opp: (left[i][1] + right[i][1]) / (2 * n) });
		}
		return c;
	}
	function eyeProbs(eye, i) { var p = small[eye][i]; return [p.same, p.opp, p.none]; }
	var noneObs = [small.left[0].same, small.left[0].opp, small.left[0].none]; // left eye: same = left choice
	function marketsFor(curve, mode) {
		var fn = M.makeCurve(curve, mode);
		var F = flyFreq(fn, rm);
		var thr = M.quantile(rm.abs, 1 - F);
		var fly = summarizeRows(runSeeds({ fraction: FRACTION, type: 'fly', ref: rm.ref, curveFn: fn }));
		var rule = summarizeRows(runSeeds({ fraction: FRACTION, type: 'rule', threshold: thr }));
		return { F: F, thrOverRef: thr / rm.ref, fly: fly, rule: rule };
	}
	var observed = {
		perEye: marketsFor(small, 'perEye'),
		pooled: marketsFor(small, 'pooled')
	};
	var rows = [];
	for (var b = 0; b < B; b++) {
		var none = multinomial(rng, n, noneObs);
		var left = [null], right = [null];
		for (var i = 1; i < K; i++) { left.push(multinomial(rng, n, eyeProbs('left', i))); right.push(multinomial(rng, n, eyeProbs('right', i))); }
		var curve = curveFrom(left, right, none);
		// asymmetry: mean (left - right) same-direction probability over intensities 0.2 .. 0.7
		var asym = 0, na = 0;
		for (var i = 1; i < K; i++) if (curve.intensities[i] >= 0.2 && curve.intensities[i] <= 0.7) { asym += curve.left[i].same - curve.right[i].same; na++; }
		['perEye', 'pooled'].forEach(function (mode) {
			var r = marketsFor(curve, mode);
			rows.push({ mode: mode, b: b, upper: curve.pooled[K - 1].same, upperL: curve.left[K - 1].same, upperR: curve.right[K - 1].same,
				asym: asym / na, F: r.F, thrOverRef: r.thrOverRef, flyRunaway: r.fly.runaway, flyUp: r.fly.up, ruleRunaway: r.rule.runaway });
		});
		if ((b + 1) % 50 === 0) console.log('bootstrap ' + (b + 1) + '/' + B);
	}
	var csv = ['mode,bootstrap,upper_pooled,upper_left,upper_right,asym_left_minus_right,fly_trade_freq,rule_threshold_over_ref,fly_runaway,fly_runaway_up,rule_runaway'];
	rows.forEach(function (r) {
		csv.push([r.mode, r.b, r.upper.toFixed(4), r.upperL.toFixed(4), r.upperR.toFixed(4), r.asym.toFixed(4), r.F.toFixed(4), r.thrOverRef.toFixed(4),
			r.flyRunaway, r.flyUp, r.ruleRunaway].join(','));
	});
	fs.writeFileSync(path.join(OUT, 'bootstrap.csv'), csv.join('\n') + '\n');

	function corr(xs, ys) {
		var mx = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length, my = ys.reduce(function (a, b) { return a + b; }, 0) / ys.length;
		var sxy = 0, sxx = 0, syy = 0;
		for (var i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); syy += (ys[i] - my) * (ys[i] - my); }
		return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
	}
	function fc(x) { return x === null ? '-' : x.toFixed(2); }
	var summary = {};
	var md = ['# [탐색] 30회 곡선의 불확실성: 부트스트랩 ' + B + '회 (추세 반응 투자자 50%, 기본 설정)', '',
		'방법: 30회 곡선의 각 (눈, 세기) 칸마다 관측 비율(같은 방향·반대 방향·무반응)로 30회를 다시 뽑아(이항분포를 세 결과로 넓힌 다항분포) 새 곡선을 만들고,',
		'그 곡선으로 (a) 초파리 시장을 시드 50개로 돌림. (c) 문턱 규칙도 새 곡선의 거래 빈도에 문턱을 다시 맞춰 같이 돌림. 난수 시드 ' + BOOT_SEED + '.',
		'- **좌우 따로**: 사전 계획처럼 눈마다 따로 다시 뽑은 곡선을 씀(요청한 분석).',
		'- **좌우 합침**: 같은 다시 뽑기 결과에서 좌우를 합친 곡선을 두 눈 모두에 씀(보조 분석; 좌우 비대칭을 없앤 경우).', '',
		'| 곡선 사용 방식 | 원래 곡선의 (a) 폭주 | 부트스트랩 (a) 폭주: 중앙값 [95% 범위] | (c) 폭주: 중앙값 [95% 범위] | (a) < (c)인 비율 | (a) 폭주 중 위쪽 비율 | 상한과 (a) 폭주의 상관 | 좌우 비대칭과 (a) 위쪽 폭주 수의 상관 |',
		'|---|---:|---|---|---:|---:|---:|---:|'];
	['perEye', 'pooled'].forEach(function (mode) {
		var rs = rows.filter(function (r) { return r.mode === mode; });
		var fr = rs.map(function (r) { return r.flyRunaway; }), rr = rs.map(function (r) { return r.ruleRunaway; });
		var ups = rs.reduce(function (a, r) { return a + r.flyUp; }, 0), runs = rs.reduce(function (a, r) { return a + r.flyRunaway; }, 0);
		var s = {
			observedFly: observed[mode].fly.runaway, observedFlyUp: observed[mode].fly.up, observedRule: observed[mode].rule.runaway,
			fly: { median: median(fr), lo: sortedQ(fr, 0.025), hi: sortedQ(fr, 0.975), min: Math.min.apply(null, fr), max: Math.max.apply(null, fr) },
			rule: { median: median(rr), lo: sortedQ(rr, 0.025), hi: sortedQ(rr, 0.975) },
			flyBelowRule: rs.filter(function (r) { return r.flyRunaway < r.ruleRunaway; }).length / rs.length,
			upShare: runs ? ups / runs : null,
			corrUpper: corr(rs.map(function (r) { return r.upper; }), fr),
			corrAsymUp: corr(rs.map(function (r) { return r.asym; }), rs.map(function (r) { return r.flyUp - (r.flyRunaway - r.flyUp); })),
			upper: { median: median(rs.map(function (r) { return r.upper; })), lo: sortedQ(rs.map(function (r) { return r.upper; }), 0.025), hi: sortedQ(rs.map(function (r) { return r.upper; }), 0.975) },
			hist: fr
		};
		summary[mode] = s;
		function q(x) { return (Math.round(x * 10) / 10).toString(); }
		md.push('| ' + (mode === 'perEye' ? '좌우 따로 (요청)' : '좌우 합침 (보조)') + ' | ' + s.observedFly + '/50 | **' + q(s.fly.median) + '** [' + q(s.fly.lo) + ', ' + q(s.fly.hi) + '] | ' +
			q(s.rule.median) + ' [' + q(s.rule.lo) + ', ' + q(s.rule.hi) + '] | ' + pct(s.flyBelowRule) + ' | ' + (s.upShare === null ? '-' : pct(s.upShare)) + ' | ' +
			fc(s.corrUpper) + ' | ' + (mode === 'perEye' ? fc(s.corrAsymUp) : '-') + ' |');
	});
	md.push('', '- 다시 뽑은 곡선의 상한(세기 1, 좌우 합침) 중앙값 ' + pct(summary.perEye.upper.median) + ' [95% 범위 ' + pct(summary.perEye.upper.lo) + ', ' + pct(summary.perEye.upper.hi) + '].');
	md.push('- "좌우 비대칭" = 세기 0.2~0.7에서 (왼쪽 눈 − 오른쪽 눈) 같은 방향 확률의 평균. "위쪽 폭주 수" = 위쪽 − 아래쪽 폭주 시드 수.');
	md.push('- 한계: 관측에서 0회였던 칸(예: 세기 0.2 이상의 반대 방향)은 다시 뽑아도 계속 0이다(모수적 부트스트랩의 성질). 원래 시행의 시드 공유(세기끼리 같은 시드)도 반영하지 못한다.');
	fs.writeFileSync(path.join(OUT, 'bootstrap.md'), md.join('\n') + '\n');
	return summary;
}

/* ---------- figures ---------- */

function figures(sweep, boot, noPng) {
	var C = fig.COLORS;
	var panels = [
		['runaway', '가격 폭주한 시드 수 (50개 중)', function (s) { return { m: s.runaway, lo: 50 * s.runawayCI[0], hi: 50 * s.runawayCI[1] }; }, [0, 52], function (v) { return v.toFixed(0); }],
		['volatility', '변동성 (수익률 표준편차 ×1000)', function (s) { return { m: 1000 * s.volatility.mean, lo: 1000 * s.volatility.lo, hi: 1000 * s.volatility.hi }; }, null, function (v) { return v.toFixed(1); }],
		['maxDrawdown', '최대 낙폭', function (s) { return { m: 100 * s.maxDrawdown.mean, lo: 100 * s.maxDrawdown.lo, hi: 100 * s.maxDrawdown.hi }; }, null, function (v) { return v.toFixed(0) + '%'; }],
		['acfR1', '수익률 자기상관 ACF(r,1)', function (s) { return { m: s.acfR1.mean, lo: s.acfR1.lo, hi: s.acfR1.hi }; }, null, function (v) { return v.toFixed(2); }]
	];
	var marks = [{ x: sweep.flies[0].x, label: '30회 곡선 상한 ' + pct(sweep.flies[0].x) }, { x: sweep.flies[2].x, label: '큰 표본 상한 ' + pct(sweep.flies[2].x) }];
	var body = '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px">' + panels.map(function (pn) {
		var pts = sweep.rows.map(function (r) { var v = pn[2](r.s); v.x = r.p; return v; });
		var fl = sweep.flies.map(function (f, i) { var v = pn[2](f.s); v.x = f.x + (i === 1 ? 0.018 : 0); v.f = f; return v; });
		var lo = Infinity, hi = -Infinity;
		pts.concat(fl).forEach(function (v) { lo = Math.min(lo, v.lo); hi = Math.max(hi, v.hi); });
		if (pn[3]) { lo = pn[3][0]; hi = pn[3][1]; } else { lo = Math.min(lo, 0); var pad = (hi - lo) * 0.08; hi += pad; }
		var f = fig.frame(530, 290, 0.08, 1.05, lo, hi, { title: pn[1], yTicks: fig.niceTicks(lo, hi, 5), yFmt: pn[4],
			xTicks: [0.15, 0.3, 0.45, 0.63, 0.8, 1], xFmt: function (v) { return v.toFixed(2); }, xLabel: '문턱을 넘을 때 거래할 확률 p' });
		var s = [];
		marks.forEach(function (mk, i) {
			s.push('<line x1="' + f.X(mk.x) + '" x2="' + f.X(mk.x) + '" y1="' + f.Y(hi) + '" y2="' + f.Y(lo) + '" stroke="#52514e" stroke-width="1.2" stroke-dasharray="4 4"/>');
			s.push('<text x="' + (f.X(mk.x) + (i === 0 ? 4 : -4)) + '" y="' + (f.Y(hi) + 11) + '" text-anchor="' + (i === 0 ? 'start' : 'end') + '">' + fig.esc(mk.label) + '</text>');
		});
		s.push('<polyline fill="none" stroke="' + C.rule + '" stroke-width="2" points="' + pts.map(function (v) { return f.X(v.x) + ',' + f.Y(v.m); }).join(' ') + '"/>');
		pts.forEach(function (v) {
			s.push('<line x1="' + f.X(v.x) + '" x2="' + f.X(v.x) + '" y1="' + f.Y(v.lo) + '" y2="' + f.Y(v.hi) + '" stroke="' + C.rule + '" stroke-width="1.5"/>');
			s.push('<circle cx="' + f.X(v.x) + '" cy="' + f.Y(v.m) + '" r="4.5" fill="' + C.rule + '" stroke="#fcfcfb" stroke-width="2"><title>p = ' + v.x + ': ' + pn[4](v.m) +
				' [' + pn[4](v.lo) + ', ' + pn[4](v.hi) + ']</title></circle>');
		});
		fl.forEach(function (v) {
			var X = f.X(v.x), Y = f.Y(v.m), t = '<title>' + fig.esc(v.f.label) + ' (상한 ' + pct(v.f.x, 1) + '): ' + pn[4](v.m) + ' [' + pn[4](v.lo) + ', ' + pn[4](v.hi) + ']</title>';
			s.push('<line x1="' + X + '" x2="' + X + '" y1="' + f.Y(v.lo) + '" y2="' + f.Y(v.hi) + '" stroke="' + C.fly + '" stroke-width="1.5"/>');
			if (v.f.shape === 'diamond') s.push('<polygon points="' + X + ',' + (Y - 7) + ' ' + (X + 7) + ',' + Y + ' ' + X + ',' + (Y + 7) + ' ' + (X - 7) + ',' + Y + '" fill="' + C.fly + '" stroke="#fcfcfb" stroke-width="2">' + t + '</polygon>');
			else if (v.f.shape === 'ring') s.push('<circle cx="' + X + '" cy="' + Y + '" r="5.5" fill="#fcfcfb" stroke="' + C.fly + '" stroke-width="2.5">' + t + '</circle>');
			else s.push('<rect x="' + (X - 5.5) + '" y="' + (Y - 5.5) + '" width="11" height="11" rx="2" fill="' + C.fly + '" stroke="#fcfcfb" stroke-width="2">' + t + '</rect>');
		});
		return fig.svg(f, s);
	}).join('') + '</div>';
	var html = fig.page('반응 확률 p와 시장 불안정성', '추세 반응 투자자 50%, 기본 설정(λ ' + CFG.base.lambda + ', σ ' + CFG.base.sigma + '), 시드 50개 평균과 95% 신뢰구간. 초록 = "문턱(' +
		sweep.threshold.toExponential(2) + ', 사전 계획 (c)와 같음)을 넘으면 확률 p로 거래"하는 규칙(p = 1이 (c)). 파랑 = 같은 시장의 초파리 (a)를 그 곡선의 상한(세기 1의 같은 방향 확률) 위치에 표시. ' +
		'초파리는 문턱 대신 완만한 곡선으로 반응하므로 초록 선 위에 정확히 놓일 필요는 없음. ○는 ◆와 겹치지 않게 조금 오른쪽으로 밀었음.', body,
		[{ color: C.rule, label: '확률 p 문턱 규칙' }, { color: C.fly, label: '◆ (a) 30회 곡선·좌우 따로(사전 계획)  ○ 30회 곡선·좌우 합침  ■ 큰 표본 곡선' },
			{ color: '#52514e', label: '측정한 곡선의 상한', dash: true }]);
	fs.writeFileSync(path.join(OUT, 'p-sweep.html'), html);

	// bootstrap histograms
	var body2 = '<div style="display:flex;gap:16px">' + ['perEye', 'pooled'].map(function (mode) {
		var s = boot[mode], counts = new Array(51).fill(0);
		s.hist.forEach(function (v) { counts[v]++; });
		var ymax = Math.max.apply(null, counts);
		var f = fig.frame(520, 300, -1, 51, 0, ymax * 1.15, { title: mode === 'perEye' ? '좌우 따로 다시 뽑은 곡선 (요청 분석)' : '좌우 합친 곡선 (보조 분석)',
			yTicks: fig.niceTicks(0, ymax * 1.15, 4), xTicks: [0, 10, 20, 30, 40, 50], xLabel: '(a) 초파리 시장의 폭주 시드 수 (50개 중)' });
		var w = (f.X(1) - f.X(0)) - 1.5, el = [];
		el.push('<rect x="' + f.X(s.fly.lo - 0.5) + '" y="' + f.Y(ymax * 1.15) + '" width="' + (f.X(s.fly.hi + 0.5) - f.X(s.fly.lo - 0.5)) + '" height="' + (f.Y(0) - f.Y(ymax * 1.15)) + '" fill="' + C.fly + '" fill-opacity="0.08"/>');
		counts.forEach(function (c, k) {
			if (!c) return;
			el.push('<rect x="' + (f.X(k) - w / 2) + '" y="' + f.Y(c) + '" width="' + w + '" height="' + (f.Y(0) - f.Y(c)) + '" rx="2" fill="' + C.fly + '"><title>폭주 ' + k + '개: 부트스트랩 ' + c + '회</title></rect>');
		});
		el.push('<line x1="' + f.X(s.rule.median) + '" x2="' + f.X(s.rule.median) + '" y1="' + f.Y(0) + '" y2="' + f.Y(ymax * 1.15) + '" stroke="' + C.rule + '" stroke-width="2.5"/>');
		el.push('<text x="' + (f.X(s.rule.median) - 5) + '" y="' + (f.Y(ymax * 1.15) + 24) + '" text-anchor="end">(c) 규칙 중앙값 ' + s.rule.median + '</text>');
		el.push('<text x="' + f.X(s.fly.lo) + '" y="' + (f.Y(ymax * 1.15) + 11) + '">(a) 95% 범위 ' + s.fly.lo.toFixed(1) + '~' + s.fly.hi.toFixed(1) + ', 중앙값 ' + s.fly.median + '</text>');
		return fig.svg(f, el);
	}).join('') + '</div>';
	var html2 = fig.page('30회 곡선을 다시 뽑았을 때 초파리 시장의 폭주 수', '부트스트랩 ' + boot.perEye.hist.length + '회, 추세 반응 투자자 50%, 기본 설정. 막대 = 부트스트랩 곡선마다 (a) 초파리 시장에서 폭주한 시드 수의 분포, 옅은 띠 = 95% 범위. 초록 선 = 같은 곡선에 문턱을 다시 맞춘 (c) 문턱 규칙의 폭주 수 중앙값.', body2,
		[{ color: C.fly, label: '(a) 초파리 시장' }, { color: C.rule, label: '(c) 문턱 규칙 중앙값' }]);
	fs.writeFileSync(path.join(OUT, 'bootstrap.html'), html2);
	return noPng ? Promise.resolve() : fig.screenshots(['p-sweep', 'bootstrap'], OUT);
}

function main() {
	var args = process.argv.slice(2);
	var B = args.indexOf('--bootstrap') >= 0 ? +args[args.indexOf('--bootstrap') + 1] : 200;
	fs.mkdirSync(OUT, { recursive: true });
	var big = buildBigCurve();
	console.log('(1) big-sample curve: ' + big.settings.trials + ' trials; running run-market.js');
	childProcess.execFileSync(process.execPath, [path.join(__dirname, 'run-market.js'), '--config', BIG_CONFIG], { stdio: ['ignore', 'ignore', 'inherit'] });
	var sources = compare();
	var rm = randomMarketReturns();
	console.log('(2) p sweep');
	var sweep = pSweep(rm, sources, big);
	console.log('(3) bootstrap x ' + B);
	var boot = bootstrap(rm, B);
	figures(sweep, boot, args.indexOf('--no-png') >= 0).then(function () {
		['big-curve.md', 'compare.md', 'p-sweep.md', 'bootstrap.md'].forEach(function (f) { console.log('\n' + fs.readFileSync(path.join(OUT, f), 'utf8')); });
	}).catch(function (e) { console.error(e); process.exit(1); });
}

main();
