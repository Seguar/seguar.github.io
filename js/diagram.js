/* ============================================================================
   diagram.js — the interactive hardware map.

   Draws the aperture floorplan, the selected distribution network, and the
   block symbols at their real positions, straight from Topo.build(). Line
   WEIGHT and COLOUR encode the frequency each segment carries, so "what
   frequency is actually on the board" is visible at a glance — which is the
   whole architectural question.

   Click a tile for its own path length, loss, skew, phase error and power.
   Exposes window.Diagram.
   ========================================================================= */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var PAD = 38;
  var SRC_CM = 3.6;                 /* board space below the aperture */

  function el(n, a, t) {
    var e = document.createElementNS(SVGNS, n);
    if (a) for (var k in a) if (a[k] !== null && a[k] !== undefined) e.setAttribute(k, String(a[k]));
    if (t !== undefined && t !== null) e.textContent = String(t);
    return e;
  }

  /* ------------------------- frequency -> line style -------------------- */
  function bandOf(fHz) {
    if (!isFinite(fHz)) return 'ref';
    if (fHz < 2e9) return 'ref';
    if (fHz < 50e9) return 'mid';
    return 'eband';
  }
  var BAND_STYLE = {
    ref:   { stroke: 'var(--s1)', w: 1.3, name: 'reference / low frequency (< 2 GHz)' },
    mid:   { stroke: 'var(--s4)', w: 2.2, name: 'mid frequency (2–50 GHz)' },
    eband: { stroke: 'var(--s2)', w: 3.4, name: 'E-band (> 50 GHz)' }
  };

  /* -------------------------- sequential colour ramp -------------------- */
  var RAMP = ['#1c5f8b', '#7fb3cc', '#e8d9a0', '#d98a4a', '#9b2226'];
  function rampColor(t) {
    if (!isFinite(t)) return 'var(--bg-sunken)';
    t = Math.max(0, Math.min(1, t));
    var x = t * (RAMP.length - 1);
    var i = Math.min(RAMP.length - 2, Math.floor(x));
    var f = x - i;
    function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
    var a = hex(RAMP[i]), b = hex(RAMP[i + 1]);
    return 'rgb(' + a.map(function (v, k) { return Math.round(v + (b[k] - v) * f); }).join(',') + ')';
  }

  /* ------------------------------ block glyphs -------------------------- */
  /* Each glyph is drawn in local px around (0,0) and positioned by transform. */
  function glyph(type, label, freqHz) {
    var g = el('g', { class: 'blk blk-' + type });
    var band = bandOf(freqHz);
    var col = BAND_STYLE[band].stroke;

    switch (type) {
      case 'source':
        g.appendChild(el('rect', { x: -26, y: -11, width: 52, height: 22, rx: 4, fill: 'var(--bg-panel)', stroke: col, 'stroke-width': 1.8 }));
        g.appendChild(el('path', { d: 'M-15 0 q3.5 -6 7 0 t7 0 t7 0', fill: 'none', stroke: col, 'stroke-width': 1.6 }));
        break;
      case 'split':
        g.appendChild(el('path', { d: 'M0 -5.5 L5.5 0 L0 5.5 L-5.5 0 Z', fill: 'var(--bg-panel)', stroke: col, 'stroke-width': 1.4 }));
        break;
      case 'amp':
        g.appendChild(el('path', { d: 'M-5 -5.5 L6 0 L-5 5.5 Z', fill: 'var(--bg-panel)', stroke: col, 'stroke-width': 1.4 }));
        break;
      case 'buftap':
        g.appendChild(el('path', { d: 'M-6 -6 L6.5 0 L-6 6 Z', fill: 'var(--bg-panel)', stroke: col, 'stroke-width': 1.5 }));
        g.appendChild(el('line', { x1: 0, y1: 6, x2: 0, y2: 12, stroke: col, 'stroke-width': 1.4 }));
        break;
      case 'tap':
        g.appendChild(el('circle', { r: 3.6, fill: 'var(--bg-panel)', stroke: col, 'stroke-width': 1.3 }));
        break;
      case 'pll':
        g.appendChild(el('rect', { x: -16, y: -9, width: 32, height: 18, rx: 3, fill: 'var(--bg-panel)', stroke: 'var(--s3)', 'stroke-width': 1.6 }));
        g.appendChild(el('text', { y: 3.6, 'text-anchor': 'middle', fill: 'var(--s3)', 'font-size': 9.5 }, label || 'PLL'));
        break;
      case 'mult':
        g.appendChild(el('rect', { x: -14, y: -9, width: 28, height: 18, rx: 3, fill: 'var(--bg-panel)', stroke: 'var(--s5)', 'stroke-width': 1.6 }));
        g.appendChild(el('text', { y: 3.6, 'text-anchor': 'middle', fill: 'var(--s5)', 'font-size': 9.5 }, label || '×M'));
        break;
      case 'term':
        g.appendChild(el('rect', { x: -7, y: -4, width: 14, height: 8, fill: 'var(--bg-panel)', stroke: 'var(--ink-3)', 'stroke-width': 1.2 }));
        g.appendChild(el('line', { x1: 0, y1: 4, x2: 0, y2: 9, stroke: 'var(--ink-3)', 'stroke-width': 1.2 }));
        g.appendChild(el('line', { x1: -4, y1: 9, x2: 4, y2: 9, stroke: 'var(--ink-3)', 'stroke-width': 1.2 }));
        break;
      case 'cell':
        g.appendChild(el('path', { d: 'M-4.5 -5 L5.5 0 L-4.5 5 Z', fill: 'var(--accent-soft)', stroke: 'var(--accent)', 'stroke-width': 1.3 }));
        break;
      case 'res':
        g.appendChild(el('rect', { x: -5.5, y: -3.5, width: 11, height: 7, fill: 'var(--bg-panel)', stroke: 'var(--ink-2)', 'stroke-width': 1.2 }));
        break;
      case 'ch':
        g.appendChild(el('circle', { r: 2.6, fill: 'var(--ink-3)' }));
        break;
      case 'out':
        g.appendChild(el('rect', { x: -6, y: -7, width: 12, height: 14, rx: 2, fill: 'var(--accent-soft)', stroke: 'var(--accent)', 'stroke-width': 1.3 }));
        break;
      default:
        g.appendChild(el('circle', { r: 3, fill: col }));
    }
    return g;
  }

  /* ====================================================================== *
   * The aperture map
   * ==================================================================== */
  function renderMap(mount, built, view, onSelect) {
    mount.textContent = '';
    var grid = built.grid, lo = built.lo;
    var apCm = grid.cols * grid.tileCm;
    var scale = 640 / apCm;
    var W = PAD * 2 + apCm * scale;
    var H = PAD * 2 + (apCm + SRC_CM) * scale;
    function X(cm) { return PAD + cm * scale; }
    function Y(cm) { return PAD + cm * scale; }

    var svg = el('svg', { class: 'chart map', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });

    /* ---- aperture outline + rulers ---- */
    svg.appendChild(el('rect', {
      x: X(0), y: Y(0), width: apCm * scale, height: apCm * scale,
      fill: 'var(--bg-sunken)', stroke: 'var(--rule-strong)', 'stroke-width': 1.4, rx: 3
    }));
    svg.appendChild(el('text', { x: X(apCm / 2), y: Y(0) - 12, 'text-anchor': 'middle', fill: 'var(--ink-3)' },
      apCm.toFixed(0) + ' cm aperture · ' + grid.rows + '×' + grid.cols + ' = ' + grid.nTiles +
      ' tiles of ' + grid.tileCm.toFixed(1) + ' cm'));

    /* ---- tiles, coloured by the chosen metric ---- */
    var metric = view.tileMetric || 'phaseDeg';
    var vals = grid.tiles.map(function (t) { return t.m ? t.m[metric] : NaN; }).filter(isFinite);
    var vmin = vals.length ? Math.min.apply(null, vals) : 0;
    var vmax = vals.length ? Math.max.apply(null, vals) : 1;
    var span = vmax - vmin;

    var tileG = el('g');
    grid.tiles.forEach(function (t) {
      var v = t.m ? t.m[metric] : NaN;
      var norm = span > 1e-12 ? (v - vmin) / span : 0.15;
      var r = el('rect', {
        x: X(t.x) + 1.5, y: Y(t.y) + 1.5,
        width: t.w * scale - 3, height: t.h * scale - 3, rx: 3,
        fill: rampColor(norm), 'fill-opacity': 0.38,
        stroke: view.selected === t.i ? 'var(--ink)' : 'var(--rule-strong)',
        'stroke-width': view.selected === t.i ? 2.2 : 0.8,
        style: 'cursor:pointer'
      });
      r.appendChild(el('title', null,
        'tile ' + t.i + ' (r' + t.r + ',c' + t.c + ')\n' +
        'routed path ' + t.pathCm.toFixed(1) + ' cm\n' +
        (t.hop ? 'chain hop ' + t.hop + '\n' : 'tree level ' + t.level + '\n') +
        (t.m ? ('loss ' + t.m.lossDb.toFixed(1) + ' dB, skew ' + t.m.skewPs.toFixed(1) + ' ps, ' +
                'phase ' + t.m.phaseDeg.toFixed(1) + '°, power ' + t.m.powerMw.toFixed(0) + ' mW') : '')));
      r.addEventListener('click', function () { onSelect(t.i); });
      tileG.appendChild(r);

      /* the four RFIC dies inside each tile, to scale (2.5 mm on a 60 mm tile) */
      var dieCm = 0.25, nd = 2;
      for (var dr = 0; dr < nd; dr++) for (var dc = 0; dc < nd; dc++) {
        tileG.appendChild(el('rect', {
          x: X(t.x + t.w * (0.22 + dc * 0.42)), y: Y(t.y + t.h * (0.22 + dr * 0.42)),
          width: dieCm * scale, height: dieCm * scale,
          fill: 'var(--ink-3)', 'fill-opacity': 0.75
        }));
      }
      if (t.hop) tileG.appendChild(el('text', {
        x: X(t.x + t.w) - 4, y: Y(t.y) + 11, 'text-anchor': 'end', 'font-size': 9, fill: 'var(--ink-3)'
      }, t.hop));
    });
    svg.appendChild(tileG);

    /* ---- network links, weighted and coloured by frequency ---- */
    var linkG = el('g');
    lo.net.links.forEach(function (L) {
      var st = BAND_STYLE[bandOf(L.freqHz)];
      linkG.appendChild(el('line', {
        x1: X(L.x1), y1: Y(L.y1), x2: X(L.x2), y2: Y(L.y2),
        stroke: st.stroke, 'stroke-width': st.w, 'stroke-linecap': 'round',
        'stroke-opacity': L.kind === 'trunk' ? 1 : 0.85
      }));
    });
    svg.appendChild(linkG);

    /* ---- block symbols ---- */
    var nodeG = el('g');
    lo.net.nodes.forEach(function (n) {
      if (!view.showBlocks && n.type !== 'source') return;
      var gl = glyph(n.type, n.label, n.freqHz);
      gl.setAttribute('transform', 'translate(' + X(n.x).toFixed(1) + ',' + Y(n.y).toFixed(1) + ')');
      gl.appendChild(el('title', null, (n.label || n.type) +
        (isFinite(n.freqHz) ? ' @ ' + (n.freqHz >= 1e9 ? (n.freqHz / 1e9).toFixed(1) + ' GHz' : (n.freqHz / 1e6).toFixed(0) + ' MHz') : '')));
      nodeG.appendChild(gl);
    });
    svg.appendChild(nodeG);

    /* source label */
    var src = lo.net.source;
    svg.appendChild(el('text', {
      x: X(src.x), y: Y(src.y) + 25, 'text-anchor': 'middle', fill: 'var(--ink-2)', 'font-size': 10.5
    }, (view.sourceLabel || 'source') + ' · ' +
       (lo.distFreqHz >= 1e9 ? (lo.distFreqHz / 1e9).toFixed(2) + ' GHz' : (lo.distFreqHz / 1e6).toFixed(0) + ' MHz') +
       ' on the board'));

    mount.appendChild(svg);

    /* ---- colour-scale legend ---- */
    var sc = document.createElement('div');
    sc.className = 'legend';
    var lab = document.createElement('span');
    lab.className = 'li';
    lab.innerHTML = '<span style="font-size:11px;color:var(--ink-3)">tile fill: ' +
      (view.tileMetricLabel || metric) + '</span>';
    sc.appendChild(lab);
    var bar = document.createElement('span');
    bar.className = 'li';
    bar.innerHTML = '<span style="font:10px var(--mono)">' + UI.num(vmin) + '</span>' +
      '<span style="display:inline-block;width:88px;height:9px;border-radius:2px;background:linear-gradient(90deg,' + RAMP.join(',') + ');opacity:.75"></span>' +
      '<span style="font:10px var(--mono)">' + UI.num(vmax) + '</span>';
    sc.appendChild(bar);
    mount.appendChild(sc);

    return svg;
  }

  /* ====================================================================== *
   * Symbol / frequency legend
   * ==================================================================== */
  function renderLegend(mount, built) {
    mount.textContent = '';
    var wrap = document.createElement('div');
    wrap.className = 'legend';

    ['ref', 'mid', 'eband'].forEach(function (b) {
      var present = built.lo.net.links.some(function (L) { return bandOf(L.freqHz) === b; });
      if (!present) return;
      var li = document.createElement('span');
      li.className = 'li';
      li.innerHTML = '<span class="sw" style="background:' + BAND_STYLE[b].stroke +
        ';height:' + BAND_STYLE[b].w + 'px"></span>' + BAND_STYLE[b].name;
      wrap.appendChild(li);
    });

    var seen = {};
    var order = ['source', 'split', 'amp', 'buftap', 'tap', 'pll', 'mult', 'term'];
    var names = {
      source: 'source', split: 'splitter', amp: 'repeater amp', buftap: 'buffer + tap',
      tap: 'tap', pll: 'per-tile PLL', mult: 'per-tile multiplier', term: 'termination'
    };
    built.lo.net.nodes.forEach(function (n) { seen[n.type] = true; });
    order.forEach(function (ty) {
      if (!seen[ty]) return;
      var li = document.createElement('span');
      li.className = 'li';
      var s = el('svg', { width: 20, height: 16, viewBox: '-10 -8 20 16' });
      var gl = glyph(ty, ty === 'mult' ? '×M' : 'PLL', 78e9);
      s.appendChild(gl);
      li.appendChild(s);
      li.appendChild(document.createTextNode(names[ty] || ty));
      wrap.appendChild(li);
    });
    mount.appendChild(wrap);
  }

  /* ====================================================================== *
   * Per-tile inspector
   * ==================================================================== */
  function renderInspector(mount, built, idx, g) {
    mount.textContent = '';
    var t = built.grid.tiles[idx];
    if (!t) { mount.innerHTML = '<p class="note">Click a tile on the map to inspect its path.</p>'; return; }
    var lo = built.lo;
    var rows = [
      ['Grid position', 'row ' + t.r + ', col ' + t.c + '  (tile ' + t.i + ' of ' + built.grid.nTiles + ')'],
      ['Routed path from source', t.pathCm.toFixed(1) + ' cm'],
      [lo.kind === 'chain' ? 'Chain hop' : 'Tree level', lo.kind === 'chain' ? t.hop + ' of ' + lo.maxHop : t.level + ' of ' + lo.net.maxLevel],
      ['Series segments', String(t.segments)],
      ['Repeaters in path', String(t.repeaters)]
    ];
    if (t.m) {
      rows.push(['— electrical —', '']);
      rows.push(['Path loss at ' + (lo.distFreqHz / 1e9).toFixed(2) + ' GHz', t.m.lossDb.toFixed(2) + ' dB']);
      rows.push(['Skew vs array mean', t.m.skewPs.toFixed(2) + ' ps']);
      rows.push(['Phase error at ' + g.fLoGHz + ' GHz', t.m.phaseDeg.toFixed(2) + '°']);
      rows.push(['Distribution power for this tile', t.m.powerMw.toFixed(0) + ' mW']);
    }
    rows.push(['— blocks in this tile —', '']);
    (t.blocks || []).forEach(function (b) { rows.push([b.label, b.type]); });

    var tb = document.createElement('table');
    tb.className = 'grid';
    var body = document.createElement('tbody');
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      if (!r[1]) {
        tr.className = 'sect';
        var td = document.createElement('td');
        td.colSpan = 2;
        td.textContent = r[0].replace(/—/g, '').trim();
        tr.appendChild(td);
      } else {
        var a = document.createElement('td'); a.textContent = r[0];
        var b2 = document.createElement('td'); b2.className = 'v'; b2.textContent = r[1];
        tr.appendChild(a); tr.appendChild(b2);
      }
      body.appendChild(tr);
    });
    tb.appendChild(body);
    mount.appendChild(tb);
  }

  /* ====================================================================== *
   * Hardware bill of materials
   * ==================================================================== */
  function renderBom(mount, built, blockLib) {
    mount.textContent = '';
    var tb = document.createElement('table');
    tb.className = 'grid';
    var head = document.createElement('thead');
    var htr = document.createElement('tr');
    ['Block', 'Count', 'Unit power', 'Total power', 'Where it sits'].forEach(function (h, i) {
      var th = document.createElement('th');
      th.textContent = h;
      if (i === 4) th.style.textAlign = 'left';
      htr.appendChild(th);
    });
    head.appendChild(htr);
    tb.appendChild(head);

    var body = document.createElement('tbody');
    function section(title, bom) {
      var tr = document.createElement('tr');
      tr.className = 'sect';
      var td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = title;
      tr.appendChild(td);
      body.appendChild(tr);
      var tot = 0;
      bom.forEach(function (b) {
        var lib = (blockLib && blockLib[b.blockKey]) || null;
        var unit = lib ? lib.powerMw : NaN;
        var sub = isFinite(unit) ? unit * b.count : NaN;
        if (isFinite(sub)) tot += sub;
        var tr2 = document.createElement('tr');
        var c0 = document.createElement('td');
        c0.className = 'mn';
        c0.appendChild(document.createTextNode(lib ? lib.name : b.blockKey));
        var sm = document.createElement('small');
        sm.textContent = lib ? (lib.tech + ' @ ' + lib.freqGHz + ' GHz') : b.blockKey;
        c0.appendChild(sm);
        tr2.appendChild(c0);
        [String(b.count), isFinite(unit) ? unit.toFixed(0) + ' mW' : '—', isFinite(sub) ? (sub / 1000).toFixed(2) + ' W' : '—'].forEach(function (v) {
          var c = document.createElement('td'); c.className = 'v'; c.textContent = v; tr2.appendChild(c);
        });
        var cw = document.createElement('td');
        cw.style.textAlign = 'left';
        cw.style.whiteSpace = 'normal';
        cw.style.minWidth = '280px';
        cw.textContent = b.where;
        tr2.appendChild(cw);
        body.appendChild(tr2);
      });
      var trt = document.createElement('tr');
      var ct = document.createElement('td');
      ct.className = 'mn';
      ct.innerHTML = '<strong>subtotal</strong>';
      trt.appendChild(ct);
      trt.appendChild(document.createElement('td'));
      trt.appendChild(document.createElement('td'));
      var cv = document.createElement('td');
      cv.className = 'v';
      cv.innerHTML = '<strong>' + (tot / 1000).toFixed(2) + ' W</strong>';
      trt.appendChild(cv);
      trt.appendChild(document.createElement('td'));
      body.appendChild(trt);
    }
    section('LO / reference distribution', built.lo.bom || []);
    section('Baseband split / combine (both I and Q rails)', built.bb.bom || []);
    tb.appendChild(body);
    mount.appendChild(tb);
  }

  /* ====================================================================== *
   * Baseband tile-zoom diagram
   * ==================================================================== */
  function renderBbDiagram(mount, built) {
    mount.textContent = '';
    var bb = built.bb;
    var sx = 6.6, sy = 4.6, PADX = 16, PADY = 14;
    var W = bb.W * sx + PADX * 2, H = bb.H * sy + PADY * 2;
    function X(v) { return PADX + v * sx; }
    function Y(v) { return PADY + v * sy; }
    var svg = el('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });

    svg.appendChild(el('rect', {
      x: 4, y: 4, width: W - 8, height: H - 8, rx: 5,
      fill: 'var(--bg-sunken)', stroke: 'var(--rule-strong)', 'stroke-width': 1.2
    }));
    svg.appendChild(el('text', { x: W / 2, y: 17, 'text-anchor': 'middle', fill: 'var(--ink-3)' },
      'one tile: ' + bb.nCh + ' baseband channels per rail (I and Q identical) → tile output'));

    bb.links.forEach(function (L) {
      svg.appendChild(el('line', {
        x1: X(L.x1), y1: Y(L.y1), x2: X(L.x2), y2: Y(L.y2),
        stroke: L.kind === 'bus' || L.kind === 'root' ? 'var(--accent)' : 'var(--ink-3)',
        'stroke-width': L.kind === 'bus' || L.kind === 'root' ? 2.2 : 1.2,
        'stroke-linecap': 'round'
      }));
    });
    bb.nodes.forEach(function (n) {
      var gl = glyph(n.type, n.label, 1e9);
      gl.setAttribute('transform', 'translate(' + X(n.x).toFixed(1) + ',' + Y(n.y).toFixed(1) + ')');
      gl.appendChild(el('title', null, n.label || n.type));
      svg.appendChild(gl);
    });
    mount.appendChild(svg);

    var p = document.createElement('p');
    p.className = 'note';
    p.style.padding = '0 12px 10px';
    p.textContent = bb.note;
    mount.appendChild(p);
  }

  window.Diagram = {
    renderMap: renderMap,
    renderLegend: renderLegend,
    renderInspector: renderInspector,
    renderBom: renderBom,
    renderBbDiagram: renderBbDiagram,
    rampColor: rampColor,
    bandOf: bandOf
  };
})();
