/* ============================================================================
   beam.js — what the beam actually looks like with the chosen architecture.

   THE GEOMETRY IS IN THE EQUATIONS. An earlier version modelled each tile as
   a uniformly illuminated CONTINUOUS aperture the size of the tile pitch.
   That is the pattern of a *filled* subarray, and this array is nothing like
   filled: a 4 cm tile carries 8 radiators where a filled tile at lambda/2
   would need about 441. Because the assumed subarray width equalled the tile
   pitch exactly, its sinc nulls landed precisely on the tile-grid grating
   lobes and cancelled them — the correct result for contiguous filled
   subarrays, and completely wrong here. The model was assuming away the
   grating lobes the real array has.

   The corrected pattern is three factors, built from the real lattice:

       element pattern  x  intra-tile array factor  x  tile-grid array factor

   with the intra-tile factor steered CHROMATICALLY (elements are baseband
   phase shifted, correct only at band centre) and the tile-grid factor
   steered ACHROMATICALLY (tiles carry coarse true time delay). Pattern
   multiplication is legitimate because every tile is identical.

   Consistency: at band centre both steer alike and AF(4, 1 cm) x AF(7, 4 cm)
   collapses exactly to AF(28, 1 cm), so the full-aperture beamwidth
   0.886*lambda/(D cos theta) and the -13.26 dB uniform first sidelobe are
   preserved — the previously validated results are not regressed.

   ABSOLUTE GAIN is reported, not only a peak-normalised shape. A sparse array
   keeps the BEAMWIDTH of its aperture but only the GAIN of its element count,
   and the difference goes into sidelobes. Here that gap is ~16 dB, larger
   than every error effect in the tool, and a peak-normalised plot hides it.

   ERRORS use per-class group counts. The LO residual is common to the
   elements of a tile (N = tiles) while amplitude spread and phase-shifter
   quantisation are per element (N = elements). Dividing both by the tile
   count — as an earlier version did — overstates the amplitude contribution
   by 10log10(elements/tiles) and inverts which error class dominates.

   Exposes window.Beam.
   ========================================================================= */
(function () {
  'use strict';

  var K = window.K;

  function ampSigma(dbRms) { return Math.log(10) / 20 * dbRms; }

  /* Element power pattern cos^n(theta) over the forward hemisphere. For a
     cos^n power pattern the directivity is 2(n+1), so n follows from the
     element directivity: 6 dBi -> n = 10^0.6/2 - 1 = 0.99. Returned as
     POWER, since that is how it enters every term. */
  function elemPow(sinT, n) {
    var c2 = 1 - sinT * sinT;
    if (c2 <= 0) return 0;
    return Math.pow(Math.sqrt(c2), n);
  }

  /* Voltage array factor of N equally spaced elements at pitch d, steered to
     steerSin. Dirichlet kernel, normalised to 1 at its peak. This is where
     grating lobes come from: it returns to full amplitude whenever
     (d/lambda)(sinT - steerSin) is an integer. */
  function afV(N, d, lam, sinT, steerSin) {
    if (N <= 1) return 1;
    var psi = Math.PI * d / lam * (sinT - steerSin);
    var s = Math.sin(psi);
    if (Math.abs(s) < 1e-12) return 1;
    return Math.sin(N * psi) / (N * s);
  }

  /* Continuous uniformly illuminated aperture of width L — used only for the
     aperiodic/thinned lattice, where the periodic structure is deliberately
     broken and only the main lobe of the full aperture survives coherently. */
  function apertureV(L, lam, sinT, steerSin) {
    var x = Math.PI * L / lam * (sinT - steerSin);
    return Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x;
  }

  /* ---------------------------------------------------------------------
     One principal-plane cut.
     o: { nElemX, elemPerTileX, nTiles1D, elemDxM, tilePitchM, apertureM,
          fHz, fCenterHz, scanDeg, elemPowExp, periodic,
          sigTilePhaseDeg, sigElemPhaseDeg, sigAmpDb,
          nTiles, nElem, ttdResidPs, degMin, degMax, points }
     Returns dB relative to the error-free peak, plus the absolute chain.
     ------------------------------------------------------------------- */
  function cut(o) {
    var lam = K.C0 / o.fHz;
    var s0 = Math.sin(K.deg2rad(o.scanDeg));
    /* elements inside a tile are phase-steered at band centre, so their beam
       walks as fc/f; the tile grid is delay-steered and stays put */
    var sIntra = s0 * (o.fCenterHz / o.fHz);

    /* TTD quantisation survives only as its frequency-dependent part: at band
       centre the per-tile phase shifter absorbs the fixed offset. */
    var ttdPhi = 2 * Math.PI * (o.fHz - o.fCenterHz) * (o.ttdResidPs || 0) * 1e-12;

    var sigT = K.deg2rad(o.sigTilePhaseDeg || 0);
    var sigE = K.deg2rad(o.sigElemPhaseDeg || 0);
    var sigA = ampSigma(o.sigAmpDb || 0);
    /* the TTD residual is a per-tile error, like the LO residual */
    var varTile = sigT * sigT + ttdPhi * ttdPhi / 3;
    var varElem = sigE * sigE + sigA * sigA;
    var coh = Math.exp(-(varTile + varElem));
    /* scattered power reappears spread over the pattern, and each class is
       divided by ITS OWN number of independent groups */
    var diffuse = varTile / Math.max(o.nTiles, 1) + varElem / Math.max(o.nElem, 1);

    var d0 = o.degMin === undefined ? -90 : o.degMin;
    var d1 = o.degMax === undefined ? 90 : o.degMax;
    var n = o.points || 1601;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var deg = d0 + (d1 - d0) * i / (n - 1);
      var sinT = Math.sin(K.deg2rad(deg));
      var ep = elemPow(sinT, o.elemPowExp);
      var afTot;
      if (o.periodic) {
        afTot = afV(o.elemPerTileX, o.elemDxM, lam, sinT, sIntra) *
                afV(o.nTiles1D, o.tilePitchM, lam, sinT, s0);
      } else {
        /* aperiodic: the lattice is deliberately non-periodic, so the discrete
           grating lobes break up. Only the full-aperture main lobe survives
           coherently; the rest lands in a roughly uniform floor near 1/N. */
        afTot = apertureV(o.apertureM, lam, sinT, s0);
      }
      var pCoh = ep * afTot * afTot;
      var thinFloor = o.periodic ? 0 : ep / Math.max(o.nElem, 1);
      pts.push({
        deg: deg,
        ideal: 10 * Math.log10(Math.max(pCoh + thinFloor, 1e-14)),
        real: 10 * Math.log10(Math.max(pCoh * coh + ep * diffuse + thinFloor, 1e-14))
      });
    }
    return {
      points: pts, coh: coh, diffuse: diffuse,
      diffuseDb: 10 * Math.log10(Math.max(diffuse, 1e-14)),
      varTile: varTile, varElem: varElem,
      ruzeLossDb: -10 * Math.log10(coh)
    };
  }

  /* Angles where grating lobes actually land when the beam is steered:
     sin(theta_g) = sin(theta_0) + m*lambda/dx, for every m that stays in
     visible space. NOT scanDeg +/- the broadside angle — that small-angle
     shortcut put them tens of degrees wrong at 30 deg of scan. */
  function gratingAngles(scanDeg, deltaSin) {
    var out = [];
    if (!(deltaSin > 0) || !isFinite(deltaSin)) return out;
    var s0 = Math.sin(K.deg2rad(scanDeg));
    for (var m = -12; m <= 12; m++) {
      if (m === 0) continue;
      var s = s0 + m * deltaSin;
      if (Math.abs(s) <= 1) out.push(Math.asin(s) * K.DEG);
    }
    return out;
  }

  /* Metrics read off a cut.
     The main beam is measured at the INTENDED direction, not at the global
     maximum: on a coarse periodic lattice a grating lobe can outrank the
     intended beam, and a naive peak-finder then reports the pattern as
     pointing tens of degrees away with a huge "pointing error". Both are
     reported, plus a flag for whether the intended beam is actually the
     strongest thing in the hemisphere. */
  function metrics(res, scanDeg, deltaSin) {
    var pts = res.points;

    /* global maximum */
    var peak = -Infinity, pi = 0;
    for (var i = 0; i < pts.length; i++) if (pts[i].real > peak) { peak = pts[i].real; pi = i; }

    /* the local maximum nearest the intended direction = the main beam */
    var mi = 0, bestD = Infinity;
    for (var k = 0; k < pts.length; k++) {
      var d = Math.abs(pts[k].deg - scanDeg);
      if (d < bestD) { bestD = d; mi = k; }
    }
    while (mi > 0 && pts[mi - 1].real > pts[mi].real) mi--;
    while (mi < pts.length - 1 && pts[mi + 1].real > pts[mi].real) mi++;
    var main = pts[mi].real;

    var lo = mi, hi = mi;
    while (lo > 0 && pts[lo].real > main - 3) lo--;
    while (hi < pts.length - 1 && pts[hi].real > main - 3) hi++;
    var resolved = pts[lo].real <= main - 3 && pts[hi].real <= main - 3;
    var hpbw = resolved ? pts[hi].deg - pts[lo].deg : NaN;

    /* classify every lobe outside the main beam: is it near a predicted
       grating angle, or is it an ordinary taper sidelobe? */
    var gAng = gratingAngles(scanDeg, deltaSin);
    var tolerance = Math.max(1.5, (hpbw || 1) * 1.5);
    var sll = -Infinity, gl = -Infinity, glDeg = NaN;
    for (var j = 1; j < pts.length - 1; j++) {
      if (j >= lo - 1 && j <= hi + 1) continue;
      if (!(pts[j].real >= pts[j - 1].real && pts[j].real >= pts[j + 1].real)) continue;
      var isGrating = false;
      for (var q = 0; q < gAng.length; q++) {
        if (Math.abs(pts[j].deg - gAng[q]) < tolerance) { isGrating = true; break; }
      }
      if (isGrating) {
        if (pts[j].real > gl) { gl = pts[j].real; glDeg = pts[j].deg; }
      } else if (pts[j].real > sll) sll = pts[j].real;
    }

    return {
      mainDb: main, mainAtDeg: pts[mi].deg,
      pointErrDeg: pts[mi].deg - scanDeg,
      peakDb: peak, peakAtDeg: pts[pi].deg,
      /* is the intended beam the strongest lobe in the hemisphere? */
      beamIsPeak: Math.abs(pts[pi].deg - pts[mi].deg) < Math.max(1, (hpbw || 1)),
      peakExcessDb: peak - main,
      hpbwDeg: hpbw, hpbwResolved: resolved,
      sllDb: isFinite(sll) ? sll - main : NaN,
      gratingDb: isFinite(gl) ? gl - main : NaN,
      gratingAtDeg: glDeg,
      gratingAngles: gAng,
      floorDb: res.diffuseDb - main
    };
  }

  /* ---------------------------------------------------------------------
     Everything the Beam view needs for one direction.
     ------------------------------------------------------------------- */
  function evaluate(g, budget, loRes, bbRes, dir) {
    var fc = g.fLoHz, B = g.rfBwGHz * 1e9;

    /* per-TILE phase error: the LO residual is common to a tile's elements */
    var sigTile = loRes.interTileResidualDeg;
    /* per-ELEMENT phase error: baseband weight quantisation and the
       baseband network's own residual, which act per channel */
    var sigElem = K.rss(bbRes.interTileResidualDeg || 0, K.quantResidualDeg(g.phaseBits));
    var sigAmpDb = dir === 'tx' ? g.txGainErrDb : g.rxGainErrDb;

    var common = {
      nElemX: g.nElemX, elemPerTileX: g.elemPerTileX, nTiles1D: g.tileCols,
      elemDxM: g.elemDxM, tilePitchM: g.tileCm / 100, apertureM: g.effApertureM,
      fCenterHz: fc, scanDeg: g.beamScanDeg,
      elemPowExp: g.elemPowExp, periodic: Math.round(g.latticePeriodic) === 1,
      sigTilePhaseDeg: sigTile, sigElemPhaseDeg: sigElem, sigAmpDb: sigAmpDb,
      nTiles: g.nTilesTotal, nElem: g.nElem,
      ttdResidPs: budget.ttdResidPs
    };

    /* zoomed window on the main beam, and a full hemisphere so the grating
       lobes are actually visible — a 22 deg lobe falls far outside a
       +/-6 beamwidth window, so the zoom alone would still hide it */
    var lamC = K.C0 / fc;
    var hpbwEst = 0.886 * lamC /
      (g.effApertureM * Math.max(Math.cos(K.deg2rad(g.beamScanDeg)), 0.15)) * K.DEG;
    var win = Math.max(6 * hpbwEst, 4);

    function at(fHz, dMin, dMax, npts) {
      var o = {};
      for (var k in common) o[k] = common[k];
      o.fHz = fHz; o.degMin = dMin; o.degMax = dMax; o.points = npts;
      return cut(o);
    }
    var zLo = Math.max(-90, g.beamScanDeg - win), zHi = Math.min(90, g.beamScanDeg + win);

    var centre = at(fc, zLo, zHi, 1601);
    var lowEdge = at(fc - B / 2, zLo, zHi, 1601);
    var highEdge = at(fc + B / 2, zLo, zHi, 1601);
    var wide = at(fc, -90, 90, 3601);

    var mC = metrics(centre, g.beamScanDeg, NaN);
    var mW = metrics(wide, g.beamScanDeg, g.gratingDeltaSin);

    /* ---- absolute gain chain ----
       For N elements of directivity D_el the array directivity scanned to
       theta is N * D_el * cos^n(theta): the scan loss IS the element pattern,
       so adding a projected-aperture cos(theta) term would double-count. */
    var scanLossDb = -10 * Math.log10(Math.max(elemPow(Math.sin(K.deg2rad(g.beamScanDeg)), g.elemPowExp), 1e-9));
    var realisedDbi = g.dArrayDbi - scanLossDb - centre.ruzeLossDb;

    /* band-edge loss compares the MAIN beam at each frequency, not the global
       peak - on a coarse lattice the global peak may be a grating lobe */
    var mLo = metrics(lowEdge, g.beamScanDeg, NaN), mHi = metrics(highEdge, g.beamScanDeg, NaN);
    var peakEdge = Math.max(mLo.mainDb, mHi.mainDb);
    var peakCentre = mC.mainDb;

    return {
      dir: dir,
      sigTileDeg: sigTile, sigElemDeg: sigElem, sigAmpDb: sigAmpDb,
      hpbwEstDeg: hpbwEst, winDeg: win,
      centre: centre, lowEdge: lowEdge, highEdge: highEdge, wide: wide,
      m: mC, mWide: mW,
      ruzeLossDb: centre.ruzeLossDb,
      scanLossDb: scanLossDb,
      dFilledDbi: g.dFilledDbi, dArrayDbi: g.dArrayDbi,
      thinningLossDb: g.thinningLossDb, realisedDbi: realisedDbi,
      edgeLossDb: peakCentre - peakEdge,
      /* which error class owns the floor, now that each is divided by its
         own group count */
      tileShareOfFloor: (function () {
        var a = centre.varTile / Math.max(g.nTilesTotal, 1);
        var b = centre.varElem / Math.max(g.nElem, 1);
        return (a + b) > 0 ? a / (a + b) : 0;
      })()
    };
  }

  window.Beam = { evaluate: evaluate, cut: cut, metrics: metrics, elemPow: elemPow };
})();
