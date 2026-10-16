/* brain-worker.js — runs one fly trading decision in the browser, with the web app's own LIF simulator.
 *
 * Loads ../js/sim-worker.js (unchanged) into this worker and drives its tick() directly, exactly as
 * experiments/lib/headless-sim.js + choice-trial.js do in Node: reset, weight scale, seeded background
 * noise, 20 warm-up ticks, eye stimulus (balanced VIS_R1R6 neurons), 50 counted ticks, descending-neuron
 * left/right readout. Same seed -> same decision as the Node experiments.
 *
 * Messages in:  {type:'init'}  then  {type:'decide', id, intensity, eye:'left'|'right'|null, seed}
 * Messages out: {type:'ready', N} | {type:'progress', stage} | {type:'decision', id, ...} | {type:'error', message}
 */
'use strict';
var out = { post: self.postMessage.bind(self) };
var simReady = null, simError = null;
// the simulator posts a message every tick; swallow those and keep only init results
self.postMessage = function (m) {
	if (m && m.type === 'ready') simReady = m;
	else if (m && m.type === 'error') simError = m;
};
importScripts('../js/sim-worker.js');
var sim = self.onmessage;   // the simulator's own handler (init, reset, stimulate, ...)

var CFG = { weightScale: 20, warmupTicks: 20, windowTicks: 50, noiseRate: 0.005, noiseAmp: 1.0, minSpikes: 10, margin: 0.2 };
var order, toSorted, eyeL, eyeR, dnL, dnR, subSorted, baseValues, curScale = 1;

function makeRng(seed) {   // mulberry32, same as headless-sim.js
	var a = seed >>> 0;
	return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function sample(arr, n, rng) {   // same as headless-sim.js
	if (arr.length <= n) return arr.slice();
	var a = arr.slice();
	for (var i = 0; i < n; i++) { var j = i + Math.floor(rng() * (a.length - i)); var t = a[i]; a[i] = a[j]; a[j] = t; }
	return a.slice(0, n).sort(function (x, y) { return x - y; });
}
function sortedList(origList) { return origList.map(function (o) { return toSorted[o]; }).sort(function (x, y) { return x - y; }); }

function init() {
	out.post({ type: 'progress', stage: '뇌 연결 데이터 받는 중 (12MB)' });
	Promise.all([
		fetch('../data/connectome.bin.gz').then(function (r) { if (!r.ok) throw new Error('connectome.bin.gz ' + r.status); return r.arrayBuffer(); }),
		fetch('data/live_meta.json').then(function (r) { if (!r.ok) throw new Error('live_meta.json ' + r.status); return r.json(); })
	]).then(function (res) {
		out.post({ type: 'progress', stage: '뇌 연결 풀어서 준비하는 중' });
		var live = res[1];
		sim({ data: { type: 'init', buffer: res[0] } });   // gzip buffer: the simulator decompresses it itself
		var wait = setInterval(function () {
			if (simError) { clearInterval(wait); out.post({ type: 'error', message: simError.message }); return; }
			if (!simReady) return;
			clearInterval(wait);
			order = simReady.order; toSorted = new Uint32Array(N);
			for (var s = 0; s < N; s++) toSorted[order[s]] = s;
			eyeL = sortedList(live.eyeL); eyeR = sortedList(live.eyeR); dnL = Uint32Array.from(sortedList(live.dnL)); dnR = Uint32Array.from(sortedList(live.dnR));
			subSorted = new Int32Array(N).fill(-1);
			live.subset.forEach(function (o, i) { subSorted[toSorted[o]] = i; });
			baseValues = Float32Array.from(values);
			out.post({ type: 'ready', N: N });
		}, 50);
	}).catch(function (e) { out.post({ type: 'error', message: e.message }); });
}

function setWeightScale(scale) {
	if (scale === curScale) return;
	for (var j = 0; j < values.length; j++) values[j] = baseValues[j] * scale;
	curScale = scale;
}

function step(noiseRng) {
	var idx = [], logq = Math.log(1 - CFG.noiseRate);
	var s = Math.floor(Math.log(1 - noiseRng()) / logq);
	while (s < N) { idx.push(s); s += 1 + Math.floor(Math.log(1 - noiseRng()) / logq); }
	if (idx.length) sim({ data: { type: 'stimulate', indices: idx, intensities: new Float32Array(idx.length).fill(CFG.noiseAmp) } });
	tick();
	return fired;
}

function decide(msg) {
	var t0 = Date.now(), seed = msg.seed >>> 0, rng = makeRng(seed);
	sim({ data: { type: 'reset' } });
	sim({ data: { type: 'setParams', leakRate: DEFAULT_LEAK_RATE, threshold: DEFAULT_THRESHOLD, refractoryPeriod: DEFAULT_REFRACTORY_PERIOD } });
	setWeightScale(CFG.weightScale);
	for (var t = 0; t < CFG.warmupTicks; t++) step(rng);
	if (msg.intensity > 0 && msg.eye) {
		var srng = makeRng(seed ^ 0x5bd1e995), n = Math.min(eyeL.length, eyeR.length);
		var L = sample(eyeL, n, srng), R = sample(eyeR, n, srng), pick = msg.eye === 'left' ? L : R;
		sim({ data: { type: 'setStimulusState', indices: Uint32Array.from(pick), intensities: new Float32Array(pick.length).fill(msg.intensity) } });
	} else sim({ data: { type: 'setStimulusState', indices: null, intensities: null } });
	var sL = 0, sR = 0, ticks = [], tickTotals = [];
	for (var w = 0; w < CFG.windowTicks; w++) {
		var f = step(rng), list = [], tot = 0;
		for (var k = 0; k < dnL.length; k++) sL += f[dnL[k]];
		for (var k2 = 0; k2 < dnR.length; k2++) sR += f[dnR[k2]];
		for (var i = 0; i < N; i++) if (f[i]) { tot++; var d = subSorted[i]; if (d >= 0) list.push(d); }
		ticks.push(Uint16Array.from(list)); tickTotals.push(tot);
	}
	var rL = sL / dnL.length, rR = sR / dnR.length, dd = rL + rR > 0 ? (rL - rR) / (rL + rR) : 0;
	var choice = sL + sR < CFG.minSpikes || Math.abs(dd) < CFG.margin ? 'none' : (dd > 0 ? 'left' : 'right');
	out.post({ type: 'decision', id: msg.id, seed: seed, spikesL: sL, spikesR: sR, d: dd, choice: choice,
		action: choice === 'left' ? 'buy' : (choice === 'right' ? 'sell' : 'hold'), ticks: ticks, tickTotals: tickTotals, ms: Date.now() - t0 });
}

self.onmessage = function (e) {
	try {
		if (e.data.type === 'init') init();
		else if (e.data.type === 'decide') decide(e.data);
	} catch (err) { out.post({ type: 'error', message: err.message }); }
};
