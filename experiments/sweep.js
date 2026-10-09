#!/usr/bin/env node
/* sweep.js — dose-response sweep over stimulus group x intensity x side
 *
 * Usage:
 *   node experiments/sweep.js --config experiments/config/dose-response.json
 *   node experiments/sweep.js --config experiments/config/dose-response.json --only-table
 *
 * Each condition is one run-trials.js process (run in parallel, `concurrency`
 * at a time). Every condition uses the SAME seeds, so trial i of "left only"
 * and trial i of "right only" share exactly the same background noise. The
 * per-trial difference  Δd = d(left-only) − d(right-only)  therefore isolates
 * the effect of the stimulus side.
 *
 * Writes experiments/results/<name>/table.md, table.csv, summary.json.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var stats = require('./lib/stats.js');

function parseArgs(argv) {
	var args = {};
	for (var i = 2; i < argv.length; i++) {
		var a = argv[i];
		if (a.slice(0, 2) !== '--') throw new Error('unexpected argument: ' + a);
		if (a === '--only-table') { args.onlyTable = true; continue; }
		args[a.slice(2)] = argv[++i];
	}
	return args;
}

function fmtNum(x) { return String(x).replace('.', 'p'); }

/* Build the list of conditions. Each gets its own run-trials config. */
function buildConditions(sw) {
	var conds = [];
	var wsList = sw.weightScales || [1];
	var thList = sw.thresholds || [1.0];
	wsList.forEach(function (ws) {
		thList.forEach(function (th) {
			var tag = 'w' + fmtNum(ws) + '_t' + fmtNum(th);
			function make(id, stimulus, meta) {
				var cfg = JSON.parse(JSON.stringify(sw.base));
				cfg.name = sw.name + '/runs/' + id;
				cfg.trials = sw.trials;
				cfg.seed = sw.seed;
				cfg.stimulus = stimulus;
				cfg.weightScale = ws;
				cfg.params = Object.assign({}, cfg.params || {}, { threshold: th });
				meta.id = id; meta.weightScale = ws; meta.threshold = th; meta.cfg = cfg;
				conds.push(meta);
			}
			if (sw.includeBaseline !== false) {
				make('none_' + tag, null, { group: '(자극 없음)', intensity: 0, side: 'none' });
			}
			sw.groups.forEach(function (g) {
				sw.intensities.forEach(function (amp) {
					['left', 'right'].forEach(function (side) {
						make(g + '_' + side + '_i' + fmtNum(amp) + '_' + tag, {
							groups: [g],
							left: side === 'left' ? amp : 0,
							right: side === 'right' ? amp : 0,
							balance: true
						}, { group: g, intensity: amp, side: side });
					});
				});
			});
		});
	});
	return conds;
}

function runAll(conds, outDir, concurrency) {
	var cfgDir = path.join(outDir, 'configs');
	fs.mkdirSync(cfgDir, { recursive: true });
	var queue = conds.filter(function (c) {
		var done = path.join(__dirname, 'results', c.cfg.name, 'summary.json');
		if (fs.existsSync(done)) { console.log('  skip (already done): ' + c.id); return false; }
		return true;
	});
	var total = queue.length, finished = 0, t0 = Date.now();
	return new Promise(function (resolve, reject) {
		var running = 0;
		function next() {
			if (!queue.length && running === 0) return resolve();
			while (running < concurrency && queue.length) {
				var c = queue.shift();
				var file = path.join(cfgDir, c.id + '.json');
				fs.writeFileSync(file, JSON.stringify(c.cfg, null, 2) + '\n');
				running++;
				(function (c) {
					var p = childProcess.spawn(process.execPath,
						[path.join(__dirname, 'run-trials.js'), '--config', file], { stdio: ['ignore', 'ignore', 'pipe'] });
					var err = '';
					p.stderr.on('data', function (d) { err += d; });
					p.on('close', function (code) {
						running--;
						if (code !== 0) return reject(new Error(c.id + ' failed:\n' + err));
						finished++;
						var eta = (Date.now() - t0) / finished * (total - finished) / 1000;
						console.log('  [' + finished + '/' + total + '] ' + c.id + '  (~' + Math.round(eta / 60) + ' min left)');
						next();
					});
				})(c);
			}
		}
		next();
	});
}

function readTrials(c) {
	var file = path.join(__dirname, 'results', c.cfg.name, 'trials.csv');
	var lines = fs.readFileSync(file, 'utf8').trim().split('\n');
	var head = lines[0].split(',');
	return lines.slice(1).map(function (l) {
		var cols = l.split(','), r = {};
		head.forEach(function (h, i) { r[h] = cols[i]; });
		return r;
	});
}

/* two-sided t critical value for 95% (Cornish-Fisher expansion, good for df >= 5) */
function tCrit95(df) {
	var z = 1.959963984540054;
	return z + (z * z * z + z) / (4 * df) + (5 * Math.pow(z, 5) + 16 * Math.pow(z, 3) + 3 * z) / (96 * df * df);
}

function pairedSummary(diffs) {
	var n = diffs.length;
	var m = diffs.reduce(function (s, x) { return s + x; }, 0) / n;
	var v = diffs.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (n - 1);
	var half = tCrit95(n - 1) * Math.sqrt(v / n);
	return { n: n, mean: m, lo: m - half, hi: m + half };
}

function mean(xs) { return xs.reduce(function (s, x) { return s + x; }, 0) / xs.length; }

function buildTable(sw, conds, outDir) {
	var byId = {};
	conds.forEach(function (c) { byId[c.id] = c; });
	var rows = [];
	var baselines = {};
	conds.filter(function (c) { return c.side === 'none'; }).forEach(function (c) {
		var t = readTrials(c);
		baselines[c.weightScale + '|' + c.threshold] = {
			desc: mean(t.map(function (r) { return +r.spikes_left + +r.spikes_right; })),
			total: mean(t.map(function (r) { return +r.total_spikes; })),
			d: mean(t.map(function (r) { return +r.lateralization_d; }))
		};
	});
	conds.filter(function (c) { return c.side === 'left'; }).forEach(function (cl) {
		var cr = byId[cl.id.replace('_left_', '_right_')];
		var tl = readTrials(cl), tr = readTrials(cr);
		var diffs = [];
		for (var i = 0; i < tl.length; i++) {
			if (tl[i].seed !== tr[i].seed) throw new Error('seed mismatch in ' + cl.id);
			diffs.push(+tl[i].lateralization_d - +tr[i].lateralization_d);
		}
		var ps = pairedSummary(diffs);
		function choices(t) {
			var L = 0, R = 0;
			t.forEach(function (r) { if (r.choice === 'left') L++; else if (r.choice === 'right') R++; });
			return { left: L, right: R, none: t.length - L - R };
		}
		var base = baselines[cl.weightScale + '|' + cl.threshold];
		rows.push({
			weightScale: cl.weightScale,
			threshold: cl.threshold,
			group: cl.group,
			intensity: cl.intensity,
			d_left_stim: mean(tl.map(function (r) { return +r.lateralization_d; })),
			d_right_stim: mean(tr.map(function (r) { return +r.lateralization_d; })),
			delta_d: ps.mean, delta_lo: ps.lo, delta_hi: ps.hi,
			signal: ps.lo > 0 || ps.hi < 0,
			choices_left_stim: choices(tl),
			choices_right_stim: choices(tr),
			desc_spikes_per_trial: mean(tl.concat(tr).map(function (r) { return +r.spikes_left + +r.spikes_right; })),
			baseline_desc_spikes_per_trial: base ? base.desc : null,
			stim_neurons_per_side: +tl[0].stim_neurons_left
		});
	});

	var multi = (sw.weightScales || [1]).length > 1 || (sw.thresholds || [1]).length > 1;
	var md = [];
	md.push('| ' + (multi ? '가중치 배율 | 문턱 | ' : '') + '자극 그룹 (좌/우 각 뉴런 수) | 세기 | d (왼쪽만 자극) | d (오른쪽만 자극) | Δd = 왼−오 [95% CI] | 신호 | 선택 L/R/무 (왼쪽 자극) | 선택 L/R/무 (오른쪽 자극) | 하행 발화/시행 (기준) |');
	md.push('|' + (multi ? '---:|---:|' : '') + '---|---:|---:|---:|---|:---:|---|---|---:|');
	rows.forEach(function (r) {
		function f(x) { return (x >= 0 ? '+' : '') + x.toFixed(3); }
		function ch(c) { return c.left + '/' + c.right + '/' + c.none; }
		md.push('| ' + (multi ? r.weightScale + ' | ' + r.threshold + ' | ' : '') +
			r.group + ' (' + r.stim_neurons_per_side + ') | ' + r.intensity + ' | ' + f(r.d_left_stim) + ' | ' + f(r.d_right_stim) + ' | ' +
			f(r.delta_d) + ' [' + f(r.delta_lo) + ', ' + f(r.delta_hi) + '] | ' + (r.signal ? '**있음**' : '-') + ' | ' +
			ch(r.choices_left_stim) + ' | ' + ch(r.choices_right_stim) + ' | ' +
			r.desc_spikes_per_trial.toFixed(1) + (r.baseline_desc_spikes_per_trial !== null ? ' (' + r.baseline_desc_spikes_per_trial.toFixed(1) + ')' : '') + ' |');
	});
	fs.writeFileSync(path.join(outDir, 'table.md'), md.join('\n') + '\n');

	var csv = ['weight_scale,threshold,group,intensity,stim_neurons_per_side,d_left_stim,d_right_stim,delta_d,delta_lo95,delta_hi95,signal,left_stim_L,left_stim_R,left_stim_none,right_stim_L,right_stim_R,right_stim_none,desc_spikes_per_trial,baseline_desc_spikes_per_trial'];
	rows.forEach(function (r) {
		csv.push([r.weightScale, r.threshold, r.group, r.intensity, r.stim_neurons_per_side,
			r.d_left_stim.toFixed(4), r.d_right_stim.toFixed(4), r.delta_d.toFixed(4), r.delta_lo.toFixed(4), r.delta_hi.toFixed(4), r.signal,
			r.choices_left_stim.left, r.choices_left_stim.right, r.choices_left_stim.none,
			r.choices_right_stim.left, r.choices_right_stim.right, r.choices_right_stim.none,
			r.desc_spikes_per_trial.toFixed(2), r.baseline_desc_spikes_per_trial === null ? '' : r.baseline_desc_spikes_per_trial.toFixed(2)].join(','));
	});
	fs.writeFileSync(path.join(outDir, 'table.csv'), csv.join('\n') + '\n');
	fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ sweep: sw, baselines: baselines, rows: rows }, null, 2) + '\n');
	console.log('\n' + md.join('\n'));
	console.log('\n결과 저장: ' + path.relative(process.cwd(), outDir));
}

function main() {
	var args = parseArgs(process.argv);
	var sw = JSON.parse(fs.readFileSync(args.config, 'utf8'));
	if (args.name) sw.name = args.name;
	if (args.trials) sw.trials = parseInt(args.trials, 10);
	var outDir = path.join(__dirname, 'results', sw.name);
	fs.mkdirSync(outDir, { recursive: true });
	var conds = buildConditions(sw);
	console.log('[' + sw.name + '] ' + conds.length + ' conditions x ' + sw.trials + ' trials');
	var p = args.onlyTable ? Promise.resolve()
		: runAll(conds, outDir, sw.concurrency || require('os').cpus().length);
	p.then(function () { buildTable(sw, conds, outDir); })
		.catch(function (err) { console.error(err.message); process.exit(1); });
}

main();
