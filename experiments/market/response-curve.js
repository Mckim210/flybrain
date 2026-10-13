#!/usr/bin/env node
/* response-curve.js — the fly's buy/sell/hold probabilities vs stimulus intensity
 *
 *   node experiments/market/response-curve.js            (run missing conditions, then report)
 *   node experiments/market/response-curve.js --only-report
 *
 * Trial settings are copied from the trade.js config (weightScale, VIS_R1R6,
 * warmup/window ticks, noise, readout), so one trial here is exactly one
 * trade.js decision. Every condition uses the same seeds (paired trials).
 * Writes experiments/market/results/response-curve/: runs/<cond>.json,
 * trials.csv, curve.json (used by the market simulation), table.md
 */
'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var childProcess = require('child_process');
var stats = require('../lib/stats.js');

var TRADE_CONFIG = path.join(__dirname, '..', 'config', 'trade-stonkfly-window-fixed1pct.json');
var OUT = path.join(__dirname, 'results', 'response-curve');
var INTENSITIES = [0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1.0];
var TRIALS = 30;
var SEED = 920000;

/* rough curve written in CLAUDE.md before this measurement (same / opposite / hold) */
var ROUGH = [
	{ label: '0~0.1', lo: 0, hi: 0.1, same: 0.05, opp: 0.04, hold: 0.91 },
	{ label: '0.2~0.3', lo: 0.2, hi: 0.3, same: 0.18, opp: 0.00, hold: 0.82 },
	{ label: '0.3~0.5', lo: 0.3, hi: 0.5, same: 0.32, opp: 0.00, hold: 0.68 },
	{ label: '0.5 이상', lo: 0.5, hi: 1.0, same: 0.45, opp: 0.00, hold: 0.55 }
];

function conditions() {
	var c = [{ id: 'none', side: 'none', intensity: 0 }];
	INTENSITIES.forEach(function (a) {
		['left', 'right'].forEach(function (s) { c.push({ id: s + '_' + a, side: s, intensity: a }); });
	});
	return c;
}

function trialConfig(fly, cond) {
	return {
		warmupTicks: fly.warmupTicks, windowTicks: fly.windowTicks, noise: fly.noise,
		weightScale: fly.weightScale, params: fly.params || null, readout: fly.readout,
		stimulus: cond.side === 'none' ? null : {
			groups: fly.stimulusGroups,
			left: cond.side === 'left' ? cond.intensity * fly.maxIntensity : 0,
			right: cond.side === 'right' ? cond.intensity * fly.maxIntensity : 0,
			balance: true
		}
	};
}

function worker(ids) {
	var HeadlessBrain = require('../lib/headless-sim.js').HeadlessBrain;
	var trial = require('../lib/choice-trial.js');
	var fly = JSON.parse(fs.readFileSync(TRADE_CONFIG, 'utf8')).fly;
	var brain = new HeadlessBrain();
	var out = trial.prepareReadout(brain, fly.readout);
	conditions().filter(function (c) { return ids.indexOf(c.id) >= 0; }).forEach(function (cond) {
		var file = path.join(OUT, 'runs', cond.id + '.json');
		if (fs.existsSync(file)) return;
		var tcfg = trialConfig(fly, cond);
		var trials = [];
		for (var i = 0; i < TRIALS; i++) {
			var r = trial.runTrial(brain, tcfg, out, SEED + i);
			trials.push({ i: i, seed: r.seed, choice: r.choice, reason: r.reason, d: r.d,
				spikesL: r.spikesL, spikesR: r.spikesR, totalSpikes: r.totalSpikes });
		}
		fs.writeFileSync(file, JSON.stringify({ condition: cond, trialConfig: tcfg, trials: trials }, null, 1) + '\n');
		console.log('done ' + cond.id);
	});
}

function runMissing() {
	fs.mkdirSync(path.join(OUT, 'runs'), { recursive: true });
	var missing = conditions().filter(function (c) {
		return !fs.existsSync(path.join(OUT, 'runs', c.id + '.json'));
	}).map(function (c) { return c.id; });
	if (!missing.length) return Promise.resolve();
	var n = Math.min(os.cpus().length, missing.length);
	console.log(missing.length + ' conditions x ' + TRIALS + ' trials on ' + n + ' processes');
	var jobs = [];
	for (var w = 0; w < n; w++) {
		var mine = missing.filter(function (_, i) { return i % n === w; });
		jobs.push(new Promise(function (resolve, reject) {
			var p = childProcess.spawn(process.execPath, [__filename, '--worker', mine.join(',')],
				{ stdio: ['ignore', 'inherit', 'inherit'] });
			p.on('close', function (code) { code === 0 ? resolve() : reject(new Error('worker exited ' + code)); });
		}));
	}
	return Promise.all(jobs);
}

function pct(x) { return (100 * x).toFixed(0) + '%'; }
function ci(k, n) { var w = stats.wilson(k, n); return pct(w[0]) + '~' + pct(w[1]); }

function report() {
	var runs = {};
	conditions().forEach(function (c) {
		runs[c.id] = JSON.parse(fs.readFileSync(path.join(OUT, 'runs', c.id + '.json'), 'utf8'));
	});
	var csv = ['condition,side,intensity,trial,seed,choice,reason,d,spikes_left,spikes_right,total_spikes'];
	conditions().forEach(function (c) {
		runs[c.id].trials.forEach(function (t) {
			csv.push([c.id, c.side, c.intensity, t.i, t.seed, t.choice, t.reason, t.d.toFixed(4), t.spikesL, t.spikesR, t.totalSpikes].join(','));
		});
	});
	fs.writeFileSync(path.join(OUT, 'trials.csv'), csv.join('\n') + '\n');

	function count(id, side) {
		var c = { left: 0, right: 0, none: 0 };
		runs[id].trials.forEach(function (t) { c[t.choice]++; });
		var n = runs[id].trials.length;
		var same = side === 'right' ? c.right : c.left, opp = side === 'right' ? c.left : c.right;
		return { n: n, same: same, opp: opp, none: c.none, left: c.left, right: c.right };
	}
	function probs(k) {
		return { same: k.same / k.n, opp: k.opp / k.n, none: k.none / k.n,
			sameCI: stats.wilson(k.same, k.n), oppCI: stats.wilson(k.opp, k.n), noneCI: stats.wilson(k.none, k.n), n: k.n };
	}
	// curve per eye: point 0 = no-stimulus trials, "same" for the left eye = left choice
	var base = count('none', 'left');
	var curve = { intensities: [0].concat(INTENSITIES), left: [], right: [], pooled: [] };
	['left', 'right'].forEach(function (eye) {
		var k0 = count('none', eye);
		curve[eye].push(probs(k0));
		INTENSITIES.forEach(function (a) { curve[eye].push(probs(count(eye + '_' + a, eye))); });
	});
	var k0 = { n: base.n * 2, same: base.left + base.right, opp: base.left + base.right, none: base.none * 2 };
	curve.pooled.push(probs(k0));
	INTENSITIES.forEach(function (a) {
		var l = count('left_' + a, 'left'), r = count('right_' + a, 'right');
		curve.pooled.push(probs({ n: l.n + r.n, same: l.same + r.same, opp: l.opp + r.opp, none: l.none + r.none }));
	});
	curve.settings = { tradeConfig: path.relative(path.join(__dirname, '..', '..'), TRADE_CONFIG), trials: TRIALS, seed: SEED,
		note: 'point 0 = no stimulus; same = choice on the stimulated side (left eye -> left choice = buy in the default mapping)' };
	fs.writeFileSync(path.join(OUT, 'curve.json'), JSON.stringify(curve, null, 1) + '\n');

	var md = [];
	md.push('# 초파리 반응 곡선 (세기별 같은 방향·반대 방향·무반응)');
	md.push('');
	md.push('시행 설정은 `trade.js`와 같음(weightScale 20, VIS_R1R6, 준비 20틱·측정 50틱, 잡음 0.005/1.0, 하행 뉴런 판정 최소 10발화·|d|≥0.2).');
	md.push('조건마다 ' + TRIALS + '회, 모든 조건이 같은 시드(' + SEED + '~' + (SEED + TRIALS - 1) + '). 괄호는 Wilson 95% 신뢰구간.');
	md.push('');
	md.push('자극 없음(' + base.n + '회): 왼쪽 ' + base.left + ', 오른쪽 ' + base.right + ', 무반응 ' + base.none +
		' (왼쪽 비율 이항검정 p = ' + stats.binomTwoSided(base.left, base.left + base.right).toFixed(2) + ')');
	md.push('');
	md.push('| 세기 | 눈 | n | 같은 방향 | 반대 방향 | 무반응 |');
	md.push('|---:|---|---:|---|---|---|');
	INTENSITIES.forEach(function (a) {
		['left', 'right'].forEach(function (eye) {
			var k = count(eye + '_' + a, eye);
			md.push('| ' + a + ' | ' + (eye === 'left' ? '왼쪽' : '오른쪽') + ' | ' + k.n + ' | ' +
				pct(k.same / k.n) + ' (' + ci(k.same, k.n) + ') | ' + pct(k.opp / k.n) + ' (' + ci(k.opp, k.n) + ') | ' +
				pct(k.none / k.n) + ' (' + ci(k.none, k.n) + ') |');
		});
		var p = curve.pooled[INTENSITIES.indexOf(a) + 1];
		md.push('| ' + a + ' | **좌우 합침** | ' + p.n + ' | **' + pct(p.same) + '** (' + pct(p.sameCI[0]) + '~' + pct(p.sameCI[1]) + ') | ' +
			pct(p.opp) + ' (' + pct(p.oppCI[0]) + '~' + pct(p.oppCI[1]) + ') | ' + pct(p.none) + ' (' + pct(p.noneCI[0]) + '~' + pct(p.noneCI[1]) + ') |');
	});
	md.push('');
	md.push('## CLAUDE.md 대략치와 비교 (좌우 합침)');
	md.push('');
	md.push('대략치는 기존 거래 기록 156개 결정에서 구간별로 묶은 값이고, 측정치는 그 구간에 속하는 세기의 시행을 합친 값.');
	md.push('');
	md.push('| 세기 구간 | 대략치 같은/반대/무반응 | 측정 세기 | 측정 같은 방향 | 측정 반대 방향 | 측정 무반응 | 대략치가 측정 95% CI 안? |');
	md.push('|---|---|---|---|---|---|---|');
	ROUGH.forEach(function (g) {
		// a measured intensity on a shared boundary goes to the upper bin only (0.3 -> 0.3~0.5, 0.5 -> 0.5 이상)
		var amps = INTENSITIES.filter(function (a) {
			return a >= g.lo && a <= g.hi && !ROUGH.some(function (h) { return h !== g && h.lo === a && a === g.hi; });
		});
		var k = { n: 0, same: 0, opp: 0, none: 0 };
		amps.forEach(function (a) {
			var l = count('left_' + a, 'left'), r = count('right_' + a, 'right');
			k.n += l.n + r.n; k.same += l.same + r.same; k.opp += l.opp + r.opp; k.none += l.none + r.none;
		});
		function inCI(x, kk) { var w = stats.wilson(kk, k.n); return x >= w[0] && x <= w[1]; }
		var ok = [inCI(g.same, k.same) ? '같은 O' : '같은 X', inCI(g.opp, k.opp) ? '반대 O' : '반대 X', inCI(g.hold, k.none) ? '무반응 O' : '무반응 X'];
		md.push('| ' + g.label + ' | ' + pct(g.same) + ' / ' + pct(g.opp) + ' / ' + pct(g.hold) + ' | ' + amps.join(', ') + ' (n=' + k.n + ') | ' +
			pct(k.same / k.n) + ' (' + ci(k.same, k.n) + ') | ' + pct(k.opp / k.n) + ' (' + ci(k.opp, k.n) + ') | ' +
			pct(k.none / k.n) + ' (' + ci(k.none, k.n) + ') | ' + ok.join(', ') + ' |');
	});
	md.push('');
	md.push('- 대략치 구간 경계가 겹쳐서, 경계에 있는 세기는 위 구간에만 넣음(0.3 → "0.3~0.5", 0.5 → "0.5 이상"). 0.15처럼 측정하지 않은 세기는 시장 시뮬레이션에서 선형 보간.');
	fs.writeFileSync(path.join(OUT, 'table.md'), md.join('\n') + '\n');
	console.log(md.join('\n'));
}

if (process.argv[2] === '--worker') worker(process.argv[3].split(','));
else (process.argv[2] === '--only-report' ? Promise.resolve() : runMissing())
	.then(report).catch(function (e) { console.error(e.message); process.exit(1); });
