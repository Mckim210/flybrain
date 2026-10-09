/* market.js — prices, decision points and a STONKFLY-style paper portfolio
 *
 * Portfolio rules (our reading of the STONKFLY rules in CLAUDE.md; the exact
 * STONKFLY code may differ in details such as rounding):
 *   - start with `capital` USD cash, no BTC, no shorting
 *   - BUY : spend up to `orderUsd` on BTC; fee = feeRate x amount, paid in cash;
 *           cash may not drop below the reserve (reserveRate x starting capital)
 *   - SELL: sell up to `orderUsd` worth of BTC that is actually held; fee taken
 *           from the proceeds. With no BTC, a SELL does nothing.
 *   - at most `maxOrdersPerDay` executed orders per UTC day (extra signals = hold)
 *   - orders fill at the close of the decision minute
 *   - final value = cash + BTC x last close (marked to market, no closing fee)
 */
'use strict';

var fs = require('fs');

function loadPrices(file) {
	var lines = fs.readFileSync(file, 'utf8').trim().split('\n');
	var head = lines[0].split(',');
	var ti = head.indexOf('timestamp'), ci = head.indexOf('close');
	if (ti < 0 || ci < 0) throw new Error(file + ' needs timestamp and close columns');
	var out = [];
	for (var i = 1; i < lines.length; i++) {
		var c = lines[i].split(',');
		out.push({ t: +c[ti], close: +c[ci] });
	}
	for (var i = 1; i < out.length; i++) {
		if (out[i].t <= out[i - 1].t) throw new Error('timestamps not increasing at row ' + (i + 1));
	}
	return out;
}

/* Every `intervalMin` minutes from the first row: the return over the previous
 * interval, close(now) / close(now - interval) - 1. Rows must be evenly spaced
 * (1-minute or 1-hour bars); the bar length is read from the data. */
function decisionPoints(prices, intervalMin) {
	var barSec = prices[1].t - prices[0].t;
	var step = intervalMin * 60 / barSec;
	if (step < 1 || step !== Math.floor(step)) throw new Error('intervalMin must be a multiple of the bar length (' + barSec / 60 + ' min)');
	var pts = [];
	for (var i = step; i < prices.length; i += step) {
		if (prices[i].t - prices[i - step].t !== intervalMin * 60) {
			throw new Error('gap in price data before ' + new Date(prices[i].t * 1000).toISOString());
		}
		// timestamps are bar start times; the close we trade at is known at bar end
		var tClose = prices[i].t + barSec;
		pts.push({
			index: pts.length,
			t: tClose,
			iso: new Date(tClose * 1000).toISOString().slice(0, 16).replace('T', ' '),
			price: prices[i].close,
			ret: prices[i].close / prices[i - step].close - 1
		});
	}
	return pts;
}

/* actions: array of 'buy' | 'sell' | 'hold', one per decision point. */
function simulate(actions, points, finalPrice, rules) {
	var cash = rules.capital, btc = 0, fees = 0;
	var reserve = rules.capital * rules.reserveRate;
	var perDay = {};
	var executed = [];
	for (var k = 0; k < points.length; k++) {
		var a = actions[k], p = points[k].price;
		var day = new Date(points[k].t * 1000).toISOString().slice(0, 10);
		var done = 'hold', usd = 0;
		if ((a === 'buy' || a === 'sell') && (perDay[day] || 0) < rules.maxOrdersPerDay) {
			if (a === 'buy') {
				usd = Math.min(rules.orderUsd, (cash - reserve) / (1 + rules.feeRate));
				if (usd > 0.005) {
					cash -= usd * (1 + rules.feeRate);
					fees += usd * rules.feeRate;
					btc += usd / p;
					done = 'buy';
				}
			} else {
				usd = Math.min(rules.orderUsd, btc * p);
				if (usd > 0.005) {
					btc -= usd / p;
					if (btc < 1e-15) btc = 0;
					cash += usd * (1 - rules.feeRate);
					fees += usd * rules.feeRate;
					done = 'sell';
				}
			}
			if (done !== 'hold') perDay[day] = (perDay[day] || 0) + 1;
		}
		executed.push(done === 'hold' ? { action: 'hold', usd: 0 } : { action: done, usd: usd });
	}
	var finalValue = cash + btc * finalPrice;
	return {
		finalValue: finalValue,
		pnl: finalValue - rules.capital,
		cash: cash,
		btc: btc,
		fees: fees,
		orders: executed.filter(function (e) { return e.action !== 'hold'; }).length,
		executed: executed
	};
}

/* The "no brain" investor: up -> buy, down -> sell, unchanged -> hold. */
function ruleActions(points) {
	return points.map(function (p) { return p.ret > 0 ? 'buy' : (p.ret < 0 ? 'sell' : 'hold'); });
}

/* The opposite rule: up -> sell, down -> buy (what a fly with swapped eyes
 * would do if it always followed its eyes). */
function reverseRuleActions(points) {
	return points.map(function (p) { return p.ret > 0 ? 'sell' : (p.ret < 0 ? 'buy' : 'hold'); });
}

/* Random investor: each decision independently buy/sell/hold with probabilities probs. */
function randomActions(points, rng, probs) {
	return points.map(function () {
		var u = rng();
		return u < probs.buy ? 'buy' : (u < probs.buy + probs.sell ? 'sell' : 'hold');
	});
}

module.exports = {
	loadPrices: loadPrices,
	decisionPoints: decisionPoints,
	simulate: simulate,
	ruleActions: ruleActions,
	reverseRuleActions: reverseRuleActions,
	randomActions: randomActions
};
