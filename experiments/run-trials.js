#!/usr/bin/env node
/* run-trials.js — repeat left/right choice trials and test against 50:50
 *
 * Usage:
 *   node experiments/run-trials.js --config experiments/config/baseline.json
 *   node experiments/run-trials.js --config experiments/config/baseline.json --trials 20 --seed 7 --name quick
 *
 * Writes experiments/results/<name>/trials.csv and summary.json, and prints a table.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var HeadlessBrain = require('./lib/headless-sim.js').HeadlessBrain;
var trial = require('./lib/choice-trial.js');
var stats = require('./lib/stats.js');

var DEFAULTS = {
	name: 'run',
	trials: 100,
	seed: 1,
	warmupTicks: 20,
	windowTicks: 50,
	noise: { rate: 0.005, amplitude: 1.0 },
	stimulus: null,
	readout: { superClass: 'descending', minSpikes: 10, margin: 0.2 },
	params: null
};

function parseArgs(argv) {
	var args = {};
	for (var i = 2; i < argv.length; i++) {
		var a = argv[i];
		if (a.slice(0, 2) !== '--') throw new Error('unexpected argument: ' + a);
		args[a.slice(2)] = argv[++i];
	}
	return args;
}

function loadConfig(args) {
	var cfg = JSON.parse(JSON.stringify(DEFAULTS));
	if (args.config) {
		var file = JSON.parse(fs.readFileSync(args.config, 'utf8'));
		for (var k in file) {
			if (k.charAt(0) === '_') continue; // "_comment" keys are notes for people
			cfg[k] = file[k];
		}
	}
	if (args.trials) cfg.trials = parseInt(args.trials, 10);
	if (args.seed) cfg.seed = parseInt(args.seed, 10);
	if (args.name) cfg.name = args.name;
	return cfg;
}

function pct(x) { return (100 * x).toFixed(1) + '%'; }

function main() {
	var args = parseArgs(process.argv);
	var cfg = loadConfig(args);
	var outDir = path.join(__dirname, 'results', cfg.name);
	fs.mkdirSync(outDir, { recursive: true });

	console.log('[' + cfg.name + '] loading connectome...');
	var t0 = Date.now();
	var brain = new HeadlessBrain();
	var out = trial.prepareReadout(brain, cfg.readout);
	console.log('  ' + brain.N + ' neurons, ' + brain.edgeCount + ' edges (' + (Date.now() - t0) + ' ms)');
	console.log('  readout neurons: left ' + out.left.length + ', right ' + out.right.length);

	var rows = [];
	var G = brain.groupNames.length;
	var sumGroupL = new Float64Array(G), sumGroupR = new Float64Array(G);
	t0 = Date.now();
	for (var n = 0; n < cfg.trials; n++) {
		var r = trial.runTrial(brain, cfg, out, cfg.seed + n);
		for (var g = 0; g < G; g++) { sumGroupL[g] += r.groupL[g]; sumGroupR[g] += r.groupR[g]; }
		rows.push(r);
		if ((n + 1) % 10 === 0 || n + 1 === cfg.trials) {
			var eta = (Date.now() - t0) / (n + 1) * (cfg.trials - n - 1) / 1000;
			console.log('  trial ' + (n + 1) + '/' + cfg.trials + '  (~' + eta.toFixed(0) + ' s left)');
		}
	}

	/* trials.csv */
	var csv = ['trial,seed,choice,reason,spikes_left,spikes_right,rate_left,rate_right,lateralization_d,total_spikes,stim_neurons_left,stim_neurons_right'];
	rows.forEach(function (r, i) {
		csv.push([i + 1, r.seed, r.choice, r.reason, r.spikesL, r.spikesR, r.rateL.toFixed(5), r.rateR.toFixed(5),
			r.d.toFixed(4), r.totalSpikes, r.stimNeuronsL, r.stimNeuronsR].join(','));
	});
	fs.writeFileSync(path.join(outDir, 'trials.csv'), csv.join('\n') + '\n');

	/* summary */
	var nL = rows.filter(function (r) { return r.choice === 'left'; }).length;
	var nR = rows.filter(function (r) { return r.choice === 'right'; }).length;
	var nNone = rows.length - nL - nR;
	var nFew = rows.filter(function (r) { return r.reason === 'too_few_spikes'; }).length;
	var decided = nL + nR;
	var pBinom = stats.binomTwoSided(nL, decided, 0.5);
	var ciLeft = stats.wilson(nL, decided);
	var active = rows.filter(function (r) { return r.spikesL + r.spikesR > 0; });
	var dStats = stats.meanCI(active.map(function (r) { return r.d; }));
	var totL = rows.reduce(function (s, r) { return s + r.spikesL; }, 0);
	var totR = rows.reduce(function (s, r) { return s + r.spikesR; }, 0);

	var groups = [];
	for (var g = 0; g < G; g++) {
		if (sumGroupL[g] + sumGroupR[g] === 0) continue;
		groups.push({ group: brain.groupNames[g], left: sumGroupL[g], right: sumGroupR[g] });
	}
	groups.sort(function (a, b) { return (b.left + b.right) - (a.left + a.right); });

	var summary = {
		config: cfg,
		trials: rows.length,
		counts: { left: nL, right: nR, none: nNone, none_too_few_spikes: nFew, none_too_close: nNone - nFew },
		decided: decided,
		left_share_of_decided: decided ? nL / decided : null,
		left_share_95ci: ciLeft,
		binomial_p_two_sided: pBinom,
		readout_spikes_total: { left: totL, right: totR },
		lateralization_d: dStats,
		top_groups_by_spikes: groups.slice(0, 10),
		seconds: (Date.now() - t0) / 1000
	};
	fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

	/* table */
	console.log('\n| 판정 | 횟수 | 비율 |');
	console.log('|---|---:|---:|');
	console.log('| 왼쪽 선택 | ' + nL + ' | ' + pct(nL / rows.length) + ' |');
	console.log('| 오른쪽 선택 | ' + nR + ' | ' + pct(nR / rows.length) + ' |');
	console.log('| 무반응 (발화 부족) | ' + nFew + ' | ' + pct(nFew / rows.length) + ' |');
	console.log('| 무반응 (차이 작음) | ' + (nNone - nFew) + ' | ' + pct((nNone - nFew) / rows.length) + ' |');
	console.log('| 합계 | ' + rows.length + ' | 100% |');
	if (decided) {
		console.log('\n결정한 시행 중 왼쪽 비율: ' + pct(nL / decided) + ' (95% CI ' + pct(ciLeft[0]) + '~' + pct(ciLeft[1]) +
			'), 이항검정(50:50) p = ' + pBinom.toPrecision(3));
	} else {
		console.log('\n결정한 시행이 없어 이항검정을 할 수 없음');
	}
	if (dStats.n) {
		console.log('편향 지수 d 평균 (+면 왼쪽): ' + dStats.mean.toFixed(4) +
			(dStats.lo !== null ? ' (95% CI ' + dStats.lo.toFixed(4) + ' ~ ' + dStats.hi.toFixed(4) + ', n=' + dStats.n + ')' : ''));
	}
	console.log('하행 뉴런 총 발화: 왼쪽 ' + totL + ', 오른쪽 ' + totR);
	console.log('결과 저장: ' + path.relative(process.cwd(), outDir));
}

main();
