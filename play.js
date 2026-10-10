// The sign's toy: a small metro to draw. Stations are link types, in the shapes the extension gives them; drag from
// station to station (or tap one, then another) to lay a line, and a train carries the links waiting on each platform
// to a station of their shape. A city picker recolours the whole page in that city's line colours.
// No libraries and nothing fetched; it pauses when it can't be seen, and for people who prefer less motion its trains
// step from stop to stop instead of gliding.
(() => {
  const host = document.getElementById('play');
  if (!host) return;
  const canvas = host.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const $n = document.getElementById('play-n');
  const $hint = host.querySelector('.play-hint');
  const $city = document.getElementById('play-city');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(pointer: coarse)');
  document.querySelector('.sign')?.classList.add('has-play');

  // ---------- city palettes: the page's twelve line colours, recast (the same sets as the extension) ----------
  const SLOTS = ['signal', 'magenta', 'violet', 'cobalt', 'sky', 'teal', 'green', 'olive', 'amber', 'clay', 'slate', 'rose'];
  const CITIES = {
    linemark: null,
    london: ['#dc241f', '#9b0056', '#6950a1', '#003688', '#0098d4', '#00a4a7', '#00782a', '#84b817', '#ffd300', '#af6105', '#7b868c', '#f3a9bb'],
    paris: ['#e3051c', '#cf009e', '#62259d', '#003ca6', '#6ec4e8', '#00a88f', '#007852', '#807702', '#ffcd00', '#704b1c', '#8b8b8b', '#fa9aba'],
    tokyo: ['#f62e36', '#b6007a', '#8f76d6', '#0079c2', '#009bbf', '#00ac9b', '#00bb85', '#6cbb5a', '#c1a470', '#9c5e31', '#9a9a92', '#e85298'],
    'new-york': ['#ef3d36', '#b933ad', '#6e3fa3', '#0039a6', '#00a1de', '#008287', '#089642', '#6cbe45', '#fccc0a', '#996633', '#808183', '#e86fa5'],
    berlin: ['#d3401d', '#c6007e', '#8568a2', '#224f86', '#528dba', '#00999a', '#16683d', '#7dad4c', '#f0d722', '#7e5330', '#888888', '#dd6ca7'],
    seoul: ['#d4003b', '#a0167e', '#9d72af', '#0052a4', '#00a5de', '#77c4a3', '#00a84d', '#717b00', '#f5a200', '#cd7c2f', '#a9a9a9', '#f29bb9'],
  };
  function setCity(id) {
    const set = CITIES[id];
    for (const [i, slot] of SLOTS.entries()) {
      if (set) document.documentElement.style.setProperty('--' + slot, set[i]);
      else document.documentElement.style.removeProperty('--' + slot);
    }
    try { localStorage.setItem('linemark-city', id); } catch {}
    document.dispatchEvent(new CustomEvent('linemark:palette', { detail: id }));
  }
  let saved = 'linemark';
  try { saved = localStorage.getItem('linemark-city') || 'linemark'; } catch {}
  if (!(saved in CITIES)) saved = 'linemark';
  $city.value = saved;
  if (saved !== 'linemark') setCity(saved);
  $city.addEventListener('change', () => setCity($city.value));

  // ---------- the map: stations as fractions of the field, so it fits any size ----------
  const SITES = [
    { x: 0.12, y: 0.2, s: 'circle' }, { x: 0.42, y: 0.1, s: 'square' }, { x: 0.56, y: 0.48, s: 'circle' },
    { x: 0.86, y: 0.62, s: 'pentagon' }, { x: 0.26, y: 0.62, s: 'triangle' }, { x: 0.62, y: 0.92, s: 'square' },
    { x: 0.08, y: 0.9, s: 'diamond' }, { x: 0.8, y: 0.16, s: 'triangle' }, { x: 0.36, y: 0.94, s: 'pentagon' },
    { x: 0.95, y: 0.92, s: 'circle' },
  ];
  const LINE_SLOTS = ['cobalt', 'signal', 'teal', 'amber', 'magenta', 'green'];
  const MAX_LINES = 4, CAP = 6, QUEUE = 10;
  const stations = [];
  let lines = [];
  let filed = 0, drew = false, nextLine = 0;
  const addStation = () => { if (stations.length < SITES.length) stations.push({ ...SITES[stations.length], q: [], born: performance.now() }); };
  for (let i = 0; i < 6; i++) addStation();

  // ---------- geometry ----------
  let W = 0, H = 0, dpr = 1, R = 10;
  const $hud = host.querySelector('.play-hud'), $bar = host.querySelector('.play-bar');
  // the stations' field: clear of the hint and score above and the buttons below, however those wrap
  const field = () => { const t = $hud.offsetTop + $hud.offsetHeight + 22, b = $bar.offsetHeight + 34; return { l: 28, t, w: W - 56, h: Math.max(60, H - t - b) }; };
  const at = (i) => { const f = field(), s = stations[i]; return { x: f.l + s.x * f.w, y: f.t + s.y * f.h }; };
  // metro routing: run straight, then take the rest on a 45° diagonal
  function leg(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, m = Math.min(Math.abs(dx), Math.abs(dy));
    const c = Math.abs(dx) > Math.abs(dy) ? { x: b.x - Math.sign(dx) * m, y: a.y } : { x: a.x, y: b.y - Math.sign(dy) * m };
    return [a, c, b];
  }
  function route(stops) {
    const pts = [at(stops[0])], marks = [0];
    let len = 0;
    for (let i = 1; i < stops.length; i++) {
      const [, c, b] = leg(at(stops[i - 1]), at(stops[i]));
      for (const p of [c, b]) { const q = pts.at(-1); len += Math.hypot(p.x - q.x, p.y - q.y); pts.push(p); }
      marks.push(len);
    }
    return { pts, marks, len };
  }
  function pointAt(r, d) {
    let acc = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], L = Math.hypot(b.x - a.x, b.y - a.y);
      if (acc + L >= d || i === r.pts.length - 1) { const t = L ? Math.min(1, Math.max(0, (d - acc) / L)) : 0; return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, a: Math.atan2(b.y - a.y, b.x - a.x) }; }
      acc += L;
    }
    return { ...r.pts[0], a: 0 };
  }

  // ---------- colours, from the page's tokens ----------
  let C = {};
  function readColors() {
    const root = getComputedStyle(document.documentElement), here = getComputedStyle(host);
    C = { paper: here.getPropertyValue('--paper').trim(), river: here.getPropertyValue('--river').trim(), ink: root.getPropertyValue('--ink').trim(), ink2: root.getPropertyValue('--ink-3').trim() };
    for (const l of lines) l.color = root.getPropertyValue('--' + l.slot).trim();
  }
  document.addEventListener('linemark:palette', () => { readColors(); paint(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); paint(); });

  // ---------- lines and trains ----------
  function addLine(stops, extend) {
    if (extend) { extend.stops = stops; extend.r = route(stops); extend.train.d = Math.min(extend.train.d, extend.r.len); return; }
    if (lines.length >= MAX_LINES) lines.shift();
    const slot = LINE_SLOTS[nextLine++ % LINE_SLOTS.length];
    const line = { slot, color: getComputedStyle(document.documentElement).getPropertyValue('--' + slot).trim(), stops, r: route(stops), train: { d: 0, dir: 1, target: 1, wait: 0.6, load: [] } };
    lines.push(line);
  }
  const served = (line) => new Set(line.stops.map((i) => stations[i].s));
  function arrive(line, k) {
    const st = stations[line.stops[k]], tr = line.train;
    const before = tr.load.length;
    tr.load = tr.load.filter((s) => s !== st.s);
    filed += before - tr.load.length;
    const want = served(line);
    want.delete(st.s);
    st.q = st.q.filter((s) => (tr.load.length < CAP && want.has(s) ? (tr.load.push(s), false) : true));
    tr.wait = still.matches ? 0.9 : 0.4;
    let next = k + tr.dir;
    if (next < 0 || next >= line.stops.length) { tr.dir = -tr.dir; next = k + tr.dir; }
    tr.target = next;
    $n.textContent = filed.toLocaleString();
  }
  function step(dt) {
    for (const line of lines) {
      const tr = line.train;
      if (tr.wait > 0) { tr.wait -= dt; continue; }
      const goal = line.r.marks[tr.target];
      if (still.matches) { tr.d = goal; arrive(line, tr.target); continue; } // no gliding: the train is simply at the next stop
      const move = Math.max(60, Math.min(W, H) * 0.32) * dt;
      if (Math.abs(goal - tr.d) <= move) { tr.d = goal; arrive(line, tr.target); }
      else tr.d += Math.sign(goal - tr.d) * move;
    }
  }
  let spawnT = 0, siteT = 0;
  function spawn(dt) {
    spawnT += dt; siteT += dt;
    if (siteT > 9) { siteT = 0; addStation(); }
    if (spawnT < 1.3) return;
    spawnT = 0;
    const shapes = [...new Set(stations.map((s) => s.s))];
    const st = stations[Math.floor(Math.random() * stations.length)];
    const others = shapes.filter((s) => s !== st.s);
    if (others.length && st.q.length < QUEUE) st.q.push(others[Math.floor(Math.random() * others.length)]);
  }

  // ---------- drawing ----------
  function shape(s, x, y, r) {
    ctx.beginPath();
    const poly = (n, rr, cy) => { for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; ctx[i ? 'lineTo' : 'moveTo'](x + rr * Math.cos(a), cy + rr * Math.sin(a)); } ctx.closePath(); };
    if (s === 'square') { const h = r * 0.86; ctx.rect(x - h, y - h, 2 * h, 2 * h); }
    else if (s === 'triangle') poly(3, r * 1.18, y + r * 0.2);
    else if (s === 'pentagon') poly(5, r * 1.06, y + r * 0.04);
    else if (s === 'diamond') poly(4, r * 1.2, y);
    else ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  function strokeRoute(pts, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); pts.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y)); ctx.stroke();
  }
  function cap(a, b, color, width) { // the terminus bar across a line's end
    const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2, l = width * 1.1;
    ctx.strokeStyle = color; ctx.lineWidth = width * 0.7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(b.x + Math.cos(ang) * l, b.y + Math.sin(ang) * l); ctx.lineTo(b.x - Math.cos(ang) * l, b.y - Math.sin(ang) * l); ctx.stroke();
  }
  let drag = null, picked = null, cursor = null;
  function paint() {
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // the river, corner to corner
    const f = field();
    ctx.strokeStyle = C.river; ctx.lineWidth = Math.max(18, Math.min(W, H) * 0.07); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-20, f.t + f.h * 0.34); ctx.bezierCurveTo(W * 0.3, f.t + f.h * 0.2, W * 0.55, f.t + f.h * 0.86, W + 20, f.t + f.h * 0.7); ctx.stroke();
    const lw = Math.max(6, R * 0.75);
    for (const line of lines) {
      strokeRoute(line.r.pts, line.color, lw);
      cap(line.r.pts[1], line.r.pts[0], line.color, lw);
      cap(line.r.pts.at(-2), line.r.pts.at(-1), line.color, lw);
    }
    if (drag && drag.stops.length) { // the line being laid
      const pts = route(drag.stops).pts;
      if (cursor) pts.push(cursor);
      ctx.globalAlpha = 0.6; strokeRoute(pts, drag.color, lw); ctx.globalAlpha = 1;
    }
    // trains: a carriage in the line's colour, its passengers aboard
    for (const line of lines) {
      const p = pointAt(line.r, line.train.d), cw = R * 2.6, ch = R * 1.35;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.fillStyle = line.color; ctx.strokeStyle = C.paper; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-cw / 2, -ch / 2, cw, ch, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.paper;
      line.train.load.forEach((s, i) => { shape(s, -cw / 2 + cw * (0.2 + (i % 3) * 0.3), (i < 3 ? -1 : 1) * ch * 0.22, R * 0.2); ctx.fill(); });
      ctx.restore();
    }
    // stations: the link's shape, paper-filled, outlined in ink; waiting passengers beside; a crowded one sweeps a ring
    const now = performance.now();
    stations.forEach((st, i) => {
      const p = at(i), grow = still.matches ? 1 : Math.min(1, (now - st.born) / 400);
      const r = R * grow;
      if (st.q.length > 6) {
        ctx.strokeStyle = C.ink2; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, (st.q.length - 6) / 4)); ctx.stroke();
      }
      shape(st.s, p.x, p.y, r);
      ctx.fillStyle = C.paper; ctx.fill();
      ctx.strokeStyle = picked === i ? (lines[0]?.color || C.ink) : C.ink; ctx.lineWidth = Math.max(2.5, R * 0.28); ctx.lineJoin = 'round'; ctx.stroke();
      ctx.fillStyle = C.ink2;
      st.q.forEach((s, k) => { shape(s, p.x + R * 1.8 + (k % 5) * R * 0.95, p.y - R * 0.45 + Math.floor(k / 5) * R * 0.95, R * 0.34); ctx.fill(); });
    });
  }

  // ---------- input: drag across stations, or tap one then another ----------
  const hit = (x, y) => { let best = -1, bd = Math.max(22, R * 2.2); stations.forEach((_, i) => { const p = at(i), d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = i; } }); return best; };
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const endOf = (i) => lines.find((l) => l.stops[0] === i || l.stops.at(-1) === i);
  canvas.addEventListener('pointerdown', (e) => {
    const p = local(e), i = hit(p.x, p.y);
    if (i < 0) { picked = null; paint(); return; }
    const ext = endOf(i);
    const stops = ext ? (ext.stops.at(-1) === i ? [...ext.stops] : [...ext.stops].reverse()) : [i];
    drag = { stops, ext, start: i, color: ext ? ext.color : getComputedStyle(document.documentElement).getPropertyValue('--' + LINE_SLOTS[nextLine % LINE_SLOTS.length]).trim() };
    cursor = p;
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    cursor = local(e);
    const i = hit(cursor.x, cursor.y);
    if (i >= 0 && !drag.stops.includes(i)) drag.stops.push(i);
    paint();
  });
  const finish = (commit) => {
    if (!drag) return;
    const d = drag;
    drag = null; cursor = null;
    const grew = d.ext ? d.stops.length > d.ext.stops.length : d.stops.length >= 2;
    if (commit && grew) { addLine(d.stops, d.ext); picked = null; done(); }
    else if (commit) { // a tap: the first picks a station, the second joins the two
      if (picked !== null && picked !== d.start) {
        const ext = endOf(picked);
        if (ext) addLine(ext.stops.at(-1) === picked ? [...ext.stops, d.start] : [d.start, ...ext.stops], ext);
        else addLine([picked, d.start]);
        picked = null; done();
      } else picked = d.start;
    }
    paint();
  };
  canvas.addEventListener('pointerup', () => finish(true));
  canvas.addEventListener('pointercancel', () => finish(false));
  function done() { if (!drew) { drew = true; $hint.hidden = true; } }
  $hint.textContent = coarse.matches ? 'Tap two stations to join them with a line.' : 'Drag from station to station to lay a line.';

  // ---------- buttons, so a keyboard can play too ----------
  document.getElementById('play-draw').addEventListener('click', () => {
    const onLine = new Set(lines.flatMap((l) => l.stops));
    const fresh = stations.map((_, i) => i).filter((i) => !onLine.has(i));
    const pool = (fresh.length >= 2 ? fresh : stations.map((_, i) => i)).sort(() => Math.random() - 0.5).slice(0, 4);
    if (pool.length >= 2) addLine(pool.sort((a, b) => stations[a].x - stations[b].x));
    done(); paint();
  });
  document.getElementById('play-clear').addEventListener('click', () => { lines = []; picked = null; paint(); });

  // ---------- running: only while it can be seen ----------
  function resize() {
    const r = host.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    R = Math.max(9, Math.min(13, Math.min(W, H) * 0.028));
    for (const l of lines) { l.r = route(l.stops); l.train.d = Math.min(l.train.d, l.r.len); }
    paint();
  }
  let visible = false, raf = 0, last = 0;
  const running = () => visible && !document.hidden;
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    spawn(dt); step(dt); paint();
    if (running()) raf = requestAnimationFrame(frame); else last = 0;
  }
  const sync = () => { if (running() && !raf) raf = requestAnimationFrame(frame); };
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; sync(); }).observe(host);
  new ResizeObserver(resize).observe(host);
  document.addEventListener('visibilitychange', sync);
  readColors();
  resize();
  addLine([0, 1, 2, 3]); // one line already running, so the map is alive before anyone draws
  paint();
})();
