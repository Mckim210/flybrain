#!/usr/bin/env node
/* check-symmetry.js — [exploratory] are the left and right eyes equally responsive?
 *
 *   node experiments/market/check-symmetry.js
 *
 * Re-reads the fly decisions already saved by the trade experiments
 * (weightScale 20 only: robust-w10 is excluded) and tabulates, per eye and
 * intensity bin, how often the fly chose the stimulated side. Some runs share
 * seeds, so the trials are not fully independent.
 * Writes experiments/market/results/symmetry-check.md
 */
'use strict';

var fs = require('fs');
var path = require('path');
var stats = require('../lib/stats.js');

var RESULTS = path.join(__dirname, '..', 'results');
var BINS = [[0, 0.1], [0.1, 0.2], [0.2, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.99], [0.99, 1.01]];

function findRepFiles(dir, out) {
	fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
		var p = path.join(dir, e.name);
		if (e.isDirectory()) { if (e.name !== 'robust-w10') findRepFiles(p, out); }
		else if (/^rep_\d+\.json$/.test(e.name) && path.basename(dir) === 'fly') out.push(p);
	});
	return out;
}

var files = findRepFiles(RESULTS, []);
var c = {};
files.forEach(function (f) {
	JSON.parse(fs.readFileSync(f, 'utf8')).decisions.forEach(function (d) {
		if (d.eye === 'none' || !(d.intensity > 0)) return;
		var b = BINS.findIndex(function (x) { return d.intensity > x[0] && d.intensity <= x[1]; });
		if (b < 0) return;
		var k = b + '_' + d.eye;
		c[k] = c[k] || { n: 0, same: 0 };
		c[k].n++;
		if (d.choice === d.eye) c[k].same++;
	});
});

function cell(o) {
	if (!o) return '-';
	var w = stats.wilson(o.same, o.n);
	return (100 * o.same / o.n).toFixed(0) + '% [' + (100 * w[0]).toFixed(0) + ', ' + (100 * w[1]).toFixed(0) + '] (n=' + o.n + ')';
}
var md = ['# [탐색] 왼쪽·오른쪽 눈의 반응이 같은가 (기존 거래 실험 기록)', '',
	'자료: `experiments/results/` 아래 거래 실험의 초파리 결정 기록 ' + files.length + '개 파일(weightScale 20, `robust-w10` 제외).',
	'같은 방향 = 자극한 눈 쪽 선택. [ ] = Wilson 95% 신뢰구간. 모든 시행이 다른 시행과 시드를 공유하므로(4,420회에 시드 2,080개) 서로 독립이 아니며, Wilson 구간은 실제보다 좁게 보일 수 있음.', '',
	'| 자극 세기 구간 | 왼쪽 눈: 같은 방향 | 오른쪽 눈: 같은 방향 |', '|---|---|---|'];
BINS.forEach(function (x, b) {
	md.push('| (' + x[0] + ', ' + (x[1] > 1 ? 1 : x[1]) + '] | ' + cell(c[b + '_left']) + ' | ' + cell(c[b + '_right']) + ' |');
});
fs.writeFileSync(path.join(__dirname, 'results', 'symmetry-check.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
