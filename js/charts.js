/* ============================================================================
   charts.js — dependency-free inline-SVG plotting for the distribution tool.
   Deliberately no chart library: this has to work as a static GitHub Pages
   page with no build step, and phase-noise plots need a real log-decade axis.
   Exposes window.Charts.
   ========================================================================= */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, text) {
    var n = document.createElementNS(SVGNS, name);
    if (attrs) for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, String(attrs[k]));
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  /* SI-ish tick label for a frequency axis */
  function fLabel(hz) {
    if (hz >= 1e9) return (hz / 1e9) + ' GHz';
    if (hz >= 1e6) return (hz / 1e6) + ' MHz';
    if (hz >= 1e3) return (hz / 1e3) + ' kHz';
    return hz + ' Hz';
  }

  function niceStep(span, target) {
    var raw = span / Math.max(1, target);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return mult * mag;
  }

  function fmtTick(v, step) {
    var dec = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
    if (Math.abs(v) >= 1e4) return v.toExponential(0).replace('e+', 'e');
    return v.toFixed(dec);
  }

  /* ------------------------------------------------------------------ *
   * lineChart: log-x, linear-y overlay of N series. Built for L(f).
   * cfg = { series:[{name,color,points:[{x,y}],dashed}], xLabel, yLabel,
   *         yMin, yMax, xMin, xMax, height, mask:[{x,y}], maskName }
   * ------------------------------------------------------------------ */
  function lineChart(cfg) {
    var W = 660, H = cfg.height || 300;
    var m = { l: 52, r: 12, t: 10, b: 40 };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var svg = el('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet', role: 'img' });

    var all = [];
    (cfg.series || []).forEach(function (s) { (s.points || []).forEach(function (p) { all.push(p); }); });
    if (cfg.mask) cfg.mask.forEach(function (p) { all.push(p); });
    if (!all.length) { svg.appendChild(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle' }, 'no data')); return svg; }

    var xMin = cfg.xMin || Math.min.apply(null, all.map(function (p) { return p.x; }));
    var xMax = cfg.xMax || Math.max.apply(null, all.map(function (p) { return p.x; }));
    var yLo = cfg.yMin !== undefined ? cfg.yMin : Math.min.apply(null, all.map(function (p) { return p.y; }));
    var yHi = cfg.yMax !== undefined ? cfg.yMax : Math.max.apply(null, all.map(function (p) { return p.y; }));
    if (cfg.yMin === undefined) { var pad = (yHi - yLo) * 0.08 || 1; yLo -= pad; yHi += pad; }

    var lx0 = Math.log10(xMin), lx1 = Math.log10(xMax);
    function X(v) { return m.l + (Math.log10(v) - lx0) / (lx1 - lx0) * pw; }
    function Y(v) { return m.t + (yHi - v) / (yHi - yLo) * ph; }

    /* x grid: decade lines + minor ticks */
    for (var d = Math.ceil(lx0); d <= Math.floor(lx1); d++) {
      var xv = Math.pow(10, d);
      svg.appendChild(el('line', { class: 'gl', x1: X(xv), y1: m.t, x2: X(xv), y2: m.t + ph }));
      svg.appendChild(el('text', { x: X(xv), y: m.t + ph + 14, 'text-anchor': 'middle' }, fLabel(xv)));
      for (var k = 2; k <= 9; k++) {
        var xm = xv * k;
        if (xm > xMax || xm < xMin) continue;
        svg.appendChild(el('line', { class: 'gl', x1: X(xm), y1: m.t + ph, x2: X(xm), y2: m.t + ph - 4 }));
      }
    }
    /* y grid */
    var ystep = niceStep(yHi - yLo, 6);
    for (var y = Math.ceil(yLo / ystep) * ystep; y <= yHi + 1e-9; y += ystep) {
      svg.appendChild(el('line', { class: 'gl', x1: m.l, y1: Y(y), x2: m.l + pw, y2: Y(y) }));
      svg.appendChild(el('text', { x: m.l - 7, y: Y(y) + 3.5, 'text-anchor': 'end' }, fmtTick(y, ystep)));
    }
    svg.appendChild(el('line', { class: 'ax', x1: m.l, y1: m.t, x2: m.l, y2: m.t + ph }));
    svg.appendChild(el('line', { class: 'ax', x1: m.l, y1: m.t + ph, x2: m.l + pw, y2: m.t + ph }));

    function path(points) {
      var d = '';
      points.forEach(function (p, i) {
        if (!isFinite(p.y) || !isFinite(p.x) || p.x <= 0) return;
        var yc = Math.max(yLo, Math.min(yHi, p.y));
        d += (d === '' ? 'M' : 'L') + X(p.x).toFixed(2) + ' ' + Y(yc).toFixed(2);
      });
      return d;
    }

    if (cfg.mask && cfg.mask.length) svg.appendChild(el('path', { class: 'mask', d: path(cfg.mask) }));
    (cfg.series || []).forEach(function (s) {
      var p = el('path', { class: 'ser', d: path(s.points), stroke: s.color });
      /* A series may carry its own stroke pattern, so six overlapping curves
         are separated by dash as well as hue — hue alone is unreadable
         printed, projected, or with deuteranopia. dashed:true is the old
         boolean and still means the default 4 3. */
      if (s.dash) p.setAttribute('stroke-dasharray', s.dash);
      else if (s.dashed) p.setAttribute('stroke-dasharray', '4 3');
      svg.appendChild(p);
      p.appendChild(el('title', null, s.name));
    });

    if (cfg.xLabel) svg.appendChild(el('text', { class: 'axlabel', x: m.l + pw / 2, y: H - 4, 'text-anchor': 'middle' }, cfg.xLabel));
    if (cfg.yLabel) svg.appendChild(el('text', {
      class: 'axlabel', x: 0, y: 0, 'text-anchor': 'middle',
      transform: 'translate(11,' + (m.t + ph / 2) + ') rotate(-90)'
    }, cfg.yLabel));
    return svg;
  }

  /* ------------------------------------------------------------------ *
   * sweepChart: linear-x, linear-y (parameter sweeps)
   * ------------------------------------------------------------------ */
  function sweepChart(cfg) {
    var W = 660, H = cfg.height || 280;
    var m = { l: 54, r: 12, t: 10, b: 40 };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var svg = el('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet', role: 'img' });

    var all = [];
    (cfg.series || []).forEach(function (s) { (s.points || []).forEach(function (p) { all.push(p); }); });
    if (!all.length) { svg.appendChild(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle' }, 'no data')); return svg; }

    var xs = all.map(function (p) { return p.x; }), ys = all.map(function (p) { return p.y; }).filter(isFinite);
    var xLo = cfg.xMin !== undefined ? cfg.xMin : Math.min.apply(null, xs);
    var xHi = cfg.xMax !== undefined ? cfg.xMax : Math.max.apply(null, xs);
    var yLo = cfg.yMin !== undefined ? cfg.yMin : Math.min.apply(null, ys);
    var yHi = cfg.yMax !== undefined ? cfg.yMax : Math.max.apply(null, ys);
    if (cfg.yMin === undefined && cfg.yMax === undefined) {
      var p2 = (yHi - yLo) * 0.1 || Math.abs(yHi) * 0.1 || 1; yLo -= p2; yHi += p2;
      if (yLo > 0 && cfg.zeroBase !== false) yLo = 0;
    }
    if (xHi === xLo) xHi = xLo + 1;
    if (yHi === yLo) yHi = yLo + 1;

    function X(v) { return m.l + (v - xLo) / (xHi - xLo) * pw; }
    function Y(v) { return m.t + (yHi - v) / (yHi - yLo) * ph; }

    var xstep = niceStep(xHi - xLo, 6);
    for (var x = Math.ceil(xLo / xstep) * xstep; x <= xHi + 1e-9; x += xstep) {
      svg.appendChild(el('line', { class: 'gl', x1: X(x), y1: m.t, x2: X(x), y2: m.t + ph }));
      svg.appendChild(el('text', { x: X(x), y: m.t + ph + 14, 'text-anchor': 'middle' }, fmtTick(x, xstep)));
    }
    var ystep = niceStep(yHi - yLo, 6);
    for (var y2 = Math.ceil(yLo / ystep) * ystep; y2 <= yHi + 1e-9; y2 += ystep) {
      svg.appendChild(el('line', { class: 'gl', x1: m.l, y1: Y(y2), x2: m.l + pw, y2: Y(y2) }));
      svg.appendChild(el('text', { x: m.l - 7, y: Y(y2) + 3.5, 'text-anchor': 'end' }, fmtTick(y2, ystep)));
    }
    svg.appendChild(el('line', { class: 'ax', x1: m.l, y1: m.t, x2: m.l, y2: m.t + ph }));
    svg.appendChild(el('line', { class: 'ax', x1: m.l, y1: m.t + ph, x2: m.l + pw, y2: m.t + ph }));

    if (cfg.hLine !== undefined && cfg.hLine >= yLo && cfg.hLine <= yHi) {
      svg.appendChild(el('line', { class: 'mask', x1: m.l, y1: Y(cfg.hLine), x2: m.l + pw, y2: Y(cfg.hLine) }));
      svg.appendChild(el('text', { x: m.l + pw - 3, y: Y(cfg.hLine) - 5, 'text-anchor': 'end', fill: 'var(--s5)' }, cfg.hLabel || 'spec'));
    }

    (cfg.series || []).forEach(function (s) {
      var d = '';
      (s.points || []).forEach(function (p) {
        if (!isFinite(p.y)) return;
        var yc = Math.max(yLo, Math.min(yHi, p.y));
        d += (d === '' ? 'M' : 'L') + X(p.x).toFixed(2) + ' ' + Y(yc).toFixed(2);
      });
      var pe = el('path', { class: 'ser', d: d, stroke: s.color });
      if (s.dash) pe.setAttribute('stroke-dasharray', s.dash);
      else if (s.dashed) pe.setAttribute('stroke-dasharray', '4 3');
      svg.appendChild(pe);
      pe.appendChild(el('title', null, s.name));
      if (s.markers) (s.points || []).forEach(function (p) {
        if (!isFinite(p.y) || p.y < yLo || p.y > yHi) return;
        svg.appendChild(el('circle', { cx: X(p.x), cy: Y(p.y), r: 2.6, fill: s.color }));
      });
    });

    if (cfg.xLabel) svg.appendChild(el('text', { class: 'axlabel', x: m.l + pw / 2, y: H - 4, 'text-anchor': 'middle' }, cfg.xLabel));
    if (cfg.yLabel) svg.appendChild(el('text', {
      class: 'axlabel', x: 0, y: 0, 'text-anchor': 'middle',
      transform: 'translate(11,' + (m.t + ph / 2) + ') rotate(-90)'
    }, cfg.yLabel));
    return svg;
  }

  /* ------------------------------------------------------------------ *
   * barChart: grouped horizontal bars, one row per option.
   * cfg = { bars:[{name,value,color,label}], xLabel, hLine, hLabel, logX }
   * ------------------------------------------------------------------ */
  function barChart(cfg) {
    var bars = (cfg.bars || []).filter(function (b) { return isFinite(b.value); });
    var W = 660, rowH = 26, m = { l: 132, r: 58, t: 8, b: 34 };
    var H = m.t + m.b + Math.max(1, bars.length) * rowH;
    var pw = W - m.l - m.r, ph = bars.length * rowH;
    var svg = el('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet', role: 'img' });
    if (!bars.length) { svg.appendChild(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle' }, 'no data')); return svg; }

    var vmax = Math.max.apply(null, bars.map(function (b) { return b.value; }));
    var vmin = Math.min.apply(null, bars.map(function (b) { return b.value; }));
    /* The reference line has to be inside the range or it is silently not
       drawn — which happened exactly when it mattered most, on decibel
       charts where every value and the spec are negative and a spec
       stricter than every bar fell below the axis. Widen the range for it
       in BOTH directions, not just upward. */
    if (cfg.hLine !== undefined && isFinite(cfg.hLine)) {
      vmax = Math.max(vmax, cfg.hLine);
      vmin = Math.min(vmin, cfg.hLine);
    }
    var lo, hi;
    if (cfg.zeroBase === false) {
      /* dB and dBi bars are differences from an arbitrary reference, so a
         forced zero baseline compresses a decisive 0.5 dB spread into one
         pixel. Frame the data instead. */
      var span = (vmax - vmin) || Math.max(Math.abs(vmax), 1) * 0.1;
      lo = vmin - span * 0.12;
      hi = vmax + span * 0.12;
    } else {
      lo = Math.min(0, vmin);
      hi = vmax > 0 ? vmax * 1.02 : (vmax === 0 ? 1 : vmax * 0.98);
    }
    if (cfg.logX) { lo = Math.max(1e-3, vmin / 2); hi = vmax * 1.6; }
    if (hi === lo) hi = lo + 1;

    function X(v) {
      if (cfg.logX) {
        var l0 = Math.log10(lo), l1 = Math.log10(hi);
        return m.l + (Math.log10(Math.max(lo, v)) - l0) / (l1 - l0) * pw;
      }
      return m.l + (v - lo) / (hi - lo) * pw;
    }

    if (cfg.logX) {
      for (var d = Math.ceil(Math.log10(lo)); d <= Math.floor(Math.log10(hi)); d++) {
        var xv = Math.pow(10, d);
        svg.appendChild(el('line', { class: 'gl', x1: X(xv), y1: m.t, x2: X(xv), y2: m.t + ph }));
        svg.appendChild(el('text', { x: X(xv), y: m.t + ph + 14, 'text-anchor': 'middle' }, xv >= 1 ? String(xv) : String(xv)));
      }
    } else {
      var xstep = niceStep(hi - lo, 5);
      for (var x = Math.ceil(lo / xstep) * xstep; x <= hi + 1e-9; x += xstep) {
        svg.appendChild(el('line', { class: 'gl', x1: X(x), y1: m.t, x2: X(x), y2: m.t + ph }));
        svg.appendChild(el('text', { x: X(x), y: m.t + ph + 14, 'text-anchor': 'middle' }, fmtTick(x, xstep)));
      }
    }

    bars.forEach(function (b, i) {
      var y = m.t + i * rowH + 4, h = rowH - 11;
      /* bars grow from zero when zero is in range, and from the axis when
         it is not — otherwise an all-negative dB chart draws every bar from
         a point outside the plot */
      var origin = cfg.logX || cfg.zeroBase === false ? lo : Math.min(0, b.value);
      var x0 = X(origin), x1 = X(b.value);
      svg.appendChild(el('rect', { class: 'bar', x: Math.min(x0, x1), y: y, width: Math.max(1, Math.abs(x1 - x0)), height: h, rx: 2, fill: b.color }));
      /* the label gutter is fixed, so a long name would run off the left
         edge of the viewBox and simply disappear — truncate to what fits
         and keep the whole name in the tooltip */
      var maxChars = Math.max(6, Math.floor((m.l - 12) / 5.6));
      var shown = b.name.length > maxChars ? b.name.slice(0, maxChars - 1) + '…' : b.name;
      var nameEl = el('text', { x: m.l - 8, y: y + h / 2 + 3.5, 'text-anchor': 'end', fill: 'var(--ink-2)' }, shown);
      if (shown !== b.name) nameEl.appendChild(el('title', null, b.name));
      svg.appendChild(nameEl);
      svg.appendChild(el('text', { class: 'blab', x: Math.max(x0, x1) + 5, y: y + h / 2 + 3.5 }, b.label !== undefined ? b.label : b.value.toPrecision(3)));
    });

    svg.appendChild(el('line', { class: 'ax', x1: m.l, y1: m.t, x2: m.l, y2: m.t + ph }));
    svg.appendChild(el('line', { class: 'ax', x1: m.l, y1: m.t + ph, x2: m.l + pw, y2: m.t + ph }));

    if (cfg.hLine !== undefined && isFinite(cfg.hLine) && cfg.hLine > lo && cfg.hLine < hi) {
      svg.appendChild(el('line', { class: 'mask', x1: X(cfg.hLine), y1: m.t, x2: X(cfg.hLine), y2: m.t + ph }));
      svg.appendChild(el('text', { x: X(cfg.hLine), y: m.t - 1, 'text-anchor': 'middle', fill: 'var(--s5)' }, cfg.hLabel || 'spec'));
    }
    if (cfg.xLabel) svg.appendChild(el('text', { class: 'axlabel', x: m.l + pw / 2, y: H - 3, 'text-anchor': 'middle' }, cfg.xLabel));
    return svg;
  }

  /* stacked horizontal bars — for power/loss breakdowns */
  function stackChart(cfg) {
    var rows = (cfg.rows || []);
    var W = 660, rowH = 30, m = { l: 132, r: 62, t: 8, b: 34 };
    var H = m.t + m.b + Math.max(1, rows.length) * rowH;
    var pw = W - m.l - m.r, ph = rows.length * rowH;
    var svg = el('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet', role: 'img' });
    if (!rows.length) { svg.appendChild(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle' }, 'no data')); return svg; }

    var totals = rows.map(function (r) { return (r.parts || []).reduce(function (a, p) { return a + (isFinite(p.value) ? Math.max(0, p.value) : 0); }, 0); });
    var hi = Math.max.apply(null, totals) * 1.02 || 1;
    function X(v) { return m.l + v / hi * pw; }

    var xstep = niceStep(hi, 5);
    for (var x = 0; x <= hi + 1e-9; x += xstep) {
      svg.appendChild(el('line', { class: 'gl', x1: X(x), y1: m.t, x2: X(x), y2: m.t + ph }));
      svg.appendChild(el('text', { x: X(x), y: m.t + ph + 14, 'text-anchor': 'middle' }, fmtTick(x, xstep)));
    }

    rows.forEach(function (r, i) {
      var y = m.t + i * rowH + 5, h = rowH - 13, acc = 0;
      (r.parts || []).forEach(function (p) {
        var v = isFinite(p.value) ? Math.max(0, p.value) : 0;
        if (v <= 0) return;
        var rect = el('rect', { class: 'bar', x: X(acc), y: y, width: Math.max(0.6, X(acc + v) - X(acc)), height: h, fill: p.color });
        rect.appendChild(el('title', null, p.name + ': ' + v.toPrecision(3) + (cfg.units || '')));
        svg.appendChild(rect);
        acc += v;
      });
      svg.appendChild(el('text', { x: m.l - 8, y: y + h / 2 + 3.5, 'text-anchor': 'end', fill: 'var(--ink-2)' }, r.name));
      svg.appendChild(el('text', { class: 'blab', x: X(acc) + 5, y: y + h / 2 + 3.5 }, r.label !== undefined ? r.label : acc.toPrecision(3)));
    });

    svg.appendChild(el('line', { class: 'ax', x1: m.l, y1: m.t, x2: m.l, y2: m.t + ph }));
    svg.appendChild(el('line', { class: 'ax', x1: m.l, y1: m.t + ph, x2: m.l + pw, y2: m.t + ph }));
    if (cfg.xLabel) svg.appendChild(el('text', { class: 'axlabel', x: m.l + pw / 2, y: H - 3, 'text-anchor': 'middle' }, cfg.xLabel));
    return svg;
  }

  function legend(items) {
    var d = document.createElement('div');
    d.className = 'legend';
    items.forEach(function (it) {
      var li = document.createElement('span');
      li.className = 'li';
      /* When a series carries a dash pattern the swatch has to carry the SAME
         pattern, or the legend cannot be matched to the curve — which is the
         whole point of adding a second channel. A 22x8 SVG draws the real
         stroke; the plain div swatch stays for solid and legacy-dashed. */
      if (it.dash) {
        var s = el('svg', { width: 22, height: 8, viewBox: '0 0 22 8', 'aria-hidden': 'true' });
        s.style.flex = 'none';
        s.appendChild(el('line', {
          x1: 0, y1: 4, x2: 22, y2: 4, stroke: it.color,
          'stroke-width': 2.4, 'stroke-dasharray': it.dash, 'stroke-linecap': 'butt'
        }));
        li.appendChild(s);
      } else {
        var sw = document.createElement('span');
        sw.className = 'sw' + (it.dashed ? ' dash' : '');
        if (!it.dashed) sw.style.background = it.color;
        li.appendChild(sw);
      }
      li.appendChild(document.createTextNode(it.name));
      d.appendChild(li);
    });
    return d;
  }

  /* ------------------------------------------------------------------ *
   * uvChart: direction cosines (u,v) over the visible hemisphere. Built
   * for the grating-lobe map, which is the only honest way to show a
   * sparse 2-D lattice — two principal-plane cuts hide most of the lobes.
   * cfg = { lobes:[{u,v,relDb}], u0, v0, height, ringsDeg:[..],
   *         label, floorDb }
   * ------------------------------------------------------------------ */
  function uvChart(cfg) {
    var H = cfg.height || 340, W = 660;
    var m = { l: 40, r: 12, t: 10, b: 34 };
    var side = Math.min(W - m.l - m.r, H - m.t - m.b);
    var cx = m.l + side / 2, cy = m.t + side / 2, R = side / 2;
    var svg = el('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet', role: 'img' });

    function X(u) { return cx + u * R; }
    function Y(v) { return cy - v * R; }

    (cfg.ringsDeg || [30, 60]).forEach(function (d) {
      var r = Math.sin(d * Math.PI / 180) * R;
      svg.appendChild(el('circle', { cx: cx, cy: cy, r: r, class: 'gl', fill: 'none' }));
      svg.appendChild(el('text', { x: cx + r * 0.707 + 2, y: cy - r * 0.707 - 3, 'text-anchor': 'start' }, d + '°'));
    });
    svg.appendChild(el('circle', { cx: cx, cy: cy, r: R, class: 'ax', fill: 'none' }));
    svg.appendChild(el('text', { x: cx + R + 4, y: cy - 4, 'text-anchor': 'start' }, '90°'));
    svg.appendChild(el('line', { class: 'gl', x1: cx - R, y1: cy, x2: cx + R, y2: cy }));
    svg.appendChild(el('line', { class: 'gl', x1: cx, y1: cy - R, x2: cx, y2: cy + R }));

    var floor = cfg.floorDb === undefined ? -20 : cfg.floorDb;
    (cfg.lobes || []).forEach(function (L) {
      var t = Math.max(0, Math.min(1, (L.relDb - floor) / (0 - floor)));
      var r = 2.2 + 5.2 * t;
      var c = el('circle', {
        cx: X(L.u), cy: Y(L.v), r: r,
        fill: t > 0.75 ? 'var(--s5)' : t > 0.4 ? 'var(--s2)' : 'var(--ink-3)',
        'fill-opacity': (0.35 + 0.55 * t).toFixed(2)
      });
      c.appendChild(el('title', null,
        'θ ' + L.thetaDeg.toFixed(2) + '°, φ ' + L.phiDeg.toFixed(1) + '° · ' +
        L.relDb.toFixed(2) + ' dB · (m,n) = (' + L.m + ',' + L.n + ')'));
      svg.appendChild(c);
    });

    /* the intended beam */
    var bx = X(cfg.u0 || 0), by = Y(cfg.v0 || 0);
    svg.appendChild(el('line', { class: 'ax', x1: bx - 7, y1: by, x2: bx + 7, y2: by, stroke: 'var(--s4)' }));
    svg.appendChild(el('line', { class: 'ax', x1: bx, y1: by - 7, x2: bx, y2: by + 7, stroke: 'var(--s4)' }));
    svg.appendChild(el('text', { x: bx + 9, y: by - 6, 'text-anchor': 'start', fill: 'var(--s4)' }, 'beam'));

    svg.appendChild(el('text', { class: 'axlabel', x: cx, y: H - 4, 'text-anchor': 'middle' },
      cfg.label || 'u = sinθ·cosφ  (scan plane)'));
    svg.appendChild(el('text', {
      class: 'axlabel', x: 0, y: 0, 'text-anchor': 'middle',
      transform: 'translate(11,' + cy + ') rotate(-90)'
    }, 'v = sinθ·sinφ'));
    return svg;
  }

  window.Charts = {
    lineChart: lineChart,
    sweepChart: sweepChart,
    barChart: barChart,
    stackChart: stackChart,
    uvChart: uvChart,
    legend: legend,
    fLabel: fLabel
  };
})();
