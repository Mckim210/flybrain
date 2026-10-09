#!/usr/bin/env node
/* trade.js — fly investor vs rule investor vs random investors on one price window
 *
 * Usage:
 *   node experiments/trade.js --config experiments/config/trade-stonkfly-window.json
 *   node experiments/trade.js --config ... --only-report    (re-analyse existing fly runs)
 *
 * Steps:
 *   1. fly investor: run missing repeats with fly-trader-worker.js (parallel)
 *   2. rule investor: up -> buy, down -> sell (no brain, one deterministic result)
 *   3. random investors: buy/sell/hold uniformly at random, 10,000 people;
 *      plus a reference group that uses the fly's own average buy/sell/hold rates
 *   4. same portfolio rules for everyone (lib/market.js)
 * Writes experiments/results/<name>/: summary.json, table.md, fly_runs.csv,
 * decisions.csv, random_pnl.csv, chart.html
 */
'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var childProcess = require('child_process');
var market = require('./lib/market.js');
var common = require('./lib/trade-common.js');
var makeRng = require('./lib/headless-sim.js').makeRng;
var renderChart = require('./lib/trade-chart.js').renderChart;

function parseArgs(argv) {
	var args = {};
	for (var i = 2; i < argv.length; i++) {
		if (argv[i] === '--only-report') { args.onlyReport = true; continue; }
		args[argv[i].replace(/^--/, '')] = argv[++i];
	}
	return args;
}

function runFlyWorkers(cfg, configFile, flyDir) {
	var missing = [];
	for (var k = 0; k < cfg.fly.repeats; k++) {
		if (!fs.existsSync(path.join(flyDir, 'rep_' + String(k).padStart(2, '0') + '.json'))) missing.push(k);
	}
	if (!missing.length) return Promise.resolve();
	var n = Math.min(cfg.concurrency || os.cpus().length, missing.length);
	console.log('fly investor: ' + missing.length + ' repeats to run on ' + n + ' processes');
	var jobs = [];
	for (var w = 0; w < n; w++) {
		var reps = missing.filter(function (_, i) { return i % n === w; });
		jobs.push(new Promise(function (resolve, reject) {
			var p = childProcess.spawn(process.execPath,
				[path.join(__dirname, 'fly-trader-worker.js'), '--config', configFile, '--repeats', reps.join(',')],
				{ stdio: ['ignore', 'inherit', 'inherit'] });
			p.on('close', function (code) { code === 0 ? resolve() : reject(new Error('worker exited ' + code)); });
		}));
	}
	return Promise.all(jobs);
}

function quantile(sorted, q) {
	var pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function describe(xs) {
	var s = xs.slice().sort(function (a, b) { return a - b; });
	var n = s.length, m = s.reduce(function (a, b) { return a + b; }, 0) / n;
	var sd = n > 1 ? Math.sqrt(s.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / (n - 1)) : 0;
	return {
		n: n, mean: m, sd: sd, min: s[0], p5: quantile(s, 0.05), p25: quantile(s, 0.25), median: quantile(s, 0.5),
		p75: quantile(s, 0.75), p95: quantile(s, 0.95), max: s[n - 1],
		shareProfit: s.filter(function (x) { return x > 0; }).length / n,
		shareAtLeast1: s.filter(function (x) { return x >= 1; }).length / n
	};
}

/* share of values strictly below x plus half of ties (mid-rank percentile) */
function percentileOf(sorted, x) {
	var below = 0, equal = 0;
	for (var i = 0; i < sorted.length; i++) {
		if (sorted[i] < x) below++; else if (sorted[i] === x) equal++;
	}
	return (below + equal / 2) / sorted.length;
}

function money(x) { return (x >= 0 ? '+$' : '−$') + Math.abs(x).toFixed(2); }
function pct(x) { return (100 * x).toFixed(1) + '%'; }

function main() {
	var args = parseArgs(process.argv);
	var cfg = common.loadTradeConfig(args.config);
	var outDir = path.join(__dirname, 'results', cfg.name);
	var flyDir = path.join(outDir, 'fly');
	fs.mkdirSync(flyDir, { recursive: true });

	var p = args.onlyReport ? Promise.resolve() : runFlyWorkers(cfg, args.config, flyDir);
	p.then(function () { report(cfg, outDir, flyDir); })
		.catch(function (err) { console.error(err.message); process.exit(1); });
}

function report(cfg, outDir, flyDir) {
	var prices = market.loadPrices(path.join(__dirname, '..', cfg.prices));
	var points = market.decisionPoints(prices, cfg.intervalMin);
	var finalPrice = prices[prices.length - 1].close;
	var fullScale = common.fullScaleReturn(cfg, points);
	var R = cfg.rules;

	/* (2) rule investor */
	var ruleAct = market.ruleActions(points);
	var rule = market.simulate(ruleAct, points, finalPrice, R);

	/* (1) fly investor */
	var flyRuns = [];
	for (var k = 0; k < cfg.fly.repeats; k++) {
		var rep = JSON.parse(fs.readFileSync(path.join(flyDir, 'rep_' + String(k).padStart(2, '0') + '.json'), 'utf8'));
		var acts = rep.decisions.map(function (d) { return d.action; });
		var sim = market.simulate(acts, points, finalPrice, R);
		var agree = acts.filter(function (a, j) { return a === ruleAct[j]; }).length;
		var opposite = acts.filter(function (a, j) {
			return (a === 'buy' && ruleAct[j] === 'sell') || (a === 'sell' && ruleAct[j] === 'buy');
		}).length;
		flyRuns.push({ repeat: k, actions: acts, decisions: rep.decisions, sim: sim, agree: agree, opposite: opposite });
	}
	var flyPnl = flyRuns.map(function (r) { return r.sim.pnl; });

	/* fly's average action rates (for the matched random group) */
	var cnt = { buy: 0, sell: 0, hold: 0 };
	flyRuns.forEach(function (r) { r.actions.forEach(function (a) { cnt[a]++; }); });
	var totalActs = cnt.buy + cnt.sell + cnt.hold;
	var flyProbs = { buy: cnt.buy / totalActs, sell: cnt.sell / totalActs, hold: cnt.hold / totalActs };

	/* (3) random investors */
	function randomGroup(probs, seed) {
		var rng = makeRng(seed);
		var pnl = new Array(cfg.random.investors);
		for (var i = 0; i < pnl.length; i++) {
			pnl[i] = market.simulate(market.randomActions(points, rng, probs), points, finalPrice, R).pnl;
		}
		return pnl;
	}
	var randPnl = randomGroup(cfg.random.probs, cfg.random.seed);
	var matchedPnl = randomGroup(flyProbs, cfg.random.seed + 1);
	var randSorted = randPnl.slice().sort(function (a, b) { return a - b; });
	var matchedSorted = matchedPnl.slice().sort(function (a, b) { return a - b; });

	var flyD = describe(flyPnl), randD = describe(randPnl), matchedD = describe(matchedPnl);
	var flyPctl = flyPnl.map(function (x) { return percentileOf(randSorted, x); });
	var meanPctl = flyPctl.reduce(function (a, b) { return a + b; }, 0) / flyPctl.length;
	var rulePctl = percentileOf(randSorted, rule.pnl);
	var flyBeatsRule = flyPnl.filter(function (x) { return x > rule.pnl + 1e-9; }).length;
	var flyTiesRule = flyPnl.filter(function (x) { return Math.abs(x - rule.pnl) <= 1e-9; }).length;
	var agreeRates = flyRuns.map(function (r) { return r.agree / points.length; });
	var oppositeTotal = flyRuns.reduce(function (s, r) { return s + r.opposite; }, 0);
	var buyHold = (finalPrice / points[0].price - 1);

	/* per-decision behaviour across repeats */
	var perDecision = points.map(function (pt, j) {
		var c = { buy: 0, sell: 0, hold: 0 };
		flyRuns.forEach(function (r) { c[r.actions[j]]++; });
		var n = flyRuns.length;
		return {
			decision: j + 1, time: pt.iso, price: pt.price, ret: pt.ret,
			eye: pt.ret > 0 ? 'left' : (pt.ret < 0 ? 'right' : 'none'),
			intensity: common.intensityFor(cfg, pt.ret, fullScale),
			rule: ruleAct[j], buy: c.buy / n, sell: c.sell / n, hold: c.hold / n,
			followsRule: (ruleAct[j] === 'hold' ? c.hold : c[ruleAct[j]]) / n,
			ruleExecuted: rule.executed[j].action
		};
	});

	/* ---- files ---- */
	var fr = ['repeat,final_pnl_usd,final_value_usd,orders,fees_usd,buy_signals,sell_signals,hold_signals,agree_with_rule,opposite_of_rule,percentile_in_random'];
	flyRuns.forEach(function (r, i) {
		var c = { buy: 0, sell: 0, hold: 0 };
		r.actions.forEach(function (a) { c[a]++; });
		fr.push([r.repeat, r.sim.pnl.toFixed(4), r.sim.finalValue.toFixed(4), r.sim.orders, r.sim.fees.toFixed(4),
			c.buy, c.sell, c.hold, r.agree, r.opposite, flyPctl[i].toFixed(4)].join(','));
	});
	fs.writeFileSync(path.join(outDir, 'fly_runs.csv'), fr.join('\n') + '\n');

	var dc = ['decision,time_utc,price,return_1h,eye,intensity,rule_action,rule_executed,fly_buy_share,fly_sell_share,fly_hold_share,fly_follows_rule_share'];
	perDecision.forEach(function (d) {
		dc.push([d.decision, d.time, d.price, d.ret.toFixed(6), d.eye, d.intensity.toFixed(4), d.rule, d.ruleExecuted,
			d.buy.toFixed(4), d.sell.toFixed(4), d.hold.toFixed(4), d.followsRule.toFixed(4)].join(','));
	});
	fs.writeFileSync(path.join(outDir, 'decisions.csv'), dc.join('\n') + '\n');
	fs.writeFileSync(path.join(outDir, 'random_pnl.csv'), 'investor,final_pnl_usd\n' +
		randPnl.map(function (x, i) { return (i + 1) + ',' + x.toFixed(4); }).join('\n') + '\n');

	var summary = {
		config: cfg,
		window: { from: new Date(prices[0].t * 1000).toISOString(), to: new Date(prices[prices.length - 1].t * 1000).toISOString(),
			startPrice: prices[0].close, firstDecisionPrice: points[0].price, finalPrice: finalPrice, decisions: points.length,
			up: points.filter(function (p) { return p.ret > 0; }).length, down: points.filter(function (p) { return p.ret < 0; }).length,
			fullScaleReturn: fullScale, priceChangeFromFirstDecision: buyHold },
		rule: { pnl: rule.pnl, orders: rule.orders, fees: rule.fees, percentileInRandom: rulePctl },
		fly: { pnl: flyD, percentileInRandomMean: meanPctl, beatsRule: flyBeatsRule, tiesRule: flyTiesRule,
			agreeWithRuleMean: agreeRates.reduce(function (a, b) { return a + b; }, 0) / agreeRates.length,
			oppositeOfRuleShare: oppositeTotal / (flyRuns.length * points.length), actionRates: flyProbs },
		random: { pnl: randD, probs: cfg.random.probs },
		randomMatched: { pnl: matchedD, probs: flyProbs },
		perDecision: perDecision
	};
	fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

	/* ---- markdown table ---- */
	function row(name, d) {
		return '| ' + name + ' | ' + d.n + ' | ' + money(d.mean) + ' | ' + money(d.median) + ' | ' + money(d.min) + ' | ' +
			money(d.p5) + ' ~ ' + money(d.p95) + ' | ' + money(d.max) + ' | ' + pct(d.shareProfit) + ' | ' + pct(d.shareAtLeast1) + ' |';
	}
	var md = [];
	md.push('## 최종 손익 분포 (' + summary.window.from.slice(0, 16) + ' ~ ' + summary.window.to.slice(0, 16) + ' UTC, 결정 ' + points.length + '회)');
	md.push('');
	md.push('| 투자자 | 사람/반복 수 | 평균 | 중앙값 | 최저 | 5%~95% 범위 | 최고 | 이익 낸 비율 | $1 이상 비율 |');
	md.push('|---|---:|---:|---:|---:|---|---:|---:|---:|');
	md.push(row('(1) 초파리 (시드 ' + cfg.fly.repeats + '개)', flyD));
	md.push('| (2) 규칙 투자자 (오르면 매수·내리면 매도) | 1 | ' + money(rule.pnl) + ' | ' + money(rule.pnl) + ' | ' + money(rule.pnl) +
		' | - | ' + money(rule.pnl) + ' | ' + (rule.pnl > 0 ? '100%' : '0%') + ' | ' + (rule.pnl >= 1 ? '100%' : '0%') + ' |');
	md.push(row('(3) 무작위 1만 명 (매수·매도·보유 각 1/3)', randD));
	md.push(row('(참고) 무작위 1만 명, 초파리와 같은 행동 비율', matchedD));
	md.push('');
	md.push('- 초파리 행동 비율: 매수 ' + pct(flyProbs.buy) + ', 매도 ' + pct(flyProbs.sell) + ', 보유 ' + pct(flyProbs.hold));
	md.push('- 초파리가 규칙 투자자와 같은 행동을 한 비율(신호 기준): 평균 ' + pct(summary.fly.agreeWithRuleMean) +
		', 정반대 행동(규칙은 매수인데 매도 등): ' + pct(summary.fly.oppositeOfRuleShare));
	md.push('- 초파리 ' + cfg.fly.repeats + '회 중 규칙 투자자보다 손익이 높은 회차: ' + flyBeatsRule + ', 같은 회차: ' + flyTiesRule);
	md.push('- 무작위 1만 명 안에서의 백분위: 규칙 투자자 ' + pct(rulePctl) + ', 초파리 평균 ' + pct(meanPctl));
	md.push('- 첫 결정 시점 대비 마지막 가격 변화: ' + pct(buyHold) + ' (' + points[0].price + ' → ' + finalPrice + ' USD)');
	md.push('');
	md.push('## 결정 시점별 초파리 행동 (' + cfg.fly.repeats + '회 중 비율)');
	md.push('');
	md.push('| # | 시각 (UTC) | 직전 1시간 수익률 | 자극 (눈, 세기) | 규칙 투자자 | 초파리 매수 | 매도 | 보유 | 규칙과 같은 행동 |');
	md.push('|---:|---|---:|---|---|---:|---:|---:|---:|');
	var KO = { buy: '매수', sell: '매도', hold: '보유', left: '왼쪽', right: '오른쪽', none: '없음' };
	perDecision.forEach(function (d) {
		md.push('| ' + d.decision + ' | ' + d.time + ' | ' + (d.ret >= 0 ? '+' : '') + (100 * d.ret).toFixed(3) + '% | ' +
			KO[d.eye] + ' ' + d.intensity.toFixed(2) + ' | ' + KO[d.rule] + (d.ruleExecuted !== d.rule ? ' (체결 안 됨)' : '') + ' | ' +
			pct(d.buy) + ' | ' + pct(d.sell) + ' | ' + pct(d.hold) + ' | ' + pct(d.followsRule) + ' |');
	});
	fs.writeFileSync(path.join(outDir, 'table.md'), md.join('\n') + '\n');

	fs.writeFileSync(path.join(outDir, 'chart.html'), renderChart(summary, flyRuns.map(function (r, i) {
		return { repeat: r.repeat, pnl: r.sim.pnl, orders: r.sim.orders, agree: r.agree, pctl: flyPctl[i] };
	}), randPnl));

	console.log(md.join('\n'));
	console.log('\n결과 저장: ' + path.relative(process.cwd(), outDir));
}

main();
