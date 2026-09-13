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
    showBlocks: true, showLo: true, showBb: true, showDies: true, showAnts: true,
    /* Systems view: transient UI state only. The saved systems themselves
       live in localStorage via window.Systems; `shared` holds systems that
       arrived in a link, which are deliberately NOT written to storage
       until the user imports them — a URL should not be able to overwrite
       what someone saved. */
    sys: {
      diffOnly: false, deltaMode: false, baseline: null,
      renaming: null, confirmDelete: null, confirmClear: false, shared: [],
      confirmShortlist: false,
      excluded: {}
    }
  };

  /* ONE series palette, because it was duplicated at three call sites and all
     three ended in var(--accent) — which resolves to exactly var(--s1) in
     both themes, so A1 Local PLL and A6 Injection lock drew in the same
     colour in every phase-noise overlay, every compare bar and every sweep,
     with two identical legend swatches. A1 against A6 is the comparison the
     phase-noise view exists to make.

     The dash pattern is the second channel: six overlapping L(f) curves
     separated by hue alone are unreadable printed, projected, or with
     deuteranopia. Index i gets DASHES[i], so the pairs that are closest in
     hue are never also closest in stroke. */
  var SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];
  var DASHES = [null, '6 3', null, '2 3', '9 3 2 3', '4 2'];

  var TILE_METRICS = [
    { key: 'skewPs', label: 'skew vs array mean (ps)' },
    { key: 'wraps', label: 'static offset (wraps to resolve)' },
    { key: 'driftDeg', label: 'thermal drift (°, uncalibrated)' },
    { key: 'lossDb', label: 'path loss (dB)' },
    { key: 'powerMw', label: 'distribution power (mW)' }
  ];

  /* MIGRATION, which must run BEFORE any clamp sees the value.

     elemModelSel used to have a third choice, 2 = "Cell-filling nulled".
     It is retired, and C3 at K = 64 in span mode is the same antenna built
     from discrete radiators. The hazard is clampParam: it snaps an
     out-of-range choice to the NEAREST declared one, so a stored 2 would
     become 1 — an HPBW-matched patch — before anything could notice, and a
     16.8 dB change would be presented as a faithful restore. Migrating
     first is the only way that stays honest. Returns the keys it moved so
     the caller can say so. */
  /* The size of the Chooser's space, derived exactly as search() derives it:
     the two option families times the antenna configurations that survive
     screening. NEVER a literal — it was hard-coded as 300 in two places
     against a live 350, so the page could show both numbers at once, and the
     antenna count moves whenever a kAllowed set or a consistency rule
     changes. Module scope because both the pre-search prompt and the run
     handler need it. */
  function spaceSize() {
    try {
      var kept = window.Model.searchAntConfigs(state);
      return window.Model.LO_IDS.length * window.Model.BB_IDS.length * kept.keep.length;
    } catch (e) { return null; }
  }

  function migrateRawState(raw) {
    var moved = [];
    if (raw && Math.round(parseFloat(raw.elemModelSel)) === 2) {
      raw.elemModelSel = 0;
      raw.antOption = 2;          /* C3 Kx×Ky cluster */
      raw.radPerCh = 64;
      raw.radSpanPitch = 1;       /* spanning: nulls on the reciprocal lattice */
      moved.push('elemModelSel=2 (retired "cell-filling nulled") → C3 cluster, K=64, spanning');
    }
    /* chPerTile was a free slider; it is now DERIVED from the 1:1 baseband
       pairing as bbIqChPerDie × dies per tile. A link carrying the old key
       would otherwise be dropped by the `k in DEFAULTS` filter and come back
       silently at the new default — the same "faithful restore that is not
       faithful" hazard that retiring elemModelSel=2 had. Convert it instead,
       so an old system reproduces its own numbers, and SAY SO. The old 32
       against 4 dies restores as 8 IQ channels per die, which is the
       full-duplex reading; the consistency check then explains why that
       needs two baseband dies per RFIC die rather than one. */
    if (raw && raw.chPerTile !== undefined && raw.bbIqChPerDie === undefined) {
      var oldCh = Math.round(parseFloat(raw.chPerTile));
      var dies = Math.max(1, Math.round(parseFloat(raw.tapsPerTile) || DEFAULTS.tapsPerTile || 4));
      if (isFinite(oldCh) && oldCh > 0) {
        var perDie = Math.max(1, Math.min(16, Math.round(oldCh / dies)));
        raw.bbIqChPerDie = perDie;
        moved.push('chPerTile=' + oldCh + ' (retired free slider) → ' + perDie +
          ' IQ channels per baseband die × ' + dies + ' dies = ' + (perDie * dies) + ' per tile');
      }
      delete raw.chPerTile;
    }
    return moved;
  }

  function loadState() {
    state = {};
    Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k]; });
    var over = X.decodeState(location.hash);
    view.migrated = migrateRawState(over);
    Object.keys(over).forEach(function (k) {
      /* A view name out of a URL is untrusted input like any other: an
         unknown one would hide every panel and leave a blank page. */
      if (k === '_v') {
        if (document.getElementById('view-' + over[k])) view.name = over[k];
        return;
      }
      /* A comparison set carried in the link is decoded but NOT stored: it
         appears in the roster marked "from link" with an Import button. A
         URL is input from wherever it came, and it should not be able to
         silently replace systems someone saved. */
      if (k === '_sys') {
        try { view.sys.shared = window.Systems.decodeSet(over[k], DEFAULTS, clampParam); }
        catch (e) { view.sys.shared = []; }
        return;
      }
      if (!(k in DEFAULTS)) return;
      var v = parseFloat(over[k]);
      if (isFinite(v)) state[k] = clampParam(k, v);
    });
  }

  /* A hash is input from wherever it came — a hand-edited link, a truncated
     paste, an older version of the tool — so a value out of a parameter's
     declared range must not reach the renderers. A choice-valued parameter
     is the dangerous case: several places index the option metadata by it
     (the map title, the beam header, the save handler), and an out-of-range
     index throws on `.name` before anything gets a chance to fall back,
     which took the whole page down at boot rather than degrading. Numeric
     parameters are clamped to their declared min/max for the same reason. */
  function clampParam(key, v) {
    var p = paramByKey(key);
    if (!p) return v;
    if (p.choices && p.choices.length) {
      var best = p.choices[0].value, bestD = Infinity;
      p.choices.forEach(function (c) {
        var d = Math.abs(c.value - v);
        if (d < bestD) { bestD = d; best = c.value; }
      });
      return best;
    }
    if (isFinite(p.min) && v < p.min) return p.min;
    if (isFinite(p.max) && v > p.max) return p.max;
    return v;
  }
  function overrides() {
    var o = {};
    Object.keys(state).forEach(function (k) { if (state[k] !== DEFAULTS[k]) o[k] = state[k]; });
    return o;
  }
  function syncHash() {
    /* Carry the view too. loadState has always decoded `_v`, but syncHash
       encoded only the parameter overrides, so every link the student sent
       opened on the Hardware map however carefully they had navigated to the
       chart they wanted to show. The map is the default, so it is omitted and
       links stay short. */
    var o = overrides();
    if (view.name && view.name !== 'map') o._v = view.name;
    var s = X.encodeState(o);
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
    rows.push({
      name: '· · round-trip reciprocity (A5)', sub: 'what a self-correcting line leaves behind: the forward/reverse asymmetry it cannot see',
      field: 'reciprocityDeg', units: '°', better: 'low', rank: false,
      fmt: function (v, r) { return r.selfCorrecting ? n(v) : 'n/a'; }
    });
    rows.push({
      name: '· · return-coupler bias (A5)', sub: 'leakage through finite directivity, biasing the phase the servo measures',
      field: 'couplerBiasDeg', units: '°', better: 'low', rank: false,
      fmt: function (v, r) { return r.selfCorrecting ? n(v) : 'n/a'; }
    });
    rows.push({
      name: '· · locked-phase drift (A6)', sub: 'arcsin(Δf/f_lock) moving with temperature — an error class A1–A5 do not have',
      field: 'lockOffsetDriftDeg', units: '°', better: 'low', rank: false,
      fmt: function (v, r) { return r.lockOffsetDeg > 0 ? n(v) : 'n/a'; }
    });
    rows.push({
      name: 'Locked phase offset, static (A6)', sub: 'deterministic and calibratable, but it is why A6 needs trimmed tanks',
      field: 'lockOffsetDeg', units: '°', better: 'low', rank: false,
      fmt: function (v, r) { return r.lockOffsetDeg > 0 ? n(v) : 'n/a'; }
    });
    rows.push({ name: '· phase-shifter quantisation', field: 'quantDeg', units: '°', better: 'low' });
    rows.push({ section: 'M4 · inter-tile skew — static (calibratable) vs drifting (not)' });
    /* rank:false, for the reason the Systems view already gives: this number
       is 96.6% geometric path imbalance, which the block below labels "known
       by construction — equalise it in layout". Crowning the option with the
       least of it crowns a layout property, not an architecture. It is also
       within 0.005 ps of the Systematic row underneath, because that row is
       the same quantity: skewRmsPs = rss(skewStatic, skewDrift) and the
       drift part is 0.6 ps against 56. The rows that decide anything are the
       drift row and the residual. */
    rows.push({
      name: 'Total RMS skew', sub: 'almost all of it static and calibratable — see the drift row',
      field: 'skewRmsPs', units: 'ps', better: 'low', rank: false
    });
    rows.push({ name: 'Peak skew', field: 'skewPeakPs', units: 'ps', better: 'low', rank: false });
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
    rows.push({
      name: 'Total loss', sub: 'worst path — this is also the gain the network must contain',
      field: 'lossTotalDb', units: 'dB', better: 'low', dec: 1
    });
    rows.push({ name: '· on the mean path', field: 'lossMeanDb', units: 'dB', better: 'low', dec: 1, rank: false });
    rows.push({ name: '· line loss', field: 'lineLossDb', units: 'dB', better: 'low', dec: 1 });
    rows.push({ name: '· split / tap loss', field: 'splitLossDb', units: 'dB', better: 'low', dec: 1 });
    rows.push({ name: 'Loss per cm', sub: 'at the distributed frequency', field: 'lossPerCmDb', units: 'dB/cm', better: 'low' });
    /* "Compensating gain required" used to be a second ranked row holding
       lossTotalDb — literally the same variable, scored as if independent.
       What is actually worth knowing is how much of that gain the drawn
       topology already supplies. */
    rows.push({
      name: 'Gain already in the topology', sub: 'repeaters and per-hop buffers the map draws',
      field: 'gainInPlaceDb', units: 'dB', better: 'high', dec: 1, rank: false
    });
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
    rows.push({ name: 'Feasibility', field: 'feasibility', wrap: true, fmt: function (v, r) { return str(r.feasibility); } });
    rows.push({ name: 'Risk', field: 'riskLevel', wrap: true, fmt: function (v, r) { return str(r.riskLevel); } });
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
      { name: 'Feasibility', field: 'feasibility', wrap: true, fmt: function (v, r) { return str(r.feasibility); } },
      { name: 'Risk', field: 'riskLevel', wrap: true, fmt: function (v, r) { return str(r.riskLevel); } }
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

  /* A row of compact chips for one parameter. */
  function chipRow(container, label, paramKey, choices) {
    var lab = UI.elt('span', 'pk-lab', label);
    container.appendChild(lab);
    var row = UI.elt('div', 'pk-chips');
    choices.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      var on = Number(state[paramKey]) === Number(c.value);
      b.className = 'pchip' + (on ? ' on' : '');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent = c.label;
      if (c.title) b.title = c.title;
      b.addEventListener('click', function () {
        /* Switching antenna option can strand the radiator count on a value
           the new option does not allow. The model clamps and reports it, but
           the clamp is the backstop, not the mechanism: move the state to the
           new option's own default so the reader never meets a warning they
           did not cause. */
        if (paramKey === 'antOption') {
          var tr = M.ANT_TRAITS[M.ANT_IDS[Math.round(Number(c.value))]];
          if (tr && tr.kAllowed.indexOf(Math.round(state.radPerCh)) < 0) {
            state.radPerCh = tr.kDefault;
          }
        }
        setParam(paramKey, Number(c.value));
      });
      row.appendChild(b);
    });
    container.appendChild(row);
  }

  /* A labelled <select> for the parameters whose choices are long strings.
     Five stacked button rows with a paragraph each is what made this panel
     1215 px tall; a dropdown is two lines and loses nothing, because only the
     chosen value matters once you have chosen. */
  function pickerSelect(container, label, paramKey, choices, titleTxt) {
    var wrap = UI.elt('label', 'pk-sel');
    wrap.appendChild(UI.elt('span', 'pk-lab', label));
    var s = document.createElement('select');
    choices.forEach(function (c) {
      var o = document.createElement('option');
      o.value = String(c.value);
      o.textContent = c.label;
      if (Number(c.value) === Number(state[paramKey])) o.selected = true;
      s.appendChild(o);
    });
    s.addEventListener('change', function () { setParam(paramKey, Number(s.value)); });
    if (titleTxt) wrap.title = titleTxt;
    wrap.appendChild(s);
    container.appendChild(wrap);
  }

  /* The case selector. It used to be five stacked groups of wide buttons, each
     followed by its own paragraph of prose — 1215 px, which together with the
     722 px requirement panel pushed the hardware map nearly five screens down
     the page on the one view whose whole point is the picture.

     Compact now: two chip rows for the two architecture families, the
     remaining choices as dropdowns, and ONE line of context for the current
     selection. The prose is not deleted — it moves into a disclosure, so the
     reasoning is a click away instead of always occupying the top of the
     screen. */
  function renderPicker(res, budget) {
    var mount = document.getElementById('pickerMount');
    mount.textContent = '';
    var loP = M.PARAMS.filter(function (p) { return p.key === 'loOption'; })[0];
    var bbP = M.PARAMS.filter(function (p) { return p.key === 'bbOption'; })[0];
    var sel = res.lo[res.g.loOptionId];
    var bsel = res.bb[res.g.bbOptionId];
    var pick = UI.elt('div', 'pk');

    /* Both families on one wrapping row: at a desktop width they share a
       line, and they break onto two only when the window is too narrow. */
    var r1 = UI.elt('div', 'pk-row');
    chipRow(r1, 'LO', 'loOption', loP.choices.map(function (c, i) {
      return { value: c.value, label: M.LO_META[i].short, title: M.LO_META[i].name + ' — ' + res.lo[M.LO_META[i].id].note };
    }));
    chipRow(r1, 'Baseband', 'bbOption', bbP.choices.map(function (c, i) {
      return { value: c.value, label: M.BB_META[i].short, title: M.BB_META[i].name + ' — ' + res.bb[M.BB_META[i].id].note };
    }));
    var antP = M.PARAMS.filter(function (p) { return p.key === 'antOption'; })[0];
    chipRow(r1, 'Antenna', 'antOption', antP.choices.map(function (c, i) {
      return { value: c.value, label: M.ANT_META[i].short, title: M.ANT_META[i].name + ' — ' + res.ant[M.ANT_META[i].id].note };
    }));
    pick.appendChild(r1);

    var r3 = UI.elt('div', 'pk-row pk-row-sel');
    pickerSelect(r3, 'Reference', 'refSel', M.REF_SOURCES.map(function (r, i) {
      return { value: i, label: r.name };
    }), M.REF_SOURCES[Math.round(state.refSel)].note);
    /* only the knobs that belong to the selected architecture */
    if (res.g.loOptionId === 'mid-mult') {
      pickerSelect(r3, '×M', 'midM',
        M.PARAMS.filter(function (p) { return p.key === 'midM'; })[0].choices,
        '×M adds exactly ' + n(20 * Math.log10(state.midM), 1) + ' dB to L(f) and multiplies distributed phase error by ' + Math.round(state.midM) + '. It buys loss and power, not skew.');
    }
    if (res.g.loOptionId === 'local-pll') {
      pickerSelect(r3, 'PLL plan', 'pllMult',
        M.PARAMS.filter(function (p) { return p.key === 'pllMult'; })[0].choices,
        'A PLL running directly at ' + n(state.fLoGHz, 0) + ' GHz in 65 nm LP CMOS is beyond the technology; a lower-frequency PLL plus a multiplier is the realisable route.');
    }
    if (res.g.loOptionId === 'daisy-chain') {
      pickerSelect(r3, 'Chains', 'chainBranches',
        [1, 2, 3, 5].map(function (v) { return { value: v, label: v === 1 ? '1 chain' : v + ' chains' }; }),
        'More branches shorten the worst chain and shrink the blast radius of a dead buffer. Worst chain here is ' + (sel.topo.lo.maxHop || 0) + ' hops.');
    }
    pickerSelect(r3, 'Medium', 'loMedium',
      M.PARAMS.filter(function (p) { return p.key === 'loMedium'; })[0].choices,
      'Loss at ' + n(sel.distFreqGHz, 2) + ' GHz in this medium: ' + n(sel.lossPerCmDb, 3) + ' dB/cm.');

    /* the antenna knobs, and only the ones the selected arrangement uses */
    var asel = res.ant[res.g.antOptionId];
    var atr = M.ANT_TRAITS[res.g.antOptionId];
    if (atr && atr.kAllowed.length > 1) {
      pickerSelect(r3, 'Radiators / ch', 'radPerCh',
        atr.kAllowed.map(function (k) {
          var sh = atr.shapeOf(k);
          return { value: k, label: k + ' (' + sh.kx + '×' + sh.ky + ')' };
        }),
        'K radiators behind one phase shifter, fed in fixed phase. Adds ZERO controllable state — ' +
        'the beamformer cannot see inside a cell — and buys ' + n(asel.dGainOverUnitDb, 2) +
        ' dB of element directivity here, closing the element/cell gap to ' + n(asel.thinningLossDb, 2) + ' dB.');
    }
    if (atr && atr.pitchMode === 'lam') {
      pickerSelect(r3, 'Pitch mode', 'radSpanPitch',
        M.PARAMS.filter(function (p) { return p.key === 'radSpanPitch'; })[0].choices,
        'Spanning the cell puts the subarray nulls exactly on the reciprocal port lattice, so every ' +
        'grating lobe on that axis is nulled at broadside. Legal only at K ≥ 4 per axis.');
    }
    if (res.g.antOptionId === 'board-radiator') {
      pickerSelect(r3, 'Footprint', 'radApertureLam',
        [0.6, 0.8, 1.0, 1.2, 1.4].map(function (v) { return { value: v, label: v.toFixed(1) + 'λ' }; }),
        'D_unit = 10log10(4π·η·a²) = ' + n(asel.dUnitDbi, 2) + ' dBi, derived from footprint rather than asserted.');
    }
    pick.appendChild(r3);

    var det = document.createElement('details');
    det.className = 'pk-why';
    if (view.pickerWhyOpen) det.open = true;
    det.addEventListener('toggle', function () { view.pickerWhyOpen = det.open; });
    var sm = document.createElement('summary');
    sm.textContent = 'Why these, and what each choice costs';
    det.appendChild(sm);
    var body = UI.elt('div', 'pk-why-body');
    body.innerHTML =
      '<p class="note"><strong>' + M.LO_META[Math.round(state.loOption)].name + '.</strong> ' + sel.note + '</p>' +
      '<p class="note"><strong>' + M.BB_META[Math.round(state.bbOption)].name + '.</strong> ' + bsel.note + '</p>' +
      '<p class="note"><strong>Reference.</strong> ' + M.REF_SOURCES[Math.round(state.refSel)].note +
      ' <em>N = f_LO/f_ref = ' + n(state.fLoGHz * 1e9 / (state.fRefMHz * 1e6), 0) +
      ', so the reference is multiplied by ' + n(20 * Math.log10(state.fLoGHz * 1e9 / (state.fRefMHz * 1e6)), 1) + ' dB.</em></p>' +
      '<p class="note"><strong>Medium.</strong> One degree at ' + n(state.fLoGHz, 0) + ' GHz is <span class="kv">' +
      n(K.umPerDeg(state.fLoGHz * 1e9, res.g.epsEff), 1) + ' µm</span> of physical length in this medium.</p>';
    det.appendChild(body);
    mount.appendChild(pick);

    /* One line carrying what this build IS, the geometry it implies, and the
       one number it is judged on — sharing its row with the disclosure so the
       strip costs a line rather than three. */
    var g2 = res.g;
    var geo = UI.elt('span', 'pk-geo');
    geo.innerHTML =
      '<span class="kv">' + n(sel.distFreqGHz, 2) + ' GHz</span> on the board' +
      (sel.tileMultiplier > 1 ? ', ×' + sel.tileMultiplier + ' per tile' : '') + ' · ' +
      g2.tileCols + '×' + g2.tileCols + ' = ' + g2.nTilesTotal + ' tiles at ' + n(g2.tileCm, 1) + ' cm · ' +
      'aperture <strong>' + n(g2.effApertureCm, 1) + ' cm</strong>' +
      (g2.aperturePitchExact ? '' : ' of ' + n(g2.apertureCm, 0)) + ' · ' +
      n(g2.loTapsTotal, 0) + ' LO taps · ' +
      /* All three counts, because this is the one line where the family's
         central distinction is either readable or lost. */
      '<span class="kv">' + n(g2.nPorts, 0) + '</span> ports · <span class="kv">' +
      n(g2.nRad, 0) + '</span> radiators' +
      (g2.radPerCh > 1 ? ' (' + g2.radKx + '×' + g2.radKy + ' per port)' : '') + ' · residual <span class="kv">' +
      n(sel.interTileResidualDeg, 3) + '°</span> of ' + n(budget.sigSpecDeg) + '°';
    var foot = UI.elt('div', 'pk-row pk-foot');
    foot.appendChild(geo);
    foot.appendChild(det);
    pick.appendChild(foot);

    /* Consistency banner. A mismatch that changes the answer must not be
       discoverable only by doing the arithmetic yourself — but at the
       defaults there are two perfectly reasonable geometry notes, and as
       full paragraphs they took 145 px above the map on every single load.
       Warnings collapse to one line; a `fail` is a real inconsistency and
       stays open. */
    var wm = document.getElementById('warnMount');
    wm.textContent = '';
    /* A MIGRATION THAT NOBODY IS TOLD ABOUT IS A SILENT STATE CHANGE, which is
       the exact failure migrateRawState exists to prevent. view.migrated has
       been populated since the elemModelSel retirement and rendered nowhere,
       so a restored link quietly came back as a different system. Show it. */
    if (view.migrated && view.migrated.length) {
      var mb = document.createElement('div');
      mb.className = 'callout warnc';
      mb.style.margin = '0 0 9px';
      var mbHead = document.createElement('strong');
      mbHead.textContent = 'Restored from an older link: ';
      mb.appendChild(mbHead);
      /* textContent, not innerHTML: every value in here is parsed out of the
         URL hash, and a hash is input from wherever it came. */
      mb.appendChild(document.createTextNode(view.migrated.join('; ') +
        '. The numbers below are this system’s own, not the current defaults.'));
      wm.appendChild(mb);
    }
    var warns = res.warnings || [];
    var hard = warns.filter(function (w) { return w.severity === 'fail'; });
    if (warns.length) {
      var box = document.createElement('details');
      box.className = 'pk-warn' + (hard.length ? ' hard' : '');
      if (hard.length || view.warnOpen) box.open = true;
      box.addEventListener('toggle', function () { view.warnOpen = box.open; });
      var sm2 = document.createElement('summary');
      sm2.innerHTML = hard.length
        ? '<strong>' + hard.length + ' inconsistency' + (hard.length > 1 ? ' issues' : '') +
          '</strong> — this build’s numbers cannot be trusted until it is resolved'
        : warns.length + ' geometry note' + (warns.length > 1 ? 's' : '') +
          ' — the grid does not divide the panel exactly';
      box.appendChild(sm2);
      warns.forEach(function (w) {
        var d = document.createElement('div');
        d.className = 'callout ' + (w.severity === 'fail' ? 'failc' : 'warnc');
        d.style.margin = '7px 0 0';
        d.innerHTML = '<strong>' + (w.severity === 'fail' ? 'Inconsistent: ' : 'Check: ') + '</strong>' + w.message;
        box.appendChild(d);
      });
      wm.appendChild(box);
    }
    wm.classList.toggle('hidden', !warns.length);
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
    /* A dropdown, not five wide buttons. The five labels are long enough
       ("static offset (wraps to resolve)") that as buttons they filled a
       whole row on their own and pushed the drawing further down — and only
       one can be active, which is exactly what a select is for. The layer
       toggles stay buttons because several are on at once. */
    var mlab = UI.elt('label', 'pk-sel');
    mlab.appendChild(UI.elt('span', 'pk-lab', 'colour tiles by'));
    var msel = document.createElement('select');
    TILE_METRICS.forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.key;
      o.textContent = m.label;
      if (view.tileMetric === m.key) o.selected = true;
      msel.appendChild(o);
    });
    msel.addEventListener('change', function () { view.tileMetric = msel.value; render(); });
    mlab.appendChild(msel);
    tb.appendChild(mlab);
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
      { k: 'showAnts', label: 'ports + radiators' },
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
      showBb: view.showBb, showDies: view.showDies, showAnts: view.showAnts,
      zoom: view.zoom, panXCm: view.panXCm, panYCm: view.panYCm,
      apertureSpecCm: res.g.apertureCm,
      onViewChange: function (z, x, y) { view.zoom = z; view.panXCm = x; view.panYCm = y; render(); }
    }, function (i) { view.selected = i; render(); });
    /* the legend needs what renderMap ACTUALLY drew — LOD tier, layer
       toggles and size floors — or it describes swatches that are not on
       screen and quotes sizes that were not rendered */
    window.Diagram.renderLegend(document.getElementById('mapLegend'), built, mapInfo);
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
        { k: 'Distribution loss', n: n(sel.lossTotalDb, 1), unit: 'dB', d: n(sel.lossPerCmDb, 3) + ' dB/cm × ' + n(sel.pathMaxCm, 1) + ' cm worst path, plus splits and transitions · ' + n(sel.gainInPlaceDb, 0) + ' dB of gain already drawn' },
        { k: 'Distribution power', n: n(sel.powerTotalMw / 1000, 2), unit: 'W', d: n(sel.powerFracOfArray, 1) + '% of the ' + n(state.arrayPowerW, 0) + ' W array budget' },
        { k: 'Repeater amps', n: n(sel.repeaters, 0), unit: '', d: sel.splitCount + ' splitters, ' + n(sel.totalRoutedCm, 0) + ' cm routed' },
        /* This cell used to read "56.0 ps / 17.3° at the LO · spec is 0.178
           ps", which is three different quantities read as one. 56.0 ps is
           skewRmsPs, 96.6% of it the geometric imbalance the model says is
           designed out, not an error; 17.3° is skewDeg78, the DRIFT part
           alone (56.0 ps at 78 GHz would be 1573°); and the 0.178 ps spec is
           the residual phase spec divided by 28.08°/ps, a threshold this
           uncalibrated number was never meant to be judged against. Show the
           surviving part against the spec that applies to it, and say what
           the static part is for. */
        {
          k: 'Drift skew', n: n(sel.skewDriftPs), unit: 'ps',
          d: n(sel.skewDeg78) + '° at the LO, tracked by BIST to ' + n(sel.driftResidDeg, 3) +
             '° · ' + n(sel.skewSystematicPs) + ' ps more is static, calibrated once (' +
             n(sel.correctionWraps, 1) + ' wraps of range)'
        },
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
     Chooser — the constraint search.

     A tool that announces a "best system" is the most dangerous thing this
     project could ship: it converts a pile of engineering guesses into an
     answer with a name. Three things are therefore load-bearing here, and
     none of them is the winner.

       1. IT RANKS BY ONE OBJECTIVE, NAMED ON SCREEN. Not a blend. The
          families trade in opposite directions — link EVM against beam
          coherence, gain against scan range — so a weighted "best" would
          be manufactured out of weights nobody chose.
       2. IT SHOWS THE ATTRITION. Which constraint killed how many, and how
          many it killed ALONE. That is usually the answer the reader
          actually needed: not "take this one" but "your power budget is
          what is stopping you".
       3. IT REPORTS TIES AS TIES. Several inputs are tagged
          engineering-guess; a search this size cannot resolve a 1%
          difference and must not pretend to.

     The search runs behind a button because it is ~3 s — each candidate
     needs its own beam evaluation, because the coherence loss is a genuine
     three-way function of the LO, baseband and antenna choices.

     THE SIZE OF THE SPACE IS DERIVED, NEVER TYPED. Two strings here used to
     say "300" while the live space was 350, so the page could show both
     numbers at once. spaceSize() below computes it the same way search()
     does, and adding an LO option or an antenna configuration moves every
     mention of it at once.

     WHAT THIS VIEW CANNOT DO, and why the curated shortlist lives in
     Systems instead: search() holds `state` fixed and varies only the three
     option axes. Every candidate it returns therefore shares ONE tile
     pitch, ONE RF bandwidth, ONE medium and ONE converter FOM. A comparison
     across RF bandwidth is not expressible here at all.
     ===================================================================== */
  var chooserResult = null;

  function renderChooser(res, budget) {
    var g = res.g;
    var QAM_ORDERS = [0, 4, 16, 64, 256];
    var QAM_NAMES = ['anything that closes', 'QPSK', '16QAM', '64QAM', '256QAM'];
    var RISKS = ['low', 'medium', 'high'];
    var OBJ_KEYS = ['rate', 'headroom', 'power', 'residual', 'repeaters', 'radiators'];
    var objKey = OBJ_KEYS[Math.round(state.cnObjectiveSel)] || 'margin';
    var qi = Math.round(state.cnMinQamSel);

    document.getElementById('chooserQuestion').textContent =
      'ranked by ' + (M.OBJECTIVES[objKey] || {}).label;

    /* the question, restated in one sentence, because a reader arriving at
       a result needs to see what was asked without reading the column */
    var ctl = document.getElementById('chooserControls');
    /* the antenna configurations are DERIVED from the current geometry and
       steer angle, so the size of the space is not a constant and the view
       must not print one */
    var space = M.searchAntConfigs(state);
    ctl.innerHTML = '<div class="pk-row"><span class="pk-lab">Asking</span><span class="pk-geo">' +
      'every combination of <strong>' + M.LO_IDS.length + ' LO × ' + M.BB_IDS.length +
      ' baseband × ' + space.keep.length + ' antenna</strong> configurations that ' +
      (qi > 0 ? 'carries <strong>' + QAM_NAMES[qi] + '</strong> over <strong>' + n(g.linkRangeKm, 2) +
        ' km</strong> in <strong>' + n(g.rainRateMmH, 0) + ' mm/h</strong> rain with ' +
        n(g.linkMarginReqDb, 1) + ' dB of margin, and ' : '') +
      'holds residual ≤ <strong>' + n(state.cnMaxResidualDeg, 2) + '°</strong>, power ≤ <strong>' +
      n(state.cnMaxPowerPct, 0) + '%</strong>' +
      (state.cnMinScanDeg > 0 ? ', scan cone ≥ <strong>' + n(state.cnMinScanDeg, 0) + '°</strong>' : '') +
      (state.cnMinBwGHz > 0 ? ', bandwidth ≥ <strong>' + n(state.cnMinBwGHz, 1) + ' GHz</strong>' : '') +
      ', risk ≤ <strong>' + RISKS[Math.round(state.cnMaxRiskSel)] + '</strong>.' +
      '</span></div>' +
      /* what was excluded BEFORE the constraints, and why. The legal antenna
         set depends on the geometry and the steer angle, so this changes as
         the reader changes those — which is itself worth seeing. */
      (space.dropped.length
        ? '<div class="pk-row"><span class="pk-lab">Excluded</span><span class="pk-geo">' +
          space.dropped.length + ' antenna configuration' + (space.dropped.length === 1 ? '' : 's') +
          ' the model itself rejects at this geometry and steer angle, before any constraint: ' +
          space.dropped.map(function (d) {
            var meta = M.ANT_META[M.ANT_IDS.indexOf(d.ant)];
            return '<strong>' + (meta ? meta.short : d.ant) + ' ×' + d.k + (d.span ? ' spanning' : '') +
              '</strong> (' + d.why.replace(/\.$/, '').slice(0, 72) + '…)';
          }).join('; ') + '.</span></div>'
        : '');

    var verdict = document.getElementById('chooserVerdict');
    document.getElementById('chooserRankedBy').textContent =
      chooserResult ? (M.OBJECTIVES[chooserResult.objectiveKey] || {}).label : '';


    if (!chooserResult) {
      var n0 = spaceSize();
      verdict.innerHTML = '<p class="note">Press <strong>Search the space</strong>. It evaluates ' +
        (n0 === null ? 'every' : n0) + ' ' +
        'combinations, each with its own beam evaluation, and takes about three seconds — which is why ' +
        'it does not run on every keystroke.</p>';
      document.getElementById('chooserAttrition').textContent = '';
      document.getElementById('chooserTable').textContent = '';
      document.getElementById('chooserPareto').textContent = '';
      document.getElementById('chooserParetoNote').textContent = '';
      return;
    }

    var R = chooserResult;
    var obj = R.objective;

    /* ---- verdict ---- */
    if (!R.survivors.length) {
      var b = R.binding;
      verdict.innerHTML =
        '<p class="note fail"><strong>Nothing survives.</strong> All ' + R.total + ' combinations fail at ' +
        'least one constraint.</p>' +
        (b
          ? '<p class="note">The binding one is <strong>' + b.label + '</strong>' +
            (isFinite(b.shortfall)
              ? ', and the nearest miss is short by <span class="kv">' + n(b.shortfall, 2) + ' ' +
                (b.unit || '') + '</span> — that is ' +
                (b.cand ? b.cand.loId + ' + ' + b.cand.bbId + ' + ' + b.cand.antId +
                  (b.cand.radPerCh > 1 ? ' ×' + b.cand.radPerCh : '') : '') +
                ', which clears everything else. Relax that one constraint by that much and you have an answer.'
              : '. No single candidate failed on it alone, so there is no "nearly" here: it killed ' +
                b.killedMost + ' candidates and the space is constrained on more than one axis at once.') +
            '</p>'
          : '');
    } else {
      var w = R.survivors[0];
      var isTie = R.tied.length > 1;
      var lm = M.LO_META.filter(function (m) { return m.id === w.loId; })[0];
      var bmta = M.BB_META.filter(function (m) { return m.id === w.bbId; })[0];
      var amta = M.ANT_META.filter(function (m) { return m.id === w.antId; })[0];
      UI.renderBudget(verdict, null, null, {
        cells: [
          { k: isTie ? 'Tied for best' : 'Best',
            n: isTie ? String(R.tied.length) : '1', unit: isTie ? 'ways' : 'winner',
            binding: isTie,
            /* renderBudget escapes its description, so this is plain text by
               design — markup here would render as literal tags. */
            d: (isTie
              ? 'combinations are tied within ' +
                n(R.tieEps, 2) + ' ' + obj.unit + ' on ' + obj.label.toLowerCase() + ', so this is NOT a winner — ' +
                'it is the first row of a tie, and they are marked in the table below. '
              : '') +
              lm.short + ' + ' + bmta.short + ' + ' + amta.short +
              (w.radPerCh > 1 ? ' ×' + w.radPerCh + (w.spanning ? ' spanning' : '') : '') + '. ' +
              obj.why },
          { k: obj.label, n: n(w.score, 2), unit: obj.unit, d: 'of ' + R.survivors.length +
              ' survivors out of ' + R.total + ' combinations' },
          { k: 'Link', n: w.link.best ? w.link.best.name : 'no close', unit: '',
            d: n(w.link.rateBps / 1e9, 2) + ' Gb/s at ' + n(g.linkRangeKm, 2) + ' km in ' +
               n(g.rainRateMmH, 0) + ' mm/h, ' + n(w.link.marginDb, 1) + ' dB margin. ' +
               (w.link.ceilingBinds ? 'The ARRAY binds, not the path.' : 'The path binds.') },
          { k: 'Inter-tile residual', n: n(w.lo.interTileResidualDeg, 3), unit: '°',
            binding: w.lo.interTileResidualDeg > budget.sigSpecDeg,
            d: 'against a ' + n(budget.sigSpecDeg, 2) + '° spec; null floor ' + n(w.lo.sllDb, 1) + ' dB' },
          { k: 'Distribution power', n: n(w.powerPct, 1), unit: '%',
            d: n((w.lo.powerTotalMw + w.bb.powerPerTileMw * w.nTiles) / 1000, 1) + ' W of a ' +
               n(g.arrayPowerW, 0) + ' W array budget' }
        ]
      });
    }

    /* ---- attrition ---- */
    plainRows(document.getElementById('chooserAttrition'),
      ['Constraint', 'Killed', 'Killed alone', 'Reading'],
      R.attrition.map(function (a) {
        return {
          cells: [a.label, a.killed, a.soleKill,
            a.killed === 0 ? 'not binding — nothing failed it'
              : a.soleKill === 0 ? 'never the only reason; it overlaps other constraints'
              : a.soleKill + ' candidate' + (a.soleKill === 1 ? '' : 's') +
                ' would have survived but for this one'],
          cls: a.soleKill > 0 ? 'warn' : ''
        };
      }));

    /* ---- survivors ---- */
    var tiedSet = {};
    R.tied.forEach(function (c) { tiedSet[c.loId + '|' + c.bbId + '|' + c.antId + '|' + c.radPerCh + '|' + c.spanning] = 1; });
    var rows = R.survivors.slice(0, 40).map(function (c, i) {
      var key = c.loId + '|' + c.bbId + '|' + c.antId + '|' + c.radPerCh + '|' + c.spanning;
      var lm2 = M.LO_META.filter(function (m) { return m.id === c.loId; })[0];
      var bm2 = M.BB_META.filter(function (m) { return m.id === c.bbId; })[0];
      var am2 = M.ANT_META.filter(function (m) { return m.id === c.antId; })[0];
      return {
        cells: [
          (i + 1) + (tiedSet[key] ? ' =' : ''),
          lm2.short, bm2.short, am2.short + (c.radPerCh > 1 ? ' ×' + c.radPerCh + (c.spanning ? 'sp' : '') : ''),
          n(c.score, 2),
          c.link.best ? c.link.best.name : '—',
          n(c.link.marginDb, 1),
          n(c.lo.interTileResidualDeg, 3),
          n(c.powerPct, 1),
          n(c.ant.coneMinDeg, 0),
          [c.lo.riskLevel, c.bb.riskLevel, c.ant.riskLevel].sort(function (x, y) {
            return (({ low: 0, medium: 1, high: 2 })[y] - ({ low: 0, medium: 1, high: 2 })[x]);
          })[0]
        ],
        cls: tiedSet[key] ? 'pass' : ''
      };
    });
    plainRows(document.getElementById('chooserTable'),
      ['#', 'LO', 'Baseband', 'Antenna', obj.label + ' (' + obj.unit + ')', 'Carries',
       'Margin dB', 'Residual °', 'Power %', 'Cone °', 'Risk'], rows);

    /* ---- the trade, as a front rather than a winner ----
       The single most useful picture here is NOT the ranking: it is the two
       axes that genuinely oppose each other, with every survivor on them,
       so the reader can see that picking one end is a choice and not a
       calculation. */
    /* the y axis is SNR HEADROOM, not margin: margin resets at every
       constellation boundary, so plotting it drew a sawtooth and called it
       a trade front */
    var pts = R.survivors.map(function (c) {
      return { x: Math.max(c.lo.interTileResidualDeg, 1e-3), y: c.link.headroomDb };
    });
    var winner = R.survivors.length
      ? [{ x: Math.max(R.survivors[0].lo.interTileResidualDeg, 1e-3), y: R.survivors[0].link.headroomDb }] : [];
    document.getElementById('chooserPareto').textContent = '';
    if (pts.length) {
      document.getElementById('chooserPareto').appendChild(window.Charts.lineChart({
        series: [
          { name: 'survivors', color: SERIES[1], points: pts.slice().sort(function (a, b) { return a.x - b.x; }), dash: '1 4' },
          { name: 'the one it picked', color: SERIES[0], points: winner }
        ],
        xLabel: 'inter-tile residual (°, log) — lower is a deeper null',
        yLabel: 'SNR headroom (dB) — higher is a better link',
        xFmt: function (v) { return v + '°'; },
        height: 280
      }));
    }
    var a1c = R.survivors.filter(function (c) { return c.loId === 'local-pll'; })[0];
    var a4c = R.survivors.filter(function (c) { return c.loId === 'mid-mult'; })[0];
    document.getElementById('chooserParetoNote').innerHTML =
      'Every surviving combination, on the two axes that pull against each other. ' +
      (a1c && a4c
        ? 'The best A1 survivor sits at <span class="kv">' + n(a1c.link.headroomDb, 1) +
          ' dB</span> of headroom and <span class="kv">' + n(a1c.lo.interTileResidualDeg, 2) +
          '°</span> of residual; the best A4 at <span class="kv">' + n(a4c.link.headroomDb, 1) +
          ' dB</span> of headroom and <span class="kv">' + n(a4c.lo.interTileResidualDeg, 3) +
          '°</span>. A1 buys ' + n(a1c.link.headroomDb - a4c.link.headroomDb, 1) +
          ' dB of link and gives up ' + n(Math.abs(a1c.lo.sllDb - a4c.lo.sllDb), 1) +
          ' dB of null depth for it. '
        : '') +
      '<strong>No objective in the list resolves that.</strong> Ranking by link margin picks the ' +
      'per-tile PLL, because its uncorrelated noise averages down at the beam output; ranking by residual ' +
      'picks the shared LO, because the same noise appears in full in the differential. The tool can tell ' +
      'you what each choice costs. It cannot tell you which cost you are willing to pay, and a single ' +
      '“best” that hid this behind a weighted score would be the least honest thing in it.';
  }

  /* a plain header+rows table, used by the chooser panels */
  function plainRows(mount, headers, rows) {
    mount.textContent = '';
    var t = document.createElement('table');
    t.className = 'grid';
    var thead = document.createElement('thead'), htr = document.createElement('tr');
    headers.forEach(function (h) { htr.appendChild(UI.elt('th', null, h)); });
    thead.appendChild(htr); t.appendChild(thead);
    var tb = document.createElement('tbody');
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      if (r.cls) tr.className = r.cls;
      r.cells.forEach(function (cv, i) {
        var td = UI.elt('td', i === 0 ? 'mn' : 'v', cv === null || cv === undefined ? '—' : String(cv));
        if (i === headers.length - 1) td.style.cssText = 'text-align:left;white-space:normal';
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    mount.appendChild(t);
  }

  /* =====================================================================
     Link calculator

     A link budget is a cascade, and the only honest way to show one is as a
     cascade: each term on its own line, signed, with the running total
     beside it, so a reader can check it against their own spreadsheet line
     by line rather than being handed a single number to trust.

     The two things this view exists to make visible:

       1. E-band is rain-limited. At 78 GHz a 25 mm/h cell costs about
          10 dB/km against 0.4 dB/km of gaseous absorption, so the rain row
          is usually larger than every other loss except free space, and it
          is what sets the range.

       2. The array's own residual phase error is an SNR CEILING. No amount
          of received power beats it. That is where everything else in this
          tool — the LO architecture, the baseband network, the antenna
          arrangement — stops being an abstraction and starts setting a data
          rate. The cascade says which of the two is binding.
     ===================================================================== */
  function renderLink(res, budget) {
    /* local table builder: a link budget is a plain signed list, not the
       option-comparison shape ui.js renders */
    function linkTable(mount, headers, rows) {
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
        if (r.cls) tr.classList.add(r.cls);
        r.cells.forEach(function (cv, i) {
          var td = UI.elt('td', i === 0 ? 'mn' : 'v', cv === null || cv === undefined ? '—' : String(cv));
          if (i === headers.length - 1) td.style.cssText = 'text-align:left;white-space:normal;min-width:240px';
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      mount.appendChild(t);
    }
    var g = res.g;
    var lo = res.lo[g.loOptionId];
    var bm = window.Beam.evaluate(g, budget, lo, res.bb[g.bbOptionId], { light: true });
    var L = M.evalLink(g, lo, bm, res.bb[g.bbOptionId]);
    var fmtR = function (km) { return km >= 1 ? n(km, 2) + ' km' : n(km * 1000, 0) + ' m'; };

    /* ---- verdict ---- */
    document.getElementById('linkVerdictSub').textContent =
      n(g.linkRangeKm, 2) + ' km · ' + n(g.rainRateMmH, 0) + ' mm/h rain · ' +
      n(g.rfBwGHz, 1) + ' GHz · ' + L.pol + '-pol';

    UI.renderBudget(document.getElementById('linkStats'), null, null, {
      cells: [
        { k: 'EIRP', n: n(L.eirpDbm, 1), unit: 'dBm',
          d: n(L.pPerElemDbm, 1) + ' dBm at each of ' + L.nPorts + ' ports (' +
             n(g.txPoutDbm, 1) + ' dBm less ' + n(g.txBackoffDb, 1) + ' dB back-off) = ' +
             n(L.pTotalDbm, 1) + ' dBm radiated, plus ' + n(L.dArrayDbi, 2) +
             ' dBi of array directivity, less ' + n(L.antLossTotalDb, 2) + ' dB antenna chain. ' +
             'Equivalently P_element + 20log10(N) + D_element — N twice, once for the power summed ' +
             'and once for the directivity, which is the N² of coherent combining.' },
        { k: 'Received power', n: n(L.prxDbm, 1), unit: 'dBm',
          d: 'after ' + n(L.fsplDb, 1) + ' dB free space, ' + n(L.gasDb, 2) + ' dB gaseous and ' +
             n(L.rainDb, 1) + ' dB rain, plus ' + n(L.gRxDbi, 2) + ' dBi of realised receive gain. ' +
             'In clear air it would be ' + n(L.prxClearDbm, 1) + ' dBm — rain is costing ' +
             n(L.rainDb, 1) + ' dB.' },
        { k: 'SNR', n: n(L.snrEffDb, 1), unit: 'dB',
          binding: L.ceilingBinds,
          d: L.ceilingBinds
            ? 'THE ARRAY IS BINDING, NOT THE PATH. The link delivers ' + n(L.snrPathDb, 1) +
              ' dB, but this build\'s residual phase error is an EVM of ' + n(lo.evmPct, 2) +
              '%, which is an SNR ceiling of ' + n(L.snrCeilDb, 1) + ' dB that no received power ' +
              'beats. Fix the distribution, not the link.'
            : 'the path delivers ' + n(L.snrPathDb, 1) + ' dB and the array\'s own EVM ceiling is ' +
              n(L.snrCeilDb, 1) + ' dB, combining to ' + n(L.snrEffDb, 1) +
              '. The PATH is binding here — more array coherence buys nothing until the path improves.' },
        { k: 'Supports', n: L.closes ? L.best.name : 'nothing', unit: '',
          binding: !L.closes,
          d: L.closes
            ? n(L.bitsPerSym, 0) + ' bits/symbol over ' + n(g.rfBwGHz, 1) + ' GHz = ' +
              n(L.rateBps / 1e9, 2) + ' Gb/s, with ' + n(L.marginDb, 1) + ' dB in hand above the ' +
              n(L.best.snrDb, 1) + ' dB it needs. Shannon on this SNR would allow ' +
              n(L.shannonCapBps / 1e9, 1) + ' Gb/s.'
            : 'The link does not close at this range and rain rate even at the lowest constellation, ' +
              'which needs ' + n(L.requirements[0].snrDb, 1) + ' dB plus ' + n(g.linkMarginReqDb, 1) +
              ' dB of margin against the ' + n(L.snrEffDb, 1) + ' dB available.' },
        { k: 'Range at this rain rate', n: fmtR(L.maxRangeKm), unit: '',
          d: 'where the SNR falls to the ' + n(L.needDb, 1) + ' dB that ' +
             (L.closes ? L.best.name : L.requirements[0].name) + ' plus ' + n(g.linkMarginReqDb, 1) +
             ' dB of margin needs. Solved by bisection on the same cascade printed below, so it ' +
             'cannot drift from it.' }
      ]
    });

    /* ---- the cascade ---- */
    var run = 0;
    var rows = [];
    function step(label, delta, note, isTotal) {
      if (delta !== null) run += delta;
      rows.push({
        cells: [label, delta === null ? '' : (delta > 0 ? '+' : '') + n(delta, 2),
                n(run, 2), note || ''],
        mark: !!isTotal
      });
    }
    run = L.pPerElemDbm;
    rows.push({ cells: ['PA output per element, after back-off', '', n(run, 2),
      n(g.txPoutDbm, 1) + ' dBm saturated less ' + n(g.txBackoffDb, 1) + ' dB — engineering guess, measure it'] });
    step('Coherent sum of ' + L.nPorts + ' ports', 10 * Math.log10(L.nPorts), '10log10(N) — power, not field');
    step('Array directivity', L.dArrayDbi, 'from the beam model: ' + g.elem.label);
    step('Antenna-side chain', -L.antLossTotalDb, 'efficiency, feed, T/R, and the in-cell feed if any');
    step('EIRP', null, '', true);
    step('Free-space path loss', -L.fsplDb,
      '92.45 + 20log10(' + n(g.fLoGHz, 1) + ' GHz) + 20log10(' + n(g.linkRangeKm, 2) + ' km)');
    step('Gaseous absorption', -L.gasDb,
      n(L.gasPerKm, 2) + ' dB/km over ' + n(g.linkRangeKm, 2) + ' km — ITU-R P.676 window between the 60 and 183 GHz lines');
    step('Rain', -L.rainDb,
      'ITU-R P.838-3: k=' + n(L.rainK, 3) + ', α=' + n(L.rainAlpha, 3) + ' (' + L.pol + '-pol) → γ=' +
      n(L.rainGammaDbKm, 2) + ' dB/km at ' + n(g.rainRateMmH, 0) + ' mm/h, × ' + n(g.linkRangeKm, 2) +
      ' km × ' + n(L.rainPathFactor, 3) + ' path factor (ITU-R P.530)');
    step('Receive array gain', L.gRxDbi,
      'REALISED, not directivity: less scan loss and coherence loss and the antenna chain');
    step('Received power', null, '', true);
    /* the running total changes UNITS here: dBm of received power minus dBm
       of noise is dB of ratio. The label says "subtract" so the positive
       delta does not read as noise helping. */
    step('Subtract the noise floor', -L.noiseDbm,
      '−174 dBm/Hz + 10log10(' + n(g.rfBwGHz, 1) + ' GHz) + ' + n(g.rxNfDb, 1) + ' dB NF = ' +
      n(L.noiseDbm, 1) + ' dBm. From here the running total is a RATIO in dB, not a power in dBm.');
    step('Implementation loss', -g.implLossDb, 'synchronisation, timing, quantisation, filter ripple');
    step('SNR from the path', null, '', true);
    rows.push({ cells: ['Array EVM ceiling', '', n(L.snrCeilDb, 2),
      'this build\'s ' + n(lo.evmPct, 2) + '% array-output EVM is an SNR no power beats'] });
    rows.push({ cells: ['Effective SNR', '', n(L.snrEffDb, 2),
      'the two combine in power: 1/S = 1/S_path + 1/S_array' + (L.ceilingBinds ? ' — THE ARRAY BINDS' : ' — the path binds')],
      mark: true });

    linkTable(document.getElementById('linkTable'),
      ['Term', 'dB', 'Running', 'Where it comes from'], rows, true);

    /* ---- range chart ---- */
    var clearPts = [], rainPts = [];
    L.rangeCurve.forEach(function (p) { rainPts.push({ x: p.d, y: p.snr }); });
    (function () {
      var save = g.rainRateMmH;
      L.rangeCurve.forEach(function (p) {
        var fs = K.fsplDb(g.fLoGHz, p.d);
        var ga = L.gasPerKm * p.d;
        var pw = L.eirpDbm - fs - ga + L.gRxDbi;
        clearPts.push({ x: p.d, y: K.combineSnrDb(pw - L.noiseDbm - g.implLossDb, L.snrCeilDb) });
      });
      void save;
    })();
    var need = L.needDb;
    document.getElementById('linkRangeChart').textContent = '';
    document.getElementById('linkRangeChart').appendChild(window.Charts.lineChart({
      series: [
        { name: 'clear air', color: SERIES[0], points: clearPts },
        { name: n(g.rainRateMmH, 0) + ' mm/h rain', color: SERIES[1], points: rainPts }
      ],
      xLabel: 'range (km, log)', yLabel: 'effective SNR (dB)',
      xFmt: function (v) { return v >= 1 ? v + ' km' : (v * 1000) + ' m'; },
      hLine: isFinite(need) ? need : undefined,
      hLabel: (L.closes ? L.best.name : L.requirements[0].name) + ' + margin'
    }));
    document.getElementById('linkRangeNote').innerHTML =
      'Both curves flatten at <span class="kv">' + n(L.snrCeilDb, 1) + ' dB</span> however short the hop, ' +
      'because that is this build\'s own EVM ceiling — the array cannot be out-ranged into working better ' +
      'than its own coherence. The gap between the curves at any range is what rain costs: <span class="kv">' +
      n(L.rainDb, 1) + ' dB</span> at ' + n(g.linkRangeKm, 2) + ' km. Range in clear air would be <span class="kv">' +
      fmtR((function () {
        var lo2 = 0.05, hi2 = 50;
        function s(d) {
          var pw = L.eirpDbm - K.fsplDb(g.fLoGHz, d) - L.gasPerKm * d + L.gRxDbi;
          return K.combineSnrDb(pw - L.noiseDbm - g.implLossDb, L.snrCeilDb);
        }
        if (!(s(lo2) >= need)) return 0;
        if (s(hi2) >= need) return hi2;
        for (var i = 0; i < 60; i++) { var mid = (lo2 + hi2) / 2; if (s(mid) >= need) lo2 = mid; else hi2 = mid; }
        return (lo2 + hi2) / 2;
      })()) + '</span>.';

    /* ---- per-constellation table ---- */
    var qrows = L.requirements.map(function (r) {
      var ok = L.snrEffDb >= r.snrDb + g.linkMarginReqDb;
      return {
        cells: [r.name, n(r.snrDb + g.codingGainDb, 1), n(r.snrDb, 1),
                n(Math.log2(r.order) * L.bwHz / 1e9, 1),
                n(L.snrEffDb - r.snrDb, 1),
                ok ? 'closes' : 'no'],
        cls: ok ? 'pass' : 'fail'
      };
    });
    linkTable(document.getElementById('linkQamTable'),
      ['Constellation', 'Uncoded SNR', 'With ' + n(g.codingGainDb, 1) + ' dB FEC',
       'Gb/s', 'Margin', 'At ' + n(g.linkRangeKm, 2) + ' km'], qrows, true);

    /* The trap this view can walk a reader into, so it is named before they
       reach it. */
    var a1 = res.lo['local-pll'], a4 = res.lo['mid-mult'];
    document.getElementById('linkRangeNote').innerHTML +=
      '<br><br><strong>One warning about reading this view on its own.</strong> The SNR ceiling here comes ' +
      'from the ARRAY-OUTPUT EVM, which is the ABSOLUTE phase error after the coherent sum — and that is ' +
      'the one metric on which a per-tile PLL wins. A1\'s uncorrelated noise averages down by 10log10(' +
      g.nTilesTotal + ') = ' + n(10 * Math.log10(g.nTilesTotal), 1) + ' dB at the beam output, so it reads ' +
      n(a1.evmPct, 2) + '% here against A4\'s ' + n(a4.evmPct, 2) + '% and would appear to support a higher ' +
      'constellation. It does. What it does not do is hold a null: the same uncorrelated noise appears in ' +
      'FULL in the inter-tile differential, ' + n(a1.interTileResidualDeg, 2) + '° against ' +
      n(a4.interTileResidualDeg, 3) + '°, which is ' + n(Math.abs(a1.sllDb - a4.sllDb), 1) +
      ' dB of null depth and therefore the spatial-multiplexing ceiling. <em>This view scores the single ' +
      'link; the Decision view scores the array.</em> They point in opposite directions on exactly one ' +
      'choice, and that opposition is the thesis, not a contradiction.';

    UI.renderProse(document.getElementById('linkCaveats'), [
      '!!! warn This is a first-order link budget. It is built from the array this tool models and from ' +
      'published propagation recommendations, and it is the right shape — but every number below is ' +
      'missing from it, and several of them are worth decibels.',
      '- **Transmit power is a guess.** Neither source document states a per-element output power, so ' +
      '`txPoutDbm` is labelled engineering-guess and the whole EIRP rests on it. Measure the PA before ' +
      'quoting a range from this tool.',
      '- **No PA nonlinearity.** Back-off is a declared allowance, not a computed one: there is no AM/AM or ' +
      'AM/PM model here, so the EVM the back-off is protecting is not actually recomputed from it.',
      '- **No pointing loss beyond scan loss.** A real link loses to mispointing, mast sway and alignment ' +
      'drift. At the 0.65° beamwidth this array has, that is not a small omission — it is arguably the ' +
      'second rain.',
      '- **No multipath, no interference, no ground reflection, no atmospheric turbulence or scintillation.**',
      '- **Rain is the ITU point-rate model**, which is a statistical long-run figure for a rain zone. It is ' +
      'not a weather forecast, and a real deployment needs the local P.837 statistics.',
      '- **One hop, one polarisation, no diversity.** No space or frequency diversity, and no adaptive ' +
      'modulation: the table reports what closes at a fixed rain rate, where a real link would drop its ' +
      'constellation and stay up.',
      '- **The required SNR is derived for an AWGN channel** by inverting the square-QAM symbol-error ' +
      'bound, then reduced by a single declared coding gain. It is not a simulation of a specific FEC.'
    ]);
  }

  /* =====================================================================
     Compare view
     ================================================================== */
  /* The rows that decide the answer, for the "key metrics" filter. The rule
     is the same one the Decision view already applies: a row is key if it
     carries a requirement, if decision.js weights it, or if it is the
     headline of its own metric family. 54 rows across 8 sections is the right
     depth for defending a choice and the wrong depth for understanding one,
     and the Systems view three tabs away already had a "differences only"
     toggle — this is the same idea for Compare. */
  var KEY_LO_FIELDS = [
    'interTileResidualDeg', 'sllDb', 'lossTotalDb', 'powerFracOfArray',
    'powerTotalMw', 'evmDb', 'maxQam', 'skewDriftPs', 'correctionRangeDeg',
    'calBurdenScore', 'feasibility', 'riskLevel', 'distFreqGHz'
  ];
  var KEY_BB_FIELDS = [
    'interTileResidualDeg', 'skewRmsPs', 'lossTotalDb', 'nfPenaltyDb',
    'powerTotalMw', 'bwGHz', 'squintLossDb', 'feasibility', 'riskLevel'
  ];
  var KEY_ANT_FIELDS = [
    'radPerCh', 'dElDbi', 'cellFillPct', 'thinningLossDb', 'realisedAtScanDbi',
    'coneMinDeg', 'gtDeltaDb', 'bwGHz', 'lobesWithin3Db', 'feasibility', 'riskLevel'
  ];

  /* The antenna family reports what the element IS, what it buys, what it
     costs, and what it provably cannot touch — that last group matters most,
     because the intuition a reader arrives with is that a better antenna
     fixes the grating lobes, and it cannot. */
  function antRows(budget) {
    return [
      { section: 'What sits behind one RF port' },
      {
        name: 'Radiators per RF channel', sub: 'ports per die stay 4 in every option — the beamformer cannot see inside a cell',
        field: 'radPerCh', dec: 0,
        fmt: function (v, r) { return v + (v > 1 ? ' · ' + r.radKx + '×' + r.radKy : ' (one patch)'); }
      },
      { name: 'Radiators across the array', field: 'nRad', dec: 0, better: 'none' },
      {
        name: 'Radiator pitch in the cell', field: 'radPitchLamEff', units: 'λ', dec: 2,
        fmt: function (v, r) { return r.radPerCh > 1 ? n(v, 2) + 'λ' + (r.spanning ? ' · spans the cell' : '') : '—'; }
      },
      { name: 'Metal layers on the antenna side', field: 'metalLayers', dec: 0, better: 'low' },
      { section: 'What it buys' },
      {
        name: 'Element directivity', sub: 'what ONE PORT radiates, derived by integrating the subarray pattern — not asserted',
        field: 'dElDbi', units: 'dBi', better: 'high', dec: 2,
        fmt: function (v, r) { return n(v, 2) + ' dBi' + (r.dGainOverUnitDb > 0.005 ? ' (+' + n(r.dGainOverUnitDb, 2) + ' over the unit radiator)' : ''); }
      },
      { name: 'Cell fill', sub: 'effective area of the element against its 225 mm² cell', field: 'cellFillPct', units: '%', better: 'high', dec: 2 },
      {
        name: 'Element/cell gap', sub: 'identically the cell ceiling minus the element — recoverable, not a thinning loss',
        field: 'thinningLossDb', units: 'dB', better: 'low', dec: 2
      },
      { name: 'Array directivity', field: 'dArrayDbi', units: 'dBi', better: 'high', dec: 2 },
      { section: 'What it costs' },
      {
        name: 'In-cell feed loss', sub: 'fixed corporate tree behind the port, plus any board transition',
        field: 'feedLossDb', units: 'dB', better: 'low', dec: 2,
        fmt: function (v, r) { return n(v, 2) + ' dB' + (r.feedStages ? ' · ' + r.feedStages + ' split stages, ' + n(r.feedRouteCm * 10, 1) + ' mm routed' : ''); }
      },
      {
        name: 'Receive G/T change', sub: 'the feed is in FRONT of the LNA, so on receive its loss costs gain AND noise figure — twice over',
        field: 'gtDeltaDb', units: 'dB', better: 'high', dec: 2
      },
      {
        name: 'Scan loss at the steer angle', sub: 'a fixed broadside feed behind a steered port',
        field: 'scanLossDb', units: 'dB', better: 'low', dec: 2,
        fmt: function (v, r) { return r.scanInNull ? 'IN ITS OWN NULL' : n(v, 2) + ' dB'; }
      },
      {
        name: 'Worst-plane −3 dB half-cone', sub: 'against the ' + n(state.scanDegMax, 0) + '° scan requirement',
        field: 'coneMinDeg', units: '°', better: 'high', dec: 1,
        fmt: function (v, r) { return n(v, 1) + '°' + (r.scanConeOk ? '' : ' — short of ' + n(state.scanDegMax, 0) + '°'); }
      },
      { name: 'Realised gain at the steer angle', field: 'realisedAtScanDbi', units: 'dBi', better: 'high', dec: 2 },
      {
        name: 'Radiator bandwidth', sub: 'against ' + n(state.antBandReqGHz, 1) + ' GHz required; 71–86 GHz is 15 GHz',
        field: 'bwGHz', units: 'GHz', better: 'high', dec: 1,
        fmt: function (v, r) { return n(v, 1) + ' GHz (' + n(r.fracBwPct, 1) + '%)' + (r.bandOk ? '' : ' — short'); }
      },
      { name: 'Junctions BIST cannot see', sub: 'per port; nothing inside the cell is observable', field: 'blindJunctions', dec: 0, better: 'low' },
      { name: 'Added power', sub: 'a passive radiator and a fixed feed draw none — the finding, not an omission', field: 'powerPerTileMw', units: 'mW', better: 'low', dec: 0 },
      { section: 'What it provably cannot touch' },
      {
        name: 'Grating lobes within 3 dB of the beam', sub: 'the antenna can suppress lobes; it cannot move or remove them',
        field: 'lobesWithin3Db', dec: 0, better: 'low'
      },
      {
        name: 'Worst lobe at the steer angle', field: 'worstLobeDb', units: 'dB', better: 'low', dec: 2,
        fmt: function (v, r) { return r.scanInNull ? 'n/a — beam in a null' : n(v, 2) + ' dB at ' + n(r.worstLobeDeg, 1) + '°'; }
      },
      { name: 'Controllable ports', sub: 'invariant across the whole family, by construction', field: 'nPorts', dec: 0, better: 'none' },
      { section: 'Verdict' },
      { name: 'Feasibility', field: 'feasibility' },
      { name: 'Risk', field: 'riskLevel' }
    ];
  }

  /* Keep a section only if a row under it survived; a bare heading with
     nothing beneath it reads as a rendering fault. */
  function keyOnly(rows, fields) {
    var out = [];
    rows.forEach(function (r) {
      if (r.section) { out.push(r); return; }
      if (fields.indexOf(r.field) >= 0) out.push(r);
    });
    return out.filter(function (r, i) {
      if (!r.section) return true;
      var nxt = out[i + 1];
      return !!(nxt && !nxt.section);
    });
  }

  function renderCompare(res, budget, dec) {
    /* Two different claims, kept apart. The tinted column is what the MODEL
       recommends; the underlined one is what the READER has selected in the
       picker. They were previously merged into a single badge on the
       recommended column reading "selected", so whenever the two differed the
       header asserted the opposite of the truth. */
    /* tieIds holds every option the weights cannot separate from the
       leader. A build sitting on any of them is on the model's answer —
       badging it "your build" against a different "model pick" would
       assert a distinction the score does not support. */
    function opt(m, results, curId, pickId, tieIds) {
      var o = { id: m.id, name: m.name, topology: results[m.id].note };
      var tied = (tieIds || [pickId]).indexOf(m.id) >= 0;
      if (m.id === curId) {
        o.cur = true;
        o.badge = m.id === pickId ? 'your build · model pick'
          : tied ? 'your build · tied for model pick' : 'your build';
        o.badgeClass = tied ? 'acc' : 'warn';
      }
      return o;
    }
    var loOpts = M.LO_META.map(function (m) { return opt(m, res.lo, res.g.loOptionId, dec.loPick.id, dec.loTieIds); });
    var bbOpts = M.BB_META.map(function (m) { return opt(m, res.bb, res.g.bbOptionId, dec.bbPick.id, dec.bbTieIds); });
    /* The antenna family is deliberately NOT scored. The other two families
       rank because their options trade the same currencies — phase error,
       loss, power. The antenna options trade gain against SCAN RANGE, and
       how much scan this array needs is a system requirement the reader
       brings, not something the tool can weigh for them. Ranking them would
       manufacture an answer out of a weight nobody chose. */
    var antOpts = M.ANT_META.map(function (m) {
      var o = { id: m.id, name: m.name, topology: res.ant[m.id].note };
      if (m.id === res.g.antOptionId) { o.cur = true; o.badge = 'your build'; o.badgeClass = 'acc'; }
      return o;
    });

    var cfg = { recLabel: 'model pick' };
    var lr = loRows(budget), br = bbRows(budget);
    var keyMode = view.compareKeyOnly !== false;   /* key metrics by default */
    UI.renderTable(document.getElementById('loTable'), loOpts, res.lo,
      keyMode ? keyOnly(lr, KEY_LO_FIELDS) : lr, dec.loPick.id, cfg);
    UI.renderTable(document.getElementById('bbTable'), bbOpts, res.bb,
      keyMode ? keyOnly(br, KEY_BB_FIELDS) : br, dec.bbPick.id, cfg);
    var ar = antRows(budget);
    UI.renderTable(document.getElementById('antTable'), antOpts, res.ant,
      keyMode ? keyOnly(ar, KEY_ANT_FIELDS) : ar, null, { recLabel: null });
    (function () {
      var b = document.getElementById('cmpKeyToggle');
      if (!b) return;
      var shownLo = (keyMode ? keyOnly(lr, KEY_LO_FIELDS) : lr).filter(function (r) { return !r.section; }).length;
      var totalLo = lr.filter(function (r) { return !r.section; }).length;
      b.textContent = keyMode ? 'Show all ' + totalLo + ' metrics' : 'Key metrics only';
      b.setAttribute('aria-pressed', keyMode ? 'true' : 'false');
      var note = document.getElementById('cmpKeyNote');
      if (note) note.textContent = keyMode
        ? 'Showing the ' + shownLo + ' rows that carry a requirement or a scoring weight.'
        : 'Showing every row. The ones that decide the answer are in the key view.';
    })();

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
    /* A lead the weights cannot resolve is reported as a tie, not as a
       winner with a runner-up: naming one of two indistinguishable options
       "the pick" is the whole failure mode this tool is built against.

       Which member of a tie heads the verdict is then a free choice, and
       the useful one is the READER'S. Leading with rank-1 makes the panel
       look like it disagrees with a build that is in fact sitting on the
       model's answer; leading with the build answers the question actually
       being asked — "is what I have selected the right thing?" — and the
       tie sentence still names its equals. Outside a tie this changes
       nothing: head() returns rank-1. */
    function head(tied, curId) {
      if (!tied || tied.length < 2) return tied[0];
      for (var i = 0; i < tied.length; i++) if (tied[i].id === curId) return tied[i];
      return tied[0];
    }
    var lp = head(dec.loTied, res.g.loOptionId) || dec.loPick;
    var bp = head(dec.bbTied, res.g.bbOptionId) || dec.bbPick;
    function tieNote(tied, shown) {
      if (!tied || tied.length < 2) return '';
      var others = tied.filter(function (o) { return o.id !== shown.id; });
      return ' <strong>Tied with ' + others.map(function (o) { return o.short; }).join(', ') +
        '</strong> — the scores differ by ' + n(Math.abs(tied[0].score - tied[tied.length - 1].score), 3) +
        ' on a 0–1 scale, inside what re-weighting can move, so this ordering is not a result.';
    }
    verdict('LO', lp.name + (dec.loTied && dec.loTied.length > 1 ? ' (tied)' : ''),
      'Residual inter-tile phase error <span class="kv">' + n(lp.r.interTileResidualDeg) + '°</span> against a <span class="kv">' +
      n(budget.sigSpecDeg) + '°</span> spec, null floor <span class="kv">' + n(lp.r.sllDb, 1) + ' dB</span>, ' +
      'distribution power <span class="kv">' + n(lp.r.powerFracOfArray, 1) + '%</span> of the array. ' +
      (dec.loTied && dec.loTied.length > 1 ? tieNote(dec.loTied, lp)
        : 'Runner-up: ' + (dec.loRank[1] ? dec.loRank[1].short : '—') + '.'));
    verdict('Baseband', bp.name + (dec.bbTied && dec.bbTied.length > 1 ? ' (tied)' : ''),
      'Squint loss <span class="kv">' + n(bp.r.squintLossDb, 3) + ' dB</span>, noise-figure penalty <span class="kv">' +
      n(bp.r.nfPenaltyDb, 2) + ' dB</span>, <span class="kv">' + n(bp.r.powerPerTileMw, 0) + ' mW</span> per tile ' +
      'across both rails. ' +
      (dec.bbTied && dec.bbTied.length > 1 ? tieNote(dec.bbTied, bp)
        : 'Runner-up: ' + (dec.bbRank[1] ? dec.bbRank[1].short : '—') + '.'));

    /* charts */
    var cc = document.getElementById('compareCharts');
    cc.textContent = '';
    var colors = SERIES;
    /* zeroBase must be false for any decibel quantity. A dB value is a
       difference from an arbitrary reference, so barChart's default origin
       of Math.min(0, value) puts the bar's start AND end at the same place
       when every value is negative: the null-depth panel — the one this tool
       calls "the decisive metric" — was drawing all six bars exactly 1 pixel
       wide. The Systems charts already pass zeroBase:false; this one never
       did. */
    function barPanel(title, field, unit, spec, transform, logX) {
      var isDb = /dB/.test(unit || '');
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
        xLabel: unit, hLine: spec, hLabel: 'spec', logX: logX,
        zeroBase: isDb ? false : undefined
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
    var colors = SERIES;
    function pnPanel(mountId, curveKey, noteId, noteHtml, yMin, yMax) {
      var mount = document.getElementById(mountId);
      mount.textContent = '';
      var series = M.LO_META.map(function (m, i) {
        var c = res.lo[m.id][curveKey];
        return {
          name: m.short, color: colors[i], dash: DASHES[i],
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
      mount.appendChild(C.legend(M.LO_META.map(function (m, i) { return { name: m.short, color: colors[i], dash: DASHES[i] }; })));
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
        /* In a subarray null there is no beam to quote a gain for. The
           antenna table already says "IN ITS OWN NULL"; this cell used to
           print a clamped −90 dB scan loss and a ~−60 dBi gain beside it,
           so the same build read two different ways on two screens. */
        b.scanInNull
        ? { k: 'Realised gain', n: '—', unit: '',
            d: 'The beam is steered into the SUBARRAY\'S OWN NULL at ' + n(g.beamScanDeg, 0) +
               '°, so there is no main beam to quote a gain for. A ' + g.radKx + '-wide fixed group at ' +
               n(g.radPitchXCm * 10, 2) + ' mm nulls at sin θ = λ/(K·p) multiples and the steer angle is ' +
               'one of them. Reduce K, change the pitch, turn the group across the scan plane, or steer ' +
               'somewhere else. The pattern panels below are normalised to the ARRAY FACTOR peak instead ' +
               'of the intended beam, because the intended beam has no power in it.' }
        : { k: 'Realised gain', n: n(b.realisedDbi, 2), unit: 'dBi',
          /* antLossTotalDb, matching what beam.js actually subtracted. This
             showed antLossDb while the figure above it was computed with
             antLossTotalDb, so the terms did not add up to the number they
             were explaining on every option with an in-cell feed. */
          d: 'directivity −' + n(b.scanLossDb, 2) + ' dB scan −' + n(b.cohLossDb, 3) +
             ' dB error −' + n(g.antLossDb, 1) + ' dB antenna-side chain' +
             (g.antFeedLossDb > 0.005
               ? ' −' + n(g.antFeedLossDb, 2) + ' dB in-cell feed'
               : '') +
             ' (efficiency, package feed, flip-chip, mismatch, T/R, on-chip, radome). ' +
             'Directivity is not gain; on RX this sits in front of the LNA and goes into G/T' +
             (g.antFeedLossDb > 0.005
               ? ', so the feed term costs ' + n(2 * g.antFeedLossDb, 2) + ' dB of G/T, not ' +
                 n(g.antFeedLossDb, 2) + '.'
               : '.') },
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
        /* was gated on g.elem.key === 'nulled', a kind retired with the
           antenna family — dead code recommending an element that no longer
           exists. The suppression case is now reached by a SUBARRAY whose
           own nulls land on the lobes, which is what span mode does. */
        (g.radPerCh > 1 && -worst.relDb > 20
          ? 'With this subarray the lobes sit in the element’s own nulls — at ' +
            'broadside exactly, and progressively less well as the beam scans away from it, which is ' +
            'why the arrangement buys grating-lobe suppression at the price of scan range. Here it is ' +
            'worth ' + n(-worst.relDb, 1) + ' dB at the worst lobe, and the −3 dB half-cone has ' +
            'narrowed to ' + n(g.antConeMinDeg, 1) + '°.'
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
    var colors = SERIES;

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
            name: m.short, color: colors[i], dash: DASHES[i], markers: true,
            points: rates.map(function (r) { return { x: Math.log10(r), y: sweepEval(m.id, { fBistHz: r }).interTileResidualDeg }; })
          };
        }),
        xLabel: 'log10(BIST update rate / Hz)', yLabel: 'residual inter-tile φ (°)', height: 260,
        hLine: budget.sigSpecDeg, hLabel: 'spec'
      }), M.LO_META.map(function (m, i) { return { name: m.short, color: colors[i], dash: DASHES[i] }; }));

    /* 4 — tile count */
    var tiles = [2, 3, 4, 5, 6, 8, 10];
    panel('Scaling with tile count',
      'Tile side is swept from ' + n(state.apertureCm / 2, 1) + ' cm down, holding the aperture fixed. More tiles ' +
      'means more independent LO instances: the coherence floor at <span class="kv">10log10(σ²/N)</span> improves ' +
      'with N for a fixed σ, but σ itself grows with routing depth.',
      C.sweepChart({
        series: M.LO_META.map(function (m, i) {
          return {
            name: m.short, color: colors[i], dash: DASHES[i], markers: true,
            points: tiles.map(function (k) {
              var r = sweepEval(m.id, { tileCm: state.apertureCm / k });
              return { x: k * k, y: r.interTileResidualDeg };
            })
          };
        }),
        xLabel: 'number of tiles', yLabel: 'residual inter-tile φ (°)', height: 260,
        hLine: budget.sigSpecDeg, hLabel: 'spec'
      }), M.LO_META.map(function (m, i) { return { name: m.short, color: colors[i], dash: DASHES[i] }; }));

    /* 5 — length tolerance */
    var tols = [2, 5, 10, 25, 50, 100];
    panel('Correction range vs mechanical length tolerance',
      'At ' + n(state.fLoGHz, 0) + ' GHz one degree is <span class="kv">' +
      n(K.umPerDeg(state.fLoGHz * 1e9, res.g.epsEff), 1) + ' µm</span> of physical length in this medium. Etch ' +
      'tolerance is <em>static</em>: it does not survive calibration, so it never reaches the residual — what it ' +
      'sets is how much range the corrector needs and how many whole wraps the BIST must resolve. The curve is ' +
      'the same for every distribution frequency, because an ideal multiplier preserves time delay — the reason ' +
      'mid-frequency distribution buys no skew relief. Note how little it moves: at these defaults the correction ' +
      'range is dominated by the Dk tolerance over the path, not by etch.',
      C.sweepChart({
        series: M.LO_META.map(function (m, i) {
          return {
            name: m.short, color: colors[i], dash: DASHES[i], markers: true,
            /* This plotted skewDeg78, which is skewDriftPs x degPs and has
               NO dependence on lenTolUm at all — six exactly flat lines
               under a panel titled "vs mechanical length tolerance". The
               tolerance enters through etchPs into the static term, so what
               it actually moves is the correction range the calibration has
               to cover. */
            points: tols.map(function (t) { return { x: t, y: sweepEval(m.id, { lenTolUm: t }).correctionWraps }; })
          };
        }),
        xLabel: 'per-segment length tolerance (µm, 1σ)', yLabel: 'correction range (wraps at the LO)', height: 260
      }), M.LO_META.map(function (m, i) { return { name: m.short, color: colors[i], dash: DASHES[i] }; }));

    /* 6 — aperture */
    var aps = [10, 15, 20, 30, 40, 50];
    panel('Scaling with aperture',
      'Loss and power scale with routed length, so the shared-LO options degrade as the aperture grows while the ' +
      'per-tile PLL option is nearly flat. This is the modularity argument for A1, quantified.',
      C.sweepChart({
        series: M.LO_META.map(function (m, i) {
          return {
            name: m.short, color: colors[i], dash: DASHES[i], markers: true,
            points: aps.map(function (a) { return { x: a, y: sweepEval(m.id, { apertureCm: a }).powerTotalMw / 1000 }; })
          };
        }),
        xLabel: 'aperture side (cm)', yLabel: 'distribution power (W)', height: 260
      }), M.LO_META.map(function (m, i) { return { name: m.short, color: colors[i], dash: DASHES[i] }; }));
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
      var tied = (dec.loTieIds || [dec.loPick.id]).indexOf(row.id) >= 0;
      var td = UI.elt('td', 'v' + (tied ? ' rec' : ''));
      td.innerHTML = '<strong>' + (row.score * 100).toFixed(0) + '</strong>' +
        (row.eligible ? '' : row.infeasible ? ' <span class="badge fail">infeasible</span>' : ' <span class="badge fail">off-spec</span>') +
        (tied && dec.loTied.length > 1 ? ' <span class="badge warn">tied</span>' : '');
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

  /* Everything derived from ONE parameter set, in one place, so that the
     Systems view evaluates a saved system by exactly the path the main
     window uses — a comparison built from a second, parallel evaluation
     path is a comparison that can disagree with the thing it compares.
     light: true drops the plot-only parts of the beam evaluation and
     coarsens the cut sampling (see beam.js). Measured across 250 parameter
     combinations, the largest light-vs-full difference on any scalar a
     comparison row shows is 0.0016 dB — the TTD numbers are bit-identical
     — but it is a coarser evaluation, not an exact one, and the docstring
     in beam.js records the bound rather than claiming exactness. */
  function bundleFor(st, opts) {
    var light = !!(opts && opts.light);
    /* light mode narrows the WHOLE chain, not just the beam. The Systems
       view reads one LO option, one baseband option, no map and no ranking
       per system; a full evaluation builds all seven option topologies, the
       map topology, and twelve complete recommendation documents that
       nothing then reads. At a 0.5 cm tile pitch that unread work is most
       of the second-plus each system costs. */
    var res = M.evaluate(st, light ? { onlySelected: true } : undefined);
    var budget = window.Budget.derive(res.g, '64QAM');
    /* Decision.build ranks every option against every other, so it needs
       the full evaluation — and the comparison never reads it */
    var dec = light ? null : window.Decision.build(res, budget);
    var g = res.g;
    var beam = window.Beam.evaluate(g, budget, res.lo[g.loOptionId], res.bb[g.bbOptionId],
      light ? { light: true } : undefined);
    return { res: res, g: g, budget: budget, dec: dec, beam: beam };
  }

  /* How many of the seventy are showing, and a way back when the answer is
     "none" — a filter that silently matches nothing looks like a broken
     panel. */
  function updateParamCount() {
    var el2 = document.getElementById('paramCount');
    if (!el2) return;
    var shown = document.querySelectorAll('#paramMount .field:not(.hidden)').length;
    var total = M.PARAMS.length;
    var filtered = view.paramFilter || view.paramHot || view.paramChanged;
    el2.textContent = !filtered ? ''
      : shown === 0 ? 'no parameter matches — clear the filter to see all ' + total
      : 'showing ' + shown + ' of ' + total;
  }

  /* The context bar in the sticky header. Three jobs, all of them things the
     page could not previously answer without navigating:
       - which architecture is selected (the picker shows only on the map)
       - what the model concluded (painted only inside Compare and Decision)
       - whether the view you are on shows ALL options or only your build
     The two selection chips scroll to the picker; the verdict chip opens the
     rationale. */
  function renderContextBar(res, budget, dec) {
    var lm = M.LO_META.filter(function (m) { return m.id === res.g.loOptionId; })[0];
    var bm = M.BB_META.filter(function (m) { return m.id === res.g.bbOptionId; })[0];

    function chip(el2, kind, value) {
      if (!el2) return;
      el2.textContent = '';
      el2.appendChild(UI.elt('span', 'ck', kind));
      el2.appendChild(UI.elt('span', 'cv', value));
    }
    chip(document.getElementById('ctxLo'), 'LO', lm ? lm.short : '—');
    chip(document.getElementById('ctxBb'), 'BB', bm ? bm.short : '—');
    var am = M.ANT_META[Math.round(state.antOption)];
    var asel2 = res.ant && res.ant[res.g.antOptionId];
    chip(document.getElementById('ctxAnt'), 'ANT',
      (am ? am.short : '—') + (asel2 && asel2.radPerCh > 1 ? ' ×' + asel2.radPerCh : ''));

    /* A tie is shown as "X ≈ Y", not as a single winner: the chip is the
       one place the verdict is visible from every view, so it must not
       assert a ranking the score cannot support. */
    function pickLabel(p, tied) {
      if (!p) return '—';
      return p.short + (tied && tied.length > 1 ? ' ≈ ' + tied[1].short : '');
    }
    var vpick = dec && dec.loPick && dec.bbPick
      ? pickLabel(dec.loPick, dec.loTied) + ' + ' + pickLabel(dec.bbPick, dec.bbTied) : '—';
    chip(document.getElementById('ctxVerdict'), 'model picks', vpick);

    /* A hard inconsistency now lives in a banner inside the map panel, so it
       would be invisible from the eight other views. The chip is not the
       message — it is the fact that there IS one, and a way back to it. */
    var wc = document.getElementById('ctxWarn');
    var hard = (res.warnings || []).filter(function (w) { return w.severity === 'fail'; });
    if (wc) {
      wc.classList.toggle('hidden', !hard.length);
      if (hard.length) chip(wc, 'inconsistent', hard.length + ' to resolve');
    }

    /* whether THIS view is showing every option or only the current build */
    var oneBuild = { map: 1, beam: 1 };
    var scope = document.getElementById('ctxScope');
    if (scope) {
      var sel = res.lo[res.g.loOptionId];
      scope.textContent = oneBuild[view.name]
        ? 'showing your build only · inter-tile residual ' + n(sel.interTileResidualDeg, 3) +
          '° against a ' + n(budget.sigSpecDeg) + '° spec'
        : 'showing all options · judged against ' + n(budget.sigSpecDeg) +
          '° inter-tile, set by ' + budget.bindingName;
    }
  }

  function render() {
    var res = M.evaluate(state);
    var budget = window.Budget.derive(res.g, '64QAM');
    var dec = window.Decision.build(res, budget);
    last = { res: res, budget: budget, dec: dec };

    /* clamp the tile selection if the grid shrank */
    if (view.selected >= res.selected.grid.nTiles) view.selected = 0;

    renderPicker(res, budget);
    renderContextBar(res, budget, dec);
    UI.renderBudget(document.getElementById('budgetGrid'), document.getElementById('budgetNote'),
      document.getElementById('bindingNote'), budget);

    UI.renderParams(document.getElementById('paramMount'), M.PARAMS.map(function (p) {
      return {
        key: p.key, label: p.label, units: p.units, group: p.group, min: p.min, max: p.max,
        step: p.step, choices: p.choices, justification: p.why, confidence: p.conf
      };
    }), state, DEFAULTS, setParam, {
      filter: view.paramFilter || '',
      hot: view.paramHot ? M.HOT_PARAMS : null,
      onlyChanged: !!view.paramChanged
    });
    updateParamCount();

    var nd = Object.keys(overrides()).length;
    document.getElementById('dirtyCount').textContent = nd ? nd + ' changed from defaults' : 'all at defaults';

    /* Mark the tool's own vocabulary wherever it appears. Done after the
       view renders, first occurrence only per container, so a table does not
       become a field of dotted underlines. Glossary.mark is idempotent —
       re-rendering the same container is a no-op. */
    function glossify() {
      if (!window.Glossary) return;
      var v = document.getElementById('view-' + view.name);
      if (v) [].slice.call(v.querySelectorAll('.prose, .note, .viewintro, .budget, table.grid'))
        .forEach(function (el2) { window.Glossary.mark(el2); });
    }

    if (view.name === 'map') renderMapView(res, budget);
    if (view.name === 'compare') renderCompare(res, budget, dec);
    if (view.name === 'phasenoise') renderPn(res, budget);
    if (view.name === 'beam') renderBeam(res, budget);
    if (view.name === 'sweeps') renderSweeps(res, budget);
    if (view.name === 'decision') renderDecision(res, budget, dec);
    if (view.name === 'assumptions') renderAssumptions(res);
    if (view.name === 'systems') renderSystems();
    if (view.name === 'link') renderLink(res, budget);
    if (view.name === 'chooser') renderChooser(res, budget);
    if (view.name === 'method') UI.renderProse(document.getElementById('methodMount'), window.Content.METHOD);
    glossify();
    /* the nav badge is visible from every view, so it updates outside the
       systems branch */
    var navc = document.getElementById('navSysCount');
    if (navc) {
      var ns = window.Systems.count();
      navc.textContent = ns ? ' (' + ns + ')' : '';
    }

    document.getElementById('footNote').innerHTML =
      'Architecture-selection instrument, not a validated simulator &mdash; read the honesty ledger before quoting a number. ' +
      'Model recomputed live from ' + M.PARAMS.length + ' parameters; the map and the tables share one topology generator.';
  }

  /* =====================================================================
     SYSTEMS — several saved parameter sets, side by side.

     Three things in here exist to stop the view being confidently wrong:

     1. Each saved system is evaluated through bundleFor(), the same
        function the main window uses. There is no second code path that
        could drift out of step with the thing it is comparing.

     2. The derived requirement is a FUNCTION OF THE PARAMETERS — the
        inter-tile budget moves with the array geometry and the EVM
        allocation. So a system with a coarser tile pitch is judged against
        a laxer spec, and "passes" more easily. Pass/fail colouring is
        therefore per column against that column's own requirement
        (specField, see ui.js), the requirement gets its own panel above
        the results, and the note says so in words.

     3. A comparison of results with no view of the inputs is unreadable,
        so the differing parameters get a panel of their own, and it lists
        parameters added to the tool since a system was saved rather than
        pretending the system had an opinion about them.
     ================================================================== */
  var SYS = window.Systems;

  /* Saved systems plus any that arrived in a link, capped so the two
     sources together cannot exceed the column limit — 12 saved and 12
     shared would otherwise render 24 columns against a limit whose whole
     purpose is readability. */
  function sysAll() {
    var own = SYS.list();
    var room = Math.max(0, SYS.limit() - own.length);
    return own.concat((view.sys.shared || []).slice(0, room));
  }

  /* One evaluated system. The FLAT metric record is what gets memoised,
     not the bundle: a bundle keeps five 800-2400-point pattern arrays that
     nothing in this view reads, and holding 12 of those alive is megabytes
     of garbage for no benefit. */
  function sysEntry(rec, opts) {
    var r = SYS.resolveState(rec, DEFAULTS);
    var base = {
      rec: rec, state: r.state, filled: r.filled, unknown: r.unknown
    };
    /* A system that is not in the comparison still appears in the roster,
       which needs only its architecture, its tile count and its consistency
       warnings — all of which come from resolve(), the cheap part. Fully
       evaluating it would cost a second per system at a fine tile pitch for
       a row the user has explicitly excluded, which would make the Compare
       checkboxes save nothing at all. */
    if (opts && opts.rosterOnly) {
      var packedLite = SYS.evaluated(r.state, function (st) {
        var g = M.resolve(st);
        var lm = M.LO_META[Math.round(st.loOption)] || M.LO_META[M.LO_META.length - 1];
        var bm = M.BB_META[Math.round(st.bbOption)] || M.BB_META[M.BB_META.length - 1];
        return {
          flat: {
            arch_lo: lm ? lm.short : '—', arch_bb: bm ? bm.short : '—',
            arch_ref: g.refName || '—', g_nTilesTotal: g.nTilesTotal
          },
          warnings: M.consistency(g) || []
        };
      }, 'sys-roster-v1');
      base.flat = packedLite.flat;
      base.warnings = packedLite.warnings;
      base.rosterOnly = true;
      return base;
    }
    var packed = SYS.evaluated(r.state, function (st) {
      var b = bundleFor(st, { light: true });
      return { flat: flattenBundle(b, st), warnings: b.res.warnings || [] };
    }, 'sys-light-v1');
    base.flat = packed.flat;
    base.warnings = packed.warnings;
    return base;
  }

  var LO_FIELDS = ['interTileResidualDeg', 'interTileRawDeg', 'pnDiffCalDeg', 'driftResidDeg',
    'phiRmsDeg', 'phiArrayDeg', 'jitterFs', 'skewRmsPs', 'skewPeakPs', 'skewDriftPs', 'skewDeg78',
    'correctionRangeDeg', 'correctionWraps', 'lossTotalDb', 'lossPerCmDb', 'requiredGainDb',
    'powerTotalMw', 'powerPerTileMw', 'powerFracOfArray', 'sllDb', 'gainLossDb', 'pointingErrDeg',
    'evmDb', 'evmPct', 'maxQam', 'distFreqGHz', 'tileMultiplier', 'pathMeanCm', 'totalRoutedCm',
    'repeaters', 'splitCount', 'areaPerTileMm2', 'calBurdenScore', 'feasibility', 'riskLevel'];

  var BB_FIELDS = ['interKind', 'interPathMaxCm', 'interRoutedCm', 'interGeoRawPs', 'interGeoSkewPs',
    'interUncompPs', 'ttdRangeConsumedPct', 'skewRmsPs', 'skewPeakPs', 'skewEdgeDeg',
    'interTileResidualDeg', 'rampSteerDeg', 'squintLossDb', 'lossTotalDb', 'nfPenaltyDb',
    'requiredGainDb', 'bwGHz', 'iip3PenaltyDb', 'powerPerTileMw', 'powerTotalMw',
    'powerFracOfArray', 'areaPerTileMm2', 'calBurdenScore', 'feasibility', 'riskLevel'];

  /* Flatten one system into the single flat record UI.renderTable wants.
     Prefixes keep the three sources from colliding — lo_ and bb_ both have
     skewRmsPs and they are different numbers. */
  function flattenBundle(bundle, st) {
    var g = bundle.g, bd = bundle.budget, bm = bundle.beam;
    var lo = bundle.res.lo[g.loOptionId], bb = bundle.res.bb[g.bbOptionId];
    var o = {};
    LO_FIELDS.forEach(function (k) { o['lo_' + k] = lo[k]; });
    BB_FIELDS.forEach(function (k) { o['bb_' + k] = bb[k]; });

    o.req_sigSpecDeg = bd.sigSpecDeg;
    o.req_binding = bd.bindingName;
    o.req_nullFloorDb = bd.nullFloorDb;
    o.req_evmLimitDb = bd.evmLimitDb;
    o.req_pointDeg = bd.pointBudgetDeg;
    o.req_skewPs = bd.skewSpecPs;
    o.req_nTiles = bd.nTiles;
    o.req_hpbwScan = bd.hpbwScan;
    o.req_tauRangePs = bd.tauRangePs;
    o.req_sigForEvmDeg = bd.sigForEvmDeg;
    /* the comparable quantity when the specs themselves differ */
    o.margin_sigDeg = bd.sigSpecDeg - lo.interTileResidualDeg;

    o.g_tileCols = g.tileCols;
    o.g_nTilesTotal = g.nTilesTotal;
    o.g_effApertureCm = g.effApertureCm;
    o.g_diesPlaced = g.diesPlaced;
    o.g_nElem = g.nElem;
    o.g_elemDxLam = g.elemDxLam;
    /* The lattice's lobe count exists whatever the layout mode, because it
       is a property of the lattice — but an APERIODIC layout does not
       radiate them, and reporting "42 grating lobes" in the same column
       that reports "worst grating lobe: none" is a contradiction on one
       screen. The comparison reports the effective count. */
    /* the count AT THE COMMANDED ANGLE, to match the lobe level reported
       next to it. g.lobeCount is the broadside count, and lobes cross the
       horizon as the beam steers, so pairing a broadside count with a
       scanned level put two different geometries on adjacent rows. */
    o.g_lobeCount = Math.round(g.latticePeriodic) === 1 ? (bm.lobes ? bm.lobes.length : g.lobeCount) : 0;
    o.g_lobeCountBroadside = Math.round(g.latticePeriodic) === 1 ? g.lobeCount : 0;
    o.g_latticeMode = Math.round(g.latticePeriodic) === 1 ? 'periodic' : 'aperiodic';
    o.g_thinningLossDb = g.thinningLossDb;
    o.g_dCellDbi = g.dCellDbi;
    o.g_farFieldM = g.farFieldM;
    o.g_latLabel = g.lat ? g.lat.label : '—';
    o.g_minSepCm = g.minSepCm;
    o.g_elemLabel = g.elem ? g.elem.label : '—';

    o.bm_dFilledDbi = bm.dFilledDbi;
    o.bm_dArrayDbi = bm.dArrayDbi;
    o.bm_realisedDbi = bm.realisedDbi;
    o.bm_scanLossDb = bm.scanLossDb;
    o.bm_hpbwDeg = bm.m.hpbwDeg;
    o.bm_sllDb = bm.m.sllDb;
    o.bm_gratingDb = bm.mWide.gratingDb;
    o.bm_gratingAtDeg = bm.mWide.gratingAtDeg;
    o.bm_floorNearDb = bm.floorNearDb;
    o.bm_floorFarDb = bm.floorFarDb;
    o.bm_edgeLossDb = bm.edgeLossDb;
    o.bm_taperLossDb = bm.taperLossDb;
    o.bm_squintBeamwidths = bm.squintBeamwidths;
    o.bm_ttdWorstDb = bm.ttd ? bm.ttd.worstDb : NaN;
    o.bm_ttdAtScanDb = bm.ttd ? bm.ttd.atScanDb : NaN;

    o.tot_powerW = (lo.powerTotalMw + bb.powerTotalMw) / 1000;
    o.tot_powerFrac = lo.powerFracOfArray + bb.powerFracOfArray;
    /* NOT summed into one "area per tile". Both are mm² per tile, but the
       LO figure is the whole LO bill of materials divided by the tile count
       — so it carries a smeared share of one-off board items and moves with
       the tile count — while the baseband figure is genuine per-tile
       silicon. Adding them produces a number that behaves like neither, so
       they are reported separately and their sum is labelled as an
       attribution rather than a measurement. */
    o.lo_areaAttribMm2 = lo.areaPerTileMm2;
    o.bb_areaPerTileMm2 = bb.areaPerTileMm2;
    o.tot_areaPerTileMm2 = lo.areaPerTileMm2 + bb.areaPerTileMm2;

    /* headroom, so two columns pinned to the filled-aperture cap by the
       min() in dArrayDbi can be seen to be pinned rather than equal */
    o.g_dElHeadroomDb = g.dElHeadroomDb;
    o.g_dArrayRawDbi = g.dArrayRawDbi;
    o.g_pitchExact = g.aperturePitchExact ? 'exact' : 'under-fills';
    o.g_marginCm = g.apertureMarginCm;
    o.bm_hpbwResolved = bm.m.hpbwResolved ? 'yes' : 'NOT RESOLVED';

    /* the architecture itself, as text, because two systems that differ
       only in which option is selected must not look identical */
    var loMeta = M.LO_META[Math.round(st.loOption)];
    var bbMeta = M.BB_META[Math.round(st.bbOption)];
    o.arch_lo = loMeta ? loMeta.short : '—';
    o.arch_bb = bbMeta ? bbMeta.short : '—';
    o.arch_ref = g.refName || '—';
    return o;
  }

  function sysMetricRows() {
    return [
      { section: 'Architecture' },
      { name: 'LO / reference distribution', field: 'arch_lo', fmt: function (v, r) { return str(r.arch_lo); } },
      { name: 'Baseband split / combine', field: 'arch_bb', fmt: function (v, r) { return str(r.arch_bb); } },
      { name: 'Reference clock', field: 'arch_ref', fmt: function (v, r) { return str(r.arch_ref); } },
      { name: 'Frequency on the board', field: 'lo_distFreqGHz', units: 'GHz', dec: 2 },
      { name: 'Per-tile multiplication', field: 'lo_tileMultiplier', units: '×', dec: 0 },

      { section: 'Array' },
      {
        name: 'Tiles', field: 'g_nTilesTotal', dec: 0, noDelta: true, alsoFields: ['g_tileCols'],
        fmt: function (v, r) { return n(r.g_tileCols, 0) + '×' + n(r.g_tileCols, 0) + ' = ' + n(v, 0); }
      },
      {
        name: 'Populated aperture', sub: 'the tile grid is floored, never rounded, so it can under-fill the panel',
        field: 'g_effApertureCm', units: 'cm', dec: 1, alsoFields: ['g_pitchExact', 'g_marginCm'],
        fmt: function (v, r) {
          return n(v, 1) + (r.g_pitchExact === 'exact' ? '' : ' (−' + n(r.g_marginCm, 2) + ' cm/side)');
        }
      },
      { name: 'Dies placed', field: 'g_diesPlaced', dec: 0 },
      { name: 'Radiating elements', field: 'g_nElem', dec: 0 },
      {
        name: 'Element lattice', field: 'g_elemDxLam', units: 'λ', dec: 2, noDelta: true,
        alsoFields: ['g_latLabel', 'g_minSepCm'],
        fmt: function (v, r) { return n(v, 2) + 'λ · ' + str(r.g_latLabel); }
      },
      { name: 'Element pattern model', field: 'g_elemLabel', noDelta: true, fmt: function (v, r) { return str(r.g_elemLabel); } },

      { section: 'M3 · inter-tile phase error — the metric that decides it' },
      {
        name: 'Residual after BIST', sub: 'judged against each system’s OWN derived requirement',
        field: 'lo_interTileResidualDeg', units: '°', better: 'low', specField: 'req_sigSpecDeg'
      },
      {
        /* THE row that makes the moving-spec trap visible in the table
           itself rather than only in the prose above it. A system with a
           coarser tile pitch gets a laxer requirement, so it can show a
           worse residual and still be green; the margin is what actually
           compares, and it is rankable because it already contains each
           column's own threshold. */
        name: 'Margin to requirement', sub: 'spec − residual; this is the comparable quantity when the specs differ',
        field: 'margin_sigDeg', units: '°', better: 'high', dec: 2
      },
      { name: 'Raw, uncalibrated', sub: 'before any calibration — not a deliverable number', field: 'lo_interTileRawDeg', units: '°', better: 'low', rank: false },
      { name: '· differential phase noise', field: 'lo_pnDiffCalDeg', units: '°', better: 'low' },
      { name: '· drift residual', field: 'lo_driftResidDeg', units: '°', better: 'low' },
      { name: 'Baseband residual', field: 'bb_interTileResidualDeg', units: '°', better: 'low' },

      { section: 'M1 / M2 · phase noise & jitter' },
      { name: 'Single-tile φ RMS', field: 'lo_phiRmsDeg', units: '°', better: 'low' },
      { name: 'Array-output φ RMS', field: 'lo_phiArrayDeg', units: '°', better: 'low', specField: 'req_sigForEvmDeg' },
      { name: 'RMS jitter', field: 'lo_jitterFs', units: 'fs', better: 'low', dec: 1 },
      {
        name: 'Array-output EVM', field: 'lo_evmDb', units: 'dB', better: 'low', specField: 'req_evmLimitDb',
        fmt: function (v, r) { return isFinite(v) ? n(v, 1) + ' (' + n(r.lo_evmPct, 2) + '%)' : '—'; }
      },
      { name: 'Highest supportable QAM', field: 'lo_maxQam', fmt: function (v, r) { return str(r.lo_maxQam); } },

      { section: 'M4 · skew' },
      {
        /* deliberately NOT judged against budget.skewSpecPs. That spec is
           the phase spec divided by 28.08°/ps, i.e. ~0.18 ps, while this
           number includes the hundreds of picoseconds of Dk and etch
           tolerance that one calibration removes. Colouring every column
           red at a 1000x margin makes the whole table's colouring
           meaningless. The row that carries the spec is the residual. */
        name: 'LO RMS skew', sub: 'mostly static and calibratable — see the residual row for what survives',
        field: 'lo_skewRmsPs', units: 'ps', better: 'low', rank: false
      },
      { name: 'LO thermal drift skew', sub: 'what BIST has to track', field: 'lo_skewDriftPs', units: 'ps', better: 'low' },
      { name: 'Correction range needed', field: 'lo_correctionRangeDeg', units: '°', better: 'low', dec: 0, fmt: function (v, r) { return isFinite(v) ? n(v, 0) + '° (' + n(r.lo_correctionWraps, 1) + ' wraps)' : '—'; } },
      { name: 'Baseband geometric skew after TTD', field: 'bb_interGeoSkewPs', units: 'ps', better: 'low' },
      { name: 'Baseband beam steer from the ramp', field: 'bb_rampSteerDeg', units: '°', better: 'low', dec: 3 },
      { name: 'TTD range consumed by routing', field: 'bb_ttdRangeConsumedPct', units: '%', better: 'low', dec: 0 },

      { section: 'M5 · loss' },
      { name: 'LO distribution loss', field: 'lo_lossTotalDb', units: 'dB', better: 'low', dec: 1 },
      {
        /* measured at each option's own distribution frequency, and
           sometimes in a different medium, so the lowest number is not the
           better engineering choice */
        name: 'LO loss per cm', sub: 'at each system’s own distribution frequency — not comparable across families',
        field: 'lo_lossPerCmDb', units: 'dB/cm', better: 'low', rank: false
      },
      { name: 'Baseband net insertion loss', field: 'bb_lossTotalDb', units: 'dB', better: 'low', dec: 1 },
      { name: 'Baseband NF penalty', field: 'bb_nfPenaltyDb', units: 'dB', better: 'low', dec: 2 },

      { section: 'M6 · power & area' },
      { name: 'LO distribution power', field: 'lo_powerTotalMw', units: 'W', better: 'low', scale: 1e-3, dec: 2 },
      { name: 'Baseband power', field: 'bb_powerTotalMw', units: 'W', better: 'low', scale: 1e-3, dec: 2 },
      { name: 'Distribution total', sub: 'LO + baseband, both rails', field: 'tot_powerW', units: 'W', better: 'low', dec: 2 },
      { name: 'Share of array budget', field: 'tot_powerFrac', units: '%', better: 'low', dec: 1 },
      {
        name: 'LO area attributed per tile', sub: 'whole LO bill of materials ÷ tile count, so it carries a share of one-off board items',
        field: 'lo_areaAttribMm2', units: 'mm²', better: 'low', dec: 2, rank: false
      },
      { name: 'Baseband area per tile', sub: 'genuine per-tile silicon, both rails', field: 'bb_areaPerTileMm2', units: 'mm²', better: 'low', dec: 3 },
      {
        name: 'Both, attributed per tile', sub: 'the sum of two differently-defined quantities — an attribution, not a measurement',
        field: 'tot_areaPerTileMm2', units: 'mm²', better: 'low', dec: 2, rank: false
      },
      { name: 'Repeater amplifiers', field: 'lo_repeaters', better: 'low', dec: 0 },

      { section: 'Beam · from the corrected lattice model' },
      {
        name: 'Directivity', sub: 'min(N·D_el, filled aperture)', field: 'bm_dArrayDbi', units: 'dBi', better: 'high', dec: 2,
        fmt: function (v, r) {
          return n(v, 2) + (isFinite(r.g_dElHeadroomDb) && r.g_dElHeadroomDb <= 0 ? ' (capped)' : '');
        },
        /* only what the cell prints: an alsoField the fmt never shows would keep a row in "differences only" that reads identically */
        alsoFields: []
      },
      { name: 'Realised gain', sub: 'after scan, error and the antenna-side chain', field: 'bm_realisedDbi', units: 'dBi', better: 'high', dec: 2 },
      {
        /* This is 10log10(4*pi*A_cell/(lambda^2*D_el)), and the "element
           directivity headroom" that used to sit on the next row is the
           SAME NUMBER by construction — dCellDbi - dElDbi reduces to it
           once the populated area is written as N cells. Two rows, one
           quantity, opposite `better` directions, and the duplicate was the
           ranked one, so the array with the WORST element-to-cell fill was
           being crowned. One row, one direction, and the cell ceiling is
           named in the sub-line instead of pretending to be a second
           measurement. */
        name: 'Element-to-cell fill gap',
        sub: 'not a thinning loss — the same dB is the headroom left to the cell ceiling, and it is recoverable',
        field: 'g_thinningLossDb', units: 'dB', better: 'low', dec: 2, rank: false,
        alsoFields: ['g_dCellDbi']
      },
      { name: 'Cell directivity ceiling', sub: 'what a cell-filling radiator could reach', field: 'g_dCellDbi', units: 'dBi', better: 'high', dec: 2 },
      {
        name: 'Beamwidth', field: 'bm_hpbwDeg', units: '°', dec: 3, alsoFields: ['bm_hpbwResolved'],
        fmt: function (v, r) { return r.bm_hpbwResolved === 'yes' ? n(v, 3) : 'not resolved'; }
      },
      { name: 'First sidelobe', field: 'bm_sllDb', units: 'dB', better: 'low', dec: 1 },
      {
        name: 'Worst grating lobe', sub: 'positive means it beats the intended beam',
        field: 'bm_gratingDb', units: 'dB', better: 'low', dec: 2,
        fmt: function (v, r) { return isFinite(v) ? n(v, 2) + ' @ ' + n(r.bm_gratingAtDeg, 1) + '°' : 'none'; }
      },
      {
        name: 'Grating lobes in visible space', sub: 'at the commanded angle; broadside count in brackets',
        field: 'g_lobeCount', better: 'low', dec: 0,
        alsoFields: ['g_latticeMode', 'g_lobeCountBroadside'],
        fmt: function (v, r) {
          if (r.g_latticeMode === 'aperiodic') return 'none (aperiodic)';
          return n(v, 0) + (r.g_lobeCountBroadside !== v ? ' (' + n(r.g_lobeCountBroadside, 0) + ')' : '');
        }
      },
      { name: 'Lattice mode', field: 'g_latticeMode', noDelta: true, fmt: function (v, r) { return str(r.g_latticeMode); } },
      { name: 'Error floor, near beam', field: 'bm_floorNearDb', units: 'dB', better: 'low', dec: 1 },
      { name: 'Error floor, between lobes', field: 'bm_floorFarDb', units: 'dB', better: 'low', dec: 1 },
      { name: 'TTD quantisation lobe', sub: 'deterministic worst case at band edge', field: 'bm_ttdWorstDb', units: 'dB', better: 'low', dec: 1 },
      { name: 'Band-edge loss', field: 'bm_edgeLossDb', units: 'dB', better: 'low', dec: 3 },
      { name: 'Squint without inter-tile TTD', field: 'bm_squintBeamwidths', units: 'beamwidths', better: 'low', dec: 2 },

      { section: 'Judgement' },
      { name: 'LO feasibility', field: 'lo_feasibility', wrap: true, fmt: function (v, r) { return str(r.lo_feasibility); } },
      { name: 'LO risk', field: 'lo_riskLevel', wrap: true, fmt: function (v, r) { return str(r.lo_riskLevel); } },
      { name: 'Baseband feasibility', field: 'bb_feasibility', wrap: true, fmt: function (v, r) { return str(r.bb_feasibility); } },
      { name: 'LO measurements per array pass', field: 'lo_calBurdenScore', better: 'low', dec: 0 }
    ];
  }

  function sysReqRows() {
    return [
      { name: 'Binding requirement', sub: 'inter-tile differential phase error', field: 'req_sigSpecDeg', units: '°', dec: 2 , spread: true },
      { name: 'What binds it', field: 'req_binding', fmt: function (v, r) { return str(r.req_binding); } },
      { name: 'Implied null-depth floor', field: 'req_nullFloorDb', units: 'dB', dec: 1 , spread: true },
      { name: 'Array-output EVM limit', field: 'req_evmLimitDb', units: 'dB', dec: 1 , spread: true },
      { name: 'Absolute φ for that EVM', field: 'req_sigForEvmDeg', units: '°', dec: 2 , spread: true },
      { name: 'Pointing budget', field: 'req_pointDeg', units: '°', dec: 3 , spread: true },
      { name: 'Skew equivalent of the spec', field: 'req_skewPs', units: 'ps', dec: 2 , spread: true },
      { name: 'Independent tiles', field: 'req_nTiles', dec: 0 , spread: true },
      { name: 'Beamwidth at max scan', field: 'req_hpbwScan', units: '°', dec: 3 , spread: true },
      { name: 'TTD range required', field: 'req_tauRangePs', units: 'ps', dec: 0 , spread: true }
    ];
  }

  /* ---------------------------------------------------------------------
     the roster: name, architecture, what it overrides, and row actions
     ------------------------------------------------------------------- */
  function renderSysRoster(entries) {
    var mount = document.getElementById('sysRosterMount');
    mount.textContent = '';
    var curKey = SYS.stateKey(state);

    var t = document.createElement('table');
    t.className = 'grid narrow1';
    var thead = document.createElement('thead'), htr = document.createElement('tr');
    ['Compare', 'System', 'Architecture', 'Changed from defaults', 'Status', ''].forEach(function (h, i) {
      var th = UI.elt('th', null, h);
      if (i === 1 || i === 2 || i === 3) th.style.textAlign = 'left';
      htr.appendChild(th);
    });
    thead.appendChild(htr); t.appendChild(thead);

    var tb = document.createElement('tbody');
    entries.forEach(function (e, i) {
      var rec = e.rec, isCur = SYS.stateKey(e.state) === curKey;
      var tr = document.createElement('tr');
      var chkTd = UI.elt('td');
      var chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = !(view.sys.excluded || {})[rec.id];
      chk.title = 'Include this system in the comparison tables and charts';
      chk.setAttribute('aria-label', 'Include ' + rec.name + ' in the comparison');
      chk.addEventListener('change', function () {
        /* touching any other control ends a rename. Blur normally does
           that, but an input that never received focus never blurs, and
           the row would then stay stuck in edit mode across every
           subsequent render. */
        view.sys.renaming = null;
        view.sys.excluded = view.sys.excluded || {};
        if (chk.checked) delete view.sys.excluded[rec.id];
        else view.sys.excluded[rec.id] = true;
        render();
      });
      chkTd.appendChild(chk);
      tr.appendChild(chkTd);

      /* name — click to rename in place */
      var nameTd = UI.elt('td', 'mn');
      if (view.sys.renaming === rec.id) {
        var inp = document.createElement('input');
        inp.type = 'text'; inp.value = rec.name; inp.maxLength = 48;
        inp.style.cssText = 'font:12px var(--mono);width:100%;padding:3px 5px;border:1px solid var(--accent);border-radius:4px;background:var(--bg-panel);color:var(--ink)';
        inp.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { SYS.update(rec.id, { name: inp.value }); view.sys.renaming = null; render(); }
          if (ev.key === 'Escape') { view.sys.renaming = null; render(); }
        });
        inp.addEventListener('blur', function () {
          if (view.sys.renaming !== rec.id) return;
          view.sys.renaming = null;
          var next = String(inp.value).slice(0, 48);
          if (next !== rec.name) SYS.update(rec.id, { name: next });
          /* Blur fires on MOUSEDOWN, before the click completes. Rendering
             synchronously here replaces the node the click was travelling
             to, so the first click on any other control after a rename was
             swallowed. Deferring lets mouseup and click land on the DOM the
             user actually aimed at; the re-render follows immediately
             after, and is harmless if that handler already rendered. */
          setTimeout(render, 0);
        });
        nameTd.appendChild(inp);
        setTimeout(function () { inp.focus(); inp.select(); }, 0);
      } else {
        var nb = document.createElement('button');
        nb.className = 'btn';
        nb.style.cssText = 'border:0;background:none;padding:0;font:inherit;font-weight:500;text-align:left;color:var(--ink)';
        nb.textContent = rec.name;
        nb.title = rec.shared ? 'From a shared link — rename after importing' : 'Click to rename';
        if (!rec.shared) nb.addEventListener('click', function () { view.sys.renaming = rec.id; render(); });
        nameTd.appendChild(nb);
        if (rec.note) nameTd.appendChild(UI.elt('small', null, rec.note));
      }
      tr.appendChild(nameTd);

      var f = e.flat;
      var archTd = UI.elt('td', null, f.arch_lo + ' + ' + f.arch_bb);
      archTd.style.textAlign = 'left';
      /* The stylesheet only makes a <small> a block inside a .mn cell, and
         this cell is not one — so the reference name ran straight on from the
         baseband name with no separator ("B3 H-tree activeRFSoC CLK104").
         Set it here, beside the textAlign this cell already sets inline. */
      var archSub = UI.elt('small', null, f.arch_ref + ' · ' + n(e.state.tileCm, 2) + ' cm tiles · ' + n(f.g_nTilesTotal, 0) + ' tiles');
      archSub.style.display = 'block';
      archTd.appendChild(archSub);
      tr.appendChild(archTd);

      var ov = SYS.overrides(rec, DEFAULTS);
      var ovKeys = Object.keys(ov);
      var ovTd = UI.elt('td', null, ovKeys.length ? ovKeys.length + ' parameter' + (ovKeys.length === 1 ? '' : 's') : 'none');
      ovTd.style.textAlign = 'left';
      if (ovKeys.length) {
        ovTd.title = ovKeys.map(function (k) {
          var p = paramByKey(k);
          return (p ? p.label : k) + ' = ' + ov[k] + (p && p.units ? ' ' + p.units : '');
        }).join('\n');
        ovTd.appendChild(UI.elt('small', null, ovKeys.slice(0, 3).map(function (k) {
          var p = paramByKey(k);
          return p ? p.label : k;
        }).join(', ') + (ovKeys.length > 3 ? ', …' : '')));
      }
      tr.appendChild(ovTd);

      var stTd = UI.elt('td');
      if (isCur) stTd.appendChild(UI.elt('span', 'badge acc', 'loaded'));
      if (rec.shared) stTd.appendChild(UI.elt('span', 'badge warn', 'from link'));
      if (rec.decodeLost) {
        var dl = UI.elt('span', 'badge fail', 'link decode failed');
        dl.title = 'The link carried ' + rec.decodeLost + ' parameter value(s) for this system but none could be ' +
          'read — it was probably produced by a different version of the tool, or the URL was truncated. What ' +
          'is shown is entirely at YOUR defaults, so do not treat it as the sender\'s system.';
        stTd.appendChild(dl);
      } else if (rec.decodeClamped) {
        var dc = UI.elt('span', 'badge warn', rec.decodeClamped + ' clamped');
        dc.title = rec.decodeClamped + ' value(s) in the link were outside the parameter\'s declared range and ' +
          'have been clamped to it. The sender either hand-edited the link or is on a version of the tool with ' +
          'different limits, so this column is not exactly the system they saved.';
        stTd.appendChild(dc);
      } else if (rec.decodePartial) {
        var dp = UI.elt('span', 'badge warn', rec.decodePartial + ' unreadable');
        dp.title = rec.decodePartial + ' parameter value(s) in the link were not recognised and are at your ' +
          'defaults instead — most likely parameters this version of the tool does not have.';
        stTd.appendChild(dp);
      }
      if (e.filled.length) {
        var sb = UI.elt('span', 'badge warn', e.filled.length + ' filled');
        sb.title = 'Saved before these parameters existed, so they take today\'s defaults:\n' +
          e.filled.map(function (k) { var p = paramByKey(k); return (p ? p.label : k) + ' = ' + DEFAULTS[k]; }).join('\n');
        stTd.appendChild(sb);
      }
      /* Consistency warnings are computed for every system and were being
         thrown away. That mattered: a system whose tap count exceeds the
         die inventory reports inflated power, area and BOM, and the banner
         that would have said so on the map view is hidden here. */
      var fails = e.warnings.filter(function (w) { return w.severity === 'fail'; });
      var warns = e.warnings.filter(function (w) { return w.severity === 'warn'; });
      if (fails.length) {
        var fb = UI.elt('span', 'badge fail', fails.length === 1 ? 'inconsistent' : fails.length + ' failures');
        fb.title = fails.map(function (w) { return w.message; }).join('\n\n');
        stTd.appendChild(fb);
      }
      if (warns.length) {
        var wb = UI.elt('span', 'badge warn', warns.length + ' warning' + (warns.length === 1 ? '' : 's'));
        wb.title = warns.map(function (w) { return w.message; }).join('\n\n');
        stTd.appendChild(wb);
      }
      if (!isCur && !rec.shared && !e.filled.length && !fails.length && !warns.length) {
        stTd.appendChild(UI.elt('span', 'badge pass', 'saved'));
      }
      tr.appendChild(stTd);

      var actTd = UI.elt('td');
      actTd.style.whiteSpace = 'nowrap';
      function mk(label, title, fn, cls) {
        var b = document.createElement('button');
        b.className = 'btn' + (cls ? ' ' + cls : '');
        b.style.cssText = 'padding:2px 7px;margin-left:3px;font-size:11px';
        b.textContent = label; b.title = title;
        /* as with the Compare checkbox: acting on a row ends any rename in
           progress, including one whose input never got focus and so can
           never blur */
        b.addEventListener('click', function (ev) { view.sys.renaming = null; fn(ev); });
        actTd.appendChild(b);
        return b;
      }
      mk('Load', 'Replace the main window\'s parameters with this system', function () {
        state = {};
        Object.keys(e.state).forEach(function (k) { state[k] = e.state[k]; });
        syncHash();
        setView('map');
        X.flash('Loaded "' + rec.name + '"');
      });
      mk('Copy', 'Save another system with these parameters, to tweak', function () {
        /* rec.state, NOT e.state: the resolved state has today's defaults
           filled in for parameters that did not exist when the original was
           saved, and a copy must not silently claim an opinion the original
           never had */
        var r2 = SYS.save(rec.name + ' (copy)', rec.state, { note: rec.note });
        if (!r2.ok) { X.flash(r2.reason === 'full' ? 'At the ' + SYS.limit() + '-system limit' : 'Could not save'); return; }
        render();
      });
      if (!rec.shared) {
        mk('↑', 'Move left', function () { SYS.move(rec.id, -1); render(); });
        mk('↓', 'Move right', function () { SYS.move(rec.id, 1); render(); });
        if (view.sys.confirmDelete === rec.id) {
          mk('Delete?', 'Click again to delete', function () {
            SYS.remove(rec.id); view.sys.confirmDelete = null; render();
            X.flash('Deleted "' + rec.name + '"');
          }, 'pri');
        } else {
          mk('✕', 'Delete this system', function () { view.sys.confirmDelete = rec.id; render(); });
        }
      } else {
        mk('Import', 'Add this shared system to your own saved list', function () {
          var r2 = SYS.save(rec.name, e.state, { note: 'imported from a shared link' });
          if (!r2.ok) { X.flash(r2.reason === 'full' ? 'At the ' + SYS.limit() + '-system limit' : 'Could not save'); return; }
          view.sys.shared = (view.sys.shared || []).filter(function (s) { return s.id !== rec.id; });
          render();
        });
        mk('✕', 'Dismiss', function () {
          view.sys.shared = (view.sys.shared || []).filter(function (s) { return s.id !== rec.id; });
          render();
        });
      }
      tr.appendChild(actTd);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    mount.appendChild(t);
  }

  function paramByKey(k) {
    for (var i = 0; i < M.PARAMS.length; i++) if (M.PARAMS[i].key === k) return M.PARAMS[i];
    return null;
  }

  /* UI.renderTable builds thead/tbody straight into the element it is given,
     so it needs a real <table>. The other views hand it one from the HTML;
     these panels own scrolling wrappers instead, so the table is created
     here — appending a <thead> to a <div> renders nothing at all, silently. */
  function tableIn(mountId) {
    var mount = document.getElementById(mountId);
    mount.textContent = '';
    var t = document.createElement('table');
    t.className = 'grid sticky1';
    mount.appendChild(t);
    return t;
  }

  function setPermalink() {
    var o = overrides();
    o._v = 'systems';
    var enc = SYS.encodeSet(SYS.list(), DEFAULTS);
    if (enc) o._sys = enc;
    return X.permalink(o);
  }

  /* ---------------------------------------------------------------------
     the differing-inputs panel
     ------------------------------------------------------------------- */
  function renderSysParams(entries) {
    var mount = document.getElementById('sysParamMount');
    mount.textContent = '';
    var keys = SYS.differingKeys(entries.map(function (e) { return e.state; }));
    /* order them the way the parameter panel does, so the table reads like
       the control it mirrors */
    var ordered = M.PARAMS.filter(function (p) { return keys.indexOf(p.key) >= 0; });

    document.getElementById('sysParamHdr').textContent = ordered.length
      ? ordered.length + ' of ' + M.PARAMS.length + ' parameters differ'
      : 'every parameter identical across these systems';

    if (!ordered.length) {
      mount.innerHTML = '<p class="note" style="padding:10px 12px">These systems have identical parameters. ' +
        'Any difference in the results table above would be a bug — there is nothing here to explain it.</p>';
      document.getElementById('sysParamHdr').textContent = 'no differences';
      return;
    }

    var t = document.createElement('table');
    t.className = 'grid sticky1';
    var thead = document.createElement('thead'), htr = document.createElement('tr');
    htr.appendChild(UI.elt('th', null, 'Parameter'));
    entries.forEach(function (e) { htr.appendChild(UI.elt('th', null, e.rec.name)); });
    htr.appendChild(UI.elt('th', null, 'Today’s default'));
    thead.appendChild(htr); t.appendChild(thead);

    var tb = document.createElement('tbody');
    var lastGroup = null;
    ordered.forEach(function (p) {
      if (p.group !== lastGroup) {
        lastGroup = p.group;
        var str2 = document.createElement('tr');
        str2.className = 'sect';
        var td = UI.elt('td', null, p.group);
        td.colSpan = entries.length + 2;
        str2.appendChild(td);
        tb.appendChild(str2);
      }
      var tr = document.createElement('tr');
      var nameTd = UI.elt('td', 'mn');
      nameTd.appendChild(document.createTextNode(p.label + (p.units ? ' (' + p.units + ')' : '')));
      nameTd.appendChild(UI.elt('small', null, p.key));
      nameTd.title = p.why || '';
      tr.appendChild(nameTd);

      var vals = entries.map(function (e) { return e.state[p.key]; });
      var finite = vals.filter(function (v) { return isFinite(v); });
      var vlo = finite.length ? Math.min.apply(null, finite) : NaN;
      var vhi = finite.length ? Math.max.apply(null, finite) : NaN;

      entries.forEach(function (e, i) {
        var v = vals[i];
        var txt = choiceLabel(p, v);
        var td = UI.elt('td', 'v' + (v !== DEFAULTS[p.key] ? ' warn' : ''), txt);
        if (isFinite(v) && vhi !== vlo) {
          td.title = (v === vhi ? 'highest' : v === vlo ? 'lowest' : '') +
            ' · default ' + choiceLabel(p, DEFAULTS[p.key]);
        }
        tr.appendChild(td);
      });
      tr.appendChild(UI.elt('td', 'v', choiceLabel(p, DEFAULTS[p.key])));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    mount.appendChild(t);
  }

  function choiceLabel(p, v) {
    if (p.choices) {
      for (var i = 0; i < p.choices.length; i++) {
        if (Math.abs(p.choices[i].value - v) < 1e-9) return p.choices[i].label;
      }
    }
    return UI.num(v, undefined);
  }

  /* ---------------------------------------------------------------------
     head-to-head charts
     ------------------------------------------------------------------- */
  var SYS_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s4)', 'var(--s3)', 'var(--s5)',
    'var(--accent)', 'var(--pass)', 'var(--warn)'];

  function renderSysCharts(entries, flats) {
    var mount = document.getElementById('sysChartsMount');
    mount.textContent = '';
    if (entries.length < 2) {
      mount.innerHTML = '<p class="note">Save a second system to see the head-to-head bars.</p>';
      return;
    }
    /* zeroBase:false on every decibel chart. A dB or dBi value is already a
       ratio to somewhere else, so anchoring the axis at zero compresses the
       0.5 dB that decides the architecture into a single pixel, and a
       negative reference line falls off the axis entirely. */
    var specs = [
      { title: 'Inter-tile residual phase error', field: 'lo_interTileResidualDeg', unit: '°', spec: 'req_sigSpecDeg', dec: 2 },
      { title: 'Margin to each system’s own requirement', field: 'margin_sigDeg', unit: '°', dec: 2, zeroBase: true },
      { title: 'Distribution power, LO + baseband', field: 'tot_powerW', unit: 'W', dec: 2 },
      { title: 'Null-depth floor from the LO residual', field: 'lo_sllDb', unit: 'dB', dec: 1, spec: 'req_nullFloorDb', zeroBase: false },
      { title: 'Realised gain at the steer angle', field: 'bm_realisedDbi', unit: 'dBi', dec: 2, zeroBase: false },
      { title: 'Worst grating lobe vs the intended beam', field: 'bm_gratingDb', unit: 'dB', dec: 2, zeroBase: false },
      { title: 'Array-output EVM', field: 'lo_evmDb', unit: 'dB', dec: 1, spec: 'req_evmLimitDb', zeroBase: false }
    ];
    specs.forEach(function (s) {
      var bars = entries.map(function (e, i) {
        return {
          name: e.rec.name, value: flats[i][s.field], color: SYS_COLORS[i % SYS_COLORS.length],
          label: UI.num(flats[i][s.field], s.dec) + ' ' + s.unit
        };
      }).filter(function (b) { return isFinite(b.value); });
      if (!bars.length) return;
      /* the spec differs per system, so the reference line is the STRICTEST
         one and the caption says whose it is */
      var hLine, hLabel;
      if (s.spec) {
        var svAll = flats.map(function (f) { return f[s.spec]; });
        var sv = svAll.filter(isFinite);
        if (sv.length) {
          /* "better: low" metrics take the strictest (smallest) spec;
             the dB metrics here are all "smaller is better" too, so the
             strictest is the minimum in every case. When the specs differ
             the label says whose it is, because a single line across bars
             judged by different thresholds is otherwise a lie. */
          hLine = Math.min.apply(null, sv);
          var spread = Math.max.apply(null, sv) - hLine;
          var owner = entries[svAll.indexOf(hLine)];
          hLabel = (spread > 1e-9 ? 'strictest spec' : 'spec') +
            (spread > 1e-9 && owner ? ' (' + owner.rec.name + ')' : '');
        }
      }
      var sec = document.createElement('section');
      sec.className = 'panel';
      var h = document.createElement('h2');
      h.textContent = s.title;
      sec.appendChild(h);
      var box = document.createElement('div');
      box.className = 'chartbox';
      box.appendChild(C.barChart({
        bars: bars, xLabel: s.unit, hLine: hLine, hLabel: hLabel,
        zeroBase: s.zeroBase === false ? false : undefined
      }));
      sec.appendChild(box);
      mount.appendChild(sec);
    });
  }

  /* ---------------------------------------------------------------------
     the view
     ------------------------------------------------------------------- */
  /* every render starts from a hidden kind-note, so no path can leave a
     caveat about columns that no longer exist sitting above an empty table */
  function hideKindNote() {
    var el = document.getElementById('sysKindNote');
    var wrap = document.getElementById('sysKindWrap');
    if (el) { el.classList.add('hidden'); el.textContent = ''; }
    if (wrap) wrap.classList.add('hidden');
  }

  function renderSystems() {
    hideKindNote();
    var recs = sysAll();
    /* Evaluated once, then split: the roster lists every system, the tables
       and charts use only the ones ticked for comparison. Saving a system
       and comparing it are different acts — at eight columns the table
       stops being readable, and the usual move is to keep a library and
       look at three of them at a time. */
    var ex = view.sys.excluded || {};
    var allEntries = recs.map(function (r) { return sysEntry(r, { rosterOnly: !!ex[r.id] }); });
    var entries = allEntries.filter(function (e) { return !ex[e.rec.id]; });
    /* A comparison cannot be empty, so unticking everything falls back to
       showing everything — but that has to be SAID. Counting the exclusions
       after the fallback made the count zero by construction, so the roster
       showed every box unticked while the tables compared every column and
       the header mentioned neither. */
    var allExcluded = allEntries.length > 0 && entries.length === 0;
    var nOff = allEntries.length - entries.length;
    if (allExcluded) {
      /* the fallback shows everything, so everything now needs the full
         evaluation the roster-only path skipped */
      allEntries = recs.map(function (r) { return sysEntry(r); });
      entries = allEntries;
    }
    var flats = entries.map(function (e) { return e.flat; });

    var nSaved = SYS.list().length;
    var nSharedAll = (view.sys.shared || []).length;
    /* the roster can only hold MAX columns, so shared systems past the cap
       are not shown — and must not be counted as if they were */
    var nShared = recs.filter(function (r) { return r.shared; }).length;
    var nSharedHidden = nSharedAll - nShared;
    document.getElementById('sysHdr').textContent =
      nSaved + ' saved' + (nShared ? ' · ' + nShared + ' from a shared link' : '') +
      (nSharedHidden ? ' · ' + nSharedHidden + ' from the link not shown (at the limit)' : '') +
      (allExcluded
        ? ' · every system unticked — showing all ' + allEntries.length + ', a comparison cannot be empty'
        : (nOff ? ' · ' + nOff + ' excluded from the comparison' : '')) +
      ' · limit ' + SYS.limit();
    var navc = document.getElementById('navSysCount');
    if (navc) navc.textContent = nSaved ? ' (' + nSaved + ')' : '';

    /* ---- roster toolbar ---- */
    var tb = document.getElementById('sysToolbar');
    tb.textContent = '';
    function tbtn(label, title, fn, cls) {
      var b = document.createElement('button');
      b.className = 'btn' + (cls ? ' ' + cls : '');
      b.textContent = label; b.title = title;
      b.addEventListener('click', fn);
      tb.appendChild(b);
      return b;
    }
    tbtn('Save current parameters', 'Snapshot the main window\'s parameter set as a new system', function () {
      saveCurrentSystem();
    }, 'pri');
    tbtn('Copy link to this set', 'A permalink that carries every saved system', function () {
      X.copy(setPermalink(), 'Comparison-set link');
    });
    /* The curated shortlist. It lives in Systems rather than in the Chooser
       because the Chooser cannot vary a parameter — only the three option
       axes — so a comparison across RF BANDWIDTH is not expressible there.
       Each entry is a sparse override on today's defaults, so the set tracks
       the model as the model improves; once loaded, each becomes an ordinary
       saved system holding its own full state. */
    if (window.Shortlist) {
      var nSl = window.Shortlist.count();
      if (view.sys.confirmShortlist) {
        tbtn('Replace all ' + nSaved + ' with the shortlist?',
          'Click again to delete every saved system and load the ' + nSl + ' curated ones',
          function () { loadShortlist(); }, 'pri');
      } else {
        tbtn('Load the realistic shortlist (' + nSl + ')',
          nSl + ' curated architectures spanning the LO, baseband, antenna and RF-bandwidth axes, ' +
          'each chosen to demonstrate something no other one does',
          function () { loadShortlist(); });
      }
    }
    if (nSaved) {
      if (view.sys.confirmClear) {
        tbtn('Delete all ' + nSaved + '?', 'Click again to delete every saved system', function () {
          SYS.clear(); view.sys.confirmClear = false; render(); X.flash('All saved systems deleted');
        }, 'pri');
      } else {
        tbtn('Clear all', 'Delete every saved system', function () { view.sys.confirmClear = true; render(); });
      }
    }

    if (!recs.length) {
      document.getElementById('sysRosterMount').innerHTML =
        '<p class="note" style="padding:12px">Nothing saved yet. Set the parameters up in the main window, ' +
        'name the configuration in the box under the parameter list, and press <strong>Save system</strong>. ' +
        'Do that two or more times and this page compares them column by column — same numbers, same model, ' +
        'one evaluation path.</p>';
      ['sysReqMount', 'sysMetricMount', 'sysParamMount'].forEach(function (id) {
        document.getElementById(id).textContent = '';
      });
      document.getElementById('sysChartsMount').textContent = '';
      ['sysReqHdr', 'sysResultsHdr', 'sysParamHdr'].forEach(function (id) {
        document.getElementById(id).textContent = '';
      });
      document.getElementById('sysReqNote').textContent = '';
      document.getElementById('sysNote').innerHTML = storageNote();
      document.getElementById('sysResultsToolbar').textContent = '';
      return;
    }

    renderSysRoster(allEntries);
    document.getElementById('sysNote').innerHTML = storageNote() +
      ' A saved system stores its <strong>whole</strong> parameter set, not the difference from the defaults, ' +
      'so it keeps the numbers it was costed with even if a default changes later. Parameters added to the tool ' +
      'after a system was saved are filled from today\'s defaults and flagged, because the system never expressed ' +
      'an opinion about them.' +
      (nSharedHidden
        ? ' <strong>' + nSharedHidden + ' system' + (nSharedHidden === 1 ? '' : 's') + ' in that link ' +
          (nSharedHidden === 1 ? 'is' : 'are') + ' not shown</strong> because the roster is at its ' +
          SYS.limit() + '-column limit — delete or export a saved system to make room for ' +
          (nSharedHidden === 1 ? 'it' : 'them') + '.'
        : '') +
      (nShared
        ? ' <strong>The ' + nShared + ' system' + (nShared === 1 ? '' : 's') + ' marked “from link” ' +
          (nShared === 1 ? 'is' : 'are') + ' not stored</strong> until you press Import, so a link cannot ' +
          'overwrite what you saved. A link carries each system as a difference from the defaults, which keeps ' +
          'it short but means a shared system is pinned to <em>your</em> defaults rather than the sender\'s — ' +
          'if the two of you are on different versions of the tool, the numbers can differ from what they saw.'
        : '');

    /* ---- options + results for the shared table renderer ---- */
    /* Parameters that change what KIND of system this is, rather than how
       well it performs. When these differ between columns, whole blocks of
       the table stop being a comparison of distribution architectures and
       become a comparison of two different arrays — so the column says so
       instead of the reader having to notice. */
    var KIND_KEYS = ['fLoGHz', 'rfBwGHz', 'apertureCm', 'latticePeriodic', 'elemModelSel',
      'elemDirDbi', 'inTileLattice', 'beamScanDeg', 'scanDegMax'];
    var kindVary = KIND_KEYS.filter(function (k) {
      var first = entries.length ? entries[0].state[k] : undefined;
      return entries.some(function (e) { return e.state[k] !== first; });
    });

    var curKey = SYS.stateKey(state);
    var opts = entries.map(function (e, i) {
      var isCur = SYS.stateKey(e.state) === curKey;
      var fails = e.warnings.filter(function (w) { return w.severity === 'fail'; }).length;
      var badge = null, badgeClass = 'acc';
      if (fails) { badge = 'inconsistent'; badgeClass = 'fail'; }
      else if (isCur) { badge = 'loaded in main window'; badgeClass = 'acc'; }
      else if (e.rec.shared) { badge = 'from link'; badgeClass = 'warn'; }
      else if (e.filled.length) { badge = e.filled.length + ' filled from defaults'; badgeClass = 'warn'; }
      var tips = [e.rec.note || ''];
      if (fails) {
        tips.push('INCONSISTENT: ' + e.warnings.filter(function (w) { return w.severity === 'fail'; })
          .map(function (w) { return w.message; }).join(' '));
      }
      if (e.rec.shared) tips.push('From a shared link: stored as a difference from defaults, so it is pinned to YOUR defaults, not the sender\'s.');
      if (kindVary.length) {
        tips.push('Differs from the other columns in: ' + kindVary.map(function (k) {
          var p = paramByKey(k);
          return (p ? p.label : k) + ' = ' + choiceLabel(p, e.state[k]);
        }).join(', '));
      }
      return {
        id: e.rec.id, name: e.rec.name,
        topology: tips.filter(Boolean).join('\n\n'),
        badge: badge, badgeClass: badgeClass
      };
    });
    var results = {};
    entries.forEach(function (e, i) { results[e.rec.id] = flats[i]; });

    /* ---- requirement panel ----
       "Identical" has to be judged over the WHOLE requirement, not over the
       binding spec alone. Two systems can share a 5.00° binding spec and
       still differ by 3 dB in the null depth that spec buys, because the
       floor is 10log10(sigma^2/N) and N is the tile count. Reporting them
       as "identical requirement" because one number matched would hide the
       exact trap this panel exists to expose. */
    var reqRows = sysReqRows();
    var reqDiff = reqRows.filter(function (r) {
      var vals = flats.map(function (f) { return f[r.field]; });
      var first = typeof vals[0] === 'number' ? vals[0].toPrecision(9) : String(vals[0]);
      return vals.some(function (v) {
        return (typeof v === 'number' ? v.toPrecision(9) : String(v)) !== first;
      });
    });
    var specs = flats.map(function (f) { return f.req_sigSpecDeg; });
    var sameSpec = specs.every(function (v) { return Math.abs(v - specs[0]) < 1e-6; });
    UI.renderTable(tableIn('sysReqMount'), opts, results, reqRows, null,
      { firstHeader: 'Derived requirement', lastHeader: 'Spread' });

    document.getElementById('sysReqHdr').textContent = !reqDiff.length
      ? 'identical across all ' + entries.length + ' systems'
      : reqDiff.length + ' of ' + reqRows.length + ' requirement quantities differ' +
        (sameSpec ? ' — though the binding spec is the same ' + n(specs[0], 2) + '°' : '');

    if (!reqDiff.length) {
      document.getElementById('sysReqNote').innerHTML =
        'Every system here is judged against the same requirement, so the pass/fail colouring in the results ' +
        'table below compares like with like.';
    } else {
      var diffNames = reqDiff.map(function (r) { return r.name; }).join(', ');
      document.getElementById('sysReqNote').innerHTML =
        '<strong>Read this before the results table.</strong> The requirement is <em>derived</em>, not fixed — it ' +
        'follows from the array geometry and the EVM allocation — and it is not the same for these systems: ' +
        '<span class="kv">' + diffNames + '</span> differ. ' +
        (sameSpec
          ? 'Note in particular that the <em>binding spec is identical</em> (' + n(specs[0], 2) + '°) while what ' +
            'that spec buys is not: the null-depth floor is 10log10(σ²/N), so the system with fewer tiles gets ' +
            '<span class="kv">' + n(Math.max.apply(null, flats.map(function (f) { return f.req_nullFloorDb; })) -
              Math.min.apply(null, flats.map(function (f) { return f.req_nullFloorDb; })), 1) +
            ' dB</span> less null depth for meeting the same phase-error number. Two systems can both go green ' +
            'and not be equally good.'
          : 'The binding spec itself runs from <span class="kv">' + n(Math.min.apply(null, specs), 2) +
            '°</span> to <span class="kv">' + n(Math.max.apply(null, specs), 2) + '°</span>, so a system can go ' +
            'green by having a laxer requirement rather than a better distribution network.') +
        ' Pass/fail in the results table is per column against that column’s <em>own</em> requirement, which is ' +
        'the honest comparison; a requirement column showing a range is marked <span class="kv">*</span>. ' +
        'Compare the raw numbers, not only the colours.';
    }

    /* ---- results panel ---- */
    var rt = document.getElementById('sysResultsToolbar');
    rt.textContent = '';
    function toggle(label, on, title, fn) {
      var b = document.createElement('button');
      b.className = 'btn' + (on ? ' pri' : '');
      b.textContent = label; b.title = title;
      b.addEventListener('click', fn);
      rt.appendChild(b);
    }
    toggle('Differences only', view.sys.diffOnly, 'Hide rows where every system agrees', function () {
      view.sys.diffOnly = !view.sys.diffOnly; render();
    });
    /* the toggle stays rendered while the flag is set even at one column, so
       a mode that cannot do anything can always be switched off */
    if (entries.length > 1 || view.sys.deltaMode) {
      toggle('Δ vs baseline', view.sys.deltaMode,
        entries.length > 1
          ? 'Show each value as a difference from the baseline system'
          : 'Δ mode needs at least two columns — tick another system, or click to turn it off',
        function () { view.sys.deltaMode = !view.sys.deltaMode; render(); });
    }
    if (entries.length > 1) {
      var sel = document.createElement('select');
      sel.style.cssText = 'font:12px var(--mono);padding:4px 6px;border:1px solid var(--rule-strong);border-radius:4px;background:var(--bg-panel);color:var(--ink)';
      sel.title = 'Which system the Δ column is measured from';
      entries.forEach(function (e) {
        var o = document.createElement('option');
        o.value = e.rec.id; o.textContent = 'baseline: ' + e.rec.name;
        sel.appendChild(o);
      });
      sel.value = view.sys.baseline && results[view.sys.baseline] ? view.sys.baseline : entries[0].rec.id;
      view.sys.baseline = sel.value;
      sel.addEventListener('change', function () { view.sys.baseline = sel.value; render(); });
      rt.appendChild(sel);
    }

    var rows = sysMetricRows();
    if (view.sys.diffOnly) rows = filterDifferingRows(rows, opts, results);
    /* Delta mode needs something to be different FROM, so it is inert with
       one column — and the toggle that would turn it off is not rendered
       there either. Deciding once, here, keeps the table, the header and
       the export footnote from disagreeing: they were each testing the raw
       flag, so unticking down to one column produced absolute values under
       a "Δ from X" header and a CSV footnoted as differences, with no
       control on screen to clear it. */
    var deltaOn = view.sys.deltaMode && entries.length > 1;
    view.sys.deltaActive = deltaOn;
    rows = deltaOn ? deltaRows(rows, results[view.sys.baseline]) : applyScales(rows);

    UI.renderTable(tableIn('sysMetricMount'), opts, results, rows, null,
      { firstHeader: 'Metric', lastHeader: 'Requirement' });
    document.getElementById('sysResultsHdr').textContent =
      (allExcluded ? 'all ' : '') +
      entries.length + ' system' + (entries.length === 1 ? '' : 's') + ' · ' +
      rows.filter(function (r) { return !r.section; }).length + ' metrics' +
      (view.sys.diffOnly ? ' (identical rows hidden)' : '') +
      (deltaOn ? ' · Δ from ' + (results[view.sys.baseline] ? optName(opts, view.sys.baseline) : '?') : '') +
      (view.sys.deltaMode && !deltaOn ? ' · Δ mode is on but needs two columns' : '');

    /* the kind-of-system warning, stated once above the table rather than
       left in tooltips */
    var kindEl = document.getElementById('sysKindNote');
    var kindWrap = document.getElementById('sysKindWrap');
    if (kindEl) {
      if (!kindVary.length) {
        hideKindNote();
      } else {
        kindEl.classList.remove('hidden');
        if (kindWrap) kindWrap.classList.remove('hidden');
        kindEl.innerHTML = '<strong>These are not all the same array.</strong> ' +
          kindVary.map(function (k) {
            var p = paramByKey(k);
            return '<span class="kv">' + (p ? p.label : k) + '</span>';
          }).join(', ') + ' differ between columns, so the rows below are not purely a comparison of ' +
          'distribution architectures — every gain, beamwidth, jitter and wrap-count figure also moves with ' +
          'the array itself. That is a legitimate thing to compare, but say which it is before quoting a row.';
      }
    }

    renderSysParams(entries);
    renderSysCharts(entries, flats);
  }

  function optName(opts, id) {
    for (var i = 0; i < opts.length; i++) if (opts[i].id === id) return opts[i].name;
    return id;
  }

  function storageNote() {
    return SYS.available()
      ? 'Saved systems live in this browser only — they are not uploaded anywhere, and they survive a reload. ' +
        'Use the set link to move them to another machine or into the thesis.'
      : '<strong>This browser is not letting the page store data</strong> (a private window, or an embedding ' +
        'context that blocks site data). Systems saved now will work for this session but will be gone on ' +
        'reload — copy the set link if you need to keep them.';
  }

  /* Rows on which at least two systems disagree, keeping the section
     headings that still have rows under them.

     A row is compared over EVERY field it displays, not just r.field. Rows
     whose fmt prints a second value — the lattice label next to the pitch,
     the lobe angle next to its level, the wraps next to the correction
     range — would otherwise be hidden as "identical" while showing visibly
     different text. The rectangular-vs-sheared lattice is exactly that
     case: the pitch is identical by construction and only the label
     differs, so the row that proves the lattices differ was the one being
     hidden. */
  function filterDifferingRows(rows, opts, results) {
    /* Compare what the cell will actually SAY, not the underlying float.
       Comparing raw values to nine significant figures kept rows that read
       "0.804 | 0.804 | 0.804" because they differed in the seventh decimal
       — "differences only" has to mean differences you can see. Rendering
       the cell also compares every field the row displays, which is what
       made the lattice-label row visible again. */
    function cellText(r, res) {
      var v = res[r.field];
      var num = (typeof v === 'number' && isFinite(v)) ? v : NaN;
      if (r.fmt) return String(r.fmt(num, res));
      var scaled = isFinite(num) && isFinite(r.scale) ? num * r.scale : num;
      return UI.num(scaled, r.dec);
    }
    var keep = rows.map(function (r) {
      if (r.section) return false;
      var first = null, seen = false, diff = false;
      opts.forEach(function (o) {
        var res = results[o.id] || {};
        var s = cellText(r, res);
        (r.alsoFields || []).forEach(function (fld) { s += '' + String(res[fld]); });
        if (!seen) { first = s; seen = true; return; }
        if (s !== first) diff = true;
      });
      return diff;
    });
    var out = [];
    rows.forEach(function (r, i) {
      if (r.section) {
        /* include the heading only if something under it survives */
        for (var j = i + 1; j < rows.length && !rows[j].section; j++) {
          if (keep[j]) { out.push(r); break; }
        }
      } else if (keep[i]) out.push(r);
    });
    return out;
  }

  /* Wrap every numeric row so it prints the signed difference from the
     baseline system.

     Two traps here, both of which produced wrong numbers on the first cut.
     (1) A row that converted units inside its own fmt — power held in mW
     under a header saying W — printed the raw difference, i.e. milliwatts
     labelled as watts, a live factor-1000 error. Unit conversion is now a
     declared `scale` on the row so both paths apply it. (2) Rows whose fmt
     prints something a difference cannot express (a lattice label, "7×7 =
     49") declare noDelta and stay absolute. Text rows are left alone
     regardless — a delta of "H-tree" is not a thing. */
  function deltaRows(rows, baseFlat) {
    if (!baseFlat) return rows;
    return rows.map(function (r) {
      if (r.section || r.noDelta) return r;
      var bv = baseFlat[r.field];
      if (typeof bv !== 'number' || !isFinite(bv)) return r;
      var sc = isFinite(r.scale) ? r.scale : 1;
      var out = {};
      Object.keys(r).forEach(function (k) { out[k] = r[k]; });
      out.fmt = function (v) {
        if (typeof v !== 'number' || !isFinite(v)) return '—';
        var d = (v - bv) * sc;
        if (Math.abs(d) < 1e-12) return '=';
        return (d > 0 ? '+' : '') + UI.num(d, r.dec);
      };
      out.specField = undefined;
      out.spec = undefined;
      out.specLabel = 'Δ';
      return out;
    });
  }

  /* A declared `scale` also has to apply when NOT in delta mode, or the
     column would show millwatts under a "W" header — the same defect the
     other way round. Applied once, here, so the two paths cannot diverge. */
  function applyScales(rows) {
    return rows.map(function (r) {
      if (r.section || !isFinite(r.scale) || r.fmt) return r;
      var out = {};
      Object.keys(r).forEach(function (k) { out[k] = r[k]; });
      out.fmt = function (v) {
        return (typeof v === 'number' && isFinite(v)) ? UI.num(v * r.scale, r.dec) : '—';
      };
      /* the spec is left alone: renderTable now applies r.scale to the
         value before testing it, so scaling here as well would double it */
      return out;
    });
  }

  function saveCurrentSystem() {
    var box = document.getElementById('saveName');
    var g = last ? last.res.g : null;
    /* resolved defensively rather than indexed blind: the model falls back
       for an out-of-range option index, so a save must not be the one place
       that throws instead */
    var lm = M.LO_META[Math.round(state.loOption)] || M.LO_META[M.LO_META.length - 1];
    var bm = M.BB_META[Math.round(state.bbOption)] || M.BB_META[M.BB_META.length - 1];
    var auto = g
      ? (lm.short + ' + ' + bm.short + ' · ' + n(state.tileCm, 2) + ' cm')
      : 'System ' + (SYS.count() + 1);
    var name = (box && box.value.trim()) || auto;
    var r = SYS.save(name, state, { lo: lm.id, bb: bm.id });
    if (!r.ok) {
      X.flash(r.reason === 'full'
        ? 'At the ' + SYS.limit() + '-system limit — delete one first'
        : 'Could not save this system');
      return;
    }
    if (box) box.value = '';
    render();
    X.flash(r.persisted ? 'Saved "' + name + '"' : 'Saved "' + name + '" (this session only — storage blocked)');
  }

  /* Load the curated shortlist as saved systems.

     It REPLACES rather than appends, and says so, because appending nine
     systems onto an existing roster silently blows the 12-system limit and
     leaves the reader with a truncated comparison that looks complete. The
     confirm step is the same two-press idiom "Clear all" already uses.

     Each entry's sparse override is applied over TODAY'S DEFAULTS and then
     through clampParam, so an entry that has drifted out of a parameter's
     legal range is snapped and the snap is reported — never silently
     accepted. The option indices themselves are resolved by name inside
     shortlist.js, which throws rather than remapping if an option table has
     been reordered. */
  function loadShortlist() {
    if (!window.Shortlist) return;
    var items;
    try { items = window.Shortlist.list(); }
    catch (e) { X.flash('Shortlist could not be built: ' + e.message); return; }

    if (SYS.count() && !view.sys.confirmShortlist) {
      view.sys.confirmShortlist = true;
      render();
      return;
    }
    view.sys.confirmShortlist = false;

    SYS.clear();
    var clampedAny = [];
    items.forEach(function (it) {
      var st = {};
      Object.keys(DEFAULTS).forEach(function (k) { st[k] = DEFAULTS[k]; });
      Object.keys(it.over).forEach(function (k) {
        if (!(k in DEFAULTS)) {
          clampedAny.push(it.id + ': unknown parameter "' + k + '"');
          return;
        }
        var v = clampParam(k, it.over[k]);
        if (v !== it.over[k]) clampedAny.push(it.id + ': ' + k + ' ' + it.over[k] + ' → ' + v);
        st[k] = v;
      });
      var lm = M.LO_META[Math.round(st.loOption)] || {};
      var bm = M.BB_META[Math.round(st.bbOption)] || {};
      SYS.save(it.name, st, { lo: lm.id || '', bb: bm.id || '', note: it.demonstrates });
    });
    render();
    X.flash(clampedAny.length
      ? 'Loaded ' + items.length + ' systems, ' + clampedAny.length + ' value(s) clamped: ' + clampedAny[0]
      : 'Loaded the ' + items.length + '-system shortlist');
  }

  /* ------------------------------- routing ------------------------------- */
  function setView(name) {
    view.name = name;
    /* drives the per-view panel ordering in the stylesheet */
    document.body.setAttribute('data-view', name);
    document.querySelectorAll('.navlink').forEach(function (a) {
      var on = a.getAttribute('data-view') === name;
      a.classList.toggle('on', on);
      /* the class is decoration; aria-current is what tells a screen reader
         which of nine tabs is the one being shown */
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('hidden', v.id !== 'view-' + name);
    });
    /* The case selector is now inside the map panel, so there is no separate
       picker panel to show or hide. The budget banner still does not belong
       on every view: on Systems a single banner would be actively wrong,
       because each system has its own derived requirement and that comparison
       has its own panel inside the view. */
    document.getElementById('budgetPanel').classList.toggle('hidden',
      name === 'assumptions' || name === 'method' || name === 'systems');
    /* clear the two-step confirmations when leaving, so returning to the
       view never finds a primed Delete button */
    if (name !== 'systems') {
      view.sys.confirmDelete = null;
      view.sys.confirmClear = false;
      view.sys.confirmShortlist = false;
      view.sys.renaming = null;
    }
    render();
  }

  /* ------------------------------- exports ------------------------------- */
  function tableRows(id) { return UI.tableToRows(document.getElementById(id)); }

  var EXPORTS = {
    lo:     { id: 'loTable',    title: 'LO / reference distribution comparison', file: 'lo-distribution.csv' },
    bb:     { id: 'bbTable',    title: 'Baseband split / combine comparison',    file: 'bb-distribution.csv' },
    /* the slug must contain no hyphen: parseSpec splits on the LAST one */
    ant:    { id: 'antTable',   title: 'Antenna arrangement comparison',         file: 'antenna-arrangement.csv' },
    assume: { id: 'assumeTable', title: 'Parameter provenance',                  file: 'assumptions.csv' },
    bom:    { id: 'bomMount',   title: 'Hardware bill of materials',             file: 'bom.csv' },
    sys:      { id: 'sysMetricMount', title: 'Saved systems — results',          file: 'systems-results.csv' },
    sysparam: { id: 'sysParamMount',  title: 'Saved systems — differing inputs', file: 'systems-inputs.csv' },
    sysreq:   { id: 'sysReqMount',    title: 'Saved systems — derived requirement', file: 'systems-requirement.csv' },
    link:     { id: 'linkTable',      title: 'Radio link budget',                   file: 'link-budget.csv' },
    chooser:  { id: 'chooserTable',   title: 'Constraint search — survivors',       file: 'chooser-survivors.csv' }
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
    /* A systems export spans several configurations, so quoting the CURRENT
       parameter set as "the configuration" would be actively misleading —
       the permalink of the whole set goes in instead. */
    var isSys = kind.indexOf('sys') === 0;
    var foot = ['Generated by the E-band distribution comparison tool.'];
    if (isSys) {
      /* The export scrapes the rendered table, so it inherits whatever
         display mode is on. A Δ-mode table exported without saying so is a
         table of differences under absolute-value headers — the footnote
         has to record the mode, and it lists the columns actually rendered
         rather than the saved list, which can differ when a shared link
         contributed columns. */
      /* the same badge-stripping the table export uses — otherwise the
         footnote reads "A4 mid+x4 4cmloaded in main window" */
      var cols = [].map.call(
        document.querySelectorAll('#' + m.id + ' table thead th'),
        function (th) { return UI.cellExportText(th); }).slice(1, -1);
      foot.push('Systems compared: ' + (cols.join(' | ') || '(none)'));
      var offNames = (function () {
        var exl = view.sys.excluded || {}, names = [];
        window.Systems.list().forEach(function (r) { if (exl[r.id]) names.push(r.name); });
        return names;
      })();
      if (offNames.length) {
        foot.push('EXCLUDED from this comparison: ' + offNames.join(' | '));
      }
      if (kind === 'sys' && view.sys.deltaActive) {
        foot.push('DISPLAY MODE: differences from the baseline system, not absolute values.');
      }
      if (kind === 'sys' && view.sys.diffOnly) {
        foot.push('DISPLAY MODE: rows identical across all systems are omitted.');
      }
      foot.push('Each system is judged against its OWN derived requirement; see the requirement panel.');
      foot.push('Set permalink: ' + setPermalink());
    } else {
      foot.push('Configuration: ' + (X.encodeState(overrides()) || 'all defaults'));
    }
    foot.push('Architecture-selection estimates, not measured data — see the honesty ledger.');
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
    /* syncHash so the address bar always names the view you are looking at —
       otherwise a link copied from Phase noise reopens on the Hardware map. */
    if (a) { e.preventDefault(); setView(a.getAttribute('data-view')); syncHash(); return; }
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
  document.getElementById('saveSysBtn').addEventListener('click', function () { saveCurrentSystem(); });
  document.getElementById('saveName').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); saveCurrentSystem(); }
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
  (function () {
    var b = document.getElementById('cmpKeyToggle');
    if (b) b.addEventListener('click', function () {
      view.compareKeyOnly = view.compareKeyOnly === false;
      render();
    });
  })();

  /* The chooser's search. Explicit, because it is ~3 s: 300 combinations,
     each with its own beam evaluation. The status line says what it is
     doing and then what it did, rather than the page appearing to hang. */
  (function () {
    var b = document.getElementById('chooserRun');
    if (!b) return;
    b.addEventListener('click', function () {
      var st = document.getElementById('chooserStatus');
      b.disabled = true;
      var nSp = spaceSize();
      st.textContent = 'searching ' + (nSp === null ? 'the space' : nSp + ' combinations') + '…';
      /* yield a frame so the status actually paints before the block */
      setTimeout(function () {
        var t0 = performance.now();
        try {
          var res = M.evaluate(state);
          var budget = window.Budget.derive(res.g);
          var QAM_ORDERS = [0, 4, 16, 64, 256];
          var QAM_NAMES = ['', 'QPSK', '16QAM', '64QAM', '256QAM'];
          var RISKS = ['low', 'medium', 'high'];
          var OBJ_KEYS = ['rate', 'headroom', 'power', 'residual', 'repeaters', 'radiators'];
          var qi = Math.round(state.cnMinQamSel);
          chooserResult = M.search(state, {
            objective: OBJ_KEYS[Math.round(state.cnObjectiveSel)] || 'margin',
            rangeKm: res.g.linkRangeKm, rainRateMmH: res.g.rainRateMmH,
            minQamOrder: QAM_ORDERS[qi], minQamName: QAM_NAMES[qi],
            maxResidualDeg: state.cnMaxResidualDeg,
            maxPowerPct: state.cnMaxPowerPct >= 100 ? Infinity : state.cnMaxPowerPct,
            minScanConeDeg: state.cnMinScanDeg,
            minBwGHz: state.cnMinBwGHz,
            maxRisk: RISKS[Math.round(state.cnMaxRiskSel)],
            requireFeasible: true,
            tieEps: undefined
          }, budget);
          var ms = Math.round(performance.now() - t0);
          st.textContent = chooserResult.total + ' combinations in ' + ms + ' ms · ' +
            chooserResult.survivors.length + ' survived' +
            (chooserResult.tied.length > 1 ? ', top ' + chooserResult.tied.length + ' tied' : '');
        } catch (e) {
          chooserResult = null;
          st.textContent = 'search failed: ' + (e && e.message ? e.message : String(e));
        }
        b.disabled = false;
        render();
      }, 30);
    });
  })();

  /* Parameter filter. Kept in `view`, not in `state`, so it never reaches the
     permalink or a saved system — it is how you are looking, not what you
     are modelling. */
  (function () {
    var box = document.getElementById('paramFilter');
    if (box) box.addEventListener('input', function () {
      view.paramFilter = box.value;
      render();
    });
    function chip(id, key) {
      var b = document.getElementById(id);
      if (!b) return;
      b.addEventListener('click', function () {
        view[key] = !view[key];
        b.setAttribute('aria-pressed', view[key] ? 'true' : 'false');
        render();
      });
    }
    chip('chipHot', 'paramHot');
    chip('chipChanged', 'paramChanged');
  })();

  /* Context-bar chips. The two selection chips take you to the picker — which
     lives on the Hardware map, so they switch view first when you are
     elsewhere; the verdict chip opens the rationale. */
  function goToPicker() {
    if (view.name !== 'map') { setView('map'); render(); syncHash(); }
    var p = document.getElementById('pickerMount');
    if (p && p.closest) p = p.closest('.panel') || p;
    if (p) p.scrollIntoView({ block: 'start' });
  }
  ['ctxLo', 'ctxBb', 'ctxWarn'].forEach(function (id) {
    var el2 = document.getElementById(id);
    if (el2) el2.addEventListener('click', function (e) { e.preventDefault(); goToPicker(); });
  });
  (function () {
    var v = document.getElementById('ctxVerdict');
    if (v) v.addEventListener('click', function (e) {
      e.preventDefault(); setView('decision'); render(); syncHash();
      window.scrollTo(0, 0);
    });
  })();

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
