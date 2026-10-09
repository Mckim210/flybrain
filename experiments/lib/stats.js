/* stats.js — small statistics helpers for the choice experiments */
'use strict';

/* Exact two-sided binomial test: probability, under "left and right are equally
 * likely" (p = 0.5), of a result at least as unlikely as k out of n.
 * Returns 1 when n = 0 (no evidence either way). */
function binomTwoSided(k, n, p) {
	if (p === undefined) p = 0.5;
	if (n === 0) return 1;
	var lf = [0];
	for (var i = 1; i <= n; i++) lf[i] = lf[i - 1] + Math.log(i);
	function pmf(x) {
		return Math.exp(lf[n] - lf[x] - lf[n - x] + x * Math.log(p) + (n - x) * Math.log(1 - p));
	}
	var observed = pmf(k);
	var total = 0;
	for (var x = 0; x <= n; x++) {
		var px = pmf(x);
		if (px <= observed * (1 + 1e-7)) total += px;
	}
	return Math.min(1, total);
}

/* Wilson 95% confidence interval for a proportion k/n. */
function wilson(k, n) {
	if (n === 0) return [0, 1];
	var z = 1.959963984540054;
	var ph = k / n;
	var den = 1 + z * z / n;
	var center = (ph + z * z / (2 * n)) / den;
	var half = z * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / den;
	return [Math.max(0, center - half), Math.min(1, center + half)];
}

/* Mean and 95% CI (normal approximation) of a list of numbers. */
function meanCI(xs) {
	var n = xs.length;
	if (n === 0) return { n: 0, mean: null, lo: null, hi: null };
	var m = 0;
	for (var i = 0; i < n; i++) m += xs[i];
	m /= n;
	if (n < 2) return { n: n, mean: m, lo: null, hi: null };
	var v = 0;
	for (var i = 0; i < n; i++) v += (xs[i] - m) * (xs[i] - m);
	var se = Math.sqrt(v / (n - 1) / n);
	return { n: n, mean: m, lo: m - 1.96 * se, hi: m + 1.96 * se };
}

module.exports = { binomTwoSided: binomTwoSided, wilson: wilson, meanCI: meanCI };
