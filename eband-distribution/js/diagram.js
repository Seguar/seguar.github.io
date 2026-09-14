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
      /* A6: an injection-locked tank. Drawn as an oscillator (the circle
         with a sine) rather than as a box, because that is the whole
         claim — it is a free-running oscillator that happens to be
         pulled into lock, not a synthesiser. */
      case 'ilo':
        g.appendChild(el('circle', { r: 8.5, fill: 'var(--bg-panel)', stroke: 'var(--s4)', 'stroke-width': 1.6 }));
        g.appendChild(el('path', { d: 'M-5 0 q2.5 -4.5 5 0 t5 0', fill: 'none', stroke: 'var(--s4)', 'stroke-width': 1.5 }));
        g.appendChild(el('path', { d: 'M-12.5 0 L-8.5 0 M-10.8 -2.6 L-8.4 0 L-10.8 2.6', fill: 'none', stroke: 'var(--s4)', 'stroke-width': 1.2 }));
        break;
      /* A5: the directional coupler that taps the tone back toward the
         master. Two coupled lines with the return arrow on the lower one. */
      case 'coupler':
        g.appendChild(el('line', { x1: -7, y1: -2.6, x2: 7, y2: -2.6, stroke: 'var(--s2)', 'stroke-width': 1.5 }));
        g.appendChild(el('line', { x1: -7, y1: 2.6, x2: 7, y2: 2.6, stroke: 'var(--s2)', 'stroke-width': 1.5 }));
        g.appendChild(el('path', { d: 'M-2.4 5.0 L-6.2 2.6 L-2.4 0.2', fill: 'none', stroke: 'var(--s2)', 'stroke-width': 1.2 }));
        break;
      /* A5: the master's mixer and correction servo, where outgoing and
         returned are compared. */
      case 'phasedet':
        g.appendChild(el('rect', { x: -12, y: -9, width: 24, height: 18, rx: 3, fill: 'var(--bg-panel)', stroke: 'var(--s2)', 'stroke-width': 1.6 }));
        g.appendChild(el('text', { y: 3.8, 'text-anchor': 'middle', fill: 'var(--s2)', 'font-size': 10 }, 'Δφ'));
        break;
      /* B4: a channel driving current into the virtual ground — the
         standard current-source symbol, deliberately NOT the resistor of
         B1, because the difference between the two is the option. */
      case 'src':
        g.appendChild(el('circle', { r: 5, fill: 'var(--bg-panel)', stroke: 'var(--s4)', 'stroke-width': 1.4 }));
        g.appendChild(el('path', { d: 'M0 3.2 L0 -3.2 M-2 -1 L0 -3.4 L2 -1', fill: 'none', stroke: 'var(--s4)', 'stroke-width': 1.3 }));
        break;
      /* B5: the converter and its serial lane. The ADC keeps the usual
         trapezoid so it reads as a converter and not as an amplifier. */
      case 'adc':
        g.appendChild(el('path', { d: 'M-7 -6 L7 -3.2 L7 3.2 L-7 6 Z', fill: 'var(--bg-panel)', stroke: 'var(--s1)', 'stroke-width': 1.4 }));
        break;
      case 'serdes':
        g.appendChild(el('rect', { x: -8, y: -6, width: 16, height: 12, rx: 2, fill: 'var(--bg-panel)', stroke: 'var(--s1)', 'stroke-width': 1.4 }));
        g.appendChild(el('path', { d: 'M-4.5 2.6 L-1 2.6 L-1 -2.6 L2.5 -2.6 L2.5 2.6 L5 2.6', fill: 'none', stroke: 'var(--s1)', 'stroke-width': 1.2 }));
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
  function lodFor(visibleTiles, radPerTile) {
    /* Radiators drop out FIRST and at a much lower tile count than dies,
       because there are far more of them: 25 tiles x 16 ports x 64
       radiators is 25 600 glyphs, against 100 dies. The threshold is on the
       glyph count rather than on tiles, so a 1x1 arrangement keeps its
       radiators far longer than an 8x8 one. */
    var perTile = Math.max(1, radPerTile || 1);
    /* 12 000 keeps the 4x4 cluster (6 400 here) drawn, which is the case
       most worth looking at, and drops the 8x8 (25 600) which is not worth
       the frame time. Measured, not guessed. */
    var antBudget = 12000;
    var ants = visibleTiles * perTile <= antBudget;
    var antNote = ants ? '' : 'radiators hidden above ' + antBudget.toLocaleString() +
      ' of them on screen (' + (visibleTiles * perTile).toLocaleString() +
      ' here) — zoom in to see them';
    if (visibleTiles <= 120) {
      return {
        tier: 'full', dies: true, taps: true, blocks: true, links: 99, tips: true,
        ants: ants, note: antNote
      };
    }
    if (visibleTiles <= 500) {
      return {
        tier: 'no-dies', dies: false, taps: false, blocks: true, links: 99, tips: true, ants: false,
        note: 'dies, radiators and their LO taps hidden above 120 visible tiles — zoom in to see them'
      };
    }
    if (visibleTiles <= 1500) {
      return {
        tier: 'network', dies: false, taps: false, blocks: false, links: 99, tips: false, ants: false,
        note: 'dies, taps and block symbols hidden, and tooltips off, above 500 visible tiles — zoom in for detail'
      };
    }
    return {
      tier: 'coarse', dies: false, taps: false, blocks: false, links: 6, tips: false, ants: false,
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
    /* A caller may ask for a RECTANGLE IN CENTIMETRES instead of a zoom and a
       centre — the single-tile view does, passing one tile's own {x,y,w,h}.
       It is expressed as a zoom so that everything downstream is unchanged:
       the same clamp keeps it inside the drawing, the same visCm drives the
       same culling, and lodFor sees a genuine visible-tile count and turns
       the dies, taps and tooltips on by itself. A second renderer would have
       had to re-earn the cell parallelogram, the per-axis radiator cap and
       the screen-space size floors, each of which exists because it once got
       drawn wrong. */
    var Z, cxCm, cyCm;
    if (view.fitRectCm) {
      var fr = view.fitRectCm;
      var padCm = (fr.padCm === undefined ? 0.35 : fr.padCm);
      var needCm = Math.max(fr.w, fr.h) + padCm * 2;
      /* W/scale is the drawing's full width in cm including its board margin;
         the zoom that makes `needCm` fill the shorter axis is their ratio */
      Z = Math.max(1, Math.min(64, Math.min(W, H) / scale / Math.max(needCm, 1e-6)));
      cxCm = fr.x + fr.w / 2;
      cyCm = fr.y + fr.h / 2;
    } else {
      Z = Math.max(1, view.zoom || 1);
      cxCm = view.panXCm === undefined ? apCm / 2 : view.panXCm;
      cyCm = view.panYCm === undefined ? apCm / 2 : view.panYCm;
    }
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
    /* Every tile rect, kept so the click can be resolved by GEOMETRY rather
       than by whatever happened to be on top. See the delegated handler at
       the end of this function. */
    var tileEls = [];
    var shown = grid.tiles.filter(tileVisible);
    var t0lod = grid.tiles[0];
    var radsPerTile = t0lod && t0lod.rads ? t0lod.rads.length : 0;
    var lod = lodFor(shown.length, radsPerTile);
    /* explicit layer switches always win over the LOD default */
    var wantDies = view.showDies !== false && lod.dies;
    var dieFloored = false;
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
    /* Text is drawn in viewBox units, so it has to be divided by the zoom to
       hold a constant size on screen. That division is applied as an INLINE
       STYLE and not as a font-size attribute, because the stylesheet's
       `svg.chart text { font: 10.5px … }` is a CSS declaration and beats a
       presentation attribute — so the compensation was computed correctly and
       then thrown away, and every caption grew with the zoom. It was
       invisible at Z = 1, where 10.5/1 is exactly the stylesheet value, and
       it went unnoticed because nothing else renders at a fixed high zoom;
       the cropped single-tile view does, at Z ≈ 4.7, where the aperture
       caption came out 50 px tall. */
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
      x: X(apCm / 2), y: Y(-marg) - 12 / Z, 'text-anchor': 'middle', fill: 'var(--ink-3)', style: 'font-size:' + fs(10.5) + 'px'
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
      /* No per-rect click listener: the tile is frequently NOT the topmost
         element at the point the reader aims at, so a listener here only
         fires when nothing is drawn over it. Resolved by geometry instead,
         once, at the end of this function. */
      tileEls.push({ el: r, i: t.i });
      tileG.appendChild(r);

      if (t.hop && lod.tier === 'full') tileG.appendChild(el('text', {
        x: X(t.x + t.w) - 4 / Z, y: Y(t.y) + 11 / Z, 'text-anchor': 'end',
        style: 'font-size:' + fs(9) + 'px', fill: 'var(--ink-3)'
      }, t.hop));
    });
    svg.appendChild(tileG);

    /* ---- radiators, drawn to scale, UNDER the dies and the network ----
       Two glyphs, because they are two different things and the map is
       where that stops being an abstract point: a hollow ring for the
       controllable PORT (one phase shifter, one entry in the beamformer's
       state) and a filled square for each RADIATOR behind it. At K = 1
       they coincide and the picture is the old one. At K = 64 one ring
       has sixty-four squares inside it and the beamformer still sees one
       number.

       Drawn from t.rads, which topology.js lays out on g.latOffsetsCm —
       the same lattice beam.js integrates over — so what is on screen and
       what is in the numbers cannot drift apart. */
    var antsShown = view.showAnts !== false && lod.ants;
    var antFloored = false;
    if (antsShown) {
      var antG = el('g');
      var antCol = 'var(--s5)';
      /* The in-cell feed is deliberately NOT drawn. The model knows its mean
         route length, which is what the loss is computed from; it does not
         know the tree's shape, and drawing a specific one — a star, an H —
         would assert geometry nobody chose. The port ring is what says these
         radiators are fed together. */
      shown.forEach(function (t) {
        /* Floors are in SCREEN space (divided by Z), not viewBox units. A
           viewBox-unit floor is an absolute size in centimetres that zoom
           only magnifies, so it silently replaced the physical size the
           legend was simultaneously quoting AND re-created the very overlap
           the per-axis cap exists to prevent. In screen space the floor is a
           legibility minimum that zooming in dissolves, and antScaled
           records whether it bit so the legend can stop saying "to scale". */
        (t.rads || []).forEach(function (a) {
          var wx = a.wx * scale, wy = a.wy * scale;
          var fx = Math.max(0.6 / Z, wx), fy = Math.max(0.6 / Z, wy);
          if (fx > wx + 1e-9 || fy > wy + 1e-9) antFloored = true;
          antG.appendChild(el('rect', {
            x: X(a.x) - fx / 2, y: Y(a.y) - fy / 2, width: fx, height: fy,
            fill: antCol, 'fill-opacity': 0.55, stroke: 'none',
            /* a filled rect IS hit-testable, and these sit on top of the
               tile; they carry no tooltip, so they would only ever have
               swallowed the tile's click */
            'pointer-events': 'none'
          }));
        });
        /* The port's CELL, drawn as the rectangle it actually is. This was a
           circle sized from sqrt(ports per tile), which assumes a SQUARE
           arrangement: under the 'row' in-tile lattice the cell is
           3.75 x 60 mm and that circle was 3.4x too wide in x, so every
           ring overlapped its neighbours and none of them showed the cell
           the fill percentage is computed against. */
        /* The cell is the PARALLELOGRAM spanned by the lattice basis, drawn
           as a polygon so it is exactly right on a sheared sublattice and
           degenerates to the old rectangle on a rectangular one. No size
           floor: a floor on a tiling shape makes adjacent cells overlap
           instead of tile, which defeats the one glyph whose entire job is
           to state the cell honestly. */
        var A1 = t.cellA1 || [t.cellXCm || grid.tileCm, 0];
        var A2 = t.cellA2 || [0, t.cellYCm || grid.tileCm];
        var corners = [
          [(-A1[0] - A2[0]) / 2, (-A1[1] - A2[1]) / 2],
          [(A1[0] - A2[0]) / 2, (A1[1] - A2[1]) / 2],
          [(A1[0] + A2[0]) / 2, (A1[1] + A2[1]) / 2],
          [(-A1[0] + A2[0]) / 2, (-A1[1] + A2[1]) / 2]
        ];
        (t.ports || []).forEach(function (p) {
          var c = el('polygon', {
            points: corners.map(function (k) {
              return X(p.x + k[0]).toFixed(2) + ',' + Y(p.y + k[1]).toFixed(2);
            }).join(' '),
            fill: 'none', stroke: antCol, 'stroke-width': 0.7, 'stroke-opacity': 0.45,
            'stroke-dasharray': '2 2', 'vector-effect': 'non-scaling-stroke'
          });
          if (lod.tips) c.appendChild(el('title', null,
            'tile ' + t.i + ' · port ' + p.i + ' of ' + t.ports.length + '\n' +
            'ONE controllable RF channel — one phase shifter\n' +
            'cell ' + (t.cellAreaCm2 * 100).toFixed(1) + ' mm², extent ' +
            (t.cellXCm * 10).toFixed(2) + ' × ' + (t.cellYCm * 10).toFixed(2) + ' mm\n' +
            t.radPerPort + ' radiator' + (t.radPerPort === 1 ? '' : 's') + ' behind it, fed in fixed phase\n' +
            'the beamformer cannot see inside this cell'));
          /* The cell keeps its tooltip, so it cannot be made transparent to
             the pointer like the rest of the decoration — but its dashed
             stroke lies across the tile, and a click landing there did
             nothing at all. A port belongs to exactly one tile, so send the
             click where the reader plainly meant it to go. */
          c.style.cursor = 'pointer';
          antG.appendChild(c);
        });
      });
      svg.appendChild(antG);
    }

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
          /* screen-space floor, for the same reason as the radiators: in
             viewBox units this drew a 2.81 mm die above a 53 cm aperture
             while the legend beside it said "2.5 mm, to scale" */
          var wTrue = d.w * scale;
          var w = Math.max(3 / Z, wTrue);
          if (w > wTrue + 1e-9) dieFloored = true;
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
        fill: 'var(--s3)', style: 'font-size:' + fs(10.5) + 'px'
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
        /* A round-trip-stabilised line carries the return on the same
           trace. Drawn as a dashed companion stroke offset by a couple of
           screen pixels: the line is one line, and the second stroke says
           it is used in both directions without pretending there is a
           second route on the board. Offset in SCREEN space, since the
           strokes are non-scaling. */
        if (L.bidir) {
          var vert = Math.abs(L.x2 - L.x1) < 1e-9;
          var dx = vert ? (st.w + 1.4) / Z : 0;
          var dy = vert ? 0 : (st.w + 1.4) / Z;
          linkG.appendChild(nss(el('line', {
            x1: X(L.x1) + dx, y1: Y(L.y1) + dy, x2: X(L.x2) + dx, y2: Y(L.y2) + dy,
            stroke: st.stroke, 'stroke-width': Math.max(0.9, st.w * 0.55),
            'stroke-dasharray': '3 2.6', 'stroke-opacity': 0.75, 'stroke-linecap': 'butt'
          })));
        }
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
        fill: 'var(--ink-2)', style: 'font-size:' + fs(10.5) + 'px'
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
    /* Client coordinates -> a fraction of the CURRENT viewBox.

       This used to be (clientX - rect.left) / rect.width, which is a fraction
       of the ELEMENT BOX — and the element box is not the drawing. The map is
       drawn with preserveAspectRatio "xMidYMid meet" inside a box capped at
       76vh, so it is letterboxed: measured at the default desktop size the
       box is 640 x 653 px while the drawing occupies 540 x 653, leaving 50 px
       of dead band on each side. A cursor on the left edge of the drawing
       therefore reported fx = 0.078 instead of 0, so zoom-at-cursor anchored
       about 8% off and the map crept out from under the pointer as it zoomed.

       getScreenCTM() is the browser's own client-to-user transform. It
       already accounts for the viewBox, preserveAspectRatio and any CSS
       scaling, so unlike hand-rolled arithmetic it cannot fall out of step
       with them when one of those changes. */
    function fracOf(e) {
      var m = svg.getScreenCTM && svg.getScreenCTM();
      if (m && m.a && svg.createSVGPoint) {
        var p = svg.createSVGPoint();
        p.x = e.clientX; p.y = e.clientY;
        var u = p.matrixTransform(m.inverse());
        return {
          fx: Math.max(0, Math.min(1, (u.x - cur.vx) / cur.vw)),
          fy: Math.max(0, Math.min(1, (u.y - cur.vy) / cur.vh))
        };
      }
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
      /* User units per CSS pixel, from the browser's own transform. This was
         cur.vw / b.width, which ignores the same letterbox fracOf did: at the
         default desktop size that is 716/640 = 1.119 against a true
         1/0.7548 = 1.325, so the map moved at 84% of hand speed and slid
         behind the cursor throughout every drag. `meet` scales both axes
         equally, so m.a serves for x and y alike. */
      var ctm = svg.getScreenCTM && svg.getScreenCTM();
      var unitsPerPx = (ctm && ctm.a) ? 1 / ctm.a : cur.vw / b.width;
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

    /* ------------------------------------------------------------------ *
     * SELECTING A TILE, RESOLVED BY GEOMETRY.
     *
     * This used to be a click listener on each tile rect, which only fires
     * when the rect is the topmost thing under the pointer — and on this
     * drawing it very often is not. Everything the map layers over the
     * tiles is hit-testable: the routing traces, the port cells, the
     * radiator patches, and a block glyph sitting at dead centre of every
     * tile. Measured on the default build, EIGHT of the twenty visible
     * tiles could not be selected at any of five sample points, and the
     * single most natural place to aim — the middle of the tile — was
     * covered on all of them by the per-tile multiplier glyph.
     *
     * Exempting each offender in turn does not hold: the glyphs and the
     * port cells carry tooltips, so they cannot simply be made transparent
     * to the pointer, and any layer added later would reintroduce the bug
     * silently. So the click is resolved against the tile RECTANGLES
     * instead of against the paint order. Whatever is drawn on top, a click
     * inside a tile selects that tile, and the decoration keeps its hover.
     * ------------------------------------------------------------------ */
    svg.addEventListener('click', function (e) {
      if (dragMoved) return;                 /* that was a pan, not a click */
      for (var i = 0; i < tileEls.length; i++) {
        var r = tileEls[i].el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right &&
            e.clientY >= r.top && e.clientY <= r.bottom) {
          onSelect(tileEls[i].i);
          return;
        }
      }
    });

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

    /* The legend needs to know what was ACTUALLY drawn — LOD tier, layer
       toggles and size floors all — or it describes swatches that are not
       on screen and quotes sizes that are not what was rendered. */
    return {
      svg: svg, lod: lod, visible: shown.length, zoom: Z,
      drew: {
        ants: !!antsShown, dies: !!wantDies,
        antFloored: antFloored, dieFloored: dieFloored
      }
    };
  }

  /* `info` is renderMap's return: { lod, drew: {ants, dies, antFloored,
     dieFloored} }. The legend must be gated on what was DRAWN, not on what
     the data could support — the LOD tier, the toolbar layer switches and
     the size floors all change what is on screen. */
  function renderLegend(mount, built, info) {
    var lod = (info && info.lod) || info || null;
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

    if (built.lo.net.links.some(function (L) { return L.bidir; })) {
      var rl = document.createElement('span');
      rl.className = 'li';
      rl.innerHTML = '<span class="sw dash" style="border-top-color:' +
        BAND_STYLE[bandOf(built.lo.distFreqHz)].stroke + '"></span>' +
        'return path — the same trace, read back at the master';
      wrap.appendChild(rl);
    }

    var bl = document.createElement('span');
    bl.className = 'li';
    bl.innerHTML = '<span class="sw dash" style="border-top-color:' + BB_STYLE.stroke + '"></span>' + BB_STYLE.name;
    wrap.appendChild(bl);

    var t0 = built.grid.tiles[0];
    var drew = (info && info.drew) || {};
    var diesDrawn = drew.dies !== undefined ? drew.dies : !!(t0 && t0.dies);
    if (t0 && t0.dies && diesDrawn) {
      var dl = document.createElement('span');
      dl.className = 'li';
      dl.innerHTML = '<span style="display:inline-block;width:9px;height:9px;background:var(--ink);opacity:.62;' +
        'border:0.9px solid ' + BAND_STYLE.eband.stroke + '"></span>' +
        t0.dies.length + ' RFIC dies per tile, 2.5 mm' +
        (drew.dieFloored ? ', drawn at a legibility minimum — zoom in for true scale' : ', to scale') +
        ' — each with one 78 GHz LO tap';
      wrap.appendChild(dl);
    }
    /* Ports and radiators get hand-written rows beside the die row rather
       than going through glyph()/order/names, because like the die they are
       drawn as scaled geometry and not as a fixed-size block symbol. */
    /* A legend row for something the LOD has dropped is worse than no row:
       it tells the reader a swatch is on screen when it is not. Both rows
       are therefore gated on lod.ants, and when the radiators are hidden
       the row says so rather than disappearing silently. */
    var antsDrawn = drew.ants !== undefined ? drew.ants : (!lod || lod.ants !== false);
    if (t0 && t0.ports && t0.ports.length && antsDrawn) {
      var pl = document.createElement('span');
      pl.className = 'li';
      /* the swatch mirrors the cell's real aspect, clamped so a 16:1 cell
         does not produce a 1 px sliver in the legend */
      var ar = Math.max(0.25, Math.min(4, t0.cellXCm / Math.max(t0.cellYCm, 1e-9)));
      var sw = Math.round(11 * Math.min(1, ar)), sh = Math.round(11 * Math.min(1, 1 / ar));
      pl.innerHTML = '<span style="display:inline-block;width:' + sw + 'px;height:' + sh + 'px;' +
        'border:1px dashed var(--s5);opacity:.7;vertical-align:middle"></span>' +
        t0.ports.length + ' controllable ports per tile — one phase shifter each, ' +
        'the dashed outline is its ' + (t0.cellAreaCm2 * 100).toFixed(1) + ' mm² cell';
      wrap.appendChild(pl);

      var al = document.createElement('span');
      al.className = 'li';
      /* ONE size claim, not two. The physical footprint is always quoted;
         whether it was drawn smaller is a separate clause. */
      al.innerHTML = '<span style="display:inline-block;width:7px;height:7px;background:var(--s5);' +
        'opacity:.55;vertical-align:middle"></span>' +
        (t0.radPerPort === 1
          ? 'one radiator per port, ' + (t0.radFootprintCm * 10).toFixed(2) + ' mm'
          : t0.radPerPort + ' radiators per port (' + t0.rads.length + ' per tile), ' +
            (t0.radFootprintCm * 10).toFixed(2) + ' mm each — fixed feed, invisible to the beamformer') +
        (t0.radCappedToPitch
          ? ' · drawn ' + (t0.radCapXCm * 10).toFixed(2) + ' × ' + (t0.radCapYCm * 10).toFixed(2) +
            ' mm, capped to the pitch: the isolated footprint does not fit'
          : drew.antFloored ? ' · drawn at a legibility minimum — zoom in for true scale' : ', to scale');
      wrap.appendChild(al);
    } else if (t0 && t0.ports && t0.ports.length) {
      var hl = document.createElement('span');
      hl.className = 'li';
      hl.textContent = 'ports and radiators not drawn at this zoom — ' +
        (t0.rads.length * built.grid.nTiles).toLocaleString() + ' glyphs';
      wrap.appendChild(hl);
    }

    var seen = {};
    /* Every node type a topology can emit needs a row here. A type that is
       missing falls through glyph()'s default to an unlabelled dot and then
       never appears in the legend at all, which is how four of the newer
       blocks — the coupler, the injection-locked tank, the current source
       and the serialiser — were being drawn as anonymous specks. */
    var order = ['source', 'split', 'amp', 'buftap', 'tap', 'pll', 'mult', 'ilo',
                 'coupler', 'phasedet', 'term',
                 'backend', 'sum', 'res', 'src', 'cell', 'drv', 'adc', 'serdes'];
    var names = {
      source: 'LO source', split: 'splitter', amp: 'repeater amp', buftap: 'buffer + tap',
      tap: 'tap', pll: 'per-tile PLL', mult: 'per-tile multiplier',
      ilo: 'injection-locked tile oscillator', coupler: 'return-path coupler',
      phasedet: 'round-trip phase detector', term: 'termination',
      backend: 'RFSoC backend', sum: 'resistive summing node', res: 'resistive arm',
      src: 'channel current source', cell: 'active combine cell', drv: 'baseband driver',
      adc: 'per-tile converter', serdes: 'serial lane to the backend'
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
      [lo.kind === 'chain' ? 'Chain hop' : lo.kind === 'radial' ? 'Radial run' : 'Tree level',
       lo.kind === 'chain' ? t.hop + ' of ' + lo.maxHop
         : lo.kind === 'radial'
           ? 'one junction, equalised to ' + (lo.equalisedCm || 0).toFixed(1) + ' cm' +
             (t.meanderCm > 0.05 ? ' (' + t.meanderCm.toFixed(1) + ' cm of meander)' : ' (corner tile, no meander)')
           : t.level + ' of ' + lo.net.maxLevel],
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
      /* was hard-coded 8, which silently lied the moment chPerDiePerDir
         became something the model derived rather than assumed */
      var perDir = g.chPerDiePerDir || 4;
      rows.push(['RF channels', (t.dies.length * perDir * 2) + ' (' + perDir + ' RX + ' + perDir +
        ' TX per die, each an IQ pair at baseband)']);
      rows.push(['78 GHz LO taps', String(t.dies.length)]);
      rows.push(['Intra-tile LO fan-out', t.tapRoutedCm.toFixed(1) + ' cm routed at ' + g.fLoGHz + ' GHz']);
    }
    if (t.ports && t.ports.length) {
      rows.push(['— antenna in this tile —', '']);
      rows.push(['Controllable ports', t.ports.length + ' — one phase shifter each, on a ' +
        (g.elemDxCm || 0).toFixed(2) + ' cm lattice']);
      rows.push(['Radiators per port', String(t.radPerPort) +
        (t.radPerPort > 1 ? ' (' + g.radKx + ' × ' + g.radKy + ', fixed feed)' : '')]);
      /* the PHYSICAL footprint. This used to print the pitch-capped DRAWING
         width, so the table and the legend stated different sizes for the
         same object on the same screen — and the table stated the one that
         does not exist. */
      rows.push(['Radiators in this tile', String(t.rads.length) + ' × ' +
        (t.radFootprintCm * 10).toFixed(2) + ' mm footprint' +
        (t.radCappedToPitch
          ? ' — drawn ' + (t.radCapXCm * 10).toFixed(2) + ' × ' + (t.radCapYCm * 10).toFixed(2) +
            ' mm, capped to the pitch'
          : '')]);
      if (t.radPerPort > 1) {
        rows.push(['In-cell radiator pitch', (g.radPitchXCm * 10).toFixed(2) + ' mm (' +
          (g.radPitchXCm / g.lamCm).toFixed(2) + ' λ)' + (g.radSpanning ? ' — spans the cell' : '')]);
        rows.push(['In-cell feed', (g.antFeedRouteCm * 10).toFixed(1) + ' mm routed, ' +
          g.antFeedStages + ' split stages, ' + (g.antFeedLossDb || 0).toFixed(2) + ' dB']);
      }
      rows.push(['Cell fill', (g.cellFillPct || 0).toFixed(2) + '% of ' +
        (g.aCellMm2 || 0).toFixed(0) + ' mm² — element ' + (g.dElDbi || 0).toFixed(2) +
        ' dBi against a ' + (g.dCellDbi || 0).toFixed(2) + ' dBi ceiling']);
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

  /* ====================================================================== *
   * THE SILICON IN ONE TILE — the tile's baseband dies and one RFIC die,
   * drawn in ONE svg so that "same scale" is structural rather than
   * asserted. Two separate svgs cannot be held to the same px-per-mm:
   * .chartgrid is auto-fit minmax and svg.chart is width:100%, so equal
   * scale in a caption would be a claim the layout does not keep.
   *
   * THE BASEBAND DIE IS DRAWN AS BANDS, deliberately, and not as a treemap
   * or a floorplan. A band's HEIGHT is area / dieEdge, so the one dimension
   * that varies is linear in the one quantity being asserted, and the
   * utilisation ceiling is then a real horizontal line at that fraction of
   * the die rather than a number in a caption. A treemap would be
   * area-exact too, but it looks like a placement, and no placement has
   * been done.
   *
   * THE RFIC DIE IS DRAWN EMPTY. The model carries four facts about it —
   * 2.5 x 2.5 mm, four real channels per direction, one LO tap, and a
   * lumped 30 dB of gain used only as a divisor in the baseband noise
   * penalty. There is no block library for its interior, so there is
   * nothing to draw there, and an empty box beside a packed one at the same
   * size says that better than any footnote. What crosses its edges is
   * drawn as a BRACKET per edge, not as discrete pins: the channel count
   * and the 1:1 pairing support "these cross here somewhere", and no pad
   * list exists anywhere in this tool to support more than that.
   * ==================================================================== */
  function renderTileSilicon(mount, bbRes, g, view) {
    mount.textContent = '';
    var dieMm = g.bbDieMm;
    var nDies = Math.max(1, g.bbDiesPerTile);
    var PX = 118;                                  /* px per mm, both dies */
    var dieW = dieMm * PX / 2.5;                   /* keep 2.5 mm ≈ 118 px */
    var GAP = 26, LEFT = 54, TOP = 58, LABEL = 46;
    var perRow = nDies + 1;                        /* baseband dies + one RFIC */
    var W = LEFT + perRow * (dieW + GAP) + 210;
    var H = TOP + dieW + LABEL + 76;
    var svg = el('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H,
      preserveAspectRatio: 'xMidYMid meet', role: 'img' });

    var blocks = bbRes.dieBlocks || [];
    var singles = blocks.filter(function (b) { return b.singleton; });
    var spread = blocks.filter(function (b) { return !b.singleton; });
    var spreadArea = spread.reduce(function (a, b) { return a + b.areaOnWorstDieMm2; }, 0);
    var singleArea = singles.reduce(function (a, b) { return a + b.areaOnWorstDieMm2; }, 0);
    var dieArea = g.bbDieAreaMm2;
    var COL = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s6)', 'var(--s5)'];

    /* one band per block, height linear in area */
    function drawDie(x, y, carriesSingletons, dieIdx) {
      var gEl = el('g', null);
      var used = spreadArea + (carriesSingletons ? singleArea : 0);
      var util = 100 * used / Math.max(dieArea, 1e-9);

      gEl.appendChild(el('rect', { x: x, y: y, width: dieW, height: dieW,
        fill: 'var(--bg-sunken)', stroke: 'var(--rule-strong)', 'stroke-width': 1.4 }));

      var list = (carriesSingletons ? singles.concat(spread) : spread)
        .filter(function (b) { return b.areaOnWorstDieMm2 > 0; })
        .slice().sort(function (a, b) { return b.areaOnWorstDieMm2 - a.areaOnWorstDieMm2; });
      var cy = y + dieW, ci = 0;
      list.forEach(function (b) {
        var hPx = (b.areaOnWorstDieMm2 / Math.max(dieArea, 1e-9)) * dieW;
        var col = COL[ci++ % COL.length];
        var overflowsHere = cy - hPx < y;
        var top = Math.max(y, cy - hPx);
        var band = el('rect', { x: x, y: top, width: dieW, height: Math.max(0.7, cy - top),
          fill: col, 'fill-opacity': b.singleton ? 0.85 : 0.45, stroke: 'none' });
        band.appendChild(el('title', null,
          b.name + '\n' + b.areaOnWorstDieMm2.toFixed(4) + ' mm² on this die' +
          (b.singleton
            ? '\nper-TILE singleton: all ' + b.countPerTile + ' land on this one die'
            : '\n' + b.countPerTile + ' per tile / ' + nDies + ' dies = ' +
              b.countOnWorstDie + (b.divides ? '' : '  (does not divide — this is AREA, not a count)')) +
          '\n' + b.areaEachMm2 + ' mm² each'));
        gEl.appendChild(band);
        cy -= hPx;
        if (overflowsHere) {
          /* what will not fit is drawn OUTSIDE the die, above it, so the die
             square never rescales to accommodate an overflow — the square is
             the silicon and it does not grow */
          var over = el('rect', { x: x, y: y - (hPx - (cy + hPx - y)) - 2, width: dieW,
            height: Math.max(1, (hPx - (cy + hPx - y))), fill: 'var(--fail)', 'fill-opacity': 0.3,
            stroke: 'var(--fail)', 'stroke-width': 1, 'stroke-dasharray': '3 2' });
          gEl.appendChild(over);
        }
      });

      /* the utilisation ceiling, a real line at its real height */
      var ceilY = y + dieW * (1 - g.bbDieUtilMaxPct / 100);
      var cl = el('line', { x1: x - 5, y1: ceilY, x2: x + dieW + 5, y2: ceilY,
        stroke: 'var(--s5)', 'stroke-width': 1.4, 'stroke-dasharray': '5 3' });
      cl.appendChild(el('title', null, g.bbDieUtilMaxPct + '% core-utilisation ceiling'));
      gEl.appendChild(cl);

      gEl.appendChild(el('text', { x: x + dieW / 2, y: y + dieW + 15, 'text-anchor': 'middle',
        fill: 'var(--ink-2)', 'font-size': 11 },
        'BB die ' + (dieIdx + 1) + (carriesSingletons ? ' — carries the singletons' : '')));
      var pct = el('text', { x: x + dieW / 2, y: y + dieW + 29, 'text-anchor': 'middle',
        'font-size': 11.5, fill: util > g.bbDieUtilMaxPct ? 'var(--fail)' : 'var(--ink-3)' },
        util.toFixed(1) + '% of ' + dieArea.toFixed(2) + ' mm²');
      gEl.appendChild(pct);
      svg.appendChild(gEl);
    }

    for (var d = 0; d < nDies; d++) {
      drawDie(LEFT + d * (dieW + GAP), TOP, d === 0, d);
    }

    /* ---- the RFIC die: same size, same scale, and empty ---- */
    var rx = LEFT + nDies * (dieW + GAP) + 18;
    svg.appendChild(el('line', { x1: rx - 12, y1: TOP - 14, x2: rx - 12, y2: TOP + dieW + 34,
      stroke: 'var(--rule-strong)', 'stroke-width': 1 }));
    var rg = el('g', null);
    rg.appendChild(el('rect', { x: rx, y: TOP, width: dieW, height: dieW,
      fill: 'var(--bg-sunken)', stroke: 'var(--ink-3)', 'stroke-width': 1.4,
      'stroke-dasharray': '5 3' }));
    ['no internal block', 'library — the model', 'does not know what', 'is in here'].forEach(function (ln, i) {
      rg.appendChild(el('text', { x: rx + dieW / 2, y: TOP + dieW / 2 - 20 + i * 13,
        'text-anchor': 'middle', 'font-size': 10.5, fill: 'var(--ink-3)' }, ln));
    });
    /* brackets, not pins: the counts are known, the positions are not */
    function bracket(x1, y1, x2, y2, label, lx, ly, anchor) {
      rg.appendChild(el('path', { d: 'M' + x1 + ' ' + y1 + ' L' + x2 + ' ' + y2,
        stroke: 'var(--s2)', 'stroke-width': 2.4, fill: 'none' }));
      rg.appendChild(el('text', { x: lx, y: ly, 'text-anchor': anchor || 'middle',
        'font-size': 10, fill: 'var(--s2)' }, label));
    }
    bracket(rx - 4, TOP + 6, rx - 4, TOP + dieW - 6,
      g.chPerDiePerDir + ' RF channels', rx - 8, TOP + dieW / 2 - 4, 'end');
    bracket(rx + dieW + 4, TOP + 6, rx + dieW + 4, TOP + dieW - 6,
      g.bbIqChPerDie + ' IQ pairs', rx + dieW + 8, TOP + dieW / 2 - 4, 'start');
    var loY = TOP + dieW + 4;
    bracket(rx + 6, loY, rx + dieW - 6, loY, '1 LO tap at ' + g.fLoGHz + ' GHz',
      rx + dieW / 2, loY + 13, 'middle');
    rg.appendChild(el('text', { x: rx + dieW / 2, y: TOP + dieW + 29, 'text-anchor': 'middle',
      'font-size': 11.5, fill: 'var(--ink-3)' }, 'RFIC die — ' + (2.5).toFixed(1) + ' × 2.5 mm SiGe'));
    svg.appendChild(rg);

    /* ---- scale bar and headings ---- */
    svg.appendChild(el('text', { x: LEFT, y: 22, 'font-size': 12, fill: 'var(--ink-2)',
      'font-weight': 600 }, nDies + ' baseband dies (65 nm LP) — packed from real areas'));
    svg.appendChild(el('text', { x: rx, y: 22, 'font-size': 12, fill: 'var(--ink-2)',
      'font-weight': 600 }, 'one RFIC die — a boundary'));
    svg.appendChild(el('text', { x: LEFT, y: 40, 'font-size': 10.5, fill: 'var(--ink-3)' },
      'band height = area ÷ ' + dieMm + ' mm, stacked from the bottom · dashed red line = ' +
      g.bbDieUtilMaxPct + '% ceiling'));
    var sbY = TOP + dieW + LABEL + 22;
    svg.appendChild(el('line', { x1: LEFT, y1: sbY, x2: LEFT + dieW, y2: sbY,
      stroke: 'var(--ink-3)', 'stroke-width': 1.2 }));
    svg.appendChild(el('line', { x1: LEFT, y1: sbY - 4, x2: LEFT, y2: sbY + 4, stroke: 'var(--ink-3)' }));
    svg.appendChild(el('line', { x1: LEFT + dieW, y1: sbY - 4, x2: LEFT + dieW, y2: sbY + 4, stroke: 'var(--ink-3)' }));
    svg.appendChild(el('text', { x: LEFT + dieW / 2, y: sbY + 15, 'text-anchor': 'middle',
      'font-size': 10.5, fill: 'var(--ink-3)' }, dieMm + ' mm — both dies at this scale'));

    mount.appendChild(svg);
    return { util: 100 * (spreadArea + singleArea) / Math.max(dieArea, 1e-9) };
  }

  window.Diagram = {
    renderMap: renderMap,
    renderLegend: renderLegend,
    renderInspector: renderInspector,
    renderBom: renderBom,
    renderBbDiagram: renderBbDiagram,
    renderTileSilicon: renderTileSilicon,
    rampColor: rampColor,
    bandOf: bandOf
  };
})();
