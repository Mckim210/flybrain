#!/usr/bin/env node
/* figure-neurons.js — where in the brain did a "buy" decision happen?
 *
 *   node experiments/figure-neurons.js --config experiments/config/trade-stonkfly-window-fixed1pct.json
 *        [--decision <index>] [--repeat <k>]
 *
 * Replays one saved fly decision with the same seed (default: the decision with
 * the largest price rise, first repeat whose saved action there was "buy"),
 * checks the replay gives the saved choice, records spikes per neuron during
 * the decision window and draws them at their FlyWire positions
 * (data/neuron_positions.bin, front view like the app's Neuron Map):
 *   panel 1: every neuron (grey) + neurons that fired, coloured by the three
 *            most active groups
 *   panel 2: descending neurons only, left vs right, size = spikes
 * Writes experiments/results/figures/neurons-buy.html (open in a browser) and
 * neurons-buy.json. The PNG next to it was captured from this HTML in a browser.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var market = require('./lib/market.js');
var common = require('./lib/trade-common.js');
var trial = require('./lib/choice-trial.js');
var HeadlessBrain = require('./lib/headless-sim.js').HeadlessBrain;

function parseArgs(argv) {
	var a = {};
	for (var i = 2; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
	return a;
}

function main() {
	var a = parseArgs(process.argv);
	var cfg = common.loadTradeConfig(a.config);
	var prices = common.loadPrices(cfg);
	var points = market.decisionPoints(prices, cfg.intervalMin);
	var fullScale = common.fullScaleReturn(cfg, points);
	var flyDir = path.join(__dirname, 'results', cfg.name, 'fly');

	var j = a.decision !== undefined ? +a.decision : points.reduce(function (best, p, i) { return p.ret > points[best].ret ? i : best; }, 0);
	var k = a.repeat !== undefined ? +a.repeat : -1, saved = null;
	for (var r = 0; r < cfg.fly.repeats; r++) {
		if (k >= 0 && r !== k) continue;
		var rep = JSON.parse(fs.readFileSync(path.join(flyDir, 'rep_' + String(r).padStart(2, '0') + '.json'), 'utf8'));
		if (k >= 0 || rep.decisions[j].action === 'buy') { k = r; saved = rep.decisions[j]; break; }
	}
	if (!saved) throw new Error('no repeat chose buy at decision ' + j);

	var brain = new HeadlessBrain();
	var out = trial.prepareReadout(brain, cfg.fly.readout);
	var res = trial.runTrial(brain, common.trialConfig(cfg, points[j].ret, fullScale), out, common.trialSeed(cfg, k, j), true);
	if (res.choice !== saved.choice || res.spikesL !== saved.spikesL || res.spikesR !== saved.spikesR) {
		throw new Error('replay differs from the saved trial (' + res.choice + ' vs ' + saved.choice + ')');
	}

	/* positions in original order: N x 3 uint16 (x, y, z), normalised */
	var posBuf = fs.readFileSync(path.join(__dirname, '..', 'data', 'neuron_positions.bin'));
	var N = brain.N;
	var xy = new Uint16Array(N * 2);          // original order, front view (x, y)
	for (var i = 0; i < N; i++) {
		xy[2 * i] = posBuf.readUInt16LE(i * 6);
		xy[2 * i + 1] = posBuf.readUInt16LE(i * 6 + 2);
	}

	/* group totals for this trial */
	var G = brain.groupNames.length, gL = res.groupL, gR = res.groupR;
	var groups = [];
	for (var g = 0; g < G; g++) if (gL[g] + gR[g] > 0) groups.push({ id: g, name: brain.groupNames[g], left: gL[g], right: gR[g] });
	groups.sort(function (x, y) { return (y.left + y.right) - (x.left + x.right); });
	var top = groups.slice(0, 3).map(function (x) { return x.id; });

	/* fired neurons + all descending neurons */
	var fired = [], desc = [];
	var isDesc = {};
	out.left.forEach(function (s) { isDesc[s] = 'L'; });
	out.right.forEach(function (s) { isDesc[s] = 'R'; });
	for (var s = 0; s < N; s++) {
		var o = brain.order[s], c = res.perNeuron[s];
		if (c > 0) fired.push([o, c, top.indexOf(brain.sortedGroupId[s])]);
		if (isDesc[s]) desc.push([o, c, isDesc[s] === 'L' ? 0 : 1]);
	}

	var p = points[j];
	var info = {
		config: path.relative(path.join(__dirname, '..'), a.config), period: cfg.label || 'STONKFLY 기간',
		decision: j + 1, time: p.iso, ret: p.ret, intensity: common.intensityFor(cfg, p.ret, fullScale),
		eye: common.eyeFor(cfg, p.ret), repeat: k, seed: common.trialSeed(cfg, k, j),
		choice: res.choice, action: 'buy', d: res.d, spikesL: res.spikesL, spikesR: res.spikesR,
		descLeftN: out.left.length, descRightN: out.right.length, totalSpikes: res.totalSpikes,
		firedNeurons: fired.length, weightScale: cfg.fly.weightScale,
		topGroups: groups.slice(0, 10)
	};
	var outDir = path.join(__dirname, 'results', 'figures');
	fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(path.join(outDir, 'neurons-buy.json'), JSON.stringify(info, null, 2) + '\n');
	fs.writeFileSync(path.join(outDir, 'neurons-buy.html'), render(info, Buffer.from(xy.buffer).toString('base64'), fired, desc, top.map(function (g) { return brain.groupNames[g]; })));
	console.log(JSON.stringify(info, null, 2));
}

var GROUP_KO = {
	VIS_R1R6: '광수용체 R1–R6', VIS_ME: '시각 수질(medulla)', VIS_LO: '시각 소엽(lobula)', VIS_LPTC: '시각 소엽판 LPTC',
	GENERIC_CENTRAL: '중앙 뇌(기타)', MB_KC: '버섯체 케년세포', GNG_DESC: '식도하 신경절 하행', CX_PFN: '중심체 PFN',
	OLF_ORN_FOOD: '먹이 냄새 수용체', MECH_BRISTLE: '기계감각 강모', MECH_JO: '존스턴 기관'
};

function render(info, xyB64, fired, desc, topNames) {
	function money(x) { return (x >= 0 ? '+' : '') + (100 * x).toFixed(3) + '%'; }
	var names = topNames.map(function (n) { return (GROUP_KO[n] ? GROUP_KO[n] + ' ' : '') + '(' + n + ')'; });
	var rows = info.topGroups.map(function (g) {
		return '<tr><td>' + (GROUP_KO[g.name] || '') + ' <code>' + g.name + '</code></td><td>' + g.left + '</td><td>' + g.right + '</td></tr>';
	}).join('');
	return '<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>매수 결정의 뇌 지도</title>\n<style>\n' +
':root { color-scheme: light; --surface:#fcfcfb; --surface-2:#f4f3f0; --text:#0b0b0b; --text-2:#52514e; --muted:#b9b8b2; --grid:#e4e3df;\n' +
'  --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --other:#8a8984; --bg-dot:rgba(60,60,55,.10); }\n' +
'@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; --surface:#1a1a19; --surface-2:#242422; --text:#fff;\n' +
'  --text-2:#c3c2b7; --muted:#55554f; --grid:#33332f; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --other:#8f8e86; --bg-dot:rgba(220,220,210,.10); } }\n' +
':root[data-theme="dark"] { color-scheme: dark; --surface:#1a1a19; --surface-2:#242422; --text:#fff; --text-2:#c3c2b7; --muted:#55554f;\n' +
'  --grid:#33332f; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --other:#8f8e86; --bg-dot:rgba(220,220,210,.10); }\n' +
'* { box-sizing:border-box; } body { margin:0; background:var(--surface); color:var(--text); font:15px/1.55 system-ui,-apple-system,"Segoe UI","Noto Sans KR",sans-serif; }\n' +
'main { max-width:1100px; margin:0 auto; padding:24px 16px 40px; } h1 { font-size:21px; margin:0 0 4px; } h2 { font-size:16px; margin:0 0 4px; }\n' +
'.sub, .note { color:var(--text-2); font-size:14px; margin:0 0 12px; }\n' +
'.facts { display:flex; flex-wrap:wrap; gap:8px 24px; margin:12px 0 20px; } .facts div { font-size:13px; color:var(--text-2); } .facts b { display:block; font-size:18px; color:var(--text); font-weight:600; }\n' +
'.panels { display:grid; grid-template-columns:1fr 1fr; gap:20px; } @media (max-width:760px) { .panels { grid-template-columns:1fr; } }\n' +
'canvas { width:100%; height:auto; display:block; background:var(--surface); }\n' +
'.legend { display:flex; flex-wrap:wrap; gap:4px 14px; font-size:13px; color:var(--text-2); margin:6px 0; }\n' +
'.k { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:5px; vertical-align:-1px; }\n' +
'.axis { display:flex; justify-content:space-between; font-size:12px; color:var(--text-2); }\n' +
'table { border-collapse:collapse; font-size:13px; margin-top:8px; } th, td { padding:4px 10px; border-bottom:1px solid var(--grid); text-align:right; } th:first-child, td:first-child { text-align:left; }\n' +
'code { font-size:12px; color:var(--text-2); }\n' +
'</style>\n</head>\n<body>\n<main>\n' +
'<h1>초파리가 “매수”를 고른 순간의 뇌</h1>\n' +
'<p class="sub">' + info.period + ' · 결정 #' + info.decision + ' (' + info.time + ' UTC) · 직전 1시간 ' + money(info.ret) + ' 상승 → ' +
	(info.eye === 'left' ? '왼쪽' : '오른쪽') + ' 눈 자극 세기 ' + info.intensity.toFixed(2) + ' · 반복 ' + info.repeat + ', 시드 ' + info.seed + ' (저장된 결정을 같은 시드로 다시 재생해 확인)</p>\n' +
'<div class="facts"><div><b>' + info.spikesL + ' : ' + info.spikesR + '</b>하행 뉴런 발화 (왼쪽 ' + info.descLeftN + '개 : 오른쪽 ' + info.descRightN + '개)</div>' +
	'<div><b>d = ' + (info.d >= 0 ? '+' : '') + info.d.toFixed(3) + '</b>편향 지수 (+면 왼쪽, 기준 ±0.2)</div>' +
	'<div><b>왼쪽 → 매수</b>판정</div><div><b>' + info.firedNeurons.toLocaleString() + '</b>한 번 이상 발화한 뉴런 (50틱)</div></div>\n' +
'<div class="panels">\n' +
'<section><h2>뇌 전체: 이 결정 동안 발화한 뉴런</h2>\n<div class="legend">' +
	names.map(function (n, i) { return '<span><span class="k" style="background:var(--s' + (i + 1) + ')"></span>' + n + '</span>'; }).join('') +
	'<span><span class="k" style="background:var(--other)"></span>그 외 그룹</span><span><span class="k" style="background:var(--muted)"></span>발화 안 함</span></div>\n' +
'<canvas id="c1" role="img" aria-label="발화한 뉴런 위치"></canvas><div class="axis"><span>← 파리의 왼쪽</span><span>정면에서 본 모습</span><span>파리의 오른쪽 →</span></div></section>\n' +
'<section><h2>하행 뉴런만 (뇌 → 몸통 출력, 판정에 쓰는 뉴런)</h2>\n<div class="legend"><span><span class="k" style="background:var(--s1)"></span>왼쪽 하행 뉴런</span>' +
	'<span><span class="k" style="background:var(--s2)"></span>오른쪽 하행 뉴런</span><span><span class="k" style="background:var(--muted)"></span>발화 안 함</span><span>점 크기 = 발화 수</span></div>\n' +
'<canvas id="c2" role="img" aria-label="좌우 하행 뉴런 발화"></canvas><div class="axis"><span>← 파리의 왼쪽</span><span>정면에서 본 모습</span><span>파리의 오른쪽 →</span></div></section>\n' +
'</div>\n' +
'<h2 style="margin-top:24px">가장 많이 발화한 뉴런 그룹 (이 결정, 50틱)</h2>\n<table><thead><tr><th>그룹</th><th>왼쪽</th><th>오른쪽</th></tr></thead><tbody>' + rows + '</tbody></table>\n' +
'<p class="note" style="margin-top:16px">좌표: data/neuron_positions.bin (FlyWire FAFB v783, 앱의 Neuron Map과 같은 정면 투영). 좌/우는 FlyWire classification의 side 열 — 이 데이터에서 side=left 뉴런은 그림 왼쪽에 모여 있음(평균 x 0.29 vs 0.78). ' +
	'모델: LIF, 시냅스 가중치 ' + info.weightScale + '배(실험용 설정), 배경 잡음 포함. FlyWire 데이터는 CC-BY-NC.</p>\n' +
'</main>\n<script>\n' +
'var XY = (function (b) { var s = atob(b), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Uint16Array(u.buffer); })("' + xyB64 + '");\n' +
'var FIRED = ' + JSON.stringify(fired) + ';\nvar DESC = ' + JSON.stringify(desc) + ';\n' +
'(function () {\n' +
'  var css = getComputedStyle(document.documentElement); function v(n) { return css.getPropertyValue(n).trim(); }\n' +
'  var N = XY.length / 2, x0 = 65535, x1 = 0, y0 = 65535, y1 = 0;\n' +
'  for (var i = 0; i < N; i++) { var x = XY[2*i], y = XY[2*i+1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }\n' +
'  function setup(id) { var c = document.getElementById(id), w = c.parentNode.clientWidth, h = Math.round(w * (y1 - y0) / (x1 - x0)) + 16, r = window.devicePixelRatio || 1;\n' +
'    c.width = w * r; c.height = h * r; c.style.height = h + "px"; var g = c.getContext("2d"); g.setTransform(r, 0, 0, r, 0, 0);\n' +
'    var sc = (w - 16) / (x1 - x0); return { g: g, X: function (x) { return 8 + (x - x0) * sc; }, Y: function (y) { return 8 + (y - y0) * sc; } }; }\n' +
'  function background(p) { p.g.fillStyle = v("--bg-dot"); for (var i = 0; i < N; i += 1) p.g.fillRect(p.X(XY[2*i]), p.Y(XY[2*i+1]), 1, 1); }\n' +
'  function draw() {\n' +
'    var p = setup("c1"); background(p);\n' +
'    var col = [v("--s1"), v("--s2"), v("--s3")], other = v("--other");\n' +
'    FIRED.slice().sort(function (a, b) { return (a[2] < 0 ? -1 : 2 - a[2]) - (b[2] < 0 ? -1 : 2 - b[2]); }).forEach(function (f) {\n' +
'      p.g.fillStyle = f[2] >= 0 ? col[f[2]] : other; p.g.globalAlpha = f[2] >= 0 ? 0.55 : 0.5; var r = 1 + Math.min(2, f[1] / 6);\n' +
'      p.g.fillRect(p.X(XY[2*f[0]]) - r / 2, p.Y(XY[2*f[0]+1]) - r / 2, r, r); });\n' +
'    p.g.globalAlpha = 1;\n' +
'    var q = setup("c2"); background(q); var mut = v("--muted"), dc = [v("--s1"), v("--s2")], surf = v("--surface");\n' +
'    DESC.forEach(function (d) { if (d[1] > 0) return; q.g.fillStyle = mut; q.g.beginPath(); q.g.arc(q.X(XY[2*d[0]]), q.Y(XY[2*d[0]+1]), 1.6, 0, 7); q.g.fill(); });\n' +
'    DESC.filter(function (d) { return d[1] > 0; }).forEach(function (d) { var r = 2.5 + 1.6 * Math.sqrt(d[1]);\n' +
'      q.g.beginPath(); q.g.arc(q.X(XY[2*d[0]]), q.Y(XY[2*d[0]+1]), r, 0, 7); q.g.fillStyle = dc[d[2]]; q.g.fill(); q.g.lineWidth = 1.5; q.g.strokeStyle = surf; q.g.stroke(); });\n' +
'  }\n' +
'  draw(); var t; window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(draw, 150); });\n' +
'})();\n</script>\n</body>\n</html>\n';
}

main();
