#!/usr/bin/env node
/* figures.js — charts for the response curve and the market simulation
 *
 *   node experiments/market/figures.js [--no-png]
 *
 * Writes experiments/market/results/figures/*.html (inline SVG, hover titles)
 * and a .png screenshot of each (Playwright + the pre-installed Chromium).
 */
'use strict';

var fs = require('fs');
var path = require('path');

var RES = path.join(__dirname, 'results');
var OUT = path.join(RES, 'figures');
var COLORS = { fly: '#2a78d6', flyRev: '#eb6834', rule: '#1baf7a', ruleRev: '#eda100', random: '#8a8984', btc: '#52514e' };
var TYPE_LABEL = { random: '무작위만', fly: '(a) 초파리', flyRev: '(b) 초파리 역발상', rule: '(c) 문턱 규칙', ruleRev: '(d) 역발상 규칙(참고)' };

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

function page(title, subtitle, body, legend) {
	return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' +
		':root{--bg:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--grid:#e4e3df}' +
		'body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,"Noto Sans KR",sans-serif}' +
		'.wrap{width:1100px;padding:24px 28px}h1{font-size:20px;margin:0 0 4px}p.sub{margin:0 0 12px;color:var(--ink2);font-size:13px}' +
		'.legend{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--ink2);margin:6px 0 10px}.legend span{display:inline-flex;align-items:center;gap:6px}' +
		'.sw{width:14px;height:3px;border-radius:2px;display:inline-block}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}' +
		'svg text{font-size:11px;fill:var(--ink2)}svg .t{font-size:12.5px;fill:var(--ink);font-weight:600}' +
		'</style></head><body><div class="wrap"><h1>' + esc(title) + '</h1><p class="sub">' + subtitle + '</p>' +
		(legend ? '<div class="legend">' + legend.map(function (l) {
			return '<span><i class="sw" style="background:' + l.color + (l.dash ? ';height:0;border-top:2px dashed ' + l.color : '') + '"></i>' + esc(l.label) + '</span>';
		}).join('') + '</div>' : '') + body + '</div></body></html>';
}

/* minimal chart frame: returns helpers to map data to pixels */
function frame(w, h, x0, x1, y0, y1, opts) {
	opts = opts || {};
	var m = { l: 46, r: 10, t: opts.title ? 24 : 8, b: 30 };
	var X = function (x) { return m.l + (x - x0) / (x1 - x0) * (w - m.l - m.r); };
	var Y = function (y) { return h - m.b - (y - y0) / (y1 - y0) * (h - m.t - m.b); };
	var g = [];
	(opts.yTicks || []).forEach(function (v) {
		g.push('<line x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#e4e3df"/>');
		g.push('<text x="' + (m.l - 5) + '" y="' + (Y(v) + 3.5) + '" text-anchor="end">' + (opts.yFmt ? opts.yFmt(v) : v) + '</text>');
	});
	(opts.xTicks || []).forEach(function (v) {
		g.push('<text x="' + X(v) + '" y="' + (h - m.b + 15) + '" text-anchor="middle">' + (opts.xFmt ? opts.xFmt(v) : v) + '</text>');
	});
	g.push('<line x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + (h - m.b) + '" y2="' + (h - m.b) + '" stroke="#b9b8b3"/>');
	if (opts.title) g.push('<text class="t" x="' + m.l + '" y="15">' + esc(opts.title) + '</text>');
	if (opts.xLabel) g.push('<text x="' + ((m.l + w - m.r) / 2) + '" y="' + (h - 2) + '" text-anchor="middle">' + esc(opts.xLabel) + '</text>');
	return { X: X, Y: Y, g: g, w: w, h: h };
}
function svg(f, inner) { return '<svg width="' + f.w + '" height="' + f.h + '" viewBox="0 0 ' + f.w + ' ' + f.h + '">' + f.g.join('') + inner.join('') + '</svg>'; }
function niceTicks(lo, hi, n) {
	var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / n)));
	[1, 2, 2.5, 5, 10].some(function (k) { if (span / (step * k) <= n) { step *= k; return true; } return false; });
	var out = [];
	for (var v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) out.push(+v.toPrecision(10));
	return out;
}

/* ---------- 1. response curve ---------- */
function responseCurve() {
	var c = JSON.parse(fs.readFileSync(path.join(RES, 'response-curve', 'curve.json'), 'utf8'));
	var xs = c.intensities;
	var rough = [[0, 0.1, 0.05, 0.04], [0.2, 0.3, 0.18, 0], [0.3, 0.5, 0.32, 0], [0.5, 1.0, 0.45, 0]];
	function panel(key, title, roughIdx) {
		var f = frame(520, 340, 0, 1, 0, 1, { title: title, yTicks: [0, 0.2, 0.4, 0.6, 0.8, 1], yFmt: function (v) { return (100 * v) + '%'; },
			xTicks: [0, 0.2, 0.4, 0.6, 0.8, 1], xLabel: '자극 세기' });
		var s = [];
		// pooled CI band
		var band = xs.map(function (x, i) { return f.X(x) + ',' + f.Y(c.pooled[i][key + 'CI'][1]); })
			.concat(xs.slice().reverse().map(function (x, j) { var i = xs.length - 1 - j; return f.X(x) + ',' + f.Y(c.pooled[i][key + 'CI'][0]); }));
		s.push('<polygon points="' + band.join(' ') + '" fill="#2a78d6" fill-opacity="0.12"/>');
		[['left', '#6250d6'], ['right', '#e87ba4']].forEach(function (e) {
			s.push('<polyline fill="none" stroke="' + e[1] + '" stroke-width="1.5" stroke-dasharray="1 0" opacity="0.8" points="' +
				xs.map(function (x, i) { return f.X(x) + ',' + f.Y(c[e[0]][i][key]); }).join(' ') + '"/>');
		});
		s.push('<polyline fill="none" stroke="#2a78d6" stroke-width="2.5" points="' + xs.map(function (x, i) { return f.X(x) + ',' + f.Y(c.pooled[i][key]); }).join(' ') + '"/>');
		xs.forEach(function (x, i) {
			var p = c.pooled[i];
			s.push('<circle cx="' + f.X(x) + '" cy="' + f.Y(p[key]) + '" r="4.5" fill="#2a78d6" stroke="#fcfcfb" stroke-width="2"><title>세기 ' + x + ': 좌우 합침 ' +
				(100 * p[key]).toFixed(0) + '% (95% CI ' + (100 * p[key + 'CI'][0]).toFixed(0) + '~' + (100 * p[key + 'CI'][1]).toFixed(0) + '%), 왼쪽 눈 ' +
				(100 * c.left[i][key]).toFixed(0) + '%, 오른쪽 눈 ' + (100 * c.right[i][key]).toFixed(0) + '%</title></circle>');
		});
		rough.forEach(function (r) {
			s.push('<line x1="' + f.X(r[0]) + '" x2="' + f.X(r[1]) + '" y1="' + f.Y(r[roughIdx]) + '" y2="' + f.Y(r[roughIdx]) + '" stroke="#0b0b0b" stroke-width="2" stroke-dasharray="5 4"/>');
		});
		return svg(f, s);
	}
	var body = '<div style="display:flex;gap:16px">' + panel('same', '같은 방향 선택(자극한 눈 쪽) 확률', 2) + panel('opp', '반대 방향 선택 확률', 3) + '</div>';
	var html = page('초파리 반응 곡선', '세기마다 왼쪽 눈 30회 + 오른쪽 눈 30회(세기 0 = 자극 없음 30회). 띠 = 좌우 합친 값의 Wilson 95% 신뢰구간. 점선 = CLAUDE.md의 사전 대략치.', body,
		[{ color: '#2a78d6', label: '좌우 합침(n=60)' }, { color: '#6250d6', label: '왼쪽 눈만(n=30)' }, { color: '#e87ba4', label: '오른쪽 눈만(n=30)' }, { color: '#0b0b0b', label: '사전 대략치', dash: true }]);
	fs.writeFileSync(path.join(OUT, 'response-curve.html'), html);
}

/* ---------- 2. market metrics vs fraction ---------- */
function marketMetrics(S) {
	var base = S.config.base, baseKey = 'L' + base.lambda + '_S' + base.sigma;
	var types = S.config.types;
	var rnd = S.conditions.filter(function (c) { return c.key === baseKey && c.type === 'random'; })[0];
	function cond(type, f) { return S.conditions.filter(function (c) { return c.key === baseKey && c.type === type && c.fraction === f && c.refMult === 1; })[0]; }
	var panels = [
		['runaway', '가격 폭주한 시드 비율', function (v) { return (100 * v).toFixed(0) + '%'; }, 1],
		['volatility', '변동성 (수익률 표준편차 ×1000)', function (v) { return (1000 * v).toFixed(1); }, 1000],
		['maxDrawdown', '최대 낙폭', function (v) { return (100 * v).toFixed(0) + '%'; }, 1],
		['acfR1', '수익률 자기상관 ACF(r,1)', function (v) { return v.toFixed(1); }, 1],
		['acfAbs1', '절대수익률 자기상관 ACF(|r|,1)', function (v) { return v.toFixed(1); }, 1],
		['kurtosis', '초과첨도', function (v) { return v.toFixed(1); }, 1]
	];
	var fr = [0].concat(S.config.fractions);
	var body = '<div class="grid">' + panels.map(function (p) {
		var key = p[0], lo = Infinity, hi = -Infinity;
		fr.forEach(function (f) {
			(f === 0 ? [rnd] : types.map(function (t) { return cond(t, f); })).forEach(function (c) {
				lo = Math.min(lo, c.summary[key].lo); hi = Math.max(hi, c.summary[key].hi);
			});
		});
		if (key === 'runaway' || key === 'maxDrawdown') { lo = 0; hi = Math.max(hi, 0.1); }
		lo = Math.min(lo, 0); var pad = (hi - lo) * 0.06; hi += pad; if (lo < 0) lo -= pad;
		var f = frame(350, 250, -0.06, 0.81, lo, hi, { title: p[1], yTicks: niceTicks(lo, hi, 5), yFmt: p[2], xTicks: fr, xFmt: function (v) { return (100 * v) + '%'; }, xLabel: '추세 반응 투자자 비율' });
		var s = [];
		if (lo < 0) s.push('<line x1="' + f.X(-0.06) + '" x2="' + f.X(0.81) + '" y1="' + f.Y(0) + '" y2="' + f.Y(0) + '" stroke="#b9b8b3"/>');
		types.forEach(function (t, ti) {
			var off = (ti - 1.5) * 0.016;
			var pts = fr.map(function (fv) { var c = fv === 0 ? rnd : cond(t, fv); return [fv + off, c.summary[key]]; });
			s.push('<polyline fill="none" stroke="' + COLORS[t] + '" stroke-width="2" points="' + pts.map(function (q) { return f.X(q[0]) + ',' + f.Y(q[1].mean); }).join(' ') + '"/>');
			pts.forEach(function (q, i) {
				s.push('<line x1="' + f.X(q[0]) + '" x2="' + f.X(q[0]) + '" y1="' + f.Y(q[1].lo) + '" y2="' + f.Y(q[1].hi) + '" stroke="' + COLORS[t] + '" stroke-width="1.5"/>');
				s.push('<circle cx="' + f.X(q[0]) + '" cy="' + f.Y(q[1].mean) + '" r="4" fill="' + COLORS[t] + '" stroke="#fcfcfb" stroke-width="2"><title>' +
					TYPE_LABEL[t] + ' ' + (100 * fr[i]) + '%: ' + p[2](q[1].mean) + ' [' + p[2](q[1].lo) + ', ' + p[2](q[1].hi) + ']</title></circle>');
			});
		});
		return svg(f, s);
	}).join('') + '</div>';
	var html = page('추세 반응 투자자 비율에 따른 시장 지표', '기본 설정(λ ' + base.lambda + ', σ ' + base.sigma + ', 기준값 ×1), 조건마다 시드 ' + S.config.seeds +
		'개 평균과 95% 신뢰구간. 0%는 모두 같은 무작위 시장. 같은 비율의 점은 겹치지 않게 옆으로 조금씩 밀었음.', body,
		types.map(function (t) { return { color: COLORS[t], label: TYPE_LABEL[t] }; }));
	fs.writeFileSync(path.join(OUT, 'market-metrics.html'), html);
}

/* ---------- 3. example price paths ---------- */
function paths(S) {
	var base = S.config.base, baseKey = 'L' + base.lambda + '_S' + base.sigma;
	var list = [S.conditions.filter(function (c) { return c.key === baseKey && c.type === 'random'; })[0]].concat(
		S.config.types.map(function (t) { return S.conditions.filter(function (c) { return c.key === baseKey && c.type === t && c.fraction === 0.5 && c.refMult === 1; })[0]; }));
	var seeds = [1, 2, 3];
	var body = '<div class="grid">' + seeds.map(function (seed) {
		var lo = 0, hi = 0;
		list.forEach(function (c) { c.examplePaths[seed - 1].logP.forEach(function (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); }); });
		var T = list[0].examplePaths[0].logP.length - 1;
		var f = frame(350, 260, 0, T, lo, hi + (hi - lo) * 0.05, { title: '시드 ' + seed, yTicks: niceTicks(lo, hi, 5), yFmt: function (v) { return v.toFixed(2); },
			xTicks: [0, 100, 200, 300, 400, 500], xLabel: '단계' });
		var s = [];
		list.forEach(function (c) {
			var lp = c.examplePaths[seed - 1].logP;
			s.push('<polyline fill="none" stroke="' + COLORS[c.type] + '" stroke-width="' + (c.type === 'random' ? 1.5 : 2) + '" points="' +
				lp.map(function (v, i) { return f.X(i).toFixed(1) + ',' + f.Y(v).toFixed(1); }).join(' ') + '"><title>' + TYPE_LABEL[c.type] +
				': 마지막 ln P = ' + lp[lp.length - 1].toFixed(2) + '</title></polyline>');
		});
		return svg(f, s);
	}).join('') + '</div>';
	var html = page('가격 경로 예시 (추세 반응 투자자 50%)', '세로축 = 로그가격 ln P (시작 0). 같은 시드는 뉴스 충격과 무작위 투자자 결정이 같고, 바뀐 투자자 종류만 다름. 기본 설정, 기준값 ×1.', body,
		list.map(function (c) { return { color: COLORS[c.type], label: TYPE_LABEL[c.type] + (c.type === 'random' ? '(0%)' : '') }; }));
	fs.writeFileSync(path.join(OUT, 'paths.html'), html);
}

/* ---------- 4. BTC comparison ---------- */
function btc(S) {
	var base = S.config.base, baseKey = 'L' + base.lambda + '_S' + base.sigma;
	var keys = [['kurtosis', '초과첨도'], ['acfR1', 'ACF(r,1)'], ['acfAbs1', 'ACF(|r|,1)'], ['acfAbs5', 'ACF(|r|,5)'], ['acfAbs10', 'ACF(|r|,10)']];
	var cands = S.conditions.filter(function (c) { return c.key === baseKey && (c.type === 'random' || c.refMult === 1); });
	var rows = cands.map(function (c) { return { c: c, label: TYPE_LABEL[c.type] + (c.type === 'random' ? '' : ' ' + 100 * c.fraction + '%') }; });
	var body = '<div class="grid" style="grid-template-columns:repeat(5,1fr)">' + keys.map(function (k, ki) {
		var b = S.btc.block[k[0]], lo = Math.min(b.lo, 0), hi = b.hi;
		rows.forEach(function (r) { lo = Math.min(lo, r.c.summary[k[0]].lo); hi = Math.max(hi, r.c.summary[k[0]].hi); });
		var pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
		var h = 30 + rows.length * 22 + 30, w = ki === 0 ? 330 : 190;
		var ml = ki === 0 ? 150 : 10;
		var X = function (x) { return ml + (x - lo) / (hi - lo) * (w - ml - 10); };
		var s = ['<text class="t" x="' + ml + '" y="15">' + k[1] + '</text>'];
		s.push('<rect x="' + X(b.lo) + '" y="24" width="' + Math.max(1, X(b.hi) - X(b.lo)) + '" height="' + (rows.length * 22 + 4) + '" fill="#52514e" fill-opacity="0.14"/>');
		s.push('<line x1="' + X(b.mean) + '" x2="' + X(b.mean) + '" y1="24" y2="' + (28 + rows.length * 22) + '" stroke="#52514e" stroke-width="2"/>');
		if (lo < 0 && hi > 0) s.push('<line x1="' + X(0) + '" x2="' + X(0) + '" y1="24" y2="' + (28 + rows.length * 22) + '" stroke="#b9b8b3" stroke-dasharray="2 3"/>');
		niceTicks(lo, hi, 3).forEach(function (v) { s.push('<text x="' + X(v) + '" y="' + (h - 12) + '" text-anchor="middle">' + v + '</text>'); });
		rows.forEach(function (r, i) {
			var y = 38 + i * 22, m = r.c.summary[k[0]];
			if (ki === 0) s.push('<text x="' + (ml - 8) + '" y="' + (y + 4) + '" text-anchor="end" style="fill:#0b0b0b">' + esc(r.label) + '</text>');
			s.push('<line x1="' + X(m.lo) + '" x2="' + X(m.hi) + '" y1="' + y + '" y2="' + y + '" stroke="' + COLORS[r.c.type] + '" stroke-width="1.5"/>');
			s.push('<circle cx="' + X(m.mean) + '" cy="' + y + '" r="4.5" fill="' + COLORS[r.c.type] + '" stroke="#fcfcfb" stroke-width="2"><title>' + esc(r.label) + ': ' +
				m.mean.toFixed(3) + ' [' + m.lo.toFixed(3) + ', ' + m.hi.toFixed(3) + '], 실제 BTC ' + b.mean.toFixed(3) + '</title></circle>');
		});
		return '<svg width="' + w + '" height="' + h + '">' + s.join('') + '</svg>';
	}).join('') + '</div>';
	var html = page('어느 시장이 실제 비트코인과 비슷한가', '회색 세로선·띠 = 실제 BTC 1시간 수익률(500시간 묶음 ' + S.btc.blocks + '개)의 평균과 95% 신뢰구간. 점 = 시뮬레이션 시장(시드 ' +
		S.config.seeds + '개 평균, 가로선 = 95% CI). 기본 설정, 기준값 ×1.', body,
		S.config.types.concat(['random']).map(function (t) { return { color: COLORS[t], label: TYPE_LABEL[t] }; }).concat([{ color: '#52514e', label: '실제 BTC' }]));
	fs.writeFileSync(path.join(OUT, 'btc.html'), html.replace('.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}', '.grid{display:flex;gap:8px}'));
}

function screenshots(names, dir) {
	dir = dir || OUT;
	var pw;
	try { pw = require('playwright'); } catch (e) {
		try { pw = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')); } catch (e2) { console.log('playwright not found: PNGs skipped'); return Promise.resolve(); }
	}
	return pw.chromium.launch().then(function (browser) {
		return names.reduce(function (p, n) {
			return p.then(function () {
				return browser.newPage({ viewport: { width: 1160, height: 400 }, deviceScaleFactor: 2 }).then(function (pg) {
					return pg.goto('file://' + path.join(dir, n + '.html'))
						.then(function () { return pg.locator('.wrap').screenshot({ path: path.join(dir, n + '.png') }); })
						.then(function () { return pg.close(); });
				});
			});
		}, Promise.resolve()).then(function () { return browser.close(); });
	});
}

function main() {
	fs.mkdirSync(OUT, { recursive: true });
	var names = [];
	if (fs.existsSync(path.join(RES, 'response-curve', 'curve.json'))) { responseCurve(); names.push('response-curve'); }
	var sf = path.join(RES, 'market', 'summary.json');
	if (fs.existsSync(sf)) {
		var S = JSON.parse(fs.readFileSync(sf, 'utf8'));
		marketMetrics(S); paths(S); btc(S);
		names.push('market-metrics', 'paths', 'btc');
	}
	(process.argv.indexOf('--no-png') >= 0 ? Promise.resolve() : screenshots(names))
		.then(function () { console.log('figures: ' + names.join(', ')); })
		.catch(function (e) { console.error(e); process.exit(1); });
}

if (require.main === module) main();

module.exports = { page: page, frame: frame, svg: svg, niceTicks: niceTicks, esc: esc, screenshots: screenshots, COLORS: COLORS };
