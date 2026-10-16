/* tile3d.js: interactive 3D model of one 8-element ESP32-C5 tile and of the two-tile 4 x 4 array.
   Modelled on the ZU67DR page's mechanics viewer: three.js r128 is loaded lazily from cdnjs, renders on
   demand, numbered callouts link to the legend, and a cola can gives the scale.
   Units are mm. x = across the tile (150 mm), y = up (the antenna side faces up), z = along the tile (100 mm)
   with the seam edge at z = +50 and the connector edge at z = -50; origin at the board centre.
   Custom 4-layer stack: L1 patches only / 1.065 mm core / L2 solid ground (the patch ground) / 0.21 mm prepreg /
   L3 clock lines and 3.3 V / 0.2 mm core / L4 every part, the RF lines and the data lines. All digital is behind L2.
   Each element is a cell under its patch: probe via, 1 mm to the SPDT, 2.5 mm (series 0201 in line) to the C5, the same for
   all eight. Clock drops and 3.3 V drops are blind L4-L3 vias; the probe feeds and ground stitching are the only through vias.
   ?m3check=1 checks same-layer clearance per conductor (vias included), RF lines over L3 lines or the 3.3 V spine, part
   overlaps, lines under parts, the equal RF and calibration path lengths and the matched calibration cables, and writes the result to data-m3-check on the stage.
   This is a concept drawn from the design numbers on the page, not a PCB layout. */
(function () {
  'use strict';

  var THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  var THREE_SRI = 'sha512-dLxUelApnYxpLt6K2iomGngnHO83iUvZytA3YjDUCjT0HDOHKXnVYdf3hU4JjM8uEhxf9nD1/ey98U3t2vZ0qQ==';
  var NAMES = {
    1: '2 × 4 patch block: the only parts on the front',
    2: 'RF switch per element, 1 mm from the probe via',
    3: '8 × ESP32-C5, each behind its own patch',
    4: 'PARLIO, control and 3.3 V lines to each C5',
    5: 'ESP32-S31: PARLIO RX, DMA, Ethernet MAC',
    6: 'Gigabit PHY and RJ45 MagJack: 1 GbE out',
    7: '1:8 calibration tree, equal branches (splits drawn as junctions)',
    8: '48 MHz 1:8 and 40 MHz 1:10 buffers; point-to-point lines, mostly on L3',
    9: 'Inputs from the master board: 48 MHz, PCLK, trigger; calibration tone on the side',
    10: 'Seam: each board edge is 14.4 mm from its nearest row',
    11: 'Master board: 48 MHz TCXO, 40 MHz PCLK, trigger, 5.2 GHz source'
  };
  var ARRAY_ONLY = { 11: true };
  var NK = 11;
  var CAMS = ['back', 'front', 'plan', 'seam'];
  /* azimuth (deg, from +z towards +x), elevation (deg; negative looks up at the back), field of view (deg) */
  var CAM_DIR = { back: [215, -36, 32], front: [215, 40, 32], plan: [180, -89.4, 6], seam: [20, 34, 32] };
  var CAM_WORD = { back: 'back (parts side)', front: 'front (antenna side)', plan: 'plan of the back', seam: 'seam' };
  var DEG = Math.PI / 180, EXPLODE_MS = 700, CAM_MS = 520;

  /* ---------- geometry from the design ---------- */
  var BW = 150, BD = 100, YT = 1.6;            // board; the front surface is at YT, the back at -0.03
  var STAND = 16;                               // M3 standoffs under the board
  var YP = -0.065;                              // underside of the L4 copper: back-side parts hang from here
  var Y3 = 0.2;                                 // L3 copper
  var PW = 17.5, PL = 13.5;                     // patch, transmission-line estimate (εr 4.4, h 1.065 mm)
  var FEED = 3.3;                               // probe-feed offset from the patch centre (estimate, tuned in simulation)
  var COLS = [-43.2, -14.4, 14.4, 43.2];
  var ROWZ = [50 - 14.4, 50 - 43.2];            // 35.6 (seam row), 6.8 (inner row)
  var S31 = [-1.5, -27], PHY = [-24, -36], RJ = { x: -38, z0: -53.3, z1: -32, w: 16.2, h: 13.5 };
  var BUF48 = [-61, -19.45, 5, 5.6], BUFP = [56, -26.05, 6.5, 5.4];    // x, z, w, d
  var EDGE_SMA = [{ x: -54, txt: '48M', lx: -59.8, lz: -46, name: '48 MHz reference in' },
                  { x: 24, txt: 'TRIG', lx: 30.2, lz: -46, name: 'trigger in' },
                  { x: 51, txt: 'PCLK', lx: 55, lz: -40.8, name: '40 MHz PCLK in' }];
  var CAL_SMA = { x: -71.8, z: 40 };            // on the left edge, barrel pointing -x
  var SMA_S = 6.4, SMA_Z = -47;
  var HOLES = [[-70, 30], [70, 30], [-70, -44], [70, -44]];
  var ROW_A = -16, ROW_B = -22.6, TURN = -29.5, TRK = 0.7;   // clock via rows, data-line turn, L3 track pitch
  /* Layer stack: y bottom, thickness, lift when exploded (mm; the thick core gets the big gap). */
  var LAYERS = [
    { id: 'L4', y: -0.03, t: 0.03, lift: 0, tag: 'L4', tl: ' all parts, RF, PARLIO and control' },
    { id: 'c2', y: 0.0, t: 0.2, lift: 5, tag: '0.2 mm', tl: ' core' },
    { id: 'L3', y: 0.2, t: 0.035, lift: 10, tag: 'L3', tl: ' ground; clock lines, 3.3 V spine' },
    { id: 'pp', y: 0.235, t: 0.21, lift: 15, tag: '0.21 mm', tl: ' prepreg' },
    { id: 'L2', y: 0.445, t: 0.035, lift: 20, tag: 'L2', tl: ' solid ground: the patch ground' },
    { id: 'c1', y: 0.48, t: 1.065, lift: 36, tag: '1.065 mm', tl: ' core: the patch substrate' },
    { id: 'L1', y: 1.545, t: 0.055, lift: 52, tag: 'L1', tl: ' patches only' }
  ];
  var COLA_R = 33, COLA_H = 115;

  /* Cells: element numbers 1-4 on the seam row, 5-8 on the inner row, by x. */
  var CELLS = [];
  ROWZ.forEach(function (pz, r) {
    COLS.forEach(function (cx, c) {
      /* feed point on the +z side of the patch centre, chain towards -z: the C5 sits under its own patch (≈ 1.5 mm overhang) */
      var vz = pz + FEED, sz = vz - 2.0, cz = sz - 1.0 - 2.5 - 3.0;
      CELLS.push({ n: r * 4 + c + 1, row: r, col: c, cx: cx, pz: pz, via: vz, spdt: sz, c5: cz });
    });
  });
  var ZN = (CELLS[0].spdt + CELLS[4].spdt) / 2;         // calibration node height, midway between the two switches
  var ZR = 45.0, Z1 = 43.5, Z2 = 40.5;                 // root, first and second split heights of the cal tree

  var T = null;
  var sec, stage, ph, msg, loadBtn, cap, ctlRow, camRow, hint, legend, modx, status;
  var expBtn, lblBtn, zinBtn, zoutBtn, resetBtn, colaBtn, setModeSeg, setCamSeg;
  var loadState = 'idle', btnHadFocus = false, lost = false, lostTimer = 0;
  var st = { mode: 'tile', cam: 'back', exploded: false, labels: true, cola: false };
  var testParam = null, shot = false, wantCheck = false, CHK = null;
  var renderer, scene, camera, canvas, labelsEl, tipEl, whintEl, dimEl, world, shadowMesh, envTex = null;
  var kit = null, model = null;
  var orbit = { theta: 0, phi: 1, r: 400, fov: 32, target: null }, camDest = null;
  var fit = { r: 400, target: null, theta: 0, phi: 1, fov: 32 };
  var explodeE = 0, explodeT = 0, tweens = [];
  var raf = 0, rafTimer = 0, onScreen = true, dirty = false;
  var labelBtns = {}, layerTags = [], hlK = null, pinK = null, hoverK = null, lastStatus = '';
  var lastOcc = 0, occTimer = 0, engaged = false, whintTimer = 0;
  var v3a, v3b, v3c, rayc, ndc;

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function load_(k) { try { return JSON.parse(localStorage.getItem('esp32c5.' + k)); } catch (e) { return null; } }
  function save_(k, v) { try { localStorage.setItem('esp32c5.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function plen(pts) {
    var s = 0;
    for (var i = 1; i < pts.length; i++) s += Math.sqrt(Math.pow(pts[i][0] - pts[i - 1][0], 2) + Math.pow(pts[i][1] - pts[i - 1][1], 2));
    return s;
  }
  /* Offset an open polyline [[x, z], ...] sideways by o (normal = (dz, -dx)), with mitred corners. */
  function offsetLine(pts, o) {
    var n = [], out = [], i;
    for (i = 0; i < pts.length - 1; i++) {
      var dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1], L = Math.sqrt(dx * dx + dz * dz);
      n.push([dz / L, -dx / L]);
    }
    for (i = 0; i < pts.length; i++) {
      var a = n[Math.max(0, i - 1)], b = n[Math.min(n.length - 1, i)], d = 1 + a[0] * b[0] + a[1] * b[1];
      out.push([pts[i][0] + (a[0] + b[0]) * o / d, pts[i][1] + (a[1] + b[1]) * o / d]);
    }
    return out;
  }

  function seg(group, attr, onPick) {
    if (!group) return function () {};
    var btns = Array.prototype.slice.call(group.querySelectorAll('button[' + attr + ']'));
    function set(val) {
      btns.forEach(function (b) {
        var on = b.getAttribute(attr) === String(val);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
    }
    btns.forEach(function (b, i) {
      b.addEventListener('click', function () { onPick(b.getAttribute(attr)); });
      b.addEventListener('keydown', function (e) {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        var d = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 0;
        if (!d) return;
        e.preventDefault(); e.stopPropagation();
        var nb = btns[(i + d + btns.length) % btns.length];
        nb.focus(); onPick(nb.getAttribute(attr));
      });
    });
    return set;
  }
  function announce(text) {
    if (!status || !text || text === lastStatus) return;
    lastStatus = text;
    status.textContent = text;
  }

  /* ================================================================== */
  /* Loading                                                             */
  /* ================================================================== */
  function setMsg(text, btnText, busy) {
    if (msg) msg.textContent = text;
    if (!loadBtn) return;
    loadBtn.hidden = !btnText;
    if (btnText) loadBtn.textContent = btnText;
    if (busy) loadBtn.setAttribute('aria-disabled', 'true'); else loadBtn.removeAttribute('aria-disabled');
  }
  function legendItems() { return legend ? Array.prototype.slice.call(legend.querySelectorAll('li[data-k]')) : []; }
  function legendEnabled(on) {
    legendItems().forEach(function (li) { var b = li.querySelector('button'); if (b) b.disabled = !on; });
  }
  function fail(kind) {
    var box = $('m3'), inViewer = !!(box && document.activeElement && box.contains(document.activeElement));
    loadState = 'failed';
    stage.setAttribute('data-m3-state', 'failed');
    if (ph) { ph.hidden = false; if (ph.classList.contains('m3-noimg')) stage.classList.add('m3-collapsed'); }
    [ctlRow, camRow, hint, canvas, labelsEl, tipEl, whintEl, cap].forEach(function (el) { if (el) el.hidden = true; });
    legendEnabled(false);
    if (kind === 'net') setMsg('The 3D view could not be loaded. The drawings above show the same tile.', 'Try again');
    else if (kind === 'lost') setMsg('The 3D view stopped because the browser lost its graphics context. Reload the page to show it again.', '');
    else setMsg('This browser cannot show the 3D view (WebGL is not available). The drawings above show the same tile.', '');
    if (inViewer) { if (!loadBtn.hidden) loadBtn.focus(); else msg.focus(); }
  }
  function load() {
    if (loadState === 'loading' || loadState === 'ready') return;
    btnHadFocus = document.activeElement === loadBtn;
    loadState = 'loading';
    stage.setAttribute('data-m3-state', 'loading');
    stage.classList.remove('m3-collapsed');
    setMsg('Loading the 3D view…', btnHadFocus ? 'Loading…' : '', true);
    if (window.THREE && window.THREE.WebGLRenderer) { start(); return; }
    var s = document.createElement('script'), done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      if (s.parentNode) s.parentNode.removeChild(s);
      fail('net');
    }, 20000);
    s.src = THREE_URL;
    s.crossOrigin = 'anonymous';
    s.integrity = THREE_SRI;
    s.async = true;
    s.onload = function () {
      if (done) return;
      done = true; clearTimeout(timer);
      if (window.THREE && window.THREE.WebGLRenderer) start(); else fail('net');
    };
    s.onerror = function () {
      if (done) return;
      done = true; clearTimeout(timer);
      if (s.parentNode) s.parentNode.removeChild(s);
      fail('net');
    };
    document.head.appendChild(s);
  }

  /* ================================================================== */
  /* Kit: per-build geometry / material / texture registry               */
  /* ================================================================== */
  var TOK = {};
  function readTokens() {
    var box = $('m3'), cs = null, rs = null;
    try { cs = getComputedStyle(box); rs = getComputedStyle(document.documentElement); } catch (e) { /* defaults */ }
    function g(n, fb) { var v = cs ? String(cs.getPropertyValue(n) || '').trim() : ''; return v || fb; }
    function r(n, fb) { var v = rs ? String(rs.getPropertyValue(n) || '').trim() : ''; return v || fb; }
    TOK = {
      mask: g('--m3-mask', '#2f6a4c'), fr4: g('--m3-fr4', '#cdbf86'), gold: g('--m3-gold', '#d6ab4f'), copper: g('--m3-copper', '#b8763f'),
      chip: g('--m3-chip', '#1f2326'), silk: g('--m3-silk', '#eef3ef'), zinc: g('--m3-zinc', '#bcc3c9'), coax: g('--m3-coax', '#4b6f9e'),
      cable: g('--m3-cable', '#a3a9b0'), shade: g('--m3-shade', '#24313c'), cola: g('--m3-cola', '#c3161c'), colaband: g('--m3-colaband', '#f4f2ee'),
      zone: r('--zone', '#f8fafc'), rf: r('--rf', '#d4652a')
    };
  }
  function lin(hex) { var c = new T.Color(hex); c.convertSRGBToLinear(); return c; }

  /* x: how far the material fades when the layers are exploded (see-through stack) */
  var MATDEF = {
    mask: { c: 'mask', m: 0.0, r: 0.45, x: 0.72 }, fr4: { c: 'fr4', m: 0.0, r: 0.7, x: 0.8 }, plane: { c: 'copper', m: 0.9, r: 0.35, x: 0.7 },
    pcb: { c: 'mask', m: 0.0, r: 0.45 }, gold: { c: 'gold', m: 1.0, r: 0.28 }, copper: { c: 'copper', m: 0.95, r: 0.3 },
    chip: { c: 'chip', m: 0.1, r: 0.5 }, zinc: { c: 'zinc', m: 0.85, r: 0.35 }, ptfe: { c: '#f2f2ee', m: 0.0, r: 0.6 },
    coax: { c: 'coax', m: 0.0, r: 0.5 }, cable: { c: 'cable', m: 0.0, r: 0.6 }, cap: { c: '#b39a72', m: 0.0, r: 0.6 },
    black: { c: '#2a2d31', m: 0.0, r: 0.75 }, term: { c: '#3c8a5c', m: 0.0, r: 0.55 }, cola: { c: 'cola', m: 0.45, r: 0.35 },
    colaband: { c: 'colaband', m: 0.2, r: 0.5 }, elcap: { c: '#2b3a55', m: 0.3, r: 0.4 }, xtal: { c: '#cfd4d8', m: 0.9, r: 0.3 },
    seam: { c: '#1b2026', m: 0.0, r: 0.8 }, antipad: { c: '#1d2328', m: 0.0, r: 0.9 }, tent: { c: '#285c42', m: 0.0, r: 0.5 }
  };
  function Kit() { this.geos = []; this.mats = []; this.texs = []; this.mk = {}; this.gk = {}; }
  Kit.prototype.g = function (geo) { this.geos.push(geo); return geo; };
  Kit.prototype.t = function (tex) { this.texs.push(tex); return tex; };
  Kit.prototype.box = function (w, h, d) {
    var key = 'b' + w + '|' + h + '|' + d;
    return this.gk[key] || (this.gk[key] = this.g(new T.BoxGeometry(w, h, d)));
  };
  Kit.prototype.cyl = function (r, h, n) {
    var key = 'c' + r + '|' + h + '|' + (n || 24);
    return this.gk[key] || (this.gk[key] = this.g(new T.CylinderGeometry(r, r, h, n || 24)));
  };
  Kit.prototype.mat = function (key, k) {
    var id = key + '#' + (k || 0);
    if (this.mk[id]) return this.mk[id];
    var d = MATDEF[key], col = TOK[d.c] || d.c;
    var m = new T.MeshStandardMaterial({ color: lin(col), metalness: d.m, roughness: d.r, envMapIntensity: 0.9 });
    m.userData.k = k || 0;
    if (d.x) m.userData.xray = d.x;
    this.mats.push(m);
    return (this.mk[id] = m);
  };
  /* Box whose one face carries a printed texture (chip marking, connector face). */
  Kit.prototype.printed = function (key, k, tex, face) {
    var base = this.mat(key, k), arr = [base, base, base, base, base, base];
    var m = new T.MeshStandardMaterial({ map: tex, metalness: MATDEF[key].m, roughness: MATDEF[key].r });
    m.userData.k = k || 0;
    this.mats.push(m);
    arr[face] = m;
    return arr;
  };
  Kit.prototype.dispose = function () {
    this.geos.forEach(function (g) { g.dispose(); });
    this.mats.forEach(function (m) { m.dispose(); });
    this.texs.forEach(function (t) { t.dispose(); });
  };

  function canvasTex(w, h, draw, flip) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
    if (flip) { t.center.set(0.5, 0.5); t.rotation = Math.PI; }   // the underside face then reads upright from the connector side
    return kit.t(t);
  }
  function chipTex(name, pkg) {
    return canvasTex(256, 256, function (x, w, h) {
      x.fillStyle = TOK.chip; x.fillRect(0, 0, w, h);
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = '#c9ced3';
      x.font = '600 ' + (name.length > 8 ? 36 : 42) + 'px Figtree, Segoe UI, sans-serif';
      x.fillText(name, w / 2, h / 2 - 12);
      x.font = '500 28px Figtree, Segoe UI, sans-serif'; x.fillStyle = '#8f969c';
      x.fillText(pkg, w / 2, h / 2 + 36);
      x.beginPath(); x.arc(30, 30, 10, 0, Math.PI * 2); x.fillStyle = '#5b6168'; x.fill();
    }, true);
  }

  function mesh(geo, mat, x, y, z, parent, name) {
    var m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (name) m.userData.name = name;
    if (parent) parent.add(m);
    return m;
  }

  /* ---------- geometry check (?m3check=1), filled while tile A is built ---------- */
  var RF_NET = /^(feed|stub|cal)/;
  function chkSeg(L, net, a, b, w) { if (CHK) CHK.segs.push({ L: L, n: net, a: a, b: b, w: w }); }
  function chkPart(side, net, name, x, z, w, d) {
    if (CHK) CHK.parts.push({ s: side, n: net, name: name, x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
  }
  function cross2(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
  function segsCross(p1, p2, q1, q2) {
    var d1 = cross2(q1, q2, p1), d2 = cross2(q1, q2, p2), d3 = cross2(p1, p2, q1), d4 = cross2(p1, p2, q2);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 && d2 && d3 && d4;
  }
  function ptSeg(p, a, b) {
    var dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz, t = L2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2, 0, 1) : 0;
    var ex = a[0] + t * dx - p[0], ez = a[1] + t * dz - p[1];
    return Math.sqrt(ex * ex + ez * ez);
  }
  function segDist(p1, p2, q1, q2) {
    if (segsCross(p1, p2, q1, q2)) return 0;
    return Math.min(ptSeg(p1, q1, q2), ptSeg(p2, q1, q2), ptSeg(q1, p1, p2), ptSeg(q2, p1, p2));
  }
  /* Liang-Barsky: does segment a-b pass through the open rectangle r? */
  function segHitsRect(a, b, r) {
    var t0 = 0, t1 = 1, dx = b[0] - a[0], dz = b[1] - a[1];
    var p = [-dx, dx, -dz, dz], q = [a[0] - r.x0, r.x1 - a[0], a[1] - r.z0, r.z1 - a[1]];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] <= 0) return false; continue; }
      var t = q[i] / p[i];
      if (p[i] < 0) { if (t > t0) t0 = t; } else if (t < t1) t1 = t;
      if (t0 >= t1) return false;
    }
    return t1 - t0 > 1e-9;
  }
  function runCheck(C) {
    var res = { clearance: [], rfOverL3: [], rfOver33: [], overlaps: [], underParts: [], segs: C.segs.length, parts: C.parts.length };
    var seen = { c: {}, r: {}, o: {}, u: {}, v: {} };
    C.segs.forEach(function (s) {   // RF must have L3 ground under it, never the 3.3 V spine
      if (s.L !== 'L4' || !RF_NET.test(s.n)) return;
      C.v33.forEach(function (r) {
        var g = { x0: r.x0 - s.w / 2, x1: r.x1 + s.w / 2, z0: r.z0 - s.w / 2, z1: r.z1 + s.w / 2 };
        if (segHitsRect(s.a, s.b, g)) add(res.rfOver33, seen.v, s.n, s.n + ' over the 3.3 V spine');
      });
    });
    function add(list, map, key, item) { if (!map[key]) { map[key] = 1; list.push(item); } }
    for (var i = 0; i < C.segs.length; i++) {
      for (var j = i + 1; j < C.segs.length; j++) {
        var s = C.segs[i], t = C.segs[j];
        if (s.n === t.n) continue;
        var gap = segDist(s.a, s.b, t.a, t.b) - (s.w + t.w) / 2;
        if (s.L === t.L && gap < 0.1) add(res.clearance, seen.c, s.L + s.n + '|' + t.n, s.L + ': ' + s.n + ' / ' + t.n + ' (' + gap.toFixed(2) + ' mm)');
        var rf = (s.L === 'L4' && RF_NET.test(s.n) && t.L === 'L3') ? [s, t] : (t.L === 'L4' && RF_NET.test(t.n) && s.L === 'L3') ? [t, s] : null;
        if (rf && gap < 0.3) add(res.rfOverL3, seen.r, rf[0].n + '|' + rf[1].n, rf[0].n + ' over ' + rf[1].n);
      }
    }
    C.parts.forEach(function (p, i) {
      C.parts.slice(i + 1).forEach(function (q) {
        if (p.s !== q.s || p.n === q.n) return;
        if (p.x0 < q.x1 && q.x0 < p.x1 && p.z0 < q.z1 && q.z0 < p.z1) add(res.overlaps, seen.o, p.n + '|' + q.n, p.name + ' / ' + q.name);
      });
    });
    C.segs.forEach(function (s) {
      if (s.L !== 'L4') return;
      C.parts.forEach(function (p) {
        if (p.s !== 'back' || p.n === s.n) return;   // a part in line with its own net (series 0201, split marker) is fine
        var k = Math.min(0.3, (p.x1 - p.x0) / 4, (p.z1 - p.z0) / 4) - s.w / 2;   // copper width counts; pad landings pass
        var r = { x0: p.x0 + k, x1: p.x1 - k, z0: p.z0 + k, z1: p.z1 - k };
        if (r.x0 < r.x1 && r.z0 < r.z1 && segHitsRect(s.a, s.b, r)) add(res.underParts, seen.u, s.n + '|' + p.n, s.n + ' under ' + p.name);
      });
    });
    function spread(a) { return a.length ? +(Math.max.apply(null, a) - Math.min.apply(null, a)).toFixed(3) : 0; }
    res.rfPath = C.rf; res.rfSpread = spread(C.rf);
    res.calPath = C.cal; res.calSpread = spread(C.cal);
    res.ok = !res.clearance.length && !res.rfOverL3.length && !res.rfOver33.length && !res.overlaps.length && !res.underParts.length &&
      res.rfSpread < 0.01 && res.calSpread < 0.01;
    return res;
  }

  /* A flat trace along a polyline [[x, z], ...] with its bottom at height y; net defaults to the label. */
  function trace(parent, pts, w, y, matKey, k, name, t, net) {
    t = t || 0.035;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.sqrt(dx * dx + dz * dz);
      if (L < 1e-6) continue;
      var m = mesh(kit.g(new T.BoxGeometry(L + w, t, w)), kit.mat(matKey, k), (a[0] + b[0]) / 2, y + t / 2, (a[1] + b[1]) / 2, parent, name);
      m.rotation.y = -Math.atan2(dz, dx);
      m.userData.trace = true;
      chkSeg(parent.userData.layer, net || name, a, b, w);
    }
  }

  /* ================================================================== */
  /* Tile                                                                */
  /* ================================================================== */
  function silkTex(name) {
    var S = 10;   // px per mm; canvas top = connector edge, canvas left = +x: reads upright from below, connector edge up
    function X(x) { return (BW / 2 - x) * S; }
    function Z(z) { return (z + BD / 2) * S; }
    return canvasTex(BW * S, BD * S, function (c, w, h) {
      c.clearRect(0, 0, w, h);
      c.fillStyle = TOK.silk; c.strokeStyle = TOK.silk; c.lineWidth = 3;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '700 36px Figtree, Segoe UI, sans-serif';
      c.fillText(name, X(64), Z(-6));
      c.font = '600 20px Figtree, Segoe UI, sans-serif';
      ['8 × ESP32-C5', '5.2 GHz', 'back side', 'Rev 1 concept'].forEach(function (t, i) { c.fillText(t, X(64), Z(-1.5 + i * 3)); });
      c.fillText('1 GbE', X(-49.5), Z(-36));
      c.fillText('5 V', X(63), Z(-40.6));
      c.fillText('USB', X(42), Z(-41.4));
      c.fillText('SEAM EDGE', X(-40), Z(47.6));
      c.fillText('CAL', X(-66), Z(CAL_SMA.z + 5.4));
      c.font = '600 16px Figtree, Segoe UI, sans-serif';
      EDGE_SMA.forEach(function (s) { c.fillText(s.txt, X(s.lx), Z(s.lz)); });
      c.font = '600 22px Figtree, Segoe UI, sans-serif';
      CELLS.forEach(function (e) {
        c.fillText(String(e.n), X(e.cx + 4.6), Z(e.c5 - 4.6));
        c.strokeRect(X(e.cx + 3.6), Z(e.c5 - 3.6), 7.2 * S, 7.2 * S);
      });
      c.strokeRect(X(S31[0] + 4.8), Z(S31[1] - 4.8), 9.6 * S, 9.6 * S);
      c.strokeRect(X(PHY[0] + 3.2), Z(PHY[1] - 3.2), 6.4 * S, 6.4 * S);
    });
  }

  function buildTile(root, name, withAnchors) {
    var tile = new T.Group();
    tile.position.y = STAND;
    root.add(tile);
    var grp = {};
    LAYERS.forEach(function (L) { var g = new T.Group(); g.userData.layer = L.id; tile.add(g); grp[L.id] = g; });
    tile.userData.layers = grp;
    tile.userData.barrels = [];
    tile.userData.standoffs = [];
    var L1 = grp.L1, L3 = grp.L3, L4 = grp.L4, pn = 0;
    function A(k, x, y, z, g) {
      if (!withAnchors) return;
      var a = new T.Object3D();
      a.position.set(x, y, z);
      (g || L4).add(a);
      model.anchors[k] = a;
    }
    function t4(pts, w, k, nm, net) { trace(L4, pts, w, YP, 'gold', k, nm, 0.035, net); }
    function t3(pts, w, k, nm, net) { trace(L3, pts, w, Y3, 'copper', k, nm, 0.035, net); }
    /* a part on the back: hangs below the board */
    function part(w, h, d, x, z, k, nm, matKey, mats, net) {
      var m = mesh(kit.box(w, h, d), mats || kit.mat(matKey || 'chip', k), x, YP - h / 2, z, L4, nm);
      chkPart('back', net || 'p' + (pn++), nm, x, z, w, d);
      return m;
    }
    /* Vias: blind L4-L3 ones (clock drops, buffer fan-out, 3.3 V drops) never reach the front; the probe feeds are the only
       signal through vias. Blind vias with a net go into the check as round conductors on L4 and L3. */
    function via(x, z, k, net, blind) {
      mesh(kit.cyl(0.32, 0.03, 10), kit.mat('zinc', k || 0), x, YP - 0.015, z, L4, blind ? 'Blind via, L4 to L3 (never reaches the front)' : 'Through via');
      if (net) { chkSeg('L4', net, [x, z], [x + 0.001, z], 0.64); chkSeg('L3', net, [x, z], [x + 0.001, z], 0.64); }
    }

    /* --- board stack --- */
    function slab(L, nm) { mesh(kit.box(BW, L.t, BD), kit.mat('fr4', 0), 0, L.y + L.t / 2, 0, grp[L.id], nm); }
    slab(LAYERS[1], 'Core, 0.2 mm (L3 to L4)');
    slab(LAYERS[3], 'Prepreg, 0.21 mm (L2 to L3)');
    slab(LAYERS[5], 'Core, 1.065 mm (L1 to L2): the patch substrate');
    mesh(kit.box(BW, LAYERS[4].t, BD), kit.mat('plane', 0), 0, LAYERS[4].y + LAYERS[4].t / 2, 0, grp.L2, 'L2: solid ground, the patch ground');
    /* L3: solid ground under the cells and the calibration tree (the reference for every RF line on L4), the clock lines in
       the electronics half, a 3.3 V spine that each C5's supply line drops into, and ground under the hub. */
    var V33 = [{ x0: -66, x1: 72, z0: -15.2, z1: -12.8 }, { x0: 63.5, x1: 72, z0: -40, z1: -15.2 }], tL3 = LAYERS[2].t;
    if (CHK) CHK.v33 = V33;
    mesh(kit.box(BW - 4, tL3, 47.2 + 12.4), kit.mat('plane', 0), 0, Y3 + tL3 / 2, (47.2 - 12.4) / 2, L3, 'L3: ground, the reference for every RF line on L4');
    mesh(kit.box(62.8 + 73, tL3, 48 - 32.2), kit.mat('plane', 0), (62.8 - 73) / 2, Y3 + tL3 / 2, (-48 - 32.2) / 2, L3, 'L3: ground under the hub');
    V33.forEach(function (r) {
      mesh(kit.box(r.x1 - r.x0, tL3, r.z1 - r.z0), kit.mat('plane', 0), (r.x0 + r.x1) / 2, Y3 + tL3 / 2, (r.z0 + r.z1) / 2, L3, 'L3: 3.3 V spine from the regulators');
    });
    mesh(kit.box(BW, 0.035, BD), kit.mat('mask', 0), 0, YT - 0.0175, 0, L1, 'Solder mask, front');
    mesh(kit.box(BW, 0.03, BD), kit.mat('mask', 0), 0, -0.015, 0, L4, 'Solder mask, back');
    var silkMat = new T.MeshStandardMaterial({ map: silkTex(name), transparent: true, roughness: 0.6, depthWrite: false });
    kit.mats.push(silkMat);
    var silk = new T.Mesh(kit.g(new T.PlaneGeometry(BW, BD)), silkMat);
    silk.rotation.set(Math.PI / 2, 0, Math.PI);
    silk.position.y = -0.032;
    silk.userData.noPick = true;
    L4.add(silk);
    HOLES.forEach(function (p, i) {   // unplated (NPTH): no copper ring on either side
      mesh(kit.cyl(1.6, 0.08, 20), kit.mat('black', 0), p[0], YT + 0.05, p[1], L1, 'M3 mounting hole (unplated)');
      mesh(kit.cyl(1.6, 0.08, 20), kit.mat('black', 0), p[0], -0.07, p[1], L4, 'M3 mounting hole (unplated)');
      var so = mesh(kit.cyl(3.18, STAND - 0.06, 6), kit.mat('zinc', 0), p[0], -STAND / 2 - 0.03, p[1], tile, 'M3 standoff, 16 mm');
      so.rotation.y = Math.PI / 6;
      tile.userData.standoffs.push(so);
      chkPart('back', 'standoff' + i, 'M3 standoff', p[0], p[1], 6.4, 6.4);
    });

    /* --- 1-3: the cells. Front: the patch. Back, under it: probe via, 1 mm, SPDT, 2.5 mm with a series 0201, C5 --- */
    var c5tex = chipTex('ESP32-C5', 'QFN48'), rf = [];
    var antip = kit.g(new T.RingGeometry(0.35, 0.8, 20));
    CELLS.forEach(function (e) {
      var cx = e.cx, n = e.n, sz = e.spdt, top = e.c5 + 3;
      mesh(kit.box(PW, 0.05, PL), kit.mat('gold', 1), cx, YT + 0.025, e.pz, L1, 'Patch ' + n + ': ≈ 17.5 × 13.5 mm, probe-fed');
      mesh(kit.cyl(0.45, 0.03, 12), kit.mat('zinc', 1), cx, YT + 0.065, e.via, L1, 'Probe-feed via, patch ' + n);
      chkPart('front', 'patch' + n, 'Patch ' + n, cx, e.pz, PW, PL);
      [[grp.L2, LAYERS[4].y + LAYERS[4].t + 0.004], [L3, Y3 + tL3 + 0.004]].forEach(function (g) {
        var ap = mesh(antip, kit.mat('antipad', 0), cx, g[1], e.via, g[0], 'Clearance around the probe via');
        ap.rotation.x = -Math.PI / 2;
      });
      var barrel = mesh(kit.cyl(0.22, 1, 10), kit.mat('copper', 1), cx, 0, e.via, tile, 'Probe via, L4 to the patch');
      tile.userData.barrels.push(barrel);
      var feed = [[cx, sz + 1], [cx, e.via]], stubNm = 'RF line, switch to ESP32-C5 #' + n + ': 2.5 mm with the series part, all eight equal';
      t4(feed, 0.38, 2, 'RF line, probe via to switch ' + n + ': 1.0 mm, all eight equal', 'feed' + n);
      t4([[cx, sz - 1], [cx, sz - 1.45]], 0.38, 2, stubNm, 'stub' + n);
      t4([[cx, sz - 2.05], [cx, top]], 0.38, 2, stubNm, 'stub' + n);
      part(0.3, 0.3, 0.6, cx, sz - 1.75, 2, 'Series capacitor ' + n + ', 0201: match and DC block, in line', 'cap', null, 'stub' + n);
      rf.push(+(plen(feed) + (sz - 1 - top)).toFixed(3));
      via(cx, e.via, 2);
      part(2, 0.8, 2, cx, sz, 2, 'RF switch (SPDT) for element ' + n);
      part(0.5, 0.45, 1.0, cx - 0.9, sz - 2.2, 2, 'Matching network ' + n + 'a (shunt), 0402', 'cap');
      part(0.5, 0.45, 1.0, cx + 0.9, sz - 2.6, 2, 'Matching network ' + n + 'b (shunt), 0402', 'cap');
      t4([[cx - 1.6, top], [cx - 1.6, sz - 0.4], [cx - 1, sz - 0.4]], 0.15, 2, 'Switch control V1 from ESP32-C5 #' + n, 'v1_' + n);
      t4([[cx - 2.2, top], [cx - 2.2, sz + 0.4], [cx - 1, sz + 0.4]], 0.15, 2, 'Switch control V2 from ESP32-C5 #' + n, 'v2_' + n);
      part(6, 0.85, 6, cx, e.c5, 3, 'ESP32-C5 #' + n + ' (QFN48, 6 × 6 mm), behind its patch', null, kit.printed('chip', 3, c5tex, 3));
      [[-4.3, 1.6], [4.3, 1.6], [4.3, -1.8], [-4.3, -1.8]].forEach(function (p, j) {
        part(1.0, 0.5, 0.5, cx + p[0], e.c5 + p[1], 3, 'Decoupling ' + n + '.' + j + ', 0402', 'cap');
      });
    });
    if (CHK) CHK.rf = rf;
    A(1, -43.2, YT + 0.8, ROWZ[0], L1);
    A(2, -43.2, YP - 1.6, CELLS[0].spdt);
    A(3, 14.4, YP - 1.6, CELLS[6].c5);

    /* --- 7: the 1:8 calibration tree from the side SMA, along the seam side, down beside each column. The splits are drawn
       as junctions; each is a compact Wilkinson (λ/4 arms and a 100 Ω resistor) that adds the same length to every branch. --- */
    var calNm = '1:8 calibration tree for the 5.2 GHz tone (equal branches)', cal = [];
    var XA = 13.0, XB = [-15.8, 41.8];
    t4([[CAL_SMA.x + SMA_S / 2 + 0.4, CAL_SMA.z], [-62, CAL_SMA.z], [-62, ZR], [XA, ZR], [XA, Z1]], 0.38, 7, calNm, 'cal');
    CELLS.forEach(function (e) {
      var xc = e.cx + 13, xb = XB[e.col < 2 ? 0 : 1], sz = e.spdt;
      var pts = [[XA, Z1], [xb, Z1], [xb, Z2], [xc, Z2], [xc, ZN], [e.cx + 11, ZN], [e.cx + 11, sz], [e.cx + 1, sz]];
      t4(pts, 0.38, 7, calNm, 'cal');
      cal.push(+plen(pts).toFixed(3));
    });
    if (CHK) CHK.cal = cal;
    [[XA, Z1]].concat(XB.map(function (x) { return [x, Z2]; })).concat(COLS.map(function (cx) { return [cx + 11, ZN]; }))
      .forEach(function (p) { part(1.2, 0.35, 1.2, p[0], p[1], 7, 'Wilkinson 1:2 split (λ/4 arms and 100 Ω resistor not drawn)', 'cap', null, 'cal'); });
    A(7, XA, YP - 0.6, Z1);

    /* --- 9: right-angle SMAs on the back: three on the connector edge, the calibration tone on the side --- */
    function sma(x, z, ang, k, nm) {
      var g = new T.Group(), yC = YP - SMA_S / 2;
      g.position.set(x, 0, z); g.rotation.y = ang; L4.add(g);
      mesh(kit.box(SMA_S, SMA_S, SMA_S), kit.mat('gold', k), 0, yC, 0, g, nm);
      var b = mesh(kit.cyl(3.15, 8, 28), kit.mat('gold', k), 0, yC, -7.2, g, nm); b.rotation.x = Math.PI / 2;
      var hx = mesh(kit.cyl(4.0, 2.2, 6), kit.mat('gold', k), 0, yC, -4.4, g, nm); hx.rotation.x = Math.PI / 2;
      var d = mesh(kit.cyl(2.05, 0.4, 20), kit.mat('ptfe', k), 0, yC, -11.2, g, nm); d.rotation.x = Math.PI / 2;
    }
    EDGE_SMA.forEach(function (s, i) {
      var nm = 'SMA, ' + s.name + ' (from the master board)';
      sma(s.x, SMA_Z, 0, 9, nm);
      chkPart('back', 'sma' + i, nm, s.x, SMA_Z, SMA_S, SMA_S);
    });
    var calSmaNm = 'SMA, 5.2 GHz calibration tone in (from the master board)';
    sma(CAL_SMA.x, CAL_SMA.z, Math.PI / 2, 9, calSmaNm);
    chkPart('back', 'smaCal', calSmaNm, CAL_SMA.x, CAL_SMA.z, SMA_S, SMA_S);
    A(9, -54, YP - 8, -57);

    /* --- 4: the bundles from every C5 down to the hub on L4: 3.3 V, both clocks, PARLIO 2 bits, control --- */
    var zIn = SMA_Z + SMA_S / 2 + 0.4, left = [], right = [], ROW_V = -14.0;
    var ROLES = [[2.0, 'p33'], [1.2, 'c48'], [0.4, 'cP'], [-0.4, 'b0'], [-1.2, 'b1'], [-2.0, 'ctl']];
    var bundles = CELLS.map(function (e) {
      var top = e.c5 - 3;
      var path = e.row === 0 ? [[e.cx, top], [e.cx, top - 2.8], [e.cx - 10, top - 2.8], [e.cx - 10, TURN]] : [[e.cx, top], [e.cx, TURN]];
      return { e: e, x: e.row === 0 ? e.cx - 10 : e.cx, lines: ROLES.map(function (r) { return { role: r[1], pts: offsetLine(path, r[0]) }; }) };
    }).sort(function (a, b) { return a.x - b.x; });
    bundles.forEach(function (b) {
      b.lines.forEach(function (ln) {
        var last = ln.pts[ln.pts.length - 1];
        if (ln.role === 'p33') { last[1] = ROW_V; b.x33 = last[0]; }
        else if (ln.role === 'c48') { last[1] = ROW_A; b.x48 = last[0]; }
        else if (ln.role === 'cP') { last[1] = ROW_B; b.xP = last[0]; }
        else (b.x < S31[0] ? left : right).push({ ln: ln, x: last[0] });
      });
    });
    function entries(list, sx, desc) {
      list.sort(function (p, q) { return desc ? q.x - p.x : p.x - q.x; });
      /* nested L-shapes: each line runs straight down to its own entry height, then across to the pin */
      list.forEach(function (d, i) { var ez = S31[1] + 3.4 - i * 0.55; d.ln.pts[d.ln.pts.length - 1][1] = ez; d.ln.pts.push([sx, ez]); });
    }
    entries(left, S31[0] - 4.45, true);
    entries(right, S31[0] + 4.45, false);
    var LAB = { p33: '3.3 V to C5 #', c48: '48 MHz to C5 #', cP: '40 MHz PCLK to C5 #', ctl: 'Control (READY, arm, UART) for C5 #' };
    bundles.forEach(function (b) {
      var n = b.e.n;
      b.lines.forEach(function (ln) {
        var lab = LAB[ln.role] ? LAB[ln.role] + n : 'PARLIO lane ' + n + ', bit ' + (ln.role === 'b0' ? 0 : 1);
        if (ln.role === 'c48' || ln.role === 'cP') lab += ' (drops to L3 here)';
        if (ln.role === 'p33') lab += ' (from the L3 spine)';
        t4(ln.pts, ln.role === 'p33' ? 0.5 : 0.22, ln.role === 'c48' || ln.role === 'cP' ? 8 : 4, lab, ln.role + n);
      });
      via(b.x48, ROW_A, 8, 'c48' + n, true); via(b.xP, ROW_B, 8, 'cP' + n, true); via(b.x33, ROW_V, 4, 'p33' + n, true);
    });
    A(4, CELLS[1].cx - 10, YP - 0.4, 5);

    /* --- 8: clock buffers on the back; point-to-point lines on L3 (48 MHz band above, PCLK band below), staggered fan-out vias --- */
    part(BUF48[2], 1, BUF48[3], BUF48[0], BUF48[1], 8, '48 MHz 1:8 clock buffer: one line to each C5 XTAL_P');
    part(BUFP[2], 1, BUFP[3], BUFP[0], BUFP[1], 8, '40 MHz 1:10 PCLK buffer (9 used), enabled by the S31: 8 × C5 PARLIO TX + S31 RX');
    var b48x = BUF48[0] + BUF48[2] / 2, bPx = BUFP[0] - BUFP[2] / 2;
    bundles.forEach(function (b, i) {
      var n = b.e.n, zA = ROW_A - 1 - i * TRK, zB = ROW_B - 1 - (bundles.length - 1 - i) * TRK;
      var vA = b48x + 0.6 + (i % 2) * 0.9, vB = bPx - 0.6 - (i % 2) * 0.9;
      t4([[b48x, zA], [vA, zA]], 0.2, 8, '48 MHz to C5 #' + n, 'c48' + n);
      via(vA, zA, 8, 'c48' + n, true);
      t3([[vA, zA], [b.x48, zA], [b.x48, ROW_A]], 0.2, 8, '48 MHz to C5 #' + n + ' (L3)', 'c48' + n);
      t4([[bPx, zB], [vB, zB]], 0.2, 8, '40 MHz PCLK to C5 #' + n, 'cP' + n);
      via(vB, zB, 8, 'cP' + n, true);
      t3([[vB, zB], [b.xP, zB], [b.xP, ROW_B]], 0.2, 8, '40 MHz PCLK to C5 #' + n + ' (L3)', 'cP' + n);
    });
    var bPbot = BUFP[1] - BUFP[3] / 2, sB = S31[1] - 4, xPs = S31[0] + 3.5;
    t4([[56.5, bPbot], [56.5, bPbot - 0.65]], 0.22, 8, '40 MHz PCLK to the S31 PARLIO RX', 'cPs');
    via(56.5, bPbot - 0.65, 8, 'cPs', true);
    t3([[56.5, bPbot - 0.65], [xPs, bPbot - 0.65], [xPs, sB - 0.6]], 0.2, 8, '40 MHz PCLK to the S31 PARLIO RX (L3)', 'cPs');
    via(xPs, sB - 0.6, 8, 'cPs', true);
    t4([[xPs, sB - 0.6], [xPs, sB]], 0.22, 8, '40 MHz PCLK to the S31 PARLIO RX', 'cPs');
    t4([[EDGE_SMA[0].x, zIn], [EDGE_SMA[0].x, -42.6], [BUF48[0], -42.6], [BUF48[0], BUF48[1] - BUF48[3] / 2]], 0.3, 8, '48 MHz in, SMA to buffer', 'in48');
    t4([[EDGE_SMA[2].x, zIn], [EDGE_SMA[2].x, -34], [58.2, -34], [58.2, bPbot]], 0.3, 8, '40 MHz PCLK in, SMA to buffer', 'inP');
    t4([[S31[0] + 4.45, S31[1] - 3.5], [54, S31[1] - 3.5], [54, bPbot]], 0.22, 8, 'PCLK enable (OE) from the S31: GO, every lane starts on one edge', 'oe');
    A(8, BUF48[0], YP - 2, BUF48[1]);

    /* --- 5: ESP32-S31, crystal, trigger, USB --- */
    var sBot = S31[1] - 4;
    part(8, 0.9, 8, S31[0], S31[1], 5, 'ESP32-S31 (QFN80, 8 × 8 mm): 16-bit PARLIO RX, DMA, Ethernet MAC', null,
      kit.printed('chip', 5, chipTex('ESP32-S31', 'QFN80'), 3));
    part(3.2, 0.8, 2.5, -12, -44.5, 5, 'Crystal for the S31', 'xtal');
    t4([[EDGE_SMA[1].x, zIn], [EDGE_SMA[1].x, -43.0], [S31[0] + 1.5, -43.0], [S31[0] + 1.5, sBot - 0.6]], 0.25, 9, 'Trigger in: the master GO, to the S31', 'trig');
    t4([[37.5, -43.4], [37.5, -42.0], [S31[0] + 2.5, -42.0], [S31[0] + 2.5, sBot - 0.6]], 0.25, 5, 'USB to the S31', 'usb');
    A(5, S31[0], YP - 2, S31[1]);

    /* --- 6: RGMII, PHY, MDI pairs, MagJack, USB-C --- */
    for (var r = 0; r < 6; r++) {
      var x0 = S31[0] - 3.7 + r * 0.55, zr = -34.0 - 0.55 * r;
      t4([[x0, sBot - 0.6], [x0, zr], [PHY[0] + 2.6, zr]], 0.2, 6, 'RGMII, S31 to PHY', 'rgmii' + r);
    }
    part(5, 0.85, 5, PHY[0], PHY[1], 6, 'Gigabit PHY (RTL8211F-class)', null, kit.printed('chip', 6, chipTex('RTL8211F', 'QFN40'), 3));
    part(3.2, 0.8, 2.5, PHY[0], -41.5, 6, '25 MHz crystal for the PHY', 'xtal');
    for (var p = 0; p < 4; p++) {
      t4([[PHY[0] - 2.6, PHY[1] - 1.2 + p * 0.8], [RJ.x + RJ.w / 2 + 0.5, PHY[1] - 2.4 + p * 1.6]], 0.2, 6, 'MDI pairs, PHY to MagJack', 'mdi' + p);
    }
    var rjFace = canvasTex(256, 216, function (c, w) {
      c.fillStyle = '#c4cad0'; c.fillRect(0, 0, w, 216);
      c.fillStyle = '#1d2024'; c.fillRect(38, 38, 180, 140);
      c.fillStyle = '#2c3036'; c.fillRect(98, 30, 60, 18);
      c.fillStyle = '#5fd37a'; c.fillRect(14, 188, 34, 18);
      c.fillStyle = '#e6c341'; c.fillRect(208, 188, 34, 18);
    });
    part(RJ.w, RJ.h, RJ.z1 - RJ.z0, RJ.x, (RJ.z0 + RJ.z1) / 2, 6, 'RJ45 MagJack (integrated magnetics): 1 GbE out', null,
      kit.printed('zinc', 6, rjFace, 5));
    A(6, RJ.x, YP - RJ.h - 1.5, (RJ.z0 + RJ.z1) / 2);
    part(8.9, 3.2, 7.4, 40, -47.3, 6, 'USB-C: S31 console and firmware', 'zinc');

    /* --- power (back): the regulators feed the 3.3 V spine on L3 --- */
    part(6.5, 1.6, 3.5, 62, -31, 0, '3.3 V regulator 1 (feeds the L3 spine)');
    part(6.5, 1.6, 3.5, 62, -36.5, 0, '3.3 V regulator 2 (feeds the L3 spine)');
    mesh(kit.cyl(3, 5.4, 24), kit.mat('elcap', 0), 69, YP - 2.7, -37, L4, 'Bulk capacitor');
    chkPart('back', 'bulk', 'Bulk capacitor', 69, -37, 6, 6);
    part(10, 8, 7.5, 60, -46, 0, '5 V input terminal', 'term');
    [-2.5, 2.5].forEach(function (dx) { mesh(kit.cyl(1.5, 0.6, 16), kit.mat('zinc', 0), 60 + dx, YP - 8.3, -46, L4, '5 V input terminal'); });

    /* --- 10: seam edge (the joint is added in the array) --- */
    A(10, 30, YT + 0.6, 49.5, L1);
    return tile;
  }

  /* ================================================================== */
  /* Master board, cables, cola can                                      */
  /* ================================================================== */
  function curveOf(pts) { return new T.CatmullRomCurve3(pts.map(function (p) { return new T.Vector3(p[0], p[1], p[2]); }), false, 'catmullrom', 0.25); }
  function tube(parent, pts, r, matKey, k, name) {
    var c = curveOf(pts);
    var m = mesh(kit.g(new T.TubeGeometry(c, Math.max(48, pts.length * 18), r, 10, false)), kit.mat(matKey, k), 0, 0, 0, parent, name);
    m.userData.cable = true;
    return c.getLength();
  }
  function buildMaster(root) {
    var g = new T.Group(), cx = -140, cz = 50, w = 70, d = 64, y0 = STAND;
    root.add(g);
    function sm(w2, h, d2, x, z, nm, mk) { mesh(kit.box(w2, h, d2), kit.mat(mk || 'chip', 11), x, y0 + 1.6 + h / 2, z, g, nm); }
    mesh(kit.box(w, 1.6, d), kit.mat('pcb', 11), cx, y0 + 0.8, cz, g, 'Master timing / RF board');
    [[-30, -27], [30, -27], [-30, 27], [30, 27]].forEach(function (p) {
      var so = mesh(kit.cyl(3.18, y0, 6), kit.mat('zinc', 0), cx + p[0], y0 / 2, cz + p[1], g, 'M3 standoff, 16 mm');
      so.rotation.y = Math.PI / 6;
    });
    sm(5, 1.5, 3.2, cx - 22, cz - 18, '48 MHz TCXO: the shared reference', 'xtal');
    sm(14, 3, 14, cx - 8, cz + 12, '5.2 GHz synthesizer (MAX2871-class) under a shield', 'zinc');
    sm(6.5, 1, 4.4, cx + 6, cz - 18, '48 MHz 1:2 fan-out');
    sm(6.5, 1, 4.4, cx + 6, cz - 8, '40 MHz PCLK source and 1:2 fan-out');
    sm(5, 0.9, 5, cx - 20, cz + 18, 'Trigger / GO controller');
    sm(7, 2.5, 7, cx + 12, cz + 14, '5.2 GHz 1:2 splitter (to tiles A and B)', 'gold');
    var zs = [-30, -22, -14, -6, 6, 14, 22, 30];
    zs.forEach(function (dz) {
      var m = mesh(kit.cyl(3.15, 8, 24), kit.mat('gold', 9), cx + w / 2 + 4, y0 + 0.8, cz + dz, g, 'Master board output SMA');
      m.rotation.z = Math.PI / 2;
    });
    var a = new T.Object3D(); a.position.set(cx - 8, y0 + 6, cz + 12); g.add(a); model.anchors[11] = a;
    return { x: cx + w / 2 + 8, y: y0 + 0.8, z: cz };
  }

  function buildCola() {
    var g = new T.Group(), nm = '330 ml can, 66 × 115 mm, for scale';
    mesh(kit.cyl(COLA_R, COLA_H - 12, 48), kit.mat('cola', 0), 0, COLA_H / 2, 0, g, nm);
    mesh(kit.cyl(COLA_R + 0.25, 30, 48), kit.mat('colaband', 0), 0, COLA_H * 0.56, 0, g, nm);
    mesh(kit.g(new T.CylinderGeometry(COLA_R - 6, COLA_R, 6, 48)), kit.mat('zinc', 0), 0, COLA_H - 3, 0, g, nm);
    mesh(kit.g(new T.CylinderGeometry(COLA_R, COLA_R - 6, 6, 48)), kit.mat('zinc', 0), 0, 3, 0, g, nm);
    return g;
  }

  /* ================================================================== */
  /* Model                                                               */
  /* ================================================================== */
  function buildArrayExtras(root) {
    var yS = STAND + YP - SMA_S / 2, yR = STAND + YP - RJ.h / 2, yb = STAND + YP - 0.06;
    mesh(kit.box(BW, 0.04, 0.15), kit.mat('seam', 10), 0, STAND + YT + 0.02, BD / 2, root, 'Seam: the two boards butt together');
    mesh(kit.box(BW - 12, 0.12, 7), kit.mat('copper', 10), 0, yb, BD / 2, root, 'Continuous ground joint across the seam (back), stitched to L2 every 3 mm');
    for (var x = -66; x <= 66.01; x += 3) {
      [BD / 2 - 2, BD / 2 + 2].forEach(function (z) {
        mesh(kit.cyl(0.3, 0.03, 8), kit.mat('zinc', 10), x, yb - 0.075, z, root, 'Ground stitching via (through)');
        mesh(kit.cyl(0.3, 0.015, 8), kit.mat('tent', 10), x, STAND + YT + 0.008, z, root, 'Tented ground-via pad (no signal reaches the front)');
      });
    }
    var M = buildMaster(root);
    /* Connector-edge coax: tile A lanes at z = -70 - 4j, tile B lanes at BD + 70 + 4j; the lane order keeps them apart. */
    var A = [{ s: EDGE_SMA[0], j: 0, out: 36 }, { s: EDGE_SMA[1], j: 1, out: 28 }, { s: EDGE_SMA[2], j: 2, out: 20 }];
    A.forEach(function (c) {
      var lz = -70 - 4 * c.j, vx = -84 - 3 * c.j, x = c.s.x;
      tube(root, [[M.x, M.y, c.out], [vx, yS + 2, c.out], [vx, yS + 2, lz], [x, yS + 2, lz], [x, yS, -59.5]], 1.3, 'coax', 9,
        'Coax: ' + c.s.name.replace(' in', '') + ' to tile A');
    });
    var B = [{ s: EDGE_SMA[2], j: 0, out: 64 }, { s: EDGE_SMA[1], j: 1, out: 72 }, { s: EDGE_SMA[0], j: 2, out: 80 }];
    B.forEach(function (c) {
      var lz = BD + 70 + 4 * c.j, vx = -84 - 3 * c.j, x = -c.s.x;
      tube(root, [[M.x, M.y, c.out], [vx, yS + 2, c.out], [vx, yS + 2, lz], [x, yS + 2, lz], [x, yS, BD + 59.5]], 1.3, 'coax', 9,
        'Coax: ' + c.s.name.replace(' in', '') + ' to tile B');
    });
    /* Calibration pair, phase-matched: tile B's runs under the boards to its side SMA; tile A's gets a service coil
       of the same extra length. */
    var zCB = BD - CAL_SMA.z, xCB = -CAL_SMA.x;
    var calB = [[M.x, M.y, 56], [-90, 10, 57], [-78, 3, 58], [-66, 2.2, 59], [60, 2.2, zCB], [xCB + 18, 6, zCB], [xCB + 17, yS, zCB], [xCB + 12.4, yS, zCB]];
    var lenB = curveOf(calB).getLength(), lo = -50, hi = 70, calA = null;
    function calAPath(xt) {
      return [[M.x, M.y, 44], [-90, 10, 43], [-78, 3, 42], [-66, 2.2, 42], [xt, 2.2, 42], [xt + 4, 2.2, 45], [xt, 2.2, 48],
              [-66, 2.2, 48], [-80, 5, 47], [-88, 9, 44], [-89, yS, CAL_SMA.z], [CAL_SMA.x - 12.2, yS, CAL_SMA.z]];
    }
    for (var it = 0; it < 40; it++) {   // bisection on the turn-around point: the out-and-back run grows with it
      var mid = (lo + hi) / 2;
      if (curveOf(calAPath(mid)).getLength() < lenB) lo = mid; else hi = mid;
    }
    calA = calAPath((lo + hi) / 2);
    var la = tube(root, calA, 1.3, 'coax', 9, 'Coax: 5.2 GHz calibration tone to tile A (phase-matched pair: out and back under the board)');
    var lb = tube(root, calB, 1.3, 'coax', 9, 'Coax: 5.2 GHz calibration tone to tile B (phase-matched pair, under the boards)');
    model.calCables = [+la.toFixed(1), +lb.toFixed(1)];
    tube(root, [[RJ.x, yR, RJ.z0 - 1], [RJ.x, yR - 2, RJ.z0 - 12], [RJ.x - 4, 3, RJ.z0 - 30], [RJ.x - 6, 2.8, RJ.z0 - 42]], 2.8, 'cable', 6, 'Ethernet, tile A: 1 GbE to the host');
    tube(root, [[-RJ.x, yR, BD - RJ.z0 + 1], [-RJ.x, yR - 2, BD - RJ.z0 + 12], [-RJ.x + 4, 3, BD - RJ.z0 + 30], [-RJ.x + 6, 2.8, BD - RJ.z0 + 42]], 2.8, 'cable', 6, 'Ethernet, tile B: 1 GbE to the host');
  }

  function build() {
    model = { root: new T.Group(), anchors: {}, tiles: [] };
    var arr = st.mode === 'array';
    CHK = wantCheck ? { segs: [], parts: [], rf: [], cal: [] } : null;
    var A = buildTile(model.root, arr ? 'TILE A' : 'TILE', true);
    if (CHK) { model.check = runCheck(CHK); CHK = null; }
    model.tiles.push(A);
    var center = new T.Vector3(0, 0, 0), foot = [BW, BD];
    if (arr) {
      var B = buildTile(model.root, 'TILE B', false);
      B.rotation.y = Math.PI;      // antenna blocks meet at the seam
      B.position.z = BD;
      model.tiles.push(B);
      buildArrayExtras(model.root);
      if (model.check) {
        model.check.calCables = model.calCables;
        model.check.ok = model.check.ok && Math.abs(model.calCables[0] - model.calCables[1]) < 0.1;
      }
      center.set(-35, 0, 50); foot = [BW + 175, 2 * BD + 100];
    }
    /* dimension shown in the Seam view: row centre to the edge, or row to row across the seam */
    var dz1 = arr ? ROWZ[0] + 28.8 : BD / 2, yD = STAND + YT + 0.4, xD = -14.4;
    var g = kit.g(new T.BufferGeometry().setFromPoints([
      new T.Vector3(xD, yD, ROWZ[0]), new T.Vector3(xD, yD, dz1),
      new T.Vector3(xD - 3, yD, ROWZ[0]), new T.Vector3(xD + 3, yD, ROWZ[0]),
      new T.Vector3(xD - 3, yD, dz1), new T.Vector3(xD + 3, yD, dz1)]));
    var lm = new T.LineBasicMaterial({ color: lin('#a94d1c'), depthTest: false, transparent: true });
    kit.mats.push(lm);
    var dim = new T.LineSegments(g, lm);
    dim.renderOrder = 10; dim.userData.noPick = true; dim.visible = false;
    model.root.add(dim);
    model.dim = { obj: dim, mid: new T.Vector3(xD, yD, (ROWZ[0] + dz1) / 2), text: arr ? '28.8 mm, row to row' : '14.4 mm to the edge' };
    var cola = buildCola();
    cola.position.set(122, 0, arr ? -30 : -8);
    cola.visible = st.cola;
    model.root.add(cola);
    model.cola = cola;
    model.center = center;
    model.foot = foot;
    return model;
  }

  function applyExplode(e) {
    explodeE = e;
    if (!model) return;
    model.tiles.forEach(function (tile) {
      var grp = tile.userData.layers;
      LAYERS.forEach(function (L) { grp[L.id].position.y = e * L.lift; });
      var top = YT + e * LAYERS[6].lift;
      tile.userData.barrels.forEach(function (b) { b.scale.y = top - YP; b.position.y = (top + YP) / 2; });
      tile.userData.standoffs.forEach(function (s) { s.visible = e < 0.05; });
    });
    kit.mats.forEach(function (m) {
      var x = m.userData.xray;
      if (!x) return;
      var o = 1 - x * e, tr = o < 0.995;
      if (m.transparent !== tr) { m.transparent = tr; m.depthWrite = !tr; m.needsUpdate = true; }
      m.opacity = o;
    });
    invalidate();
  }
  function setExploded(on, animate) {
    if (st.mode !== 'tile') on = false;
    st.exploded = on;
    expBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    var from = explodeT, to = on ? 1 : 0;
    if (loadState !== 'ready') { explodeT = to; describe(); return; }
    var h = heading();
    applyExplode(ease(to)); computeFit(st.cam); applyExplode(ease(from));
    var dest = { theta: h.theta, phi: h.phi, fov: fit.fov, r: fit.r * h.rel, target: fit.target.clone() };
    if (!animate || reduced()) { explodeT = to; applyExplode(ease(to)); tweenCam(dest, false); }
    else {
      addTween('explode', EXPLODE_MS * Math.abs(to - from), function (p) { explodeT = from + (to - from) * p; applyExplode(ease(explodeT)); });
      tweenCam(dest, true, EXPLODE_MS * Math.max(0.3, Math.abs(to - from)));
    }
    describe();
    announce(on ? 'Layers lifted apart' : 'Layers back together');
  }

  /* ================================================================== */
  /* Scene                                                               */
  /* ================================================================== */
  function buildEnv() {
    try {
      var pm = new T.PMREMGenerator(renderer), env = new T.Scene();
      var room = new T.Mesh(new T.BoxGeometry(10, 6, 10), new T.MeshBasicMaterial({ color: 0x8a9096, side: T.BackSide }));
      room.position.y = 2; env.add(room);
      var panel = function (w, h, x, y, z, rx, ry, k) {
        var m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide }));
        m.material.color.setScalar(k); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); env.add(m); return m;
      };
      panel(6, 4, 0, 4.9, 0, Math.PI / 2, 0, 2.2);
      panel(3, 3, -4.9, 2.2, 1, 0, Math.PI / 2, 1.4);
      panel(3, 3, 4.9, 2.6, -1, 0, -Math.PI / 2, 0.55);
      panel(4, 2.5, 0, 2.2, 4.9, 0, Math.PI, 1.6);
      panel(4, 2.5, 0, 2.2, -4.9, 0, 0, 1.2);
      var floor = panel(10, 10, 0, -0.95, 0, -Math.PI / 2, 0, 0.6);
      floor.material.color.set(0x7b8188);
      var rt = pm.fromScene(env, 0.035);
      env.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      pm.dispose();
      return rt.texture;
    } catch (e) { return null; }
  }
  function makeShadow() {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.42)'); g.addColorStop(0.5, 'rgba(255,255,255,0.24)'); g.addColorStop(0.8, 'rgba(255,255,255,0.07)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    var m = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), color: lin(TOK.shade), transparent: true, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.renderOrder = -1; m.userData.noPick = true;
    return m;
  }

  function start() {
    T = window.THREE;
    readTokens();
    try {
      if (!window.WebGLRenderingContext) { fail('webgl'); return; }
      canvas = document.createElement('canvas');
      renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, preserveDrawingBuffer: !!(testParam || shot) });
      if (!renderer.getContext()) throw new Error('no context');
    } catch (e) { renderer = null; fail('webgl'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.setClearColor(new T.Color(TOK.zone), 1);
    v3a = new T.Vector3(); v3b = new T.Vector3(); v3c = new T.Vector3();
    rayc = new T.Raycaster(); ndc = new T.Vector2();
    orbit.target = new T.Vector3(); fit.target = new T.Vector3();
    scene = new T.Scene();
    envTex = buildEnv();
    if (envTex) scene.environment = envTex;
    scene.add(new T.HemisphereLight(0xffffff, 0xb4bcc4, envTex ? 0.6 : 1.0));
    var key = new T.DirectionalLight(0xffffff, envTex ? 1.0 : 1.8); key.position.set(-0.35, 1, -0.75); scene.add(key);
    var fill = new T.DirectionalLight(0xffffff, 0.35); fill.position.set(0.8, 0.4, 0.6); scene.add(fill);
    var under = new T.DirectionalLight(0xffffff, 0.75); under.position.set(-0.4, -1, -0.5); scene.add(under);
    camera = new T.PerspectiveCamera(32, 1.6, 1, 20000);
    shadowMesh = makeShadow(); scene.add(shadowMesh);
    world = new T.Group(); scene.add(world);

    canvas.className = 'm3-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-describedby', 'm3-hint');
    stage.insertBefore(canvas, stage.firstChild);
    labelsEl = document.createElement('div'); labelsEl.className = 'm3-labels'; stage.appendChild(labelsEl);
    tipEl = document.createElement('div'); tipEl.className = 'm3-tip'; tipEl.hidden = true; tipEl.setAttribute('aria-hidden', 'true'); stage.appendChild(tipEl);
    whintEl = document.createElement('div'); whintEl.className = 'm3-whint'; whintEl.hidden = true; whintEl.setAttribute('aria-hidden', 'true'); stage.appendChild(whintEl);
    makeLabels();
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      lost = true;
      clearTimeout(lostTimer);
      lostTimer = setTimeout(function () { if (lost) fail('lost'); }, 5000);
    });
    canvas.addEventListener('webglcontextrestored', function () {
      lost = false;
      clearTimeout(lostTimer);
      if (loadState !== 'ready') return;
      renderer.setClearColor(new T.Color(TOK.zone), 1);
      envTex = buildEnv();
      scene.environment = envTex;
      var keep = { theta: orbit.theta, phi: orbit.phi, r: orbit.r, fov: orbit.fov, target: orbit.target.clone() };
      rebuild(true);
      stopCam();
      orbit.theta = keep.theta; orbit.phi = keep.phi; orbit.r = keep.r; orbit.fov = keep.fov; orbit.target.copy(keep.target);
      invalidate();
    });

    loadState = 'ready';
    stage.setAttribute('data-m3-state', 'ready');
    ph.hidden = true; ctlRow.hidden = false; camRow.hidden = false; hint.hidden = false; cap.hidden = false;
    modx.hidden = st.mode !== 'tile';
    legendEnabled(true);
    loadBtn.removeAttribute('aria-disabled');
    var coarse = false;
    try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) { coarse = false; }
    if (coarse) hint.textContent = 'Drag sideways to turn, pinch to zoom and pan, double-tap to reset. Tap a part or a number to highlight it.';
    resize();
    bindInput();
    rebuild(true);
    if (btnHadFocus) { try { canvas.focus({ preventScroll: true }); } catch (e) { canvas.focus(); } }
    btnHadFocus = false;
    var rzRaf = 0;
    var onResize = function () { if (rzRaf) return; rzRaf = requestAnimationFrame(function () { rzRaf = 0; resize(true); invalidate(); }); };
    if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(stage); else window.addEventListener('resize', onResize);
    watchDpr(onResize);
  }
  function watchDpr(cb) {
    try {
      var mq = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
      var h = function () { mq.removeEventListener('change', h); cb(); watchDpr(cb); };
      mq.addEventListener('change', h);
    } catch (e) { /* old browser */ }
  }

  function resize(refit) {
    if (!renderer) return;
    var pr = Math.min(window.devicePixelRatio || 1, 2);
    if (pr !== renderer.getPixelRatio()) renderer.setPixelRatio(pr);
    var w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight), old = camera.aspect;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (refit && model && Math.abs(camera.aspect - old) / old > 0.02) {
      var rel = heading().rel;
      fitFinal(st.cam);
      if (camDest) { camDest.fitR = fit.r; camDest.r = fit.r * rel; }
      orbit.r = fit.r * rel;
    }
  }

  function rebuild(refit) {
    if (loadState !== 'ready') return;
    if (model) world.remove(model.root);
    if (kit) kit.dispose();
    kit = new Kit(); model = null; hlK = null;
    build();
    world.add(model.root);
    shadowMesh.scale.set(model.foot[0] * 1.35, model.foot[1] * 1.35, 1);
    shadowMesh.position.set(model.center.x, 0.02, model.center.z);
    applyExplode(ease(explodeT));
    var n = 0; scene.traverse(function (o) { if (o.isMesh) n++; });
    stage.setAttribute('data-m3-meshes', String(n));
    if (model.check) {
      stage.setAttribute('data-m3-check', JSON.stringify(model.check));
      try { console.info('tile3d check', model.check); } catch (e) { /* no console */ }
    }
    refreshHL(true);
    setCam(st.cam, !refit);
    describe();
  }

  /* ================================================================== */
  /* Camera                                                              */
  /* ================================================================== */
  function visibleDeep(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }
  function orient(cam, tgt, theta, phi, r, fov) {
    var sp = Math.sin(phi);
    cam.fov = fov;
    cam.position.set(tgt.x + r * sp * Math.sin(theta), tgt.y + r * Math.cos(phi), tgt.z + r * sp * Math.cos(theta));
    cam.up.set(0, 1, 0);
    if (phi < 0.03) cam.up.set(-Math.sin(theta), 0, -Math.cos(theta));
    if (phi > Math.PI - 0.03) cam.up.set(Math.sin(theta), 0, Math.cos(theta));
    cam.lookAt(tgt);
    cam.near = Math.max(0.5, r * 0.02);
    cam.far = r * 12 + 3000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
  /* Fit the visible model for a camera direction: start from the bounding sphere, then centre and scale on the
     projected corners of every part's box. Cables are left out so the Ethernet tails do not shrink the view. */
  function computeFit(name) {
    var dir = CAM_DIR[name] || CAM_DIR.back, pts = [], bb = new T.Box3(), all = new T.Box3();
    fit.theta = dir[0] * DEG;
    fit.phi = (90 - dir[1]) * DEG;
    fit.fov = dir[2];
    model.root.updateMatrixWorld(true);
    model.root.traverse(function (o) {
      if (!o.isMesh || o.userData.noPick || o.userData.cable || !visibleDeep(o)) return;
      bb.setFromObject(o);
      all.union(bb);
      for (var i = 0; i < 8; i++) pts.push(new T.Vector3(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z));
    });
    var sph = new T.Sphere(); all.getBoundingSphere(sph);
    var tv = Math.tan(fit.fov * DEG / 2), th = tv * camera.aspect;
    var tgt = sph.center.clone(), r = sph.radius / Math.sin(Math.atan(Math.min(tv, th)));
    if (name === 'seam') {
      /* tile: look at the seam edge from beyond it; array: look along the seam from the side */
      var lift = explodeE * LAYERS[6].lift, k = 1 + 0.6 * explodeE;
      if (st.mode === 'array') { fit.theta = 70 * DEG; fit.phi = 60 * DEG; fit.target.set(-32, STAND + 1 + lift / 2, BD / 2); fit.r = r * 0.34 * k; }
      else { fit.target.set(-30, STAND + 1 + lift / 2, 38); fit.r = r * 0.5 * k; }
      return;
    }
    var right = new T.Vector3(), up = new T.Vector3(), v = new T.Vector3();
    for (var it = 0; it < 5; it++) {
      orient(camera, tgt, fit.theta, fit.phi, r, fit.fov);
      var inv = camera.matrixWorldInverse, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (var i = 0; i < pts.length; i++) {
        v.copy(pts[i]).applyMatrix4(inv);
        var zc = Math.max(-v.z, r * 0.05), px = v.x / (zc * th), py = v.y / (zc * tv);
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      }
      right.setFromMatrixColumn(camera.matrixWorld, 0); up.setFromMatrixColumn(camera.matrixWorld, 1);
      tgt.addScaledVector(right, (x0 + x1) / 2 * r * th).addScaledVector(up, (y0 + y1) / 2 * r * tv);
      r *= clamp(Math.max((x1 - x0) / 2 / 0.86, (y1 - y0) / 2 / 0.8), 0.5, 2);
    }
    fit.r = r;
    fit.target.copy(tgt);
  }
  function setCam(name, animate) {
    if (CAMS.indexOf(name) < 0) name = 'back';
    var changed = name !== st.cam;
    st.cam = name;
    if (setCamSeg) setCamSeg(name);
    if (!model) return;
    fitFinal(name);
    tweenCam({ theta: fit.theta, phi: fit.phi, fov: fit.fov, r: fit.r, target: fit.target.clone() }, animate);
    describe();
    if (changed) announce(CAM_WORD[name] + ' view');
  }
  function tweenCam(to, animate, ms) {
    tweens = tweens.filter(function (t) { return t.kind !== 'cam'; });
    camDest = null;
    if (!animate || reduced()) {
      orbit.theta = to.theta; orbit.phi = to.phi; orbit.r = to.r; orbit.fov = to.fov; orbit.target.copy(to.target);
      invalidate(); return;
    }
    camDest = { theta: to.theta, phi: to.phi, fov: to.fov, r: to.r, fitR: fit.r };
    var from = { theta: orbit.theta, phi: orbit.phi, r: orbit.r, fov: orbit.fov, target: orbit.target.clone() };
    var dt = Math.atan2(Math.sin(to.theta - from.theta), Math.cos(to.theta - from.theta));
    /* blend fov and distance together so the apparent size stays steady while the perspective changes */
    var sf = Math.tan(from.fov * DEG / 2), stt = Math.tan(to.fov * DEG / 2);
    addTween('cam', ms || CAM_MS, function (e) {
      orbit.theta = from.theta + dt * e;
      orbit.phi = from.phi + (to.phi - from.phi) * e;
      orbit.fov = from.fov + (to.fov - from.fov) * e;
      var size = from.r * sf + (to.r * stt - from.r * sf) * e;
      orbit.r = size / Math.tan(orbit.fov * DEG / 2);
      orbit.target.lerpVectors(from.target, to.target, e);
    }, function () { camDest = null; });
  }
  /* the view the user is heading to: the running tween's destination, or the current orbit */
  function heading() {
    return camDest ? { theta: camDest.theta, phi: camDest.phi, fov: camDest.fov, rel: camDest.r / camDest.fitR }
      : { theta: orbit.theta, phi: orbit.phi, fov: orbit.fov, rel: fit.r ? orbit.r / fit.r : 1 };
  }
  /* fit for a view at the explode state the model is heading to, not the one it is passing through */
  function fitFinal(name) {
    var cur = explodeE;
    applyExplode(ease(st.exploded ? 1 : 0)); computeFit(name); applyExplode(cur);
  }
  function addTween(kind, ms, fn, done) {
    tweens = tweens.filter(function (t) { return t.kind !== kind; });
    tweens.push({ kind: kind, t0: now(), ms: Math.max(1, ms), fn: fn, done: done });
    invalidate();
  }
  function stepTweens() {
    if (!tweens.length) return false;
    var t = now(), fin = [];
    tweens = tweens.filter(function (tw) {
      var p = clamp((t - tw.t0) / tw.ms, 0, 1);
      tw.fn(tw.kind === 'explode' ? p : ease(p));
      if (p >= 1) { if (tw.done) fin.push(tw.done); return false; }
      return true;
    });
    fin.forEach(function (f) { f(); });
    return tweens.length > 0;
  }
  function applyCamera() {
    orbit.phi = clamp(orbit.phi, 0.01, Math.PI - 0.01);
    var k = Math.tan(fit.fov * DEG / 2) / Math.tan(orbit.fov * DEG / 2);
    orbit.r = clamp(orbit.r, fit.r * k * 0.1, fit.r * k * 3.5);
    orient(camera, orbit.target, orbit.theta, orbit.phi, orbit.r, orbit.fov);
  }
  function stopCam() { tweens = tweens.filter(function (t) { return t.kind !== 'cam'; }); camDest = null; }
  function zoomBy(f) { stopCam(); orbit.r *= f; invalidate(); }
  function orbitBy(dt, dp) { stopCam(); orbit.theta += dt; orbit.phi += dp; invalidate(); }
  function panBy(dx, dy) {
    stopCam();
    var s = 2 * orbit.r * Math.tan(orbit.fov * DEG / 2) / (stage.clientHeight || 1);
    camera.updateMatrixWorld();
    var right = v3a.setFromMatrixColumn(camera.matrixWorld, 0), up = v3b.setFromMatrixColumn(camera.matrixWorld, 1);
    orbit.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    invalidate();
  }
  /* re-fit for a new extent but keep the user's angle and relative zoom */
  function keepView(animate) {
    var h = heading();
    fitFinal(st.cam);
    tweenCam({ theta: h.theta, phi: h.phi, fov: h.fov, r: fit.r * h.rel, target: fit.target.clone() }, animate);
  }

  /* ================================================================== */
  /* Render loop (on demand)                                             */
  /* ================================================================== */
  function invalidate() {
    dirty = true;
    if (!raf && onScreen && renderer && !lost) { raf = requestAnimationFrame(frame); rafTimer = setTimeout(frame, 120); }
  }
  function frame() {
    if (!raf) return;
    cancelAnimationFrame(raf); clearTimeout(rafTimer); raf = 0;
    if (!renderer || loadState !== 'ready' || lost) return;
    var active = stepTweens();
    applyCamera();
    if (model && model.dim) model.dim.obj.visible = st.cam === 'seam' && st.labels;
    renderer.render(scene, camera);
    dirty = false;
    placeLabels();
    if (active) invalidate();
  }

  /* ================================================================== */
  /* Labels, layer tags, legend linking                                  */
  /* ================================================================== */
  function makeLabels() {
    LAYERS.forEach(function (L) {   // tags first, so the callouts paint on top of them
      var t = document.createElement('div');
      t.className = 'm3-tag';
      var b = document.createElement('b'); b.textContent = L.tag;
      var s = document.createElement('span'); s.className = 'm3-tl'; s.textContent = L.tl;
      t.appendChild(b); t.appendChild(s);
      t.hidden = true; t.setAttribute('aria-hidden', 'true');
      labelsEl.appendChild(t);
      layerTags.push(t);
    });
    dimEl = document.createElement('div'); dimEl.className = 'm3-tag m3-dim'; dimEl.hidden = true; dimEl.setAttribute('aria-hidden', 'true');
    labelsEl.appendChild(dimEl);
    for (var k = 1; k <= NK; k++) {
      (function (kk) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'm3-lb'; b.textContent = String(kk);
        b.setAttribute('aria-label', 'Callout ' + kk + ': ' + NAMES[kk]);
        b.setAttribute('aria-pressed', 'false');
        b.hidden = true;
        b.addEventListener('click', function () { pin(kk, true); });
        b.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') hover(kk); });
        b.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hover(null); });
        b.addEventListener('focus', function () { var fv = true; try { fv = b.matches(':focus-visible'); } catch (e) { fv = true; } if (fv) hover(kk); });
        b.addEventListener('blur', function () { hover(null); });
        b.addEventListener('keydown', function (e) { if (e.key === 'Escape') clearHL(); });
        labelsEl.appendChild(b);
        labelBtns[kk] = b;
      })(k);
    }
  }
  function isClear(o) { var m = Array.isArray(o.material) ? o.material[0] : o.material; return m.transparent && m.opacity < 0.9; }
  function pickables(forOcc) {
    var out = [];
    if (!model) return out;
    model.root.traverse(function (o) {
      if (!o.isMesh || o.userData.noPick || !visibleDeep(o) || isClear(o)) return;
      if (forOcc && (o.userData.trace || o.userData.cable)) return;
      out.push(o);
    });
    return out;
  }
  function project(v) { v3c.copy(v).project(camera); return { x: (v3c.x + 1) / 2 * stage.clientWidth, y: (1 - v3c.y) / 2 * stage.clientHeight, z: v3c.z }; }
  function placeLabels() {
    var w = stage.clientWidth, h = stage.clientHeight, show = st.labels && !!model;
    var t = now(), doOcc = t - lastOcc > 90;
    if (doOcc) lastOcc = t;
    else { clearTimeout(occTimer); occTimer = setTimeout(function () { lastOcc = 0; invalidate(); }, 140); }
    var pick = doOcc && show ? pickables(true) : null;
    var placed = [];
    for (var k = 1; k <= NK; k++) {
      var b = labelBtns[k], a = show ? model.anchors[k] : null;
      if (!a || !visibleDeep(a)) { b.hidden = true; continue; }
      a.getWorldPosition(v3a);
      v3b.copy(v3a).applyMatrix4(camera.matrixWorldInverse);
      if (v3b.z > -camera.near) { b.hidden = true; continue; }
      var p = project(v3a);
      if (p.x < 8 || p.y < 8 || p.x > w - 8 || p.y > h - 8) { b.hidden = true; continue; }
      if (pick) {
        var dist = v3a.distanceTo(camera.position);
        rayc.set(camera.position, v3b.copy(v3a).sub(camera.position).normalize());
        rayc.near = 0; rayc.far = dist - 0.3;
        b.m3occ = rayc.intersectObjects(pick, false).length > 0;
      }
      b.classList.toggle('m3-occ', !!b.m3occ);
      b.hidden = false;
      placed.push({ b: b, x: p.x, y: p.y });
    }
    for (var pass = 0; pass < 3; pass++) {
      for (var i = 1; i < placed.length; i++) {
        for (var j = 0; j < i; j++) {
          var P = placed[i], Q = placed[j], dx = P.x - Q.x, dy = P.y - Q.y, d = Math.sqrt(dx * dx + dy * dy);
          if (d < 28) { if (d < 0.5) { dx = 0; dy = -1; d = 1; } P.x = Q.x + dx / d * 30; P.y = Q.y + dy / d * 30; }
        }
        placed[i].x = clamp(placed[i].x, 12, w - 12); placed[i].y = clamp(placed[i].y, 12, h - 12);
      }
    }
    placed.forEach(function (p) { p.b.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px)'; });
    /* the seam dimension */
    var showDim = show && st.cam === 'seam' && !!model.dim;
    dimEl.hidden = !showDim;
    if (showDim) {
      var dp = project(model.dim.mid);
      dimEl.textContent = model.dim.text;
      dimEl.style.transform = 'translate(' + clamp(dp.x + 10, 4, w - (dimEl.offsetWidth || 120) - 4).toFixed(1) + 'px,' + clamp(dp.y, 12, h - 12).toFixed(1) + 'px)';
    }
    /* layer tags while exploded: at the board corner furthest to the right on screen, top layer first */
    var showTags = show && st.mode === 'tile' && explodeE > 0.6;
    layerTags.forEach(function (tg) { if (!showTags) tg.hidden = true; });
    if (!showTags) return;
    var best = null, bx = -1e9;
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(function (c) {
      v3a.set(c[0] * BW / 2, STAND, c[1] * BD / 2);
      var p = project(v3a);
      if (p.x > bx) { bx = p.x; best = c; }
    });
    var ys = LAYERS.map(function (L) {
      v3a.set(best[0] * BW / 2, STAND + L.y + L.t / 2 + explodeE * L.lift, best[1] * BD / 2);
      var p = project(v3a); p.x += 12; return p;
    });
    var order = LAYERS.map(function (L, i) { return i; }).sort(function (a, b) { return ys[a].y - ys[b].y; });
    var prevY = -1e9;
    order.forEach(function (i) {
      var tg = layerTags[i], p = ys[i];
      if (p.z > 1) { tg.hidden = true; return; }
      var y = Math.max(p.y, prevY + 22);
      prevY = y;
      tg.hidden = false;
      var tw = tg.offsetWidth || 120;
      tg.style.transform = 'translate(' + clamp(p.x, 4, w - tw - 4).toFixed(1) + 'px,' + clamp(y, 12, h - 12).toFixed(1) + 'px)';
    });
  }

  function hover(k) { hoverK = k ? String(k) : null; refreshHL(); }
  function clearHL() { hoverK = null; if (pinK) pin(pinK, true); else refreshHL(); }
  function pin(k, say) {
    k = String(k); pinK = pinK === k ? null : k; refreshHL();
    if (say) announce(pinK ? 'Highlighted ' + pinK + ': ' + NAMES[pinK] + (ARRAY_ONLY[pinK] && st.mode !== 'array' ? ' (shown in Array)' : '') : 'Highlight cleared');
  }
  function refreshHL(force) {
    var k = hoverK || pinK;
    for (var i = 1; i <= NK; i++) {
      var b = labelBtns[i];
      if (!b) continue;
      b.classList.toggle('m3-on', String(i) === k);
      b.setAttribute('aria-pressed', String(i) === pinK ? 'true' : 'false');
    }
    legendItems().forEach(function (li) {
      var on = li.getAttribute('data-k') === k, pinned = li.getAttribute('data-k') === pinK, lb = li.querySelector('button');
      li.classList.toggle('is-hl', on);
      li.classList.toggle('is-pin', pinned);
      if (lb) lb.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    });
    describe();
    if (k === hlK && !force) return;
    hlK = k;
    if (!kit) return;
    var tint = lin(TOK.rf), black = new T.Color(0);
    kit.mats.forEach(function (m) {
      if (!m.emissive) return;
      var on = !!k && String(m.userData.k) === k;
      m.emissive.copy(on ? tint : black);
      m.emissiveIntensity = on ? 0.55 : 1;
    });
    invalidate();
  }

  /* ================================================================== */
  /* Input                                                               */
  /* ================================================================== */
  function pickAt(cx, cy) {
    var r = canvas.getBoundingClientRect();
    ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    rayc.near = 0; rayc.far = Infinity;
    rayc.setFromCamera(ndc, camera);
    var hit = rayc.intersectObjects(pickables(false), false)[0];
    if (!hit) return null;
    var o = hit.object, m = Array.isArray(o.material) ? o.material[0] : o.material;
    return { name: o.userData.name || '', k: m && m.userData.k ? String(m.userData.k) : null };
  }
  function showTip(text, x, y) {
    if (!text) { tipEl.hidden = true; return; }
    tipEl.textContent = text; tipEl.hidden = false;
    var w = stage.clientWidth, tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    var px = clamp(x + 14, 4, w - tw - 4), py = y + 18;
    if (py + th > stage.clientHeight - 4) py = y - th - 12;
    tipEl.style.transform = 'translate(' + px + 'px,' + py + 'px)';
  }
  function showWheelHint() {
    var mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    whintEl.textContent = 'Hold ' + (mac ? '⌘' : 'Ctrl') + ' and scroll to zoom, or click the view first.';
    whintEl.hidden = false;
    clearTimeout(whintTimer);
    whintTimer = setTimeout(function () { whintEl.hidden = true; }, 1600);
  }
  function resetView() { setCam(st.cam, true); }

  function bindInput() {
    var ptrs = {}, moved = false, downX = 0, downY = 0, pinch = 0, mid = null, hoverRaf = 0, hoverPt = null;
    function count() { return Object.keys(ptrs).length; }
    function pair() {
      var ids = Object.keys(ptrs), a = ptrs[ids[0]], b = ptrs[ids[1]];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('pointerdown', function (e) {
      engaged = true;
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY, btn: e.button, type: e.pointerType };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (count() === 1) { moved = false; downX = e.clientX; downY = e.clientY; }
      if (count() === 2) { var p = pair(); pinch = p.d; mid = p; moved = true; }
      canvas.classList.add('m3-drag');
      showTip('');
    });
    canvas.addEventListener('pointermove', function (e) {
      var p0 = ptrs[e.pointerId];
      if (!p0) {
        if (e.pointerType !== 'mouse') return;
        hoverPt = [e.clientX, e.clientY];
        if (!hoverRaf) hoverRaf = requestAnimationFrame(function () {
          hoverRaf = 0;
          if (!hoverPt) return;
          var r = canvas.getBoundingClientRect(), hit = pickAt(hoverPt[0], hoverPt[1]);
          showTip(hit ? hit.name : '', hoverPt[0] - r.left, hoverPt[1] - r.top);
        });
        return;
      }
      var dx = e.clientX - p0.x, dy = e.clientY - p0.y;
      p0.x = e.clientX; p0.y = e.clientY;
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) moved = true;
      if (count() === 2) {
        var p = pair();
        if (pinch > 0) zoomBy(pinch / Math.max(1, p.d));
        if (mid) panBy(p.x - mid.x, p.y - mid.y);
        pinch = p.d; mid = p;
        return;
      }
      if (p0.btn === 2 || e.shiftKey) panBy(dx, dy);
      else if (p0.type === 'touch') orbitBy(-dx * 0.008, 0);     // vertical swipes belong to the page (touch-action: pan-y)
      else orbitBy(-dx * 0.008, -dy * 0.008);
    });
    function end(e) {
      if (!ptrs[e.pointerId]) return;
      delete ptrs[e.pointerId];
      if (count() < 2) { pinch = 0; mid = null; }
      if (count()) return;
      canvas.classList.remove('m3-drag');
      if (e.type === 'pointerup' && !moved && (e.pointerType !== 'mouse' || e.button === 0)) {
        var hit = pickAt(e.clientX, e.clientY);
        if (hit && hit.k) pin(hit.k, true);
      }
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', function () { hoverPt = null; showTip(''); });
    canvas.addEventListener('dblclick', function (e) { e.preventDefault(); resetView(); });
    stage.addEventListener('wheel', function (e) {
      if (loadState !== 'ready') return;
      if (!(e.ctrlKey || e.metaKey) && !engaged) { showWheelHint(); return; }
      e.preventDefault();
      zoomBy(Math.exp(clamp(e.deltaY, -120, 120) * 0.0015));
    }, { passive: false });
    stage.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') engaged = false; });
    document.addEventListener('pointerdown', function (e) { if (!stage.contains(e.target)) engaged = false; }, true);
    canvas.addEventListener('blur', function () { engaged = false; });
    canvas.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var s = 6 * DEG, P = 24;
      if (e.shiftKey && /^Arrow/.test(e.key)) {
        if (e.key === 'ArrowLeft') panBy(P, 0); else if (e.key === 'ArrowRight') panBy(-P, 0);
        else if (e.key === 'ArrowUp') panBy(0, P); else panBy(0, -P);
      }
      else if (e.key === 'ArrowLeft') orbitBy(-s, 0);
      else if (e.key === 'ArrowRight') orbitBy(s, 0);
      else if (e.key === 'ArrowUp') orbitBy(0, -s);
      else if (e.key === 'ArrowDown') orbitBy(0, s);
      else if (e.key === '+' || e.key === '=' || e.key === 'Add') zoomBy(1 / 1.15);
      else if (e.key === '-' || e.key === '_' || e.key === 'Subtract') zoomBy(1.15);
      else if (e.key === '0') resetView();
      else return;
      e.preventDefault(); e.stopPropagation();
    });
  }

  /* ================================================================== */
  /* UI                                                                  */
  /* ================================================================== */
  function describe() {
    if (!cap) return;
    var what = st.mode === 'array' ? 'Array: 2 tiles, 4 × 4 at 28.8 mm, master board' : 'One tile: 150 × 100 mm, 8 elements';
    var view = CAM_WORD[st.cam] + ' view' + (st.mode === 'tile' && st.exploded ? ', layers lifted apart (gaps not to scale)' : '');
    var k = pinK;
    cap.textContent = what + ' · ' + view + (k ? ' · ' + k + ': ' + NAMES[k] + (ARRAY_ONLY[k] && st.mode !== 'array' ? ' (shown in Array)' : '') : '');
    if (canvas) canvas.setAttribute('aria-label', '3D model. ' + what + ', ' + view + '.' +
      (st.cola ? ' A 330 ml can (66 × 115 mm) stands beside it for scale.' : '') + ' The numbered callouts are listed below the view.');
  }
  function setMode(v) {
    if (v !== 'tile' && v !== 'array') v = 'tile';
    if (v === st.mode && model) return;
    tweens = tweens.filter(function (t) { return t.kind !== 'explode'; });
    st.mode = v;
    if (setModeSeg) setModeSeg(v);
    if (modx) modx.hidden = v !== 'tile' || loadState !== 'ready';
    if (v !== 'tile') { st.exploded = false; expBtn.setAttribute('aria-pressed', 'false'); }
    explodeT = st.exploded ? 1 : 0;
    if (v === 'array' && (st.cam === 'back' || st.cam === 'plan')) { st.cam = 'front'; if (setCamSeg) setCamSeg('front'); }
    if (loadState === 'ready') rebuild(true);
    describe();
    announce(v === 'array' ? 'Array: two tiles and the master board' : 'One tile');
  }
  function setCola(on) {
    st.cola = !!on;
    colaBtn.setAttribute('aria-pressed', st.cola ? 'true' : 'false');
    save_('cola', st.cola);
    if (model) { model.cola.visible = st.cola; keepView(true); }
    describe();
    announce(st.cola ? 'Cola can shown for scale' : 'Cola can hidden');
  }

  function init() {
    sec = $('tile3d');
    stage = $('m3-stage'); ph = $('m3-ph'); msg = $('m3-msg'); loadBtn = $('m3-load'); cap = $('m3-cap'); status = $('m3-status');
    ctlRow = $('m3-ctl'); camRow = $('m3-camrow'); hint = $('m3-hint'); legend = $('m3-legend'); modx = $('m3-modx');
    expBtn = $('m3-exp'); lblBtn = $('m3-lbls'); colaBtn = $('m3-cola'); zinBtn = $('m3-zin'); zoutBtn = $('m3-zout'); resetBtn = $('m3-reset');
    if (!stage || !ph || !msg || !loadBtn || !ctlRow || !camRow || !modx || !expBtn || !lblBtn || !zinBtn || !zoutBtn || !resetBtn || !colaBtn || !cap || !hint) return;
    var q = null;
    try {
      var u = new URLSearchParams(location.search);
      q = u.get('m3'); shot = u.get('m3shot') === '1'; wantCheck = u.get('m3check') === '1';
      st.cola = u.get('m3cola') ? u.get('m3cola') === 'on' : load_('cola') === true;
    } catch (e) { st.cola = false; }
    if (q && /^(back|front|plan|seam|exploded|array)$/.test(q)) testParam = q;
    if (shot && sec) sec.classList.add('m3-shot');
    colaBtn.setAttribute('aria-pressed', st.cola ? 'true' : 'false');
    stage.setAttribute('data-m3-state', 'idle');
    setMsg('Interactive 3D model of one tile. It loads when you scroll here.', 'Load 3D view');
    loadBtn.addEventListener('click', function () {
      if (loadBtn.getAttribute('aria-disabled') === 'true') return;
      if (loadState === 'failed') loadState = 'idle';
      load();
    });

    setModeSeg = seg($('m3-mode'), 'data-m3-mode', function (v) { setMode(v); });
    setCamSeg = seg($('m3-cam'), 'data-m3-cam', function (v) { setCam(v, true); });
    expBtn.addEventListener('click', function () { setExploded(!st.exploded, true); });
    lblBtn.addEventListener('click', function () {
      st.labels = !st.labels; lblBtn.setAttribute('aria-pressed', st.labels ? 'true' : 'false'); invalidate();
      announce(st.labels ? 'Labels shown' : 'Labels hidden');
    });
    colaBtn.addEventListener('click', function () { setCola(!st.cola); });
    zinBtn.addEventListener('click', function () { zoomBy(1 / 1.2); });
    zoutBtn.addEventListener('click', function () { zoomBy(1.2); });
    resetBtn.addEventListener('click', resetView);
    legendItems().forEach(function (li) {
      var k = li.getAttribute('data-k'), b = li.querySelector('button');
      if (!b) return;
      b.addEventListener('click', function () { pin(k, true); });
      b.addEventListener('keydown', function (e) { if (e.key === 'Escape') clearHL(); });
      li.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse' && !b.disabled) hover(k); });
      li.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hover(null); });
    });
    if (testParam === 'array') { st.mode = 'array'; st.cam = 'front'; }
    else if (testParam === 'exploded') { st.exploded = true; explodeT = 1; st.cam = 'front'; }
    else if (testParam) st.cam = testParam;
    setModeSeg(st.mode); setCamSeg(st.cam);
    expBtn.setAttribute('aria-pressed', st.exploded ? 'true' : 'false');
    describe();
    if ('IntersectionObserver' in window) {
      var near = new IntersectionObserver(function (es) {
        es.forEach(function (en) { if (en.isIntersecting) { near.disconnect(); load(); } });
      }, { rootMargin: '100% 0px 100% 0px' });
      near.observe(stage);
      var vis = new IntersectionObserver(function (es) {
        es.forEach(function (en) {
          onScreen = en.isIntersecting;
          if (!onScreen) engaged = false;
          if (onScreen && dirty) invalidate();
        });
      });
      vis.observe(stage);
    } else {
      load();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
