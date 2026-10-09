/* trade-common.js — config loading and price -> stimulus mapping shared by trade.js and its workers */
'use strict';

var fs = require('fs');
var path = require('path');
var market = require('./market.js');

function loadTradeConfig(file) {
	var cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
	['name', 'prices', 'intervalMin', 'rules', 'fly', 'random'].forEach(function (k) {
		if (cfg[k] === undefined) throw new Error(file + ': missing "' + k + '"');
	});
	return cfg;
}

/* Prices for this config. Optional cfg.window = {start: ISO time, hours: n}
 * keeps rows from start to start + n hours (both ends included). */
function loadPrices(cfg) {
	var prices = market.loadPrices(path.join(__dirname, '..', '..', cfg.prices));
	if (!cfg.window) return prices;
	var t0 = Date.parse(cfg.window.start) / 1000, t1 = t0 + cfg.window.hours * 3600;
	var sliced = prices.filter(function (p) { return p.t >= t0 && p.t <= t1; });
	if (!sliced.length || sliced[0].t !== t0 || sliced[sliced.length - 1].t !== t1) {
		throw new Error('price file does not fully cover window ' + cfg.window.start + ' + ' + cfg.window.hours + 'h');
	}
	return sliced;
}

/* Return that maps to full intensity. A number (e.g. 0.01 = 1%) uses only
 * information available at decision time. "max" = the largest |hourly return|
 * in the whole window; it looks into the future and is kept only to reproduce
 * the first STONKFLY-window run. */
function fullScaleReturn(cfg, points) {
	if (cfg.fly.fullScaleReturn !== 'max') return cfg.fly.fullScaleReturn;
	var m = 0;
	points.forEach(function (p) { if (Math.abs(p.ret) > m) m = Math.abs(p.ret); });
	return m;
}

function intensityFor(cfg, ret, fullScale) {
	if (ret === 0 || fullScale <= 0) return 0;
	return cfg.fly.maxIntensity * Math.min(1, Math.abs(ret) / fullScale);
}

module.exports = { loadTradeConfig: loadTradeConfig, loadPrices: loadPrices, fullScaleReturn: fullScaleReturn, intensityFor: intensityFor };
