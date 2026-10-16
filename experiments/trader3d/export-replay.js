#!/usr/bin/env node
/* export-replay.js — record real brain runs for the FlyBrain Trader 3D page
 *
 *   node experiments/trader3d/export-replay.js            (all three repeats, 2 processes)
 *   node experiments/trader3d/export-replay.js --rep 11   (one repeat, used internally)
 *
 * Re-runs saved fly repeats of trade-stonkfly-window-fixed1pct (same seeds, so the
 * same decisions) and records, for every decision, which displayed neurons fired
 * on each tick of the 50-tick response window. Checks every decision against the
 * saved run. Also computes the rule investor and 10,000 random investors with the
 * same rules (lib/market.js) so the page shows real numbers, not invented ones.
 * Writes experiments/trader3d/data/: meta.json, spikes_<rep>.txt (base64 Uint16).
 */
'use strict';
var fs = require('fs'), path = require('path'), cp = require('child_process');
var EXP = path.join(__dirname, '..');
var HeadlessBrain = require(EXP + '/lib/headless-sim.js').HeadlessBrain;
var makeRng = require(EXP + '/lib/headless-sim.js').makeRng;
var market = require(EXP + '/lib/market.js');
var common = require(EXP + '/lib/trade-common.js');
var CFG_FILE = path.join(EXP, 'config', 'trade-stonkfly-window-fixed1pct.json');
var REPS = [11, 0, 14];   // median, best, worst P&L among the 30 saved repeats
var OUT = path.join(__dirname, 'data');
var N_BRAIN = 40000, N_EYE = 1000, SEED = 20261016;

function subsetFor(brain) {
	// fixed display subset in ORIGINAL neuron order (= row of neuron_positions.bin)
	var rng = makeRng(SEED), N = brain.N, pick = new Uint8Array(N);
	var eyeL = brain.select({ group: 'VIS_R1R6', side: 'left' }).map(function (s) { return brain.order[s]; });
	var eyeR = brain.select({ group: 'VIS_R1R6', side: 'right' }).map(function (s) { return brain.order[s]; });
	var dn = brain.select({ superClass: 'descending' }).map(function (s) { return brain.order[s]; });
	function take(arr, n) { arr = arr.slice(); for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr.slice(0, n); }
	take(eyeL, N_EYE).concat(take(eyeR, N_EYE)).concat(dn).forEach(function (o) { pick[o] = 1; });
	var all = []; for (var o = 0; o < N; o++) all.push(o);
	take(all, N_BRAIN).forEach(function (o) { pick[o] = 1; });
	var list = []; for (var o = 0; o < N; o++) if (pick[o]) list.push(o);
	var role = list.map(function (o) {
		var s = brain.toSorted[o];
		if (brain.superClass[s] === 'descending') return brain.side[s] === 'left' ? 3 : (brain.side[s] === 'right' ? 4 : 5);   // 5 = midline DN, not read out
		if (brain.groupNames[brain.sortedGroupId[s]] === 'VIS_R1R6') return brain.side[s] === 'left' ? 1 : 2;
		return 0;
	});
	return { list: list, role: role };
}

function runRep(rep) {
	var cfg = common.loadTradeConfig(CFG_FILE);
	var saved = common.readRep(cfg, rep);
	var prices = common.loadPrices(cfg), points = market.decisionPoints(prices, cfg.intervalMin);
	var fullScale = common.fullScaleReturn(cfg, points);
	var brain = new HeadlessBrain();
	var sub = subsetFor(brain);
	var toSub = new Int32Array(brain.N).fill(-1);
	sub.list.forEach(function (o, i) { toSub[brain.toSorted[o]] = i; });   // sorted -> subset
	var trialLib = require(EXP + '/lib/choice-trial.js');
	var out = trialLib.prepareReadout(brain, cfg.fly.readout);
	var chunks = [], decisions = [];
	points.forEach(function (p, j) {
		var tcfg = common.trialConfig(cfg, p.ret, fullScale), seed = common.trialSeed(cfg, rep, j);
		// same steps as choice-trial.js runTrial, plus per-tick capture of the displayed neurons
		var rng = makeRng(seed);
		brain.reset(); brain.setWeightScale(tcfg.weightScale || 1); brain.setNoise(tcfg.noise.rate, tcfg.noise.amplitude, rng);
		for (var t = 0; t < tcfg.warmupTicks; t++) brain.step();
		brain.setSideStimulus(tcfg.stimulus ? { groups: tcfg.stimulus.groups, left: tcfg.stimulus.left, right: tcfg.stimulus.right, balance: true, rng: makeRng(seed ^ 0x5bd1e995) } : null);
		var sL = 0, sR = 0, total = 0, ticks = [], tickTotals = [];
		for (var t = 0; t < tcfg.windowTicks; t++) {
			var fired = brain.step(), f = [];
			for (var k = 0; k < out.left.length; k++) sL += fired[out.left[k]];
			for (var k = 0; k < out.right.length; k++) sR += fired[out.right[k]];
			var tt = 0;
			for (var i = 0; i < brain.N; i++) if (fired[i]) { tt++; if (toSub[i] >= 0) f.push(toSub[i]); }
			total += tt; tickTotals.push(tt);
			ticks.push(f);
		}
		var rL = sL / out.left.length, rR = sR / out.right.length, d = rL + rR > 0 ? (rL - rR) / (rL + rR) : 0;
		var choice = sL + sR < tcfg.readout.minSpikes || Math.abs(d) < tcfg.readout.margin ? 'none' : (d > 0 ? 'left' : 'right');
		var want = saved.decisions[j];
		if (choice !== want.choice || sL !== want.spikesL || sR !== want.spikesR) throw new Error('rep ' + rep + ' decision ' + j + ' does not reproduce the saved run');
		decisions.push({ ret: p.ret, intensity: common.intensityFor(cfg, p.ret, fullScale), eye: common.eyeFor(cfg, p.ret), spikesL: sL, spikesR: sR, d: d, choice: choice, action: want.action, totalSpikes: total, tickTotals: tickTotals });
		// encode: per tick count then indices, all Uint16
		var flat = [];
		ticks.forEach(function (f) { flat.push(f.length); Array.prototype.push.apply(flat, f); });
		chunks.push(flat);
		process.stdout.write('rep ' + rep + ' decision ' + j + ' ok\n');
	});
	fs.mkdirSync(OUT, { recursive: true });
	var lens = chunks.map(function (c) { return c.length; });
	var buf = Buffer.from(Uint16Array.from([].concat.apply([], chunks)).buffer);
	fs.writeFileSync(path.join(OUT, 'spikes_' + rep + '.txt'), buf.toString('base64'));
	fs.writeFileSync(path.join(OUT, 'rep_' + rep + '.json'), JSON.stringify({ rep: rep, chunkLengths: lens, decisions: decisions }));
}

function equityPath(actions, points, finalPrice, R) {
	// value after each decision (same order rules as market.simulate)
	var vals = [];
	for (var k = 1; k <= points.length; k++) {
		var s = market.simulate(actions.slice(0, k), points.slice(0, k), points[k - 1].price, R);
		vals.push(s.finalValue - R.capital);
	}
	var fin = market.simulate(actions, points, finalPrice, R);
	return { path: vals, final: fin.pnl, orders: fin.orders, fees: fin.fees, executed: fin.executed.map(function (e) { return e.action; }) };
}

function writeMeta() {
	var cfg = common.loadTradeConfig(CFG_FILE), R = cfg.rules;
	var prices = common.loadPrices(cfg), points = market.decisionPoints(prices, cfg.intervalMin);
	var finalPrice = prices[prices.length - 1].close;
	var brain = new HeadlessBrain(), sub = subsetFor(brain);
	var raw = fs.readFileSync(path.join(EXP, '..', 'data', 'neuron_positions.bin'));
	var N = brain.N, pos = new Uint16Array(raw.buffer, raw.byteOffset, N * 3);
	var sp = new Uint16Array(sub.list.length * 3), cls = Array.prototype.slice.call(raw.subarray(N * 6, N * 7));
	sub.list.forEach(function (o, i) { sp[i * 3] = pos[o * 3]; sp[i * 3 + 1] = pos[o * 3 + 1]; sp[i * 3 + 2] = pos[o * 3 + 2]; });
	// 15-minute candles from the 1-minute bars
	// market.loadPrices keeps only close, so read open/high/low/volume from the CSV itself
	var rows = fs.readFileSync(path.join(EXP, '..', cfg.prices), 'utf8').trim().split('\n').slice(1).map(function (l) {
		var c = l.split(','); return { t: +c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5] }; });
	if (rows.length !== prices.length || rows[rows.length - 1].close !== prices[prices.length - 1].close) throw new Error('price rows differ');
	var candles = [];
	for (var i = 0; i < rows.length; i += 15) {
		var g = rows.slice(i, i + 15);
		candles.push([g[0].t, g[0].open, Math.max.apply(null, g.map(function (x) { return x.high; })), Math.min.apply(null, g.map(function (x) { return x.low; })), g[g.length - 1].close, g.reduce(function (a, x) { return a + x.volume; }, 0)]);
	}
	var reps = REPS.map(function (rep) {
		var r = JSON.parse(fs.readFileSync(path.join(OUT, 'rep_' + rep + '.json'), 'utf8'));
		var eq = equityPath(r.decisions.map(function (d) { return d.action; }), points, finalPrice, R);
		return { rep: rep, chunkLengths: r.chunkLengths, decisions: r.decisions, equity: eq };
	});
	var rule = equityPath(market.ruleActions(points), points, finalPrice, R);
	// 10,000 random investors, same seed and order as trade.js
	var rng = makeRng(cfg.random.seed), n = cfg.random.investors, T = points.length;
	var sum = new Float64Array(T), fins = [];
	var paths = [];
	for (var i = 0; i < n; i++) {
		var acts = market.randomActions(points, rng, cfg.random.probs);
		var s = market.simulate(acts, points, finalPrice, R); fins.push(s.pnl);
		if (i < 400) paths.push(acts);
	}
	// mean path from the first 400 (cheap); final stats from all 10,000
	var mean = new Float64Array(T);
	paths.forEach(function (a) { equityPath(a, points, finalPrice, R).path.forEach(function (v, k) { mean[k] += v / paths.length; }); });
	fins.sort(function (a, b) { return a - b; });
	var q = function (p) { return fins[Math.floor(p * (fins.length - 1))]; };
	var meanAll = fins.reduce(function (a, b) { return a + b; }, 0) / fins.length;
	var meta = {
		source: 'experiments/config/trade-stonkfly-window-fixed1pct.json (weightScale 20, VIS_R1R6, descending readout)',
		rules: R, nNeurons: N, subsetSize: sub.list.length, positionsU16: Buffer.from(sp.buffer).toString('base64'), role: sub.role, cls: sub.list.map(function (o) { return cls[o]; }),
		candles: candles, points: points.map(function (p) { return { t: p.t, price: p.price, ret: p.ret }; }), finalPrice: finalPrice,
		reps: reps, rule: rule,
		random: { n: n, meanPath: Array.from(mean), finalMean: meanAll, p05: q(0.05), p50: q(0.5), p95: q(0.95), shareGe1: fins.filter(function (v) { return v >= 1; }).length / n }
	};
	fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta));
	console.log('meta written; random mean', meanAll.toFixed(4), 'rule', rule.final.toFixed(4), reps.map(function (r) { return r.rep + ':' + r.equity.final.toFixed(4); }).join(' '));
}

var a = process.argv.indexOf('--rep');
if (a > 0) runRep(+process.argv[a + 1]);
else if (process.argv.indexOf('--meta') > 0) writeMeta();
else {
	var todo = REPS.filter(function (r) { return !fs.existsSync(path.join(OUT, 'rep_' + r + '.json')); });
	Promise.all(todo.map(function (r) { return new Promise(function (res, rej) {
		var p = cp.spawn(process.execPath, [__filename, '--rep', String(r)], { stdio: ['ignore', 'ignore', 'inherit'] });
		p.on('close', function (c) { c === 0 ? res() : rej(new Error('rep ' + r + ' failed')); });
	}); })).then(writeMeta);
}
