/* trade-common.js — config loading and price -> stimulus mapping shared by trade.js and its workers */
'use strict';

var fs = require('fs');
var path = require('path');
var market = require('./market.js');

function loadTradeConfig(file) {
	var cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
	['name', 'prices', 'intervalMin', 'rules', 'fly', 'random'].forEach(function (k) {
		if (cfg[k] === undefined) throw new Error(file + ': missing "' + k + '"');
	});
	return cfg;
}

/* Prices for this config. Optional cfg.window = {start: ISO time, hours: n}
 * keeps rows from start to start + n hours (both ends included). */
function loadPrices(cfg) {
	var prices = market.loadPrices(path.join(__dirname, '..', '..', cfg.prices));
	if (!cfg.window) return prices;
	var t0 = Date.parse(cfg.window.start) / 1000, t1 = t0 + cfg.window.hours * 3600;
	var sliced = prices.filter(function (p) { return p.t >= t0 && p.t <= t1; });
	if (!sliced.length || sliced[0].t !== t0 || sliced[sliced.length - 1].t !== t1) {
		throw new Error('price file does not fully cover window ' + cfg.window.start + ' + ' + cfg.window.hours + 'h');
	}
	return sliced;
}

/* Return that maps to full intensity. A number (e.g. 0.01 = 1%) uses only
 * information available at decision time. "max" = the largest |hourly return|
 * in the whole window; it looks into the future and is kept only to reproduce
 * the first STONKFLY-window run. */
function fullScaleReturn(cfg, points) {
	if (cfg.fly.fullScaleReturn !== 'max') return cfg.fly.fullScaleReturn;
	var m = 0;
	points.forEach(function (p) { if (Math.abs(p.ret) > m) m = Math.abs(p.ret); });
	return m;
}

function intensityFor(cfg, ret, fullScale) {
	if (ret === 0 || fullScale <= 0) return 0;
	return cfg.fly.maxIntensity * Math.min(1, Math.abs(ret) / fullScale);
}

/* Which eye a price move goes to. Default mapping: up -> left eye, down -> right
 * eye. cfg.fly.mapping = "reversed" swaps them (up -> right, down -> left); the
 * readout is unchanged (left choice = buy, right choice = sell). */
function eyeFor(cfg, ret) {
	if (ret === 0) return 'none';
	var up = ret > 0;
	if (cfg.fly.mapping === 'reversed') up = !up;
	return up ? 'left' : 'right';
}

/* Trial settings for one decision (shared by the worker and replays). */
function trialConfig(cfg, ret, fullScale) {
	var amp = intensityFor(cfg, ret, fullScale);
	var eye = eyeFor(cfg, ret);
	return {
		warmupTicks: cfg.fly.warmupTicks,
		windowTicks: cfg.fly.windowTicks,
		noise: cfg.fly.noise,
		weightScale: cfg.fly.weightScale,
		params: cfg.fly.params || null,
		readout: cfg.fly.readout,
		stimulus: amp > 0 ? {
			groups: cfg.fly.stimulusGroups,
			left: eye === 'left' ? amp : 0,
			right: eye === 'right' ? amp : 0,
			balance: true
		} : null
	};
}

function trialSeed(cfg, repeat, decision) {
	return cfg.fly.seed + repeat * 1000 + decision;
}

/* Everything that decides what a saved fly run contains (all but the number of
 * repeats). Stored in each rep file so a changed config under the same name is
 * caught instead of silently mixing old and new runs. */
function runKey(cfg) {
	var fly = {};
	Object.keys(cfg.fly).sort().forEach(function (k) { if (k !== 'repeats') fly[k] = cfg.fly[k]; });
	return JSON.stringify({ prices: cfg.prices, window: cfg.window || null, intervalMin: cfg.intervalMin, fly: fly });
}

function repFile(cfg, k) {
	return path.join(__dirname, '..', 'results', cfg.name, 'fly', 'rep_' + String(k).padStart(2, '0') + '.json');
}

/* Saved fly run k for this config. Every saved run carries the run key of the
 * config that made it (runs saved before keys existed were checked and keyed by
 * backfill-runkeys.js), so a run without a key or with a different key is refused. */
function readRep(cfg, k) {
	var file = repFile(cfg, k);
	var rep = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (rep.runKey === undefined) {
		throw new Error(file + ' has no run key; run node experiments/backfill-runkeys.js to check it against ' + cfg.name);
	}
	if (rep.runKey !== runKey(cfg)) {
		throw new Error(file + ' was made with different settings than ' + cfg.name +
			' now has; delete the results folder or use a new name');
	}
	return rep;
}

module.exports = {
	loadTradeConfig: loadTradeConfig, loadPrices: loadPrices, fullScaleReturn: fullScaleReturn,
	intensityFor: intensityFor, eyeFor: eyeFor, trialConfig: trialConfig, trialSeed: trialSeed,
	runKey: runKey, repFile: repFile, readRep: readRep
};
