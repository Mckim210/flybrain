/* trade-chart.js — self-contained HTML report for trade.js
 *
 * Chart 1: final P&L. Random investors as a histogram (share of 10,000 per bin),
 *          the fly runs as stacked dots on the same x-axis, the rule investor
 *          as a reference line.
 * Chart 2: per decision, the share of fly runs that did what the rule investor
 *          did, against the size of the previous hour's return.
 * Both charts have hover tooltips and a table view below.
 * Colours: reference palette slots 1-3 (blue / orange / aqua), light + dark.
 */
'use strict';

function esc(s) {
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderChart(summary, flyRuns, randPnl) {
	var data = {
		random: randPnl.map(function (x) { return Math.round(x * 10000) / 10000; }),
		fly: flyRuns,
		rule: summary.rule.pnl,
		perDecision: summary.perDecision,
		window: summary.window
	};
	var s = summary;
	function money(x) { return (x >= 0 ? '+$' : '−$') + Math.abs(x).toFixed(2); }
	function pct(x) { return (100 * x).toFixed(1) + '%'; }
	function statRow(name, d, cls) {
		return '<tr><th scope="row"><span class="key ' + cls + '"></span>' + esc(name) + '</th><td>' + d.n + '</td><td>' + money(d.mean) +
			'</td><td>' + money(d.median) + '</td><td>' + money(d.min) + '</td><td>' + money(d.p5) + ' ~ ' + money(d.p95) +
			'</td><td>' + money(d.max) + '</td><td>' + pct(d.shareProfit) + '</td><td>' + pct(d.shareAtLeast1) + '</td></tr>';
	}
	var KO = { buy: '매수', sell: '매도', hold: '보유', left: '왼쪽', right: '오른쪽', none: '없음' };
	var decisionRows = s.perDecision.map(function (d) {
		return '<tr><td>' + d.decision + '</td><td>' + esc(d.time) + '</td><td>' + (d.ret >= 0 ? '+' : '') + (100 * d.ret).toFixed(3) +
			'%</td><td>' + KO[d.eye] + ' ' + d.intensity.toFixed(2) + '</td><td>' + KO[d.rule] + '</td><td>' + pct(d.buy) +
			'</td><td>' + pct(d.sell) + '</td><td>' + pct(d.hold) + '</td><td>' + pct(d.followsRule) + '</td></tr>';
	}).join('\n');

	return '<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>초파리 트레이더 손익</title>\n' +
'<style>\n' +
':root { color-scheme: light; --surface:#fcfcfb; --surface-2:#f4f3f0; --text:#0b0b0b; --text-2:#52514e; --muted:#8a8984; --grid:#e4e3df;\n' +
'  --fly:#2a78d6; --rule:#eb6834; --rand:#1baf7a; }\n' +
'@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; --surface:#1a1a19; --surface-2:#242422;\n' +
'  --text:#ffffff; --text-2:#c3c2b7; --muted:#8f8e86; --grid:#33332f; --fly:#3987e5; --rule:#d95926; --rand:#199e70; } }\n' +
':root[data-theme="dark"] { color-scheme: dark; --surface:#1a1a19; --surface-2:#242422; --text:#ffffff; --text-2:#c3c2b7;\n' +
'  --muted:#8f8e86; --grid:#33332f; --fly:#3987e5; --rule:#d95926; --rand:#199e70; }\n' +
'* { box-sizing: border-box; }\n' +
'body { margin:0; background:var(--surface); color:var(--text); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", "Noto Sans KR", sans-serif; }\n' +
'main { max-width: 980px; margin: 0 auto; padding: 24px 16px 48px; }\n' +
'h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 32px 0 4px; }\n' +
'p.sub, .note { color: var(--text-2); margin: 0 0 12px; font-size: 14px; }\n' +
'.legend { display:flex; flex-wrap:wrap; gap: 6px 18px; margin: 8px 0; font-size: 13px; color: var(--text-2); }\n' +
'.key { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:6px; vertical-align:-1px; }\n' +
'.key.fly { background:var(--fly); border-radius:50%; } .key.rule { background:var(--rule); height:3px; width:14px; vertical-align:3px; }\n' +
'.key.rand { background:var(--rand); } .key.none { display:none; }\n' +
'.chart { position:relative; width:100%; }\n' +
'svg { display:block; width:100%; height:auto; overflow:visible; }\n' +
'svg text { fill: var(--text-2); font-size: 12px; }\n' +
'.tip { position:absolute; pointer-events:none; background:var(--surface-2); color:var(--text); border:1px solid var(--grid);\n' +
'  border-radius:6px; padding:6px 8px; font-size:12px; line-height:1.4; white-space:nowrap; opacity:0; transition:opacity .08s; }\n' +
'.table-wrap { overflow-x:auto; margin-top: 8px; }\n' +
'table { border-collapse: collapse; font-size: 13px; width: 100%; }\n' +
'th, td { padding: 5px 8px; border-bottom: 1px solid var(--grid); text-align: right; white-space: nowrap; }\n' +
'th:first-child, td:first-child { text-align: left; } thead th { color: var(--text-2); font-weight: 600; }\n' +
'details { margin-top: 8px; } summary { cursor: pointer; color: var(--text-2); font-size: 14px; }\n' +
'</style>\n</head>\n<body>\n<main>\n' +
'<h1>초파리 트레이더의 최종 손익</h1>\n' +
'<p class="sub">BTC/USD (Bitstamp 1분봉), ' + esc(s.window.from.slice(0, 16).replace('T', ' ')) + ' ~ ' +
	esc(s.window.to.slice(0, 16).replace('T', ' ')) + ' UTC · 1시간마다 결정 ' + s.window.decisions + '회 · 자본 $100, 주문당 최대 $10, 수수료 0.6%, 예비금 2%</p>\n' +
'<h2>최종 손익 분포</h2>\n' +
'<p class="note">막대: 무작위 투자자 1만 명 중 그 손익 구간에 든 비율 · 점: 초파리 ' + flyRuns.length + '회(시드만 다름) · 선: 규칙 투자자(오르면 매수, 내리면 매도)</p>\n' +
'<div class="legend"><span><span class="key fly"></span>(1) 초파리 ' + flyRuns.length + '회</span><span><span class="key rule"></span>(2) 규칙 투자자</span>' +
'<span><span class="key rand"></span>(3) 무작위 1만 명</span></div>\n' +
'<div class="chart" id="c1"><div class="tip"></div></div>\n' +
'<div class="table-wrap"><table><thead><tr><th>투자자</th><th>수</th><th>평균</th><th>중앙값</th><th>최저</th><th>5%~95%</th><th>최고</th><th>이익 비율</th><th>$1 이상</th></tr></thead><tbody>\n' +
	statRow('(1) 초파리 (시드 ' + flyRuns.length + '개)', s.fly.pnl, 'fly') + '\n' +
	'<tr><th scope="row"><span class="key rule"></span>(2) 규칙 투자자</th><td>1</td><td>' + money(s.rule.pnl) + '</td><td>' + money(s.rule.pnl) +
	'</td><td>' + money(s.rule.pnl) + '</td><td>-</td><td>' + money(s.rule.pnl) + '</td><td>' + (s.rule.pnl > 0 ? '100%' : '0%') + '</td><td>' +
	(s.rule.pnl >= 1 ? '100%' : '0%') + '</td></tr>\n' +
	statRow('(3) 무작위 1만 명 (각 1/3)', s.random.pnl, 'rand') + '\n' +
	statRow('(참고) 무작위, 초파리와 같은 행동 비율', s.randomMatched.pnl, 'none') + '\n' +
'</tbody></table></div>\n' +
'<h2>초파리는 규칙대로 움직였나</h2>\n' +
'<p class="note">점 하나 = 결정 시점 하나. 가로: 직전 1시간 수익률(오른쪽일수록 상승, 왼쪽 눈 자극) · 세로: 초파리 ' + flyRuns.length + '회 중 규칙 투자자와 같은 행동을 한 비율</p>\n' +
'<div class="chart" id="c2"><div class="tip"></div></div>\n' +
'<details><summary>결정 시점별 표 보기</summary><div class="table-wrap"><table><thead><tr><th>#</th><th>시각 (UTC)</th><th>수익률</th><th>자극</th><th>규칙</th>' +
	'<th>초파리 매수</th><th>매도</th><th>보유</th><th>규칙과 같음</th></tr></thead><tbody>\n' + decisionRows + '\n</tbody></table></div></details>\n' +
'<p class="note" style="margin-top:24px">한계: 시냅스 가중치 20배(실험용 설정), 매 결정마다 뇌를 초기화(기억 없음), 결과 변동은 배경 잡음에서만 나옴. ' +
	'가격은 Bitstamp BTC/USD(STONKFLY는 Coinbase BTC-USDC 사용) — 데이터: ff137/bitstamp-btcusd-minute-data, CC BY-SA 4.0.</p>\n' +
'</main>\n' +
'<script>\nvar DATA = ' + JSON.stringify(data) + ';\n' + CLIENT_JS + '\n</script>\n</body>\n</html>\n';
}

var CLIENT_JS = [
'(function () {',
'  var NS = "http://www.w3.org/2000/svg";',
'  function el(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }',
'  function money(x) { return (x >= 0 ? "+$" : "−$") + Math.abs(x).toFixed(2); }',
'  function niceStep(span, n) { var raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; }',
'  function showTip(box, html, x, y) { var t = box.querySelector(".tip"); t.innerHTML = html; t.style.opacity = 1;',
'    var w = box.clientWidth, tw = t.offsetWidth; t.style.left = Math.max(0, Math.min(w - tw, x + 12)) + "px"; t.style.top = Math.max(0, y - 40) + "px"; }',
'  function hideTip(box) { box.querySelector(".tip").style.opacity = 0; }',
'',
'  function chart1() {',
'    var box = document.getElementById("c1"); var old = box.querySelector("svg"); if (old) old.remove();',
'    var W = Math.max(320, box.clientWidth), H = 380, m = { l: 44, r: 12, t: 32, b: 40 };',
'    var all = DATA.random.concat(DATA.fly.map(function (f) { return f.pnl; }), [DATA.rule]);',
'    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);',
'    var binW = niceStep(hi - lo || 1, 36); lo = Math.floor(lo / binW) * binW; hi = Math.ceil(hi / binW) * binW + binW * 0.0001;',
'    var nb = Math.max(1, Math.round((hi - lo) / binW)), bins = new Array(nb).fill(0);',
'    DATA.random.forEach(function (x) { var i = Math.min(nb - 1, Math.floor((x - lo) / binW)); bins[i]++; });',
'    var share = bins.map(function (c) { return c / DATA.random.length; }), maxS = Math.max.apply(null, share);',
'    var flyLane = 90, histH = H - m.t - m.b - flyLane - 10;',
'    var x = function (v) { return m.l + (v - lo) / (hi - lo) * (W - m.l - m.r); };',
'    var yS = function (v) { return m.t + histH - v / maxS * histH; };',
'    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "최종 손익 분포" });',
'    box.insertBefore(svg, box.firstChild);',
'    var yStep = niceStep(maxS, 4);',
'    for (var v = 0; v <= maxS + 1e-9; v += yStep) { el("line", { x1: m.l, x2: W - m.r, y1: yS(v), y2: yS(v), stroke: "var(--grid)" }, svg);',
'      el("text", { x: m.l - 6, y: yS(v) + 4, "text-anchor": "end" }, svg).textContent = Math.round(v * 100) + "%"; }',
'    var xStep = niceStep(hi - lo, Math.max(3, Math.floor(W / 90))), x0 = Math.ceil(lo / xStep) * xStep;',
'    var axisY = H - m.b;',
'    el("line", { x1: m.l, x2: W - m.r, y1: axisY, y2: axisY, stroke: "var(--muted)" }, svg);',
'    for (var v = x0; v <= hi; v += xStep) { var xv = x(v); el("line", { x1: xv, x2: xv, y1: axisY, y2: axisY + 4, stroke: "var(--muted)" }, svg);',
'      el("text", { x: xv, y: axisY + 18, "text-anchor": "middle" }, svg).textContent = money(Math.abs(v) < 1e-9 ? 0 : v); }',
'    el("text", { x: (m.l + W - m.r) / 2, y: H - 4, "text-anchor": "middle" }, svg).textContent = "최종 손익 (USD)";',
'    if (lo < 0 && hi > 0) el("line", { x1: x(0), x2: x(0), y1: m.t, y2: axisY, stroke: "var(--muted)", "stroke-dasharray": "2 3" }, svg);',
'    var bw = Math.max(1, x(lo + binW) - x(lo) - 2);',
'    share.forEach(function (sv, i) { if (!sv) return; var bx = x(lo + i * binW) + 1, top = yS(sv), h = m.t + histH - top;',
'      var r = Math.min(4, bw / 2, h);',
'      el("path", { d: "M" + bx + "," + (m.t + histH) + "V" + (top + r) + "Q" + bx + "," + top + " " + (bx + r) + "," + top + "H" + (bx + bw - r) +',
'        "Q" + (bx + bw) + "," + top + " " + (bx + bw) + "," + (top + r) + "V" + (m.t + histH) + "Z", fill: "var(--rand)" }, svg);',
'      var hit = el("rect", { x: bx - 1, y: m.t, width: bw + 2, height: histH, fill: "transparent" }, svg);',
'      hit.addEventListener("mousemove", function (e) { var b = box.getBoundingClientRect();',
'        showTip(box, "무작위 투자자<br>" + money(lo + i * binW) + " ~ " + money(lo + (i + 1) * binW) + "<br>" + bins[i].toLocaleString() + "명 (" + (sv * 100).toFixed(1) + "%)", e.clientX - b.left, e.clientY - b.top); });',
'      hit.addEventListener("mouseleave", function () { hideTip(box); }); });',
'    var laneBase = axisY - 8, dotR = 4.5, stacks = {};',
'    el("text", { x: m.l + 2, y: laneBase - flyLane + 14 }, svg).textContent = "초파리 " + DATA.fly.length + "회";',
'    DATA.fly.slice().sort(function (a, b) { return a.pnl - b.pnl; }).forEach(function (f) {',
'      var i = Math.min(nb - 1, Math.floor((f.pnl - lo) / binW)); stacks[i] = (stacks[i] || 0) + 1;',
'      var cx = x(lo + (i + 0.5) * binW), cy = laneBase - dotR - (stacks[i] - 1) * (dotR * 2 + 1);',
'      var c = el("circle", { cx: cx, cy: cy, r: dotR, fill: "var(--fly)", stroke: "var(--surface)", "stroke-width": 2 }, svg);',
'      var hit = el("circle", { cx: cx, cy: cy, r: 9, fill: "transparent" }, svg);',
'      hit.addEventListener("mousemove", function (e) { var b = box.getBoundingClientRect();',
'        showTip(box, "초파리 " + (f.repeat + 1) + "회차<br>손익 " + money(f.pnl) + "<br>주문 " + f.orders + "건 · 규칙과 같은 행동 " + f.agree + "/" + DATA.perDecision.length +',
'          "<br>무작위 1만 명 중 백분위 " + (f.pctl * 100).toFixed(1) + "%", e.clientX - b.left, e.clientY - b.top); });',
'      hit.addEventListener("mouseleave", function () { hideTip(box); }); });',
'    var rx = x(DATA.rule);',
'    el("line", { x1: rx, x2: rx, y1: m.t, y2: axisY, stroke: "var(--rule)", "stroke-width": 2 }, svg);',
'    el("line", { x1: rx, x2: rx, y1: m.t - 14, y2: m.t, stroke: "var(--rule)", "stroke-width": 2 }, svg);',
'    var lbl = el("text", { x: rx + (rx > W - 170 ? -6 : 6), y: m.t - 18, "text-anchor": rx > W - 170 ? "end" : "start" }, svg);',
'    lbl.textContent = "규칙 투자자 " + money(DATA.rule);',
'    var rh = el("rect", { x: rx - 6, y: m.t, width: 12, height: axisY - m.t, fill: "transparent" }, svg);',
'    rh.addEventListener("mousemove", function (e) { var b = box.getBoundingClientRect(); showTip(box, "규칙 투자자 (오르면 매수, 내리면 매도)<br>손익 " + money(DATA.rule), e.clientX - b.left, e.clientY - b.top); });',
'    rh.addEventListener("mouseleave", function () { hideTip(box); });',
'  }',
'',
'  function chart2() {',
'    var box = document.getElementById("c2"); var old = box.querySelector("svg"); if (old) old.remove();',
'    var W = Math.max(320, box.clientWidth), H = 300, m = { l: 44, r: 12, t: 12, b: 40 };',
'    var P = DATA.perDecision, rets = P.map(function (d) { return d.ret * 100; });',
'    var ext = Math.max.apply(null, rets.map(Math.abs)) * 1.08;',
'    var x = function (v) { return m.l + (v + ext) / (2 * ext) * (W - m.l - m.r); };',
'    var y = function (v) { return m.t + (1 - v) * (H - m.t - m.b); };',
'    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "결정 시점별 규칙과 같은 행동 비율" });',
'    box.insertBefore(svg, box.firstChild);',
'    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) { el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: "var(--grid)" }, svg);',
'      el("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = Math.round(v * 100) + "%"; });',
'    var step = niceStep(2 * ext, Math.max(3, Math.floor(W / 90)));',
'    for (var v = Math.ceil(-ext / step) * step; v <= ext; v += step) { var xv = x(v);',
'      el("text", { x: xv, y: H - m.b + 18, "text-anchor": "middle" }, svg).textContent = (v > 0 ? "+" : "") + (Math.abs(v) < 1e-9 ? "0" : v.toFixed(2)) + "%"; }',
'    el("line", { x1: x(0), x2: x(0), y1: m.t, y2: H - m.b, stroke: "var(--muted)", "stroke-dasharray": "2 3" }, svg);',
'    el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: "var(--muted)" }, svg);',
'    var narrow = W < 600;',
'    el("text", { x: x(-ext) + 4, y: m.t + 12 }, svg).textContent = narrow ? "← 하락 (규칙=매도)" : "← 하락 (오른쪽 눈, 규칙=매도)";',
'    el("text", { x: x(ext) - 4, y: m.t + 12, "text-anchor": "end" }, svg).textContent = narrow ? "상승 (규칙=매수) →" : "상승 (왼쪽 눈, 규칙=매수) →";',
'    el("text", { x: (m.l + W - m.r) / 2, y: H - 4, "text-anchor": "middle" }, svg).textContent = "직전 1시간 수익률";',
'    var KO = { buy: "매수", sell: "매도", hold: "보유" };',
'    P.forEach(function (d) { var cx = x(d.ret * 100), cy = y(d.followsRule);',
'      el("circle", { cx: cx, cy: cy, r: 5, fill: "var(--fly)", stroke: "var(--surface)", "stroke-width": 2 }, svg);',
'      var hit = el("circle", { cx: cx, cy: cy, r: 11, fill: "transparent" }, svg);',
'      hit.addEventListener("mousemove", function (e) { var b = box.getBoundingClientRect();',
'        showTip(box, "#" + d.decision + " " + d.time + " UTC<br>수익률 " + (d.ret >= 0 ? "+" : "") + (d.ret * 100).toFixed(3) + "% · 자극 세기 " + d.intensity.toFixed(2) +',
'          "<br>규칙: " + KO[d.rule] + "<br>초파리 매수 " + Math.round(d.buy * 100) + "% · 매도 " + Math.round(d.sell * 100) + "% · 보유 " + Math.round(d.hold * 100) + "%", e.clientX - b.left, e.clientY - b.top); });',
'      hit.addEventListener("mouseleave", function () { hideTip(box); }); });',
'  }',
'',
'  function draw() { chart1(); chart2(); }',
'  draw(); var t; window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(draw, 120); });',
'})();'
].join('\n');

module.exports = { renderChart: renderChart };
