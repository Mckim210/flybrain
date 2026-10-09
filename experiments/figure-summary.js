#!/usr/bin/env node
/* figure-summary.js — one-page summary of the six trading periods (HTML)
 *
 *   node experiments/figure-summary.js
 *
 * Reads (all must already exist):
 *   results/<period>/summary.json + fly_runs.csv   original mapping, fee 0.6%
 *   results/fee-counterfactual/summary.json        same decisions, fee 0 / 0.1 / 0.6%
 *   results/reversed/<period>/summary.json         reversed eye mapping (optional panel)
 * Writes experiments/results/figures/summary.html.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var R = path.join(__dirname, 'results');
var PERIODS = [
	{ id: 'stonkfly', orig: 'trade-stonkfly-window-fixed1pct', rev: 'reversed/stonkfly' },
	{ id: 'p20250910', orig: 'periods/p20250910', rev: 'reversed/p20250910' },
	{ id: 'p20260220', orig: 'periods/p20260220', rev: 'reversed/p20260220' },
	{ id: 'p20260526', orig: 'periods/p20260526', rev: 'reversed/p20260526' },
	{ id: 'p20260731', orig: 'periods/p20260731', rev: 'reversed/p20260731' },
	{ id: 'p20260818', orig: 'periods/p20260818', rev: 'reversed/p20260818' }
];

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function flyPnl(dir) {
	return fs.readFileSync(path.join(R, dir, 'fly_runs.csv'), 'utf8').trim().split('\n').slice(1).map(function (l) { return +l.split(',')[1]; });
}
function quantile(xs, q) {
	var s = xs.slice().sort(function (a, b) { return a - b; }), pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
	return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

function main() {
	var fee = readJson(path.join(R, 'fee-counterfactual', 'summary.json'));
	var rows = PERIODS.map(function (p) {
		var s = readJson(path.join(R, p.orig, 'summary.json'));
		var start = s.window.from.slice(0, 10);
		var row = {
			id: p.id, label: s.config.label || 'STONKFLY 기간', start: start,
			net: s.window.finalPrice / s.window.startPrice - 1,
			fly: flyPnl(p.orig), rule: s.rule.pnl, randMean: s.random.pnl.mean, randLo: s.random.pnl.p5, randHi: s.random.pnl.p95,
			buy: s.fly.actionRates.buy, sell: s.fly.actionRates.sell, hold: s.fly.actionRates.hold,
			fee: fee.rows.filter(function (r) { return r.period === start; }).map(function (r) {
				return { fee: r.fee, gap: r.flyMean - r.rule, fly: r.flyMean, rule: r.rule };
			})
		};
		var revFile = path.join(R, p.rev, 'summary.json');
		if (fs.existsSync(revFile)) {
			var v = readJson(revFile);
			row.rev = { fly: flyPnl(p.rev), buy: v.fly.actionRates.buy, sell: v.fly.actionRates.sell, hold: v.fly.actionRates.hold,
				reverseRule: fee.rows.filter(function (r) { return r.period === start && r.fee === 0.006; })[0].reverseRule };
		}
		return row;
	});
	var out = path.join(R, 'figures');
	fs.mkdirSync(out, { recursive: true });
	fs.writeFileSync(path.join(out, 'summary.html'), render(rows));
	console.log('wrote ' + path.relative(process.cwd(), path.join(out, 'summary.html')) + (rows[0].rev ? ' (with reversed mapping)' : ' (reversed mapping not available yet)'));
}

function render(rows) {
	var hasRev = rows.every(function (r) { return r.rev; });
	return '<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>초파리 트레이더 요약</title>\n<style>\n' +
':root { color-scheme: light; --surface:#fcfcfb; --surface-2:#f4f3f0; --text:#0b0b0b; --text-2:#52514e; --muted:#8a8984; --grid:#e4e3df;\n' +
'  --fly:#2a78d6; --rule:#eb6834; --rand:#1baf7a; --rand-band:rgba(27,175,122,.22); --f0:#86b6ef; --f1:#2a78d6; --f6:#104281; }\n' +
'@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; --surface:#1a1a19; --surface-2:#242422; --text:#fff; --text-2:#c3c2b7;\n' +
'  --muted:#8f8e86; --grid:#33332f; --fly:#3987e5; --rule:#d95926; --rand:#199e70; --rand-band:rgba(25,158,112,.30); --f0:#184f95; --f1:#3987e5; --f6:#b7d3f6; } }\n' +
':root[data-theme="dark"] { color-scheme: dark; --surface:#1a1a19; --surface-2:#242422; --text:#fff; --text-2:#c3c2b7; --muted:#8f8e86; --grid:#33332f;\n' +
'  --fly:#3987e5; --rule:#d95926; --rand:#199e70; --rand-band:rgba(25,158,112,.30); --f0:#184f95; --f1:#3987e5; --f6:#b7d3f6; }\n' +
'* { box-sizing:border-box; } body { margin:0; background:var(--surface); color:var(--text); font:15px/1.55 system-ui,-apple-system,"Segoe UI","Noto Sans KR",sans-serif; }\n' +
'main { max-width:1000px; margin:0 auto; padding:24px 16px 40px; } h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:17px; margin:28px 0 4px; }\n' +
'.sub, .note { color:var(--text-2); font-size:14px; margin:0 0 10px; } .legend { display:flex; flex-wrap:wrap; gap:4px 16px; font-size:13px; color:var(--text-2); margin:6px 0; }\n' +
'.k { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:5px; vertical-align:-1px; } .k.band { border-radius:2px; width:16px; } .k.dia { border-radius:1px; transform:rotate(45deg); width:9px; height:9px; }\n' +
'.chart { position:relative; } svg { display:block; width:100%; height:auto; overflow:visible; } svg text { fill:var(--text-2); font-size:12px; }\n' +
'.tip { position:absolute; pointer-events:none; background:var(--surface-2); color:var(--text); border:1px solid var(--grid); border-radius:6px; padding:6px 8px; font-size:12px; line-height:1.4; white-space:nowrap; opacity:0; }\n' +
'</style>\n</head>\n<body>\n<main>\n' +
'<h1>초파리 트레이더: 6개 기간 요약</h1>\n' +
'<p class="sub">BTC/USD, 각 기간 26시간 · 1시간마다 결정 26회 · 자본 $100, 주문당 최대 $10 · 초파리 = FlyWire 커넥톰 LIF 모델(시냅스 가중치 20배), 오르면 왼쪽 눈 → 왼쪽 하행 뉴런이 이기면 매수</p>\n' +
'<h2>① 최종 손익 (수수료 0.6%)</h2>\n<p class="note">한 줄 = 한 기간. 띠: 무작위 투자자 1만 명의 가운데 90% (5~95%), 세로 눈금: 그 평균 · 점: 초파리 각 회 · 마름모: 규칙 투자자(오르면 매수, 내리면 매도)</p>\n' +
'<div class="legend"><span><span class="k" style="background:var(--fly)"></span>초파리</span><span><span class="k dia" style="background:var(--rule)"></span>규칙 투자자</span>' +
	'<span><span class="k band" style="background:var(--rand-band);border:1px solid var(--rand)"></span>무작위 1만 명 (5~95%, 평균)</span></div>\n<div class="chart" id="c1"><div class="tip"></div></div>\n' +
'<h2>② 수수료를 바꾸면: 초파리 평균 − 규칙 투자자</h2>\n<p class="note">같은 결정, 수수료만 바꿔 다시 계산. 0보다 오른쪽 = 초파리가 규칙 투자자보다 나음. 수수료 0%에서는 우위가 대부분 사라짐.</p>\n' +
'<div class="legend"><span><span class="k" style="background:var(--f0)"></span>수수료 0%</span><span><span class="k" style="background:var(--f1)"></span>0.1%</span><span><span class="k" style="background:var(--f6)"></span>0.6% (실험 조건)</span></div>\n<div class="chart" id="c2"><div class="tip"></div></div>\n' +
(hasRev ? '<h2>③ 눈을 바꿔 달면: 매수·매도 비율과 손익</h2>\n<p class="note">원래: 오르면 왼쪽 눈 · 반전: 오르면 오른쪽 눈 (같은 시드, 각 10회 · 판정은 그대로 왼쪽 = 매수). 막대: 결정 중 매수(오른쪽으로)·매도(왼쪽으로) 비율.</p>\n' +
	'<div class="legend"><span><span class="k band" style="background:var(--fly)"></span>매수 비율</span><span><span class="k band" style="background:var(--rule)"></span>매도 비율</span></div>\n<div class="chart" id="c3"><div class="tip"></div></div>\n' : '') +
'<p class="note" style="margin-top:24px">한계: 기간 6개(각 26시간), 초파리 반복 STONKFLY 30회·나머지 10회, 시냅스 가중치 20배(실험용), 결정마다 뇌 초기화, 결과 변동은 배경 잡음에서만 나옴. ' +
	'가격: Bitstamp BTC/USD (ff137/bitstamp-btcusd-minute-data, CC BY-SA 4.0). 커넥톰: FlyWire FAFB v783 (CC-BY-NC).</p>\n' +
'</main>\n<script>\nvar ROWS = ' + JSON.stringify(rows) + ';\n' + CLIENT + '\n</script>\n</body>\n</html>\n';
}

var CLIENT = [
'(function () {',
'  var NS = "http://www.w3.org/2000/svg";',
'  function el(t, a, p) { var e = document.createElementNS(NS, t); for (var k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; }',
'  function money(x) { return (x >= 0 ? "+$" : "−$") + Math.abs(x).toFixed(2); }',
'  function pct(x) { return Math.round(x * 100) + "%"; }',
'  function nice(span, n) { var r = span / n, p = Math.pow(10, Math.floor(Math.log10(r))), m = r / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; }',
'  function tip(box, html, e) { var t = box.querySelector(".tip"), b = box.getBoundingClientRect(); t.innerHTML = html; t.style.opacity = 1;',
'    t.style.left = Math.max(0, Math.min(box.clientWidth - t.offsetWidth, e.clientX - b.left + 12)) + "px"; t.style.top = Math.max(0, e.clientY - b.top - 44) + "px"; }',
'  function untip(box) { box.querySelector(".tip").style.opacity = 0; }',
'  function hover(node, box, html) { node.addEventListener("mousemove", function (e) { tip(box, html, e); }); node.addEventListener("mouseleave", function () { untip(box); }); }',
'  function rowLabel(r) { return r.start + " " + (r.label === "STONKFLY 기간" ? "STONKFLY" : r.label); }',
'  function netLabel(r) { var v = r.net * 100; return (Math.abs(v) < 0.05 ? "" : v > 0 ? "+" : "−") + Math.abs(v).toFixed(1) + "%"; }',
'  function frame(id, lo, hi, rowH, n) {',
'    var box = document.getElementById(id), old = box.querySelector("svg"); if (old) old.remove();',
'    var W = Math.max(320, box.clientWidth), narrow = W < 600, m = { l: narrow ? 8 : 200, r: 14, t: 8, b: 34 }, top = narrow ? 18 : 0;',
'    var H = m.t + n * (rowH + top) + m.b, svg = el("svg", { viewBox: "0 0 " + W + " " + H }); box.insertBefore(svg, box.firstChild);',
'    var x = function (v) { return m.l + (v - lo) / (hi - lo) * (W - m.l - m.r); };',
'    var step = nice(hi - lo, Math.max(3, Math.floor((W - m.l) / 90)));',
'    for (var v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) { el("line", { x1: x(v), x2: x(v), y1: m.t, y2: H - m.b, stroke: "var(--grid)" }, svg);',
'      el("text", { x: x(v), y: H - m.b + 16, "text-anchor": "middle" }, svg).textContent = money(Math.abs(v) < 1e-9 ? 0 : v); }',
'    if (lo < 0 && hi > 0) el("line", { x1: x(0), x2: x(0), y1: m.t, y2: H - m.b, stroke: "var(--muted)" }, svg);',
'    var yc = function (i) { return m.t + i * (rowH + top) + top + rowH / 2; };',
'    ROWS.forEach(function (r, i) { var t = el("text", narrow ? { x: m.l, y: yc(i) - rowH / 2 - 4 } : { x: m.l - 10, y: yc(i) + 4, "text-anchor": "end" }, svg);',
'      t.textContent = rowLabel(r) + " (" + netLabel(r) + ")"; t.setAttribute("style", "fill:var(--text)"); });',
'    return { box: box, svg: svg, x: x, yc: yc, W: W, H: H, m: m };',
'  }',
'  function chart1() {',
'    var all = []; ROWS.forEach(function (r) { all = all.concat(r.fly, [r.rule, r.randLo, r.randHi]); });',
'    var lo = Math.min.apply(null, all) - 0.1, hi = Math.max.apply(null, all) + 0.1;',
'    var f = frame("c1", lo, hi, 34, ROWS.length), svg = f.svg, x = f.x;',
'    ROWS.forEach(function (r, i) { var y = f.yc(i);',
'      var band = el("rect", { x: x(r.randLo), y: y - 9, width: x(r.randHi) - x(r.randLo), height: 18, rx: 4, fill: "var(--rand-band)" }, svg);',
'      el("line", { x1: x(r.randMean), x2: x(r.randMean), y1: y - 11, y2: y + 11, stroke: "var(--rand)", "stroke-width": 2 }, svg);',
'      hover(band, f.box, rowLabel(r) + "<br>무작위 1만 명: 평균 " + money(r.randMean) + "<br>가운데 90%: " + money(r.randLo) + " ~ " + money(r.randHi));',
'      var seen = {}; r.fly.slice().sort(function (a, b) { return a - b; }).forEach(function (v) { var key = Math.round(x(v) / 6); seen[key] = (seen[key] || 0) + 1;',
'        var off = ((seen[key] - 1) % 5 - 2) * 3.2;',
'        var c = el("circle", { cx: x(v), cy: y + off, r: 3.5, fill: "var(--fly)", stroke: "var(--surface)", "stroke-width": 1.5, "fill-opacity": 0.9 }, svg);',
'        hover(c, f.box, rowLabel(r) + "<br>초파리 1회: " + money(v)); });',
'      var d = el("rect", { x: x(r.rule) - 6, y: y - 6, width: 12, height: 12, fill: "var(--rule)", stroke: "var(--surface)", "stroke-width": 2, transform: "rotate(45 " + x(r.rule) + " " + y + ")" }, svg);',
'      hover(d, f.box, rowLabel(r) + "<br>규칙 투자자: " + money(r.rule));',
'    });',
'    el("text", { x: (f.m.l + f.W - f.m.r) / 2, y: f.H - 2, "text-anchor": "middle" }, svg).textContent = "최종 손익 (USD, 자본 $100)";',
'  }',
'  function chart2() {',
'    var all = []; ROWS.forEach(function (r) { r.fee.forEach(function (q) { all.push(q.gap); }); });',
'    var lo = Math.min(0, Math.min.apply(null, all)) - 0.1, hi = Math.max.apply(null, all) + 0.1;',
'    var f = frame("c2", lo, hi, 26, ROWS.length), svg = f.svg, x = f.x, col = { 0: "var(--f0)", 0.001: "var(--f1)", 0.006: "var(--f6)" };',
'    ROWS.forEach(function (r, i) { var y = f.yc(i), xs = r.fee.map(function (q) { return x(q.gap); });',
'      el("line", { x1: Math.min.apply(null, xs), x2: Math.max.apply(null, xs), y1: y, y2: y, stroke: "var(--grid)", "stroke-width": 2 }, svg);',
'      r.fee.forEach(function (q) { var c = el("circle", { cx: x(q.gap), cy: y, r: 6, fill: col[q.fee], stroke: "var(--surface)", "stroke-width": 2 }, svg);',
'        hover(c, f.box, rowLabel(r) + "<br>수수료 " + (q.fee * 100).toFixed(1) + "%<br>초파리 평균 " + money(q.fly) + " · 규칙 " + money(q.rule) + "<br>차이 " + money(q.gap)); }); });',
'    el("text", { x: (f.m.l + f.W - f.m.r) / 2, y: f.H - 2, "text-anchor": "middle" }, svg).textContent = "초파리 평균 − 규칙 투자자 (USD)";',
'  }',
'  function chart3() {',
'    var box = document.getElementById("c3"); if (!box) return; var old = box.querySelector("svg"); if (old) old.remove();',
'    var W = Math.max(320, box.clientWidth), narrow = W < 600, m = { l: narrow ? 8 : 200, r: 14, t: 8, b: 34 }, rowH = 44, top = narrow ? 18 : 0;',
'    var H = m.t + ROWS.length * (rowH + top) + m.b, svg = el("svg", { viewBox: "0 0 " + W + " " + H }); box.insertBefore(svg, box.firstChild);',
'    var half = (W - m.l - m.r) * 0.42, cx = m.l + half, sc = half / 0.3, tx = cx + half / 0.42 * 0.08;',
'    function x(v) { return cx + v * sc; }',
'    [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3].forEach(function (v) { el("line", { x1: x(v), x2: x(v), y1: m.t, y2: H - m.b, stroke: v === 0 ? "var(--muted)" : "var(--grid)" }, svg);',
'      el("text", { x: x(v), y: H - m.b + 16, "text-anchor": "middle" }, svg).textContent = Math.round(Math.abs(v) * 100) + "%"; });',
'    el("text", { x: x(-0.15), y: H - 2, "text-anchor": "middle" }, svg).textContent = "← 매도 비율"; el("text", { x: x(0.15), y: H - 2, "text-anchor": "middle" }, svg).textContent = "매수 비율 →";',
'    ROWS.forEach(function (r, i) { var y0 = m.t + i * (rowH + top) + top;',
'      var t = el("text", narrow ? { x: m.l, y: y0 - 4 } : { x: m.l - 10, y: y0 + rowH / 2 + 4, "text-anchor": "end" }, svg); t.textContent = rowLabel(r); t.setAttribute("style", "fill:var(--text)");',
'      [["원래", r, 0], ["반전", r.rev, 1]].forEach(function (p) { var s = p[1], y = y0 + 3 + p[2] * 19;',
'        var b = el("rect", { x: x(0) + 1, y: y, width: Math.max(0, x(s.buy) - x(0) - 1), height: 15, rx: 3, fill: "var(--fly)" }, svg);',
'        var sl = el("rect", { x: x(-s.sell), y: y, width: Math.max(0, x(0) - x(-s.sell) - 1), height: 15, rx: 3, fill: "var(--rule)" }, svg);',
'        el("text", { x: x(Math.max(s.buy, 0)) + 6, y: y + 12 }, svg).textContent = p[0];',
'        var html = rowLabel(r) + " · " + p[0] + " 매핑<br>매수 " + pct(s.buy) + " · 매도 " + pct(s.sell) + " · 보유 " + pct(s.hold);',
'        hover(b, box, html); hover(sl, box, html); });',
'      var mean = function (a) { return a.reduce(function (u, v) { return u + v; }, 0) / a.length; };',
'      if (!narrow) { var tt = el("text", { x: W - m.r, y: y0 + rowH / 2 + 4, "text-anchor": "end" }, svg);',
'        tt.textContent = "손익 원래 " + money(mean(r.fly.slice(0, 10))) + " · 반전 " + money(mean(r.rev.fly)) + " · 반대 규칙 " + money(r.rev.reverseRule); }',
'    });',
'  }',
'  function draw() { chart1(); chart2(); chart3(); }',
'  draw(); var t; window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(draw, 120); });',
'})();'
].join('\n');

main();
