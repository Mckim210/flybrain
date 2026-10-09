/* choice-trial.js — one left/right "choice" trial on a HeadlessBrain
 *
 * Trial timeline (in simulator ticks):
 *   [warmup]  background noise only, so the network settles from rest
 *   [window]  noise + optional left/right sensory stimulus; output spikes counted
 *
 * Readout: spikes of the chosen output neurons (default: FlyWire super_class
 * "descending" = brain -> ventral nerve cord) on the left vs right side.
 * Each side is turned into a rate per neuron, so a side with a few more
 * neurons does not win automatically.
 *
 *   lateralization index  d = (rateL - rateR) / (rateL + rateR)   (-1 .. +1)
 *   total spikes < minSpikes  -> "none"  (no response)
 *   |d| < margin              -> "none"  (too close to call)
 *   d >= margin               -> "left"
 *   d <= -margin              -> "right"
 */
'use strict';

var makeRng = require('./headless-sim.js').makeRng;

function prepareReadout(brain, readout) {
	var filter = {};
	if (readout.superClass) filter.superClass = readout.superClass;
	if (readout.group) filter.group = readout.group;
	filter.side = 'left';
	var left = brain.select(filter);
	filter.side = 'right';
	var right = brain.select(filter);
	if (!left.length || !right.length) {
		throw new Error('readout has no neurons on one side: ' + JSON.stringify(readout));
	}
	return { left: Uint32Array.from(left), right: Uint32Array.from(right) };
}

function runTrial(brain, cfg, out, trialSeed) {
	var rng = makeRng(trialSeed);
	brain.reset();
	if (cfg.params) brain.setParams(cfg.params);
	brain.setNoise(cfg.noise.rate, cfg.noise.amplitude, rng);

	for (var t = 0; t < cfg.warmupTicks; t++) brain.step();

	var stimSizes = brain.setSideStimulus(cfg.stimulus ? {
		groups: cfg.stimulus.groups,
		left: cfg.stimulus.left,
		right: cfg.stimulus.right,
		balance: cfg.stimulus.balance,
		rng: rng
	} : null);

	var spikesL = 0, spikesR = 0, totalSpikes = 0;
	var G = brain.groupNames.length;
	var groupL = new Float64Array(G), groupR = new Float64Array(G);
	var gid = brain.sortedGroupId, side = brain.side, N = brain.N;

	for (var t = 0; t < cfg.windowTicks; t++) {
		var fired = brain.step();
		for (var k = 0; k < out.left.length; k++) spikesL += fired[out.left[k]];
		for (var k = 0; k < out.right.length; k++) spikesR += fired[out.right[k]];
		for (var i = 0; i < N; i++) {
			if (!fired[i]) continue;
			totalSpikes++;
			if (side[i] === 'left') groupL[gid[i]]++;
			else if (side[i] === 'right') groupR[gid[i]]++;
		}
	}

	var rateL = spikesL / out.left.length;
	var rateR = spikesR / out.right.length;
	var d = rateL + rateR > 0 ? (rateL - rateR) / (rateL + rateR) : 0;
	var choice, reason;
	if (spikesL + spikesR < cfg.readout.minSpikes) {
		choice = 'none'; reason = 'too_few_spikes';
	} else if (Math.abs(d) < cfg.readout.margin) {
		choice = 'none'; reason = 'too_close';
	} else {
		choice = d > 0 ? 'left' : 'right'; reason = 'lateralized';
	}

	return {
		seed: trialSeed,
		spikesL: spikesL,
		spikesR: spikesR,
		rateL: rateL,
		rateR: rateR,
		d: d,
		choice: choice,
		reason: reason,
		totalSpikes: totalSpikes,
		stimNeuronsL: stimSizes.left,
		stimNeuronsR: stimSizes.right,
		groupL: groupL,
		groupR: groupR
	};
}

module.exports = { prepareReadout: prepareReadout, runTrial: runTrial };
