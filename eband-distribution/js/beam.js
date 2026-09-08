/* ============================================================================
   beam.js — what the beam actually looks like with the chosen architecture.

   The array is TILED, and that is the whole point of the pattern model:

     * Inside a tile, elements are baseband PHASE shifted. A phase-steered
       subarray's pattern does steer, but only correctly at the frequency the
       phases were set for — off centre frequency the subarray beam walks.
     * BETWEEN tiles the architecture applies coarse TRUE TIME DELAY, which is
       frequency-independent, so the tile-level array factor stays put.

   So across the signal band the subarray pattern slides off the array-factor
   peak. That mismatch — not the band-centre pattern — is what sub-tiling and
   the coarse TTD exist to control, and it is what this view shows.

   Random per-tile errors are handled by the standard mean-power result: the
   coherent pattern is attenuated by exp(-sigma^2) and the lost power
   reappears as a diffuse floor at (1-exp(-sigma^2))/N_indep. That floor, not
   the peak gain loss, is what limits null depth.

   Phase and amplitude errors combine as sigma^2 = sigma_phi^2 + sigma_a^2
   with sigma_a the RMS relative amplitude error (linear, not dB).

   Exposes window.Beam.
   ========================================================================= */
(function () {
  'use strict';

  var K = window.K;

  function dbToAmpSigma(dbRms) { return Math.log(10) / 20 * dbRms; }

  /* Uniformly illuminated aperture of width L (m) at wavelength lam, steered
     to steerSin. Returns the voltage pattern, normalised to 1 at its peak. */
  function aperturePattern(L, lam, sinT, steerSin) {
    var x = Math.PI * L / lam * (sinT - steerSin);
    if (Math.abs(x) < 1e-9) return 1;
    return Math.sin(x) / x;
  }

  /* N equally spaced tiles at pitch d, steered to steerSin. Dirichlet kernel,
     normalised to 1 at its peak. */
  function arrayFactor(N, d, lam, sinT, steerSin) {
    var psi = Math.PI * d / lam * (sinT - steerSin);
    if (Math.abs(Math.sin(psi)) < 1e-12) return 1;
    var v = Math.sin(N * psi) / (N * Math.sin(psi));
    return v;
  }

  /* ---------------------------------------------------------------------
     One pattern cut in the principal plane.
     opts: { nTiles1D, tilePitchM, tileApertureM, fHz, fCenterHz, scanDeg,
             sigPhiDeg, sigAmpDb, nIndep, ttdResidPs, points }
     Returns [{deg, ideal, real, floor}] in dB relative to the error-free
     peak of the same array at band centre.
     ------------------------------------------------------------------- */
  function cut(o) {
    var lam = K.C0 / o.fHz;
    var lamC = K.C0 / o.fCenterHz;
    var s0 = Math.sin(K.deg2rad(o.scanDeg));

    /* Inter-tile steering is by true time delay, so it is achromatic: the
       array factor points at s0 at every frequency. Intra-tile steering is by
       phase set at band centre, so the subarray beam sits at (fc/f)*s0. */
    var sTile = s0 * (o.fCenterHz / o.fHz);
    /* Residual TTD quantisation. At band centre the per-tile baseband phase
       shifter absorbs it completely — the architecture has both a coarse
       delay and a phase shifter, and calibration zeroes the phase there. What
       survives is only the FREQUENCY-DEPENDENT part, 2*pi*(f-fc)*tau_q, which
       is zero at centre and grows toward the band edges. Using 2*pi*f*tau_q
       instead would be 10.6 rad at 78 GHz and would saturate the pattern into
       its diffuse floor at every frequency. */
    var ttdPhiRad = 2 * Math.PI * (o.fHz - o.fCenterHz) * (o.ttdResidPs || 0) * 1e-12;

    var sigPhi = K.deg2rad(o.sigPhiDeg);
    var sigAmp = dbToAmpSigma(o.sigAmpDb || 0);
    var sig2 = sigPhi * sigPhi + sigAmp * sigAmp + ttdPhiRad * ttdPhiRad / 3;
    var coh = Math.exp(-sig2);
    var diffuse = (1 - coh) / Math.max(o.nIndep, 1);

    /* Sampled over a window rather than the full hemisphere: the beam is
       under a degree wide here, so a uniform sweep of [-90,90] would
       quantise the -3 dB width to the sample step and read ~12% wide. */
    var d0 = o.degMin === undefined ? -90 : o.degMin;
    var d1 = o.degMax === undefined ? 90 : o.degMax;
    var pts = [];
    var n = o.points || 1201;
    for (var i = 0; i < n; i++) {
      var deg = d0 + (d1 - d0) * i / (n - 1);
      var sinT = Math.sin(K.deg2rad(deg));
      var el = aperturePattern(o.tileApertureM, lam, sinT, sTile);
      var af = arrayFactor(o.nTiles1D, o.tilePitchM, lam, sinT, s0);
      var pIdeal = el * el * af * af;                   /* power, peak 1 */
      var pReal = el * el * (coh * af * af + diffuse);
      pts.push({
        deg: deg,
        ideal: 10 * Math.log10(Math.max(pIdeal, 1e-12)),
        real: 10 * Math.log10(Math.max(pReal, 1e-12)),
        floor: 10 * Math.log10(Math.max(diffuse, 1e-12))
      });
    }
    return { points: pts, coh: coh, diffuseDb: 10 * Math.log10(Math.max(diffuse, 1e-12)), sig2: sig2 };
  }

  /* peak, beamwidth, first sidelobe — read off a computed cut */
  function metrics(res, scanDeg) {
    var pts = res.points;
    var peak = -Infinity, peakI = 0;
    for (var i = 0; i < pts.length; i++) if (pts[i].real > peak) { peak = pts[i].real; peakI = i; }

    /* −3 dB width around the peak */
    var lo = peakI, hi = peakI;
    while (lo > 0 && pts[lo].real > peak - 3) lo--;
    while (hi < pts.length - 1 && pts[hi].real > peak - 3) hi++;
    var hpbw = pts[hi].deg - pts[lo].deg;

    /* first sidelobe: highest local maximum outside the main lobe */
    var sll = -Infinity;
    for (var j = 1; j < pts.length - 1; j++) {
      if (j >= lo - 1 && j <= hi + 1) continue;
      if (pts[j].real >= pts[j - 1].real && pts[j].real >= pts[j + 1].real) {
        if (pts[j].real > sll) sll = pts[j].real;
      }
    }
    return {
      peakDb: peak,
      pointDeg: pts[peakI].deg,
      pointErrDeg: pts[peakI].deg - scanDeg,
      hpbwDeg: hpbw,
      sllDb: sll - peak,
      floorDb: res.diffuseDb - peak
    };
  }

  /* ---------------------------------------------------------------------
     Everything the Beam view needs, for one direction (TX or RX).
     ------------------------------------------------------------------- */
  function evaluate(g, budget, loRes, bbRes, dir) {
    var nT1 = g.tileCols;
    var fc = g.fLoHz;
    var B = g.rfBwGHz * 1e9;

    /* Phase error: the LO residual is common to both directions, the baseband
       network's residual adds, and each direction carries its own amplitude
       spread — PA-to-PA on transmit, LNA/VGA on receive. */
    var sigPhi = K.rss(loRes.interTileResidualDeg, bbRes.interTileResidualDeg || 0);
    var sigAmpDb = dir === 'tx' ? g.txGainErrDb : g.rxGainErrDb;

    var common = {
      nTiles1D: nT1,
      tilePitchM: g.tileCm / 100,
      tileApertureM: g.tileCm / 100,
      fCenterHz: fc,
      scanDeg: g.beamScanDeg,
      sigPhiDeg: sigPhi,
      sigAmpDb: sigAmpDb,
      nIndep: g.nTilesTotal,
      ttdResidPs: budget.ttdResidPs
    };

    /* Window the sample on the steered beam. The full-aperture beam is well
       under a degree here, so sampling [-90,90] uniformly would read the
       -3 dB width a good 10% wide from step quantisation alone. */
    var lamC = K.C0 / fc;
    var hpbwEst = 0.886 * lamC / (g.effApertureM * Math.max(Math.cos(K.deg2rad(g.beamScanDeg)), 0.15)) * K.DEG;
    var win = Math.max(6 * hpbwEst, 4);
    common.degMin = Math.max(-90, g.beamScanDeg - win);
    common.degMax = Math.min(90, g.beamScanDeg + win);
    common.points = 1601;

    function at(fHz) {
      var o = {};
      for (var k in common) o[k] = common[k];
      o.fHz = fHz;
      return cut(o);
    }

    var centre = at(fc);
    var lowEdge = at(fc - B / 2);
    var highEdge = at(fc + B / 2);

    return {
      dir: dir,
      sigPhiDeg: sigPhi,
      sigAmpDb: sigAmpDb,
      centre: centre, lowEdge: lowEdge, highEdge: highEdge,
      hpbwEstDeg: hpbwEst,
      m: metrics(centre, g.beamScanDeg),
      mLow: metrics(lowEdge, g.beamScanDeg),
      mHigh: metrics(highEdge, g.beamScanDeg),
      /* which error class actually sets the coherence floor — at these
         residual phase errors the amplitude spread usually wins, which is
         not the intuition the LO discussion builds */
      phaseVarShare: (function () {
        var sp = K.deg2rad(sigPhi), sa = Math.log(10) / 20 * sigAmpDb;
        var tot = sp * sp + sa * sa;
        return tot > 0 ? sp * sp / tot : 0;
      })(),
      /* band-edge peak loss relative to band centre — the squint penalty the
         sub-tiling and coarse TTD exist to bound */
      edgeLossDb: centre.points.reduce(function (a, p) { return Math.max(a, p.real); }, -Infinity) -
                  Math.max(
                    lowEdge.points.reduce(function (a, p) { return Math.max(a, p.real); }, -Infinity),
                    highEdge.points.reduce(function (a, p) { return Math.max(a, p.real); }, -Infinity)
                  )
    };
  }

  window.Beam = { evaluate: evaluate, cut: cut, metrics: metrics };
})();
