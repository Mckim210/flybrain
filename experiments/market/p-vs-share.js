#!/usr/bin/env node
/* p-vs-share.js — [exploratory] is "reacting with probability p" the same as "fewer trend investors"?
 *
 *   node experiments/market/p-vs-share.js
 *
 * No brain simulation. Base setting (lambda 0.02, sigma 0.003), the pre-registered
 * (c) threshold from results/market/summary.json, 50 seeds, as robustness.js:
 *   soft   50% trend investors; when |r| > threshold each trades in the direction
 *          of r with probability p (robustness.js p-sweep)
 *   share  round(500 x 0.5 x p) trend investors that always trade when |r| > threshold
 * Both have the same expected trend order flow. Runs with the same seed share the
 * news shocks and the random investors' decisions (separate random streams), so
 * the two markets are compared seed by seed.
 * Writes experiments/market/results/p-vs-share/table.md and table.csv.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var M = require('./lib/market-model.js');
var stats = require('../lib/stats.js');

var CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
var BASE_KEY = 'L' + CFG.base.lambda + '_S' + CFG.base.sigma;
var SUMMARY = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'market', 'summary.json'), 'utf8'));
var THRESHOLD = SUMMARY.calibration[BASE_KEY].byMultiplier['1'].threshold;
var FRACTION = 0.5;
var P_VALUES = [1.0, 0.8, 0.7, 0.63, 0.55, 0.45, 0.3, 0.15];
var OUT = path.join(__dirname, 'results', 'p-vs-share');

function runSeeds(o) {
	var rows = [];
	for (var seed = 1; seed <= CFG.seeds; seed++) {
		var res = M.run(Object.assign({ investors: CFG.investors, steps: CFG.steps, lambda: CFG.base.lambda, sigma: CFG.base.sigma,
			pBuy: CFG.random.pBuy, pSell: CFG.random.pSell, seed: seed, threshold: THRESHOLD }, o));
		var m = M.runMetrics(res, CFG.runawayLogMove);
		m.trade = res.trendTradeShare;
		rows.push(m);
	}
	return rows;
}

function summarize(rows) {
	var run = rows.filter(function (r) { return r.runaway; });
	var out = { runaway: run.length, up: run.filter(function (r) { return r.runawayDir > 0; }).length };
	['volatility', 'maxDrawdown', 'acfR1'].forEach(function (k) { out[k] = stats.meanCIz(rows.map(function (r) { return r[k]; })); });
	return out;
}

function main() {
	var lines = [], csv = ['p,soft_trend_investors,share_trend_investors,soft_runaway,soft_up,share_runaway,share_up,runaway_status_differs,' +
		'soft_volatility,share_volatility,volatility_diff_mean,volatility_diff_lo,volatility_diff_hi,soft_max_drawdown,share_max_drawdown,soft_acf_r1,share_acf_r1'];
	var nTrendSoft = Math.round(FRACTION * CFG.investors);
	P_VALUES.forEach(function (p) {
		var softRows = runSeeds({ fraction: FRACTION, type: 'ruleSoft', softProb: p });
		var shareFraction = FRACTION * p;
		var shareRows = runSeeds({ fraction: shareFraction, type: 'rule' });
		var s = summarize(softRows), h = summarize(shareRows);
		var differs = softRows.filter(function (r, i) { return r.runaway !== shareRows[i].runaway; }).length;
		var dv = stats.meanCIz(softRows.map(function (r, i) { return r.volatility - shareRows[i].volatility; }));
		var nShare = Math.round(shareFraction * CFG.investors);
		lines.push({ p: p, nShare: nShare, s: s, h: h, differs: differs, dv: dv });
		csv.push([p, nTrendSoft, nShare, s.runaway, s.up, h.runaway, h.up, differs,
			s.volatility.mean, h.volatility.mean, dv.mean, dv.lo, dv.hi, s.maxDrawdown.mean, h.maxDrawdown.mean, s.acfR1.mean, h.acfR1.mean]
			.map(function (x) { return typeof x === 'number' && !Number.isInteger(x) ? +x.toPrecision(5) : x; }).join(','));
	});

	// p = 1 must reproduce the pre-registered threshold rule (c) at 50%
	var c50 = SUMMARY.conditions.filter(function (c) { return c.key === BASE_KEY && c.type === 'rule' && c.fraction === FRACTION && c.refMult === 1; })[0];
	var p1 = lines[0].s;
	var reproduced = p1.runaway === c50.summary.runaway.count && Math.abs(p1.volatility.mean - c50.summary.volatility.mean) < 1e-12;
	if (!reproduced) throw new Error('p = 1 does not reproduce the pre-registered rule market at 50%');

	function v(x) { return (1000 * x.mean).toFixed(2); }
	function pc(x) { return (100 * x.mean).toFixed(1) + '%'; }
	var md = ['# [탐색] 반응 확률 p = 추세 투자자 수를 줄인 것과 같은가', '',
		'사전 계획에 없던 분석(뇌 시뮬레이션 없음). 기본 설정(λ ' + CFG.base.lambda + ', σ ' + CFG.base.sigma + '), 투자자 ' + CFG.investors + '명, ' +
		CFG.steps + '단계, 시드 ' + CFG.seeds + '개. 문턱은 사전 계획 (c)의 값 ' + THRESHOLD.toExponential(3) + '.', '',
		'- **확률 반응**: 추세 반응 투자자 ' + nTrendSoft + '명(50%)이 |r| > 문턱일 때 각자 확률 p로 수익률 방향 거래 (`robustness.js`의 p 실험과 같음)',
		'- **인원 축소**: 추세 반응 투자자 round(' + CFG.investors + ' × 0.5 × p)명이 |r| > 문턱일 때 항상 거래 (기대 주문 수가 같음)',
		'- 같은 시드는 뉴스 충격과 무작위 투자자의 결정을 공유하므로 시드별로 짝지어 비교. p = 1은 사전 계획 (c) 50% 시장을 그대로 재현함(확인).', '',
		'| p | 인원 축소 (명) | 폭주: 확률 반응 / 인원 축소 (위쪽) | 폭주 여부가 다른 시드 | 변동성 ×1000: 확률 / 축소 | 짝지은 변동성 차이 ×1000 [95% CI] | 최대 낙폭: 확률 / 축소 | ACF(r,1): 확률 / 축소 |',
		'|---|---:|---|---:|---|---|---|---|'];
	lines.forEach(function (l) {
		md.push('| ' + l.p + ' | ' + l.nShare + ' | ' + l.s.runaway + ' / ' + l.h.runaway + ' (' + l.s.up + ' / ' + l.h.up + ') | ' + l.differs + ' | ' +
			v(l.s.volatility) + ' / ' + v(l.h.volatility) + ' | ' + (1000 * l.dv.mean).toFixed(3) + ' [' + (1000 * l.dv.lo).toFixed(3) + ', ' + (1000 * l.dv.hi).toFixed(3) + '] | ' +
			pc(l.s.maxDrawdown) + ' / ' + pc(l.h.maxDrawdown) + ' | ' + l.s.acfR1.mean.toFixed(3) + ' / ' + l.h.acfR1.mean.toFixed(3) + ' |');
	});
	md.push('', '- 읽는 법: 두 시장의 폭주·변동성·낙폭·자기상관이 거의 같으면, 이 모형에서 "반응 확률 p"는 "추세 반응 투자자 수 × p"와 같은 효과다.',
		'  가격이 주문 수의 합(λ × (매수 − 매도) / N)으로만 움직이므로, 기대 주문 수가 같으면 남는 차이는 확률 반응의 표본 잡음뿐이다',
		'  (p = 0.63일 때 그 표준편차는 약 λ × √(250 × 0.63 × 0.37) / 500 ≈ 0.0003으로 뉴스 충격 σ = 0.003의 약 10%).',
		'- 한계: 단순한 모형의 성질이다. 투자자마다 문턱이 다르거나 기억이 있는 모형에서는 확률적 반응이 따로 효과를 낼 수 있다.',
		'- 인원 축소는 정수로 반올림(예: 157.5 → 158명).');
	fs.mkdirSync(OUT, { recursive: true });
	fs.writeFileSync(path.join(OUT, 'table.md'), md.join('\n') + '\n');
	fs.writeFileSync(path.join(OUT, 'table.csv'), csv.join('\n') + '\n');
	console.log(md.join('\n'));
}

main();
