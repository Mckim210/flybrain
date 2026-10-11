#!/usr/bin/env node
/* run-market.js — fly-trader market simulation (PLAN.md §2-§5)
 *
 *   node experiments/market/run-market.js [--config experiments/market/config.json]
 *
 * Needs the measured response curve (response-curve.js) first. No brain
 * simulation here: fly investors sample from the curve.
 * Writes experiments/market/results/<name>/: calibration.md, conditions.csv,
 * per-seed.csv, tables.md, verdict.md, btc.md, summary.json
 */
'use strict';

var fs = require('fs');
var path = require('path');
var M = require('./lib/market-model.js');
var stats = require('../lib/stats.js');
var marketLib = require('../lib/market.js');

var ROOT = path.join(__dirname, '..', '..');
var METRICS = ['volatility', 'maxDrawdown', 'maxRunup', 'acfR1', 'acfAbs1', 'acfAbs5', 'acfAbs10', 'kurtosis', 'maxRise', 'maxFall', 'runaway'];
var LABEL = {
	volatility: '변동성', maxDrawdown: '최대 낙폭', maxRunup: '최대 상승폭', acfR1: 'ACF(r,1)', acfAbs1: 'ACF(|r|,1)',
	acfAbs5: 'ACF(|r|,5)', acfAbs10: 'ACF(|r|,10)', kurtosis: '초과첨도', maxRise: '최대 1단계 급등', maxFall: '최대 1단계 급락', runaway: '폭주 시드'
};
var TYPE_LABEL = { random: '무작위만', fly: '(a) 초파리', flyRev: '(b) 초파리 역발상', rule: '(c) 문턱 규칙', ruleRev: '(d) 역발상 규칙(참고)' };
var SHAPE = ['kurtosis', 'acfR1', 'acfAbs1', 'acfAbs5', 'acfAbs10'];

function settingKey(s) { return 'L' + s.lambda + '_S' + s.sigma; }

function summarize(rows) {
	var out = {};
	METRICS.forEach(function (m) {
		var xs = rows.map(function (r) { return r[m]; });
		if (m === 'runaway') {
			var k = xs.reduce(function (a, b) { return a + b; }, 0), w = stats.wilson(k, xs.length);
			out[m] = { n: xs.length, mean: k / xs.length, count: k, lo: w[0], hi: w[1] };
		} else out[m] = stats.meanCI(xs);
	});
	return out;
}

function main() {
	var args = {};
	for (var i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
	var cfgFile = args.config || path.join(__dirname, 'config.json');
	var cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
	var outDir = path.join(__dirname, 'results', cfg.name);
	fs.mkdirSync(outDir, { recursive: true });
	var curve = JSON.parse(fs.readFileSync(path.resolve(ROOT, cfg.curve), 'utf8'));
	var curveFn = M.makeCurve(curve);

	var settings = [cfg.base];
	cfg.sensitivity.lambda.forEach(function (l) { settings.push({ lambda: l, sigma: cfg.base.sigma }); });
	cfg.sensitivity.sigma.forEach(function (s) { settings.push({ lambda: cfg.base.lambda, sigma: s }); });
	var seen = {};
	settings = settings.filter(function (s) { var k = settingKey(s); if (seen[k]) return false; seen[k] = 1; return true; });

	function runCondition(setting, type, fraction, ref, threshold) {
		var rows = [], trade = [], returns = [];
		for (var seed = 1; seed <= cfg.seeds; seed++) {
			var res = M.run({ investors: cfg.investors, steps: cfg.steps, lambda: setting.lambda, sigma: setting.sigma,
				fraction: fraction, type: type, ref: ref, threshold: threshold, curveFn: curveFn,
				pBuy: cfg.random.pBuy, pSell: cfg.random.pSell, seed: seed });
			var m = M.runMetrics(res, cfg.runawayLogMove);
			m.seed = seed;
			rows.push(m);
			if (res.trendTradeShare !== null) trade.push(res.trendTradeShare);
			if (seed <= 3) m.path = Array.prototype.slice.call(res.logP); // a few example paths for figures
			returns.push(res.returns);
		}
		return { rows: rows, returns: returns, trendTradeShare: trade.length ? trade.reduce(function (a, b) { return a + b; }, 0) / trade.length : null };
	}

	var conds = [], calib = {};
	settings.forEach(function (st) {
		var key = settingKey(st);
		var isBase = key === settingKey(cfg.base);
		// random-only market: calibration source and the 0% condition
		var rnd = runCondition(st, 'random', 0, 1, Infinity);
		var pooled = [].concat.apply([], rnd.returns);
		var absSorted = pooled.map(Math.abs).sort(function (a, b) { return a - b; });
		var ref0 = M.quantile(absSorted, cfg.refQuantile);
		calib[key] = { lambda: st.lambda, sigma: st.sigma, randomSd: M.sd(pooled), ref: ref0, byMultiplier: {} };
		conds.push({ setting: st, key: key, type: 'random', fraction: 0, refMult: null, res: rnd });

		var mults = isBase ? cfg.refMultipliers : [1];
		var fracs = isBase ? cfg.fractions : [cfg.sensitivity.fraction];
		mults.forEach(function (mult) {
			var ref = ref0 * mult;
			function freq(rev) {
				var s = 0;
				for (var i = 0; i < pooled.length; i++) { var p = M.flyProbs(curveFn, pooled[i], ref, rev); s += p.buy + p.sell; }
				return s / pooled.length;
			}
			var F = freq(false), Frev = freq(true);
			var threshold = M.quantile(absSorted, 1 - F);
			calib[key].byMultiplier[mult] = { ref: ref, flyTradeFreq: F, flyRevTradeFreq: Frev, threshold: threshold,
				thresholdOverRef: threshold / ref, thresholdOverSd: threshold / calib[key].randomSd,
				ruleTradeFreqCheck: absSorted.filter(function (x) { return x > threshold; }).length / absSorted.length };
			fracs.forEach(function (f) {
				cfg.types.forEach(function (type) {
					conds.push({ setting: st, key: key, type: type, fraction: f, refMult: mult,
						res: runCondition(st, type, f, ref, threshold) });
				});
			});
		});
		console.log('setting ' + key + ': ref ' + ref0.toExponential(3) + ', ' + conds.length + ' conditions so far');
	});
	conds.forEach(function (c) { c.summary = summarize(c.res.rows); });

	/* ---- per-seed and per-condition CSV ---- */
	var ps = ['lambda,sigma,ref_mult,type,fraction,seed,' + METRICS.join(',') + ',max_abs_log_move,final_log_price'];
	conds.forEach(function (c) {
		c.res.rows.forEach(function (r) {
			ps.push([c.setting.lambda, c.setting.sigma, c.refMult === null ? '' : c.refMult, c.type, c.fraction, r.seed]
				.concat(METRICS.map(function (m) { return +r[m].toPrecision(6); }))
				.concat([+r.maxAbsLogMove.toPrecision(6), +r.finalLogPrice.toPrecision(6)]).join(','));
		});
	});
	fs.writeFileSync(path.join(outDir, 'per-seed.csv'), ps.join('\n') + '\n');
	var cc = ['lambda,sigma,ref_mult,type,fraction,trend_trade_share,' + METRICS.map(function (m) { return m + '_mean,' + m + '_lo,' + m + '_hi'; }).join(',')];
	conds.forEach(function (c) {
		cc.push([c.setting.lambda, c.setting.sigma, c.refMult === null ? '' : c.refMult, c.type, c.fraction,
			c.res.trendTradeShare === null ? '' : c.res.trendTradeShare.toFixed(4)]
			.concat(METRICS.map(function (m) { var s = c.summary[m]; return [s.mean, s.lo, s.hi].map(function (x) { return +x.toPrecision(5); }).join(','); })).join(','));
	});
	fs.writeFileSync(path.join(outDir, 'conditions.csv'), cc.join('\n') + '\n');

	/* ---- calibration ---- */
	var cm = ['# 기준값·문턱 맞추기 (무작위 투자자만 있는 시장, 시드 ' + cfg.seeds + '개 × ' + cfg.steps + '단계 합침)', '',
		'| λ | σ | 무작위 시장 수익률 표준편차 | 기준값 배율 | 기준값(|r| 90백분위 × 배율) | 초파리(a) 거래 빈도 | 역발상(b) 거래 빈도 | (c)·(d) 문턱 | 문턱/기준값 | 문턱으로 본 (c) 거래 빈도 |',
		'|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
	Object.keys(calib).forEach(function (k) {
		var c = calib[k];
		Object.keys(c.byMultiplier).forEach(function (m) {
			var b = c.byMultiplier[m];
			cm.push('| ' + c.lambda + ' | ' + c.sigma + ' | ' + c.randomSd.toExponential(3) + ' | ×' + m + ' | ' + b.ref.toExponential(3) + ' | ' +
				(100 * b.flyTradeFreq).toFixed(1) + '% | ' + (100 * b.flyRevTradeFreq).toFixed(1) + '% | ' + b.threshold.toExponential(3) + ' | ' +
				b.thresholdOverRef.toFixed(2) + ' | ' + (100 * b.ruleTradeFreqCheck).toFixed(1) + '% |');
		});
	});
	fs.writeFileSync(path.join(outDir, 'calibration.md'), cm.join('\n') + '\n');

	/* ---- tables ---- */
	function fmt(m, s) {
		if (m === 'runaway') return s.count + '/' + s.n;
		var d = Math.abs(s.mean) >= 100 ? 0 : 3;
		function f(x) {
			if (m === 'volatility' || m === 'maxRise' || m === 'maxFall') return (x * 1000).toFixed(2);
			if (m === 'maxDrawdown' || m === 'maxRunup') return Math.abs(x) >= 100 ? x.toExponential(1) : (100 * x).toFixed(1) + '%';
			return x.toFixed(d === 0 ? 1 : 3);
		}
		return f(s.mean) + ' [' + f(s.lo) + ', ' + f(s.hi) + ']';
	}
	function findCond(key, type, fraction, mult) {
		return conds.filter(function (c) {
			return c.key === key && c.type === type && c.fraction === fraction && (type === 'random' || c.refMult === mult);
		})[0];
	}
	var baseKey = settingKey(cfg.base);
	var tb = ['# 시장 시뮬레이션 결과표', '',
		'시드 ' + cfg.seeds + '개의 평균 [95% 신뢰구간]. 변동성·급등·급락은 ×1000(로그수익률 단위). 폭주 = |ln(P_t/P_0)| ≥ ' + cfg.runawayLogMove + '인 시드 수.',
		'추세 투자자 거래율 = 추세 투자자가 한 단계에서 매수·매도한 비율(시장 안에서 실제로 나온 값).', ''];
	function tableFor(key, mult, fractions, title) {
		tb.push('## ' + title, '');
		tb.push('| 구성 | 비율 | 추세 투자자 거래율 | ' + METRICS.map(function (m) { return LABEL[m]; }).join(' | ') + ' |');
		tb.push('|---|---:|---:|' + METRICS.map(function () { return '---'; }).join('|') + '|');
		var r0 = findCond(key, 'random', 0);
		tb.push('| 무작위만 | 0% | - | ' + METRICS.map(function (m) { return fmt(m, r0.summary[m]); }).join(' | ') + ' |');
		fractions.forEach(function (f) {
			cfg.types.forEach(function (type) {
				var c = findCond(key, type, f, mult);
				tb.push('| ' + TYPE_LABEL[type] + ' | ' + (100 * f) + '% | ' + (100 * c.res.trendTradeShare).toFixed(1) + '% | ' +
					METRICS.map(function (m) { return fmt(m, c.summary[m]); }).join(' | ') + ' |');
			});
		});
		tb.push('');
	}
	cfg.refMultipliers.forEach(function (mult) {
		tableFor(baseKey, mult, cfg.fractions, '기본 설정 (λ ' + cfg.base.lambda + ', σ ' + cfg.base.sigma + '), 기준값 ×' + mult);
	});
	settings.forEach(function (st) {
		var k = settingKey(st);
		if (k === baseKey) return;
		tableFor(k, 1, [cfg.sensitivity.fraction], '민감도: λ ' + st.lambda + ', σ ' + st.sigma + ' (기준값 ×1)');
	});
	fs.writeFileSync(path.join(outDir, 'tables.md'), tb.join('\n') + '\n');

	/* ---- verdicts (PLAN.md §4) ---- */
	function compare(A, B) {
		var differ = METRICS.filter(function (m) {
			var a = A.summary[m], b = B.summary[m];
			return a.hi < b.lo || b.hi < a.lo;
		});
		var verdict = differ.length >= 2 ? '다르다' : (differ.length === 1 ? '약한 차이(우연 가능)' : '구별되지 않음');
		var paired = {};
		METRICS.forEach(function (m) {
			paired[m] = stats.meanCI(A.res.rows.map(function (r, i) { return r[m] - B.res.rows[i][m]; }));
		});
		return { differ: differ, verdict: verdict, paired: paired };
	}
	var verdicts = [];
	function addVerdicts(key, mult, f, label) {
		var a = findCond(key, 'fly', f, mult);
		[['rule', '(a) vs (c)'], ['flyRev', '(a) vs (b)'], ['ruleRev', '(b) vs (d) 참고']].forEach(function (pr) {
			var A = pr[0] === 'ruleRev' ? findCond(key, 'flyRev', f, mult) : a;
			var B = findCond(key, pr[0], f, mult);
			var c = compare(A, B);
			verdicts.push({ label: label, key: key, refMult: mult, fraction: f, pair: pr[1], differ: c.differ, verdict: c.verdict, paired: c.paired,
				A: A.summary, B: B.summary });
		});
	}
	cfg.refMultipliers.forEach(function (mult) {
		cfg.fractions.forEach(function (f) { addVerdicts(baseKey, mult, f, '기본, 기준값 ×' + mult); });
	});
	settings.forEach(function (st) {
		var k = settingKey(st);
		if (k !== baseKey) addVerdicts(k, 1, cfg.sensitivity.fraction, 'λ ' + st.lambda + ', σ ' + st.sigma);
	});
	var vm = ['# 판정: 같은 비율에서 (a) 초파리와 (c) 문턱 규칙이 다른가 (PLAN.md 4절 기준)', '',
		'지표별로 95% 신뢰구간이 겹치지 않으면 "다름". 11개 지표 중 2개 이상 → 다르다, 1개 → 약한 차이, 0개 → 구별되지 않음.',
		'짝지은 차이 = 같은 시드끼리 (앞 − 뒤)의 평균 [95% CI] (보조 지표, 판정에는 안 씀).', ''];
	['(a) vs (c)', '(a) vs (b)', '(b) vs (d) 참고'].forEach(function (pair) {
		vm.push('## ' + pair, '');
		vm.push('| 설정 | 비율 | 판정 | 다른 지표 | 폭주 (앞/뒤) | 변동성×1000 (앞/뒤) | ACF(r,1) (앞/뒤) | 짝지은 차이: ACF(r,1) | 짝지은 차이: 변동성×1000 |');
		vm.push('|---|---:|---|---|---|---|---|---|---|');
		verdicts.filter(function (v) { return v.pair === pair; }).forEach(function (v) {
			function pci(s, k) { return (s.mean * k).toFixed(3) + ' [' + (s.lo * k).toFixed(3) + ', ' + (s.hi * k).toFixed(3) + ']'; }
			vm.push('| ' + v.label + ' | ' + (100 * v.fraction) + '% | **' + v.verdict + '** | ' +
				(v.differ.map(function (m) { return LABEL[m]; }).join(', ') || '-') + ' | ' +
				v.A.runaway.count + ' / ' + v.B.runaway.count + ' | ' +
				(1000 * v.A.volatility.mean).toFixed(2) + ' / ' + (1000 * v.B.volatility.mean).toFixed(2) + ' | ' +
				v.A.acfR1.mean.toFixed(3) + ' / ' + v.B.acfR1.mean.toFixed(3) + ' | ' + pci(v.paired.acfR1, 1) + ' | ' + pci(v.paired.volatility, 1000) + ' |');
		});
		vm.push('');
	});
	fs.writeFileSync(path.join(outDir, 'verdict.md'), vm.join('\n') + '\n');

	/* ---- real BTC (PLAN.md §5) ---- */
	var prices = marketLib.loadPrices(path.join(ROOT, cfg.btc.prices));
	var btcR = [];
	for (var i = 1; i < prices.length; i++) btcR.push(Math.log(prices[i].close / prices[i - 1].close));
	var L = cfg.btc.blockLength, blocks = [];
	for (var b = 0; (b + 1) * L <= btcR.length; b++) blocks.push(M.shapeMetrics(btcR.slice(b * L, (b + 1) * L)));
	var btcBlock = {}, btcFull = M.shapeMetrics(btcR);
	SHAPE.forEach(function (m) { btcBlock[m] = stats.meanCI(blocks.map(function (x) { return x[m]; })); });
	var cands = conds.filter(function (c) { return c.key === baseKey && (c.type === 'random' || c.refMult === 1); });
	cands.forEach(function (c) { c.ranks = {}; });
	SHAPE.forEach(function (m) {
		var sorted = cands.slice().sort(function (x, y) {
			return Math.abs(x.summary[m].mean - btcBlock[m].mean) - Math.abs(y.summary[m].mean - btcBlock[m].mean);
		});
		sorted.forEach(function (c, i) { c.ranks[m] = i + 1; });
	});
	cands.forEach(function (c) { c.avgRank = SHAPE.reduce(function (s, m) { return s + c.ranks[m]; }, 0) / SHAPE.length; });
	cands.sort(function (x, y) { return x.avgRank - y.avgRank; });
	var bm = ['# 실제 비트코인과 비교 (단위와 상관없는 지표)', '',
		'실제: `' + cfg.btc.prices + '` 종가의 1시간 로그수익률 ' + btcR.length + '개. 시뮬레이션과 길이를 맞추려고 겹치지 않는 ' + L + '개 묶음 ' + blocks.length +
		'개로 나눠 계산한 평균 [95% CI]. 시뮬레이션은 기본 설정(λ ' + cfg.base.lambda + ', σ ' + cfg.base.sigma + ', 기준값 ×1), 시드 ' + cfg.seeds + '개 평균.', '',
		'| 시장 | ' + SHAPE.map(function (m) { return LABEL[m]; }).join(' | ') + ' | 평균 순위 |',
		'|---|' + SHAPE.map(function () { return '---'; }).join('|') + '|---:|'];
	function sh(s) { return s.mean.toFixed(3) + ' [' + s.lo.toFixed(3) + ', ' + s.hi.toFixed(3) + ']'; }
	bm.push('| **실제 BTC (500시간 묶음)** | ' + SHAPE.map(function (m) { return '**' + sh(btcBlock[m]) + '**'; }).join(' | ') + ' | - |');
	bm.push('| 실제 BTC (전체 한 번에, 참고) | ' + SHAPE.map(function (m) { return btcFull[m].toFixed(3); }).join(' | ') + ' | - |');
	cands.forEach(function (c) {
		bm.push('| ' + TYPE_LABEL[c.type] + (c.type === 'random' ? '' : ' ' + (100 * c.fraction) + '%') + ' | ' +
			SHAPE.map(function (m) { return sh(c.summary[m]) + ' (' + c.ranks[m] + '위)'; }).join(' | ') + ' | ' + c.avgRank.toFixed(1) + ' |');
	});
	bm.push('', '- 평균 순위: 지표마다 |시장 평균 − 실제 BTC 묶음 평균|이 작은 순서로 1~' + cands.length + '위를 매기고 5개 지표의 순위를 평균(PLAN.md 5절).');
	bm.push('- 지표마다 실제 BTC 95% 신뢰구간 안에 든 시장: ' + SHAPE.map(function (m) {
		var inside = cands.filter(function (c) { return c.summary[m].mean >= btcBlock[m].lo && c.summary[m].mean <= btcBlock[m].hi; });
		return LABEL[m] + ' → ' + (inside.map(function (c) { return TYPE_LABEL[c.type] + (c.type === 'random' ? '' : ' ' + 100 * c.fraction + '%'); }).join(', ') || '없음');
	}).join('; '));
	fs.writeFileSync(path.join(outDir, 'btc.md'), bm.join('\n') + '\n');

	/* ---- summary.json (for figures) ---- */
	var summary = {
		config: cfg, calibration: calib,
		conditions: conds.map(function (c) {
			return { lambda: c.setting.lambda, sigma: c.setting.sigma, key: c.key, type: c.type, fraction: c.fraction, refMult: c.refMult,
				trendTradeShare: c.res.trendTradeShare, summary: c.summary, avgRankBtc: c.avgRank === undefined ? null : c.avgRank,
				examplePaths: c.res.rows.filter(function (r) { return r.path; }).map(function (r) { return { seed: r.seed, logP: r.path.map(function (x) { return +x.toFixed(5); }) }; }) };
		}),
		verdicts: verdicts.map(function (v) { return { label: v.label, key: v.key, refMult: v.refMult, fraction: v.fraction, pair: v.pair, verdict: v.verdict, differ: v.differ, paired: v.paired }; }),
		btc: { returns: btcR.length, blockLength: L, blocks: blocks.length, block: btcBlock, full: btcFull }
	};
	fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary) + '\n');
	console.log(vm.join('\n'));
	console.log(bm.join('\n'));
	console.log('결과 저장: ' + path.relative(process.cwd(), outDir));
}

main();
