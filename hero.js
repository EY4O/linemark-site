// The Install block's scene: a small transit network in 3D, drawn with plain WebGL (no libraries, nothing fetched).
// It is decoration only: hidden from assistive tech, shown on wide screens, paused when it is off screen or the tab is
// in the background, and held as a still picture for people who prefer less motion.
(() => {
  const canvas = document.getElementById('scene');
  const sign = canvas?.closest('.sign, .terminus'); // the block the scene sits in
  const onBand = !!canvas?.closest('.terminus'); // on the signage band, trains and the ground take band colours
  if (!canvas) return;
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl) { canvas.remove(); return; }
  sign.classList.add('has-scene');
  const wide = matchMedia('(min-width: 1180px)');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const scheme = matchMedia('(prefers-color-scheme: dark)');

  // ---------- colours, read from the page's tokens so the scene follows light and dark ----------
  const token = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const rgb = (hex) => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

  // ---------- the network: metro polylines on the ground (x, z); two of them are branches ----------
  const LINES = [
    { c: '--brand', p: [[-34, 8], [-10, 8], [-2, 0], [16, 0], [26, -10], [38, -10]], trains: 2 },
    { c: '--cobalt', p: [[-6, -34], [-6, -8], [4, 2], [4, 30]], trains: 1 },
    { c: '--magenta', p: [[4, 10], [10, 16], [36, 16]], trains: 1 },
    { c: '--teal', p: [[-38, -20], [-14, -20], [-6, -12], [10, -12], [22, -24], [34, -24]], trains: 1 },
    { c: '--amber', p: [[12, -38], [12, -6], [24, 6], [40, 6]], trains: 1 },
    { c: '--green', p: [[-18, 8], [-18, 18], [-12, 24], [16, 24]], trains: 1 }, // leaves the trunk on its straight, so the two share one station
  ];
  const STEP = 0.35, HALF = 0.55, RISE = 0.32;

  // corners cut back and joined with a curve, then resampled evenly so trains run at a steady speed
  function route(pts, r = 3.2) {
    const raw = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const d1 = Math.hypot(b[0] - a[0], b[1] - a[1]), d2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
      const k1 = Math.min(r, d1 / 2) / d1, k2 = Math.min(r, d2 / 2) / d2;
      const p = [b[0] + (a[0] - b[0]) * k1, b[1] + (a[1] - b[1]) * k1], q = [b[0] + (c[0] - b[0]) * k2, b[1] + (c[1] - b[1]) * k2];
      for (let t = 0; t <= 1.0001; t += 0.125) raw.push([(1 - t) ** 2 * p[0] + 2 * (1 - t) * t * b[0] + t * t * q[0], (1 - t) ** 2 * p[1] + 2 * (1 - t) * t * b[1] + t * t * q[1]]);
    }
    raw.push(pts.at(-1));
    const out = [raw[0]];
    let since = 0;
    for (let i = 1; i < raw.length; i++) {
      const [x0, z0] = raw[i - 1], [x1, z1] = raw[i], L = Math.hypot(x1 - x0, z1 - z0);
      if (!L) continue;
      let t = STEP - since;
      for (; t <= L; t += STEP) out.push([x0 + (x1 - x0) * t / L, z0 + (z1 - z0) * t / L]);
      since = L - (t - STEP);
    }
    out.push(pts.at(-1));
    return out;
  }
  const paths = LINES.map((l) => route(l.p));

  // ---------- geometry ----------
  function mesh() {
    const P = [], N = [], C = [];
    const tri = (a, b, c, n, col) => { for (const v of [a, b, c]) { P.push(...v); N.push(...n); C.push(...col); } };
    const quad = (a, b, c, d, n, col) => { tri(a, b, c, n, col); tri(a, c, d, n, col); };
    const cyl = (x, z, r, y0, y1, side, top) => {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2, b = ((i + 1) / 24) * Math.PI * 2;
        const pa = [x + Math.cos(a) * r, z + Math.sin(a) * r], pb = [x + Math.cos(b) * r, z + Math.sin(b) * r];
        tri([x, y1, z], [pa[0], y1, pa[1]], [pb[0], y1, pb[1]], [0, 1, 0], top);
        const m = (a + b) / 2;
        quad([pa[0], y0, pa[1]], [pb[0], y0, pb[1]], [pb[0], y1, pb[1]], [pa[0], y1, pa[1]], [Math.cos(m), 0, Math.sin(m)], side);
      }
    };
    return { P, N, C, tri, quad, cyl };
  }
  function world(colors) {
    const m = mesh();
    paths.forEach((pts, li) => {
      const col = colors.lines[li];
      const side = col.map((v) => v * 0.78);
      const nrm = pts.map((_, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
        return [-dz / L, dx / L];
      });
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], n0 = nrm[i], n1 = nrm[i + 1];
        const l0 = [x0 + n0[0] * HALF, z0 + n0[1] * HALF], r0 = [x0 - n0[0] * HALF, z0 - n0[1] * HALF];
        const l1 = [x1 + n1[0] * HALF, z1 + n1[1] * HALF], r1 = [x1 - n1[0] * HALF, z1 - n1[1] * HALF];
        const y = RISE + li * 0.002; // a hair apart, so crossing lines never shimmer
        m.quad([l0[0], y, l0[1]], [l1[0], y, l1[1]], [r1[0], y, r1[1]], [r0[0], y, r0[1]], [0, 1, 0], col);
        m.quad([l0[0], 0, l0[1]], [l1[0], 0, l1[1]], [l1[0], y, l1[1]], [l0[0], y, l0[1]], [n0[0], 0, n0[1]], side);
        m.quad([r0[0], 0, r0[1]], [r1[0], 0, r1[1]], [r1[0], y, r1[1]], [r0[0], y, r0[1]], [-n0[0], 0, -n0[1]], side);
      }
    });
    // interchanges where two lines meet; ordinary stations every few units along each line
    const inter = [];
    paths.forEach((a, i) => paths.forEach((b, j) => {
      if (j <= i) return;
      for (const p of a) for (const q of b) {
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.4 && !inter.some((s) => Math.hypot(s[0] - p[0], s[1] - p[1]) < 3)) inter.push(p);
      }
    }));
    for (const [x, z] of inter) m.cyl(x, z, 1.45, 0, 0.62, colors.ring, colors.station);
    for (const pts of paths) {
      for (let i = 0; i < pts.length; i += 17) {
        const [x, z] = pts[i];
        if (inter.some((s) => Math.hypot(s[0] - x, s[1] - z) < 3)) continue;
        m.cyl(x, z, 0.9, 0, 0.55, colors.ring, colors.station);
      }
    }
    return m;
  }
  function dots(color) {
    const m = mesh();
    for (let x = -44; x <= 44; x += 2.2) for (let z = -44; z <= 44; z += 2.2) if (Math.hypot(x, z) < 46) { m.P.push(x, -0.02, z); m.N.push(0, 1, 0); m.C.push(...color); }
    return m;
  }
  function box() {
    const m = mesh(), w = [1.35, 0.42, 0.42], c = [1, 1, 1], y0 = RISE, y1 = RISE + 0.8;
    const v = (sx, sy, sz) => [sx * w[0], sy ? y1 : y0, sz * w[2]];
    m.quad(v(-1, 1, -1), v(1, 1, -1), v(1, 1, 1), v(-1, 1, 1), [0, 1, 0], c);
    m.quad(v(-1, 0, 1), v(1, 0, 1), v(1, 1, 1), v(-1, 1, 1), [0, 0, 1], c);
    m.quad(v(-1, 0, -1), v(1, 0, -1), v(1, 1, -1), v(-1, 1, -1), [0, 0, -1], c);
    m.quad(v(1, 0, -1), v(1, 0, 1), v(1, 1, 1), v(1, 1, -1), [1, 0, 0], c);
    m.quad(v(-1, 0, -1), v(-1, 0, 1), v(-1, 1, 1), v(-1, 1, -1), [-1, 0, 0], c);
    return m;
  }

  // ---------- GL plumbing ----------
  const VS = `attribute vec3 aP; attribute vec3 aN; attribute vec3 aC;
    uniform mat4 uVP; uniform mat4 uM; uniform float uPS;
    varying vec3 vN; varying vec3 vC; varying float vD;
    void main() { vec4 p = uVP * (uM * vec4(aP, 1.0)); vN = mat3(uM) * aN; vC = aC; vD = p.w; gl_Position = p; gl_PointSize = uPS / p.w; }`;
  const FS = `precision mediump float;
    varying vec3 vN; varying vec3 vC; varying float vD;
    uniform vec3 uL; uniform vec2 uFog; uniform vec4 uTint; uniform float uPt;
    void main() {
      if (uPt > 0.5) { vec2 q = gl_PointCoord - 0.5; if (dot(q, q) > 0.25) discard; }
      vec3 c = uTint.a > 0.0 ? uTint.rgb : vC;
      float l = uPt > 0.5 ? 1.0 : 0.68 + 0.32 * max(dot(normalize(vN), uL), 0.0);
      float a = 1.0 - smoothstep(uFog.x, uFog.y, vD);
      gl_FragColor = vec4(c * l * a, a);
    }`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); sign.classList.remove('has-scene'); return; }
  gl.useProgram(prog);
  const A = { P: gl.getAttribLocation(prog, 'aP'), N: gl.getAttribLocation(prog, 'aN'), C: gl.getAttribLocation(prog, 'aC') };
  const U = Object.fromEntries(['uVP', 'uM', 'uPS', 'uL', 'uFog', 'uTint', 'uPt'].map((n) => [n, gl.getUniformLocation(prog, n)]));
  function upload(m) {
    const buf = (arr) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW); return b; };
    return { P: buf(m.P), N: buf(m.N), C: buf(m.C), n: m.P.length / 3 };
  }
  function bind(o) {
    for (const k of ['P', 'N', 'C']) { gl.bindBuffer(gl.ARRAY_BUFFER, o[k]); gl.enableVertexAttribArray(A[k]); gl.vertexAttribPointer(A[k], 3, gl.FLOAT, false, 0, 0); }
  }
  const free = (o) => o && ['P', 'N', 'C'].forEach((k) => gl.deleteBuffer(o[k]));

  // ---------- matrices (column-major) ----------
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
  const persp = (fov, asp, n, f) => { const t = 1 / Math.tan(fov / 2), nf = 1 / (n - f); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]; };
  const look = (e, c) => { const z = unit(sub(e, c)), x = unit(cross([0, 1, 0], z)), y = cross(z, x); return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]; };
  // matrices are written into these, so a running frame allocates nothing for them
  const VP = new Float32Array(16), MODEL = new Float32Array(16);
  const mulInto = (o, a, b) => { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; };
  const ID = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  // ---------- scene state ----------
  let W = null, D = null, B = null, colors = null;
  function build() {
    colors = {
      lines: LINES.map((l) => rgb(token(l.c))),
      // stations as on a printed map in either theme: white tops with a signage-black rim
      station: rgb(token('--band-ink')),
      ring: rgb(token('--band')),
      dots: rgb(token(onBand ? '--band-rule' : '--rule-strong')),
      train: rgb(token(onBand ? '--band-ink' : '--ink')),
    };
    free(W); free(D); free(B);
    W = upload(world(colors)); D = upload(dots(colors.dots)); B = upload(box());
  }
  const trains = LINES.flatMap((l, li) => Array.from({ length: l.trains }, (_, k) => ({ li, phase: k / l.trains + li * 0.17 })));

  let size = [0, 0];
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (w && h && (w !== canvas.width || h !== canvas.height)) { canvas.width = w; canvas.height = h; }
    size = [canvas.width, canvas.height];
  }

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  sign.addEventListener('pointermove', (e) => {
    const r = sign.getBoundingClientRect();
    pointer.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    pointer.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
  });
  sign.addEventListener('pointerleave', () => { pointer.tx = 0; pointer.ty = 0; });

  function draw(t) {
    const [w, h] = size;
    if (!w || !h) return;
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const yaw = -0.62 + Math.sin(t * 0.06) * 0.16 + pointer.x * 0.1;
    const el = 0.9 + Math.sin(t * 0.045) * 0.05 - pointer.y * 0.05;
    const dist = 64;
    const target = [3 + Math.sin(t * 0.05) * 3, 0, -1 + Math.cos(t * 0.04) * 2];
    const eye = [target[0] + dist * Math.cos(el) * Math.sin(yaw), dist * Math.sin(el), target[2] + dist * Math.cos(el) * Math.cos(yaw)];
    gl.uniformMatrix4fv(U.uVP, false, mulInto(VP, persp(0.52, w / h, 1, 200), look(eye, target)));
    gl.uniform3fv(U.uL, unit([0.35, 1, 0.25]));
    gl.uniform2f(U.uFog, dist - 4, dist + 34);
    gl.uniformMatrix4fv(U.uM, false, ID);
    // the ground: a faint dot grid
    gl.uniform1f(U.uPt, 1); gl.uniform1f(U.uPS, 3.2 * (devicePixelRatio || 1) * 30); gl.uniform4f(U.uTint, 0, 0, 0, 0);
    bind(D); gl.drawArrays(gl.POINTS, 0, D.n);
    // tracks and stations
    gl.uniform1f(U.uPt, 0);
    bind(W); gl.drawArrays(gl.TRIANGLES, 0, W.n);
    // trains: each runs its line end to end and back, easing into the termini
    bind(B);
    gl.uniform4f(U.uTint, ...colors.train, 1);
    for (const tr of trains) {
      const pts = paths[tr.li], len = pts.length - 1;
      const cyc = (t * 3.2 / (len * STEP) + tr.phase) % 2;
      const u = cyc < 1 ? cyc : 2 - cyc;
      const s = (0.5 - Math.cos(u * Math.PI) / 2) * len;
      const i = Math.min(len - 1, Math.floor(s)), f = s - i;
      const a = pts[i], b = pts[i + 1];
      const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f;
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
      const c = dx / L, sn = -dz / L;
      MODEL.set([c, 0, -sn, 0, 0, 1, 0, 0, sn, 0, c, 0, x, 0, z, 1]);
      gl.uniformMatrix4fv(U.uM, false, MODEL);
      gl.drawArrays(gl.TRIANGLES, 0, B.n);
    }
  }

  // ---------- running: only while it can be seen ----------
  let visible = false, raf = 0, t0 = performance.now();
  const STILL_AT = 9; // the moment shown as a still picture
  const running = () => visible && !document.hidden && wide.matches && !still.matches;
  // the camera only drifts, so 30 frames a second is plenty, whatever the screen's refresh rate
  const FRAME_MS = 1000 / 30;
  let last = 0;
  function frame(now) {
    raf = 0;
    if (now - last >= FRAME_MS - 2) { last = now; draw((now - t0) / 1000); }
    if (running()) raf = requestAnimationFrame(frame);
  }
  function sync() {
    if (!wide.matches) return;
    resize();
    if (running()) { if (!raf) raf = requestAnimationFrame(frame); }
    else { cancelAnimationFrame(raf); raf = 0; if (still.matches) draw(STILL_AT); }
  }
  build();
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; sync(); }).observe(canvas);
  new ResizeObserver(() => { resize(); if (!running()) draw(still.matches ? STILL_AT : (performance.now() - t0) / 1000); }).observe(canvas);
  document.addEventListener('visibilitychange', sync);
  wide.addEventListener('change', sync);
  still.addEventListener('change', sync);
  scheme.addEventListener('change', () => { build(); sync(); if (!running()) draw(STILL_AT); });
  document.addEventListener('linemark:palette', () => { build(); if (!running()) draw(STILL_AT); }); // a city picked in the toy
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; });
})();
