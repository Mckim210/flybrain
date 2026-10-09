#!/usr/bin/env node
/* compare-baselines.js — check noise-only baseline runs across model settings
 *
 * Usage:
 *   node experiments/compare-baselines.js experiments/results/dose-response experiments/results/dose-response-weights
 *
 * Reads every runs/none_* condition (no stimulus, background noise only) under
 * the given sweep result folders and prints, per weight scale / threshold:
 *   - whole-brain spikes per tick (does the network run away?)
 *   - left vs right spikes in the most active groups (is the whole brain lopsided?)
 *   - descending-neuron spikes and the mean lateralization d (is the readout biased?)
 *   - choice counts and the binomial test against 50:50
 */
'use strict';

var fs = require('fs');
var path = require('path');
var stats = require('./lib/stats.js');

function readCsv(file) {
	var lines = fs.readFileSync(file, 'utf8').trim().split('\n');
	var head = lines[0].split(',');
	return lines.slice(1).map(function (l) {
		var cols = l.split(','), r = {};
		head.forEach(function (h, i) { r[h] = cols[i]; });
		return r;
	});
}

function f(x, n) { return (x >= 0 ? '+' : '') + x.toFixed(n); }

var rows = [];
process.argv.slice(2).forEach(function (dir) {
	var runs = path.join(dir, 'runs');
	fs.readdirSync(runs).filter(function (d) { return d.indexOf('none_') === 0; }).forEach(function (d) {
		var summary = JSON.parse(fs.readFileSync(path.join(runs, d, 'summary.json'), 'utf8'));
		var trials = readCsv(path.join(runs, d, 'trials.csv'));
		var cfg = summary.config;
		var ticks = cfg.windowTicks;
		var brainL = 0, brainR = 0;
		summary.top_groups_by_spikes.forEach(function (g) { brainL += g.left; brainR += g.right; });
		var dStats = stats.meanCI(trials.map(function (r) { return +r.lateralization_d; }));
		var c = summary.counts;
		rows.push({
			weightScale: cfg.weightScale || 1,
			threshold: cfg.params && cfg.params.threshold !== undefined ? cfg.params.threshold : 1,
			trials: trials.length,
			spikesPerTick: trials.reduce(function (s, r) { return s + +r.total_spikes; }, 0) / trials.length / ticks,
			brainLeftShare: brainL / (brainL + brainR),
			descPerTrial: (summary.readout_spikes_total.left + summary.readout_spikes_total.right) / trials.length,
			d: dStats,
			counts: c,
			p: summary.binomial_p_two_sided
		});
	});
});
rows.sort(function (a, b) { return a.weightScale - b.weightScale || a.threshold - b.threshold; });

console.log('| 가중치 배율 | 문턱 | 시행 | 뇌 전체 발화/틱 | 상위 10개 그룹 왼쪽 비율 | 하행 발화/시행 | 평균 d [95% CI] | 선택 L/R/무 | 이항검정 p |');
console.log('|---:|---:|---:|---:|---:|---:|---|---|---:|');
rows.forEach(function (r) {
	console.log('| ' + r.weightScale + ' | ' + r.threshold + ' | ' + r.trials + ' | ' + r.spikesPerTick.toFixed(1) + ' | ' +
		(100 * r.brainLeftShare).toFixed(1) + '% | ' + r.descPerTrial.toFixed(1) + ' | ' +
		f(r.d.mean, 3) + ' [' + f(r.d.lo, 3) + ', ' + f(r.d.hi, 3) + '] | ' +
		r.counts.left + '/' + r.counts.right + '/' + r.counts.none + ' | ' + r.p.toPrecision(2) + ' |');
});
