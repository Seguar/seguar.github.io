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
    rows.push({ name: 'Array-output EVM', field: 'evmPct', units: '%', better: 'low' });
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

    document.getElementById('pickerNote').textContent =
      budget.nTiles + ' tiles · ' + n(state.tapsPerTile * budget.nTiles, 0) + ' LO taps · ' +
      n(state.chPerTile * budget.nTiles, 0) + ' BB channels per rail';
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

    var tm = TILE_METRICS.filter(function (m) { return m.key === view.tileMetric; })[0];
    window.Diagram.renderMap(document.getElementById('mapMount'), built, {
      tileMetric: view.tileMetric, tileMetricLabel: tm ? tm.label : view.tileMetric,
      selected: view.selected, sourceLabel: res.g.refName,
      showBlocks: view.showBlocks, showLo: view.showLo,
      showBb: view.showBb, showDies: view.showDies
    }, function (i) { view.selected = i; render(); });

    window.Diagram.renderLegend(document.getElementById('mapLegend'), built);
    var bsel0 = res.bb[res.g.bbOptionId];
    document.getElementById('mapNote').innerHTML =
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
          k: 'Array-output EVM', n: n(sel.evmPct), unit: '%',
          binding: sel.evmPct > budget.evmLimitPct,
          d: 'from ' + n(sel.phiArrayDeg) + '° absolute · supports ' + sel.maxQam +
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
      '(<span class="kv">' + n(a1.evmPct) + '%</span> against <span class="kv">' + n(a4.evmPct) + '%</span>) while ' +
      'giving <em>worse</em> beam coherence. The two budgets genuinely point in opposite directions.');

    /* jitter table */
    var rows = [
      { name: 'Single-tile φ RMS', field: 'phiRmsDeg', units: '°', better: 'low' },
      { name: 'Array-output φ RMS', field: 'phiArrayDeg', units: '°', better: 'low', spec: budget.sigForEvmDeg },
      { name: 'RMS jitter', field: 'jitterFs', units: 'fs', better: 'low', dec: 1 },
      { name: 'Inter-tile differential φ, raw', field: 'pnDiffRawDeg', units: '°', better: 'low' },
      { name: 'Inter-tile differential φ, calibrated', field: 'pnDiffCalDeg', units: '°', better: 'low', spec: budget.sigSpecDeg },
      { name: 'Calibration corner f_cal', field: 'fCalHz', units: 'Hz', dec: 3 },
      { name: 'Array-output EVM', field: 'evmPct', units: '%', better: 'low' },
      { name: 'Highest supportable QAM', field: 'maxQam', fmt: function (v, r) { return str(r.maxQam); } }
    ];
    UI.renderTable(document.getElementById('jitterTable'),
      M.LO_META.map(function (m) { return { id: m.id, name: m.name }; }), res.lo, rows, null);
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
          name: 'array-output EVM (%)', color: 'var(--s4)', markers: true,
          points: bws.map(function (b) { return { x: b, y: sweepEval('local-pll', { pllLoopBwMHz: b }).evmPct }; })
        }],
        xLabel: 'PLL loop bandwidth (MHz)', yLabel: 'value', height: 260,
        hLine: budget.sigSpecDeg, hLabel: 'φ spec'
      }), [{ name: 'residual φ (°)', color: 'var(--s1)' }, { name: 'EVM (%)', color: 'var(--s4)' }]);

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
  document.getElementById('themeBtn').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme');
    var next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('ebdt-theme', next); } catch (e) { /* private mode */ }
    render();
  });

  /* ------------------------------- boot --------------------------------- */
  try {
    var th = localStorage.getItem('ebdt-theme');
    if (th) document.documentElement.setAttribute('data-theme', th);
  } catch (e) { /* ignore */ }

  loadState();
  setView(view.name);
  X.hideDeadSaveButtons();
})();
