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
	controls.maxPolarAngle = Math.PI * 0.49;
	// gentler camera: slower rotate/pan and more damping so a drag does not fling the view (wheel zoom keeps the default speed)
	controls.rotateSpeed = 0.35; controls.panSpeed = 0.4; controls.dampingFactor = 0.12;
	controls.update();

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
	// the descending neurons' left/right imbalance is a turning command: the fly turns toward the side that fired more
	var flyBaseQ = fly.quaternion.clone(), turnQ = new THREE.Quaternion(), YAXIS = new THREE.Vector3(0, 1, 0), turn = 0, turnTarget = 0;

	/* ---------- brain hologram from real FlyWire positions ---------- */
	// every point is a real neuron at its FlyWire position; it lights up only on ticks where the recorded run fired it
	var role = meta.role, cls = meta.cls || [], M = meta.subsetSize, pu = b64ToU16(meta.positionsU16);
	var cx = 0, cy = 0, cz = 0, lx = 0, rx = 0, nl = 0, nr = 0;
	for (var a = 0; a < M; a++) { cx += pu[a * 3]; cy += pu[a * 3 + 1]; cz += pu[a * 3 + 2]; if (role[a] === 1) { lx += pu[a * 3]; nl++; } if (role[a] === 2) { rx += pu[a * 3]; nr++; } }
	cx /= M; cy /= M; cz /= M;
	var mirror = (lx / nl) > (rx / nr) ? -1 : 1;   // put the fly's left eye on the viewer's left
	var SC = 2.4 / 65535;
	// resting tint by brain region (FlyWire super_class), hot colour by what the neuron means for the decision
	var REGION = [[0.11, 0.16, 0.32], [0.2, 0.13, 0.32], [0.09, 0.24, 0.22], [0.09, 0.2, 0.3], [0.22, 0.2, 0.12], [0.3, 0.18, 0.2], [0.16, 0.24, 0.12], [0.14, 0.15, 0.3], [0.3, 0.16, 0.24], [0.3, 0.22, 0.28]];
	var ROLE_BASE = { 1: [0.16, 0.27, 0.52], 2: [0.16, 0.27, 0.52], 3: [0.08, 0.34, 0.2], 4: [0.38, 0.11, 0.15], 5: [0.3, 0.2, 0.2] };
	var ROLE_HOT = { 0: [0.92, 0.9, 1], 1: [0.55, 0.82, 1], 2: [0.55, 0.82, 1], 3: [0.32, 1, 0.58], 4: [1, 0.36, 0.43], 5: [1, 0.75, 0.6] };
	var pos = new Float32Array(M * 3), aBase = new Float32Array(M * 3), aHot = new Float32Array(M * 3), aSize = new Float32Array(M), glow = new Float32Array(M);
	for (var a2 = 0; a2 < M; a2++) {
		pos[a2 * 3] = mirror * (pu[a2 * 3] - cx) * SC; pos[a2 * 3 + 1] = -(pu[a2 * 3 + 1] - cy) * SC; pos[a2 * 3 + 2] = (pu[a2 * 3 + 2] - cz) * SC;
		var r0 = role[a2], b0 = ROLE_BASE[r0] || REGION[cls[a2]] || REGION[1], h0 = ROLE_HOT[r0];
		aBase.set(b0, a2 * 3); aHot.set(h0, a2 * 3); aSize[a2] = r0 >= 3 ? 2.3 : (r0 > 0 ? 1.15 : 1);
	}
	var bgeo = new THREE.BufferGeometry();
	bgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	bgeo.setAttribute('aBase', new THREE.BufferAttribute(aBase, 3));
	bgeo.setAttribute('aHot', new THREE.BufferAttribute(aHot, 3));
	bgeo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
	var glowAttr = new THREE.BufferAttribute(glow, 1); glowAttr.setUsage(THREE.DynamicDrawUsage); bgeo.setAttribute('aGlow', glowAttr);
	var bmat = new THREE.ShaderMaterial({
		uniforms: { uScale: { value: 14 }, uDim: { value: 1 } },
		vertexShader: 'attribute vec3 aBase; attribute vec3 aHot; attribute float aSize; attribute float aGlow; uniform float uScale; uniform float uDim; varying vec3 vCol; varying float vA;' +
			'void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float g = aGlow;' +
			' vCol = mix(aBase * uDim, aHot, g); vA = 0.5 + 0.5 * g; gl_PointSize = aSize * (1.0 + 2.4 * g) * uScale / max(0.5, -mv.z); }',
		fragmentShader: 'varying vec3 vCol; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard;' +
			' float core = smoothstep(0.5, 0.0, r); gl_FragColor = vec4(vCol * (0.55 + 0.9 * core), core * core * vA); }',
		transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
	});
	var brainPts = new THREE.Points(bgeo, bmat);
	var holo = new THREE.Group(); holo.add(brainPts);
	var hring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.19, 96), new THREE.MeshBasicMaterial({ color: 0x28e0e0, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })); hring.rotation.x = -Math.PI / 2; hring.position.y = -0.85; holo.add(hring);
	var hring2 = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.31, 96), new THREE.MeshBasicMaterial({ color: 0x28e0e0, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false })); hring2.rotation.x = -Math.PI / 2; hring2.position.y = -0.85; holo.add(hring2);
	function labelCanvas(lines, w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
	var labelRedraws = [];   // labels are redrawn once the web fonts have arrived
	function sprite(text, color, w, sub) {
		var c = labelCanvas(null, 512, 96), tex = new THREE.CanvasTexture(c);
		function draw() { var g = c.getContext('2d'); g.clearRect(0, 0, 512, 96); g.textAlign = 'center';
			g.font = '600 30px "IBM Plex Sans KR", sans-serif'; g.fillStyle = color; g.fillText(text, 256, 38);
			if (sub) { g.font = '24px "IBM Plex Sans KR", sans-serif'; g.fillStyle = 'rgba(200,210,230,.75)'; g.fillText(sub, 256, 74); }
			tex.needsUpdate = true; }
		draw(); labelRedraws.push(draw);
		var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })); s.scale.set(w, w * 96 / 512, 1); return s;
	}
	function centroid(rr) { var v = new THREE.Vector3(), n = 0; for (var a = 0; a < M; a++) if (role[a] === rr) { v.x += pos[a * 3]; v.y += pos[a * 3 + 1]; v.z += pos[a * 3 + 2]; n++; } return n ? v.multiplyScalar(1 / n) : v; }
	var cEL = centroid(1), cER = centroid(2), cDL = centroid(3), cDR = centroid(4);
	var sEL = sprite('왼쪽 눈', COL.neuron, 1.2, '오르면 자극'); sEL.position.set(cEL.x, cEL.y + 0.55, cEL.z); holo.add(sEL);
	var sER = sprite('오른쪽 눈', COL.neuron, 1.2, '내리면 자극'); sER.position.set(cER.x, cER.y + 0.55, cER.z); holo.add(sER);
	var sDL = sprite('왼쪽 하행 뉴런', COL.up, 1.3, '더 많으면 매수'); sDL.position.set(cDL.x - 0.35, cDL.y - 0.5, cDL.z + 0.3); holo.add(sDL);
	var sDR = sprite('오른쪽 하행 뉴런', COL.down, 1.3, '더 많으면 매도'); sDR.position.set(cDR.x + 0.35, cDR.y - 0.5, cDR.z + 0.3); holo.add(sDR);
	// live readout above the brain
	var rc2 = labelCanvas(null, 1280, 72), rtex = new THREE.CanvasTexture(rc2);
	var readout = new THREE.Sprite(new THREE.SpriteMaterial({ map: rtex, transparent: true, depthWrite: false })); readout.scale.set(3.4, 3.4 * 72 / 1280, 1); readout.position.set(0, 1.05, 0); readout.visible = false; holo.add(readout);
	var lastReadout = ['', null]; function setReadout(text, color) { lastReadout = [text, color]; var g = rc2.getContext('2d'); g.clearRect(0, 0, 1280, 72); g.textAlign = 'center'; g.font = '500 30px "IBM Plex Mono", monospace'; g.fillStyle = color || '#8b94ab'; g.fillText(text, 640, 46, 1260); rtex.needsUpdate = true; }
	setReadout('뇌 · 뉴런 ' + M.toLocaleString() + '개 표시 (전체 ' + meta.nNeurons.toLocaleString() + '개)');
	holo.position.set(-1.9, 3.55, 0.1); holo.rotation.y = 0.25; scene.add(holo);
	function paintBrain() { glowAttr.needsUpdate = true; }
	paintBrain();

	// stimulus beam from the screen to one eye
	var beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
	var beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: 0x7fb0ff, transparent: true, opacity: 0 })); scene.add(beam);
	function aimBeam(eye) { var a = screen.position.clone().add(new THREE.Vector3(-0.6, -0.2, 0.05)), b = new THREE.Vector3(); eyes[eye].getWorldPosition(b); beamGeo.attributes.position.setXYZ(0, a.x, a.y, a.z); beamGeo.attributes.position.setXYZ(1, b.x, b.y, b.z); beamGeo.attributes.position.needsUpdate = true; }

	/* ---------- monitor drawing (real candles and the fly's real orders) ---------- */
	var DEC_CANDLE = P.map(function (_, k) { return 4 * (k + 1); });   // decision k closes minute 60(k+1) -> 15-min candle 4(k+1)
	// replay view model: 15-minute candles of the recorded window, axis fixed to the whole window
	function replayVM(st) {
		var marks = [], logs = [];
		for (var k = 0; k < st.decided; k++) { var done = st.wallet[k].done; if (done === 'hold') continue;
			marks.push({ i: DEC_CANDLE[k], done: done, latest: k === st.decided - 1 && st.phase === 'act' }); logs.push({ done: done, label: hhmm(P[k].t).slice(6), price: P[k].price }); }
		var w0 = st.decided ? st.wallet[st.decided - 1] : { cash: R.capital, btc: 0 };
		return { candles: C.slice(0, st.candle + 1), slots: C.length, range: C, marks: marks, logs: logs, interval: '15m', timeLabel: '시각 (UTC)',
			time: hhmm(C[st.candle][0] + 900), act: st.phase === 'act' ? st.cur.executed : null, note: st.phase === 'act' ? st.cur.note : '', wallet: w0, live: false, footer: '', axisLabel: function (c) { return hhmm(c[0]).slice(6); } };
	}
	function drawMonitor(st) { drawMonitorVM(replayVM(st)); }
	function drawMonitorVM(vm) {
		var g = mcv.getContext('2d'), shown = vm.candles, last = shown[shown.length - 1];
		g.fillStyle = '#0a0e18'; g.fillRect(0, 0, MW, MH);
		g.fillStyle = '#0f1524'; g.fillRect(0, 0, MW, 64);
		g.fillStyle = COL.amber; g.font = 'bold 30px sans-serif'; g.fillText('◆ FLYX', 24, 43);
		g.fillStyle = COL.ink; g.font = 'bold 28px sans-serif'; g.fillText('BTC-USD', 170, 43);
		if (!last) { g.fillStyle = '#8b95aa'; g.font = '26px sans-serif'; g.fillText(vm.footer || '시세를 기다리는 중', 24, 140); mtex.needsUpdate = true; return; }
		var chg = last[4] / shown[0][1] - 1; g.fillStyle = chg >= 0 ? COL.up : COL.down; g.font = 'bold 30px monospace'; g.fillText('$' + last[4].toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 330, 44);
		if (vm.live) { g.fillStyle = COL.down; g.beginPath(); g.arc(590, 34, 9, 0, 7); g.fill(); g.font = 'bold 20px sans-serif'; g.fillText('LIVE', 606, 41); }
		else { g.fillStyle = COL.amber; g.fillRect(560, 16, 120, 34); g.fillStyle = '#1a1205'; g.font = 'bold 18px sans-serif'; g.fillText('기록 재생', 578, 40); }
		var hi = Math.max.apply(null, shown.map(function (c) { return c[2]; })), lo = Math.min.apply(null, shown.map(function (c) { return c[3]; }));
		var vol = shown.reduce(function (s, c) { return s + (c[5] || 0); }, 0);
		[['변동', pct(chg)], ['고가', hi.toFixed(0)], ['저가', lo.toFixed(0)], ['거래량', vol > 0 ? vol.toFixed(1) + ' BTC' : '—'], [vm.timeLabel, vm.time]].forEach(function (t, i) { g.font = '20px sans-serif'; g.fillStyle = '#6f7a92'; g.fillText(t[0], 700 + i * 170, 28); g.fillStyle = i === 0 ? (chg >= 0 ? COL.up : COL.down) : '#d6dbe6'; g.fillText(t[1], 700 + i * 170, 52); });
		g.font = '18px sans-serif'; ['1m', '5m', '15m', '1h'].forEach(function (t, i) { g.fillStyle = t === vm.interval ? COL.amber : '#6f7a92'; g.fillText(t, 28 + i * 52, 96); });
		var X0 = 24, X1 = 1090, Y0 = 112, Y1 = 600, VY0 = 618, VY1 = 720;
		var pmin = Math.min.apply(null, vm.range.map(function (c) { return c[3]; })), pmax = Math.max.apply(null, vm.range.map(function (c) { return c[2]; }));
		var pad = Math.max(20, (pmax - pmin) * 0.08); pmin -= pad; pmax += pad;
		var py = function (v) { return Y0 + (pmax - v) / (pmax - pmin) * (Y1 - Y0); };
		var N = vm.slots, cw = (X1 - X0) / N, px = function (i) { return X0 + i * cw + cw / 2; };
		var stepV = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000].filter(function (s) { return (pmax - pmin) / s <= 9; })[0] || 5000;
		g.strokeStyle = '#161e30'; g.lineWidth = 1; g.font = '16px monospace';
		for (var v = Math.ceil(pmin / stepV) * stepV; v <= pmax; v += stepV) { var yy = py(v); g.beginPath(); g.moveTo(X0, yy); g.lineTo(X1, yy); g.stroke(); g.fillStyle = '#5d6880'; g.fillText(v.toLocaleString('en-US'), X1 + 6, yy + 5); }
		for (var ii = 0; ii < shown.length; ii += Math.max(1, Math.round(N / 7))) { g.beginPath(); g.moveTo(px(ii), Y0); g.lineTo(px(ii), VY1); g.stroke(); g.fillStyle = '#5d6880'; g.fillText(vm.axisLabel(shown[ii]), px(ii) - 22, VY1 + 22); }
		var vmax = Math.max.apply(null, vm.range.map(function (c) { return c[5] || 0; })) || 1;
		shown.forEach(function (c, i) { var col = c[4] >= c[1] ? COL.up : COL.down; g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.5;
			g.beginPath(); g.moveTo(px(i), py(c[2])); g.lineTo(px(i), py(c[3])); g.stroke();
			var t = py(Math.max(c[1], c[4])), b = py(Math.min(c[1], c[4])); g.fillRect(px(i) - cw * 0.36, t, cw * 0.72, Math.max(1.5, b - t));
			if (c[5]) { g.globalAlpha = 0.45; var vh = c[5] / vmax * (VY1 - VY0); g.fillRect(px(i) - cw * 0.36, VY1 - vh, cw * 0.72, vh); g.globalAlpha = 1; } });
		if (vol <= 0) { g.fillStyle = '#5d6880'; g.font = '16px sans-serif'; g.fillText('거래량: 이 시세 API는 거래량을 주지 않아요', X0 + 6, VY1 - 8); }
		g.strokeStyle = COL.amber; g.lineWidth = 2; g.beginPath();
		shown.forEach(function (c, i) { if (i < 19) return; var m = 0; for (var j = i - 19; j <= i; j++) m += shown[j][4]; m /= 20; if (i === 19) g.moveTo(px(i), py(m)); else g.lineTo(px(i), py(m)); }); g.stroke();
		g.fillStyle = COL.amber; g.font = '16px sans-serif'; g.fillText('MA20', X0 + 6, Y0 + 18);
		var lc = chg >= 0 ? COL.up : COL.down; g.setLineDash([6, 6]); g.strokeStyle = lc; g.beginPath(); g.moveTo(X0, py(last[4])); g.lineTo(X1, py(last[4])); g.stroke(); g.setLineDash([]);
		g.fillStyle = lc; g.fillRect(X1 + 2, py(last[4]) - 14, 96, 28); g.fillStyle = '#04120a'; g.font = 'bold 17px monospace'; g.fillText(last[4].toFixed(0), X1 + 10, py(last[4]) + 6);
		vm.marks.forEach(function (m) { if (m.i < 0 || m.i >= shown.length) return; var cc = shown[m.i], x = px(m.i);
			var y = m.done === 'buy' ? py(cc[3]) + 22 : py(cc[2]) - 22; g.fillStyle = m.done === 'buy' ? COL.up : COL.down; g.beginPath(); g.arc(x, y, 14, 0, 7); g.fill();
			g.fillStyle = '#071008'; g.font = 'bold 16px sans-serif'; g.fillText(m.done === 'buy' ? 'B' : 'S', x - 6, y + 6);
			if (m.latest) { g.strokeStyle = m.done === 'buy' ? COL.up : COL.down; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 22, 0, 7); g.stroke(); } });
		g.fillStyle = '#8b95aa'; g.font = '16px sans-serif'; g.fillText('B/S = 초파리 뇌가 낸 주문', X0 + 80, Y0 + 18);
		var OX = 1180; g.fillStyle = '#0f1524'; g.fillRect(OX - 10, 72, MW - OX + 10, MH - 72);
		g.fillStyle = '#8b95aa'; g.font = '18px sans-serif'; g.fillText('초파리 주문 기록', OX + 6, 102);
		vm.logs.slice(-9).reverse().forEach(function (lg, r) { var yy2 = 140 + r * 34; g.fillStyle = lg.done === 'buy' ? COL.up : COL.down; g.font = 'bold 19px sans-serif'; g.fillText(lg.done === 'buy' ? '매수' : '매도', OX + 6, yy2);
			g.fillStyle = '#c7cdd9'; g.font = '18px monospace'; g.fillText(lg.label + '  $' + lg.price.toFixed(0), OX + 70, yy2); });
		if (!vm.logs.length) { g.fillStyle = '#5d6880'; g.font = '17px sans-serif'; g.fillText('아직 주문 없음', OX + 6, 140); }
		var TY = 470, act = vm.act;
		g.fillStyle = '#0a0e18'; g.fillRect(OX, TY, MW - OX - 20, 40); g.fillStyle = '#c7cdd9'; g.font = '19px sans-serif'; g.fillText('주문 금액  $10.00  (수수료 0.6%)', OX + 12, TY + 27);
		[['buy', 'BTC 매수', COL.up, TY + 56], ['sell', 'BTC 매도', COL.down, TY + 132]].forEach(function (bt) {
			var on = act === bt[0]; if (on) { g.shadowColor = bt[2]; g.shadowBlur = 30; }
			g.fillStyle = on ? bt[2] : '#16203a'; g.fillRect(OX, bt[3], MW - OX - 20, 62); g.shadowBlur = 0;
			g.fillStyle = on ? '#04120a' : bt[2]; g.font = 'bold 28px sans-serif'; g.fillText(bt[1], OX + 120, bt[3] + 41);
			if (on) { var cxp = OX + 310, cyp = bt[3] + 40; g.fillStyle = '#fff'; g.beginPath(); g.moveTo(cxp, cyp); g.lineTo(cxp, cyp + 30); g.lineTo(cxp + 8, cyp + 23); g.lineTo(cxp + 15, cyp + 36); g.lineTo(cxp + 20, cyp + 33); g.lineTo(cxp + 13, cyp + 21); g.lineTo(cxp + 23, cyp + 21); g.closePath(); g.fill(); }
		});
		if (act === 'hold' && vm.note) { g.fillStyle = '#c7cdd9'; g.font = 'bold 22px sans-serif'; g.fillText(vm.note, OX + 10, TY + 236, MW - OX - 30); }
		var valNow = vm.wallet.cash + vm.wallet.btc * last[4];
		g.fillStyle = '#8b95aa'; g.font = '18px sans-serif'; g.fillText('지갑  현금 $' + vm.wallet.cash.toFixed(2) + '  ·  BTC ' + vm.wallet.btc.toFixed(6) + '  ·  평가액 $' + valNow.toFixed(2) + (vm.footer ? '   ·   ' + vm.footer : ''), 24, MH - 24, MW - 48);
		mtex.needsUpdate = true;
	}

	/* ---------- replay state machine ---------- */
	var st = null, playing = false, speed = 1, spikes = null, camTween = null, view = 'home';
	var HOME = { p: camera.position.clone(), t: controls.target.clone() };
	function flyTo(p1, t1) { camTween = { t: 0, p0: camera.position.clone(), p1: p1, t0: controls.target.clone(), t1: t1 }; }
	var repSel = $('rep');
	meta.reps.forEach(function (r) { var o = document.createElement('option'); o.value = r.rep; o.textContent = REP_LABEL[r.rep] + ' (' + money(r.equity.final) + ')'; repSel.appendChild(o); });
	var dnL = [], dnR = []; for (var z = 0; z < M; z++) { if (role[z] === 3) dnL.push(z); if (role[z] === 4) dnR.push(z); }
	var isL = new Uint8Array(M), isR = new Uint8Array(M); dnL.forEach(function (a) { isL[a] = 1; }); dnR.forEach(function (a) { isR[a] = 1; });
	var rctx = $('raster').getContext('2d');

	function reset(rep) {
		var info = meta.reps.filter(function (r) { return r.rep === rep; })[0];
		st = { rep: rep, info: info, wallet: walletPath(info.decisions.map(function (d) { return d.action; })), candle: 0, decided: 0, phase: 'walk', t: 0, tick: 0, cur: null, done: false };
		glow.fill(0); paintBrain(); setVerdict('—', '하행 뉴런 좌우 발화로 결정', COL.ink); setReadout('뇌 · 뉴런 ' + M.toLocaleString() + '개 표시 (전체 ' + meta.nNeurons.toLocaleString() + '개)');
		$('decTitle').textContent = '첫 결정까지 시세를 따라갑니다'; $('ret').textContent = '—'; $('stim').textContent = '—'; $('dval').textContent = '—';
		setDN(0, 0); clearRaster(); updatePnl(); drawMonitor(st);
		return loadSpikes(rep).then(function (s) { spikes = s; });
	}
	function setVerdict(t, note, color) { $('verdict').textContent = t; $('verdict').style.color = color; $('verdictNote').textContent = note; }
	function setDN(l, r) { var m = Math.max(60, l, r); $('cntL').textContent = l; $('cntR').textContent = r; $('barL').style.width = (100 * l / m) + '%'; $('barR').style.width = (100 * r / m) + '%'; }
	function clearRaster() { rctx.fillStyle = '#0a1020'; rctx.fillRect(0, 0, 740, 112); rctx.strokeStyle = '#26304a'; rctx.beginPath(); rctx.moveTo(0, 56); rctx.lineTo(740, 56); rctx.stroke(); }
	function rasterTick(t, l, r) { var x = t * 14.6 + 3; rctx.fillStyle = COL.up; rctx.fillRect(x, 56 - Math.min(52, l * 4), 10, Math.min(52, l * 4)); rctx.fillStyle = COL.down; rctx.fillRect(x, 57, 10, Math.min(52, r * 4)); }
	function updatePnl() {
		if (MODE !== 'replay') { if (LV) livePnl(); return; }
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
			var mt = meta.matched, mr = mt.perRep[st.rep];
			var mEl = $('matchPnl'); mEl.textContent = money(mr.expected); mEl.className = 'n ' + (mr.expected > 0.004 ? 'pos' : (mr.expected < -0.004 ? 'neg' : ''));
			$('matchMeta').textContent = '초파리처럼 주문 ' + mr.orders + '건만 한 무작위 투자자';
			$('final').innerHTML = '끝. 초파리는 규칙 투자자보다 <b>' + money(st.info.equity.final - meta.rule.final).replace('+', '') + '</b> 나았고, 그 차이는 대부분 수수료 차이(<b>$' + (meta.rule.fees - st.info.equity.fees).toFixed(2) + '</b>)입니다. ' +
				'주문 수가 같은 무작위 투자자와 비교하면 이 회차는 <b>' + money(mr.residual) + '</b>, ' + mt.runs + '번 돌린 전체 평균은 <b>' + money(mt.mean) + '</b>(95% 신뢰구간 ' + money(mt.lo) + ' ~ ' + money(mt.hi) + ')로 0과 구별되지 않습니다. 한 회차의 큰 이익은 운으로도 나옵니다.';
		} else { $('final').textContent = '결정 ' + Math.max(0, st.decided) + ' / ' + P.length + ' · 손익은 그 시각 시세로 평가'; $('matchPnl').textContent = '끝나면 표시'; $('matchPnl').className = 'n pending'; $('matchMeta').textContent = '초파리와 주문 수가 같은 무작위 투자자'; }
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
		setReadout(d.intensity > 0 ? (d.eye === 'left' ? '왼쪽' : '오른쪽') + ' 눈 자극 · 세기 ' + d.intensity.toFixed(2) : '자극 없음 · 잡음만', COL.neuron);
	}
	function playTick() {
		var ticks = spikes[st.cur.k], t = st.tick, f = ticks[t], l = 0, r = 0;
		for (var i = 0; i < f.length; i++) { var a = f[i]; glow[a] = 1; if (isL[a]) l++; else if (isR[a]) r++; }
		st.cur.l += l; st.cur.r += r; setDN(st.cur.l, st.cur.r); rasterTick(t, l, r);
		var tt = st.cur.d.tickTotals ? st.cur.d.tickTotals[t] : null; setReadout('틱 ' + (t + 1) + '/50' + (tt != null ? ' · 뇌 전체 발화 ' + tt.toLocaleString() : '') + ' · 하행 왼 ' + st.cur.l + ' : 오 ' + st.cur.r, '#e9ecf5');
	}
	function finishDecision() {
		var d = st.cur.d;
		if (st.cur.l !== d.spikesL || st.cur.r !== d.spikesR) console.warn('replay count mismatch at decision', st.cur.k);
		$('dval').textContent = (d.d >= 0 ? '+' : '−') + Math.abs(d.d).toFixed(2);
		var ex = st.cur.executed, label = { buy: '매수 $10', sell: '매도 $10', hold: '보유' }[ex];
		var color = ex === 'buy' ? COL.up : (ex === 'sell' ? COL.down : COL.ink);
		setVerdict(label, st.cur.note || ('왼 ' + d.spikesL + ' : 오 ' + d.spikesR), color);
		setReadout('하행 왼 ' + d.spikesL + ' : 오 ' + d.spikesR + ' · d = ' + (d.d >= 0 ? '+' : '−') + Math.abs(d.d).toFixed(2) + ' → ' + label, color);
		st.decided = st.cur.k + 1; st.phase = 'act'; st.t = 0; beam.material.opacity = 0;
		turnTarget = Math.max(-1, Math.min(1, d.d)) * (ex === 'hold' ? 0.25 : 0.65);   // + = toward the fly's left
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
			if (st.t >= ACT) { st.phase = 'walk'; st.t = 0; turnTarget = 0; drawMonitor(st); }
		}
	}

	/* ---------- live mode: real Coinbase price + the brain computed in this browser ---------- */
	// Only works when the page is opened from this computer (START.bat): the artifact page blocks other sites.
	var MODE = 'replay', LV = null;
	var LIVE_SET = { live60: { every: 60, fullScale: 0.01, label: '1시간마다 결정 (소논문 설정, 1% 움직이면 최대 자극)' },
		live1: { every: 1, fullScale: 0.001, label: '1분마다 결정 (데모, 0.1% 움직이면 최대 자극 · 소논문 설정 아님)' } };
	// ticker = last trade on the Coinbase exchange (updates every trade); v2 spot is cached and lagged up to ~20 s in a 2026-10-18 check
	var SPOT = 'https://api.exchange.coinbase.com/products/BTC-USD/ticker', SPOT_FALLBACK = 'https://api.coinbase.com/v2/prices/BTC-USD/spot', HIST = 'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60';
	var RANDOM_N = 1000;
	function canGoLive() { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname); }
	function nowMin() { return Math.floor(Date.now() / 60000); }
	function kst(tSec) { return new Date(tSec * 1000).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }); }
	function setNote(html) { $('note').innerHTML = html; }
	function emptyBook() { return { cash: R.capital, btc: 0, fees: 0, orders: 0, perDay: {} }; }
	function trade(b, a, price, tSec) {   // same order rules as experiments/lib/market.js
		var day = new Date(tSec * 1000).toISOString().slice(0, 10), reserve = R.capital * R.reserveRate, done = 'hold';
		if ((a === 'buy' || a === 'sell') && (b.perDay[day] || 0) < R.maxOrdersPerDay) {
			if (a === 'buy') { var usd = Math.min(R.orderUsd, (b.cash - reserve) / (1 + R.feeRate)); if (usd > 0.005) { b.cash -= usd * (1 + R.feeRate); b.fees += usd * R.feeRate; b.btc += usd / price; done = 'buy'; } }
			else { var u2 = Math.min(R.orderUsd, b.btc * price); if (u2 > 0.005) { b.btc -= u2 / price; if (b.btc < 1e-15) b.btc = 0; b.cash += u2 * (1 - R.feeRate); b.fees += u2 * R.feeRate; done = 'sell'; } }
			if (done !== 'hold') { b.perDay[day] = (b.perDay[day] || 0) + 1; b.orders++; }
		}
		return done;
	}
	function value(b, price) { return b.cash + b.btc * price - R.capital; }

	function liveStart(kind) {
		if (!canGoLive()) {
			setNote('<b>실시간 모드는 내 컴퓨터에서 열었을 때만 동작해요.</b> 이 페이지에서는 보안 규칙 때문에 거래소 시세와 뇌 데이터에 접속할 수 없습니다. 받은 압축 파일의 START.bat으로 열어 주세요.');
			$('mode').value = 'replay'; return;
		}
		playing = false; MODE = kind; document.body.classList.add('is-live');
		var cfg = LIVE_SET[kind];
		LV = { kind: kind, cfg: cfg, candles: {}, lastDecMin: null, decisions: [], fly: emptyBook(), rule: emptyBook(), rnd: [], phase: 'idle', t: 0, tick: 0, cur: null,
			worker: null, ready: false, lastFetch: 0, lastOk: null, err: null, started: Date.now() / 1000, pending: null };
		for (var i = 0; i < RANDOM_N; i++) LV.rnd.push(emptyBook());
		glow.fill(0); paintBrain(); setDN(0, 0); clearRaster();
		$('decTitle').textContent = '실시간 · ' + cfg.label; $('ret').textContent = '—'; $('stim').textContent = '—'; $('dval').textContent = '—';
		setVerdict('준비 중', '뇌 데이터와 시세를 불러옵니다', COL.neuron); setReadout('실시간 모드 준비 중', COL.neuron);
		$('play').textContent = '■ 실시간 정지'; $('retLabel').textContent = cfg.every === 1 ? '직전 1분' : '직전 1시간'; $('randMeta').textContent = '매수·매도·보유 1/3씩, ' + RANDOM_N.toLocaleString() + '명 (지금부터)';
		setNote('실시간 모드: 코인베이스 BTC-USD 현재가를 5초마다 받아 1분봉을 만들고, ' + cfg.label + '. 뇌는 이 컴퓨터에서 직접 계산합니다. 실제 돈은 쓰지 않는 모의 거래예요.');
		var w = new Worker('brain-worker.js'); LV.worker = w;
		w.onmessage = function (e) { var m = e.data; if (!LV || LV.worker !== w) return;
			if (m.type === 'progress') setReadout(m.stage, COL.neuron);
			else if (m.type === 'ready') { LV.ready = true; setReadout('뇌 준비 완료 · 다음 결정을 기다리는 중', COL.neuron); setVerdict('대기 중', '다음 결정 시각을 기다립니다', COL.ink); }
			else if (m.type === 'decision') liveGotDecision(m);
			else if (m.type === 'error') { LV.err = m.message; setVerdict('뇌 오류', m.message, COL.down); } };
		w.postMessage({ type: 'init' });
		fetch(HIST, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (rows) {
			rows.forEach(function (c) { LV.candles[Math.floor(c[0] / 60)] = [c[0], c[3], c[2], c[1], c[4], c[5]]; });   // [time, low, high, open, close, vol] -> [t,o,h,l,c,v]
			LV.histOk = true; liveDraw();
		}).catch(function () { LV.histOk = false; });
		livePoll(); liveDraw(); updatePnl();
	}
	function liveStop() {
		if (LV && LV.worker) LV.worker.terminate();
		LV = null; MODE = 'replay'; document.body.classList.remove('is-live'); $('mode').value = 'replay';
		setNote('드래그해서 돌려 보세요. 연결 강도는 실험용으로 20배 키운 설정이에요. 뇌의 점 하나하나가 실제 FlyWire 뉴런 위치이고, 기록된 시뮬레이션에서 발화한 틱에만 빛납니다.');
		$('play').textContent = '▶ 재생'; $('retLabel').textContent = '직전 1시간'; $('randMeta').textContent = '매수·매도·보유 1/3씩, 1만 명'; reset(st.rep);
	}
	function livePoll() {
		if (!LV) return; LV.lastFetch = Date.now();
		function get(u) { return fetch(u, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }
		get(SPOT).catch(function () { return get(SPOT_FALLBACK); }).then(function (j) {
			var p = parseFloat(j.price != null ? j.price : (j.data && j.data.amount)), m = nowMin(); if (!(p > 0)) throw new Error('가격 없음');
			var c = LV.candles[m]; if (!c) LV.candles[m] = [m * 60, p, p, p, p, 0]; else { c[2] = Math.max(c[2], p); c[3] = Math.min(c[3], p); c[4] = p; }
			LV.lastOk = Date.now(); LV.err = null; liveDraw(); livePnl();
		}).catch(function (e) { LV.err = '시세를 못 받았어요 (' + e.message + '). 인터넷 연결을 확인해 주세요.'; liveDraw(); });
	}
	function liveSeries(n) { var m = nowMin(), out = []; for (var k = m - n + 1; k <= m; k++) if (LV.candles[k]) out.push(LV.candles[k]); return out; }
	function liveDraw() {
		if (!LV) return;
		var shown = liveSeries(120), t0 = shown.length ? shown[0][0] : 0, slot = function (tSec) { return Math.round((tSec - t0) / 60); };
		var marks = [], logs = [];
		LV.decisions.forEach(function (d, k) { if (d.executed === 'hold') return; marks.push({ i: slot(d.minuteStart), done: d.executed, latest: k === LV.decisions.length - 1 && LV.phase === 'act' }); logs.push({ done: d.executed, label: kst(d.t), price: d.price }); });
		var status = LV.err ? LV.err : (LV.lastOk ? '현재가 ' + Math.round((Date.now() - LV.lastOk) / 1000) + '초 전 갱신 · 다음 결정 ' + liveCountdown() : '시세 연결 중…');
		drawMonitorVM({ candles: shown, slots: 120, range: shown.length ? shown : [[0, 0, 1, 0, 0, 0]], marks: marks, logs: logs, interval: '1m', timeLabel: '시각 (한국)',
			time: kst(Date.now() / 1000), act: LV.phase === 'act' && LV.cur ? LV.cur.executed : null, note: LV.cur ? LV.cur.note : '', wallet: LV.fly, live: true, footer: status,
			axisLabel: function (c) { return kst(c[0]); } });
	}
	function liveCountdown() { var every = LV.cfg.every, m = nowMin(), next = (Math.floor(m / every) + 1) * every, s = next * 60 - Date.now() / 1000; return Math.floor(s / 60) + '분 ' + String(Math.floor(s % 60)).padStart(2, '0') + '초 뒤'; }
	function liveMaybeDecide() {
		if (!LV || !LV.ready || LV.phase !== 'idle') return;
		var m = nowMin(), every = LV.cfg.every;
		if (m % every !== 0 || LV.lastDecMin === m) return;
		var a = LV.candles[m - 1], b = LV.candles[m - 1 - every];
		LV.lastDecMin = m;
		if (!a || !b) { setVerdict('결정 건너뜀', every === 60 ? '1시간 전 시세가 없어요 (과거 시세를 못 받았거나 켠 지 1시간이 안 됨)' : '1분 전 시세가 아직 없어요', COL.dim); return; }
		var ret = a[4] / b[4] - 1, inten = Math.min(1, Math.abs(ret) / LV.cfg.fullScale), eye = ret > 0 ? 'left' : (ret < 0 ? 'right' : null);
		var seed = (crypto.getRandomValues(new Uint32Array(1))[0]) >>> 0;
		LV.cur = { minuteStart: (m - 1) * 60, t: m * 60, price: a[4], ret: ret, intensity: eye ? inten : 0, eye: eye, seed: seed, l: 0, r: 0 };
		LV.phase = 'stim'; LV.t = 0;
		$('decTitle').textContent = '실시간 결정 ' + (LV.decisions.length + 1) + ' · ' + kst(m * 60) + ' (한국 시각)';
		$('ret').textContent = pct(ret); $('ret').style.color = ret >= 0 ? COL.up : COL.down;
		$('stim').textContent = eye && inten > 0 ? (eye === 'left' ? '왼쪽 눈 ' : '오른쪽 눈 ') + inten.toFixed(2) : '자극 없음';
		$('dval').textContent = '…'; setDN(0, 0); clearRaster(); setVerdict('뇌 계산 중', '이 컴퓨터에서 50틱을 계산합니다', COL.neuron);
		setReadout(eye ? (eye === 'left' ? '왼쪽' : '오른쪽') + ' 눈 자극 · 세기 ' + inten.toFixed(2) : '자극 없음 · 잡음만', COL.neuron);
		if (eye && inten > 0) { aimBeam(eye); beam.material.opacity = 0.9; }
		LV.worker.postMessage({ type: 'decide', id: LV.decisions.length, intensity: LV.cur.intensity, eye: eye, seed: seed });
	}
	function liveGotDecision(m) { if (!LV || !LV.cur) return; LV.cur.res = m; }
	function liveStep(dt) {
		if (!LV) return;
		if (Date.now() - LV.lastFetch > 5000) livePoll();
		LV.t += dt;
		if (LV.phase === 'idle') { if (LV.t > 1) { LV.t = 0; liveDraw(); } liveMaybeDecide(); }
		else if (LV.phase === 'stim') { beam.material.opacity = 0.5 + 0.4 * Math.sin(LV.t * 18); if (LV.t >= 0.8 && LV.cur.res) { LV.phase = 'ticks'; LV.t = 0; LV.tick = 0; } }
		else if (LV.phase === 'ticks') {
			while (LV.t >= 0.045 && LV.tick < 50) { LV.t -= 0.045; var f = LV.cur.res.ticks[LV.tick], l = 0, r = 0;
				for (var i = 0; i < f.length; i++) { var a = f[i]; glow[a] = 1; if (isL[a]) l++; else if (isR[a]) r++; }
				LV.cur.l += l; LV.cur.r += r; setDN(LV.cur.l, LV.cur.r); rasterTick(LV.tick, l, r);
				setReadout('틱 ' + (LV.tick + 1) + '/50 · 뇌 전체 발화 ' + LV.cur.res.tickTotals[LV.tick].toLocaleString() + ' · 하행 왼 ' + LV.cur.l + ' : 오 ' + LV.cur.r, '#e9ecf5'); LV.tick++; }
			if (LV.tick >= 50) liveFinish();
		} else if (LV.phase === 'act') { if (LV.t >= 1.1) { LV.phase = 'idle'; LV.t = 0; turnTarget = 0; liveDraw(); } }
	}
	function liveFinish() {
		var c = LV.cur, res = c.res, ex = trade(LV.fly, res.action, c.price, c.t);
		trade(LV.rule, c.ret > 0 ? 'buy' : (c.ret < 0 ? 'sell' : 'hold'), c.price, c.t);
		LV.rnd.forEach(function (b) { var u = Math.random(); trade(b, u < 1 / 3 ? 'buy' : (u < 2 / 3 ? 'sell' : 'hold'), c.price, c.t); });
		c.executed = ex; c.note = res.action === 'sell' && ex === 'hold' ? '매도 신호 · 팔 BTC가 없어 주문 안 됨' : (res.action === 'buy' && ex === 'hold' ? '매수 신호 · 주문 한도로 주문 안 됨' : (res.action === 'hold' ? '좌우 차이가 작아 보유' : ''));
		LV.decisions.push(c); LV.phase = 'act'; LV.t = 0; beam.material.opacity = 0;
		$('dval').textContent = (res.d >= 0 ? '+' : '−') + Math.abs(res.d).toFixed(2);
		var label = { buy: '매수 $10', sell: '매도 $10', hold: '보유' }[ex], color = ex === 'buy' ? COL.up : (ex === 'sell' ? COL.down : COL.ink);
		setVerdict(label, c.note || ('왼 ' + res.spikesL + ' : 오 ' + res.spikesR + ' · 계산 ' + res.ms + 'ms'), color);
		setReadout('하행 왼 ' + res.spikesL + ' : 오 ' + res.spikesR + ' · d = ' + (res.d >= 0 ? '+' : '−') + Math.abs(res.d).toFixed(2) + ' → ' + label, color);
		turnTarget = Math.max(-1, Math.min(1, res.d)) * (ex === 'hold' ? 0.25 : 0.65);
		var ring = fly.userData.ring; ring.material.color.set(ex === 'sell' ? 0xff5a6e : 0x2fd47c); ring.material.opacity = ex === 'hold' ? 0 : 1; ring.scale.setScalar(1);
		updatePnl(); liveDraw();
	}
	function livePnl() {
		var last = liveSeries(1)[0], price = last ? last[4] : null;
		function show(id, v) { var el = $(id); if (v == null) { el.textContent = '—'; el.className = 'n'; return; } el.textContent = money(v); el.className = 'n ' + (v > 0.004 ? 'pos' : (v < -0.004 ? 'neg' : '')); }
		if (!price) { ['flyPnl', 'rulePnl', 'randPnl', 'matchPnl'].forEach(function (id) { show(id, null); });
			$('flyMeta').textContent = '주문 0'; $('ruleMeta').textContent = '주문 0'; $('matchMeta').textContent = '초파리와 주문 수가 같은 무작위 투자자';
			$('final').textContent = '실시간 모드 · 코인베이스 현재가를 받는 중'; return; }
		show('flyPnl', value(LV.fly, price)); show('rulePnl', value(LV.rule, price));
		var sum = 0; LV.rnd.forEach(function (b) { sum += value(b, price); }); show('randPnl', sum / LV.rnd.length);
		var same = LV.rnd.filter(function (b) { return b.orders === LV.fly.orders; });
		if (same.length < 20) same = LV.rnd.filter(function (b) { return Math.abs(b.orders - LV.fly.orders) <= 1; });
		var ms = 0; same.forEach(function (b) { ms += value(b, price); }); show('matchPnl', same.length ? ms / same.length : null);
		$('flyMeta').textContent = '주문 ' + LV.fly.orders + ' · 수수료 $' + LV.fly.fees.toFixed(2);
		$('ruleMeta').textContent = '주문 ' + LV.rule.orders + ' · 수수료 $' + LV.rule.fees.toFixed(2);
		$('matchMeta').textContent = '주문 수가 같은 무작위 투자자 ' + same.length + '명 (전체 ' + RANDOM_N.toLocaleString() + '명 중)';
		$('final').textContent = '실시간 결정 ' + LV.decisions.length + '번 · ' + kst(LV.started) + '부터 · 손익은 지금 시세로 평가. 결정이 적을 때 숫자 차이는 대부분 운입니다.';
	}

	/* ---------- animation ---------- */
	var arm = fly.userData.arm, clock = new THREE.Clock(), elapsed = 0;
	function resize() { var w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); bmat.uniforms.uScale.value = 0.016 * h * renderer.getPixelRatio(); }
	window.addEventListener('resize', resize);
	function frame() {
		var dt = Math.min(0.1, clock.getDelta()); elapsed += dt;
		if (MODE === 'replay') { if (playing) step(dt); } else liveStep(dt);
		var decay = Math.pow(0.86, dt * 60); for (var i = 0; i < M; i++) if (glow[i] > 0.01) glow[i] *= decay; else glow[i] = 0;
		var S = MODE === 'replay' ? st : LV; var busy = S && S.phase === 'ticks' ? 1 : 0; bmat.uniforms.uDim.value += ((busy ? 1.35 : 1) - bmat.uniforms.uDim.value) * Math.min(1, dt * 4); hring.material.opacity = 0.35 + 0.3 * busy * (0.5 + 0.5 * Math.sin(elapsed * 10));
		var focused = view === 'brain', fogN = focused ? 5 : 16, fogF = focused ? 12 : 42; scene.fog.near += (fogN - scene.fog.near) * Math.min(1, dt * 3); scene.fog.far += (fogF - scene.fog.far) * Math.min(1, dt * 3);
		if (camTween) { camTween.t = Math.min(1, camTween.t + dt / 0.9); var e = camTween.t * camTween.t * (3 - 2 * camTween.t); camera.position.lerpVectors(camTween.p0, camTween.p1, e); controls.target.lerpVectors(camTween.t0, camTween.t1, e); if (camTween.t >= 1) camTween = null; }
		paintBrain();
		if (!reduceMotion) {
			wings.forEach(function (w) { w.g.rotation.z = w.s * 0.03 * Math.sin(elapsed * 2.1); });
			holo.rotation.y = 0.25 + 0.08 * Math.sin(elapsed * 0.3);
		}
		var press = S && S.phase === 'act' && S.cur && S.cur.executed !== 'hold' ? Math.sin(Math.min(1, S.t / 0.35) * Math.PI) : 0;
		arm.rotation.x = 0.35 * press;
		turn += (turnTarget - turn) * Math.min(1, dt * (reduceMotion ? 20 : 3)); fly.quaternion.copy(flyBaseQ).multiply(turnQ.setFromAxisAngle(YAXIS, turn));
		var ring = fly.userData.ring; if (ring.material.opacity > 0) { ring.scale.multiplyScalar(1 + dt * 1.6); ring.material.opacity = Math.max(0, ring.material.opacity - dt * 0.9); }
		controls.update(); renderer.render(scene, camera);
		requestAnimationFrame(frame);
	}

	$('play').addEventListener('click', function () {
		if (MODE !== 'replay') { liveStop(); return; }
		if (st.done) { reset(st.rep).then(function () { playing = true; $('play').textContent = '❚❚ 일시정지'; }); return; }
		playing = !playing; $('play').textContent = playing ? '❚❚ 일시정지' : '▶ 재생';
	});
	function setView(v) {
		view = v; readout.visible = v === 'brain';
		$('focus').setAttribute('aria-pressed', String(v === 'brain')); $('monitorBtn').setAttribute('aria-pressed', String(v === 'monitor'));
		$('focus').textContent = v === 'brain' ? '전체 보기' : '뇌 확대'; $('monitorBtn').textContent = v === 'monitor' ? '전체 보기' : '모니터 보기';
		if (v === 'brain') { var c = holo.position.clone(); flyTo(c.clone().add(new THREE.Vector3(0.7, 0.3, 4.4)), c.clone().add(new THREE.Vector3(0, 0.1, 0))); }
		else if (v === 'monitor') { var n = new THREE.Vector3(0, 0, 1).applyQuaternion(screen.quaternion); flyTo(screen.position.clone().add(n.multiplyScalar(3.1)).add(new THREE.Vector3(0, 0.45, 0)), screen.position.clone().add(new THREE.Vector3(0, 0.1, 0))); }
		else flyTo(HOME.p.clone(), HOME.t.clone());
	}
	$('focus').addEventListener('click', function () { setView(view === 'brain' ? 'home' : 'brain'); });
	$('monitorBtn').addEventListener('click', function () { setView(view === 'monitor' ? 'home' : 'monitor'); });
	if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { labelRedraws.forEach(function (f) { f(); }); if (lastReadout[0]) setReadout(lastReadout[0], lastReadout[1]); });
	$('mode').addEventListener('change', function (e) { var v = e.target.value; if (LV) { if (LV.worker) LV.worker.terminate(); LV = null; } if (v === 'replay') liveStop(); else liveStart(v); });
	$('speed').addEventListener('change', function (e) { speed = +e.target.value; });
	repSel.addEventListener('change', function (e) { playing = false; $('play').textContent = '▶ 재생'; reset(+e.target.value); });
	$('restart').addEventListener('click', function () { playing = false; $('play').textContent = '▶ 재생'; reset(st.rep); });
	$('infoBtn').addEventListener('click', function () { var box = $('info'); box.hidden = !box.hidden; $('infoBtn').setAttribute('aria-expanded', String(!box.hidden)); });
	$('infoClose').addEventListener('click', function () { $('info').hidden = true; $('infoBtn').setAttribute('aria-expanded', 'false'); });

	resize();
	reset(meta.reps[0].rep).then(function () {
		$('loading').hidden = true;
		// open on a realistic working state: fast-forward to just before the 13th decision
		while (!(st.phase === 'walk' && st.decided >= 12 && st.candle >= DEC_CANDLE[12] - 1)) step(0.5);
		drawMonitor(st); updatePnl();
		frame();
		// opened from this computer (START.bat): start straight in live mode so the chart is today's price
		if (canGoLive()) { $('mode').value = 'live1'; liveStart('live1'); }
	});
	// final check: page wallet replay must match the exporter's numbers
	meta.reps.forEach(function (r) { var w = walletPath(r.decisions.map(function (d) { return d.action; })); var v = w[w.length - 1]; var fin = v.cash + v.btc * meta.finalPrice - R.capital; if (Math.abs(fin - r.equity.final) > 1e-6) console.warn('wallet mismatch rep', r.rep); });
}
})();
