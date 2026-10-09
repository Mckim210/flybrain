/* neuron-map.js -- live neuron position map
 *
 * Draws every neuron of the FlyWire FAFB v783 connectome as a point at its
 * recorded position (data/neuron_positions.bin) and lights up the neurons the
 * LIF worker reports as fired on each tick (BRAIN.latestFireState).
 *
 * The worker stores neurons in group-sorted order, so the bridge exposes
 * BRAIN.workerOrder (sorted_pos -> original index = row in neurons.csv.gz),
 * which is also the row order of neuron_positions.bin.
 *
 * neuron_positions.bin layout: N x 3 uint16 (x, y, z normalised to the
 * largest axis span), then N x uint8 super_class code (see CLASSES).
 */
(function () {
	'use strict';

	var CLASSES = [
		{ key: 'optic', label: 'Optic lobe', color: '#4f86ff' },
		{ key: 'central', label: 'Central brain', color: '#b98cff' },
		{ key: 'sensory', label: 'Sensory', color: '#3fd7a0' },
		{ key: 'visual_projection', label: 'Visual projection', color: '#36cfe6' },
		{ key: 'ascending', label: 'Ascending', color: '#f6b93b' },
		{ key: 'descending', label: 'Descending', color: '#ff5d6c' },
		{ key: 'sensory_ascending', label: 'Sensory ascending', color: '#a6e34a' },
		{ key: 'visual_centrifugal', label: 'Visual centrifugal', color: '#8f9bff' },
		{ key: 'motor', label: 'Motor', color: '#ff8fb3' },
		{ key: 'endocrine', label: 'Endocrine', color: '#ffd6f0' }
	];
	// Axis spans after normalisation (x is the widest axis), from build step
	var EXTENT = [1.0, 0.4813, 0.3423];
	var GLOW_DECAY = 0.78;

	var state = {
		open: false, built: false, loading: false,
		renderer: null, scene: null, camera: null, controls: null,
		points: null, glow: null, glowAttr: null, n: 0,
		el: null, canvas: null, status: null, hideOptic: false, raf: 0
	};

	function injectStyle() {
		var css = '' +
			'#neuronmap{position:fixed;right:12px;top:calc(52px + env(safe-area-inset-top,0px));' +
			'width:min(560px,calc(100vw - 24px));height:min(520px,calc(100vh - 80px));z-index:40;' +
			'display:flex;flex-direction:column;background:#070a12;border:1px solid #1c2438;' +
			'border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.45);color:#e6e9f2;' +
			'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:hidden}' +
			'#neuronmap[hidden]{display:none}' +
			'#neuronmap .nm-head{display:flex;align-items:center;gap:10px;padding:8px 10px 8px 14px;border-bottom:1px solid #1c2438}' +
			'#neuronmap .nm-title{font-weight:600;letter-spacing:.04em}' +
			'#neuronmap .nm-status{color:#8a93ab;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
			'#neuronmap button{background:#141b2e;border:1px solid #1c2438;color:#e6e9f2;border-radius:6px;padding:4px 8px;font:inherit;cursor:pointer}' +
			'#neuronmap button[aria-pressed="true"]{border-color:#7aa2ff}' +
			'#neuronmap .nm-stage{position:relative;flex:1;min-height:0}' +
			'#neuronmap canvas{display:block;width:100%;height:100%}' +
			'#neuronmap .nm-foot{display:flex;flex-wrap:wrap;gap:4px 12px;padding:8px 14px;border-top:1px solid #1c2438;color:#8a93ab}' +
			'#neuronmap .nm-key{display:inline-flex;align-items:center;gap:5px}' +
			'#neuronmap .nm-key i{width:8px;height:8px;border-radius:50%;display:inline-block}';
		var s = document.createElement('style');
		s.textContent = css;
		document.head.appendChild(s);
	}

	function buildPanel() {
		injectStyle();
		var el = document.createElement('div');
		el.id = 'neuronmap';
		el.hidden = true;
		el.innerHTML =
			'<div class="nm-head">' +
				'<span class="nm-title">Neuron Map</span>' +
				'<span class="nm-status" id="nmStatus">loading positions\u2026</span>' +
				'<button type="button" id="nmOptic" aria-pressed="false">Hide optic</button>' +
				'<button type="button" id="nmClose" aria-label="Close neuron map">&times;</button>' +
			'</div>' +
			'<div class="nm-stage"><canvas id="nmCanvas"></canvas></div>' +
			'<div class="nm-foot" id="nmFoot"></div>';
		document.body.appendChild(el);
		var foot = el.querySelector('#nmFoot');
		var keys = ['optic', 'central', 'sensory', 'visual_projection', 'descending', 'ascending'];
		CLASSES.forEach(function (c) {
			if (keys.indexOf(c.key) < 0) return;
			var k = document.createElement('span');
			k.className = 'nm-key';
			k.innerHTML = '<i style="background:' + c.color + '"></i>' + c.label;
			foot.appendChild(k);
		});
		var hint = document.createElement('span');
		hint.textContent = 'bright = fired just now \u00b7 drag to rotate';
		foot.appendChild(hint);
		state.el = el;
		state.canvas = el.querySelector('#nmCanvas');
		state.status = el.querySelector('#nmStatus');
		el.querySelector('#nmClose').addEventListener('click', function () { setOpen(false); });
		el.querySelector('#nmOptic').addEventListener('click', function (e) {
			state.hideOptic = !state.hideOptic;
			e.currentTarget.setAttribute('aria-pressed', String(state.hideOptic));
			if (state.points) state.points.material.uniforms.hideOptic.value = state.hideOptic ? 1 : 0;
		});
	}

	function buildScene(buf) {
		var bytes = new Uint8Array(buf);
		var n = Math.floor(bytes.length / 7);
		var q = new Uint16Array(buf, 0, n * 3);
		var cls = bytes.subarray(n * 6, n * 7);
		var pos = new Float32Array(n * 3);
		var cf = new Float32Array(n);
		for (var i = 0; i < n; i++) {
			// FlyWire axes: x left->right, y top->bottom, z front->back
			pos[i * 3] = q[i * 3] / 65535 - EXTENT[0] / 2;
			pos[i * 3 + 1] = -(q[i * 3 + 1] / 65535 - EXTENT[1] / 2);
			pos[i * 3 + 2] = -(q[i * 3 + 2] / 65535 - EXTENT[2] / 2);
			cf[i] = cls[i];
		}
		state.n = n;
		state.glow = new Float32Array(n);

		var geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		geo.setAttribute('cls', new THREE.BufferAttribute(cf, 1));
		state.glowAttr = new THREE.BufferAttribute(state.glow, 1);
		state.glowAttr.setUsage(THREE.DynamicDrawUsage);
		geo.setAttribute('glow', state.glowAttr);

		var renderer = new THREE.WebGLRenderer({ canvas: state.canvas, antialias: true });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		renderer.setClearColor(0x070a12, 1);

		var mat = new THREE.ShaderMaterial({
			uniforms: {
				colors: { value: CLASSES.map(function (c) { return new THREE.Color(c.color); }) },
				dpr: { value: renderer.getPixelRatio() },
				hideOptic: { value: 0 }
			},
			vertexShader: [
				'attribute float cls;',
				'attribute float glow;',
				'uniform vec3 colors[10];',
				'uniform float dpr;',
				'uniform float hideOptic;',
				'varying vec3 vColor;',
				'varying float vGlow;',
				'varying float vHide;',
				'void main() {',
				'  int k = int(cls + 0.5);',
				'  vColor = colors[0];',
				'  for (int j = 0; j < 10; j++) { if (j == k) vColor = colors[j]; }',
				'  vGlow = glow;',
				'  vHide = (k == 0 && hideOptic > 0.5) ? 1.0 : 0.0;',
				'  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
				'  gl_PointSize = (1.1 + glow * 1.4) * dpr * (2.4 / -mv.z);',
				'  gl_Position = projectionMatrix * mv;',
				'}'
			].join('\n'),
			fragmentShader: [
				'varying vec3 vColor;',
				'varying float vGlow;',
				'varying float vHide;',
				'void main() {',
				'  if (vHide > 0.5) discard;',
				'  vec2 d = gl_PointCoord - 0.5;',
				'  float r = dot(d, d);',
				'  if (r > 0.25) discard;',
				'  float fall = 1.0 - r * 3.2;',
				'  vec3 c = mix(vColor * 0.55, mix(vColor, vec3(1.0), 0.25), vGlow);',
				'  gl_FragColor = vec4(c, (0.10 + 0.32 * vGlow) * fall);',
				'}'
			].join('\n'),
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending
		});

		var scene = new THREE.Scene();
		var points = new THREE.Points(geo, mat);
		scene.add(points);
		var camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
		camera.position.set(0, 0, 1.9);
		var controls = THREE.OrbitControls ? new THREE.OrbitControls(camera, state.canvas) : null;
		if (controls) { controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 0.5; controls.maxDistance = 5; }

		state.renderer = renderer; state.scene = scene; state.camera = camera;
		state.controls = controls; state.points = points; state.built = true;
		resize();
		new ResizeObserver(resize).observe(state.canvas.parentNode);
	}

	function resize() {
		if (!state.renderer) return;
		var host = state.canvas.parentNode;
		var w = host.clientWidth, h = host.clientHeight;
		if (!w || !h) return;
		state.renderer.setSize(w, h, false);
		state.camera.aspect = w / h;
		state.camera.updateProjectionMatrix();
	}

	function updateGlow() {
		var glow = state.glow, n = state.n;
		for (var i = 0; i < n; i++) glow[i] *= GLOW_DECAY;
		var fired = window.BRAIN && BRAIN.latestFireState;
		var order = window.BRAIN && BRAIN.workerOrder;
		if (!fired || !order) {
			state.status.textContent = (window.BRAIN && BRAIN.workerReady)
				? 'simulation running (no neuron order \u2014 update sim-worker.js)'
				: 'waiting for the connectome simulation\u2026';
			return;
		}
		var count = 0, len = Math.min(fired.length, order.length);
		for (var s = 0; s < len; s++) {
			if (fired[s]) { var o = order[s]; if (o < n) glow[o] = 1; count++; }
		}
		var lit = 0;
		for (var j = 0; j < n; j++) if (glow[j] > 0.05) lit++;
		state.glowAttr.needsUpdate = true;
		state.status.textContent = n.toLocaleString() + ' neurons \u00b7 ' + lit.toLocaleString() + ' fired recently';
	}

	function loop() {
		if (!state.open) { state.raf = 0; return; }
		updateGlow();
		if (state.controls) state.controls.update();
		state.renderer.render(state.scene, state.camera);
		state.raf = requestAnimationFrame(loop);
	}

	function ensureLoaded() {
		if (state.built || state.loading) return;
		state.loading = true;
		fetch('data/neuron_positions.bin')
			.then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
			.then(function (buf) { buildScene(buf); state.loading = false; if (state.open && !state.raf) state.raf = requestAnimationFrame(loop); })
			.catch(function (err) {
				state.loading = false;
				state.status.textContent = 'could not load data/neuron_positions.bin (' + err.message + ')';
			});
	}

	function setOpen(open) {
		state.open = open;
		state.el.hidden = !open;
		var btn = document.getElementById('neuronMapBtn');
		if (btn) { btn.setAttribute('aria-pressed', String(open)); btn.classList.toggle('active', open); }
		if (open) {
			ensureLoaded();
			if (state.built) { resize(); if (!state.raf) state.raf = requestAnimationFrame(loop); }
		}
	}

	function init() {
		if (typeof THREE === 'undefined') return;
		buildPanel();
		var btn = document.getElementById('neuronMapBtn');
		if (btn) btn.addEventListener('click', function () { setOpen(!state.open); });
	}

	window.NeuronMap = { open: function () { setOpen(true); }, close: function () { setOpen(false); } };
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
	else init();
})();
