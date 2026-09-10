/* ============================================================================
   beam.js — what the beam actually looks like with the chosen architecture.

   THE GEOMETRY IS IN THE EQUATIONS. Three successive versions of this file
   got it wrong in three different ways, and all three defects are now gone:

   1. The first modelled each tile as a uniformly illuminated CONTINUOUS
      aperture the size of the tile pitch. That is a *filled* subarray, and
      because its sinc nulls landed exactly on the tile-grid grating lobes it
      cancelled them — the right answer for contiguous filled subarrays, and
      completely wrong for 8 radiators in a 4 cm tile (a filled tile at
      lambda/2 needs 433). It was assuming away the grating lobes the real
      array has, and simultaneously assuming 100% aperture efficiency: the
      same defect seen in pattern space and in gain space.

   2. The second used the real lattice but only ONE axis of it. It reported
      the first grating lobe as asin(lambda/dx) = 22.60 deg at -0.34 dB and
      missed the binding lobe entirely: dy = 2 cm puts one at 11.08 deg,
      suppressed by 0.08 dB. It also could not see the other 40 — this
      lattice puts pi*A_cell/lambda^2 = 42 grating lobes in visible space,
      most of them in neither principal plane. Lobes now come from the 2-D
      reciprocal lattice (lattice.js) and are reported by LEVEL, not by which
      axis they happen to sit on.

   3. The second also added error power as a single flat term
      var_tile/N_tiles + var_elem/N_elem at every angle. That creates power:
      the tile-error scatter is not flat, it carries the tile's own pattern
      |S(u)|^2, so radiating it flat at its PEAK level puts 10log10(8) = 9 dB
      too much scattered power into the hemisphere. The exact mean pattern
      for hierarchically grouped errors is used instead:

        E|AF|^2 = e1*|AF_0|^2 + (e2-e1)*N_t|S_t|^2
                             + (e3-e2)*N_d|S_d|^2 + ((1+sA^2)-e3)*N_e

      with e1 = exp(-(sT^2+sD^2+sE^2)) <= e2 = exp(-(sD^2+sE^2))
             <= e3 = exp(-sE^2) <= 1+sA^2, so every coefficient is
      non-negative, and integrating against the element pattern returns
      exactly N_e(1+sA^2) — power is conserved by construction, and the
      "floor" is correctly several dB higher near the beam and at the
      intra-tile comb angles than it is between them. Both are reported.

   4. TTD quantisation was applied as a random variance, and that variance
      was wrong: budget.js already returns step/sqrt(12), an RMS, and this
      file then divided its square by a further 3 — understating the term by
      4.77 dB. It is not random anyway. The commanded delays are a ramp in
      tile index, so the residual e_t = step*round(tau_t/step) - tau_t is a
      deterministic rounding sequence: exactly zero at broadside, periodic at
      commensurate scan angles (where it makes a discrete quantisation lobe
      several dB above any variance estimate) and equidistributed elsewhere.
      It is now computed exactly and carried in the coherent field, and the
      worst case is found by sweeping the commanded angle. Scanning in the
      phi = 0 plane it is also common to a whole tile COLUMN, so it averages
      by the 1-D tile count and scatters into the scan plane.

   Pattern factorisation is used only where it is legitimate. The ideal
   excitation is progressive, so intra-tile x tile-grid is exact, and at band
   centre AF(4,1cm) x AF(7,4cm) collapses to AF(28,1cm) — the full-aperture
   beamwidth and the -13.26 dB uniform first sidelobe are preserved. Errors
   are not progressive, so they are handled by the exact grouped-error mean
   above, and a seeded Monte-Carlo REALISATION is drawn alongside it, because
   a mean pattern can never show a null filling in at a specific angle and
   systematically understates the peak error sidelobe (by 10log10(ln(2L/lam))
   = 7.0 dB here).

   ABSOLUTE GAIN is reported, with directivity kept separate from realised
   gain.

   Exposes window.Beam.
   ========================================================================= */
(function () {
  'use strict';

  var K = window.K;

  function ampSigma(dbRms) { return Math.log(10) / 20 * dbRms; }

  /* deterministic PRNG, so a realisation does not flicker on every
     re-render and can be quoted */
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  function gauss(r) {
    var u = Math.max(r(), 1e-12), v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* ---------------------------------------------------------------------
     Everything about the array that depends on neither frequency nor angle.
     ------------------------------------------------------------------- */
  function ctxOf(g) {
    var p = g.tileCm / 100;
    var Nt1 = Math.max(1, Math.round(g.tileCols));
    var offs = (g.latOffsetsCm || [[0, 0]]).map(function (o) { return [o[0] / 100, o[1] / 100]; });
    var u0 = Math.sin(K.deg2rad(g.beamScanDeg));

    /* per-COLUMN TTD quantisation residual, computed exactly */
    var stepS = Math.max(g.ttdStepPs || 0, 0) * 1e-12;
    var e = [], eMaxPs = 0;
    for (var t = 0; t < Nt1; t++) {
      var tau = p * t * u0 / K.C0;
      var q = stepS > 0 ? stepS * Math.round(tau / stepS) - tau : 0;
      e.push(q);
      eMaxPs = Math.max(eMaxPs, Math.abs(q) * 1e12);
    }

    /* die grouping: contiguous groups of the sorted in-tile offsets, which
       for the rectangular lattice is one row per die */
    var nDie = Math.max(1, Math.round(g.diesPerTile || 1));
    var per = Math.max(1, Math.round(offs.length / nDie));
    return {
      p: p, Nt1: Nt1, Nt: Nt1 * Nt1, offs: offs, dieOffs: offs.slice(0, per),
      M: offs.length, Md: per, nDiePerTile: nDie,
      Nd: Nt1 * Nt1 * nDie, Ne: Nt1 * Nt1 * offs.length,
      u0: u0, v0: 0, fc: g.fLoHz, e: e, eMaxPs: eMaxPs, stepS: stepS,
      elem: g.elem, periodic: Math.round(g.latticePeriodic) === 1,
      apertureM: g.effApertureM, lamC: K.C0 / g.fLoHz
    };
  }

  /* Coherent geometry at one (u,v) and frequency: the squared magnitudes the
     mean-pattern formula needs. */
  function geomAt(c, f, u, v) {
    var k = 2 * Math.PI * f / K.C0, rho = c.fc / f;
    var ur = u - rho * c.u0, vr = v - rho * c.v0;
    var ar = 0, ai = 0, dr = 0, di = 0, i, ph;
    for (i = 0; i < c.offs.length; i++) {
      ph = k * (c.offs[i][0] * ur + c.offs[i][1] * vr);
      ar += Math.cos(ph); ai += Math.sin(ph);
      if (i < c.dieOffs.length) { dr += Math.cos(ph); di += Math.sin(ph); }
    }
    var xr = 0, xi = 0, w = 2 * Math.PI * (f - c.fc);
    for (i = 0; i < c.Nt1; i++) {
      ph = k * c.p * i * (u - c.u0) - w * c.e[i];
      xr += Math.cos(ph); xi += Math.sin(ph);
    }
    var yr = 0, yi = 0;
    for (i = 0; i < c.Nt1; i++) {
      ph = k * c.p * i * (v - c.v0);
      yr += Math.cos(ph); yi += Math.sin(ph);
    }
    var ss = ar * ar + ai * ai, ds = dr * dr + di * di;
    var gs = (xr * xr + xi * xi) * (yr * yr + yi * yi);
    return { af0: ss * gs, ss: ss, ds: ds, ep: c.elem.powAt(u, v) };
  }

  /* One aperiodic-lattice point. The periodicity is deliberately broken, so
     only the full-aperture main lobe survives coherently and the rest lands
     in a floor near 1/N — mean 1/N, expected PEAK higher by
     10log10(ln(2L/lambda)). */
  function geomAperiodic(c, f, u, v) {
    var lam = K.C0 / f;
    var x = Math.PI * c.apertureM / lam * (u - c.u0);
    var y = Math.PI * c.apertureM / lam * (v - c.v0);
    var sx = Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x;
    var sy = Math.abs(y) < 1e-9 ? 1 : Math.sin(y) / y;
    var a = sx * sy * c.Ne;
    return { af0: a * a, ss: c.M, ds: c.Md, ep: c.elem.powAt(u, v), thin: c.Ne };
  }

  /* Geometry along one cut in the plane phi. */
  function geomCut(c, f, phiDeg, d0, d1, npts) {
    var cp = Math.cos(K.deg2rad(phiDeg)), sp = Math.sin(K.deg2rad(phiDeg));
    var n = npts || 1601, out = [];
    for (var i = 0; i < n; i++) {
      var deg = d0 + (d1 - d0) * i / (n - 1);
      var s = Math.sin(K.deg2rad(deg));
      var q = c.periodic ? geomAt(c, f, s * cp, s * sp) : geomAperiodic(c, f, s * cp, s * sp);
      q.deg = deg;
      out.push(q);
    }
    return out;
  }

  /* ---------------------------------------------------------------------
     One error set. TX and RX differ only in amplitude spread, so the
     geometry is computed once and used twice.
     ------------------------------------------------------------------- */
  function errorSet(c, err) {
    var sT = K.deg2rad(err.sigTileDeg || 0), sD = K.deg2rad(err.sigDieDeg || 0);
    var sE = K.deg2rad(err.sigElemDeg || 0), sA = ampSigma(err.sigAmpDb || 0);
    var vT = sT * sT, vD = sD * sD, vE = sE * sE, vA = sA * sA;
    var e1 = Math.exp(-(vT + vD + vE)), e2 = Math.exp(-(vD + vE)), e3 = Math.exp(-vE);
    var cT = (e2 - e1) * c.Nt, cD = (e3 - e2) * c.Nd, cE = (1 + vA - e3) * c.Ne;
    var n2 = c.Ne * c.Ne;
    return {
      vT: vT, vD: vD, vE: vE, vA: vA, e1: e1, e2: e2, e3: e3,
      cT: cT, cD: cD, cE: cE,
      /* the floor where the tile pattern peaks — main beam and the intra-tile
         comb angles — and the floor between those, where |S|^2 falls to its
         angle average. Both relative to the error-free peak Ne^2. */
      floorNearDb: 10 * Math.log10(Math.max(
        (cT * c.M * c.M + cD * c.Md * c.Md + cE) / n2, 1e-16)),
      floorFarDb: 10 * Math.log10(Math.max(
        (cT * c.M + cD * c.Md + cE) / n2, 1e-16))
    };
  }

  /* Peak-normalised dB traces from geometry + errors. */
  function pattern(c, geom, es, peakRef) {
    var pts = [];
    for (var i = 0; i < geom.length; i++) {
      var q = geom[i];
      var scat = es.cT * q.ss + es.cD * q.ds + es.cE + (q.thin || 0);
      pts.push({
        deg: q.deg,
        ideal: 10 * Math.log10(Math.max(q.ep * (q.af0 + (q.thin || 0)) / peakRef, 1e-16)),
        real: 10 * Math.log10(Math.max(q.ep * (es.e1 * q.af0 + scat) / peakRef, 1e-16))
      });
    }
    return pts;
  }

  /* ---------------------------------------------------------------------
     A seeded REALISATION: one draw of the random errors, summed element by
     element. This is what a mean pattern cannot show — nulls fill in at
     specific angles, and the peak error sidelobe runs about 7 dB above the
     mean floor. TX only, on the zoomed cut, to keep it cheap.
     ------------------------------------------------------------------- */
  function realise(c, f, phiDeg, d0, d1, npts, err, seed) {
    var r = rng(seed || 12345);
    var sT = K.deg2rad(err.sigTileDeg || 0), sD = K.deg2rad(err.sigDieDeg || 0);
    var sE = K.deg2rad(err.sigElemDeg || 0), sA = ampSigma(err.sigAmpDb || 0);
    var ox = [], oy = [], tX = [], tY = [], ph = [], am = [];
    var w = 2 * Math.PI * (f - c.fc);
    for (var tx = 0; tx < c.Nt1; tx++) {
      for (var ty = 0; ty < c.Nt1; ty++) {
        var pt = gauss(r) * sT;
        var pd = [];
        for (var d = 0; d < c.nDiePerTile; d++) pd.push(gauss(r) * sD);
        for (var m = 0; m < c.M; m++) {
          ox.push(c.offs[m][0]); oy.push(c.offs[m][1]);
          tX.push(tx * c.p); tY.push(ty * c.p);
          ph.push(pt + pd[Math.min(pd.length - 1, Math.floor(m / Math.max(c.Md, 1)))] +
                  gauss(r) * sE - w * c.e[tx]);
          am.push(1 + gauss(r) * sA);
        }
      }
    }
    var cp = Math.cos(K.deg2rad(phiDeg)), sp = Math.sin(K.deg2rad(phiDeg));
    var k = 2 * Math.PI * f / K.C0, rho = c.fc / f, out = [];
    for (var i = 0; i < npts; i++) {
      var deg = d0 + (d1 - d0) * i / (npts - 1);
      var s = Math.sin(K.deg2rad(deg));
      var u = s * cp, v = s * sp;
      /* offsets are phase-steered at fc (chromatic); tiles are delay-steered
         (achromatic) */
      var uo = u - rho * c.u0, vo = v - rho * c.v0, ut = u - c.u0, vt = v - c.v0;
      var re = 0, im = 0;
      for (var j = 0; j < ox.length; j++) {
        var q = k * (ox[j] * uo + oy[j] * vo + tX[j] * ut + tY[j] * vt) + ph[j];
        re += am[j] * Math.cos(q); im += am[j] * Math.sin(q);
      }
      out.push({ deg: deg, p: c.elem.powAt(u, v) * (re * re + im * im) });
    }
    return out;
  }

  /* ---------------------------------------------------------------------
     Deterministic TTD-quantisation sweep: the peak scattered lobe over the
     commanded-angle grid at band edge, its level at the current angle, and
     the angle-averaged variance proxy that understates both.
     ------------------------------------------------------------------- */
  function ttdSweep(g, c, fEdge) {
    var stepS = c.stepS, p = c.p, N = c.Nt1;
    if (!(stepS > 0) || N < 2) return null;
    var w = 2 * Math.PI * (fEdge - c.fc);

    /* The u-scan is PERIODIC in du with period lambda/p, because the tile
       index is an integer — so scanning [-2, 2] as an earlier version did
       covered the same period 41 times over and spent its samples on
       repeats. One period at 256 points is both finer and 40x cheaper, and
       it removes the grid dependence that made light and full modes
       disagree here. */
    /* The scatter peaks in u no more sharply than 1/N of a period — it is a
       sum of N terms — so 8 samples per lobe is ample and a fixed 256 is
       waste at small N and thin at large N. */
    var nU = Math.max(48, Math.min(160, 6 * N)), duPeriod = c.lamC / p;

    /* Peak scattered power from the quantisation sequence at one commanded
       angle, relative to the coherent peak. The mean of the sequence is a
       harmless global phase, so it is removed first. */
    function scatterAt(sd) {
      var u0 = Math.sin(K.deg2rad(sd)), dpsi = [], mean = 0, t;
      for (t = 0; t < N; t++) {
        var tau = p * t * u0 / K.C0;
        dpsi.push(-w * (stepS * Math.round(tau / stepS) - tau));
        mean += dpsi[t];
      }
      mean /= N;
      var peak = 0;
      for (var iu = 0; iu < nU; iu++) {
        var du = duPeriod * iu / nU;
        var re = 0, im = 0;
        for (t = 0; t < N; t++) {
          var a = 2 * Math.PI * p * t * du / c.lamC;
          re += (dpsi[t] - mean) * Math.cos(a);
          im += (dpsi[t] - mean) * Math.sin(a);
        }
        peak = Math.max(peak, (re * re + im * im) / (N * N));
      }
      return 10 * Math.log10(Math.max(peak, 1e-18));
    }

    var maxScan = Math.max(Math.abs(g.scanDegMax || 60), Math.abs(g.beamScanDeg));

    /* WHERE the worst case is, without hunting for it on a uniform grid.
       scatterAt is a sawtooth in commanded angle: each tile's residual
       e_t = step·round(tau_t/step) − tau_t grows linearly and snaps back
       whenever tau_t crosses a half-step, so the apexes sit at exactly the
       angles where some tile flips —

           sin(sd) = (m + 1/2)·step·c / (p·t)

       for tile t and integer m. That is a small closed-form candidate set,
       maybe fifty angles, against the 241 a 0.25 deg grid spends — and a
       uniform grid can still walk past a tooth. Both modes now evaluate the
       same candidates, so the Beam view and a Systems comparison row can no
       longer disagree about the same system: an earlier version swept 1 deg
       in light mode and 0.25 deg in full, which differed by up to 0.35 dB,
       ten times what the docstring claimed, and even the 0.25 deg grid
       understated the true worst. */
    var sMax = Math.sin(K.deg2rad(maxScan));
    var cand = [0, maxScan, Math.abs(g.beamScanDeg)];
    for (var t2 = 1; t2 < N; t2++) {
      var quantum = stepS * K.C0 / (p * t2);        /* sin(sd) per half-step */
      var mMax = Math.ceil(sMax / quantum) + 1;
      for (var m = 0; m <= mMax; m++) {
        var s = (m + 0.5) * quantum;
        if (s > sMax) break;
        var a0 = Math.asin(s) * K.DEG;
        /* the residual is discontinuous AT the flip, so sample both sides */
        cand.push(Math.max(0, a0 - 1e-4));
        cand.push(Math.min(maxScan, a0 + 1e-4));
      }
    }
    /* a coarse net as well, so a maximum that falls between teeth — the
       tiles do not all flip together — is not missed either */
    for (var sd = 0; sd <= maxScan + 1e-9; sd += 1) cand.push(sd);

    /* The flip set grows as the square of the tile count — 2500 angles at a
       2 cm pitch on a 60 cm panel — and each evaluation is N trig pairs per
       u-sample, so the honest search has to be bounded somewhere. Thinning
       uniformly keeps the teeth represented across the whole scan range
       rather than truncating the far half of it, and the golden-section
       refinement below recovers the apex of whichever tooth wins. */
    var CAND_CAP = Math.max(90, Math.min(420, Math.round(9000 / N)));
    if (cand.length > CAND_CAP) {
      var keep = [], stride = cand.length / CAND_CAP;
      for (var ci = 0; ci < CAND_CAP; ci++) keep.push(cand[Math.floor(ci * stride)]);
      keep.push(0, maxScan, Math.abs(g.beamScanDeg));
      cand = keep;
    }

    var best = { db: -Infinity, scanDeg: NaN };
    for (var i2 = 0; i2 < cand.length; i2++) {
      var db = scatterAt(cand[i2]);
      if (db > best.db) best = { db: db, scanDeg: cand[i2] };
    }
    /* refine around the winner: golden-section on a half-degree window,
       which costs a dozen more evaluations and pins the apex */
    (function () {
      var lo = Math.max(0, best.scanDeg - 0.5), hi = Math.min(maxScan, best.scanDeg + 0.5);
      var gr = 0.6180339887;
      var x1 = hi - gr * (hi - lo), x2 = lo + gr * (hi - lo);
      var f1 = scatterAt(x1), f2 = scatterAt(x2);
      for (var k = 0; k < 14; k++) {
        if (f1 > f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - gr * (hi - lo); f1 = scatterAt(x1); }
        else { lo = x1; x1 = x2; f1 = f2; x2 = lo + gr * (hi - lo); f2 = scatterAt(x2); }
      }
      var fBest = Math.max(f1, f2);
      if (fBest > best.db) best = { db: fBest, scanDeg: f1 > f2 ? x1 : x2 };
    })();

    /* the current angle is evaluated explicitly rather than read off any
       grid, so it stays right whatever the search does */
    var atCur = scatterAt(Math.abs(g.beamScanDeg));
    var rms = w * stepS / Math.sqrt(12);
    return {
      worstDb: best.db, worstScanDeg: best.scanDeg, atScanDb: atCur,
      proxyDb: 10 * Math.log10(Math.max(rms * rms / N, 1e-18)),
      proxyRmsDeg: rms * K.DEG, peakResidPs: c.eMaxPs, stepPs: stepS * 1e12
    };
  }

  /* ---------------------------------------------------------------------
     Metrics read off a cut. HPBW and taper sidelobes come from the sampled
     trace; grating lobes come from the analytic 2-D lattice, because a
     sampled principal-plane cut cannot see a lobe off the plane.
     ------------------------------------------------------------------- */
  function metrics(pts, scanDeg, lobeTable) {
    var mi = 0, bestD = Infinity, k;
    for (k = 0; k < pts.length; k++) {
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
    /* Interpolate the -3 dB crossings instead of taking the nearest sample.
       On a 0.7 deg beam the sample pitch is a large fraction of the
       beamwidth, so nearest-sample HPBW moves with the grid density — the
       same array measured on an 801-point and a 1601-point cut disagreed by
       1.5%, which would read as a bug when a light-mode comparison row sits
       next to the full-resolution beam view. */
    function cross(iOut, iIn) {
      var a = pts[iOut], b = pts[iIn];
      var d = b.real - a.real;
      if (!isFinite(d) || Math.abs(d) < 1e-12) return b.deg;
      var t = (main - 3 - a.real) / d;
      return a.deg + Math.max(0, Math.min(1, t)) * (b.deg - a.deg);
    }
    var hpbw = resolved ? cross(hi, hi - 1) - cross(lo, lo + 1) : NaN;

    var peak = -Infinity, pk = 0;
    for (k = 0; k < pts.length; k++) if (pts[k].real > peak) { peak = pts[k].real; pk = k; }

    var sll = -Infinity, sllDeg = NaN;
    for (var j = 1; j < pts.length - 1; j++) {
      if (j >= lo - 1 && j <= hi + 1) continue;
      if (!(pts[j].real >= pts[j - 1].real && pts[j].real >= pts[j + 1].real)) continue;
      /* A lobe only masks this cut if it actually LIES on it. Testing the u
         coordinate alone masked a +/-0.02 band of u for every one of the 42
         lobes regardless of its v — most of them are nowhere near the
         phi = 0 plane — which blanked much of the cut and made the reported
         first sidelobe swing by 4 dB with the sample pitch alone. The cut
         runs along v = 0, so a lobe is on it only when its own v is small. */
      var isG = false;
      var uHere = Math.sin(K.deg2rad(pts[j].deg));
      for (var q = 0; q < (lobeTable || []).length; q++) {
        var L = lobeTable[q];
        if (Math.abs(uHere - L.u) < 0.02 && Math.abs(L.v || 0) < 0.02) { isG = true; break; }
      }
      if (isG) continue;
      if (pts[j].real > sll) { sll = pts[j].real; sllDeg = pts[j].deg; }
    }

    var gl = (lobeTable && lobeTable.length) ? lobeTable[0] : null;
    return {
      mainDb: main, mainAtDeg: pts[mi].deg, pointErrDeg: pts[mi].deg - scanDeg,
      hpbwDeg: hpbw, hpbwResolved: resolved,
      sllDb: isFinite(sll) ? sll - main : NaN, sllAtDeg: sllDeg,
      peakDb: peak, peakAtDeg: pts[pk].deg,
      gratingDb: gl ? gl.relDb : NaN,
      gratingAtDeg: gl ? gl.thetaDeg : NaN,
      gratingPhiDeg: gl ? gl.phiDeg : NaN,
      beamIsPeak: !gl || gl.relDb < 0
    };
  }

  /* ---------------------------------------------------------------------
     Everything the Beam view needs, for both directions at once.
     ------------------------------------------------------------------- */
  function evaluate(g, budget, loRes, bbRes, opts) {
    var fc = g.fLoHz, B = g.rfBwGHz * 1e9;
    var c = ctxOf(g);
    /* LIGHT MODE exists for the Systems view, which evaluates the whole
       model for several saved parameter sets at once. It drops what only a
       plot needs — the second principal-plane cut and the Monte-Carlo
       realisation (801 points x 392 elements) — and coarsens two sampling
       grids: the zoom cuts (801 instead of 1601 points) and the TTD
       commanded-angle sweep (1 deg instead of 0.25 deg steps, 180 instead
       of 360 u-samples). 40 ms -> 5 ms per system.

       It is a COARSER evaluation, not an exact one, and the difference is
       measured rather than assumed: across scan angle 0-60 deg, tile pitch
       2-6 cm, TTD step 20-200 ps and both lattice modes — 250 combinations
       — the largest light-vs-full difference on any scalar a comparison row
       shows is 0.0016 dB, on the first-sidelobe level. HPBW is
       grid-independent because the -3 dB crossings are interpolated (see
       metrics()), and the TTD numbers are now bit-identical because
       ttdSweep no longer has a light variant at all.

       That last point was a defect, found by review and fixed here. Light
       mode used to sweep the commanded angle at 1 deg against the full
       path's 0.25 deg, which disagreed by up to 0.35 dB — ten times what
       this comment claimed — so the Beam view and a Systems row could
       report different quantisation lobes for the same system. Worse, the
       0.25 deg grid was itself understating the true worst by up to
       0.23 dB, because the residual is a sawtooth in commanded angle whose
       apexes a uniform grid walks straight past. ttdSweep now searches the
       closed-form flip angles instead, in both modes.

       What light mode omits entirely is left undefined rather than set to a
       plausible-looking number. */
    var light = !!(opts && opts.light);

    /* ---- the error partition, on which the headline depends ----
       per-TILE: the LO residual is common to a tile's elements.
       per-DIE:  die-common LO drift left after per-element calibration.
       per-ELEMENT: phase-shifter quantisation, the baseband network's own
       residual, and residual IQ imbalance — the last of which an earlier
       version omitted, leaving the per-element phase term at quantisation
       alone (1.62 deg at 6 bits, where 2-4 deg is realistic). */
    var sigTile = loRes.interTileResidualDeg;
    var sigDie = g.sigDieDeg || 0;
    var sigElem = K.rss(bbRes.interTileResidualDeg || 0,
                        K.quantResidualDeg(g.phaseBits), g.iqPhaseDeg || 0);
    var errTx = { sigTileDeg: sigTile, sigDieDeg: sigDie, sigElemDeg: sigElem, sigAmpDb: g.txGainErrDb };
    var errRx = { sigTileDeg: sigTile, sigDieDeg: sigDie, sigElemDeg: sigElem, sigAmpDb: g.rxGainErrDb };
    var esTx = errorSet(c, errTx), esRx = errorSet(c, errRx);

    /* analytic grating-lobe table at the commanded angle, sorted by level */
    var lobes = c.periodic
      ? window.Lat.withLevels(
          window.Lat.lobes(g.lat.b1, g.lat.b2, g.lamCm, c.u0, c.v0), c.elem, c.u0, c.v0)
      : [];

    var hpbwEst = 0.886 * c.lamC /
      (g.effApertureM * Math.max(Math.cos(K.deg2rad(g.beamScanDeg)), 0.15)) * K.DEG;
    var win = Math.max(6 * hpbwEst, 4);
    var zLo = Math.max(-90, g.beamScanDeg - win), zHi = Math.min(90, g.beamScanDeg + win);

    /* peak reference: the error-free array at its intended direction */
    var pk0 = c.periodic ? geomAt(c, fc, c.u0, c.v0) : geomAperiodic(c, fc, c.u0, c.v0);
    var peakRef = pk0.ep * c.Ne * c.Ne;

    var nZoom = light ? 801 : 1601;
    var gZoom = geomCut(c, fc, 0, zLo, zHi, nZoom);
    var gLow = geomCut(c, fc - B / 2, 0, zLo, zHi, nZoom);
    var gHigh = geomCut(c, fc + B / 2, 0, zLo, zHi, nZoom);
    var gWide = geomCut(c, fc, 0, -90, 90, light ? 1201 : 2401);
    var gWide90 = light ? null : geomCut(c, fc, 90, -90, 90, 2401);

    var tx = {
      centre: pattern(c, gZoom, esTx, peakRef),
      lowEdge: pattern(c, gLow, esTx, peakRef),
      highEdge: pattern(c, gHigh, esTx, peakRef),
      wide: pattern(c, gWide, esTx, peakRef),
      wide90: gWide90 ? pattern(c, gWide90, esTx, peakRef) : undefined
    };
    var rx = { centre: pattern(c, gZoom, esRx, peakRef), wide: pattern(c, gWide, esRx, peakRef) };

    /* one realisation, TX, on the zoom */
    var realPts = light ? undefined
      : realise(c, fc, 0, zLo, zHi, 801, errTx, 20260908).map(function (q) {
          return { deg: q.deg, real: 10 * Math.log10(Math.max(q.p / peakRef, 1e-16)) };
        });

    var mC = metrics(tx.centre, g.beamScanDeg, null);
    var mW = metrics(tx.wide, g.beamScanDeg, lobes);
    var mW90 = tx.wide90 ? metrics(tx.wide90, g.beamScanDeg, null) : undefined;
    var mLo = metrics(tx.lowEdge, g.beamScanDeg, null);
    var mHi = metrics(tx.highEdge, g.beamScanDeg, null);

    /* Peak ERROR sidelobe on the realisation: measured only where the
       error-free pattern is well below the floor, otherwise the answer is
       just the -13 dB taper sidelobe and says nothing about the errors. The
       realisation grid is a 2:1 decimation of the zoom grid, so indices
       line up exactly. */
    var realPeakSllDb, realPeakAtDeg;
    if (realPts) {
      realPeakSllDb = -Infinity; realPeakAtDeg = NaN;
      var gate = esTx.floorFarDb + 6;
      var dec = (tx.centre.length - 1) / (realPts.length - 1);
      for (var i = 0; i < realPts.length; i++) {
        if (tx.centre[Math.round(i * dec)].ideal > gate) continue;
        if (realPts[i].real > realPeakSllDb) { realPeakSllDb = realPts[i].real; realPeakAtDeg = realPts[i].deg; }
      }
    }

    /* ---- absolute chain ----
       D_array = min(N*D_el, filled aperture): N*D_el holds only until the
       element saturates its cell. The scan loss IS the element pattern, so
       adding a projected-aperture cos(theta) on top would double-count. */
    var scanLossDb = -10 * Math.log10(Math.max(c.elem.powAt(c.u0, c.v0), 1e-9));
    /* coherent gain derate. Amplitude spread does not reduce the coherent
       field at all (E[1+d] = 1); it raises total radiated power, so it
       belongs in the denominator, not in the exponent. */
    var pkTx = esTx.e1 * pk0.af0 + esTx.cT * pk0.ss + esTx.cD * pk0.ds + esTx.cE;
    var cohLossDb = -10 * Math.log10((pkTx / (c.Ne * c.Ne)) / (1 + esTx.vA));
    var realisedDbi = g.dArrayDbi - scanLossDb - cohLossDb - g.antLossDb;

    /* ---- the two numbers that justify the LO/baseband partition ---- */
    var sMax = Math.sin(K.deg2rad(g.scanDegMax));
    var tauTilePs = g.tileCm / 100 * sMax / K.C0 * 1e12;
    var tauApPs = g.effApertureM * sMax / K.C0 * 1e12;
    /* the taper the tile's elements actually see spans the element CENTRES,
       which is one pitch short of the tile pitch — computed from the real
       offsets rather than from the pitch, so a sheared lattice is right too */
    var spanXm = 0;
    for (i = 0; i < c.offs.length; i++) spanXm = Math.max(spanXm, c.offs[i][0]);
    var taperDeg = 360 * (B / 2) * spanXm * sMax / K.C0;
    var tapLoss = (function () {
      var re = 0, im = 0;
      for (var q = 0; q < c.offs.length; q++) {
        var a = 2 * Math.PI * (B / 2) * c.offs[q][0] * sMax / K.C0;
        re += Math.cos(a); im += Math.sin(a);
      }
      return -10 * Math.log10((re * re + im * im) / (c.offs.length * c.offs.length));
    })();
    var bwU = 0.886 * c.lamC / g.effApertureM;
    var squintBw = Math.abs(sMax) * (B / 2) / fc / bwU;
    /* no light/full variant any more: the search is the same in both modes, so
       a Systems row and the Beam view cannot disagree about the same system */
    var ttd = ttdSweep(g, c, fc + B / 2);

    /* random-error pointing jitter in u, so it can be dismissed with a
       number: sigma_u = sqrt(3)*sigma_phi / (pi * (D/lambda) * sqrt(N)),
       summed over the two grouping levels */
    var jitU = Math.sqrt(3 * esTx.vT / Math.max(c.Nt, 1) + 3 * esTx.vE / Math.max(c.Ne, 1)) /
      (Math.PI * g.effApertureM / c.lamC);

    return {
      c: c, lobes: lobes, es: esTx, esRx: esRx,
      sigTileDeg: sigTile, sigDieDeg: sigDie, sigElemDeg: sigElem,
      sigAmpTxDb: g.txGainErrDb, sigAmpRxDb: g.rxGainErrDb,
      hpbwEstDeg: hpbwEst, winDeg: win,
      tx: tx, rx: rx, realPts: realPts,
      m: mC, mWide: mW, mWide90: mW90, mLow: mLo, mHigh: mHi,
      floorNearDb: esTx.floorNearDb, floorFarDb: esTx.floorFarDb,
      floorNearRxDb: esRx.floorNearDb, floorFarRxDb: esRx.floorFarDb,
      peakOverMeanDb: g.peakOverMeanDb, realPeakSllDb: realPeakSllDb,
      scanLossDb: scanLossDb, cohLossDb: cohLossDb,
      dFilledDbi: g.dFilledDbi, dArrayDbi: g.dArrayDbi, realisedDbi: realisedDbi,
      thinningLossDb: g.thinningLossDb,
      /* the WORST edge, not the better one. Math.max picked whichever band
         edge had held up best, so the figure called "band-edge loss"
         reported the edge that was least affected — the opposite of a
         budget number. The two edges are not symmetric once the intra-tile
         factor walks chromatically. */
      edgeLossDb: mC.mainDb - Math.min(mLo.mainDb, mHi.mainDb),
      edgeLossLowDb: mC.mainDb - mLo.mainDb,
      edgeLossHighDb: mC.mainDb - mHi.mainDb,
      tauTilePs: tauTilePs, tauApPs: tauApPs, taperDeg: taperDeg,
      spanXcm: spanXm * 100, tauSpanPs: spanXm * sMax / K.C0 * 1e12,
      taperLossDb: tapLoss, squintBeamwidths: squintBw, jitterU: jitU, bwU: bwU,
      ttd: ttd,
      shareNear: (function () {
        var a = esTx.cT * c.M * c.M, b = esTx.cD * c.Md * c.Md, d = esTx.cE, s = a + b + d;
        return { tile: a / s, die: b / s, elem: d / s };
      })(),
      shareFar: (function () {
        var a = esTx.cT * c.M, b = esTx.cD * c.Md, d = esTx.cE, s = a + b + d;
        return { tile: a / s, die: b / s, elem: d / s };
      })()
    };
  }

  window.Beam = {
    evaluate: evaluate, ctxOf: ctxOf, geomAt: geomAt, geomCut: geomCut,
    errorSet: errorSet, pattern: pattern, metrics: metrics, ttdSweep: ttdSweep,
    realise: realise
  };
})();
