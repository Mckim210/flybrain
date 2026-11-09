/* emotion/sensitivity.js — 편향 투자자의 확률·문턱 값을 바꿔도 결론이 같은지 (가정 값에 대한 민감도)
 * 각 설정마다 6개 기간 × 1만 명. 출력: results/sensitivity.md, sensitivity.json */
'use strict';
var fs = require('fs'), path = require('path');
var EXP = path.join(__dirname, '..');
var market = require(path.join(EXP, 'lib', 'market.js')), common = require(path.join(EXP, 'lib', 'trade-common.js')), stats = require(path.join(EXP, 'lib', 'stats.js'));
var E = require('./run.js'), N = 10000, T = E.THIRD;

function disposition(gainSell, lossSell) {
	return function (s, pts, k) {
		if (s.btc > 0 && s.costUsd > 0) { var c = s.costUsd / s.btc, p = pts[k].price;
			if (p > c) return { buy: (1 - gainSell) / 2, sell: gainSell, hold: (1 - gainSell) / 2 };
			if (p < c) return { buy: (1 - lossSell) / 2, sell: lossSell, hold: (1 - lossSell) / 2 }; }
		return T; };
}
function overconfidence(hold, trigger) {   // trigger: value > capital * trigger
	return function (s, pts, k, R) { return s.cash + s.btc * pts[k].price > R.capital * trigger ? { buy: (1 - hold) / 2, sell: (1 - hold) / 2, hold: hold } : T; };
}
function chase(win, thr, prob) {
	return function (s, pts, k) { if (k < win) return T; var r = pts[k].price / pts[k - win].price - 1, o = (1 - prob) / 2;
		if (r > thr) return { buy: prob, sell: o, hold: o }; if (r < -thr) return { buy: o, sell: prob, hold: o }; return T; };
}
var SETS = [];
[0.4, 0.5, 0.6, 0.7].forEach(function (g) { [1 / 12, 1 / 6, 1 / 4].forEach(function (l) { SETS.push({ bias: '처분 효과', desc: '이익 시 매도 ' + g + ', 손실 시 매도 ' + l.toFixed(3), f: disposition(g, l) }); }); });
[0.05, 0.1, 0.2].forEach(function (h) { [1.0, 0.99, 0.98].forEach(function (tr) { SETS.push({ bias: '과신', desc: '보유 ' + h + ', 발동: 평가액 > 자본×' + tr, f: overconfidence(h, tr) }); }); });
[1, 3, 6].forEach(function (w) { [0.0025, 0.005, 0.01].forEach(function (th) { [0.6, 0.8, 0.95].forEach(function (pr) { SETS.push({ bias: '추격·공포', desc: w + '시간, 문턱 ' + (th * 100) + '%, 확률 ' + pr, f: chase(w, th, pr) }); }); }); });

var P = E.CONFIGS.map(function (file) {
	var cfg = common.loadTradeConfig(path.join(EXP, 'config', file)), R = cfg.rules, prices = common.loadPrices(cfg);
	var pts = market.decisionPoints(prices, cfg.intervalMin), fp = prices[prices.length - 1].close, rng = E.makeRng(777), plain = [];
	for (var i = 0; i < N; i++) plain.push(E.runOne({ probs: function () { return T; } }, pts, fp, R, rng));
	var summ = JSON.parse(fs.readFileSync(path.join(EXP, 'results', cfg.name, 'summary.json'), 'utf8'));
	var exp = {}; for (var k = 0; k <= 26; k++) exp[k] = E.expectedFor(plain, k);
	return { R: R, pts: pts, fp: fp, exp: exp, fly: summ.fly.pnl.mean };
});
var rows = SETS.map(function (set, si) {
	var resid = [], worse = 0, pnl = [], ord = [];
	P.forEach(function (p, pi) {
		var rng = E.makeRng(20000 + si * 10 + pi), g = [];
		for (var i = 0; i < N; i++) g.push(E.runOne({ probs: set.f }, p.pts, p.fp, p.R, rng));
		var m = E.mean(g.map(function (r) { return r.pnl; }));
		resid.push(E.mean(g.map(function (r) { return r.pnl - p.exp[r.orders]; }))); pnl.push(m); ord.push(E.mean(g.map(function (r) { return r.orders; })));
		if (m < p.fly) worse++;
	});
	var ci = stats.meanCI(resid);
	return { bias: set.bias, desc: set.desc, meanPnl: E.mean(pnl), meanOrders: E.mean(ord), worseThanFly: worse, resid: ci, zeroInCI: ci.lo <= 0 && ci.hi >= 0 };
});
function money(x) { return (x < 0 ? '−$' : '+$') + Math.abs(x).toFixed(2); }
var md = ['# 편향 투자자 민감도 분석 (설정 ' + rows.length + '개, 각 6개 기간 × 1만 명)', '', '| 편향 | 설정 | 평균 손익 | 평균 주문 | 초파리보다 나쁜 기간 | 같은 주문 수 대비 잔차 [95% CI, 기간 단위] |', '|---|---|---|---|---|---|'];
rows.forEach(function (r) { md.push('| ' + r.bias + ' | ' + r.desc + ' | ' + money(r.meanPnl) + ' | ' + r.meanOrders.toFixed(1) + ' | ' + r.worseThanFly + '/6 | ' + money(r.resid.mean) + ' [' + money(r.resid.lo) + ', ' + money(r.resid.hi) + ']' + (r.zeroInCI ? '' : ' **0 미포함**') + ' |'); });
['처분 효과', '과신', '추격·공포'].forEach(function (b) {
	var rs = rows.filter(function (r) { return r.bias === b; });
	md.push('', '- ' + b + ': ' + rs.length + '개 설정 중 잔차 신뢰구간이 0을 포함한 설정 ' + rs.filter(function (r) { return r.zeroInCI; }).length + '개, 초파리보다 나쁜 기간 ' + Math.min.apply(null, rs.map(function (r) { return r.worseThanFly; })) + '~' + Math.max.apply(null, rs.map(function (r) { return r.worseThanFly; })) + '/6, 평균 손익 ' + money(Math.min.apply(null, rs.map(function (r) { return r.meanPnl; }))) + ' ~ ' + money(Math.max.apply(null, rs.map(function (r) { return r.meanPnl; }))));
});
fs.writeFileSync(path.join(__dirname, 'results', 'sensitivity.json'), JSON.stringify(rows.map(function (r) { return { bias: r.bias, desc: r.desc, meanPnl: r.meanPnl, meanOrders: r.meanOrders, worseThanFly: r.worseThanFly, resid: r.resid }; }), null, 2));
fs.writeFileSync(path.join(__dirname, 'results', 'sensitivity.md'), md.join('\n') + '\n');
console.log(md.slice(-6).join('\n'));
