#!/usr/bin/env node
/* periods.js — run trade.js for several configs and compare them in one table
 *
 *   node experiments/periods.js experiments/config/trade-stonkfly-window-fixed1pct.json experiments/config/periods/*.json
 *   node experiments/periods.js --only-table <same configs>
 *
 * All fly repeats of all configs go into one job pool (one repeat per job,
 * `--concurrency` at a time, default = CPU count), then trade.js --only-report
 * builds each period's report. The combined table is written to
 * experiments/results/periods/summary.md and summary.csv.
 *
 * "Is the fly's P&L explained by its number of trades?" is checked two ways:
 *   residual  = fly P&L − average P&L of random investors (fly's action rates)
 *               who executed the same number of orders in the same period
 *   fee check = (fly − rule investor) P&L vs (rule − fly) fees paid
 */
'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var childProcess = require('child_process');
var common = require('./lib/trade-common.js');
var stats = require('./lib/stats.js');

function parseArgs(argv) {
	var a = { configs: [], concurrency: os.cpus().length };
	for (var i = 2; i < argv.length; i++) {
		if (argv[i] === '--only-table') a.onlyTable = true;
		else if (argv[i] === '--concurrency') a.concurrency = +argv[++i];
		else a.configs.push(argv[i]);
	}
	return a;
}

function run(args) {
	return new Promise(function (resolve, reject) {
		var p = childProcess.spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'] });
		p.on('close', function (code) { code === 0 ? resolve() : reject(new Error(args.join(' ') + ' exited ' + code)); });
	});
}

function runPool(jobs, concurrency) {
	var total = jobs.length, done = 0, t0 = Date.now();
	return new Promise(function (resolve, reject) {
		var running = 0;
		function next() {
			if (!jobs.length && running === 0) return resolve();
			while (running < concurrency && jobs.length) {
				var j = jobs.shift();
				running++;
				run([path.join(__dirname, 'fly-trader-worker.js'), '--config', j.config, '--repeats', String(j.repeat)])
					.then(function () {
						running--; done++;
						var eta = (Date.now() - t0) / done * (total - done) / 60000;
						console.log('  [' + done + '/' + total + '] (~' + Math.round(eta) + ' min left)');
						next();
					}, reject);
			}
		}
		next();
	});
}

function money(x) { return (x >= 0 ? '+$' : '−$') + Math.abs(x).toFixed(2); }
function pct(x) { return (x >= 0 ? '+' : '') + (100 * x).toFixed(2) + '%'; }

function main() {
	var a = parseArgs(process.argv);
	var cfgs = a.configs.map(function (f) { return { file: f, cfg: common.loadTradeConfig(f) }; });
	var jobs = [];
	cfgs.forEach(function (c) {
		for (var k = 0; k < c.cfg.fly.repeats; k++) {
			var f = path.join(__dirname, 'results', c.cfg.name, 'fly', 'rep_' + String(k).padStart(2, '0') + '.json');
			if (!fs.existsSync(f)) jobs.push({ config: c.file, repeat: k });
		}
	});
	var p = Promise.resolve();
	if (!a.onlyTable) {
		console.log('fly repeats to run: ' + jobs.length);
		p = runPool(jobs, a.concurrency).then(function () {
			return cfgs.reduce(function (q, c) {
				return q.then(function () { return run([path.join(__dirname, 'trade.js'), '--config', c.file, '--only-report']); });
			}, Promise.resolve());
		});
	}
	p.then(function () { table(cfgs); }).catch(function (err) { console.error(err.message); process.exit(1); });
}

function table(cfgs) {
	var rows = cfgs.map(function (c) {
		var dir = path.join(__dirname, 'results', c.cfg.name);
		var s = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
		var runs = fs.readFileSync(path.join(dir, 'fly_runs.csv'), 'utf8').trim().split('\n').slice(1).map(function (l) {
			var x = l.split(',');
			return { pnl: +x[1], orders: +x[3], fees: +x[4], residual: +x[12] };
		});
		return { cfg: c.cfg, s: s, runs: runs };
	});

	var md = [];
	md.push('| 기간 | 구분 | 순수익률 | 초파리 손익 평균 [최저~최고] | 초파리 주문 | 규칙 투자자 손익 (주문) | 무작위 1만 명 평균 | 초파리 백분위: 무작위 / 같은 행동 비율 | 초파리 > 규칙 | 같은 주문 수 대비 잔차 [95% CI] | 초파리−규칙 손익 vs 수수료 차이 |');
	md.push('|---|---|---:|---|---:|---|---:|---|---:|---|---|');
	var csv = ['period,label,start_utc,end_utc,net_return,fly_repeats,fly_pnl_mean,fly_pnl_min,fly_pnl_max,fly_orders_mean,fly_fees_mean,rule_pnl,rule_orders,rule_fees,random_pnl_mean,fly_pctl_random,fly_pctl_matched,fly_beats_rule,residual_mean,residual_lo95,residual_hi95,fly_minus_rule_pnl,rule_minus_fly_fees'];
	var allResiduals = [];
	rows.forEach(function (r) {
		var s = r.s, f = s.fly, w = s.window;
		var label = r.cfg.label || '';
		var net = w.finalPrice / w.startPrice - 1; // same definition as select-periods.js
		var feesFly = r.runs.reduce(function (t, x) { return t + x.fees; }, 0) / r.runs.length;
		var diff = f.pnl.mean - s.rule.pnl, feeDiff = s.rule.fees - feesFly;
		var res = f.residualVsSameOrders;
		r.runs.forEach(function (x) { allResiduals.push(x.residual); });
		md.push('| ' + w.from.slice(0, 16).replace('T', ' ') + ' ~ ' + w.to.slice(5, 16).replace('T', ' ') + ' | ' + label + ' | ' + pct(net) + ' | ' +
			money(f.pnl.mean) + ' [' + money(f.pnl.min) + ' ~ ' + money(f.pnl.max) + '] (' + f.pnl.n + '회) | ' + f.ordersMean.toFixed(1) + ' | ' +
			money(s.rule.pnl) + ' (' + s.rule.orders + ') | ' + money(s.random.pnl.mean) + ' | ' +
			(100 * f.percentileInRandomMean).toFixed(0) + '% / ' + (100 * f.percentileInMatchedRandomMean).toFixed(0) + '% | ' +
			f.beatsRule + '/' + f.pnl.n + ' | ' + money(res.mean) + ' [' + money(res.lo) + ', ' + money(res.hi) + '] | ' +
			money(diff) + ' vs ' + money(feeDiff) + ' |');
		csv.push([r.cfg.name, label, w.from, w.to, net.toFixed(5), f.pnl.n, f.pnl.mean.toFixed(4), f.pnl.min.toFixed(4), f.pnl.max.toFixed(4),
			f.ordersMean.toFixed(2), feesFly.toFixed(4), s.rule.pnl.toFixed(4), s.rule.orders, s.rule.fees.toFixed(4), s.random.pnl.mean.toFixed(4),
			f.percentileInRandomMean.toFixed(4), f.percentileInMatchedRandomMean.toFixed(4), f.beatsRule, res.mean.toFixed(4), res.lo.toFixed(4),
			res.hi.toFixed(4), diff.toFixed(4), feeDiff.toFixed(4)].join(','));
	});
	var pooled = stats.meanCI(allResiduals);
	md.push('');
	md.push('- 모든 기간의 초파리 실행 ' + pooled.n + '회를 합친 잔차(같은 주문 수 무작위 대비): ' + money(pooled.mean) +
		' (95% CI ' + money(pooled.lo) + ' ~ ' + money(pooled.hi) + ')');
	var out = path.join(__dirname, 'results', 'periods');
	fs.mkdirSync(out, { recursive: true });
	fs.writeFileSync(path.join(out, 'summary.md'), md.join('\n') + '\n');
	fs.writeFileSync(path.join(out, 'summary.csv'), csv.join('\n') + '\n');
	console.log(md.join('\n'));
}

main();
