#!/usr/bin/env node
/* backfill-runkeys.js — add the run key to fly runs saved before run keys existed
 *
 *   node experiments/backfill-runkeys.js           (check and write)
 *   node experiments/backfill-runkeys.js --check   (check only)
 *
 * trade-common.readRep() only rejects a saved run whose runKey differs from the
 * config, and runs saved before 2026-10-13 had no key, so they were never
 * checked. For every trade config with saved runs, this script first checks
 * that each saved decision matches what the config would produce now (decision
 * index, seed, return, stimulus intensity and eye); only then does it write the
 * config's runKey into the file. Settings that are not stored per decision
 * (weightScale, noise, readout, tick counts) cannot be checked from the file;
 * verify-runs.js replays saved trials to cover those.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var market = require('./lib/market.js');
var common = require('./lib/trade-common.js');

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

function close(a, b) { return Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b)); }

function main() {
	var checkOnly = process.argv.indexOf('--check') >= 0;
	var bad = 0, written = 0, already = 0;
	tradeConfigs().forEach(function (file) {
		var cfg = common.loadTradeConfig(file);
		var dir = path.join(__dirname, 'results', cfg.name, 'fly');
		if (!fs.existsSync(dir)) return;
		var points = market.decisionPoints(common.loadPrices(cfg), cfg.intervalMin);
		var fullScale = common.fullScaleReturn(cfg, points);
		var key = common.runKey(cfg);
		fs.readdirSync(dir).filter(function (f) { return /^rep_\d+\.json$/.test(f); }).sort().forEach(function (f) {
			var repFile = path.join(dir, f);
			var rep = JSON.parse(fs.readFileSync(repFile, 'utf8'));
			var k = rep.repeat, problems = [];
			if (rep.decisions.length !== points.length) problems.push('decision count ' + rep.decisions.length + ' vs ' + points.length);
			rep.decisions.forEach(function (d, j) {
				var p = points[j];
				if (!p) return;
				if (d.decision !== j) problems.push('decision ' + j + ': index ' + d.decision);
				if (d.seed !== common.trialSeed(cfg, k, j)) problems.push('decision ' + j + ': seed');
				if (!close(d.ret, p.ret)) problems.push('decision ' + j + ': return');
				if (!close(d.intensity, common.intensityFor(cfg, p.ret, fullScale))) problems.push('decision ' + j + ': intensity');
				if (d.eye !== common.eyeFor(cfg, p.ret)) problems.push('decision ' + j + ': eye');
			});
			if (problems.length) {
				bad++;
				console.log('MISMATCH ' + path.relative(__dirname, repFile) + ': ' + problems.slice(0, 3).join('; '));
				return;
			}
			if (rep.runKey !== undefined) {
				if (rep.runKey !== key) { bad++; console.log('KEY DIFFERS ' + path.relative(__dirname, repFile)); }
				else already++;
				return;
			}
			if (!checkOnly) {
				fs.writeFileSync(repFile, JSON.stringify({ repeat: rep.repeat, runKey: key, decisions: rep.decisions }, null, 1) + '\n');
				written++;
			}
		});
	});
	console.log((checkOnly ? 'checked' : 'run keys written: ' + written) + ', already keyed: ' + already + ', problems: ' + bad);
	if (bad) process.exit(1);
}

main();
