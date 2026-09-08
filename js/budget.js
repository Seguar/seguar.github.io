/* ============================================================================
   budget.js — derives the REQUIREMENT the options are judged against.

   There are two separate budgets and conflating them is the classic error:

     COHERENCE budget — on the inter-tile DIFFERENTIAL phase error. Sets the
       scattered-sidelobe / null-depth floor at 10log10(sigma^2/N) and hence
       the achievable spatial-multiplexing SINR. Ruze gain loss is in here
       too but is a red herring: 4.2 deg RMS costs 0.023 dB.

     EVM budget — on the ARRAY-OUTPUT ABSOLUTE phase noise, integrated from
       the carrier-recovery loop bandwidth up. Uncorrelated per-tile noise
       averages down by N here, so this budget and the coherence budget can
       point in opposite directions.

   Exposes window.Budget.
   ========================================================================= */
(function () {
  'use strict';
  var K = window.K;

  function derive(g, qamTargetName) {
    /* Beam metrics use the POPULATED aperture (whole tiles), not the
       requested figure — see Model.resolve(). */
    var apM = g.effApertureM || g.apertureM;
    var nT = g.nTilesTotal || Math.pow(Math.max(1, Math.floor(g.apertureCm / g.tileCm + 1e-9)), 2);
    var hpbw = K.hpbwDeg(apM, g.lambdaM, 0);
    var hpbwScan = K.hpbwDeg(apM, g.lambdaM, g.scanDegMax);

    /* --- criterion 1: array gain loss (the loose one) --- */
    var sigFor01dB = Math.sqrt(Math.log(K.db2lin(0.1))) * K.DEG;

    /* --- criterion 2: scattered sidelobe / null-depth floor ---
       P_sl/P_pk = sigma^2 / N  ->  sigma = sqrt(N * 10^(target/10))        */
    function sigForNull(depthDb) { return Math.sqrt(nT * K.db2lin(depthDb)) * K.DEG; }
    var sigFor30 = sigForNull(-30);
    var sigFor40 = sigForNull(-40);

    /* --- criterion 3: pointing, at a tenth of the scanned beamwidth --- */
    var pointBudget = 0.1 * hpbwScan;

    /* --- criterion 4: EVM for the target modulation ---
       Expressed in dB, which is the composable form: EVM_dB is the impairment
       level relative to the constellation, so it lines up directly with the
       phase noise in dBc and with the 10log10(N) tile averaging. The
       equivalent phase error in degrees is kept as a secondary readout,
       because that is the figure an LO designer hands to a PLL simulation. */
    var qam = qamTargetName || '64QAM';
    var qamCeilDb = K.evmLimitDbForQam(qam, 1);            /* total-system ceiling */
    var evmLimitDb = K.evmLimitDbForQam(qam, g.evmShare);  /* LO's allocation */
    var evmLimit = K.evmPctFromDb(evmLimitDb);
    var sigForEvm = K.phiFromEvmDb(evmLimitDb) * K.DEG;

    /* --- criterion 5: the proposal's own stated spec (Eq. 16) --- */
    var sigProposal = g.specPhaseDeg;

    /* --- delay / squint requirements (a SEPARATE budget) --- */
    var tauRangePs = K.apertureDelayPs(apM, g.scanDegMax);
    var tauSubTilePs = K.apertureDelayPs(g.tileCm / 100, g.scanDegMax);
    var squintDeg = K.squintDeg(g.scanDegMax, g.rfBwGHz * 1e9, g.fLoHz);
    var ttdResidPs = K.quantResidualPs(g.ttdStepPs);
    var ttdLossDb = K.squintLossDb(ttdResidPs * 1e-12, g.rfBwGHz * 1e9);

    /* the coherence budget binds on the tightest of the differential
       criteria; EVM is reported separately because it applies to a
       different quantity */
    var coherenceCands = [
      { name: '0.1 dB array gain loss', v: sigFor01dB },
      { name: '−30 dB null floor', v: sigFor30 },
      { name: 'proposal Eq. 16', v: sigProposal }
    ];
    var binding = coherenceCands.reduce(function (a, b) { return b.v < a.v ? b : a; });

    var cells = [
      { k: 'Beamwidth (broadside)', n: hpbw.toFixed(2), unit: '°',
        d: g.apertureCm + ' cm aperture at ' + g.fLoGHz + ' GHz. At ' + g.scanDegMax + '° scan it widens to ' + hpbwScan.toFixed(2) + '°.' },
      { k: 'Inter-tile phase spec', n: binding.v.toFixed(2), unit: '° RMS', binding: true,
        d: 'Binding criterion: ' + binding.name + '. Applies to the DIFFERENTIAL error between tiles.' },
      { k: 'Null-depth floor at spec', n: K.rmsSllDb(binding.v / K.DEG, nT).toFixed(1), unit: 'dB',
        d: '10log10(σ²/N) with N = ' + nT + ' independent tiles. This, not gain loss, is what the architecture buys.' },
      { k: 'Array-output EVM budget', n: evmLimitDb.toFixed(2), unit: 'dB',
        d: qam + ' TOTAL ceiling ' + qamCeilDb.toFixed(2) + ' dB (' + K.evmPctFromDb(qamCeilDb).toPrecision(2) +
           '%), with 20log10(' + g.evmShare.toFixed(2) + ') = ' + K.shareDb(g.evmShare).toFixed(2) +
           ' dB allocated to the LO → ' + evmLimit.toPrecision(2) + '%. Applies to ABSOLUTE array-output noise, ' +
           'integrated from ' + g.carrierTrackMHz + ' MHz up. Equivalent to ' + sigForEvm.toFixed(2) + '° RMS of pure phase.' },
      { k: 'Skew equivalent of spec', n: (binding.v / K.degPerPs(g.fLoHz)).toFixed(2), unit: 'ps',
        d: 'At ' + g.fLoGHz + ' GHz, 1 ps = ' + K.degPerPs(g.fLoHz).toFixed(1) + '°. Skew is accumulated in time and converted once, here.' },
      { k: 'TTD range required', n: tauRangePs.toFixed(0), unit: 'ps',
        d: 'Full aperture at ' + g.scanDegMax + '°. RANGE binds, not resolution: a ' + g.ttdStepPs + ' ps step costs only ' + ttdLossDb.toFixed(3) + ' dB.' },
      { k: 'Sub-tile residual delay', n: tauSubTilePs.toFixed(0), unit: 'ps',
        d: g.tileCm + ' cm tile at ' + g.scanDegMax + '°. Squint over the band is ' + squintDeg.toFixed(2) + '° against a ' + hpbwScan.toFixed(2) + '° beam.' }
    ];

    var note = 'Two independent budgets. The <strong>inter-tile phase spec</strong> of ' +
      '<span class="kv">' + binding.v.toFixed(2) + '° RMS</span> applies to the <em>differential</em> error between ' +
      'tiles and is what sets the null-depth floor; it is set here by <em>' + binding.name + '</em>. The ' +
      '<strong>array-output EVM budget</strong> of <span class="kv">' + evmLimitDb.toFixed(2) + ' dB</span> applies to ' +
      'the <em>absolute</em> phase noise seen by the link after the coherent sum, where uncorrelated per-tile noise ' +
      'has already averaged down by 10log10(' + nT + ') = ' + (10 * Math.log10(nT)).toFixed(1) + ' dB. An architecture can ' +
      'pass one and fail the other, which is exactly what distinguishes the four LO options.';

    return {
      nTiles: nT, hpbw: hpbw, hpbwScan: hpbwScan,
      sigSpecDeg: binding.v, bindingName: binding.name,
      sigFor01dB: sigFor01dB, sigFor30: sigFor30, sigFor40: sigFor40,
      sigForEvmDeg: sigForEvm, evmLimitPct: evmLimit, evmLimitDb: evmLimitDb,
      qamCeilDb: qamCeilDb, shareDbVal: K.shareDb(g.evmShare), qam: qam,
      pointBudgetDeg: pointBudget,
      skewSpecPs: binding.v / K.degPerPs(g.fLoHz),
      tauRangePs: tauRangePs, tauSubTilePs: tauSubTilePs,
      squintDeg: squintDeg, ttdResidPs: ttdResidPs, ttdLossDb: ttdLossDb,
      nullFloorDb: K.rmsSllDb(binding.v / K.DEG, nT),
      cells: cells, note: note,
      bindingNote: 'binding: ' + binding.name
    };
  }

  window.Budget = { derive: derive };
})();
