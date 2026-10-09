#!/usr/bin/env node
/* fly-trader-worker.js — run the fly's decisions for some repeats (used by trade.js)
 *
 *   node experiments/fly-trader-worker.js --config <trade config> --repeats 0,4,8
 *
 * For each repeat and each hourly decision point, one choice trial:
 *   price went up   -> stimulate the LEFT eye  (VIS_R1R6 left neurons)
 *   price went down -> stimulate the RIGHT eye
 *   intensity = maxIntensity x min(1, |return| / fullScaleReturn)
 * The trial's choice (left / right / none) becomes buy / sell / hold.
 * The brain is reset before every decision, so each hour is judged on its own.
 * Writes experiments/results/<name>/fly/rep_<k>.json (skipped if it exists).
 */
'use strict';

var fs = require('fs');
var path = require('path');
var HeadlessBrain = require('./lib/headless-sim.js').HeadlessBrain;
var trial = require('./lib/choice-trial.js');
var market = require('./lib/market.js');
var common = require('./lib/trade-common.js');

function main() {
	var args = {};
	for (var i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
	var cfg = common.loadTradeConfig(args.config);
	var repeats = args.repeats.split(',').map(Number);
	var outDir = path.join(__dirname, 'results', cfg.name, 'fly');
	fs.mkdirSync(outDir, { recursive: true });

	var prices = market.loadPrices(path.join(__dirname, '..', cfg.prices));
	var points = market.decisionPoints(prices, cfg.intervalMin);
	var fullScale = common.fullScaleReturn(cfg, points);

	var brain = new HeadlessBrain();
	var out = trial.prepareReadout(brain, cfg.fly.readout);

	repeats.forEach(function (k) {
		var file = path.join(outDir, 'rep_' + String(k).padStart(2, '0') + '.json');
		if (fs.existsSync(file)) return;
		var decisions = points.map(function (p, j) {
			var amp = common.intensityFor(cfg, p.ret, fullScale);
			var tcfg = {
				warmupTicks: cfg.fly.warmupTicks,
				windowTicks: cfg.fly.windowTicks,
				noise: cfg.fly.noise,
				weightScale: cfg.fly.weightScale,
				params: cfg.fly.params || null,
				readout: cfg.fly.readout,
				stimulus: amp > 0 ? {
					groups: cfg.fly.stimulusGroups,
					left: p.ret > 0 ? amp : 0,
					right: p.ret < 0 ? amp : 0,
					balance: true
				} : null
			};
			var seed = cfg.fly.seed + k * 1000 + j;
			var r = trial.runTrial(brain, tcfg, out, seed);
			return {
				decision: j, seed: seed, ret: p.ret, intensity: amp,
				eye: p.ret > 0 ? 'left' : (p.ret < 0 ? 'right' : 'none'),
				choice: r.choice, d: r.d, spikesL: r.spikesL, spikesR: r.spikesR,
				action: r.choice === 'left' ? 'buy' : (r.choice === 'right' ? 'sell' : 'hold')
			};
		});
		fs.writeFileSync(file, JSON.stringify({ repeat: k, decisions: decisions }, null, 1) + '\n');
		console.log('repeat ' + k + ' done');
	});
}

main();
