/* FlyBrain Trader — replays recorded fly-brain trading decisions in a 3D night office.
 * Data (data/meta.json, data/spikes_<rep>.txt) comes from experiments/trader3d/export-replay.js:
 * real LIF runs (weightScale 20) on real BTC prices; nothing here invents a decision. */
(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
var COL = { up: '#2fd47c', down: '#ff5a6e', amber: '#f4b740', violet: '#b394ff', dim: '#8b94ab', neuron: '#7fb0ff', ink: '#e9ecf5' };
var REP_LABEL = { 11: '중간 회차', 0: '가장 잘한 회차', 14: '가장 못한 회차' };
var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

function b64ToU16(txt) {
	var bin = atob(txt.trim()), u8 = new Uint8Array(bin.length);
	for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
	return new Uint16Array(u8.buffer);
}
function money(v) { var s = Math.abs(v) < 0.005 ? '$0.00' : (v > 0 ? '+$' : '−$') + Math.abs(v).toFixed(2); return s; }
function pct(v) { return (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(2) + '%'; }
function hhmm(t) { var d = new Date(t * 1000); return String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0') + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }

fetch('data/meta.json').then(function (r) { return r.json(); }).then(start).catch(function (e) {
	$('loading').textContent = '기록을 불러오지 못했어요: ' + e.message;
});

function start(meta) {
	var R = meta.rules, C = meta.candles, P = meta.points;
	var spikeCache = {};
	function loadSpikes(rep) {
		if (spikeCache[rep]) return Promise.resolve(spikeCache[rep]);
		return fetch('data/spikes_' + rep + '.txt').then(function (r) { return r.text(); }).then(function (txt) {
			var u = b64ToU16(txt), info = meta.reps.filter(function (x) { return x.rep === rep; })[0], off = 0;
			var dec = info.chunkLengths.map(function (L) {
				var ticks = [], p = off, end = off + L;
				while (p < end) { var n = u[p++]; ticks.push(u.subarray(p, p + n)); p += n; }
				off = end; return ticks;
			});
			spikeCache[rep] = dec; return dec;
		});
	}

	/* ---------- portfolio replay (same rules as experiments/lib/market.js) ---------- */
	function walletPath(actions) {
		var cash = R.capital, btc = 0, fees = 0, orders = 0, reserve = R.capital * R.reserveRate, out = [];
		for (var k = 0; k < P.length; k++) {
			var a = actions[k], p = P[k].price, done = 'hold';
			if (a === 'buy') { var usd = Math.min(R.orderUsd, (cash - reserve) / (1 + R.feeRate)); if (usd > 0.005) { cash -= usd * (1 + R.feeRate); fees += usd * R.feeRate; btc += usd / p; done = 'buy'; orders++; } }
			else if (a === 'sell') { var u2 = Math.min(R.orderUsd, btc * p); if (u2 > 0.005) { btc -= u2 / p; if (btc < 1e-15) btc = 0; cash += u2 * (1 - R.feeRate); fees += u2 * R.feeRate; done = 'sell'; orders++; } }
			out.push({ done: done, cash: cash, btc: btc, fees: fees, orders: orders, value: cash + btc * p });
		}
		return out;
	}
	var ruleW = walletPath(P.map(function (p) { return p.ret > 0 ? 'buy' : (p.ret < 0 ? 'sell' : 'hold'); }));

	/* ---------- renderer & scene ---------- */
	var canvas = $('scene');
	var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
	renderer.setClearColor(0x05060d);
	var scene = new THREE.Scene();
	scene.fog = new THREE.Fog(0x05060d, 16, 42);
	var camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
	camera.position.set(-4.6, 3.7, 7.4);
	var controls = new THREE.OrbitControls(camera, canvas);
	controls.target.set(0.5, 2.0, 0); controls.enableDamping = true; controls.minDistance = 3; controls.maxDistance = 16;
	controls.maxPolarAngle = Math.PI * 0.49; controls.update();

	scene.add(new THREE.AmbientLight(0x4a5890, 0.38));
	scene.add(new THREE.HemisphereLight(0x8090ff, 0x201030, 0.2));
	var key = new THREE.PointLight(0xff4fa8, 0.55, 22); key.position.set(-6, 5, 2); scene.add(key);
	var rim = new THREE.PointLight(0x28e0e0, 0.7, 22); rim.position.set(5, 5, 5); scene.add(rim);
	var monLight = new THREE.PointLight(0x9fc0ff, 1.5, 7); monLight.position.set(1.2, 2.3, 0.2); scene.add(monLight);
	function std(c, o) { return new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.7 }, o || {})); }

	// city backdrop (decor)
	var rnd = (function (s) { return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })(7);
	var palette = ['#ff4fa8', '#28e0e0', '#5b8cff', '#ffd36b'];
	for (var i = 0; i < 50; i++) {
		var w = 1 + rnd() * 1.6, h = 5 + rnd() * 13;
		var bld = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1.2), std(0x151132, { flatShading: true }));
		bld.position.set(-18 + i * 0.8 + rnd(), h / 2 - 1, -10 - rnd() * 8); scene.add(bld);
		var wc = document.createElement('canvas'); wc.width = 64; wc.height = 256; var q = wc.getContext('2d');
		q.fillStyle = '#110e28'; q.fillRect(0, 0, 64, 256);
		for (var y = 4; y < 256; y += 10) for (var x = 4; x < 64; x += 10) if (rnd() < 0.32) { q.fillStyle = palette[(rnd() * 4) | 0]; q.globalAlpha = 0.4 + rnd() * 0.6; q.fillRect(x, y, 4, 5); }
		var face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(wc) }));
		face.position.set(bld.position.x, bld.position.y, bld.position.z + 0.61); scene.add(face);
	}
	var floor = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), std(0x0b0a1b)); floor.rotation.x = -Math.PI / 2; floor.position.y = -1; scene.add(floor);
	var DT = 0.99;
	var desk = new THREE.Mesh(new THREE.BoxGeometry(7, 0.16, 3.2), std(0x1a1936, { roughness: 0.4, metalness: 0.2 })); desk.position.set(0.8, 0.91, 0); scene.add(desk);
	var edge = new THREE.Mesh(new THREE.BoxGeometry(7, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0x28e0e0 })); edge.position.set(0.8, 0.98, 1.6); scene.add(edge);
	[[-2.5, -1.4], [-2.5, 1.4], [4.1, -1.4], [4.1, 1.4]].forEach(function (xz) { var l = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.9, 0.12), std(0x14132b)); l.position.set(xz[0], -0.05, xz[1]); scene.add(l); });
	var mug = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.34, 16), std(0x4a2a6a)); mug.position.set(3.6, 1.16, 0.8); scene.add(mug);
	var kb = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.55), std(0x15142c, { roughness: 0.5 })); kb.position.set(1.7, 1.02, 0.25); kb.rotation.y = -0.3; scene.add(kb);
	(function () { var c = document.createElement('canvas'); c.width = 340; c.height = 110; var g = c.getContext('2d'); g.fillStyle = '#15142c'; g.fillRect(0, 0, 340, 110);
		for (var y = 0; y < 5; y++) for (var x = 0; x < 16; x++) { g.fillStyle = '#22213f'; g.fillRect(4 + x * 21, 4 + y * 21, 18, 18); g.fillStyle = 'rgba(40,224,224,.25)'; g.fillRect(4 + x * 21, 20 + y * 21, 18, 2); }
		var t = new THREE.Mesh(new THREE.PlaneGeometry(1.66, 0.52), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c) })); t.rotation.x = -Math.PI / 2; t.position.y = 0.03; kb.add(t); })();

	// monitor
	var MW = 1600, MH = 900, mcv = document.createElement('canvas'); mcv.width = MW; mcv.height = MH;
	var mtex = new THREE.CanvasTexture(mcv); mtex.anisotropy = 8;
	var screen = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 2.19), new THREE.MeshBasicMaterial({ map: mtex }));
	screen.position.set(1.9, 2.35, -1.0); screen.rotation.y = -0.3; scene.add(screen);
	var bezel = new THREE.Mesh(new THREE.BoxGeometry(4.04, 2.33, 0.08), std(0x08080f, { roughness: 0.3 })); bezel.position.copy(screen.position); bezel.rotation.y = screen.rotation.y; bezel.translateZ(-0.05); scene.add(bezel);
	var stand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.16), std(0x08080f)); stand.position.set(1.95, 1.5, -1.12); scene.add(stand);
	var standB = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.5), std(0x08080f)); standB.position.set(1.95, 1.0, -1.05); scene.add(standB);

	/* ---------- fly (decor model; decisions come from the recorded brain) ---------- */
	function seg(a, b, r0, r1, mat) { var d = new THREE.Vector3().subVectors(b, a), L = d.length(); var m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, L, 8), mat); m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return m; }
	function stripeTex(base, dark, n, vertical) { var c = document.createElement('canvas'); c.width = 256; c.height = 256; var g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, 256, 256);
		for (var i = 0; i < 4000; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.06)'; g.fillRect(rnd() * 256, rnd() * 256, 2, 2); }
		g.fillStyle = dark; for (var j = 0; j < n; j++) { if (vertical) g.fillRect(256 * (j + 0.5) / n - 10, 0, 20, 256); else g.fillRect(0, 256 * (j + 0.6) / n, 256, 256 / n * 0.35); } return new THREE.CanvasTexture(c); }
	function wingTex() { var c = document.createElement('canvas'); c.width = 256; c.height = 512; var g = c.getContext('2d');
		var gr = g.createLinearGradient(0, 0, 256, 512); gr.addColorStop(0, 'rgba(200,220,255,.42)'); gr.addColorStop(0.5, 'rgba(255,190,240,.36)'); gr.addColorStop(1, 'rgba(170,255,240,.40)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 512);
		g.strokeStyle = 'rgba(40,30,30,.85)'; g.lineWidth = 3; [[128, 0, 40, 500], [128, 0, 90, 505], [128, 0, 140, 505], [128, 0, 195, 480], [128, 0, 235, 420]].forEach(function (v) { g.beginPath(); g.moveTo(v[0], v[1]); g.quadraticCurveTo((v[0] + v[2]) / 2 + 15, 250, v[2], v[3]); g.stroke(); });
		g.lineWidth = 2; g.beginPath(); g.moveTo(80, 260); g.lineTo(150, 250); g.moveTo(150, 330); g.lineTo(205, 320); g.stroke(); return new THREE.CanvasTexture(c); }
	var fly = new THREE.Group(), FY = -0.58, eyes = {}, wings = [];
	(function build() {
		var cut = std(0x6f6a5c, { roughness: 0.55, metalness: 0.05, map: stripeTex('#8a867c', '#3a3731', 4, true) });
		var thorax = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 24), cut); thorax.scale.set(1, 0.85, 1.15); fly.add(thorax);
		var scut = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 16), std(0x5d5849, { roughness: 0.6 })); scut.position.set(0, 0.22, -0.38); fly.add(scut);
		var abd = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 24), std(0x8a7a5a, { roughness: 0.5, map: stripeTex('#a08a5c', '#33281a', 5, false) })); abd.scale.set(0.82, 0.66, 1.2); abd.position.set(0, -0.08, -0.82); abd.rotation.x = -0.12; fly.add(abd);
		var head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 28, 20), std(0x8c7d63, { roughness: 0.6 })); head.scale.set(1.2, 1, 0.75); head.position.set(0, 0.04, 0.58); fly.add(head);
		[-1, 1].forEach(function (s) {
			var em = new THREE.MeshStandardMaterial({ color: 0x8c0d16, roughness: 0.25, metalness: 0.2, emissive: 0x1a0103, flatShading: true });
			var e = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 3), em); e.scale.set(0.75, 1.1, 0.95); e.position.set(s * 0.29, 0.06, 0.6); fly.add(e);
			eyes[s > 0 ? 'left' : 'right'] = e;   // fly faces +z, so +x is the fly's own left
			fly.add(seg(new THREE.Vector3(s * 0.06, 0.08, 0.8), new THREE.Vector3(s * 0.1, 0.22, 0.92), 0.025, 0.02, std(0x4a3e2e)));
			fly.add(seg(new THREE.Vector3(s * 0.1, 0.22, 0.92), new THREE.Vector3(s * 0.18, 0.4, 0.98), 0.006, 0.004, std(0x111111)));
		});
		fly.add(seg(new THREE.Vector3(0, -0.15, 0.72), new THREE.Vector3(0, -0.38, 0.8), 0.05, 0.07, std(0x3c3326)));
		var bm = std(0x0b0b0b);
		for (var i = 0; i < 70; i++) { var th = rnd() * Math.PI * 0.9, ph = rnd() * Math.PI * 2; var n = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)); if (n.y < 0.1) continue;
			var p = n.clone().multiply(new THREE.Vector3(0.42, 0.36, 0.48)); fly.add(seg(p, p.clone().add(n.clone().add(new THREE.Vector3(0, 0, -0.6)).normalize().multiplyScalar(0.06 + rnd() * 0.06)), 0.0035, 0.0015, bm)); }
		var ws = new THREE.Shape(); ws.moveTo(0, 0); ws.bezierCurveTo(0.35, -0.1, 0.42, -1.3, 0.08, -1.7); ws.bezierCurveTo(-0.15, -1.5, -0.2, -0.6, 0, 0);
		var wg = new THREE.ShapeGeometry(ws, 24), uv = wg.attributes.uv, pa = wg.attributes.position;
		for (var k = 0; k < uv.count; k++) uv.setXY(k, (pa.getX(k) + 0.25) / 0.7, (pa.getY(k) + 1.75) / 1.8);
		var wm = new THREE.MeshStandardMaterial({ map: wingTex(), transparent: true, side: THREE.DoubleSide, roughness: 0.15, depthWrite: false });
		[-1, 1].forEach(function (s) { var wgp = new THREE.Group(); wgp.position.set(s * 0.14, 0.36, -0.2); var wmesh = new THREE.Mesh(wg, wm); wmesh.rotation.set(Math.PI / 2 - 0.12, 0, -s * 0.32); wmesh.scale.set(s, 1, 1); wgp.add(wmesh); fly.add(wgp); wings.push({ g: wgp, s: s }); });
		var lm = std(0x2b2620, { roughness: 0.6 }), joint = new THREE.SphereGeometry(0.03, 10, 8);
		function leg(parent, s, z, knee, foot) {
			var a = new THREE.Vector3(s * 0.28, -0.22, z), kk = new THREE.Vector3(knee[0], knee[1], knee[2]), t = new THREE.Vector3(foot[0], foot[1], foot[2]);
			var mid = t.clone().lerp(kk, 0.35).add(new THREE.Vector3(0, -0.05, 0));
			parent.add(seg(a, kk, 0.038, 0.03, lm)); parent.add(seg(kk, mid, 0.026, 0.02, lm)); parent.add(seg(mid, t, 0.018, 0.012, lm));
			[kk, mid].forEach(function (pp) { var j = new THREE.Mesh(joint, lm); j.position.copy(pp); parent.add(j); });
		}
		leg(fly, -1, 0.25, [-0.45, 0.02, 0.45], [-0.52, FY, 0.75]);
		// the clicking foreleg pivots at its hip
		fly.userData.arm = new THREE.Group(); fly.userData.arm.position.set(0.28, -0.22, 0.25); fly.add(fly.userData.arm);
		var armInner = new THREE.Group(); armInner.position.set(-0.28, 0.22, -0.25); fly.userData.arm.add(armInner);
		leg(armInner, 1, 0.25, [0.42, 0.12, 0.6], [0.45, FY + 0.11, 1.02]);
		leg(fly, -1, -0.05, [-0.55, 0.05, 0], [-0.7, FY, -0.05]); leg(fly, 1, -0.05, [0.55, 0.05, 0], [0.7, FY, -0.05]);
		leg(fly, -1, -0.3, [-0.5, 0.02, -0.45], [-0.62, FY, -0.8]); leg(fly, 1, -0.3, [0.5, 0.02, -0.45], [0.62, FY, -0.8]);
		var mouse = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), std(0x1d1c33, { roughness: 0.3, metalness: 0.3 })); mouse.scale.set(0.75, 0.4, 1.1); mouse.position.set(0.45, FY + 0.02, 1.04); fly.add(mouse);
		var pad = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.01, 0.9), std(0x101024)); pad.position.set(0.45, FY - 0.06, 1.02); fly.add(pad);
		var ringM = new THREE.MeshBasicMaterial({ color: 0x2fd47c, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
		var ring = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.17, 40), ringM); ring.rotation.x = -Math.PI / 2; ring.position.set(0.45, FY + 0.11, 1.04); fly.add(ring);
		fly.userData.ring = ring;
	})();
	fly.scale.setScalar(1.05); fly.position.set(-0.4, DT + 0.62, 0.45); fly.lookAt(1.9, DT + 0.62, -1.0); fly.rotateY(-0.15); scene.add(fly);

	/* ---------- brain hologram from real FlyWire positions ---------- */
	var role = meta.role, M = meta.subsetSize, pu = b64ToU16(meta.positionsU16);
	var cx = 0, cy = 0, cz = 0, lx = 0, rx = 0, nl = 0, nr = 0;
	for (var a = 0; a < M; a++) { cx += pu[a * 3]; cy += pu[a * 3 + 1]; cz += pu[a * 3 + 2]; if (role[a] === 1) { lx += pu[a * 3]; nl++; } if (role[a] === 2) { rx += pu[a * 3]; nr++; } }
	cx /= M; cy /= M; cz /= M;
	var mirror = (lx / nl) > (rx / nr) ? -1 : 1;   // put the fly's left eye on the viewer's left
	var SC = 2.4 / 65535;
	function cloud(filter, size) {
		var idx = []; for (var a = 0; a < M; a++) if (filter(role[a])) idx.push(a);
		var pos = new Float32Array(idx.length * 3), col = new Float32Array(idx.length * 3);
		idx.forEach(function (a, i) { pos[i * 3] = mirror * (pu[a * 3] - cx) * SC; pos[i * 3 + 1] = -(pu[a * 3 + 1] - cy) * SC; pos[i * 3 + 2] = (pu[a * 3 + 2] - cz) * SC; });
		var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
		var pts = new THREE.Points(g, new THREE.PointsMaterial({ size: size, vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
		return { pts: pts, idx: idx, col: col };
	}
	var clouds = [cloud(function (r) { return r < 3; }, 0.026), cloud(function (r) { return r >= 3; }, 0.055)];
	var where = new Int32Array(M * 2);   // subset index -> (cloud, position)
	clouds.forEach(function (c, ci) { c.idx.forEach(function (a, i) { where[a * 2] = ci; where[a * 2 + 1] = i; }); });
	var glow = new Float32Array(M);
	var BASE = { 0: [0.16, 0.2, 0.34], 1: [0.18, 0.28, 0.52], 2: [0.18, 0.28, 0.52], 3: [0.42, 0.14, 0.2], 4: [0.42, 0.14, 0.2], 5: [0.42, 0.14, 0.2] };
	var HOT = { 0: [0.85, 0.85, 1], 1: [0.5, 0.75, 1], 2: [0.5, 0.75, 1], 3: [1, 0.4, 0.45], 4: [1, 0.4, 0.45], 5: [1, 0.4, 0.45] };
	var holo = new THREE.Group(); clouds.forEach(function (c) { holo.add(c.pts); });
	var hring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.19, 64), new THREE.MeshBasicMaterial({ color: 0x28e0e0, transparent: true, opacity: 0.45, side: THREE.DoubleSide })); hring.rotation.x = -Math.PI / 2; hring.position.y = -0.8; holo.add(hring);
	function sprite(text, color, w) { var c = document.createElement('canvas'); c.width = 512; c.height = 64; var g = c.getContext('2d'); g.font = '600 30px "IBM Plex Sans KR", sans-serif'; g.fillStyle = color; g.textAlign = 'center'; g.fillText(text, 256, 42); var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })); s.scale.set(w, w / 8, 1); return s; }
	var sL = sprite('왼쪽 눈', COL.neuron, 1.3); sL.position.set(-1.25, 0.65, 0); holo.add(sL);
	var sR = sprite('오른쪽 눈', COL.neuron, 1.3); sR.position.set(1.25, 0.65, 0); holo.add(sR);
	var sD = sprite('하행 뉴런 (뇌 → 몸)', COL.down, 1.8); sD.position.set(0, -0.62, 0.4); holo.add(sD);
	holo.position.set(-1.9, 3.55, 0.1); holo.rotation.y = 0.25; scene.add(holo);
	function paintBrain() {
		clouds.forEach(function (c) {
			for (var i = 0; i < c.idx.length; i++) { var a = c.idx[i], r = role[a], g = glow[a], b = BASE[r], h = HOT[r];
				c.col[i * 3] = b[0] + (h[0] - b[0]) * g; c.col[i * 3 + 1] = b[1] + (h[1] - b[1]) * g; c.col[i * 3 + 2] = b[2] + (h[2] - b[2]) * g; }
			c.pts.geometry.attributes.color.needsUpdate = true;
		});
	}
	paintBrain();

	// stimulus beam from the screen to one eye
	var beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
	var beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: 0x7fb0ff, transparent: true, opacity: 0 })); scene.add(beam);
	function aimBeam(eye) { var a = screen.position.clone().add(new THREE.Vector3(-0.6, -0.2, 0.05)), b = new THREE.Vector3(); eyes[eye].getWorldPosition(b); beamGeo.attributes.position.setXYZ(0, a.x, a.y, a.z); beamGeo.attributes.position.setXYZ(1, b.x, b.y, b.z); beamGeo.attributes.position.needsUpdate = true; }

	/* ---------- monitor drawing (real candles and the fly's real orders) ---------- */
	var DEC_CANDLE = P.map(function (_, k) { return 4 * (k + 1); });   // decision k closes minute 60(k+1) -> 15-min candle 4(k+1)
	function drawMonitor(st) {
		var g = mcv.getContext('2d'), shown = C.slice(0, st.candle + 1), last = shown[shown.length - 1];
		g.fillStyle = '#0a0e18'; g.fillRect(0, 0, MW, MH);
		g.fillStyle = '#0f1524'; g.fillRect(0, 0, MW, 64);
		g.fillStyle = COL.amber; g.font = 'bold 30px sans-serif'; g.fillText('◆ FLYX', 24, 43);
		g.fillStyle = COL.ink; g.font = 'bold 28px sans-serif'; g.fillText('BTC-USD', 170, 43);
		var chg = last[4] / C[0][1] - 1; g.fillStyle = chg >= 0 ? COL.up : COL.down; g.font = 'bold 30px monospace'; g.fillText('$' + last[4].toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 330, 44);
		var hi = Math.max.apply(null, shown.map(function (c) { return c[2]; })), lo = Math.min.apply(null, shown.map(function (c) { return c[3]; }));
		var vol = shown.reduce(function (s, c) { return s + c[5]; }, 0);
		[['변동', pct(chg)], ['고가', hi.toFixed(0)], ['저가', lo.toFixed(0)], ['거래량', vol.toFixed(1) + ' BTC'], ['시각 (UTC)', hhmm(last[0] + 900)]].forEach(function (t, i) { g.font = '20px sans-serif'; g.fillStyle = '#6f7a92'; g.fillText(t[0], 640 + i * 180, 28); g.fillStyle = i === 0 ? (chg >= 0 ? COL.up : COL.down) : '#d6dbe6'; g.fillText(t[1], 640 + i * 180, 52); });
		g.font = '18px sans-serif'; ['1m', '5m', '15m', '1h'].forEach(function (t, i) { g.fillStyle = t === '15m' ? COL.amber : '#6f7a92'; g.fillText(t, 28 + i * 52, 96); });
		var X0 = 24, X1 = 1090, Y0 = 112, Y1 = 600, VY0 = 618, VY1 = 720;
		var pmin = Math.min.apply(null, C.map(function (c) { return c[3]; })) - 120, pmax = Math.max.apply(null, C.map(function (c) { return c[2]; })) + 120;
		var py = function (v) { return Y0 + (pmax - v) / (pmax - pmin) * (Y1 - Y0); };
		var N = C.length, cw = (X1 - X0) / N, px = function (i) { return X0 + i * cw + cw / 2; };
		g.strokeStyle = '#161e30'; g.lineWidth = 1; g.font = '16px monospace';
		for (var v = Math.ceil(pmin / 500) * 500; v <= pmax; v += 500) { var yy = py(v); g.beginPath(); g.moveTo(X0, yy); g.lineTo(X1, yy); g.stroke(); g.fillStyle = '#5d6880'; g.fillText(v.toLocaleString('en-US'), X1 + 6, yy + 5); }
		for (var ii = 0; ii < N; ii += 16) { g.beginPath(); g.moveTo(px(ii), Y0); g.lineTo(px(ii), VY1); g.stroke(); g.fillStyle = '#5d6880'; g.fillText(hhmm(C[ii][0]).slice(6), px(ii) - 22, VY1 + 22); }
		var vmax = Math.max.apply(null, C.map(function (c) { return c[5]; }));
		shown.forEach(function (c, i) { var col = c[4] >= c[1] ? COL.up : COL.down; g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.5;
			g.beginPath(); g.moveTo(px(i), py(c[2])); g.lineTo(px(i), py(c[3])); g.stroke();
			var t = py(Math.max(c[1], c[4])), b = py(Math.min(c[1], c[4])); g.fillRect(px(i) - cw * 0.36, t, cw * 0.72, Math.max(1.5, b - t));
			g.globalAlpha = 0.45; var vh = c[5] / vmax * (VY1 - VY0); g.fillRect(px(i) - cw * 0.36, VY1 - vh, cw * 0.72, vh); g.globalAlpha = 1; });
		g.strokeStyle = COL.amber; g.lineWidth = 2; g.beginPath();
		shown.forEach(function (c, i) { if (i < 19) return; var m = 0; for (var j = i - 19; j <= i; j++) m += shown[j][4]; m /= 20; if (i === 19) g.moveTo(px(i), py(m)); else g.lineTo(px(i), py(m)); }); g.stroke();
		g.fillStyle = COL.amber; g.font = '16px sans-serif'; g.fillText('MA20', X0 + 6, Y0 + 18);
		var lc = chg >= 0 ? COL.up : COL.down; g.setLineDash([6, 6]); g.strokeStyle = lc; g.beginPath(); g.moveTo(X0, py(last[4])); g.lineTo(X1, py(last[4])); g.stroke(); g.setLineDash([]);
		g.fillStyle = lc; g.fillRect(X1 + 2, py(last[4]) - 14, 96, 28); g.fillStyle = '#04120a'; g.font = 'bold 17px monospace'; g.fillText(last[4].toFixed(0), X1 + 10, py(last[4]) + 6);
		// the fly's executed orders so far
		for (var k = 0; k < st.decided; k++) { var done = st.wallet[k].done; if (done === 'hold') continue; var cc = C[DEC_CANDLE[k]] || last, x = px(DEC_CANDLE[k]);
			var y = done === 'buy' ? py(cc[3]) + 22 : py(cc[2]) - 22; g.fillStyle = done === 'buy' ? COL.up : COL.down; g.beginPath(); g.arc(x, y, 14, 0, 7); g.fill();
			g.fillStyle = '#071008'; g.font = 'bold 16px sans-serif'; g.fillText(done === 'buy' ? 'B' : 'S', x - 6, y + 6);
			if (k === st.decided - 1 && st.phase === 'act') { g.strokeStyle = g.fillStyle = done === 'buy' ? COL.up : COL.down; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 22, 0, 7); g.stroke(); } }
		g.fillStyle = '#8b95aa'; g.font = '16px sans-serif'; g.fillText('B/S = 초파리 뇌가 낸 주문', X0 + 80, Y0 + 18);
		// right column: the fly's order log and the order ticket
		var OX = 1180; g.fillStyle = '#0f1524'; g.fillRect(OX - 10, 72, MW - OX + 10, MH - 72);
		g.fillStyle = '#8b95aa'; g.font = '18px sans-serif'; g.fillText('초파리 주문 기록', OX + 6, 102);
		var logs = []; for (var k2 = 0; k2 < st.decided; k2++) if (st.wallet[k2].done !== 'hold') logs.push(k2);
		logs.slice(-9).reverse().forEach(function (k3, r) { var w = st.wallet[k3], yy2 = 140 + r * 34; g.fillStyle = w.done === 'buy' ? COL.up : COL.down; g.font = 'bold 19px sans-serif'; g.fillText(w.done === 'buy' ? '매수' : '매도', OX + 6, yy2);
			g.fillStyle = '#c7cdd9'; g.font = '18px monospace'; g.fillText(hhmm(P[k3].t).slice(6) + '  $' + P[k3].price.toFixed(0), OX + 70, yy2); });
		if (!logs.length) { g.fillStyle = '#5d6880'; g.font = '17px sans-serif'; g.fillText('아직 주문 없음', OX + 6, 140); }
		var TY = 470, act = st.phase === 'act' ? st.cur.executed : null;
		g.fillStyle = '#0a0e18'; g.fillRect(OX, TY, MW - OX - 20, 40); g.fillStyle = '#c7cdd9'; g.font = '19px sans-serif'; g.fillText('주문 금액  $10.00  (수수료 0.6%)', OX + 12, TY + 27);
		[['buy', 'BTC 매수', COL.up, TY + 56], ['sell', 'BTC 매도', COL.down, TY + 132]].forEach(function (bt) {
			var on = act === bt[0]; if (on) { g.shadowColor = bt[2]; g.shadowBlur = 30; }
			g.fillStyle = on ? bt[2] : '#16203a'; g.fillRect(OX, bt[3], MW - OX - 20, 62); g.shadowBlur = 0;
			g.fillStyle = on ? '#04120a' : bt[2]; g.font = 'bold 28px sans-serif'; g.fillText(bt[1], OX + 120, bt[3] + 41);
			if (on) { var cxp = OX + 310, cyp = bt[3] + 40; g.fillStyle = '#fff'; g.beginPath(); g.moveTo(cxp, cyp); g.lineTo(cxp, cyp + 30); g.lineTo(cxp + 8, cyp + 23); g.lineTo(cxp + 15, cyp + 36); g.lineTo(cxp + 20, cyp + 33); g.lineTo(cxp + 13, cyp + 21); g.lineTo(cxp + 23, cyp + 21); g.closePath(); g.fill(); }
		});
		if (st.phase === 'act' && st.cur.executed === 'hold') { g.fillStyle = '#c7cdd9'; g.font = 'bold 24px sans-serif'; g.fillText(st.cur.note, OX + 10, TY + 236); }
		var w0 = st.decided ? st.wallet[st.decided - 1] : { cash: R.capital, btc: 0 }, valNow = w0.cash + w0.btc * last[4];
		g.fillStyle = '#8b95aa'; g.font = '18px sans-serif'; g.fillText('지갑  현금 $' + w0.cash.toFixed(2) + '  ·  BTC ' + w0.btc.toFixed(6) + '  ·  평가액 $' + valNow.toFixed(2), 24, MH - 24);
		mtex.needsUpdate = true;
	}

	/* ---------- replay state machine ---------- */
	var st = null, playing = false, speed = 1, spikes = null;
	var repSel = $('rep');
	meta.reps.forEach(function (r) { var o = document.createElement('option'); o.value = r.rep; o.textContent = REP_LABEL[r.rep] + ' (' + money(r.equity.final) + ')'; repSel.appendChild(o); });
	var dnL = [], dnR = []; for (var z = 0; z < M; z++) { if (role[z] === 3) dnL.push(z); if (role[z] === 4) dnR.push(z); }
	var isL = new Uint8Array(M), isR = new Uint8Array(M); dnL.forEach(function (a) { isL[a] = 1; }); dnR.forEach(function (a) { isR[a] = 1; });
	var rctx = $('raster').getContext('2d');

	function reset(rep) {
		var info = meta.reps.filter(function (r) { return r.rep === rep; })[0];
		st = { rep: rep, info: info, wallet: walletPath(info.decisions.map(function (d) { return d.action; })), candle: 0, decided: 0, phase: 'walk', t: 0, tick: 0, cur: null, done: false };
		glow.fill(0); paintBrain(); setVerdict('—', '하행 뉴런 좌우 발화로 결정', COL.ink);
		$('decTitle').textContent = '첫 결정까지 시세를 따라갑니다'; $('ret').textContent = '—'; $('stim').textContent = '—'; $('dval').textContent = '—';
		setDN(0, 0); clearRaster(); updatePnl(); drawMonitor(st);
		return loadSpikes(rep).then(function (s) { spikes = s; });
	}
	function setVerdict(t, note, color) { $('verdict').textContent = t; $('verdict').style.color = color; $('verdictNote').textContent = note; }
	function setDN(l, r) { var m = Math.max(60, l, r); $('cntL').textContent = l; $('cntR').textContent = r; $('barL').style.width = (100 * l / m) + '%'; $('barR').style.width = (100 * r / m) + '%'; }
	function clearRaster() { rctx.fillStyle = '#0a1020'; rctx.fillRect(0, 0, 740, 112); rctx.strokeStyle = '#26304a'; rctx.beginPath(); rctx.moveTo(0, 56); rctx.lineTo(740, 56); rctx.stroke(); }
	function rasterTick(t, l, r) { var x = t * 14.6 + 3; rctx.fillStyle = COL.up; rctx.fillRect(x, 56 - Math.min(52, l * 4), 10, Math.min(52, l * 4)); rctx.fillStyle = COL.down; rctx.fillRect(x, 57, 10, Math.min(52, r * 4)); }
	function updatePnl() {
		var k = st.decided - 1, fin = st.done;
		var f = fin ? st.info.equity.final : (k >= 0 ? st.info.equity.path[k] : 0);
		var ru = fin ? meta.rule.final : (k >= 0 ? meta.rule.path[k] : 0);
		var ra = fin ? meta.random.finalMean : (k >= 0 ? meta.random.meanPath[k] : 0);
		[['flyPnl', f], ['rulePnl', ru], ['randPnl', ra]].forEach(function (x) { var el = $(x[0]); el.textContent = money(x[1]); el.className = 'n ' + (x[1] > 0.004 ? 'pos' : (x[1] < -0.004 ? 'neg' : '')); });
		var w = k >= 0 ? st.wallet[k] : { orders: 0, fees: 0 }, rw = k >= 0 ? ruleW[k] : { orders: 0, fees: 0 };
		$('flyMeta').textContent = '주문 ' + w.orders + ' · 수수료 $' + w.fees.toFixed(2);
		$('ruleMeta').textContent = '주문 ' + rw.orders + ' · 수수료 $' + rw.fees.toFixed(2);
		if (fin) {
			var rd = meta.random;
			$('final').innerHTML = '끝. 초파리는 규칙 투자자보다 <b>' + money(st.info.equity.final - meta.rule.final).replace('+', '') + '</b> 나았고, 그 차이는 수수료 차이(<b>$' + (meta.rule.fees - st.info.equity.fees).toFixed(2) + '</b>)와 비슷합니다. 무작위 투자자 1만 명의 가운데 90%는 ' + money(rd.p05) + ' ~ ' + money(rd.p95) + ', $1 이상 번 사람은 ' + (rd.shareGe1 * 100).toFixed(1) + '%였습니다.';
		} else $('final').textContent = '결정 ' + Math.max(0, st.decided) + ' / ' + P.length + ' · 손익은 그 시각 시세로 평가';
	}

	var WALK = 0.42, STIM = 0.8, TICK = 0.045, ACT = 1.1;
	function beginDecision(k) {
		var d = st.info.decisions[k], w = st.wallet[k];
		var note = '';
		if (d.action === 'sell' && w.done === 'hold') note = '매도 신호 · 팔 BTC가 없어 주문 안 됨';
		else if (d.action === 'buy' && w.done === 'hold') note = '매수 신호 · 주문 한도로 주문 안 됨';
		else if (d.action === 'hold') note = '좌우 차이가 작아 보유';
		st.cur = { k: k, d: d, executed: w.done, note: note, l: 0, r: 0 };
		st.phase = 'stim'; st.t = 0; st.tick = 0;
		$('decTitle').textContent = '결정 ' + (k + 1) + ' / ' + P.length + ' · ' + hhmm(P[k].t) + ' UTC';
		$('ret').textContent = pct(d.ret); $('ret').style.color = d.ret >= 0 ? COL.up : COL.down;
		$('stim').textContent = d.intensity > 0 ? (d.eye === 'left' ? '왼쪽 눈 ' : '오른쪽 눈 ') + d.intensity.toFixed(2) : '자극 없음';
		$('dval').textContent = '…'; setDN(0, 0); clearRaster(); setVerdict('뇌 계산 중', '50틱 동안 하행 뉴런 발화를 셉니다', COL.neuron);
		if (d.intensity > 0) { aimBeam(d.eye); beam.material.opacity = 0.9; }
	}
	function playTick() {
		var ticks = spikes[st.cur.k], t = st.tick, f = ticks[t], l = 0, r = 0;
		for (var i = 0; i < f.length; i++) { var a = f[i]; glow[a] = 1; if (isL[a]) l++; else if (isR[a]) r++; }
		st.cur.l += l; st.cur.r += r; setDN(st.cur.l, st.cur.r); rasterTick(t, l, r);
	}
	function finishDecision() {
		var d = st.cur.d;
		if (st.cur.l !== d.spikesL || st.cur.r !== d.spikesR) console.warn('replay count mismatch at decision', st.cur.k);
		$('dval').textContent = (d.d >= 0 ? '+' : '−') + Math.abs(d.d).toFixed(2);
		var ex = st.cur.executed, label = { buy: '매수 $10', sell: '매도 $10', hold: '보유' }[ex];
		var color = ex === 'buy' ? COL.up : (ex === 'sell' ? COL.down : COL.ink);
		setVerdict(label, st.cur.note || ('왼 ' + d.spikesL + ' : 오 ' + d.spikesR), color);
		st.decided = st.cur.k + 1; st.phase = 'act'; st.t = 0; beam.material.opacity = 0;
		var ring = fly.userData.ring; ring.material.color.set(ex === 'sell' ? 0xff5a6e : 0x2fd47c); ring.material.opacity = ex === 'hold' ? 0 : 1; ring.scale.setScalar(1);
		updatePnl(); drawMonitor(st);
	}
	function step(dt) {
		if (!st || !spikes || st.done) return;
		st.t += dt * speed;
		if (st.phase === 'walk') {
			if (st.t < WALK) return; st.t = 0;
			var nextK = st.decided;
			if (nextK < P.length && st.candle >= DEC_CANDLE[nextK]) { beginDecision(nextK); return; }
			if (st.candle < C.length - 1) { st.candle++; drawMonitor(st); }
			else { st.done = true; playing = false; $('play').textContent = '▶ 다시 보기'; updatePnl(); setVerdict('거래 종료', '마지막 시세로 평가', COL.amber); }
		} else if (st.phase === 'stim') {
			beam.material.opacity = 0.5 + 0.4 * Math.sin(st.t * 18);
			if (st.t >= STIM) { st.phase = 'ticks'; st.t = 0; }
		} else if (st.phase === 'ticks') {
			while (st.t >= TICK && st.tick < 50) { st.t -= TICK; playTick(); st.tick++; }
			if (st.tick >= 50) finishDecision();
		} else if (st.phase === 'act') {
			if (st.t >= ACT) { st.phase = 'walk'; st.t = 0; drawMonitor(st); }
		}
	}

	/* ---------- animation ---------- */
	var arm = fly.userData.arm, clock = new THREE.Clock(), elapsed = 0;
	function resize() { var w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
	window.addEventListener('resize', resize);
	function frame() {
		var dt = Math.min(0.1, clock.getDelta()); elapsed += dt;
		if (playing) step(dt);
		for (var i = 0; i < M; i++) if (glow[i] > 0.01) glow[i] *= 0.86; else glow[i] = 0;
		paintBrain();
		if (!reduceMotion) {
			wings.forEach(function (w) { w.g.rotation.z = w.s * 0.03 * Math.sin(elapsed * 2.1); });
			holo.rotation.y = 0.25 + 0.08 * Math.sin(elapsed * 0.3);
		}
		var press = st && st.phase === 'act' && st.cur.executed !== 'hold' ? Math.sin(Math.min(1, st.t / 0.35) * Math.PI) : 0;
		arm.rotation.x = 0.35 * press;
		var ring = fly.userData.ring; if (ring.material.opacity > 0) { ring.scale.multiplyScalar(1 + dt * 1.6); ring.material.opacity = Math.max(0, ring.material.opacity - dt * 0.9); }
		controls.update(); renderer.render(scene, camera);
		requestAnimationFrame(frame);
	}

	$('play').addEventListener('click', function () {
		if (st.done) { reset(st.rep).then(function () { playing = true; $('play').textContent = '❚❚ 일시정지'; }); return; }
		playing = !playing; $('play').textContent = playing ? '❚❚ 일시정지' : '▶ 재생';
	});
	$('speed').addEventListener('change', function (e) { speed = +e.target.value; });
	repSel.addEventListener('change', function (e) { playing = false; $('play').textContent = '▶ 재생'; reset(+e.target.value); });
	$('restart').addEventListener('click', function () { playing = false; $('play').textContent = '▶ 재생'; reset(st.rep); });
	$('infoBtn').addEventListener('click', function () { var box = $('info'); box.hidden = !box.hidden; $('infoBtn').setAttribute('aria-expanded', String(!box.hidden)); });
	$('infoClose').addEventListener('click', function () { $('info').hidden = true; $('infoBtn').setAttribute('aria-expanded', 'false'); });

	resize();
	reset(meta.reps[0].rep).then(function () {
		$('loading').hidden = true;
		// open on a realistic working state: fast-forward to just before the 5th decision
		while (!(st.phase === 'walk' && st.decided >= 12 && st.candle >= DEC_CANDLE[12] - 1)) step(0.5);
		drawMonitor(st); updatePnl();
		frame();
	});
	// final check: page wallet replay must match the exporter's numbers
	meta.reps.forEach(function (r) { var w = walletPath(r.decisions.map(function (d) { return d.action; })); var v = w[w.length - 1]; var fin = v.cash + v.btc * meta.finalPrice - R.capital; if (Math.abs(fin - r.equity.final) > 1e-6) console.warn('wallet mismatch rep', r.rep); });
}
})();
