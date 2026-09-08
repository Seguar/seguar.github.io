/* ============================================================================
   app.js — state, routing, and rendering.
   Exposes nothing; runs on load.
   ========================================================================= */
(function () {
  'use strict';

  var K = window.K, M = window.Model, UI = window.UI, C = window.Charts, X = window.Xport;

  /* ------------------------------- state -------------------------------- */
  var DEFAULTS = {};
  M.PARAMS.forEach(function (p) { DEFAULTS[p.key] = p.value; });
  var state = {};
  var view = {
    name: 'map', selected: 0, tileMetric: 'skewPs',
    showBlocks: true, showLo: true, showBb: true, showDies: true
  };

  var TILE_METRICS = [
    { key: 'skewPs', label: 'skew vs array mean (ps)' },
    { key: 'wraps', label: 'static offset (wraps to resolve)' },
    { key: 'driftDeg', label: 'thermal drift (°, uncalibrated)' },
    { key: 'lossDb', label: 'path loss (dB)' },
    { key: 'powerMw', label: 'distribution power (mW)' }
  ];

  function loadState() {
    state = {};
    Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k]; });
    var over = X.decodeState(location.hash);
    Object.keys(over).forEach(function (k) {
      if (k === '_v') { view.name = over[k]; return; }
      if (!(k in DEFAULTS)) return;
      var v = parseFloat(over[k]);
      if (isFinite(v)) state[k] = v;
    });
  }
  function overrides() {
    var o = {};
    Object.keys(state).forEach(function (k) { if (state[k] !== DEFAULTS[k]) o[k] = state[k]; });
    return o;
  }
  function syncHash() {
    var s = X.encodeState(overrides());
    history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
  }

  /* stamp a reference preset into the editable PN fields */
  function stampRef(idx) {
    var r = M.REF_SOURCES[Math.round(idx)];
    if (!r) return;
    state.fRefMHz = r.freqMHz;
    state.ref1k = r.pn1k;
    state.ref10k = r.pn10k;
    state.ref100k = r.pn100k;
    state.refFloor = r.floor;
  }

  function setParam(key, value) {
    state[key] = value;
    if (key === 'refSel') stampRef(value);
    syncHash();
    render();
  }

  /* --------------------------- number formatting ------------------------- */
  function n(v, d) { return UI.num(v, d); }
  function str(v) { return (v === null || v === undefined) ? '—' : String(v); }

  /* =====================================================================
     Table row specifications
     ================================================================== */
  function loRows(budget) {
    var offs = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8];
    var rows = [{ section: 'M1 · phase noise at ' + n(state.fLoGHz, 0) + ' GHz (dBc/Hz)' }];
    offs.forEach(function (f) {
      rows.push({
        name: 'L(' + C.fLabel(f) + ')', field: '__pn' + f, better: 'low', dec: 1,
        fmt: function (v, res) { return res.pnAtOffsets ? n(res.pnAtOffsets[f], 1) : '—'; }
      });
    });
    rows.push({ section: 'M2 · integrated phase error & jitter' });
    rows.push({ name: 'Single-tile φ RMS', sub: 'integrated ' + n(state.carrierTrackMHz) + ' MHz → ' + n(state.bbEdgeGHz) + ' GHz', field: 'phiRmsDeg', units: '°', better: 'low' });
    rows.push({ name: 'Array-output φ RMS', sub: 'uncorrelated noise averaged down by N', field: 'phiArrayDeg', units: '°', better: 'low', spec: budget.sigForEvmDeg });
    rows.push({ name: 'RMS jitter', field: 'jitterFs', units: 'fs', better: 'low', dec: 1 });
    rows.push({ section: 'M3 · inter-tile phase error (mean-referred)' });
    rows.push({ name: 'Raw, uncalibrated', field: 'interTileRawDeg', units: '°', better: 'low' });
    rows.push({ name: 'Residual after BIST', sub: 'the number that decides the architecture', field: 'interTileResidualDeg', units: '°', better: 'low', spec: budget.sigSpecDeg });
    rows.push({ name: '· differential phase noise', field: 'pnDiffCalDeg', units: '°', better: 'low' });
    rows.push({ name: '· injected BIST noise', field: 'injDeg', units: '°', better: 'low' });
    rows.push({ name: '· drift residual', field: 'driftResidDeg', units: '°', better: 'low' });
    rows.push({ name: '· phase-shifter quantisation', field: 'quantDeg', units: '°', better: 'low' });
    rows.push({ section: 'M4 · inter-tile skew — static (calibratable) vs drifting (not)' });
    rows.push({ name: 'Total RMS skew', field: 'skewRmsPs', units: 'ps', better: 'low' });
    rows.push({ name: 'Peak skew', field: 'skewPeakPs', units: 'ps', better: 'low' });
    rows.push({
      name: 'Geometric path imbalance', sub: 'known by construction — equalise it in layout',
      field: 'pathImbalancePs', units: 'ps', better: 'low',
      fmt: function (v, r) { return isFinite(v) ? n(v) + ' ps (' + n(r.pathImbalanceWraps, 1) + ' wraps)' : '—'; }
    });
    rows.push({ name: '· Dk tolerance over the path', field: 'dkSkewPs', units: 'ps', better: 'low' });
    rows.push({ name: '· etch tolerance, accumulated', field: 'etchSkewPs', units: 'ps', better: 'low' });
    rows.push({ name: '· transition repeatability', field: 'transSkewPs', units: 'ps', better: 'low' });
    rows.push({
      name: 'Correction range needed', sub: 'all of the above is static — calibration removes it, but must resolve the wraps',
      field: 'correctionRangeDeg', units: '°', better: 'low',
      fmt: function (v, r) { return isFinite(v) ? n(v, 0) + '° (' + n(r.correctionWraps, 1) + ' wraps)' : '—'; }
    });
    rows.push({
      name: 'Thermal drift skew', sub: 'what BIST must track, over ' + n(state.dTTileK, 0) + ' K — see the residual row for what is left',
      field: 'skewDriftPs', units: 'ps', better: 'low'
    });
    rows.push({
      name: 'Drift skew as phase at LO',
      sub: 'exceeds the ' + n(budget.sigSpecDeg) + '° spec on its own — which is why BIST is mandatory, not optional. Identical for every distribution frequency: that is the algebra.',
      field: 'skewDeg78', units: '°', better: 'low'
    });
    rows.push({ name: 'Delay per cm in this medium', field: 'psPerCm', units: 'ps/cm', dec: 1 });
    rows.push({ name: 'Thermal sensitivity', field: 'driftDegPerK', units: '°/K', better: 'low' });
    rows.push({ section: 'M5 · distribution loss' });
    rows.push({ name: 'Total loss', field: 'lossTotalDb', units: 'dB', better: 'low', dec: 1 });
    rows.push({ name: '· line loss', field: 'lineLossDb', units: 'dB', better: 'low', dec: 1 });
    rows.push({ name: '· split / tap loss', field: 'splitLossDb', units: 'dB', better: 'low', dec: 1 });
    rows.push({ name: 'Loss per cm', sub: 'at the distributed frequency', field: 'lossPerCmDb', units: 'dB/cm', better: 'low' });
    rows.push({ name: 'Compensating gain required', field: 'requiredGainDb', units: 'dB', better: 'low', dec: 1 });
    rows.push({ section: 'M6 · power' });
    rows.push({ name: 'Total distribution power', field: 'powerTotalMw', units: 'W', better: 'low', fmt: function (v) { return n(v / 1000, 2); } });
    rows.push({ name: 'Per tile', field: 'powerPerTileMw', units: 'mW', better: 'low', dec: 0 });
    rows.push({ name: 'Share of array budget', field: 'powerFracOfArray', units: '%', better: 'low', dec: 1 });
    rows.push({ section: 'Beam consequences' });
    rows.push({ name: 'Sidelobe / null-depth floor', sub: '10log10(σ²/N) — the decisive metric', field: 'sllDb', units: 'dB', better: 'low', dec: 1 });
    rows.push({ name: 'Array gain loss', sub: 'Ruze — negligible at these levels', field: 'gainLossDb', units: 'dB', better: 'low', dec: 3 });
    rows.push({ name: 'Pointing error', field: 'pointingErrDeg', units: '°', better: 'low', dec: 3, spec: budget.pointBudgetDeg });
    rows.push({
      name: 'Array-output EVM', sub: 'impairment level relative to the constellation; more negative is better',
      field: 'evmDb', units: 'dB', better: 'low', spec: budget.evmLimitDb,
      fmt: function (v, r) { return isFinite(v) ? n(v, 1) + ' (' + n(r.evmPct, 2) + '%)' : '—'; }
    });
    rows.push({ name: 'Highest supportable QAM', field: 'maxQam', fmt: function (v, r) { return str(r.maxQam); } });
    rows.push({ section: 'Hardware' });
    rows.push({ name: 'Frequency on the board', field: 'distFreqGHz', units: 'GHz', dec: 2 });
    rows.push({ name: 'Per-tile multiplication', field: 'tileMultiplier', units: '×', dec: 0 });
    rows.push({ name: 'Mean routed path', field: 'pathMeanCm', units: 'cm', better: 'low', dec: 1 });
    rows.push({ name: 'Total routed length', field: 'totalRoutedCm', units: 'cm', better: 'low', dec: 0 });
    rows.push({ name: 'Repeater amplifiers', field: 'repeaters', better: 'low', dec: 0 });
    rows.push({ name: 'Splitters', field: 'splitCount', better: 'low', dec: 0 });
    rows.push({ name: 'Distribution area per tile', field: 'areaPerTileMm2', units: 'mm²', better: 'low' });
    rows.push({ name: 'LO measurements per array pass', field: 'calBurdenScore', better: 'low', dec: 0, noteField: 'calBurdenDetail' });
    rows.push({ name: 'Feasibility', field: 'feasibility', fmt: function (v, r) { return str(r.feasibility); } });
    rows.push({ name: 'Risk', field: 'riskLevel', fmt: function (v, r) { return str(r.riskLevel); } });
    return rows;
  }

  function bbRows(budget) {
    return [
      { section: 'M1 / M2 · phase noise & jitter' },
      { name: 'L(f) at the carrier', sub: 'the network sits after the mixer', field: 'pnNA', fmt: function () { return 'n/a'; } },
      { name: 'Contribution to E-band jitter', field: 'jitterFs', fmt: function () { return 'n/a'; } },
      { section: 'Inter-tile tier — the network drawn on the hardware map' },
      {
        name: 'Inter-tile topology', field: 'interKind',
        fmt: function (v, r) { return r.interKind + (r.interKind === 'htree' ? ' · ' + r.interDepth + ' levels' : ''); }
      },
      { name: 'Mean routed path to backend', field: 'interPathMeanCm', units: 'cm', better: 'low', dec: 1 },
      { name: 'Longest path to backend', field: 'interPathMaxCm', units: 'cm', better: 'low', dec: 1 },
      { name: 'Total routed length', field: 'interRoutedCm', units: 'cm', better: 'low', dec: 0 },
      {
        name: 'Geometric skew, raw', sub: 'from unequal arm lengths — this is the coarse TTD range the option demands',
        field: 'interGeoRawPs', units: 'ps', better: 'low', dec: 0,
        fmt: function (v, r) {
          return n(v, 0) + ' ps' + (r.interUncompPs > 0.5 ? ' — ' + n(r.interUncompPs, 0) + ' beyond TTD range' : ' (within TTD range)');
        }
      },
      {
        name: 'Geometric skew after coarse TTD', sub: 'a group-delay error: phase calibration cannot touch it, only TTD can',
        field: 'interGeoSkewPs', units: 'ps', better: 'low'
      },
      {
        name: 'Share of TTD range consumed', sub: 'range stolen from beam steering, which is what the ' + n(state.ttdStepPs, 0) + ' ps element is for',
        field: 'ttdRangeConsumedPct', units: '%', better: 'low', dec: 0
      },
      { name: 'Inter-tile line loss', field: 'interLossDb', units: 'dB', better: 'low', dec: 2 },
      { section: 'M3 / M4 · gain-phase error & skew (both tiers)' },
      { name: 'RMS skew across ports', field: 'skewRmsPs', units: 'ps', better: 'low' },
      { name: '· intra-tile part', field: 'skewIntraPs', units: 'ps', better: 'low' },
      { name: 'Peak skew', field: 'skewPeakPs', units: 'ps', better: 'low' },
      { name: 'Systematic ramp', field: 'skewSystematicPs', units: 'ps', better: 'low' },
      { name: 'Phase error at rail edge', sub: 'at ' + n(state.bbEdgeGHz) + ' GHz — NOT at ' + n(state.fLoGHz, 0) + ' GHz', field: 'skewEdgeDeg', units: '°', better: 'low' },
      { name: 'Residual after calibration', field: 'interTileResidualDeg', units: '°', better: 'low' },
      { name: 'Beam steer from the ramp', sub: 'survives phase calibration; needs TTD', field: 'rampSteerDeg', units: '°', better: 'low', dec: 3 },
      { name: 'Band-averaged squint loss', field: 'squintLossDb', units: 'dB', better: 'low', dec: 3 },
      { section: 'M5 · loss & noise' },
      { name: 'Net insertion loss', sub: 'split loss and array gain already netted', field: 'lossTotalDb', units: 'dB', better: 'low', dec: 1 },
      { name: 'Noise-figure penalty', sub: 'behind ' + n(state.rficGainDb, 0) + ' dB of RFIC gain', field: 'nfPenaltyDb', units: 'dB', better: 'low', dec: 2 },
      { name: 'Compensating gain required', field: 'requiredGainDb', units: 'dB', better: 'low', dec: 1 },
      { name: '−3 dB bandwidth', field: 'bwGHz', units: 'GHz', better: 'high' },
      { name: 'Cascaded IIP3 penalty', field: 'iip3PenaltyDb', units: 'dB', better: 'low', dec: 1 },
      { section: 'M6 · power & area' },
      { name: 'Per tile, both rails', field: 'powerPerTileMw', units: 'mW', better: 'low', dec: 0 },
      { name: 'Array total', field: 'powerTotalMw', units: 'W', better: 'low', fmt: function (v) { return n(v / 1000, 2); } },
      { name: 'Share of array budget', field: 'powerFracOfArray', units: '%', better: 'low', dec: 2 },
      { name: 'Area per tile, both rails', field: 'areaPerTileMm2', units: 'mm²', better: 'low', dec: 3 },
      { section: 'Stability & burden' },
      { name: 'Delay drift', field: 'driftDegPerK', units: '°/K', better: 'low', dec: 3 },
      { name: 'Channels to calibrate per rail', field: 'calBurdenScore', better: 'low', dec: 0, noteField: 'calBurdenDetail' },
      { name: 'Feasibility', field: 'feasibility', fmt: function (v, r) { return str(r.feasibility); } },
      { name: 'Risk', field: 'riskLevel', fmt: function (v, r) { return str(r.riskLevel); } }
    ];
  }

  /* =====================================================================
     Architecture picker
     ================================================================== */
  function seg(container, label, paramKey, choices, note) {
    var wrap = document.createElement('div');
    wrap.style.marginBottom = '12px';
    var lab = document.createElement('div');
    lab.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3);margin-bottom:5px';
    lab.textContent = label;
    wrap.appendChild(lab);
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap';
    choices.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (Number(state[paramKey]) === Number(c.value) ? ' pri' : '');
      b.textContent = c.label;
      if (c.title) b.title = c.title;
      b.addEventListener('click', function () { setParam(paramKey, Number(c.value)); });
      row.appendChild(b);
    });
    wrap.appendChild(row);
    if (note) {
      var nn = document.createElement('div');
      nn.className = 'note';
      nn.style.cssText = 'margin:6px 0 0;font-size:11.5px';
      nn.innerHTML = note;
      wrap.appendChild(nn);
    }
    container.appendChild(wrap);
  }

  function renderPicker(res, budget) {
    var mount = document.getElementById('pickerMount');
    mount.textContent = '';
    var loP = M.PARAMS.filter(function (p) { return p.key === 'loOption'; })[0];
    var sel = res.lo[res.g.loOptionId];

    seg(mount, 'LO / reference connection type', 'loOption', loP.choices.map(function (c, i) {
      return { value: c.value, label: c.label, title: M.LO_META[i].id };
    }), sel.note);

    seg(mount, 'Reference clock', 'refSel', M.REF_SOURCES.map(function (r, i) {
      return { value: i, label: r.name, title: r.note };
    }), M.REF_SOURCES[Math.round(state.refSel)].note +
      '  <em>N = f_LO/f_ref = ' + n(state.fLoGHz * 1e9 / (state.fRefMHz * 1e6), 0) +
      ', so the reference is multiplied by ' + n(20 * Math.log10(state.fLoGHz * 1e9 / (state.fRefMHz * 1e6)), 1) + ' dB.</em>');

    if (res.g.loOptionId === 'mid-mult') {
      seg(mount, 'Multiplication factor', 'midM',
        M.PARAMS.filter(function (p) { return p.key === 'midM'; })[0].choices,
        '×M adds exactly <span class="kv">' + n(20 * Math.log10(state.midM), 1) + ' dB</span> to L(f) and multiplies ' +
        'distributed phase error by ' + Math.round(state.midM) + '. It buys loss and power, not skew.');
    }
    if (res.g.loOptionId === 'local-pll') {
      seg(mount, 'Per-tile PLL output plan', 'pllMult',
        M.PARAMS.filter(function (p) { return p.key === 'pllMult'; })[0].choices,
        'A PLL running directly at ' + n(state.fLoGHz, 0) + ' GHz in 65 nm LP CMOS is beyond the technology; ' +
        'a lower-frequency PLL plus a multiplier is the realisable route.');
    }
    if (res.g.loOptionId === 'daisy-chain') {
      seg(mount, 'Parallel chain branches', 'chainBranches',
        [1, 2, 3, 5].map(function (v) { return { value: v, label: v === 1 ? '1 chain' : v + ' chains' }; }),
        'More branches shorten the worst chain and shrink the blast radius of a dead buffer. Worst chain here is ' +
        (sel.topo.lo.maxHop || 0) + ' hops.');
    }

    seg(mount, 'LO line medium', 'loMedium',
      M.PARAMS.filter(function (p) { return p.key === 'loMedium'; })[0].choices,
      'Loss at ' + n(sel.distFreqGHz, 2) + ' GHz in this medium: <span class="kv">' + n(sel.lossPerCmDb, 3) +
      ' dB/cm</span>. One degree at ' + n(state.fLoGHz, 0) + ' GHz is <span class="kv">' +
      n(K.umPerDeg(state.fLoGHz * 1e9, res.g.epsEff), 1) + ' µm</span> of physical length.');

    seg(mount, 'Baseband split / combine', 'bbOption',
      M.PARAMS.filter(function (p) { return p.key === 'bbOption'; })[0].choices,
      res.bb[res.g.bbOptionId].note);

    var g2 = res.g;
    document.getElementById('pickerNote').innerHTML =
      g2.tileCols + '×' + g2.tileCols + ' = ' + g2.nTilesTotal + ' tiles at ' + n(g2.tileCm, 1) + ' cm pitch · ' +
      'populated aperture <strong>' + n(g2.effApertureCm, 1) + ' cm</strong>' +
      (g2.aperturePitchExact ? '' : ' (requested ' + n(g2.apertureCm, 0) + ')') + ' · ' +
      n(g2.loTapsTotal, 0) + ' LO taps · ' + n(state.chPerTile * g2.nTilesTotal, 0) + ' BB channels per rail';

    /* consistency banner — a mismatch that changes the answer should not be
       discoverable only by doing the arithmetic yourself */
    var wm = document.getElementById('warnMount');
    wm.textContent = '';
    (res.warnings || []).forEach(function (w) {
      var d = document.createElement('div');
      d.className = 'callout ' + (w.severity === 'fail' ? 'failc' : 'warnc');
      d.style.margin = '0 0 8px';
      d.innerHTML = '<strong>' + (w.severity === 'fail' ? 'Inconsistent: ' : 'Check: ') + '</strong>' + w.message;
      wm.appendChild(d);
    });
    wm.classList.toggle('hidden', !(res.warnings || []).length);
  }

  /* =====================================================================
     Map view
     ================================================================== */
  function renderMapView(res, budget) {
    var sel = res.lo[res.g.loOptionId];
    var built = res.selected;

    document.getElementById('mapTitle').innerHTML =
      'Hardware map <span class="tag">' + M.LO_META[Math.round(state.loOption)].name + '</span>' +
      '<span class="grow">' + n(sel.distFreqGHz, 2) + ' GHz on the board' +
      (sel.tileMultiplier > 1 ? ', ×' + sel.tileMultiplier + ' at each tile' : '') + '</span>';

    /* toolbar: tile colour metric + block visibility */
    var tb = document.getElementById('mapToolbar');
    tb.textContent = '';
    var lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:11.5px;color:var(--ink-3)';
    lbl.textContent = 'colour tiles by';
    tb.appendChild(lbl);
    TILE_METRICS.forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (view.tileMetric === m.key ? ' pri' : '');
      b.textContent = m.label;
      b.addEventListener('click', function () { view.tileMetric = m.key; render(); });
      tb.appendChild(b);
    });
    var sp = document.createElement('span');
    sp.className = 'sp';
    tb.appendChild(sp);
    var lbl2 = document.createElement('span');
    lbl2.style.cssText = 'font-size:11.5px;color:var(--ink-3)';
    lbl2.textContent = 'layers';
    tb.appendChild(lbl2);
    [
      { k: 'showLo', label: 'LO / reference' },
      { k: 'showBb', label: 'baseband' },
      { k: 'showDies', label: 'dies + taps' },
      { k: 'showBlocks', label: 'blocks' }
    ].forEach(function (L) {
      var b = document.createElement('button');
      b.type = 'button';
      var on = view[L.k] !== false;
      b.className = 'btn' + (on ? ' pri' : '');
      b.textContent = L.label;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.title = (on ? 'hide' : 'show') + ' the ' + L.label + ' layer';
      b.addEventListener('click', function () { view[L.k] = !on; render(); });
      tb.appendChild(b);
    });

    /* zoom / pan — what makes the map usable at thousands of tiles */
    var zsp = document.createElement('span');
    zsp.className = 'sp';
    tb.appendChild(zsp);
    var zlbl = document.createElement('span');
    zlbl.style.cssText = 'font-size:11.5px;color:var(--ink-3)';
    zlbl.textContent = 'zoom';
    zlbl.title = 'scroll to zoom at the cursor, drag to pan, double-click to zoom in';
    tb.appendChild(zlbl);
    function zoomBtn(txt, fn, title) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = txt;
      b.title = title;
      b.addEventListener('click', fn);
      tb.appendChild(b);
      return b;
    }
    var ZMAX = 64;
    zoomBtn('−', function () {
      view.zoom = Math.max(1, (view.zoom || 1) / 2);
      if (view.zoom === 1) { view.panXCm = undefined; view.panYCm = undefined; }
      render();
    }, 'zoom out').disabled = (view.zoom || 1) <= 1;
    var zi = document.createElement('span');
    zi.style.cssText = 'font:12px var(--mono);color:var(--ink-2);min-width:34px;text-align:center';
    zi.textContent = (view.zoom || 1) + '×';
    tb.appendChild(zi);
    zoomBtn('+', function () {
      view.zoom = Math.min(ZMAX, (view.zoom || 1) * 2);
      render();
    }, 'zoom in — then drag the map to pan').disabled = (view.zoom || 1) >= ZMAX;
    if ((view.zoom || 1) > 1) {
      zoomBtn('fit', function () {
        view.zoom = 1; view.panXCm = undefined; view.panYCm = undefined; render();
      }, 'zoom to fit the whole aperture');
    }

    var tm = TILE_METRICS.filter(function (m) { return m.key === view.tileMetric; })[0];
    var mapInfo = window.Diagram.renderMap(document.getElementById('mapMount'), built, {
      tileMetric: view.tileMetric, tileMetricLabel: tm ? tm.label : view.tileMetric,
      selected: view.selected, sourceLabel: res.g.refName,
      showBlocks: view.showBlocks, showLo: view.showLo,
      showBb: view.showBb, showDies: view.showDies,
      zoom: view.zoom, panXCm: view.panXCm, panYCm: view.panYCm,
      apertureSpecCm: res.g.apertureCm,
      onViewChange: function (z, x, y) { view.zoom = z; view.panXCm = x; view.panYCm = y; render(); }
    }, function (i) { view.selected = i; render(); });
    void mapInfo;

    window.Diagram.renderLegend(document.getElementById('mapLegend'), built);
    var bsel0 = res.bb[res.g.bbOptionId];
    document.getElementById('mapNote').innerHTML =
      '<strong>Scroll to zoom at the cursor, drag to pan, double-click to zoom in</strong> ' +
      '(shift double-click to zoom out). Detail follows how many tiles are actually on screen, so zooming in ' +
      'restores the dies and taps even on a several-thousand-tile array. ' +
      '<strong>Two networks, one aperture.</strong> The <span style="color:var(--s2)">LO / reference</span> tier ' +
      'enters from the source below and lands at each tile centre; line weight and colour encode the frequency ' +
      'each segment carries, so what is actually on the board is visible at a glance. The ' +
      '<span style="color:var(--s3)">baseband</span> tier (dashed) runs from the offset port on each tile up to ' +
      'the RFSoC backend above, and its wiring changes with the option: a flat <em>star</em> for the resistive ' +
      'network, a <em>serpentine bus</em> for the daisy chain, a hierarchical <em>H-tree</em> for the active one. ' +
      'Both are drawn from the same generator that produces the numbers. ' +
      'LO: longest tile path <span class="kv">' + n(sel.pathMaxCm, 1) + ' cm</span>, total routed ' +
      '<span class="kv">' + n(sel.totalRoutedCm, 0) + ' cm</span>. Baseband: longest ' +
      '<span class="kv">' + n(bsel0.interPathMaxCm, 1) + ' cm</span>, total routed ' +
      '<span class="kv">' + n(bsel0.interRoutedCm, 0) + ' cm</span>, geometric skew ' +
      '<span class="kv">' + n(bsel0.interGeoSkewPs) + ' ps</span>.';

    window.Diagram.renderInspector(document.getElementById('inspectorMount'), built, view.selected, res.g);
    window.Diagram.renderBbDiagram(document.getElementById('bbDiagramMount'), built);
    window.Diagram.renderBom(document.getElementById('bomMount'), built, res.blocks);

    /* live stats strip */
    var bsel = res.bb[res.g.bbOptionId];
    var pass = sel.interTileResidualDeg <= budget.sigSpecDeg;
    UI.renderBudget(document.getElementById('mapStatsMount'), null, null, {
      cells: [
        { k: 'Inter-tile residual', n: n(sel.interTileResidualDeg), unit: '°', binding: !pass,
          d: (pass ? 'within' : 'OVER') + ' the ' + n(budget.sigSpecDeg) + '° spec. Irreducible part: ' + n(sel.pnDiffCalDeg) + '°.' },
        { k: 'Null-depth floor', n: n(sel.sllDb, 1), unit: 'dB', d: 'from 10log10(σ²/N) at ' + budget.nTiles + ' tiles' },
        { k: 'Distribution loss', n: n(sel.lossTotalDb, 1), unit: 'dB', d: n(sel.lossPerCmDb, 3) + ' dB/cm × ' + n(sel.pathMeanCm, 1) + ' cm plus splits and transitions' },
        { k: 'Distribution power', n: n(sel.powerTotalMw / 1000, 2), unit: 'W', d: n(sel.powerFracOfArray, 1) + '% of the ' + n(state.arrayPowerW, 0) + ' W array budget' },
        { k: 'Repeater amps', n: n(sel.repeaters, 0), unit: '', d: sel.splitCount + ' splitters, ' + n(sel.totalRoutedCm, 0) + ' cm routed' },
        { k: 'RMS skew', n: n(sel.skewRmsPs), unit: 'ps', d: n(sel.skewDeg78) + '° at the LO · spec is ' + n(budget.skewSpecPs) + ' ps' },
        {
          k: 'Array-output EVM', n: n(sel.evmDb, 1), unit: 'dB',
          binding: sel.evmDb > budget.evmLimitDb,
          d: n(sel.evmPct, 2) + '% · budget ' + n(budget.evmLimitDb, 1) + ' dB · supports ' + sel.maxQam +
             '. This is what the reference clock changes — the differential is common-mode and does not move.'
        },
        {
          k: 'Baseband', n: n(bsel.interGeoRawPs, 0), unit: 'ps',
          d: bsel.interKind + ' · ' + n(bsel.ttdRangeConsumedPct, 0) + '% of TTD range, ' +
             n(bsel.interRoutedCm, 0) + ' cm routed, ' + n(bsel.powerPerTileMw, 0) + ' mW/tile'
        }
      ]
    });
  }

  /* =====================================================================
     Compare view
     ================================================================== */
  function renderCompare(res, budget, dec) {
    var loOpts = M.LO_META.map(function (m) { return { id: m.id, name: m.name, topology: res.lo[m.id].note }; });
    var bbOpts = M.BB_META.map(function (m) { return { id: m.id, name: m.name, topology: res.bb[m.id].note }; });

    UI.renderTable(document.getElementById('loTable'), loOpts, res.lo, loRows(budget), dec.loPick.id);
    UI.renderTable(document.getElementById('bbTable'), bbOpts, res.bb, bbRows(budget), dec.bbPick.id);

    /* verdict strip */
    var vm = document.getElementById('verdictMount');
    vm.textContent = '';
    function verdict(labelTxt, pick, why) {
      var d = document.createElement('div');
      d.className = 'verdict';
      var l = document.createElement('div');
      l.className = 'vlab';
      l.textContent = labelTxt;
      var m2 = document.createElement('div');
      m2.className = 'vmain';
      var p = document.createElement('div');
      p.className = 'pick';
      p.textContent = pick;
      var w = document.createElement('div');
      w.className = 'why';
      w.innerHTML = why;
      m2.appendChild(p); m2.appendChild(w);
      d.appendChild(l); d.appendChild(m2);
      vm.appendChild(d);
    }
    var lp = dec.loPick, bp = dec.bbPick;
    verdict('LO', lp.name,
      'Residual inter-tile phase error <span class="kv">' + n(lp.r.interTileResidualDeg) + '°</span> against a <span class="kv">' +
      n(budget.sigSpecDeg) + '°</span> spec, null floor <span class="kv">' + n(lp.r.sllDb, 1) + ' dB</span>, ' +
      'distribution power <span class="kv">' + n(lp.r.powerFracOfArray, 1) + '%</span> of the array. ' +
      'Runner-up: ' + (dec.loRank[1] ? dec.loRank[1].short : '—') + '.');
    verdict('Baseband', bp.name,
      'Squint loss <span class="kv">' + n(bp.r.squintLossDb, 3) + ' dB</span>, noise-figure penalty <span class="kv">' +
      n(bp.r.nfPenaltyDb, 2) + ' dB</span>, <span class="kv">' + n(bp.r.powerPerTileMw, 0) + ' mW</span> per tile ' +
      'across both rails. Runner-up: ' + (dec.bbRank[1] ? dec.bbRank[1].short : '—') + '.');

    /* charts */
    var cc = document.getElementById('compareCharts');
    cc.textContent = '';
    var colors = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
    function barPanel(title, field, unit, spec, transform, logX) {
      var sec = document.createElement('section');
      sec.className = 'panel';
      var h = document.createElement('h2');
      h.textContent = title;
      sec.appendChild(h);
      var box = document.createElement('div');
      box.className = 'chartbox';
      box.appendChild(C.barChart({
        bars: M.LO_META.map(function (m, i) {
          var v = res.lo[m.id][field];
          if (transform) v = transform(v);
          return { name: m.short, value: v, color: colors[i], label: n(v) + (unit ? ' ' + unit : '') };
        }),
        xLabel: unit, hLine: spec, hLabel: 'spec', logX: logX
      }));
      sec.appendChild(box);
      cc.appendChild(sec);
    }
    barPanel('Residual inter-tile phase error', 'interTileResidualDeg', '°', budget.sigSpecDeg);
    barPanel('Sidelobe / null-depth floor', 'sllDb', 'dB', budget.nullFloorDb);
    barPanel('Distribution power', 'powerTotalMw', 'W', null, function (v) { return v / 1000; });
    barPanel('Distribution loss', 'lossTotalDb', 'dB', null);
  }

  /* =====================================================================
     Phase-noise view
     ================================================================== */
  function renderPn(res, budget) {
    var colors = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
    function pnPanel(mountId, curveKey, noteId, noteHtml, yMin, yMax) {
      var mount = document.getElementById(mountId);
      mount.textContent = '';
      var series = M.LO_META.map(function (m, i) {
        var c = res.lo[m.id][curveKey];
        return {
          name: m.short, color: colors[i],
          points: (c || []).map(function (p) { return { x: p.fOffsetHz, y: p.dBcPerHz }; })
        };
      });
      var box = document.createElement('div');
      box.className = 'chartbox';
      box.appendChild(C.lineChart({
        series: series, xLabel: 'offset frequency from carrier', yLabel: 'dBc/Hz',
        height: 330, yMin: yMin, yMax: yMax, xMin: 1e2, xMax: 1e9
      }));
      mount.appendChild(box);
      mount.appendChild(C.legend(M.LO_META.map(function (m, i) { return { name: m.short, color: colors[i] }; })));
      if (noteId) document.getElementById(noteId).innerHTML = noteHtml;
    }

    var a1 = res.lo['local-pll'], a4 = res.lo['mid-mult'];
    pnPanel('pnChartMount', 'pnCurve', 'pnNote',
      'Single-sideband phase noise of one tile\'s LO, referred to the ' + n(state.fLoGHz, 0) + ' GHz carrier. ' +
      'Below the PLL loop bandwidth (<span class="kv">' + n(state.pllLoopBwMHz) + ' MHz</span>) the shape follows the ' +
      'reference multiplied by ' + n(20 * Math.log10(state.fLoGHz * 1e9 / (state.fRefMHz * 1e6)), 1) + ' dB plus the ' +
      'in-band floor; above it the local oscillator runs free. This curve sets link EVM for a single channel, ' +
      'but it is <em>not</em> the curve that decides the architecture.');

    pnPanel('pnDiffMount', 'pnDiffCurve', 'pnDiffNote',
      'The <strong>differential</strong> phase noise between a tile and the array mean — the part that does not ' +
      'cancel and that no calibration removes. For the shared-source options this is only the repeater and ' +
      'multiplier additive noise plus the delay-decorrelation residual <span class="kv">4sin²(πfΔτ)</span>; for ' +
      'per-tile PLLs it is the full free-running oscillator noise above the loop bandwidth. Integrated, that is ' +
      '<span class="kv">' + n(a1.pnDiffCalDeg) + '°</span> for local PLLs against <span class="kv">' +
      n(a4.pnDiffCalDeg) + '°</span> for mid-frequency distribution — a gap of <span class="kv">' +
      n(Math.abs(a1.sllDb - a4.sllDb), 1) + ' dB</span> in the resulting null floor.');

    pnPanel('pnArrayMount', 'pnArrayCurve', 'pnArrayNote',
      'Phase noise at the <strong>coherent array output</strong>, where uncorrelated per-tile noise has averaged ' +
      'down by 10log10(' + budget.nTiles + ') = <span class="kv">' + n(10 * Math.log10(budget.nTiles), 1) +
      ' dB</span> while correlated noise has not. This is why per-tile PLLs can give <em>better</em> link EVM ' +
      '(<span class="kv">' + n(a1.evmDb, 1) + ' dB</span> against <span class="kv">' + n(a4.evmDb, 1) + ' dB</span>, a ' + n(Math.abs(a1.evmDb - a4.evmDb), 1) + ' dB difference in impairment level) while ' +
      'giving <em>worse</em> beam coherence. The two budgets genuinely point in opposite directions.');

    /* jitter table */
    var rows = [
      { name: 'Single-tile φ RMS', field: 'phiRmsDeg', units: '°', better: 'low' },
      { name: 'Array-output φ RMS', field: 'phiArrayDeg', units: '°', better: 'low', spec: budget.sigForEvmDeg },
      { name: 'RMS jitter', field: 'jitterFs', units: 'fs', better: 'low', dec: 1 },
      { name: 'Inter-tile differential φ, raw', field: 'pnDiffRawDeg', units: '°', better: 'low' },
      { name: 'Inter-tile differential φ, calibrated', field: 'pnDiffCalDeg', units: '°', better: 'low', spec: budget.sigSpecDeg },
      { name: 'Calibration corner f_cal', field: 'fCalHz', units: 'Hz', dec: 3 },
      { name: 'Array-output EVM', field: 'evmDb', units: 'dB', better: 'low', spec: budget.evmLimitDb,
        fmt: function (v, r) { return isFinite(v) ? n(v, 1) + ' (' + n(r.evmPct, 2) + '%)' : '—'; } },
      { name: 'Highest supportable QAM', field: 'maxQam', fmt: function (v, r) { return str(r.maxQam); } }
    ];
    UI.renderTable(document.getElementById('jitterTable'),
      M.LO_META.map(function (m) { return { id: m.id, name: m.name }; }), res.lo, rows, null);
  }

  /* =====================================================================
     TX / RX beam
     ================================================================== */
  function renderBeam(res, budget) {
    var g = res.g;
    var lo = res.lo[g.loOptionId], bb = res.bb[g.bbOptionId];
    var b = window.Beam.evaluate(g, budget, lo, bb);
    var periodic = Math.round(g.latticePeriodic) === 1;
    var lobes = b.lobes, worst = lobes.length ? lobes[0] : null;

    /* small local table builder — the option-comparison table in ui.js does
       not fit a plain list of rows */
    function plainTable(mount, headers, rows, wide) {
      mount.textContent = '';
      var t = document.createElement('table');
      t.className = 'grid';
      var thead = document.createElement('thead'), htr = document.createElement('tr');
      headers.forEach(function (h) { htr.appendChild(UI.elt('th', null, h)); });
      thead.appendChild(htr); t.appendChild(thead);
      var tb = document.createElement('tbody');
      rows.forEach(function (r) {
        var tr = document.createElement('tr');
        if (r.mark) tr.className = 'sect';
        r.cells.forEach(function (cv, i) {
          var td = UI.elt('td', i === 0 ? 'mn' : 'v', cv === null || cv === undefined ? '—' : String(cv));
          if (i === 0 && r.sub) td.appendChild(UI.elt('small', null, r.sub));
          if (wide && i === headers.length - 1) td.style.cssText = 'text-align:left;white-space:normal;min-width:220px';
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      mount.appendChild(t);
    }

    document.getElementById('beamHdr').textContent =
      M.LO_META[Math.round(state.loOption)].short + ' + ' + M.BB_META[Math.round(state.bbOption)].short +
      ' · steered to ' + n(g.beamScanDeg, 0) + '° · ' + g.tileCols + '×' + g.tileCols + ' tiles · ' +
      g.elem.label;

    UI.renderBudget(document.getElementById('beamStats'), null, null, {
      cells: [
        { k: 'Directivity', n: n(g.dArrayDbi, 2), unit: 'dBi',
          d: 'min(N·D_el, 4πA/λ²) = min(' + n(g.dArrayRawDbi, 2) + ', ' + n(g.dFilledDbi, 2) +
             ') dBi at broadside, from ' + g.nElem + ' elements of ' + n(g.dElDbi, 1) + ' dBi' },
        { k: 'Realised gain', n: n(b.realisedDbi, 2), unit: 'dBi',
          d: 'directivity −' + n(b.scanLossDb, 2) + ' dB scan −' + n(b.cohLossDb, 3) +
             ' dB error −' + n(g.antLossDb, 1) + ' dB antenna-side chain (efficiency, package feed, ' +
             'flip-chip, mismatch, T/R, on-chip, radome). Directivity is not gain; on RX this sits in ' +
             'front of the LNA and goes into G/T.' },
        { k: 'Element / cell fill', n: n(g.thinningLossDb, 2), unit: 'dB', binding: g.thinningLossDb > 6,
          d: '= 10log10(4π·A_cell/(λ²·D_el)) = A_eff ' + n(g.aEffElMm2, 2) + ' mm² in a ' +
             n(g.aCellMm2, 0) + ' mm² cell = ' + n(g.cellFillPct, 2) + '%. NOT a thinning loss: it is a ' +
             'statement about the element, and it closes as D_el rises toward the ' + n(g.dCellDbi, 1) +
             ' dBi cell ceiling (' + n(g.dElHeadroomDb, 1) + ' dB of headroom). Identically 10log10(' +
             (g.lobeCount + 1) + ' lattice lobes).' },
        periodic
          ? { k: 'Worst grating lobe', n: n(b.mWide.gratingDb, 2), unit: 'dB',
              binding: b.mWide.gratingDb > -13,
              d: 'at θ = ' + n(b.mWide.gratingAtDeg, 2) + '°, φ = ' + n(b.mWide.gratingPhiDeg, 0) +
                 '° — over the whole 2-D lobe set, not one axis. ' + lobes.length + ' lobes in visible ' +
                 'space at this scan angle, ' + g.lobeCount + ' at broadside (closed form π·A_cell/λ² = ' +
                 n(g.lobeCountClosed, 1) + '); the count changes as lobes cross the horizon, which is ' +
                 'what makes true scan loss non-monotonic. Suppressed only by the element pattern.' +
                 (b.mWide.beamIsPeak ? '' : ' THE INTENDED BEAM IS NOT THE STRONGEST LOBE.') }
          : { k: 'Aperiodic sidelobe floor', n: n(g.thinnedFloorDb, 1), unit: 'dB mean',
              d: 'no discrete lobes, but expected PEAK is ' + n(g.thinnedPeakDb, 1) + ' dB — higher by ' +
                 '10log10(ln(2L/λ)) = ' + n(g.peakOverMeanDb, 2) + ' dB. The peak is the number that has ' +
                 'to be met, not the mean.' },
        { k: 'Beamwidth', n: n(b.m.hpbwDeg, 3), unit: '°',
          d: (b.m.hpbwResolved ? '' : 'NOT RESOLVED in the window — ') + 'at ' + n(g.beamScanDeg, 0) +
             '° steer. N·d = ' + n(g.ndXCm, 1) + ' cm sets it; the element-centre extent is ' +
             n(g.extentXCm, 1) + ' × ' + n(g.extentYCm, 1) + ' cm. Far field 2D²/λ = ' +
             n(g.farFieldM, 1) + ' m.' },
        { k: 'Error floor, near beam', n: n(b.floorNearDb, 1), unit: 'dB',
          d: 'at the main beam and at the intra-tile comb angles, where the tile factor peaks. ' +
             'Per-tile phase ' + n(100 * b.shareNear.tile, 0) + '%, per-die ' +
             n(100 * b.shareNear.die, 0) + '%, per-element phase+amplitude ' +
             n(100 * b.shareNear.elem, 0) + '%.' },
        { k: 'Error floor, between lobes', n: n(b.floorFarDb, 1), unit: 'dB',
          d: 'where the tile factor falls to its angle average — ' +
             n(b.floorNearDb - b.floorFarDb, 1) + ' dB lower, and now per-element ' +
             n(100 * b.shareFar.elem, 0) + '% against per-tile ' + n(100 * b.shareFar.tile, 0) +
             '%. Which class dominates depends on the angle. Expected PEAK error sidelobe is ' +
             n(b.peakOverMeanDb, 1) + ' dB above the mean; the realisation below measures ' +
             n(b.realPeakSllDb, 1) + ' dB.' },
        b.ttd
          ? { k: 'TTD quantisation lobe', n: n(b.ttd.worstDb, 1), unit: 'dB',
              binding: b.ttd.worstDb > -25,
              d: 'deterministic, worst over the commanded-angle grid (at ' + n(b.ttd.worstScanDeg, 1) +
                 '°) at ±' + n(g.rfBwGHz / 2, 1) + ' GHz with a ' + n(b.ttd.stepPs, 0) +
                 ' ps step. At this angle: ' + n(b.ttd.atScanDb, 1) + ' dB. The angle-averaged random ' +
                 'proxy gives ' + n(b.ttd.proxyDb, 1) + ' dB and is not conservative; at broadside the ' +
                 'true value is exactly zero where the proxy is not.' }
          : { k: 'TTD quantisation', n: '0', unit: 'dB', d: 'no TTD step set' },
        { k: 'Band-edge loss', n: n(b.edgeLossDb, 3), unit: 'dB',
          d: 'main-beam drop at ±' + n(g.rfBwGHz / 2, 1) + ' GHz, from the phase-steered elements ' +
             'walking off the delay-steered tile grid' }
      ]
    });

    document.getElementById('beamNote').innerHTML =
      '<strong>The element, not the layout, is the binding decision.</strong> ' + g.nElem +
      ' elements over a ' + n(g.effApertureCm, 1) + ' cm aperture is a <span class="kv">' +
      n(g.elemDxLam, 2) + 'λ</span> lattice, so the array keeps the <em>beamwidth</em> of the full ' +
      'aperture (<span class="kv">' + n(b.m.hpbwDeg, 3) + '°</span>) but only the <em>directivity</em> ' +
      'of its element count: <span class="kv">' + n(g.dArrayDbi, 2) + ' dBi</span> against ' +
      '<span class="kv">' + n(g.dFilledDbi, 2) + ' dBi</span> filled. That ' + n(g.thinningLossDb, 2) +
      ' dB gap is <em>not</em> a thinning loss to be accepted — it is exactly ' +
      '10log10(4π·A_cell/(λ²·D_el)), the ratio of the element’s effective area (' +
      n(g.aEffElMm2, 2) + ' mm²) to its cell (' + n(g.aCellMm2, 0) + ' mm²), i.e. ' +
      n(g.cellFillPct, 2) + '% — and it is recoverable up to the ' + n(g.dCellDbi, 1) +
      ' dBi cell ceiling. It is also, identically, 10log10 of the ' + (g.lobeCount + 1) +
      ' co-equal lattice beams the sparse grid creates: only ' + n(100 / (g.lobeCount + 1), 2) +
      '% of radiated power lands in the intended one.' +
      '<br><br><strong>Errors.</strong> The architecture contributes <span class="kv">' +
      n(b.sigTileDeg) + '°</span> per tile (LO residual, common to a tile’s ' + g.elemPerTile +
      ' elements), <span class="kv">' + n(b.sigDieDeg) + '°</span> per die and <span class="kv">' +
      n(b.sigElemDeg) + '°</span> per element (phase-shifter quantisation ⊕ baseband residual ⊕ ' +
      n(g.iqPhaseDeg, 1) + '° residual IQ imbalance), plus <span class="kv">' + n(b.sigAmpTxDb, 2) +
      ' dB</span> TX amplitude spread. Each class scatters with <em>its own</em> group count ' +
      '<em>and its own angular shape</em>: the tile term carries the tile’s pattern, so the floor is ' +
      '<span class="kv">' + n(b.floorNearDb, 1) + ' dB</span> near the beam and at the comb angles but ' +
      '<span class="kv">' + n(b.floorFarDb, 1) + ' dB</span> between them. Near the beam the phase ' +
      'terms lead; far out, amplitude does. Random-error pointing jitter is σ_u = ' +
      b.jitterU.toExponential(1) + ' against a beamwidth of ' + b.bwU.toExponential(1) +
      ' in u — negligible, and worth saying with a number rather than omitting.' +
      (periodic
        ? '<br><br><strong>But none of that is the decisive number here.</strong> The whole ' +
          n(-b.floorFarDb, 0) + ' dB floor sits ' + n(Math.abs(b.floorNearDb - b.mWide.gratingDb), 0) +
          ' dB below a grating lobe that is only <span class="kv">' + n(-b.mWide.gratingDb, 2) +
          ' dB</span> below the main beam. On a periodic lattice the error floor is not the binding ' +
          'metric at all — it becomes binding only after the lattice is made aperiodic, and that ' +
          'ordering matters for how the decision is argued.'
        : '<br><br>With the lattice aperiodic the discrete lobes are gone and the floor <em>is</em> the ' +
          'binding metric: mean <span class="kv">' + n(g.thinnedFloorDb, 1) + ' dB</span>, expected peak ' +
          '<span class="kv">' + n(g.thinnedPeakDb, 1) + ' dB</span>.');

    /* ---- grating-lobe map ---- */
    var uv = document.getElementById('beamUvMount');
    uv.textContent = '';
    if (periodic && lobes.length) {
      var ubox = document.createElement('div');
      ubox.className = 'chartbox';
      ubox.appendChild(C.uvChart({
        lobes: lobes, u0: b.c.u0, v0: b.c.v0, height: 340,
        floorDb: Math.min(-6, Math.floor(lobes[lobes.length - 1].relDb))
      }));
      uv.appendChild(ubox);
      var rowsL = lobes.slice(0, 12).map(function (L) {
        return {
          cells: ['(' + L.m + ',' + L.n + ')', n(L.thetaDeg, 2), n(L.phiDeg, 0), n(L.relDb, 2)],
          sub: Math.abs(L.phiDeg) < 1 || Math.abs(Math.abs(L.phiDeg) - 180) < 1
            ? 'in the scan-plane cut'
            : Math.abs(Math.abs(L.phiDeg) - 90) < 1 ? 'in the φ=90° cut' : 'in NEITHER cut'
        };
      });
      plainTable(document.getElementById('beamLobeTableMount'),
        ['(m,n)', 'θ (°)', 'φ (°)', 'level (dB)'], rowsL);
      document.getElementById('beamLobeHdr').textContent =
        lobes.length + ' lobes in visible space (' + g.lobeCount + ' at broadside) · worst ' +
        n(worst.relDb, 2) + ' dB at ' + n(worst.thetaDeg, 2) + '°';
      var offPlane = lobes.filter(function (L) {
        var a = Math.abs(L.phiDeg);
        return !(a < 1 || Math.abs(a - 180) < 1 || Math.abs(a - 90) < 1);
      }).length;
      document.getElementById('beamLobeNote').innerHTML =
        'Lobe positions are the <strong>reciprocal lattice of the element lattice</strong>, scaled by λ: ' +
        '(u,v) = (u₀,v₀) + λ(m·b₁ + n·b₂). There are <span class="kv">' + lobes.length +
        '</span> of them inside the horizon at this scan angle and <span class="kv">' + g.lobeCount +
        '</span> at broadside, matching the closed form π·A_cell/λ² = ' +
        n(g.lobeCountClosed, 1) + ', and <span class="kv">' + offPlane + '</span> of them lie in ' +
        '<em>neither</em> principal plane — so a pair of cuts is not an honest presentation of this ' +
        'array. The count is fixed by element <em>density</em> alone: changing the lattice shape moves ' +
        'the lobes but removes none of them. ' +
        (g.elem.key === 'nulled'
          ? 'With the cell-filling nulled element the lobes sit in the element’s sinc nulls — at ' +
            'broadside exactly, and progressively less well as the beam scans away from it, which is ' +
            'why this option buys grating-lobe suppression at the price of scan range.'
          : 'For a uniform periodic array a grating lobe is a <em>full-amplitude</em> replica of the ' +
            'main beam (|AF| = N at every lobe, by the Dirichlet kernel), so only the element pattern ' +
            'suppresses it. Here that is worth ' + n(-worst.relDb, 2) + ' dB at the worst lobe. ' +
            'Reaching 13 dB of suppression would need an element of about ' +
            n(g.dElDbi - 10 * worst.relDb, 0) + ' dBi, above the ' + n(g.dCellDbi, 1) +
            ' dBi a cell this size can support — impossible with any single-lobe element, possible ' +
            'only with a nulled one.') +
        (b.mWide.beamIsPeak ? ''
          : ' <strong>At this scan angle the intended beam is not the strongest lobe in the pattern:</strong> ' +
            'the lobe at ' + n(worst.thetaDeg, 2) + '° is ' + n(worst.relDb, 2) +
            ' dB relative to it. The array is angularly ambiguous ' + (g.lobeCount + 1) + ' ways.');
    } else {
      uv.innerHTML = '<p class="note" style="padding:10px 12px">Aperiodic lattice — there is no ' +
        'reciprocal lattice and no discrete lobe set. The scattered power lands in a floor instead: ' +
        'mean ' + n(g.thinnedFloorDb, 1) + ' dB, expected peak ' + n(g.thinnedPeakDb, 1) + ' dB.</p>';
      plainTable(document.getElementById('beamLobeTableMount'),
        ['Aperiodic layout', 'value'], [
          { cells: ['Mean sidelobe floor, 1/N', n(g.thinnedFloorDb, 2) + ' dB'] },
          { cells: ['Expected peak, +10log10(ln 2L/λ)', n(g.thinnedPeakDb, 2) + ' dB'] },
          { cells: ['Position randomisation needed', n(g.thinNeedRmsMm, 2) + ' mm RMS'] },
          { cells: ['Available by dithering within a cell', n(g.thinAvailRmsMm, 2) + ' mm RMS'] },
          { cells: ['Quasi-grating residue if only that', n(g.thinResidueDb, 1) + ' dB'] },
          { cells: ['Directivity cost of aperiodicity', '0 dB — N·D_el is unchanged'] }
        ]);
      document.getElementById('beamLobeHdr').textContent = 'aperiodic — no lobe lattice';
      document.getElementById('beamLobeNote').innerHTML =
        'Aperiodicity costs no gain: N·D_el does not change, the ' + (g.lobeCount + 1) +
        ' lattice lobes are simply redistributed into a floor. But it is not free. Breaking the ' +
        'periodicity properly needs <span class="kv">' + n(g.thinNeedRmsMm, 2) +
        ' mm</span> RMS position randomisation (enough for the lobe residue exp(−σ²) to fall to 1/N), ' +
        'and dithering inside one cell supplies at most <span class="kv">' + n(g.thinAvailRmsMm, 2) +
        ' mm</span> — so a layout built by perturbing the periodic one keeps a quasi-grating residue ' +
        'near <span class="kv">' + n(g.thinResidueDb, 1) + ' dB</span> at the old lobe angles, well ' +
        'above the ' + n(g.thinnedFloorDb, 1) + ' dB floor. Doing it properly means positions that do ' +
        '<em>not</em> repeat tile to tile, i.e. <strong>tiles that are no longer identical</strong> — ' +
        'which kills the pattern-multiplication framework and the one-tile-design-×-49 economy, and ' +
        'makes per-element position and phase calibration mandatory rather than optional. That lands ' +
        'squarely on the distribution network this tool is about.';
    }

    /* ---- in-tile lattice comparison ---- */
    var latRows = g.latList.map(function (L) {
      var isCur = L === g.lat;
      return {
        cells: [L.label, n(L.lobeDeg, 2), n(L.minSepCm, 2), n(L.minSinLobe, 4)],
        sub: isCur ? 'SELECTED' : (L === g.latBest ? 'best available' : ''),
        mark: false
      };
    }).reverse();
    plainTable(document.getElementById('beamLatTableMount'),
      ['In-tile lattice (index ' + g.elemPerTile + ')', 'worst lobe (°)', 'min separation (cm)', 'Δu'],
      latRows);
    document.getElementById('beamLatHdr').textContent =
      g.lat.label + ' · worst lobe ' + n(g.lat.lobeDeg, 2) + '° · best available ' +
      n(g.latBest.lobeDeg, 2) + '°';
    document.getElementById('beamLatNote').innerHTML =
      'Every sublattice of index ' + g.elemPerTile + ' that <em>contains</em> the tile lattice keeps all ' +
      'tiles identical, and by duality those are exactly the index-' + g.elemPerTile + ' sublattices of ' +
      'the tile reciprocal lattice — a finite set, enumerated in Hermite normal form. The tool used to ' +
      'hard-code <span class="kv">round(√' + g.elemPerTile + ')</span>, which lands on <span class="kv">' +
      n(g.latWorst.lobeDeg, 2) + '°</span>: the <em>worst</em> of them. The best is <span class="kv">' +
      g.latBest.label + '</span> at <span class="kv">' + n(g.latBest.lobeDeg, 2) +
      '°</span>, which also raises minimum element separation to <span class="kv">' +
      n(g.latBest.minSepCm, 2) + ' cm</span> (less coupling) at zero cost in channels, dies or tile ' +
      'pitch. It does not rescue a periodic layout — suppression at ' + n(g.latBest.lobeDeg, 2) +
      '° is still only a fraction of a dB — and it does not reduce the lobe count. It is simply ' +
      'strictly better, and it is the right starting point for a perturbed-aperiodic design. Note that ' +
      'the improvement is invisible in the scan-plane cut: the sheared lattice projects onto the same ' +
      n(g.elemPerTileX, 0) + ' columns, so the gain lives off the principal planes.';

    /* ---- full hemisphere, both principal planes ---- */
    var wm = document.getElementById('beamWideMount');
    wm.textContent = '';
    var wbox = document.createElement('div');
    wbox.className = 'chartbox';
    wbox.appendChild(C.sweepChart({
      series: [
        { name: 'ideal, no random errors', color: 'var(--ink-3)', dashed: true,
          points: b.tx.wide.map(function (p) { return { x: p.deg, y: p.ideal }; }) },
        { name: 'scan plane (φ=0)', color: 'var(--s2)',
          points: b.tx.wide.map(function (p) { return { x: p.deg, y: p.real }; }) },
        { name: 'φ=90° plane', color: 'var(--s1)',
          points: b.tx.wide90.map(function (p) { return { x: p.deg, y: p.real }; }) }
      ],
      xLabel: 'angle from broadside (°)', yLabel: 'dB relative to intended beam', height: 320,
      xMin: -90, xMax: 90, yMin: -55, yMax: 4,
      hLine: b.floorFarDb, hLabel: 'floor between lobes'
    }));
    wm.appendChild(wbox);
    wm.appendChild(C.legend([
      { name: 'ideal, no random errors', color: 'var(--ink-3)', dashed: true },
      { name: 'scan plane φ=0', color: 'var(--s2)' },
      { name: 'φ=90° plane', color: 'var(--s1)' }
    ]));
    document.getElementById('beamWideHdr').textContent = periodic
      ? g.lobeCount + ' grating lobes · worst ' + n(worst.relDb, 2) + ' dB at ' + n(worst.thetaDeg, 2) + '°'
      : 'aperiodic · no discrete grating lobes';
    document.getElementById('beamWideNote').innerHTML =
      'Two cuts, because one axis is not the whole lattice — and even two are not: ' +
      (periodic
        ? 'the worst lobe here sits at φ = ' + n(worst.phiDeg, 0) + '°, and ' +
          lobes.filter(function (L) {
            var a = Math.abs(L.phiDeg);
            return !(a < 1 || Math.abs(a - 180) < 1 || Math.abs(a - 90) < 1);
          }).length + ' of the ' + g.lobeCount + ' lobes appear in neither trace. Use the (u,v) map above. '
        : 'the aperiodic floor is not isotropic either. ') +
      'The zoomed panel below spans ±' + n(b.winDeg, 1) + '°, so everything on this plot except the ' +
      'main beam falls outside it. The dashed trace is the same array with the random errors removed ' +
      'but the <em>deterministic</em> TTD quantisation still in place, so the gap between dashed and ' +
      'solid is what the random part of the distribution architecture costs.';

    /* ---- zoomed main beam: mean pattern against one realisation ---- */
    var mount = document.getElementById('beamCutMount');
    mount.textContent = '';
    var box = document.createElement('div');
    box.className = 'chartbox';
    var win = b.winDeg;
    box.appendChild(C.sweepChart({
      series: [
        { name: 'ideal, no random errors', color: 'var(--ink-3)', dashed: true,
          points: b.tx.centre.map(function (p) { return { x: p.deg, y: p.ideal }; }) },
        { name: 'TX mean pattern', color: 'var(--s2)',
          points: b.tx.centre.map(function (p) { return { x: p.deg, y: p.real }; }) },
        { name: 'RX mean pattern', color: 'var(--s4)',
          points: b.rx.centre.map(function (p) { return { x: p.deg, y: p.real }; }) },
        { name: 'TX, one realisation', color: 'var(--s5)',
          points: b.realPts.map(function (p) { return { x: p.deg, y: p.real }; }) }
      ],
      xLabel: 'angle from broadside (°)', yLabel: 'dB relative to intended beam', height: 340,
      xMin: g.beamScanDeg - win, xMax: g.beamScanDeg + win,
      yMin: -60, yMax: 4, hLine: b.floorNearDb, hLabel: 'mean floor near beam'
    }));
    mount.appendChild(box);
    mount.appendChild(C.legend([
      { name: 'ideal, no random errors', color: 'var(--ink-3)', dashed: true },
      { name: 'TX mean (' + n(b.sigAmpTxDb, 2) + ' dB amp spread)', color: 'var(--s2)' },
      { name: 'RX mean (' + n(b.sigAmpRxDb, 2) + ' dB amp spread)', color: 'var(--s4)' },
      { name: 'TX realisation, seed 20260908', color: 'var(--s5)' }
    ]));
    document.getElementById('beamCutNote').innerHTML =
      'The smooth traces are the <strong>mean</strong> pattern — the exact expectation over the error ' +
      'distribution, which is what an error variance can give you. No array ever radiates it. The ' +
      'jagged trace is <strong>one realisation</strong>, the same array with one draw of the errors ' +
      'summed element by element, and it is the honest picture: nulls fill in at specific angles, and ' +
      'the peak error sidelobe runs above the mean floor by about 10log10(ln(2L/λ)) = <span class="kv">' +
      n(b.peakOverMeanDb, 1) + ' dB</span> — here measured at <span class="kv">' +
      n(b.realPeakSllDb, 1) + ' dB</span> against a mean floor of ' + n(b.floorNearDb, 1) + ' dB. ' +
      'If null depth is the metric that decides the architecture, the mean pattern flatters it. TX and ' +
      'RX differ only through amplitude spread, since the LO residual is common to both directions.';

    /* ---- band edges: the squint story ---- */
    var m2 = document.getElementById('beamSquintMount');
    m2.textContent = '';
    var box2 = document.createElement('div');
    box2.className = 'chartbox';
    var fLo = g.fLoGHz - g.rfBwGHz / 2, fHi = g.fLoGHz + g.rfBwGHz / 2;
    box2.appendChild(C.sweepChart({
      series: [
        { name: n(fLo, 1) + ' GHz', color: 'var(--s1)',
          points: b.tx.lowEdge.map(function (p) { return { x: p.deg, y: p.real }; }) },
        { name: n(g.fLoGHz, 1) + ' GHz', color: 'var(--s2)',
          points: b.tx.centre.map(function (p) { return { x: p.deg, y: p.real }; }) },
        { name: n(fHi, 1) + ' GHz', color: 'var(--s4)',
          points: b.tx.highEdge.map(function (p) { return { x: p.deg, y: p.real }; }) }
      ],
      xLabel: 'angle from broadside (°)', yLabel: 'dB relative to band-centre beam', height: 300,
      xMin: g.beamScanDeg - win, xMax: g.beamScanDeg + win, yMin: -50, yMax: 4
    }));
    m2.appendChild(box2);
    m2.appendChild(C.legend([
      { name: n(fLo, 1) + ' GHz', color: 'var(--s1)' },
      { name: n(g.fLoGHz, 1) + ' GHz (centre)', color: 'var(--s2)' },
      { name: n(fHi, 1) + ' GHz', color: 'var(--s4)' }
    ]));
    document.getElementById('beamSquintNote').innerHTML =
      '<strong>Delay between tiles, phase within a tile — and here is the margin.</strong> At ' +
      n(g.scanDegMax, 0) + '° scan the differential delay across one ' + n(g.tileCm, 1) +
      ' cm tile pitch is <span class="kv">' + n(b.tauTilePs, 1) + ' ps</span>, and across its ' +
      n(b.spanXcm, 0) + ' cm of element centres <span class="kv">' + n(b.tauSpanPs, 1) +
      ' ps</span>, which at ±' + n(g.rfBwGHz / 2, 1) + ' GHz is a <span class="kv">' + n(b.taperDeg, 1) +
      '°</span> peak-to-peak phase taper across the tile and costs <span class="kv">' +
      n(b.taperLossDb, 3) + ' dB</span>. The same aperture with <em>no</em> inter-tile TTD carries ' +
      '<span class="kv">' + n(b.tauApPs, 0) + ' ps</span> and squints by <span class="kv">' +
      n(b.squintBeamwidths, 2) + '</span> beamwidths at the band edge. So the split is right by a ' +
      'margin of ' + n(b.taperLossDb, 2) + ' dB against ' + n(b.squintBeamwidths, 2) +
      ' beamwidths — but note that <em>both</em> numbers scale as sinθ₀: the TTD hardware is bought by ' +
      'the <strong>scan range</strong>, not by the bandwidth alone, and at ±10° the no-TTD squint is ' +
      'only ' + n(b.squintBeamwidths * Math.sin(K.deg2rad(10)) / Math.max(Math.sin(K.deg2rad(g.scanDegMax)), 1e-6), 2) +
      ' beamwidths and the requirement largely evaporates. That makes the TTD step a first-class ' +
      'architectural parameter, not a detail: ' +
      (b.ttd ? 'at ' + n(b.ttd.stepPs, 0) + ' ps the worst-case quantisation lobe is ' +
        n(b.ttd.worstDb, 1) + ' dB, at the ' + n(b.ttd.worstScanDeg, 1) + '° commanded angle.' : '');

    UI.renderProse(document.getElementById('beamCaveats'), window.Content.beamCaveats(g, b));
  }

  /* =====================================================================
     Sweeps
     ================================================================== */
  function sweepEval(optId, overridesObj) {
    var s = {};
    Object.keys(state).forEach(function (k) { s[k] = state[k]; });
    Object.keys(overridesObj).forEach(function (k) { s[k] = overridesObj[k]; });
    var g = M.resolve(s);
    return M.evalLo(optId, g);
  }

  function renderSweeps(res, budget) {
    var cc = document.getElementById('sweepCharts');
    cc.textContent = '';
    var colors = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];

    function panel(title, note, chart, legendItems) {
      var sec = document.createElement('section');
      sec.className = 'panel';
      var h = document.createElement('h2');
      h.textContent = title;
      sec.appendChild(h);
      var box = document.createElement('div');
      box.className = 'chartbox';
      box.appendChild(chart);
      sec.appendChild(box);
      if (legendItems) sec.appendChild(C.legend(legendItems));
      if (note) {
        var b = document.createElement('div');
        b.className = 'body';
        var p = document.createElement('p');
        p.className = 'note';
        p.innerHTML = note;
        b.appendChild(p);
        sec.appendChild(b);
      }
      cc.appendChild(sec);
    }

    /* 1 — multiplication factor M */
    var Ms = [2, 3, 4, 6, 8];
    panel('Mid-frequency option vs multiplication factor M',
      'Larger M means a lower distribution frequency: less loss and power, but <span class="kv">20log10(M)</span> ' +
      'more phase noise and M× amplification of every distributed phase error and BIST measurement error. The ' +
      'skew curve is flat by construction — that is the algebra, not an artefact.',
      C.sweepChart({
        series: [
          { name: 'residual inter-tile φ (°)', color: 'var(--s1)', markers: true,
            points: Ms.map(function (m) { return { x: m, y: sweepEval('mid-mult', { midM: m }).interTileResidualDeg }; }) },
          { name: 'distribution loss (dB)', color: 'var(--s2)', markers: true,
            points: Ms.map(function (m) { return { x: m, y: sweepEval('mid-mult', { midM: m }).lossTotalDb }; }) },
          { name: 'distribution power (W)', color: 'var(--s4)', markers: true,
            points: Ms.map(function (m) { return { x: m, y: sweepEval('mid-mult', { midM: m }).powerTotalMw / 1000 }; }) },
          { name: 'skew at LO (°)', color: 'var(--s3)', dashed: true, markers: true,
            points: Ms.map(function (m) { return { x: m, y: sweepEval('mid-mult', { midM: m }).skewDeg78 }; }) }
        ],
        xLabel: 'multiplication factor M', yLabel: 'value', height: 280,
        hLine: budget.sigSpecDeg, hLabel: 'φ spec'
      }), [
        { name: 'residual φ (°)', color: 'var(--s1)' }, { name: 'loss (dB)', color: 'var(--s2)' },
        { name: 'power (W)', color: 'var(--s4)' }, { name: 'skew at LO (°)', color: 'var(--s3)', dashed: false }
      ]);

    /* 2 — PLL loop bandwidth */
    var bws = [0.03, 0.1, 0.3, 1, 3, 10];
    panel('Local-PLL option vs loop bandwidth',
      'The single most important A1 parameter. A wider loop lets each tile track the shared reference over more of ' +
      'the spectrum, shrinking the uncorrelated band — but it also lets more in-band PFD noise through. The ' +
      'minimum is the best A1 can do, and it is still bounded by the uncorrelated in-band share ' +
      '(<span class="kv">' + n(state.uncorrInbandFrac, 2) + '</span>, a guess).',
      C.sweepChart({
        series: [{
          name: 'residual inter-tile φ (°)', color: 'var(--s1)', markers: true,
          points: bws.map(function (b) { return { x: b, y: sweepEval('local-pll', { pllLoopBwMHz: b }).interTileResidualDeg }; })
        }, {
          name: 'array-output EVM (dB)', color: 'var(--s4)', markers: true,
          points: bws.map(function (b) { return { x: b, y: sweepEval('local-pll', { pllLoopBwMHz: b }).evmDb }; })
        }],
        xLabel: 'PLL loop bandwidth (MHz)', yLabel: 'value', height: 260,
        hLine: budget.sigSpecDeg, hLabel: 'φ spec'
      }), [{ name: 'residual φ (° RMS)', color: 'var(--s1)' }, { name: 'EVM (dB)', color: 'var(--s4)' }]);

    /* 3 — BIST update rate: the genuine optimum */
    var rates = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100];
    panel('Residual vs BIST update rate',
      'Too slow leaves thermal drift; too fast imports measurement noise, so there is a real optimum. Note the ' +
      'curve is nearly flat well before 100 Hz: the ~100 Hz <em>beam</em>-update rate is not a calibration rate ' +
      'and buying it would cost duty cycle for nothing.',
      C.sweepChart({
        series: M.LO_META.map(function (m, i) {
          return {
            name: m.short, color: colors[i], markers: true,
            points: rates.map(function (r) { return { x: Math.log10(r), y: sweepEval(m.id, { fBistHz: r }).interTileResidualDeg }; })
          };
        }),
        xLabel: 'log10(BIST update rate / Hz)', yLabel: 'residual inter-tile φ (°)', height: 260,
        hLine: budget.sigSpecDeg, hLabel: 'spec'
      }), M.LO_META.map(function (m, i) { return { name: m.short, color: colors[i] }; }));

    /* 4 — tile count */
    var tiles = [2, 3, 4, 5, 6, 8, 10];
    panel('Scaling with tile count',
      'Tile side is swept from ' + n(state.apertureCm / 2, 1) + ' cm down, holding the aperture fixed. More tiles ' +
      'means more independent LO instances: the coherence floor at <span class="kv">10log10(σ²/N)</span> improves ' +
      'with N for a fixed σ, but σ itself grows with routing depth.',
      C.sweepChart({
        series: M.LO_META.map(function (m, i) {
          return {
            name: m.short, color: colors[i], markers: true,
            points: tiles.map(function (k) {
              var r = sweepEval(m.id, { tileCm: state.apertureCm / k });
              return { x: k * k, y: r.interTileResidualDeg };
            })
          };
        }),
        xLabel: 'number of tiles', yLabel: 'residual inter-tile φ (°)', height: 260,
        hLine: budget.sigSpecDeg, hLabel: 'spec'
      }), M.LO_META.map(function (m, i) { return { name: m.short, color: colors[i] }; }));

    /* 5 — length tolerance */
    var tols = [2, 5, 10, 25, 50, 100];
    panel('Skew vs mechanical length tolerance',
      'At ' + n(state.fLoGHz, 0) + ' GHz one degree is <span class="kv">' +
      n(K.umPerDeg(state.fLoGHz * 1e9, res.g.epsEff), 1) + ' µm</span> of physical length in this medium. This is ' +
      'the same curve for every distribution frequency, because an ideal multiplier preserves time delay — the ' +
      'reason mid-frequency distribution buys no skew relief.',
      C.sweepChart({
        series: M.LO_META.map(function (m, i) {
          return {
            name: m.short, color: colors[i], markers: true,
            points: tols.map(function (t) { return { x: t, y: sweepEval(m.id, { lenTolUm: t }).skewDeg78 }; })
          };
        }),
        xLabel: 'per-segment length tolerance (µm, 1σ)', yLabel: 'skew at LO (° RMS)', height: 260,
        hLine: budget.sigSpecDeg, hLabel: 'spec'
      }), M.LO_META.map(function (m, i) { return { name: m.short, color: colors[i] }; }));

    /* 6 — aperture */
    var aps = [10, 15, 20, 30, 40, 50];
    panel('Scaling with aperture',
      'Loss and power scale with routed length, so the shared-LO options degrade as the aperture grows while the ' +
      'per-tile PLL option is nearly flat. This is the modularity argument for A1, quantified.',
      C.sweepChart({
        series: M.LO_META.map(function (m, i) {
          return {
            name: m.short, color: colors[i], markers: true,
            points: aps.map(function (a) { return { x: a, y: sweepEval(m.id, { apertureCm: a }).powerTotalMw / 1000 }; })
          };
        }),
        xLabel: 'aperture side (cm)', yLabel: 'distribution power (W)', height: 260
      }), M.LO_META.map(function (m, i) { return { name: m.short, color: colors[i] }; }));
  }

  /* =====================================================================
     Decision, assumptions, method
     ================================================================== */
  function renderDecision(res, budget, dec) {
    UI.renderProse(document.getElementById('decisionMount'), dec.text);

    var t = document.getElementById('scoreTable');
    t.textContent = '';
    var thead = document.createElement('thead');
    var htr = document.createElement('tr');
    htr.appendChild(UI.elt('th', null, 'Criterion'));
    M.LO_META.forEach(function (m) { htr.appendChild(UI.elt('th', null, m.short)); });
    htr.appendChild(UI.elt('th', null, 'Weight'));
    thead.appendChild(htr);
    t.appendChild(thead);
    var tb = document.createElement('tbody');
    window.Decision.WEIGHTS.forEach(function (W, wi) {
      var tr = document.createElement('tr');
      var nm = UI.elt('td', 'mn');
      nm.appendChild(document.createTextNode(W.label));
      nm.appendChild(UI.elt('small', null, W.why));
      tr.appendChild(nm);
      M.LO_META.forEach(function (m) {
        var row = dec.loRank.filter(function (r) { return r.id === m.id; })[0];
        var d = row.detail[wi];
        var td = UI.elt('td', 'v');
        td.textContent = n(d.raw) + '  (' + (d.norm * 100).toFixed(0) + ')';
        tr.appendChild(td);
      });
      tr.appendChild(UI.elt('td', 'v', W.w.toFixed(2)));
      tb.appendChild(tr);
    });
    var trs = document.createElement('tr');
    var c0 = UI.elt('td', 'mn');
    c0.innerHTML = '<strong>weighted score</strong>';
    trs.appendChild(c0);
    M.LO_META.forEach(function (m) {
      var row = dec.loRank.filter(function (r) { return r.id === m.id; })[0];
      var td = UI.elt('td', 'v' + (row.id === dec.loPick.id ? ' rec' : ''));
      td.innerHTML = '<strong>' + (row.score * 100).toFixed(0) + '</strong>' +
        (row.eligible ? '' : row.infeasible ? ' <span class="badge fail">infeasible</span>' : ' <span class="badge fail">off-spec</span>');
      trs.appendChild(td);
    });
    trs.appendChild(UI.elt('td', 'v', '1.00'));
    tb.appendChild(trs);
    t.appendChild(tb);
  }

  function renderAssumptions(res) {
    var entries = M.PARAMS.map(function (p) {
      return {
        key: p.key, label: p.label, value: state[p.key], units: p.units,
        confidence: p.conf, justification: p.why, group: p.group
      };
    });
    UI.renderAssumptions(document.getElementById('assumeTable'), document.getElementById('confSummary'), entries);

    /* block library table */
    var t = document.getElementById('blockTable');
    t.textContent = '';
    var thead = document.createElement('thead');
    var htr = document.createElement('tr');
    ['Block', 'Tech', 'f (GHz)', 'Power (mW)', 'Gain (dB)', 'Area (mm²)', 'Add. PN floor', 'Confidence', 'Basis'].forEach(function (h, i) {
      var th = UI.elt('th', null, h);
      if (i === 8) th.style.textAlign = 'left';
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    t.appendChild(thead);
    var tb = document.createElement('tbody');
    Object.keys(res.blocks).forEach(function (k) {
      var b = res.blocks[k];
      var tr = document.createElement('tr');
      var c = UI.elt('td', 'mn');
      c.appendChild(document.createTextNode(b.name));
      c.appendChild(UI.elt('small', null, k));
      tr.appendChild(c);
      tr.appendChild(UI.elt('td', 'v', b.tech));
      tr.appendChild(UI.elt('td', 'v', b.freqGHz));
      tr.appendChild(UI.elt('td', 'v', b.powerMw));
      tr.appendChild(UI.elt('td', 'v', b.gainDb));
      tr.appendChild(UI.elt('td', 'v', b.areaMm2));
      tr.appendChild(UI.elt('td', 'v', b.addPnFloorDbc ? b.addPnFloorDbc + ' dBc/Hz' : '—'));
      var cf = UI.elt('td');
      cf.appendChild(UI.elt('span', 'conf ' + UI.confClass(b.conf), UI.confShort(b.conf)));
      tr.appendChild(cf);
      var w = UI.elt('td', null, b.why);
      w.style.cssText = 'text-align:left;white-space:normal;min-width:300px';
      tr.appendChild(w);
      tb.appendChild(tr);
    });
    t.appendChild(tb);

    UI.renderProse(document.getElementById('honestyMount'), window.Content.HONESTY);
  }

  /* =====================================================================
     Main render
     ================================================================== */
  var last = null;

  function render() {
    var res = M.evaluate(state);
    var budget = window.Budget.derive(res.g, '64QAM');
    var dec = window.Decision.build(res, budget);
    last = { res: res, budget: budget, dec: dec };

    /* clamp the tile selection if the grid shrank */
    if (view.selected >= res.selected.grid.nTiles) view.selected = 0;

    renderPicker(res, budget);
    UI.renderBudget(document.getElementById('budgetGrid'), document.getElementById('budgetNote'),
      document.getElementById('bindingNote'), budget);

    UI.renderParams(document.getElementById('paramMount'), M.PARAMS.map(function (p) {
      return {
        key: p.key, label: p.label, units: p.units, group: p.group, min: p.min, max: p.max,
        step: p.step, choices: p.choices, justification: p.why, confidence: p.conf
      };
    }), state, DEFAULTS, setParam);

    var nd = Object.keys(overrides()).length;
    document.getElementById('dirtyCount').textContent = nd ? nd + ' changed from defaults' : 'all at defaults';

    if (view.name === 'map') renderMapView(res, budget);
    if (view.name === 'compare') renderCompare(res, budget, dec);
    if (view.name === 'phasenoise') renderPn(res, budget);
    if (view.name === 'beam') renderBeam(res, budget);
    if (view.name === 'sweeps') renderSweeps(res, budget);
    if (view.name === 'decision') renderDecision(res, budget, dec);
    if (view.name === 'assumptions') renderAssumptions(res);
    if (view.name === 'method') UI.renderProse(document.getElementById('methodMount'), window.Content.METHOD);

    document.getElementById('footNote').innerHTML =
      'Architecture-selection instrument, not a validated simulator &mdash; read the honesty ledger before quoting a number. ' +
      'Model recomputed live from ' + M.PARAMS.length + ' parameters; the map and the tables share one topology generator.';
  }

  /* ------------------------------- routing ------------------------------- */
  function setView(name) {
    view.name = name;
    document.querySelectorAll('.navlink').forEach(function (a) {
      a.classList.toggle('on', a.getAttribute('data-view') === name);
    });
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('hidden', v.id !== 'view-' + name);
    });
    /* the picker and budget banner only make sense on the map/compare views */
    var showPick = name === 'map';
    document.getElementById('pickerPanel').classList.toggle('hidden', !showPick);
    document.getElementById('budgetPanel').classList.toggle('hidden', name === 'assumptions' || name === 'method');
    render();
  }

  /* ------------------------------- exports ------------------------------- */
  function tableRows(id) { return UI.tableToRows(document.getElementById(id)); }

  var EXPORTS = {
    lo:     { id: 'loTable',    title: 'LO / reference distribution comparison', file: 'lo-distribution.csv' },
    bb:     { id: 'bbTable',    title: 'Baseband split / combine comparison',    file: 'bb-distribution.csv' },
    assume: { id: 'assumeTable', title: 'Parameter provenance',                  file: 'assumptions.csv' },
    bom:    { id: 'bomMount',   title: 'Hardware bill of materials',             file: 'bom.csv' }
  };

  /* kind: lo | bb | assume | bom | decision ;  fmt: md | csv ;  mode: copy | dl */
  function handleExport(kind, fmt, mode) {
    if (kind === 'decision') {
      X.copy(last ? last.dec.text : '', 'Decision');
      return;
    }
    var m = EXPORTS[kind];
    if (!m) return;
    var host = document.getElementById(m.id);
    if (!host) return;
    var table = host.tagName === 'TABLE' ? host : host.querySelector('table');
    if (!table) { X.flash('Nothing to export yet — open that view first'); return; }
    var rows = UI.tableToRows(table);
    var foot = [
      'Generated by the E-band distribution comparison tool.',
      'Configuration: ' + (X.encodeState(overrides()) || 'all defaults'),
      'Architecture-selection estimates, not measured data — see the honesty ledger.'
    ];
    if (mode === 'dl') X.download(m.file, X.toCsv(rows), 'text/csv');
    else if (fmt === 'csv') X.copy(X.toCsv(rows), 'CSV');
    else X.copy(X.toMarkdown(rows, { title: m.title, footnotes: foot }), 'Markdown table');
  }

  function parseSpec(spec) {
    var i = spec.lastIndexOf('-');
    return i < 0 ? { kind: spec, fmt: 'md' } : { kind: spec.slice(0, i), fmt: spec.slice(i + 1) };
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var a = t.closest ? t.closest('.navlink') : null;
    if (a) { e.preventDefault(); setView(a.getAttribute('data-view')); return; }
    var btn = t.closest ? t.closest('button[data-copy],button[data-dl]') : null;
    if (!btn) return;
    if (btn.dataset.copy) {
      var s = parseSpec(btn.dataset.copy);
      handleExport(s.kind, s.fmt, 'copy');
    } else if (btn.dataset.dl) {
      var d = parseSpec(btn.dataset.dl);
      handleExport(d.kind, d.fmt, 'dl');
    }
  });

  document.getElementById('resetBtn').addEventListener('click', function () {
    state = {};
    Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k]; });
    syncHash();
    render();
    X.flash('Reset to defaults');
  });
  document.getElementById('permaBtn').addEventListener('click', function () {
    X.copy(X.permalink(overrides()), 'Permalink');
  });
  /* light -> dark -> follow system -> light. Light is the shipped default;
     the inline script in the document head applies it before first paint. */
  var THEME_CYCLE = { 'light': 'dark', 'dark': '', '': 'light' };
  var THEME_LABEL = { 'light': 'Light theme — click for dark', 'dark': 'Dark theme — click to follow system', '': 'Following system — click for light' };
  function labelTheme() {
    var cur = document.documentElement.getAttribute('data-theme') || '';
    var b = document.getElementById('themeBtn');
    b.title = THEME_LABEL[cur] || THEME_LABEL['light'];
    b.setAttribute('aria-label', b.title);
    b.textContent = cur === 'dark' ? '☽' : cur === 'light' ? '☀' : '◑';
  }
  document.getElementById('themeBtn').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme') || '';
    var next = THEME_CYCLE[cur] !== undefined ? THEME_CYCLE[cur] : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('ebdt-theme', next); } catch (e) { /* private mode */ }
    labelTheme();
    render();
  });

  /* ------------------------------- boot ---------------------------------
     The theme itself is applied by the inline script in the document head,
     before first paint. Here we only sync the button's icon and tooltip to
     whatever it settled on. */
  labelTheme();

  loadState();
  setView(view.name);
  X.hideDeadSaveButtons();
})();
