/* trade-common.js — config loading and price -> stimulus mapping shared by trade.js and its workers */
'use strict';

var fs = require('fs');

function loadTradeConfig(file) {
	var cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
	['name', 'prices', 'intervalMin', 'rules', 'fly', 'random'].forEach(function (k) {
		if (cfg[k] === undefined) throw new Error(file + ': missing "' + k + '"');
	});
	return cfg;
}

/* Return that maps to full intensity. "max" = the largest |hourly return| in the
 * window, so the biggest move gets exactly maxIntensity and nothing is clipped. */
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

module.exports = { loadTradeConfig: loadTradeConfig, fullScaleReturn: fullScaleReturn, intensityFor: intensityFor };
