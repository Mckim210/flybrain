#!/usr/bin/env node
/* verify-runs.js — replay saved trials and check they come out exactly the same
 *
 *   node experiments/verify-runs.js                 (every trade config + the confirmation sweep)
 *   node experiments/verify-runs.js --per-run 1     (fewer decisions per config, faster)
 *
 * For each trade config with saved fly runs, replays repeat 0 at a few decisions
 * (first, middle, last by default) with the current code and compares choice,
 * left/right descending spikes and d with the saved values. For each condition
 * of the confirmation sweep it replays the first trial and compares with
 * trials.csv. Exits with code 1 if anything differs.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var market = require('./lib/market.js');
var common = require('./lib/trade-common.js');
var trial = require('./lib/choice-trial.js');
var HeadlessBrain = require('./lib/headless-sim.js').HeadlessBrain;

var CONFIG = path.join(__dirname, 'config');

function tradeConfigs() {
	var files = ['trade-stonkfly-window.json', 'trade-stonkfly-window-fixed1pct.json'];
	['periods', 'reversed', 'robust-w10'].forEach(function (d) {
		var dir = path.join(CONFIG, d);
		if (!fs.existsSync(dir)) return;
		fs.readdirSync(dir).sort().forEach(function (f) { if (/\.json$/.test(f)) files.push(path.join(d, f)); });
	});
	return files.map(function (f) { return path.join(CONFIG, f); });
}

function main() {
	var perRun = 3;
	for (var i = 2; i < process.argv.length; i += 2) if (process.argv[i] === '--per-run') perRun = +process.argv[i + 1];
	var brain = new HeadlessBrain(), outs = {}, bad = 0, checked = 0;
	function readout(r) { var k = JSON.stringify(r); return outs[k] || (outs[k] = trial.prepareReadout(brain, r)); }

	tradeConfigs().forEach(function (file) {
		var cfg = common.loadTradeConfig(file);
		if (!fs.existsSync(common.repFile(cfg, 0))) return;
		var points = market.decisionPoints(common.loadPrices(cfg), cfg.intervalMin);
		var fullScale = common.fullScaleReturn(cfg, points);
		var rep = common.readRep(cfg, 0);
		var js = perRun === 1 ? [0] : [0, Math.floor(points.length / 2), points.length - 1].slice(0, perRun);
		js.forEach(function (j) {
			var r = trial.runTrial(brain, common.trialConfig(cfg, points[j].ret, fullScale), readout(cfg.fly.readout), common.trialSeed(cfg, 0, j));
			var s = rep.decisions[j];
			var same = r.choice === s.choice && r.spikesL === s.spikesL && r.spikesR === s.spikesR && Math.abs(r.d - s.d) < 1e-12;
			checked++;
			if (!same) bad++;
			console.log((same ? 'same ' : 'DIFF ') + cfg.name + ' rep 0 decision ' + j + ': ' + r.choice + ' ' + r.spikesL + ':' + r.spikesR +
				(same ? '' : ' (saved ' + s.choice + ' ' + s.spikesL + ':' + s.spikesR + ')'));
		});
	});

	var confirmDir = path.join(__dirname, 'results', 'confirm-w20-vis', 'configs');
	if (fs.existsSync(confirmDir)) {
		fs.readdirSync(confirmDir).sort().forEach(function (f) {
			var cfg = JSON.parse(fs.readFileSync(path.join(confirmDir, f), 'utf8'));
			var lines = fs.readFileSync(path.join(__dirname, 'results', cfg.name, 'trials.csv'), 'utf8').trim().split('\n');
			var head = lines[0].split(','), row = lines[1].split(','), saved = {};
			head.forEach(function (h, i) { saved[h] = row[i]; });
			var full = Object.assign({ readout: { superClass: 'descending', minSpikes: 10, margin: 0.2 } }, cfg);
			var r = trial.runTrial(brain, full, readout(full.readout), +saved.seed);
			var same = r.choice === saved.choice && r.spikesL === +saved.spikes_left && r.spikesR === +saved.spikes_right;
			checked++;
			if (!same) bad++;
			console.log((same ? 'same ' : 'DIFF ') + cfg.name + ' trial 1: ' + r.choice + ' ' + r.spikesL + ':' + r.spikesR +
				(same ? '' : ' (saved ' + saved.choice + ' ' + saved.spikes_left + ':' + saved.spikes_right + ')'));
		});
	}
	console.log('\n' + checked + ' trials replayed, ' + bad + ' differ');
	if (bad) process.exit(1);
}

main();
