/* emotion/run.js — 감정(행동 편향)이 들어간 가상 투자자 vs 초파리 (사전 계획: emotion/PLAN.md)
 *
 * 편향 투자자의 행동은 자기 보유 상태(평균 매입가, 평가액)나 최근 가격에 따라 달라지므로
 * 결정을 미리 정할 수 없다. 그래서 lib/market.js의 simulate()와 똑같은 주문 규칙을 한 결정씩 적용한다.
 * (검증: 편향이 없는 'plain' 투자자는 market.simulate + randomActions와 숫자가 완전히 같아야 한다.)
 *
 *   node experiments/emotion/run.js            -> experiments/emotion/results/{summary.json, table.md}
 */
'use strict';
var fs = require('fs'), path = require('path');
var EXP = path.join(__dirname, '..');
var market = require(path.join(EXP, 'lib', 'market.js'));
var common = require(path.join(EXP, 'lib', 'trade-common.js'));
var stats = require(path.join(EXP, 'lib', 'stats.js'));

var CONFIGS = ['trade-stonkfly-window-fixed1pct.json', 'periods/p20250910.json', 'periods/p20260220.json',
	'periods/p20260526.json', 'periods/p20260731.json', 'periods/p20260818.json'];
var N = 10000;
var THIRD = { buy: 1 / 3, sell: 1 / 3, hold: 1 / 3 };

function makeRng(seed) {   // mulberry32, same as trade.js
	var a = seed >>> 0;
	return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* each bias returns action probabilities for decision k, given the investor's state and the price history */
var BIASES = {
	plain: { label: '감정 없는 무작위 (검증용)', seed: 777, probs: function () { return THIRD; } },
	disposition: { label: '처분 효과 투자자', seed: 9101, probs: function (s, pts, k) {
		if (s.btc > 0 && s.costUsd > 0) {
			var avgCost = s.costUsd / s.btc, p = pts[k].price;
			if (p > avgCost) return { buy: 0.25, sell: 0.50, hold: 0.25 };
			if (p < avgCost) return { buy: 5 / 12, sell: 1 / 6, hold: 5 / 12 };
		}
		return THIRD;
	} },
	overconfidence: { label: '과신 투자자', seed: 9102, probs: function (s, pts, k, R) {
		var value = s.cash + s.btc * pts[k].price;
		return value > R.capital ? { buy: 0.45, sell: 0.45, hold: 0.10 } : THIRD;
	} },
	chase: { label: '추격 매수·공포 매도 투자자', seed: 9103, probs: function (s, pts, k) {
		if (k < 3) return THIRD;
		var r3 = pts[k].price / pts[k - 3].price - 1;
		if (r3 > 0.005) return { buy: 0.80, sell: 0.10, hold: 0.10 };
		if (r3 < -0.005) return { buy: 0.10, sell: 0.80, hold: 0.10 };
		return THIRD;
	} }
};

/* one investor, same order rules as market.simulate (kept line-for-line equivalent) */
function runOne(bias, pts, finalPrice, R, rng, path) {   // path (optional): gets the P&L after each decision, valued at that decision's price
	var s = { cash: R.capital, btc: 0, fees: 0, costUsd: 0 }, reserve = R.capital * R.reserveRate, perDay = {}, orders = 0;
	for (var k = 0; k < pts.length; k++) {
		var pr = bias.probs(s, pts, k, R), u = rng();
		var a = u < pr.buy ? 'buy' : (u < pr.buy + pr.sell ? 'sell' : 'hold');
		var p = pts[k].price, day = new Date(pts[k].t * 1000).toISOString().slice(0, 10), done = 'hold', usd;
		if ((a === 'buy' || a === 'sell') && (perDay[day] || 0) < R.maxOrdersPerDay) {
			if (a === 'buy') {
				usd = Math.min(R.orderUsd, (s.cash - reserve) / (1 + R.feeRate));
				if (usd > 0.005) { s.cash -= usd * (1 + R.feeRate); s.fees += usd * R.feeRate; s.btc += usd / p; s.costUsd += usd * (1 + R.feeRate); done = 'buy'; }
			} else {
				usd = Math.min(R.orderUsd, s.btc * p);
				if (usd > 0.005) {
					var frac = (usd / p) / s.btc;
					s.costUsd -= s.costUsd * frac;   // average-cost basis: remove the sold share of the cost
					s.btc -= usd / p; if (s.btc < 1e-15) { s.btc = 0; s.costUsd = 0; }
					s.cash += usd * (1 - R.feeRate); s.fees += usd * R.feeRate; done = 'sell';
				}
			}
			if (done !== 'hold') { perDay[day] = (perDay[day] || 0) + 1; orders++; }
		}
		if (path) path.push(s.cash + s.btc * p - R.capital);
	}
	return { pnl: s.cash + s.btc * finalPrice - R.capital, orders: orders, fees: s.fees };
}

function group(bias, pts, finalPrice, R) {
	var rng = makeRng(bias.seed), out = [];
	for (var i = 0; i < N; i++) out.push(runOne(bias, pts, finalPrice, R, rng));
	return out;
}
function mean(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }

/* average P&L of plain random investors that executed k orders (pooled +-w until >= 50 people, as trade.js) */
function expectedFor(plain, k) {
	for (var w = 0; w <= 26; w++) {
		var sum = 0, n = 0;
		plain.forEach(function (r) { if (Math.abs(r.orders - k) <= w) { sum += r.pnl; n++; } });
		if (n >= 50) return sum / n;
	}
	return null;
}

module.exports = { BIASES: BIASES, N: N, runOne: runOne, makeRng: makeRng, expectedFor: expectedFor, mean: mean, CONFIGS: CONFIGS, THIRD: THIRD };
if (require.main !== module) return;

var periods = [], verified = true;
CONFIGS.forEach(function (file) {
	var cfg = common.loadTradeConfig(path.join(EXP, 'config', file)), R = cfg.rules;
	var prices = common.loadPrices(cfg), pts = market.decisionPoints(prices, cfg.intervalMin), fp = prices[prices.length - 1].close;
	var plain = group(BIASES.plain, pts, fp, R);
	// check: plain stepper == market.simulate(randomActions) with the same seed (trade.js random group)
	var rng = makeRng(777);
	for (var i = 0; i < 200; i++) {
		var ref = market.simulate(market.randomActions(pts, rng, cfg.random.probs), pts, fp, R);
		if (Math.abs(ref.pnl - plain[i].pnl) > 1e-9 || ref.orders !== plain[i].orders) verified = false;
	}
	var summ = JSON.parse(fs.readFileSync(path.join(EXP, 'results', cfg.name, 'summary.json'), 'utf8'));
	var row = { name: cfg.name, label: cfg.label, fly: { pnl: summ.fly.pnl.mean, orders: summ.fly.ordersMean, fees: summ.fly.feesMean, runs: summ.fly.pnl.n },
		rule: { pnl: summ.rule.pnl, orders: summ.rule.orders, fees: summ.rule.fees }, investors: {} };
	['plain', 'disposition', 'overconfidence', 'chase'].forEach(function (key) {
		var g = key === 'plain' ? plain : group(BIASES[key], pts, fp, R);
		var resid = g.map(function (r) { return r.pnl - expectedFor(plain, r.orders); });
		row.investors[key] = { pnl: mean(g.map(function (r) { return r.pnl; })), orders: mean(g.map(function (r) { return r.orders; })),
			fees: mean(g.map(function (r) { return r.fees; })), residualSameOrders: mean(resid),
			shareAtLeast1: g.filter(function (r) { return r.pnl >= 1; }).length / N };
	});
	periods.push(row);
	console.log(cfg.name, 'done');
});
if (!verified) throw new Error('plain stepper does not reproduce market.simulate — stop');

var keys = ['disposition', 'overconfidence', 'chase'], pooled = {};
keys.concat(['plain']).forEach(function (k) {
	var res = periods.map(function (p) { return p.investors[k].residualSameOrders; });
	pooled[k] = { residualByPeriod: stats.meanCI(res), periodsWorseThanFly: periods.filter(function (p) { return p.investors[k].pnl < p.fly.pnl; }).length,
		meanPnl: mean(periods.map(function (p) { return p.investors[k].pnl; })), meanOrders: mean(periods.map(function (p) { return p.investors[k].orders; })) };
});
pooled.fly = { meanPnl: mean(periods.map(function (p) { return p.fly.pnl; })), meanOrders: mean(periods.map(function (p) { return p.fly.orders; })) };

var outDir = path.join(__dirname, 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ plan: 'experiments/emotion/PLAN.md', verifiedAgainstMarketSimulate: verified, investorsPerGroup: N, periods: periods, pooled: pooled }, null, 2));

function money(x) { return (x < 0 ? '−$' : '+$') + Math.abs(x).toFixed(2); }
var md = ['# 감정(행동 편향) 가상 투자자 vs 초파리', '', '사전 계획: `experiments/emotion/PLAN.md`. 편향 투자자는 각 1만 명 평균, 초파리는 저장된 실행 평균.', '',
	'| 기간 | 초파리 | 처분 효과 | 과신 | 추격·공포 | 감정 없는 무작위 | 규칙 투자자 |', '|---|---|---|---|---|---|---|'];
periods.forEach(function (p) {
	function c(v) { return money(v.pnl) + ' (' + v.orders.toFixed(1) + '건)'; }
	md.push('| ' + p.label + ' | ' + c(p.fly) + ' | ' + c(p.investors.disposition) + ' | ' + c(p.investors.overconfidence) + ' | ' + c(p.investors.chase) + ' | ' + c(p.investors.plain) + ' | ' + money(p.rule.pnl) + ' (' + p.rule.orders + '건) |');
});
md.push('', '| 투자자 | 6개 기간 평균 손익 | 평균 주문 | 초파리보다 나쁜 기간 | 같은 주문 수 무작위 대비 잔차 (기간 단위 95% CI) |', '|---|---|---|---|---|');
md.push('| 초파리 | ' + money(pooled.fly.meanPnl) + ' | ' + pooled.fly.meanOrders.toFixed(1) + ' | — | (본문: −$0.01 [−$0.08, +$0.06]) |');
keys.concat(['plain']).forEach(function (k) {
	var q = pooled[k], ci = q.residualByPeriod;
	md.push('| ' + BIASES[k].label + ' | ' + money(q.meanPnl) + ' | ' + q.meanOrders.toFixed(1) + ' | ' + q.periodsWorseThanFly + '/6 | ' + money(ci.mean) + ' [' + money(ci.lo) + ', ' + money(ci.hi) + '] |');
});
fs.writeFileSync(path.join(outDir, 'table.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
