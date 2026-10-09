#!/usr/bin/env node
/* select-periods.js — pick test periods from btcusd_1h.csv by a fixed rule
 *
 *   node experiments/select-periods.js
 *
 * Rule (decided before looking at any fly result):
 *   1. candidates: every 26-hour window that starts at 00:00 UTC
 *      (27 hourly closes -> 26 hourly decisions, same as the STONKFLY window)
 *   2. drop windows that overlap the STONKFLY window or use the last row of the
 *      file (it may be an unfinished hour)
 *   3. R = net return from the first to the last close of the window
 *   4. pick the window whose R is closest to the 10th, 25th, 50th, 75th and 90th
 *      percentile of all candidates' R (no two picked windows may overlap;
 *      ties -> earlier date)
 *   5. label: R >= +1% up market, R <= -1% down market, |R| < 0.5% sideways,
 *      otherwise mild up / mild down
 * Writes experiments/config/periods/<id>.json (trade.js configs) and
 * experiments/results/periods/selection.md.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var market = require('./lib/market.js');

var BASE = path.join(__dirname, 'config', 'trade-stonkfly-window.json');
var PRICES = 'experiments/prices/btcusd_1h.csv';
var HOURS = 26;
var PERCENTILES = [0.10, 0.25, 0.50, 0.75, 0.90];
var EXCLUDE = [Date.parse('2026-09-10T11:34:00Z') / 1000, Date.parse('2026-09-11T14:14:00Z') / 1000];

function label(r) {
	if (r >= 0.01) return '상승장';
	if (r <= -0.01) return '하락장';
	if (Math.abs(r) < 0.005) return '횡보장';
	return r > 0 ? '약한 상승' : '약한 하락';
}

function pct(x) { return (x >= 0 ? '+' : '') + (100 * x).toFixed(2) + '%'; }

function main() {
	var prices = market.loadPrices(path.join(__dirname, '..', PRICES));
	var index = {};
	prices.forEach(function (p, i) { index[p.t] = i; });
	var lastUsable = prices.length - 2; // last row may be an unfinished hour

	var cands = [];
	prices.forEach(function (p, i) {
		if (p.t % 86400 !== 0) return;
		var j = i + HOURS;
		if (j > lastUsable || prices[j].t !== p.t + HOURS * 3600) return;
		var tStart = p.t, tEnd = prices[j].t + 3600;
		if (tStart < EXCLUDE[1] && tEnd > EXCLUDE[0]) return;
		var hi = -Infinity, lo = Infinity;
		for (var k = i; k <= j; k++) { hi = Math.max(hi, prices[k].close); lo = Math.min(lo, prices[k].close); }
		cands.push({ start: p.t, end: tEnd, r: prices[j].close / p.close - 1, range: hi / lo - 1, first: p.close, last: prices[j].close });
	});
	var sortedR = cands.map(function (c) { return c.r; }).sort(function (a, b) { return a - b; });
	function quantile(q) {
		var pos = (sortedR.length - 1) * q, a = Math.floor(pos), b = Math.ceil(pos);
		return sortedR[a] + (sortedR[b] - sortedR[a]) * (pos - a);
	}

	var picked = [];
	PERCENTILES.forEach(function (q) {
		var target = quantile(q);
		var order = cands.slice().sort(function (a, b) {
			return Math.abs(a.r - target) - Math.abs(b.r - target) || a.start - b.start;
		});
		for (var k = 0; k < order.length; k++) {
			var c = order[k];
			var clash = picked.some(function (p) { return c.start < p.end && c.end > p.start; });
			if (!clash) { picked.push(Object.assign({ q: q, target: target, label: label(c.r) }, c)); break; }
		}
	});

	var base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
	var cfgDir = path.join(__dirname, 'config', 'periods');
	var resDir = path.join(__dirname, 'results', 'periods');
	fs.mkdirSync(cfgDir, { recursive: true });
	fs.mkdirSync(resDir, { recursive: true });

	var md = [];
	md.push('# 기간 선택 (' + PRICES + ')');
	md.push('');
	md.push('규칙(초파리 결과를 보기 전에 정함): 00:00 UTC에 시작하는 26시간 기간 ' + cands.length + '개 중');
	md.push('(STONKFLY 기간과 겹치거나 파일 마지막 행을 쓰는 기간 제외) 순수익률 R의 10·25·50·75·90 백분위에 가장 가까운 기간을 서로 겹치지 않게 1개씩 고름.');
	md.push('이름: R ≥ +1% 상승장, R ≤ −1% 하락장, |R| < 0.5% 횡보장, 그 사이는 약한 상승/하락.');
	md.push('');
	md.push('후보 R 분포: 최소 ' + pct(sortedR[0]) + ', 10% ' + pct(quantile(0.1)) + ', 25% ' + pct(quantile(0.25)) + ', 중앙 ' + pct(quantile(0.5)) +
		', 75% ' + pct(quantile(0.75)) + ', 90% ' + pct(quantile(0.9)) + ', 최대 ' + pct(sortedR[sortedR.length - 1]));
	md.push('');
	md.push('| 기간 id | 백분위 목표 | 첫 종가 시각 (UTC) | 마지막 종가 시각 | 순수익률 R | 고가/저가 폭 | 구분 |');
	md.push('|---|---:|---|---|---:|---:|---|');
	picked.sort(function (a, b) { return a.start - b.start; }).forEach(function (c) {
		var startIso = new Date(c.start * 1000).toISOString();
		var id = 'p' + startIso.slice(0, 10).replace(/-/g, '');
		var cfg = JSON.parse(JSON.stringify(base));
		cfg._comment = c.label + ' (R ' + pct(c.r) + ', 백분위 ' + Math.round(c.q * 100) + ' 목표). select-periods.js가 만든 설정. fullScaleReturn은 고정 1%.';
		cfg.name = 'periods/' + id;
		cfg.prices = PRICES;
		cfg.window = { start: startIso, hours: HOURS };
		cfg.fly.repeats = 10;
		cfg.fly.seed = 600000 + Math.round(c.q * 100) * 10000;
		cfg.fly.fullScaleReturn = 0.01;
		cfg.label = c.label;
		fs.writeFileSync(path.join(cfgDir, id + '.json'), JSON.stringify(cfg, null, 2) + '\n');
		md.push('| ' + id + ' | ' + Math.round(c.q * 100) + '% (' + pct(c.target) + ') | ' + new Date((c.start + 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ') +
			' | ' + new Date(c.end * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' | ' + pct(c.r) + ' | ' + pct(c.range) + ' | ' + c.label + ' |');
	});
	fs.writeFileSync(path.join(resDir, 'selection.md'), md.join('\n') + '\n');
	console.log(md.join('\n'));
}

main();
