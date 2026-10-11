/* market-model.js — excess-demand market with random and trend-reacting investors
 *
 * One run (see PLAN.md §2):
 *   r_1 = sigma * eps_0                         (news only)
 *   for t = 1 .. T:   every investor looks only at r_t and buys (+1) / sells (-1) / holds (0)
 *     ln P_{t+1} = ln P_t + lambda * (buys - sells) / N + sigma * eps_t
 *   returns used for metrics: r_2 .. r_{T+1}
 * Investor types:
 *   random   buy pBuy, sell pSell, else hold (ignores prices)
 *   fly      intensity s = min(1, |r| / ref); up -> left eye, down -> right eye;
 *            choice drawn from the measured curve of that eye; left = buy, right = sell
 *   flyRev   same, eyes swapped (up -> right eye)
 *   rule     |r| > threshold -> trade in the direction of r, else hold
 *   ruleRev  |r| > threshold -> trade against r
 * Random streams (per seed): news, random investors and trend investors use
 * separate generators, so runs with the same seed and fraction share news and
 * random-investor decisions exactly.
 */
'use strict';

var makeRng = require('../../lib/headless-sim.js').makeRng;

function gaussian(rng) {
	var u = 0;
	while (u === 0) u = rng();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/* curve.json -> function (eye, s) -> {same, opp}, linear between measured intensities */
function makeCurve(curve) {
	var xs = curve.intensities;
	return function (eye, s) {
		var pts = curve[eye];
		if (s >= xs[xs.length - 1]) return { same: pts[xs.length - 1].same, opp: pts[xs.length - 1].opp };
		for (var i = 1; i < xs.length; i++) {
			if (s <= xs[i]) {
				var w = (s - xs[i - 1]) / (xs[i] - xs[i - 1]);
				return {
					same: pts[i - 1].same + w * (pts[i].same - pts[i - 1].same),
					opp: pts[i - 1].opp + w * (pts[i].opp - pts[i - 1].opp)
				};
			}
		}
	};
}

/* buy / sell probability of one fly investor given the last return */
function flyProbs(curveFn, r, ref, reversed) {
	var s = Math.min(1, Math.abs(r) / ref);
	var up = r >= 0;
	if (reversed) up = !up;
	var eye = up ? 'left' : 'right';
	var p = curveFn(eye, s);
	// left choice = buy, right choice = sell; "same" = choice on the stimulated eye
	return eye === 'left' ? { buy: p.same, sell: p.opp } : { buy: p.opp, sell: p.same };
}

function run(o) {
	var N = o.investors, T = o.steps;
	var nTrend = Math.round(o.fraction * N), nRand = N - nTrend;
	var newsRng = makeRng(o.seed + 1000000), randRng = makeRng(o.seed + 2000000), trendRng = makeRng(o.seed + 3000000);
	var logP = new Float64Array(T + 2);
	var ret = new Float64Array(T + 2);
	logP[0] = 0;
	ret[1] = o.sigma * gaussian(newsRng);
	logP[1] = ret[1];
	var trendBuys = 0, trendSells = 0;
	for (var t = 1; t <= T; t++) {
		var r = ret[t], buys = 0, sells = 0;
		for (var i = 0; i < nRand; i++) {
			var u = randRng();
			if (u < o.pBuy) buys++; else if (u < o.pBuy + o.pSell) sells++;
		}
		if (nTrend) {
			var tb = 0, ts = 0;
			if (o.type === 'fly' || o.type === 'flyRev') {
				var p = flyProbs(o.curveFn, r, o.ref, o.type === 'flyRev');
				for (var j = 0; j < nTrend; j++) {
					var v = trendRng();
					if (v < p.buy) tb++; else if (v < p.buy + p.sell) ts++;
				}
			} else if (Math.abs(r) > o.threshold) {
				var dir = (r > 0) === (o.type === 'rule') ? 1 : -1;
				if (dir > 0) tb = nTrend; else ts = nTrend;
			}
			buys += tb; sells += ts; trendBuys += tb; trendSells += ts;
		}
		ret[t + 1] = o.lambda * (buys - sells) / N + o.sigma * gaussian(newsRng);
		logP[t + 1] = logP[t] + ret[t + 1];
	}
	return { logP: logP, returns: Array.prototype.slice.call(ret, 2),
		trendTradeShare: nTrend ? (trendBuys + trendSells) / (nTrend * T) : null };
}

/* ---------- metrics ---------- */

function mean(x) { var s = 0; for (var i = 0; i < x.length; i++) s += x[i]; return s / x.length; }

function acf(x, k) {
	var m = mean(x), num = 0, den = 0;
	for (var i = 0; i < x.length; i++) den += (x[i] - m) * (x[i] - m);
	for (var i = 0; i + k < x.length; i++) num += (x[i] - m) * (x[i + k] - m);
	return den > 0 ? num / den : 0;
}

function excessKurtosis(x) {
	var m = mean(x), m2 = 0, m4 = 0;
	for (var i = 0; i < x.length; i++) { var d = x[i] - m; m2 += d * d; m4 += d * d * d * d; }
	m2 /= x.length; m4 /= x.length;
	return m2 > 0 ? m4 / (m2 * m2) - 3 : 0;
}

function sd(x) {
	var m = mean(x), v = 0;
	for (var i = 0; i < x.length; i++) v += (x[i] - m) * (x[i] - m);
	return Math.sqrt(v / (x.length - 1));
}

/* unit-free metrics (also used for real BTC returns) */
function shapeMetrics(r) {
	var a = r.map(Math.abs);
	return { kurtosis: excessKurtosis(r), acfR1: acf(r, 1), acfAbs1: acf(a, 1), acfAbs5: acf(a, 5), acfAbs10: acf(a, 10) };
}

/* all metrics of one run; logP covers P_0 .. P_{T+1}; runaway = |ln P_t - ln P_0| >= runawayLogMove at any t */
function runMetrics(res, runawayLogMove) {
	var r = res.returns, lp = res.logP;
	var hi = -Infinity, lo = Infinity, mdd = 0, runup = 0, maxAbs = 0;
	for (var t = 1; t < lp.length; t++) {
		if (lp[t] > hi) hi = lp[t];
		if (lp[t] < lo) lo = lp[t];
		mdd = Math.max(mdd, 1 - Math.exp(lp[t] - hi));
		runup = Math.max(runup, Math.exp(lp[t] - lo) - 1);
	}
	for (var t = 0; t < lp.length; t++) maxAbs = Math.max(maxAbs, Math.abs(lp[t] - lp[0]));
	var m = shapeMetrics(r);
	return {
		volatility: sd(r), maxDrawdown: mdd, maxRunup: runup,
		acfR1: m.acfR1, acfAbs1: m.acfAbs1, acfAbs5: m.acfAbs5, acfAbs10: m.acfAbs10, kurtosis: m.kurtosis,
		maxRise: Math.max.apply(null, r), maxFall: Math.min.apply(null, r),
		runaway: maxAbs >= runawayLogMove ? 1 : 0, maxAbsLogMove: maxAbs, finalLogPrice: lp[lp.length - 1]
	};
}

function quantile(sorted, q) {
	var pos = (sorted.length - 1) * q, a = Math.floor(pos), b = Math.ceil(pos);
	return sorted[a] + (sorted[b] - sorted[a]) * (pos - a);
}

module.exports = {
	gaussian: gaussian, makeCurve: makeCurve, flyProbs: flyProbs, run: run,
	acf: acf, excessKurtosis: excessKurtosis, sd: sd, shapeMetrics: shapeMetrics, runMetrics: runMetrics, quantile: quantile
};
