/* headless-sim.js — run js/sim-worker.js in Node without a browser
 *
 * The web app's LIF simulator lives in a Web Worker (js/sim-worker.js). This
 * module loads that exact file into a Node `vm` context with a fake `self`,
 * so experiments use the same neuron model as the app without changing it.
 * Instead of letting the worker schedule itself with setTimeout, we call its
 * tick() function directly, one step at a time.
 *
 * Index spaces:
 *   original index = row in data/neurons.csv.gz (= FlyWire neuron order)
 *   sorted index   = position inside the worker after buildGroupStructures()
 *   The worker's V / fired / stimulation arrays all use sorted indices.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var zlib = require('zlib');

var ROOT = path.join(__dirname, '..', '..');
var DATA = path.join(ROOT, 'data');

/* ---------- small CSV helper (FlyWire files have no quoted commas we need) ---------- */

function readCsvGz(file) {
	var text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
	var lines = text.split('\n');
	var header = lines[0].trim().split(',');
	var rows = [];
	for (var i = 1; i < lines.length; i++) {
		if (!lines[i]) continue;
		var cols = lines[i].split(',');
		var row = {};
		for (var c = 0; c < header.length; c++) row[header[c]] = cols[c];
		rows.push(row);
	}
	return rows;
}

/* ---------- per-neuron annotations: group name, side, super_class ---------- */

function loadAnnotations(N) {
	var neurons = readCsvGz(path.join(DATA, 'neurons.csv.gz'));
	if (neurons.length !== N) {
		throw new Error('neurons.csv.gz has ' + neurons.length + ' rows but connectome has ' + N);
	}
	var byId = {};
	var classRows = readCsvGz(path.join(DATA, 'classification.csv.gz'));
	for (var i = 0; i < classRows.length; i++) byId[classRows[i].root_id] = classRows[i];

	var side = new Array(N);
	var superClass = new Array(N);
	for (var i = 0; i < N; i++) {
		var c = byId[neurons[i].root_id];
		side[i] = c && c.side ? c.side : 'unknown';
		superClass[i] = c && c.super_class ? c.super_class : 'unknown';
	}
	return { side: side, superClass: superClass };
}

/* ---------- seeded random number generator (mulberry32) ---------- */
// Math.random() cannot be seeded, so every random choice in an experiment
// goes through this generator. Same seed -> exactly the same trial.

function makeRng(seed) {
	var a = seed >>> 0;
	return function () {
		a = (a + 0x6D2B79F5) >>> 0;
		var t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/* ---------- HeadlessBrain ---------- */

function HeadlessBrain() {
	var meta = JSON.parse(fs.readFileSync(path.join(DATA, 'neuron_meta.json'), 'utf8'));
	this.groupNames = [];
	for (var i = 0; i < meta.groups.length; i++) this.groupNames[meta.groups[i].id] = meta.groups[i].name;

	/* load the worker source into its own context */
	var self = this;
	var messages = [];
	var sandbox = {
		console: console,
		performance: { now: function () { return Number(process.hrtime.bigint()) / 1e6; } },
		setTimeout: function () {}, // we drive tick() ourselves
		Math: Math
	};
	sandbox.self = { postMessage: function (msg) { messages.push(msg); } };
	this._ctx = vm.createContext(sandbox);
	var src = fs.readFileSync(path.join(ROOT, 'js', 'sim-worker.js'), 'utf8');
	vm.runInContext(src, this._ctx, { filename: 'js/sim-worker.js' });
	this._messages = messages;

	/* init with the raw (already gunzipped) binary so no DecompressionStream is needed */
	var raw = zlib.gunzipSync(fs.readFileSync(path.join(DATA, 'connectome.bin.gz')));
	var buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
	sandbox.self.onmessage({ data: { type: 'init', buffer: buf } });
	var ready = messages.filter(function (m) { return m.type === 'ready'; })[0];
	if (!ready) {
		var err = messages.filter(function (m) { return m.type === 'error'; })[0];
		throw new Error('worker init failed: ' + (err ? err.message : 'no ready message'));
	}
	messages.length = 0;

	this.N = ready.neuronCount;
	this.edgeCount = ready.edgeCount;
	this.order = ready.order;                 // sorted -> original
	this.sortedGroupId = ready.groupId;       // per sorted index
	this.toSorted = new Uint32Array(this.N);  // original -> sorted
	for (var s = 0; s < this.N; s++) this.toSorted[this.order[s]] = s;

	/* side / super_class in sorted index space */
	var ann = loadAnnotations(this.N);
	this.side = new Array(this.N);
	this.superClass = new Array(this.N);
	for (var s = 0; s < this.N; s++) {
		this.side[s] = ann.side[this.order[s]];
		this.superClass[s] = ann.superClass[this.order[s]];
	}

	this._baseValues = Float32Array.from(this._ctx.values); // synapse weights as loaded
	this._weightScale = 1;

	this._stim = null;      // {indices, intensities} sustained sensory input
	this._noise = null;     // {rate, amplitude, rng}
	this._post = sandbox.self.onmessage;
	void self;
}

/* Sorted indices of neurons matching a filter. filter: {group, side, superClass} */
HeadlessBrain.prototype.select = function (filter) {
	var gid = filter.group !== undefined ? this.groupNames.indexOf(filter.group) : -1;
	if (filter.group !== undefined && gid < 0) throw new Error('unknown group: ' + filter.group);
	var out = [];
	for (var s = 0; s < this.N; s++) {
		if (gid >= 0 && this.sortedGroupId[s] !== gid) continue;
		if (filter.side && this.side[s] !== filter.side) continue;
		if (filter.superClass && this.superClass[s] !== filter.superClass) continue;
		out.push(s);
	}
	return out;
};

/* Clear all voltages, spikes and inputs (same as the app's 'reset' message). */
HeadlessBrain.prototype.reset = function () {
	this._post({ data: { type: 'reset' } });
	this._stim = null;
	this._noise = null;
	this._messages.length = 0;
};

/* Optional LIF parameter override (leakRate, threshold, refractoryPeriod). */
HeadlessBrain.prototype.setParams = function (params) {
	var msg = { type: 'setParams' };
	for (var k in params) msg[k] = params[k];
	this._post({ data: msg });
};

/* Experiment-only option: multiply every synapse weight by `scale`.
 * The web app normalises weights so the strongest synapse is 0.15
 * (WEIGHT_SCALE in sim-worker.js); scale 1 keeps exactly that. */
HeadlessBrain.prototype.setWeightScale = function (scale) {
	if (scale === this._weightScale) return;
	var v = this._ctx.values, base = this._baseValues;
	for (var j = 0; j < v.length; j++) v[j] = base[j] * scale;
	this._weightScale = scale;
};

/* Left/right sensory stimulation.
 * spec = {
 *   groups: ['VIS_R1R6'],      sensory groups to drive
 *   left: 0.15, right: 0.0,    per-tick input to each chosen neuron on that side
 *   balance: true,             use the same number of neurons on both sides
 *   rng: function              seeded rng used when balance trims the larger side
 * }
 * Intensity 0 on both sides (or spec null) means no sensory stimulation. */
HeadlessBrain.prototype.setSideStimulus = function (spec) {
	if (!spec || (!(spec.left > 0) && !(spec.right > 0))) {
		this._stim = null;
		this._post({ data: { type: 'setStimulusState', indices: null, intensities: null } });
		return { left: 0, right: 0 };
	}
	var L = [], R = [];
	for (var g = 0; g < spec.groups.length; g++) {
		L = L.concat(this.select({ group: spec.groups[g], side: 'left' }));
		R = R.concat(this.select({ group: spec.groups[g], side: 'right' }));
	}
	if (spec.balance) {
		var n = Math.min(L.length, R.length);
		L = sample(L, n, spec.rng);
		R = sample(R, n, spec.rng);
	}
	var idx = [], amp = [];
	if (spec.left > 0) for (var i = 0; i < L.length; i++) { idx.push(L[i]); amp.push(spec.left); }
	if (spec.right > 0) for (var i = 0; i < R.length; i++) { idx.push(R[i]); amp.push(spec.right); }
	this._stim = { indices: Uint32Array.from(idx), intensities: Float32Array.from(amp) };
	this._post({ data: { type: 'setStimulusState', indices: this._stim.indices, intensities: this._stim.intensities } });
	return { left: L.length, right: R.length };
};

/* Spontaneous background input: every tick each neuron independently gets a
 * kick of `amplitude` with probability `rate`. This is the only source of
 * trial-to-trial variation — without it the simulator is fully deterministic. */
HeadlessBrain.prototype.setNoise = function (rate, amplitude, rng) {
	this._noise = rate > 0 && amplitude > 0 ? { rate: rate, amplitude: amplitude, rng: rng } : null;
};

/* Advance one tick. Returns the worker's fired array (sorted index space). */
HeadlessBrain.prototype.step = function () {
	if (this._noise) {
		var nz = this._noise;
		var idx = [];
		// geometric skipping: same distribution as one coin flip per neuron, much faster
		var logq = Math.log(1 - nz.rate);
		var s = Math.floor(Math.log(1 - nz.rng()) / logq);
		while (s < this.N) {
			idx.push(s);
			s += 1 + Math.floor(Math.log(1 - nz.rng()) / logq);
		}
		if (idx.length) {
			var amps = new Float32Array(idx.length).fill(nz.amplitude);
			this._post({ data: { type: 'stimulate', indices: idx, intensities: amps } });
		}
	}
	this._ctx.tick();
	this._messages.length = 0; // tick/stats messages are not needed here
	return this._ctx.fired;
};

function sample(arr, n, rng) {
	if (arr.length <= n) return arr.slice();
	var a = arr.slice();
	for (var i = 0; i < n; i++) {
		var j = i + Math.floor(rng() * (a.length - i));
		var t = a[i]; a[i] = a[j]; a[j] = t;
	}
	return a.slice(0, n).sort(function (x, y) { return x - y; });
}

module.exports = { HeadlessBrain: HeadlessBrain, makeRng: makeRng };
