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
  var SRC_CM = 3.6;                 /* board space below for the LO source   */
  var TOP_CM = 3.4;                 /* board space above for the RFSoC backend */

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
  /* The baseband tier gets its own visual language so the two networks can be
     read at once: one hue, dashed, and anchored to the lower right of each
     tile rather than its centre. */
  var BB_STYLE = { stroke: 'var(--s3)', w: 1.9, dash: '4 2.5', name: 'baseband, tiles → RFSoC' };

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
        g.appendChild(el('path', { d: 'M-4.5 -5 L5.5 0 L-4.5 5 Z', fill: 'var(--bg-panel)', stroke: 'var(--s3)', 'stroke-width': 1.4 }));
        break;
      case 'res':
        g.appendChild(el('rect', { x: -5.5, y: -3.5, width: 11, height: 7, fill: 'var(--bg-panel)', stroke: 'var(--s3)', 'stroke-width': 1.3 }));
        break;
      case 'backend':
        g.appendChild(el('rect', { x: -30, y: -11, width: 60, height: 22, rx: 4, fill: 'var(--bg-panel)', stroke: 'var(--s3)', 'stroke-width': 1.8 }));
        g.appendChild(el('text', { y: 3.8, 'text-anchor': 'middle', fill: 'var(--s3)', 'font-size': 10 }, label || 'RFSoC'));
        break;
      case 'sum':
        g.appendChild(el('circle', { r: 7, fill: 'var(--bg-panel)', stroke: 'var(--s3)', 'stroke-width': 1.6 }));
        g.appendChild(el('text', { y: 3.6, 'text-anchor': 'middle', fill: 'var(--s3)', 'font-size': 10 }, 'Σ'));
        break;
      case 'drv':
        g.appendChild(el('path', { d: 'M-5 -5 L5.5 0 L-5 5 Z', fill: 'var(--s3)', 'fill-opacity': 0.25, stroke: 'var(--s3)', 'stroke-width': 1.4 }));
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
  /* ---------------------------------------------------------------- LOD
     The map has to stay usable from 25 tiles to several thousand. Detail is
     chosen from the number of tiles ACTUALLY VISIBLE, not the array total,
     so zooming into a 5000-tile array restores full per-die detail for the
     region on screen. Everything outside the view is culled, which is what
     keeps the element count bounded rather than growing with the array.

     Whatever a tier drops is named in the returned `lod.note` and shown
     under the map — a simplification the reader cannot see is worse than a
     slow render.                                                          */
  function lodFor(visibleTiles) {
    if (visibleTiles <= 120) {
      return { tier: 'full', dies: true, taps: true, blocks: true, links: 99, tips: true, note: '' };
    }
    if (visibleTiles <= 500) {
      return {
        tier: 'no-dies', dies: false, taps: false, blocks: true, links: 99, tips: true,
        note: 'dies and their LO taps hidden above 120 visible tiles — zoom in to see them'
      };
    }
    if (visibleTiles <= 1500) {
      return {
        tier: 'network', dies: false, taps: false, blocks: false, links: 99, tips: false,
        note: 'dies, taps and block symbols hidden, and tooltips off, above 500 visible tiles — zoom in for detail'
      };
    }
    return {
      tier: 'coarse', dies: false, taps: false, blocks: false, links: 6, tips: false,
      note: 'above 1500 visible tiles only the tile heat map and the top 6 tree levels are drawn — zoom in for the rest'
    };
  }

  function renderMap(mount, built, view, onSelect) {
    mount.textContent = '';
    var grid = built.grid, lo = built.lo;
    var apCm = grid.cols * grid.tileCm;                 /* POPULATED extent */
    var apSpec = view.apertureSpecCm || apCm;           /* the panel spec    */
    var marg = Math.max(0, (apSpec - apCm) / 2);        /* inactive per side */
    /* The drawing frame is the SPEC aperture, so the picture does not rescale
       as the pitch changes, and the under-filled margin is visible rather
       than implied. Tile coordinates stay in populated-aperture space and are
       shifted in by the margin. */
    var scale = 640 / apSpec;
    var W = PAD * 2 + apSpec * scale;
    /* room above the aperture for the RFSoC backend, and below it for the
       LO source — the two networks enter from opposite edges */
    var H = PAD * 2 + (TOP_CM + apSpec + SRC_CM) * scale;
    function X(cm) { return PAD + (cm + marg) * scale; }
    function Y(cm) { return PAD + (cm + marg + TOP_CM) * scale; }

    /* ---- zoom / pan: crop the viewBox, leave the coordinate map alone ---- */
    var Z = Math.max(1, view.zoom || 1);
    var cxCm = view.panXCm === undefined ? apCm / 2 : view.panXCm;
    var cyCm = view.panYCm === undefined ? apCm / 2 : view.panYCm;
    var vw = W / Z, vh = H / Z;
    var vx = X(cxCm) - vw / 2, vy = Y(cyCm) - vh / 2;
    /* keep the crop inside the drawing so panning cannot wander off it */
    vx = Math.max(0, Math.min(W - vw, vx));
    vy = Math.max(0, Math.min(H - vh, vy));

    /* visible rectangle back in cm, for culling and the LOD decision */
    var visCm = {
      x0: (vx - PAD) / scale, x1: (vx + vw - PAD) / scale,
      y0: (vy - PAD) / scale - TOP_CM, y1: (vy + vh - PAD) / scale - TOP_CM
    };
    function tileVisible(t) {
      return t.x + t.w >= visCm.x0 && t.x <= visCm.x1 && t.y + t.h >= visCm.y0 && t.y <= visCm.y1;
    }
    function segVisible(x1, y1, x2, y2) {
      return Math.max(x1, x2) >= visCm.x0 && Math.min(x1, x2) <= visCm.x1 &&
             Math.max(y1, y2) >= visCm.y0 && Math.min(y1, y2) <= visCm.y1;
    }

    var dragMoved = false;   /* set by the pan handler; suppresses the click */
    var shown = grid.tiles.filter(tileVisible);
    var lod = lodFor(shown.length);
    /* explicit layer switches always win over the LOD default */
    var wantDies = view.showDies !== false && lod.dies;
    var wantBlocks = view.showBlocks !== false && lod.blocks;

    var svg = el('svg', {
      class: 'chart map', viewBox: vx.toFixed(1) + ' ' + vy.toFixed(1) + ' ' + vw.toFixed(1) + ' ' + vh.toFixed(1),
      preserveAspectRatio: 'xMidYMid meet'
    });
    /* Height follows the drawing's own aspect rather than a fixed vh, so the
       element matches the artwork and there is no dead clickable margin. */
    svg.style.aspectRatio = W.toFixed(2) + ' / ' + H.toFixed(2);
    /* strokes and glyphs stay a constant size on screen no matter the crop */
    function nss(e) { e.setAttribute('vector-effect', 'non-scaling-stroke'); return e; }
    function place(g2, x, y) {
      g2.setAttribute('transform', 'translate(' + X(x).toFixed(1) + ',' + Y(y).toFixed(1) + ') scale(' + (1 / Z).toFixed(4) + ')');
      return g2;
    }
    var fs = function (px) { return (px / Z).toFixed(2); };

    /* ---- panel spec (dashed) and populated area (solid) ---- */
    if (marg > 1e-6) {
      svg.appendChild(nss(el('rect', {
        x: X(-marg), y: Y(-marg), width: apSpec * scale, height: apSpec * scale,
        fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 1.2,
        'stroke-dasharray': '6 4', rx: 3
      })));
    }
    svg.appendChild(nss(el('rect', {
      x: X(0), y: Y(0), width: apCm * scale, height: apCm * scale,
      fill: 'var(--bg-sunken)', stroke: 'var(--rule-strong)', 'stroke-width': 1.4, rx: 3
    })));
    svg.appendChild(el('text', {
      x: X(apCm / 2), y: Y(-marg) - 12 / Z, 'text-anchor': 'middle', fill: 'var(--ink-3)', 'font-size': fs(10.5)
    }, (marg > 1e-6
        ? apSpec.toFixed(1) + ' cm panel · ' + grid.rows + '×' + grid.cols + ' = ' + grid.nTiles +
          ' tiles at ' + grid.tileCm.toFixed(2) + ' cm pitch · ' + apCm.toFixed(1) + ' cm populated (' +
          (100 * apCm / apSpec).toFixed(1) + '% of side, ' + (20 * Math.log10(apCm / apSpec)).toFixed(2) +
          ' dB peak directivity) · ' + marg.toFixed(2) + ' cm inactive margin per side'
        : apSpec.toFixed(1) + ' cm aperture · ' + grid.rows + '×' + grid.cols + ' = ' + grid.nTiles +
          ' tiles at ' + grid.tileCm.toFixed(2) + ' cm pitch · fills the aperture exactly') +
       (Z > 1 ? '  ·  ' + Z + '× zoom' : '')));

    /* ---- tiles, coloured by the chosen metric ---- */
    var metric = view.tileMetric || 'skewPs';
    var vals = grid.tiles.map(function (t) { return t.m ? t.m[metric] : NaN; }).filter(isFinite);
    var vmin = vals.length ? Math.min.apply(null, vals) : 0;
    var vmax = vals.length ? Math.max.apply(null, vals) : 1;
    var span = vmax - vmin;
    /* gaps between tiles are a fixed screen size, so they do not swallow the
       tile at high counts */
    var gap = Math.min(1.5, 0.06 * grid.tileCm * scale);

    var tileG = el('g');
    shown.forEach(function (t) {
      var v = t.m ? t.m[metric] : NaN;
      var norm = span > 1e-12 ? (v - vmin) / span : 0.15;
      var sel = view.selected === t.i;
      var r = el('rect', {
        x: X(t.x) + gap, y: Y(t.y) + gap,
        width: Math.max(0.5, t.w * scale - 2 * gap), height: Math.max(0.5, t.h * scale - 2 * gap),
        rx: Math.min(3, t.w * scale * 0.08),
        fill: rampColor(norm), 'fill-opacity': 0.38,
        stroke: sel ? 'var(--ink)' : 'var(--rule-strong)',
        'stroke-width': sel ? 2.2 : 0.8, 'vector-effect': 'non-scaling-stroke',
        style: 'cursor:pointer'
      });
      if (lod.tips) {
        r.appendChild(el('title', null,
          'tile ' + t.i + ' (r' + t.r + ',c' + t.c + ')\n' +
          'routed path ' + t.pathCm.toFixed(1) + ' cm\n' +
          (t.hop ? 'chain hop ' + t.hop + '\n' : 'tree level ' + t.level + '\n') +
          (t.m ? ('loss ' + t.m.lossDb.toFixed(1) + ' dB, skew ' + t.m.skewPs.toFixed(1) + ' ps, ' +
                  'static offset ' + t.m.wraps.toFixed(1) + ' wraps, drift ' + t.m.driftDeg.toFixed(1) + '°, power ' + t.m.powerMw.toFixed(0) + ' mW') : '')));
      }
      r.addEventListener('click', function () { if (!dragMoved) onSelect(t.i); });
      tileG.appendChild(r);

      if (t.hop && lod.tier === 'full') tileG.appendChild(el('text', {
        x: X(t.x + t.w) - 4 / Z, y: Y(t.y) + 11 / Z, 'text-anchor': 'end',
        'font-size': fs(9), fill: 'var(--ink-3)'
      }, t.hop));
    });
    svg.appendChild(tileG);

    /* ---- RFIC dies and the intra-tile LO tap fan-out, drawn to scale ---- */
    if (wantDies) {
      var dieG = el('g');
      var eb = BAND_STYLE.eband.stroke;          /* the taps are always E-band */
      shown.forEach(function (t) {
        if (lod.taps) (t.tapLinks || []).forEach(function (L) {
          dieG.appendChild(nss(el('line', {
            x1: X(L.x1), y1: Y(L.y1), x2: X(L.x2), y2: Y(L.y2),
            stroke: eb, 'stroke-width': 1.1, 'stroke-opacity': 0.75, 'stroke-linecap': 'round'
          })));
        });
        (t.dies || []).forEach(function (d) {
          var w = Math.max(3, d.w * scale);
          var rect = el('rect', {
            x: X(d.x) - w / 2, y: Y(d.y) - w / 2, width: w, height: w, rx: 0.8,
            fill: 'var(--ink)', 'fill-opacity': 0.62, stroke: eb,
            'stroke-width': 0.9, 'vector-effect': 'non-scaling-stroke'
          });
          if (lod.tips) rect.appendChild(el('title', null,
            'tile ' + t.i + ' · RFIC die ' + d.i + '\n' +
            '2.5 × 2.5 mm SiGe, 4 RX + 4 TX with IQ baseband\n' +
            'one 78 GHz LO tap, fed by the intra-tile fan-out'));
          dieG.appendChild(rect);
          dieG.appendChild(el('circle', { cx: X(d.x), cy: Y(d.y - d.w / 2), r: 1.5 / Z, fill: eb }));
        });
      });
      svg.appendChild(dieG);
    }

    /* ---- BASEBAND tier first, so the LO tier draws over it ---- */
    var bbi = built.bbInter;
    if (view.showBb !== false && bbi) {
      var bbLinkG = el('g');
      bbi.links.forEach(function (L) {
        if (!segVisible(L.x1, L.y1, L.x2, L.y2)) return;
        if ((L.level || 0) > lod.links) return;
        bbLinkG.appendChild(nss(el('line', {
          x1: X(L.x1), y1: Y(L.y1), x2: X(L.x2), y2: Y(L.y2),
          stroke: BB_STYLE.stroke, 'stroke-width': L.kind === 'bbroot' ? BB_STYLE.w + 1 : BB_STYLE.w,
          'stroke-dasharray': BB_STYLE.dash, 'stroke-linecap': 'round', 'stroke-opacity': 0.9
        })));
      });
      svg.appendChild(bbLinkG);

      if (wantBlocks) {
        var bbNodeG = el('g');
        bbi.nodes.forEach(function (n2) {
          if (n2.type !== 'backend' && !segVisible(n2.x, n2.y, n2.x, n2.y)) return;
          var gl = glyph(n2.type, n2.label, n2.freqHz);
          place(gl, n2.x, n2.y);
          if (lod.tips) gl.appendChild(el('title', null, 'baseband · ' + (n2.label || n2.type)));
          bbNodeG.appendChild(gl);
        });
        svg.appendChild(bbNodeG);
      }

      svg.appendChild(el('text', {
        x: X(bbi.root.x), y: Y(bbi.root.y) - 17 / Z, 'text-anchor': 'middle',
        fill: 'var(--s3)', 'font-size': fs(10.5)
      }, 'baseband backend · ' + bbi.kind + ' · ' + bbi.totalRoutedCm.toFixed(0) + ' cm routed'));
    }

    /* ---- LO / reference tier, weighted and coloured by frequency ---- */
    if (view.showLo !== false) {
      var linkG = el('g');
      lo.net.links.forEach(function (L) {
        if (!segVisible(L.x1, L.y1, L.x2, L.y2)) return;
        if ((L.level || 0) > lod.links) return;
        var st = BAND_STYLE[bandOf(L.freqHz)];
        linkG.appendChild(nss(el('line', {
          x1: X(L.x1), y1: Y(L.y1), x2: X(L.x2), y2: Y(L.y2),
          stroke: st.stroke, 'stroke-width': st.w, 'stroke-linecap': 'round',
          'stroke-opacity': L.kind === 'trunk' ? 1 : 0.85
        })));
      });
      svg.appendChild(linkG);

      if (wantBlocks) {
        var nodeG = el('g');
        lo.net.nodes.forEach(function (n2) {
          if (n2.type !== 'source' && !segVisible(n2.x, n2.y, n2.x, n2.y)) return;
          var gl = glyph(n2.type, n2.label, n2.freqHz);
          place(gl, n2.x, n2.y);
          if (lod.tips) gl.appendChild(el('title', null, (n2.label || n2.type) +
            (isFinite(n2.freqHz) ? ' @ ' + (n2.freqHz >= 1e9 ? (n2.freqHz / 1e9).toFixed(1) + ' GHz' : (n2.freqHz / 1e6).toFixed(0) + ' MHz') : '')));
          nodeG.appendChild(gl);
        });
        svg.appendChild(nodeG);
      }

      var src = lo.net.source;
      svg.appendChild(el('text', {
        x: X(src.x), y: Y(src.y) + 25 / Z, 'text-anchor': 'middle',
        fill: 'var(--ink-2)', 'font-size': fs(10.5)
      }, (view.sourceLabel || 'source') + ' · ' +
         (lo.distFreqHz >= 1e9 ? (lo.distFreqHz / 1e9).toFixed(2) + ' GHz' : (lo.distFreqHz / 1e6).toFixed(0) + ' MHz') +
         ' on the board'));
    }

    mount.appendChild(svg);

    /* ====================================================================
       INTERACTION — wheel to zoom at the cursor, drag to pan, double-click
       to zoom in, all of it standard map behaviour.

       The viewBox is mutated in place during a gesture and the expensive
       re-render (which re-runs culling and the LOD decision) is deferred
       until the gesture settles. Two reasons: re-rendering on every
       pointermove would destroy the element holding the pointer capture and
       the drag would die after one frame, and at several thousand tiles a
       per-frame rebuild would not keep up.
       ================================================================== */
    var cur = { z: Z, vx: vx, vy: vy, vw: vw, vh: vh };
    var settle = 0;

    function applyCrop() {
      svg.setAttribute('viewBox',
        cur.vx.toFixed(1) + ' ' + cur.vy.toFixed(1) + ' ' + cur.vw.toFixed(1) + ' ' + cur.vh.toFixed(1));
    }
    /* crop rect -> the state the caller keeps */
    function commit() {
      if (!view.onViewChange) return;
      view.onViewChange(
        cur.z,
        (cur.vx + cur.vw / 2 - PAD) / scale - marg,
        (cur.vy + cur.vh / 2 - PAD) / scale - marg - TOP_CM
      );
    }
    function scheduleCommit() {
      if (settle) clearTimeout(settle);
      settle = setTimeout(function () { settle = 0; commit(); }, 200);
    }
    function clampCrop() {
      cur.vw = W / cur.z;
      cur.vh = H / cur.z;
      cur.vx = Math.max(0, Math.min(W - cur.vw, cur.vx));
      cur.vy = Math.max(0, Math.min(H - cur.vh, cur.vy));
    }

    /* zoom by `k` about a point given as a fraction of the element box */
    function zoomAt(k, fx, fy) {
      var z2 = Math.max(1, Math.min(64, cur.z * k));
      if (z2 === cur.z) return;
      var px = cur.vx + fx * cur.vw;          /* viewBox point under cursor */
      var py = cur.vy + fy * cur.vh;
      cur.z = z2;
      cur.vw = W / z2;
      cur.vh = H / z2;
      cur.vx = px - fx * cur.vw;              /* keep that point put */
      cur.vy = py - fy * cur.vh;
      clampCrop();
      applyCrop();
      scheduleCommit();
    }
    function fracOf(e) {
      var b = svg.getBoundingClientRect();
      if (!b.width || !b.height) return { fx: 0.5, fy: 0.5 };
      return {
        fx: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)),
        fy: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height))
      };
    }

    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      var f = fracOf(e);
      /* one notch is a factor of ~1.2; trackpads send many small deltas */
      var k = Math.pow(1.0016, -e.deltaY);
      zoomAt(Math.max(0.5, Math.min(2, k)), f.fx, f.fy);
    }, { passive: false });

    svg.addEventListener('dblclick', function (e) {
      e.preventDefault();
      var f = fracOf(e);
      zoomAt(e.shiftKey ? 0.5 : 2, f.fx, f.fy);
    });

    /* drag to pan. dragMoved suppresses the tile click that would otherwise
       fire on release, so panning does not also change the selection. */
    var drag = null;
    svg.style.cursor = cur.z > 1 ? 'grab' : 'default';
    svg.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, vx: cur.vx, vy: cur.vy, moved: false };
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* older engines */ }
    });
    svg.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var b = svg.getBoundingClientRect();
      if (!b.width) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      drag.moved = true;
      dragMoved = true;
      svg.style.cursor = 'grabbing';
      var unitsPerPx = cur.vw / b.width;
      cur.vx = drag.vx - dx * unitsPerPx;
      cur.vy = drag.vy - dy * unitsPerPx;
      clampCrop();
      applyCrop();
    });
    function endDrag() {
      if (drag && drag.moved) scheduleCommit();
      drag = null;
      svg.style.cursor = cur.z > 1 ? 'grab' : 'default';
      /* let the click that follows this pointerup through, then re-arm */
      setTimeout(function () { dragMoved = false; }, 0);
    }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    /* ---- colour-scale legend + what the LOD dropped ---- */
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
    var cnt = document.createElement('span');
    cnt.className = 'li';
    cnt.innerHTML = '<span style="font-size:11px;color:var(--ink-3)">' + shown.length + ' of ' +
      grid.nTiles + ' tiles in view' + (lod.note ? ' — ' + lod.note : '') + '</span>';
    sc.appendChild(cnt);
    mount.appendChild(sc);

    return { svg: svg, lod: lod, visible: shown.length, zoom: Z };
  }

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

    var bl = document.createElement('span');
    bl.className = 'li';
    bl.innerHTML = '<span class="sw dash" style="border-top-color:' + BB_STYLE.stroke + '"></span>' + BB_STYLE.name;
    wrap.appendChild(bl);

    var t0 = built.grid.tiles[0];
    if (t0 && t0.dies) {
      var dl = document.createElement('span');
      dl.className = 'li';
      dl.innerHTML = '<span style="display:inline-block;width:9px;height:9px;background:var(--ink);opacity:.62;' +
        'border:0.9px solid ' + BAND_STYLE.eband.stroke + '"></span>' +
        t0.dies.length + ' RFIC dies per tile, 2.5 mm, to scale — each with one 78 GHz LO tap';
      wrap.appendChild(dl);
    }

    var seen = {};
    var order = ['source', 'split', 'amp', 'buftap', 'tap', 'pll', 'mult', 'term',
                 'backend', 'sum', 'res', 'cell', 'drv'];
    var names = {
      source: 'LO source', split: 'splitter', amp: 'repeater amp', buftap: 'buffer + tap',
      tap: 'tap', pll: 'per-tile PLL', mult: 'per-tile multiplier', term: 'termination',
      backend: 'RFSoC backend', sum: 'resistive summing node', res: 'resistive arm',
      cell: 'active combine cell', drv: 'baseband driver'
    };
    built.lo.net.nodes.forEach(function (n) { seen[n.type] = true; });
    if (built.bbInter) built.bbInter.nodes.forEach(function (n) { seen[n.type] = true; });
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
      rows.push(['Static offset to resolve', t.m.wraps.toFixed(2) + ' wraps at ' + g.fLoGHz + ' GHz']);
      rows.push(['Thermal drift, uncalibrated', t.m.driftDeg.toFixed(2) + '°']);
      rows.push(['Distribution power for this tile', t.m.powerMw.toFixed(0) + ' mW']);
    }
    var bbi = built.bbInter;
    if (bbi) {
      rows.push(['— baseband tier —', '']);
      rows.push(['Network', bbi.kind + (bbi.kind === 'htree' ? ' (' + bbi.depth + ' levels)' : '')]);
      rows.push(['Routed path to backend', t.bbPathCm.toFixed(1) + ' cm']);
      rows.push([bbi.kind === 'bus' ? 'Bus tap position' : 'Tree level',
        bbi.kind === 'bus' ? t.bbHop + ' of ' + bbi.depth : t.bbLevel + ' of ' + bbi.depth]);
      rows.push(['Deviation from mean path', (t.bbPathCm - bbi.pathMeanCm).toFixed(1) + ' cm']);
    }
    if (t.dies && t.dies.length) {
      rows.push(['— RFIC dies in this tile —', '']);
      rows.push(['E-band dies', t.dies.length + ' × 2.5 × 2.5 mm SiGe']);
      rows.push(['Channels', (t.dies.length * 8) + ' (4 RX + 4 TX per die, IQ baseband)']);
      rows.push(['78 GHz LO taps', String(t.dies.length)]);
      rows.push(['Intra-tile LO fan-out', t.tapRoutedCm.toFixed(1) + ' cm routed at ' + g.fLoGHz + ' GHz']);
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
