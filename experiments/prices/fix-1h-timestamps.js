#!/usr/bin/env node
/* fix-1h-timestamps.js — rebuild the timestamp column of btcusd_1h.csv
 *
 * The committed file had timestamp = 1 on every row. DATA_SOURCE.md says the
 * file covers 2025-01-07 00:00 to 2026-10-09 03:00 UTC in 1-hour bars, which is
 * exactly 15,364 consecutive hours = the number of rows. This script assigns
 * timestamp = 2025-01-07T00:00Z + 3600 x row index (bar start time) and checks
 * the result against the independent 1-minute file: every hour fully inside the
 * 1-minute window must have the same open, high, low and close. It refuses to
 * write if the row count or any check does not match.
 *
 *   node experiments/prices/fix-1h-timestamps.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var DIR = __dirname;
var HOURLY = path.join(DIR, 'btcusd_1h.csv');
var MINUTE = path.join(DIR, 'btcusd_stonkfly_window_1min.csv');
var START = Date.UTC(2025, 0, 7, 0, 0, 0) / 1000;
var END = Date.UTC(2026, 9, 9, 3, 0, 0) / 1000;

function rows(file) {
	var lines = fs.readFileSync(file, 'utf8').trim().split('\n');
	var head = lines[0].split(',');
	return { head: head, rows: lines.slice(1).map(function (l) { return l.split(','); }) };
}

var h = rows(HOURLY);
var col = {};
h.head.forEach(function (name, i) { col[name] = i; });
var expected = (END - START) / 3600 + 1;
if (h.rows.length !== expected) throw new Error('expected ' + expected + ' rows, found ' + h.rows.length);

var m = rows(MINUTE), mc = {}, byT = {};
m.head.forEach(function (name, i) { mc[name] = i; });
m.rows.forEach(function (r) { byT[+r[mc.timestamp]] = r; });

var checked = 0;
h.rows.forEach(function (r, i) {
	var t = START + 3600 * i;
	r[col.timestamp] = String(t);
	var mins = [];
	for (var k = 0; k < 60; k++) if (byT[t + 60 * k]) mins.push(byT[t + 60 * k]);
	if (mins.length !== 60) return;
	var hi = Math.max.apply(null, mins.map(function (x) { return +x[mc.high]; }));
	var lo = Math.min.apply(null, mins.map(function (x) { return +x[mc.low]; }));
	var same = +r[col.open] === +mins[0][mc.open] && +r[col.close] === +mins[59][mc.close] &&
		+r[col.high] === hi && +r[col.low] === lo;
	if (!same) throw new Error('row ' + (i + 2) + ' (' + new Date(t * 1000).toISOString() + ') does not match the 1-minute data');
	checked++;
});
if (checked === 0) throw new Error('no overlapping hours to check');

fs.writeFileSync(HOURLY, [h.head.join(',')].concat(h.rows.map(function (r) { return r.join(','); })).join('\n') + '\n');
console.log('rebuilt ' + h.rows.length + ' timestamps; ' + checked + ' overlapping hours match the 1-minute file exactly');
