/* ============================================================================
   kernels.js — shared physics for the E-band distribution comparison.

   Everything here is closed-form and unit-annotated. The three rules the whole
   tool depends on are enforced in this file:

     (1) 20*log10 vs 10*log10. Phase multiplies, so an xM multiplier adds
         20*log10(M). Independent noise powers add, so n uncorrelated
         contributors add 10*log10(n). Both are separate functions below and
         are never interchanged.

     (2) Correlated vs uncorrelated. A shared source is common-mode across
         tiles and cancels in the inter-tile differential; independent
         oscillators do not. pnIntegrate() is therefore applied to a
         *differential* L(f) for beam metrics and to an *absolute* L(f) for
         link EVM. They are different numbers and different bands.

     (3) Static error vs drift vs irreducible noise. driftResidual() gives what
         BIST leaves behind; quantResidual() gives what a finite phase-shifter
         leaves behind; the phase-noise integral above the calibration loop
         bandwidth is irreducible. Reported separately, never summed into one
         misleading figure.

   Exposes window.K.
   ========================================================================= */
(function () {
  'use strict';

  var C0 = 299792458;            /* m/s */
  var DEG = 180 / Math.PI;
  /* Serial lane rate the tileSerdes block is priced at. A JESD204C/GTY-class
     lane in a mature node; both the lane COUNT and the block's area and power
     are quoted against this figure, so it belongs beside the block library's
     assumption rather than as a bare literal inside evalBb. */
  var SERDES_LANE_GBPS = 25;

  /* ------------------------------- units -------------------------------- */
  function db2lin(db) { return Math.pow(10, db / 10); }        /* power ratio */
  function lin2db(x) { return 10 * Math.log10(Math.max(x, 1e-300)); }
  function deg2rad(d) { return d * Math.PI / 180; }
  function rad2deg(r) { return r * DEG; }

  /* Phase multiplication by M: phase error and phase noise.
     phase error scales by M  ->  phase noise power by M^2  ->  +20log10(M) */
  function multDb(M) { return 20 * Math.log10(Math.max(M, 1e-12)); }
  /* n uncorrelated equal-power noise contributors: +10log10(n) */
  function uncorrDb(n) { return 10 * Math.log10(Math.max(n, 1e-12)); }

  /* ------------------------- transmission media -------------------------
     alpha(f) = aC*sqrt(f_GHz) + aD*f_GHz   [dB per cm]
       aC : conductor loss coefficient (skin effect, ~sqrt(f))
       aD : dielectric loss coefficient (~f, = 0.91*sqrt(epsEff)*tand per GHz)
     epsEff : effective permittivity -> delay = sqrt(epsEff)/c
     Coefficients are exposed as parameters so measured data can replace them.
     Values below are anchored where noted; see the provenance ledger.        */
  var MEDIA = {
    ro3003_gcpw: { name: 'RO3003 GCPW, 5 mil', aC: 0.0620, aD: 0.00170, epsEff: 2.35, roughness: 1.35 },
    ro3003_ms:   { name: 'RO3003 microstrip, 5 mil', aC: 0.0550, aD: 0.00138, epsEff: 2.30, roughness: 1.30 },
    ro4350_ms:   { name: 'RO4350B microstrip', aC: 0.0640, aD: 0.00520, epsEff: 2.85, roughness: 1.45 },
    siw_ro3003:  { name: 'SIW on RO3003', aC: 0.0210, aD: 0.00120, epsEff: 2.20, roughness: 1.20 },
    wr12:        { name: 'WR-12 waveguide', aC: 0.0055, aD: 0.00002, epsEff: 1.00, roughness: 1.10 },
    onchip_cmos: { name: 'On-chip TFMS, 65nm CMOS', aC: 0.5990, aD: 0.04120, epsEff: 3.90, roughness: 1.00 },
    onchip_sige: { name: 'On-chip TL, SiGe BiCMOS', aC: 0.5090, aD: 0.03500, epsEff: 3.80, roughness: 1.00 },
    stripline:   { name: 'Low-loss stripline (BB/ref)', aC: 0.0290, aD: 0.00210, epsEff: 3.60, roughness: 1.15 }
  };

  /* dB/cm at f (Hz). Roughness multiplies the conductor term only. */
  function lineAlphaDbCm(medium, fHz, override) {
    var m = typeof medium === 'string' ? MEDIA[medium] : medium;
    if (!m) return NaN;
    var aC = override && isFinite(override.aC) ? override.aC : m.aC;
    var aD = override && isFinite(override.aD) ? override.aD : m.aD;
    var kr = override && isFinite(override.roughness) ? override.roughness : (m.roughness || 1);
    var fG = Math.max(fHz, 1) / 1e9;
    return kr * aC * Math.sqrt(fG) + aD * fG;
  }

  /* one-way delay, ps per cm */
  function lineDelayPsCm(medium, override) {
    var m = typeof medium === 'string' ? MEDIA[medium] : medium;
    var e = override && isFinite(override.epsEff) ? override.epsEff : (m ? m.epsEff : 1);
    return 0.01 * Math.sqrt(e) / C0 * 1e12;
  }

  /* micrometres of physical length per degree of phase at fHz in this medium.
     This is the mechanical-tolerance yardstick for the whole study. */
  function umPerDeg(fHz, epsEff) {
    var lambda0 = C0 / fHz;                        /* m */
    var lambdaG = lambda0 / Math.sqrt(epsEff);     /* m */
    return lambdaG / 360 * 1e6;
  }

  /* phase (deg) at fHz produced by a physical length error dL (um) */
  function degFromLengthUm(dLum, fHz, epsEff) {
    return dLum / umPerDeg(fHz, epsEff);
  }

  /* --------------------------- reference source ---------------------------
     L_ref given as datasheet points at 1k/10k/100k plus a far-out floor;
     log-log interpolated / extrapolated. Lets a real datasheet be pasted in
     instead of trusting a slope model.                                      */
  function refPnDbc(fOff, p) {
    var pts = [[1e3, p.ref1k], [1e4, p.ref10k], [1e5, p.ref100k]];
    var L;
    if (fOff <= pts[0][0]) {
      /* extrapolate the 1k..10k slope inward, capped at 1/f^3 (-30 dB/dec) */
      var s0 = (pts[1][1] - pts[0][1]) / (Math.log10(pts[1][0]) - Math.log10(pts[0][0]));
      s0 = Math.max(s0, -30);
      L = pts[0][1] + s0 * (Math.log10(Math.max(fOff, 1)) - Math.log10(pts[0][0]));
    } else if (fOff >= pts[2][0]) {
      var s2 = (pts[2][1] - pts[1][1]) / (Math.log10(pts[2][0]) - Math.log10(pts[1][0]));
      L = pts[2][1] + s2 * (Math.log10(fOff) - Math.log10(pts[2][0]));
    } else {
      var i = fOff < pts[1][0] ? 0 : 1;
      var t = (Math.log10(fOff) - Math.log10(pts[i][0])) / (Math.log10(pts[i + 1][0]) - Math.log10(pts[i][0]));
      L = pts[i][1] + t * (pts[i + 1][1] - pts[i][1]);
    }
    /* far-out floor adds in power */
    return lin2db(db2lin(L) + db2lin(p.refFloor));
  }

  /* Scale a reference-source PN profile from its characterised frequency to
     another frequency of the same technology class: +20log10(f2/f1). */
  function refScaleDb(fRefHz, fCharHz) {
    return 20 * Math.log10(Math.max(fRefHz, 1) / Math.max(fCharHz, 1));
  }

  /* ------------------------------ oscillator ------------------------------
     Standard oscillator FOM:
       FOM = L(df) - 20log10(f0/df) + 10log10(Pdc/1mW)
     so  L(df) = FOM + 20log10(f0/df) - 10log10(Pdc/1mW),
     plus a 1/f^3 region below the corner fc3.                              */
  function vcoPnDbc(fOff, f0, fomDbc, pdcMw, fc3) {
    if (fOff <= 0) return 0;
    var L2 = fomDbc + 20 * Math.log10(f0 / fOff) - 10 * Math.log10(Math.max(pdcMw, 1e-6));
    /* 1/f^3 corner: below fc3 the noise rises an extra 10dB/dec */
    return L2 + 10 * Math.log10(1 + fc3 / fOff);
  }

  /* ---------------------------- PLL in-band ------------------------------
     Industry-standard normalised in-band floor:
       L_inband = FOM_pll + 10log10(f_pfd) + 20log10(N),   N = f_out/f_pfd
     which is identically  FOM_pll + 20log10(f_out) - 10log10(f_pfd):
     raising f_pfd (lowering N) buys 10 dB per decade of f_pfd.            */
  function pllFloorDbc(fOutHz, fPfdHz, fomPll) {
    return fomPll + 20 * Math.log10(fOutHz) - 10 * Math.log10(Math.max(fPfdHz, 1));
  }

  /* PLL in-band 1/f (flicker), normalised to 1 Hz offset at a 1 GHz carrier */
  function pllFlickerDbc(fOff, fOutHz, normDbc) {
    if (fOff <= 0) return 0;
    return normDbc - 10 * Math.log10(fOff) + 20 * Math.log10(fOutHz / 1e9);
  }

  /* --------------------------- loop transfer -----------------------------
     Type-II 2nd-order loop, natural frequency wn, damping zeta:
       |H|^2   = (1 + 4 z^2 u^2) / ((1-u^2)^2 + 4 z^2 u^2),  u = w/wn
       |1-H|^2 = u^4 / ((1-u^2)^2 + 4 z^2 u^2)
     Parameterised by the -3 dB closed-loop bandwidth fc, with the exact
     fc/fn relation (u3 solves u^4 - u^2(2+4z^2) - 1 = 0).                  */
  function loopFnFromBw(fcHz, zeta) {
    var a = 2 + 4 * zeta * zeta;
    var x = (a + Math.sqrt(a * a + 4)) / 2;
    return fcHz / Math.sqrt(x);
  }
  function loopMags(fOff, fnHz, zeta) {
    var u = fOff / Math.max(fnHz, 1e-9);
    var u2 = u * u;
    var den = (1 - u2) * (1 - u2) + 4 * zeta * zeta * u2;
    if (den <= 0) den = 1e-30;
    return {
      H2: (1 + 4 * zeta * zeta * u2) / den,     /* reference / in-band shaping */
      S2: (u2 * u2) / den                       /* VCO high-pass shaping       */
    };
  }

  /* ------------------------- additive (residual) PN ----------------------
     Amplifier / buffer / multiplier residual phase noise:
       L(f) = floor_linear * (1 + fCorner/f)
     n cascaded stages with independent noise: power adds, +10log10(n).     */
  function additivePnDbc(fOff, floorDbc, fCornerHz, nStages) {
    if (fOff <= 0) return 0;
    var lin = db2lin(floorDbc) * (1 + fCornerHz / fOff);
    return lin2db(lin * Math.max(nStages || 1, 1));
  }

  /* --------------------------- PN integration ----------------------------
     Single-sideband L(f) -> RMS phase error:
        phi_rms^2 = 2 * integral_{f1}^{f2} L_linear(f) df      [rad^2]
     The factor 2 converts single-sideband L(f) to the double-sideband phase
     PSD. Omitting it understates every phase error by 1.5 dB.

     Integration uses the PIECEWISE POWER-LAW segment rule, not a trapezoid:
     on a log grid a chord badly overestimates a convex -30 dB/dec region.
     Within a segment, S = S1*(f/f1)^p with p = ln(S2/S1)/ln(f2/f1):
        p != -1 :  S1*f1/(p+1) * ((f2/f1)^(p+1) - 1)
        p == -1 :  S1*f1*ln(f2/f1)              <- a -10 dB/dec segment, and
     a very common one in PLL in-band regions, so the branch is required.   */
  function pnIntegrateLin(Lfun, f1, f2, nPts) {
    if (!(f2 > f1) || f1 <= 0) return 0;
    var n = Math.max(24, nPts || 300);
    var l1 = Math.log10(f1), l2 = Math.log10(f2);
    var sum = 0;
    var fa = f1, Sa = db2lin(Lfun(f1));
    for (var i = 1; i <= n; i++) {
      var fb = Math.pow(10, l1 + (l2 - l1) * i / n);
      var Sb = db2lin(Lfun(fb));
      var ratio = fb / fa;
      if (ratio > 1 + 1e-15 && Sa > 0 && Sb > 0) {
        var p = Math.log(Sb / Sa) / Math.log(ratio);
        if (Math.abs(p + 1) < 1e-9) sum += Sa * fa * Math.log(ratio);
        else sum += Sa * fa / (p + 1) * (Math.pow(ratio, p + 1) - 1);
      } else if (ratio > 1) {
        sum += 0.5 * (Sa + Sb) * (fb - fa);            /* a zero endpoint */
      }
      fa = fb; Sa = Sb;
    }
    return Math.max(sum, 0);
  }
  /* -> RMS phase error in radians, including the factor of 2 */
  function pnIntegrateRad(Lfun, f1, f2, nPts) {
    return Math.sqrt(2 * pnIntegrateLin(Lfun, f1, f2, nPts));
  }

  /* RMS jitter from RMS phase error at a carrier */
  function jitterS(phiRad, fCarrierHz) { return phiRad / (2 * Math.PI * fCarrierHz); }

  /* ------------------- correlation / calibration kernels -----------------
     These three kernels are the heart of the comparison. Applying the wrong
     one to the wrong noise class is the single fastest way to get a wrong
     architectural answer.                                                  */

  /* Degrees of phase at fHz per picosecond of delay. 28.08 deg/ps at 78 GHz.
     Skew is accumulated in the TIME domain and converted ONCE, at the end,
     at the output frequency — never at an intermediate frequency and then
     multiplied by M, which double-counts the multiplication. */
  function degPerPs(fHz) { return 360 * fHz * 1e-12; }

  /* UNCORRELATED noise, corrected by a sample-and-hold ("apply the last
     measurement") calibrator of update period T. The residual transfer is
        W(f,T) = E|1 - e^{-j 2 pi f d}|^2  with d ~ U[0,T]
               = 2 * (1 - sin(2 pi f T)/(2 pi f T))
     Note W -> 2, not 1, well above 1/T: a corrector INJECTS the
     high-frequency content of its own samples, so calibration is not free
     above its bandwidth. W = 1 at f = 0.3017/T, which is the honest
     definition of the calibration corner. */
  function zohKernel(fHz, tUpdateS) {
    var x = 2 * Math.PI * fHz * tUpdateS;
    if (!(x > 1e-3)) return x * x / 3;          /* sin(x)/x cancels below ~1e-3 */
    return 2 * (1 - Math.sin(x) / x);
  }
  function calCornerHz(tUpdateS) { return 0.3017 / Math.max(tUpdateS, 1e-12); }

  /* CORRELATED (shared-source) noise across a path delay mismatch dTau.
     It does NOT cancel perfectly — the residual is
        D(f) = |1 - e^{-j 2 pi f dTau}|^2 = 4 sin^2(pi f dTau)
     which is -64 dB at 1 MHz for 100 ps but only -4.2 dB at 1 GHz. This is
     why skew still matters with a shared LO, and why the answer depends
     explicitly on the upper integration limit. */
  function decorrKernel(fHz, dTauS) {
    var s = Math.sin(Math.PI * fHz * dTauS);
    return 4 * s * s;
  }

  /* Differential statistics of N nominally identical independent sources.
     PAIRWISE (tile i vs tile j):        var = 2 * var_single   (+3.01 dB)
     MEAN-REFERRED (tile i vs array mean): var = ((N-1)/N) * var_single
     The mean-referred figure is what beamforming sees, and it is ~3 dB BELOW
     the pairwise number. Quoting pairwise as "the array phase error" is
     pessimistic by 3 dB; the two are routinely confused. */
  function pairwiseFactor() { return Math.SQRT2; }
  function meanReferredFactor(n) { return Math.sqrt(Math.max(n - 1, 0) / Math.max(n, 1)); }

  /* ------------------------------ beam metrics ---------------------------- */

  /* half-power beamwidth of a uniformly illuminated aperture, degrees */
  function hpbwDeg(apertureM, lambdaM, scanDeg) {
    var c = Math.cos(deg2rad(scanDeg || 0));
    return 0.886 * lambdaM / (apertureM * Math.max(c, 0.1)) * DEG;
  }

  /* Ruze: G/G0 = exp(-sigma^2) for random phase error, sigma in radians.
     Returned as a positive loss in dB. */
  function ruzeLossDb(sigmaRad) { return 10 * Math.log10(1 / Math.exp(-sigmaRad * sigmaRad)); }

  /* combined random phase + amplitude error gain loss, dB (positive) */
  function gainLossDb(sigmaRad, ampSigmaDb) {
    var ea = ampSigmaDb ? Math.pow(db2lin(ampSigmaDb / 2) - 1, 2) : 0;  /* voltage-ratio variance */
    return 10 * Math.log10((1 + ea) / Math.exp(-sigmaRad * sigmaRad));
  }

  /* THE DECISIVE METRIC. Scattered ("coherence floor") sidelobe level and
     null depth from random phase errors, relative to the error-free peak:
        P_sl / P_peak = sigma^2 / N_indep
     N_indep is the number of INDEPENDENT radiating groups. Errors common
     within a tile and independent between tiles make N_indep the TILE count,
     not the element count — which is why a per-tile LO error is far more
     damaging than a per-element one.

     This, not Ruze gain loss, decides the architecture: 4.2 deg RMS costs
     only 0.023 dB of directivity but sets a hard floor on null depth and
     therefore caps the achievable spatial-multiplexing SINR. */
  function rmsSllDb(sigmaRad, nIndep) {
    if (!(nIndep > 0) || sigmaRad <= 0) return -Infinity;
    return 10 * Math.log10(sigmaRad * sigmaRad / nIndep);
  }

  /* Beam pointing error from a deterministic linear phase ramp across the
     aperture. dPhiTotalDeg is the end-to-end phase error across D.
       d(sin th) = dPhi_rad * lambda / (2 pi D)  ->  dth = that / cos(th)   */
  function pointingFromRampDeg(dPhiTotalDeg, apertureM, lambdaM, scanDeg) {
    var c = Math.cos(deg2rad(scanDeg || 0));
    return dPhiTotalDeg * lambdaM / (2 * Math.PI * apertureM * Math.max(c, 0.1));
  }

  /* Pointing jitter from RANDOM per-tile phase errors: least-squares slope of
     N samples spread over D has variance sigma^2 / (N D^2/12). */
  function pointingFromRandomDeg(sigmaDeg, nTiles, apertureM, lambdaM, scanDeg) {
    var c = Math.cos(deg2rad(scanDeg || 0));
    return sigmaDeg * Math.sqrt(12) * lambdaM /
      (2 * Math.PI * Math.sqrt(Math.max(nTiles, 1)) * apertureM * Math.max(c, 0.1));
  }

  /* Pointing error of a DAISY CHAIN. Its per-hop errors form a random WALK
     along the aperture, whose dominant spatial mode is a tilt — so the iid
     formula above does not apply and understates it badly. The equivalent
     end-to-end tilt of a walk with per-hop sigma_nu over N hops is
     sigma_nu*sqrt(1.2*N), against sigma*sqrt(12/N) for iid errors: worse by
     ~N/3.16, i.e. 31.6x at N = 100. */
  function pointingFromWalkDeg(sigmaHopDeg, nHops, apertureM, lambdaM, scanDeg) {
    var tiltDeg = sigmaHopDeg * Math.sqrt(1.2 * Math.max(nHops, 1));
    return pointingFromRampDeg(tiltDeg, apertureM, lambdaM, scanDeg);
  }
  /* RMS about the mean of a random walk of n steps, per step sigma:
     sqrt((n^2-1)/(6n)) ~ sqrt(n/6). Also the daisy chain's estimator
     conditioning factor G — the reason its low measurement count is
     misleading. */
  function walkRmsFactor(n) {
    if (n < 2) return 0;
    return Math.sqrt((n * n - 1) / (6 * n));
  }

  /* Squint angle over the signal band for phase-only steering:
       dtheta ~ theta * (B/2) / fc      (proposal Eq. 6)                    */
  function squintDeg(scanDeg, bwHz, fcHz) { return scanDeg * (bwHz / 2) / fcHz; }

  /* Geometric delay across a length L at a scan angle (proposal Eq. 9/10) */
  function apertureDelayPs(lengthM, scanDeg) {
    return lengthM * Math.sin(deg2rad(scanDeg)) / C0 * 1e12;
  }

  /* Gain loss from an UNCOMPENSATED inter-tile delay spread over bandwidth B.
     Band-averaged coherent-sum loss with per-tile phase error 2*pi*df*tau:
       G = (1/B) * integral_{-B/2}^{B/2} exp(-(2 pi df sigma_tau)^2) d(df)
     Evaluated numerically (the small-angle form breaks well before 3 dB).  */
  function squintLossDb(sigmaTauS, bwHz) {
    if (!(sigmaTauS > 0) || !(bwHz > 0)) return 0;
    var n = 64, acc = 0;
    for (var i = 0; i <= n; i++) {
      var df = -bwHz / 2 + bwHz * i / n;
      var s = 2 * Math.PI * df * sigmaTauS;
      acc += Math.exp(-s * s) * (i === 0 || i === n ? 0.5 : 1);
    }
    var g = acc / n;
    return -10 * Math.log10(Math.max(g, 1e-12));
  }

  /* EVM from RMS phase error. Exact for a pure phase perturbation:
       EVM_rms = sqrt( E|e^{j phi} - 1|^2 ) = sqrt(2(1 - exp(-sigma^2/2)))  */
  function evmPctFromPhi(sigmaRad) {
    return 100 * Math.sqrt(Math.max(2 * (1 - Math.exp(-sigmaRad * sigmaRad / 2)), 0));
  }

  /* EVM in dB. EVM is an AMPLITUDE (voltage) ratio, so the factor is 20:
        EVM_dB = 20*log10(EVM_rms)          EVM_rms as a fraction
     Equivalently EVM^2 is an error-power to signal-power ratio, so
     10*log10(EVM^2) gives the same number. Using 10*log10 on the amplitude
     is the classic error and halves every figure: 8% would read -10.97 dB
     instead of -21.94 dB, loosening every ceiling by ~11 dB.
     More negative is better — the opposite sense to the percent figure.
     Note the unit is dB, not dBc: EVM references the constellation
     amplitude, not a carrier. */
  function evmDb(evmPct) {
    if (!isFinite(evmPct)) return NaN;
    if (evmPct <= 0) return -Infinity;
    return 20 * Math.log10(evmPct / 100);
  }
  function evmPctFromDb(db) { return 100 * Math.pow(10, db / 20); }

  /* Straight from phase, one log and no sqrt: the argument is already EVM^2,
     a power ratio, so 10*log10 is correct here and is not an exception to
     the rule above. */
  function evmDbFromPhi(sigmaRad) {
    return 10 * Math.log10(Math.max(2 * (1 - Math.exp(-sigmaRad * sigmaRad / 2)), 1e-30));
  }
  /* Exact inverse. Saturates at +3.0103 dB (EVM -> sqrt2), above which no
     pure phase error can produce that EVM. */
  function phiFromEvmDb(db) {
    var x = Math.pow(10, db / 10);
    if (!(x < 2)) return Infinity;
    return Math.sqrt(Math.max(-2 * Math.log(1 - x / 2), 0));
  }

  /* An evmShare of 0.3 multiplies the LINEAR EVM, so in dB it is an offset of
     20*log10(0.3) = -10.46 dB. It is NOT -5.23 dB (that is 10*log10(0.3),
     exactly half, and the likeliest mistake — it would loosen every LO budget
     by a factor of 1.83 in error amplitude), and dB budgets take no
     percentage subtraction at all. Isolated here so there is one place to be
     wrong. This is an AMPLITUDE share: the LO then takes share^2 = 9% of the
     error power, which is deliberately conservative. */
  function shareDb(share) { return 20 * Math.log10(Math.max(share, 1e-6)); }
  function phiFromEvmPct(evmPct) {
    var e = evmPct / 100;
    var arg = 1 - e * e / 2;
    if (arg <= 0) return Infinity;
    return Math.sqrt(Math.max(-2 * Math.log(arg), 0));
  }

  /* TOTAL-system EVM ceilings by modulation order — the whole TX + channel +
     RX chain at the demodulator, including PA nonlinearity, ADC/DAC noise,
     IQ imbalance and channel-estimation error, NOT just the LO. The LO is
     allocated only `evmShare` of this. Never show an LO-only EVM beside an
     unshared ceiling.
     Provenance differs by row, which matters once these appear as tidy dB
     figures: rows 1-4 are 3GPP TS 38.104 / TS 36.104, but the 1024QAM row is
     IEEE 802.11ax MCS11 (-35 dB RCE), which is 2.85 dB STRICTER than
     3GPP's 2.5% for the same constellation. */
  var QAM_EVM = [
    { order: 4,    name: 'QPSK',    evm: 17.5, src: '3GPP TS 38.104' },
    { order: 16,   name: '16QAM',   evm: 12.5, src: '3GPP TS 38.104' },
    { order: 64,   name: '64QAM',   evm: 8.0,  src: '3GPP TS 38.104' },
    { order: 256,  name: '256QAM',  evm: 3.5,  src: '3GPP TS 38.104' },
    { order: 1024, name: '1024QAM', evm: 1.8,  src: 'IEEE 802.11ax MCS11; 3GPP allows 2.5%' }
  ];
  /* derived, so the dB and percent columns cannot drift apart */
  QAM_EVM.forEach(function (q) { q.evmDb = 20 * Math.log10(q.evm / 100); });

  /* Highest constellation an LO-only EVM can support. Un-applying the share
     is a SUBTRACTION of a negative, i.e. it adds 10.46 dB, scaling the
     LO figure up to a total-system equivalent. The comparator stays <= and
     "lower is better" still holds, because 20*log10 is monotone increasing —
     no inequality flips under the conversion. */
  function maxQamFromDb(evmDbVal, share) {
    if (!isFinite(evmDbVal)) return '—';
    var budgetDb = evmDbVal - shareDb(share);
    var best = null;
    QAM_EVM.forEach(function (q) { if (budgetDb <= q.evmDb) { if (!best || q.order > best.order) best = q; } });
    return best ? best.name : '< QPSK';
  }
  function evmLimitDbForQam(name, share) {
    for (var i = 0; i < QAM_EVM.length; i++) {
      if (QAM_EVM[i].name === name) return QAM_EVM[i].evmDb + shareDb(share);
    }
    return QAM_EVM[2].evmDb + shareDb(share);
  }
  /* percent forms kept for the parenthetical readouts */
  function maxQam(evmPct, share) { return maxQamFromDb(evmDb(evmPct), share); }
  function evmLimitForQam(name, share) {
    for (var i = 0; i < QAM_EVM.length; i++) if (QAM_EVM[i].name === name) return QAM_EVM[i].evm * share;
    return QAM_EVM[2].evm * share;
  }

  /* ------------------------- calibration residuals -----------------------
     Static error  -> removed once, leaves quantisation only.
     Slow drift    -> tracked at period T by a sample-and-hold correction.
                      The error ramps 0 -> rate*T within each interval, so
                      RMS over the interval is rate*T/sqrt(3). Estimator
                      noise adds in quadrature and improves as 1/sqrt(n),
                      n = T*fMeas measurements averaged per update, giving a
                      genuine optimum update period.
     Fast noise    -> irreducible; integrate L(f) above the loop bandwidth. */
  /* Drift left by a first-order corrector of gain mu updating every T.
     Two things this used to get wrong.

     (1) It had no mu. The drift term was rate*T/sqrt(3), which is the RMS of
     a sawtooth reset to ZERO at every update — the deadbeat mu = 1 case —
     while the rest of the calibration model runs at mu = 0.3. A real loop
     e[k+1] = (1-mu)(e[k] + rate*T) settles to a standing lag of
     (1-mu)*rate*T/mu just after an update, ramping to rate*T/mu just before
     the next, so the interval RMS is rate*T*sqrt(a^2 + a + 1/3) with
     a = (1-mu)/mu. At mu = 0.3 that is 2.848*rate*T, 4.93x the old value; at
     mu = 1 it collapses to 1/sqrt(3) and the documented case is unchanged.
     Without it, mu appeared in the residual only through terms mu makes
     worse, so the model's optimum was always the smallest allowed mu.

     (2) It also carried the BIST measurement noise, sigma/sqrt(nAvg), which
     the caller ALREADY adds as injDeg with the correct closed-loop transfer
     sigma*sqrt(mu/(2-mu)/nAvg) — and with the xM referral this copy never
     got. The same noise was RSS'd into one number twice, and at defaults it
     was 80% of what the row labelled "drift residual" reported (0.0335 deg
     of measurement noise against 0.0167 deg of actual drift). It belongs to
     injDeg alone; this kernel now returns drift only. */
  function driftResidualDeg(rateDegPerS, tUpdateS, mu) {
    var m = (mu > 0 && mu <= 1) ? mu : 1;
    var a = (1 - m) / m;
    return rateDegPerS * tUpdateS * Math.sqrt(a * a + a + 1 / 3);
  }
  /* T that minimises drift-plus-noise for a loop of gain mu:
       T^3 = sigma1^2 / (2*c(mu)*rate^2*fMeas),  c(mu) = a^2 + a + 1/3
     which is the old 3*sigma^2/(2*rate^2*fMeas) at mu = 1. */
  function optimalUpdatePeriodS(rateDegPerS, measNoiseDeg1, fMeasHz, mu) {
    if (!(rateDegPerS > 0)) return Infinity;
    var m = (mu > 0 && mu <= 1) ? mu : 1;
    var a = (1 - m) / m;
    var c = a * a + a + 1 / 3;
    return Math.cbrt(measNoiseDeg1 * measNoiseDeg1 /
      (2 * c * rateDegPerS * rateDegPerS * Math.max(fMeasHz, 1e-9)));
  }
  /* b-bit phase shifter over 360 deg: uniform LSB -> LSB/sqrt(12) */
  function quantResidualDeg(bits) { return (360 / Math.pow(2, bits)) / Math.sqrt(12); }
  /* coarse delay element with a given step, ps RMS residual */
  function quantResidualPs(stepPs) { return stepPs / Math.sqrt(12); }

  /* ---------------------------- skew statistics --------------------------
     Independent contributors combine RSS. For an array of N nominally equal
     paths, the expected peak-to-RMS factor of a Gaussian population is
     approximately sqrt(2 ln N) (one-sided), used for the peak column.      */
  function rss() {
    var s = 0;
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (isFinite(v)) s += v * v;
    }
    return Math.sqrt(s);
  }
  function peakFactor(n) { return Math.sqrt(2 * Math.log(Math.max(n, 2))); }

  /* ------------------------------------------------------------------ *
   * B5 serial link sizing. Two rails (I and Q) at `bits` resolution and
   * `gspsPerRail` samples per second, carried with 64b/66b line coding.
   * ONE DIRECTION.
   *
   * These live here rather than inline in evalBb because the BOM in
   * topology.js needs the same lane count that the power model uses, and
   * the tileSerdes block is priced PER LANE. When the two disagreed the
   * BOM booked 2 lanes while the model computed 3, so B5's SerDes area was
   * under-counted threefold — in the one family where die area is the
   * argument. A shared kernel is the only way that stays true.
   * ------------------------------------------------------------------ */
  function serdesLaneGbps(bits, gspsPerRail) {
    return 2 * Math.max(bits, 1) * Math.max(gspsPerRail, 0) * (66 / 64);
  }
  function serdesLanes(bits, gspsPerRail, laneRateGbps) {
    var rate = laneRateGbps > 0 ? laneRateGbps : SERDES_LANE_GBPS;
    return Math.max(1, Math.ceil(serdesLaneGbps(bits, gspsPerRail) / rate));
  }

  /* Random errors in S segments in series accumulate as sqrt(S).
     A daisy chain additionally accumulates the MEAN hop delay linearly. */
  function seriesRandom(perSegment, nSegments) { return perSegment * Math.sqrt(Math.max(nSegments, 0)); }

  /* Thermal delay drift. TCdelay ~ CTE + 0.5*|TCDk| (ppm/K); a path of
     electrical length Ndeg degrees drifts Ndeg*TC*dT degrees.              */
  function thermalDriftDegPerK(lengthCm, fHz, epsEff, tcPpmPerK) {
    var elecDeg = lengthCm / (umPerDeg(fHz, epsEff) / 1e4);   /* deg per cm -> total */
    return elecDeg * tcPpmPerK * 1e-6;
  }

  /* ------------------------------ networks -------------------------------- */
  /* ideal N-way power split/combine loss (dB), plus per-junction excess */
  function splitLossDb(nWay, excessPerJunctionDb) {
    if (nWay <= 1) return 0;
    var levels = Math.log2(nWay);
    return 10 * Math.log10(nWay) + levels * (excessPerJunctionDb || 0);
  }
  /* resistive (non-Wilkinson) 2-way divider is 6 dB not 3 dB per split */
  function resistiveSplitLossDb(nWay) {
    if (nWay <= 1) return 0;
    return 20 * Math.log10(nWay);
  }
  /* -------------------------- baseband-specific ---------------------------
     A baseband delay is a GROUP-DELAY / squint error at the baseband edge
     frequency, NOT an LO phase error. 10 ps of baseband skew is 3.6 deg at
     a 1 GHz rail edge — not 281 deg. Converting baseband delay to degrees at
     78 GHz inflates the B-family numbers by a factor of 78 and is the most
     common error in this comparison. */
  function bbSkewDegAtEdge(tauPs, fEdgeHz) { return 360 * fEdgeHz * tauPs * 1e-12; }

  /* Beam steer from an uncompensated baseband delay ramp, across the band:
       sin(dtheta) = 2 * df * dtau
     Deterministic, so single-frequency phase calibration removes it AT THE
     CALIBRATION FREQUENCY ONLY. Across the band it survives as a pure
     frequency-dependent steer that only true time delay can remove. */
  function bbRampSteerDeg(dTauPs, bwHz) {
    var s = 2 * (bwHz / 2) * dTauPs * 1e-12;
    if (Math.abs(s) >= 1) return 90 * Math.sign(s);
    return Math.asin(s) * DEG;
  }

  /* Output-referred noise of an n-level ACTIVE tree with coherent 2x signal
     addition per level. A cell's own noise is attenuated by 2 per level
     above it while the signal is not, so the total is
        v_nc^2 * (2 - 2^(1-n))
     bounded at 2x ONE cell for any N. Naive Friis overstates a 6-level tree
     by ~3x. Returned as a multiplier on one cell's noise power. */
  function activeTreeNoiseFactor(nLevels) {
    if (nLevels < 1) return 0;
    return 2 - Math.pow(2, 1 - nLevels);
  }
  /* Array-referred penalty of a fixed post-combiner noise: array gain shrinks
     the element noise while the tree's noise stays put, so the penalty grows
     as N. vRatio = v_ncell / v_in (per element, at the tree input). */
  function treeNoisePenaltyDb(nPorts, nLevels, vRatio) {
    var pen = 1 + nPorts * vRatio * vRatio * activeTreeNoiseFactor(nLevels);
    return 10 * Math.log10(Math.max(pen, 1));
  }

  /* Cascaded IIP3 of n identical unity-gain stages: 1/P_tot = sum(1/P_j),
     giving -10*log10(n) — NOT -20*log10(n), which would double the
     requirement and wrongly kill a feasible 3-4 level tree. */
  function cascadeIip3PenaltyDb(nStages) { return 10 * Math.log10(Math.max(nStages, 1)); }

  /* Friis cascade: stages = [{nfDb, gainDb}] -> total NF in dB.
     Correct for a SERIES cascade. Do not use it for the active tree above. */
  function friisNfDb(stages) {
    var f = 1, g = 1;
    for (var i = 0; i < stages.length; i++) {
      var fi = db2lin(stages[i].nfDb);
      f += (fi - 1) / g;
      g *= db2lin(stages[i].gainDb);
    }
    return lin2db(f);
  }
  /* repeaters needed to hold a segment below maxSegLossDb over a length */
  function repeaterCount(lengthCm, alphaDbCm, maxSegLossDb) {
    var total = lengthCm * alphaDbCm;
    if (!(maxSegLossDb > 0)) return 0;
    return Math.max(0, Math.ceil(total / maxSegLossDb) - 1);
  }

  /* ==========================================================================
     THE RADIO LINK.

     Everything above describes what the array does to its own signal. This
     block is the only part of the tool that puts the array in front of a
     path, and it exists because the question a committee asks first —
     "what range does this give you, in rain?" — could not be answered at
     all before.

     E-band is a rain-limited band, and that is not a detail: at 78 GHz a
     25 mm/h rain cell costs about 10 dB per kilometre, which is thirty
     times the gaseous absorption over the same kilometre. Anything that
     ignores rain is describing a different radio.
     ====================================================================== */

  /* Free-space path loss. The 92.45 constant is for GHz and km. */
  function fsplDb(fGHz, dKm) {
    if (!(fGHz > 0) || !(dKm > 0)) return NaN;
    return 92.45 + 20 * Math.log10(fGHz) + 20 * Math.log10(dKm);
  }

  /* Gaseous absorption, ITU-R P.676. E-band sits in the window between the
     60 GHz oxygen complex and the 183 GHz water line, so the figure is
     small and slowly varying: about 0.3-0.5 dB/km at sea level, 7.5 g/m^3
     water vapour, 15 C. Linear interpolation over that window is well
     inside the spread between atmospheres, and the parameter is editable
     for anyone who wants a real P.676 run. */
  var GAS_TABLE = [
    { f: 60, a: 15.0 },   /* oxygen line — here only so the shape is visible */
    { f: 70, a: 0.50 },
    { f: 80, a: 0.38 },
    { f: 90, a: 0.42 },
    { f: 100, a: 0.50 }
  ];
  function gasAbsDbPerKm(fGHz) {
    var t = GAS_TABLE;
    if (fGHz <= t[1].f) return t[1].a;           /* do not extrapolate into the O2 line */
    for (var i = 1; i < t.length - 1; i++) {
      if (fGHz <= t[i + 1].f) {
        var u = (fGHz - t[i].f) / (t[i + 1].f - t[i].f);
        return t[i].a + u * (t[i + 1].a - t[i].a);
      }
    }
    return t[t.length - 1].a;
  }

  /* ITU-R P.838-3 specific-attenuation coefficients. Tabulated at the
     frequencies that bracket E-band; log-log interpolation in k and linear
     in alpha is what the Recommendation itself prescribes between its
     tabulated points. Horizontal polarisation is the worse case and is the
     default, which is the conservative choice and is stated as such. */
  var RAIN_TABLE = [
    { f: 60, kH: 0.8606, aH: 0.7656, kV: 0.8515, aV: 0.7486 },
    { f: 70, kH: 0.9865, aH: 0.7302, kV: 0.9751, aV: 0.7215 },
    { f: 80, kH: 1.0217, aH: 0.7051, kV: 1.0195, aV: 0.6997 },
    { f: 90, kH: 1.0258, aH: 0.6849, kV: 1.0419, aV: 0.6820 },
    { f: 100, kH: 1.0197, aH: 0.6690, kV: 1.0480, aV: 0.6674 }
  ];
  function rainCoeffs(fGHz, pol) {
    var t = RAIN_TABLE, lo = t[0], hi = t[t.length - 1], i;
    for (i = 0; i < t.length - 1; i++) {
      if (fGHz >= t[i].f && fGHz <= t[i + 1].f) { lo = t[i]; hi = t[i + 1]; break; }
    }
    var kLo = pol === 'V' ? lo.kV : lo.kH, kHi = pol === 'V' ? hi.kV : hi.kH;
    var aLo = pol === 'V' ? lo.aV : lo.aH, aHi = pol === 'V' ? hi.aV : hi.aH;
    if (hi.f === lo.f) return { k: kLo, alpha: aLo };
    var u = (Math.log10(Math.max(fGHz, 1)) - Math.log10(lo.f)) / (Math.log10(hi.f) - Math.log10(lo.f));
    u = Math.max(0, Math.min(1, u));
    return {
      k: Math.pow(10, Math.log10(kLo) + u * (Math.log10(kHi) - Math.log10(kLo))),
      alpha: aLo + u * (aHi - aLo)
    };
  }

  /* specific attenuation gamma = k R^alpha, dB/km */
  function rainSpecificDbKm(k, alpha, rateMmH) {
    if (!(rateMmH > 0)) return 0;
    return k * Math.pow(rateMmH, alpha);
  }

  /* ITU-R P.530 effective-path-length factor:

       r = 1 / (0.477 d^0.633 R^(0.073a) f^0.123 - 10.579 (1 - e^-0.024d))

     capped at 2.5. It reconciles a POINT rain rate with a PATH average: on
     a long hop the cell does not cover it all, so r < 1; on a short hop the
     whole path can sit inside the intense core, so r > 1.

     THE f^0.123 TERM IS NOT OPTIONAL. Leaving it out — which this function
     did at first — shrinks the denominator, and at 78 GHz over 1 km it
     drove r from 1.40 to beyond the 2.5 cap, inflating the rain term by
     1.8x and taking about 11 dB off the link for no reason. The frequency
     is already in gamma through k and alpha; it is in r as well because the
     cell-size statistics are frequency-dependent too. */
  function rainPathFactor(dKm, rateMmH, alpha, fGHz) {
    if (!(dKm > 0)) return 1;
    var den = 0.477 * Math.pow(dKm, 0.633) *
      Math.pow(Math.max(rateMmH, 0.1), 0.073 * alpha) *
      Math.pow(Math.max(fGHz || 1, 1), 0.123) -
      10.579 * (1 - Math.exp(-0.024 * dKm));
    if (!(den > 0)) return 2.5;
    return Math.min(2.5, 1 / den);
  }

  function rainAttenDb(fGHz, dKm, rateMmH, pol) {
    var c = rainCoeffs(fGHz, pol);
    var gamma = rainSpecificDbKm(c.k, c.alpha, rateMmH);
    return gamma * dKm * rainPathFactor(dKm, rateMmH, c.alpha, fGHz);
  }

  /* thermal noise floor in dBm: kTB at 290 K plus the receiver's own NF */
  function noiseFloorDbm(bwHz, nfDb) {
    if (!(bwHz > 0)) return NaN;
    return -174 + 10 * Math.log10(bwHz) + nfDb;
  }

  /* Required SNR per constellation.

     Derived, not tabulated: for square M-QAM over AWGN the symbol error
     rate is bounded by 4Q(sqrt(3 SNR/(M-1))), so the SNR for a target SER
     follows in closed form. A coding gain is then SUBTRACTED as a single
     declared number rather than being folded in silently, because the
     coding gain is a system choice and the uncoded figure is the one that
     can be checked against a textbook. */
  function qInv(p) {
    /* inverse Gaussian tail, Acklam's rational approximation */
    if (!(p > 0 && p < 1)) return NaN;
    var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
             138.3577518672690, -30.66479806614716, 2.506628277459239];
    var b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
             66.80131188771972, -13.28068155288572];
    var c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
             -2.549732539343734, 4.374664141464968, 2.938163982698783];
    var d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996,
             3.754408661907416];
    var pl = 0.02425, q, r, x;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
          ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= 1 - pl) {
      q = p - 0.5; r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
          (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    return -x;                                  /* Q^-1(p) */
  }
  function snrForQamDb(order, ber, codingGainDb) {
    if (!(order >= 2)) return NaN;
    var bits = Math.log2(order);
    /* SER from BER with Gray mapping: SER ~ BER * bits */
    var ser = Math.min(0.5, Math.max(1e-12, ber * bits));
    var qArg = qInv(ser / 4);                   /* SER = 4 Q(sqrt(3 SNR/(M-1))) */
    var snrLin = qArg * qArg * (order - 1) / 3;
    return 10 * Math.log10(snrLin) - (codingGainDb || 0);
  }

  /* An EVM is an SNR ceiling: no amount of received power beats it. This is
     the bridge between everything else in this tool and the link. */
  function snrCeilFromEvmDb(evmDbVal) { return -evmDbVal; }

  /* Two independent impairments add in POWER at the slicer, so their SNRs
     combine reciprocally. */
  function combineSnrDb() {
    var inv = 0, any = false;
    for (var i = 0; i < arguments.length; i++) {
      var s = arguments[i];
      if (s == null || !isFinite(s)) continue;
      inv += Math.pow(10, -s / 10);
      any = true;
    }
    return any ? -10 * Math.log10(inv) : NaN;
  }

  function shannonBps(bwHz, snrDbVal) {
    if (!(bwHz > 0)) return 0;
    return bwHz * Math.log2(1 + Math.pow(10, snrDbVal / 10));
  }

  window.K = {
    C0: C0, DEG: DEG, MEDIA: MEDIA, QAM_EVM: QAM_EVM,
    fsplDb: fsplDb, gasAbsDbPerKm: gasAbsDbPerKm,
    rainCoeffs: rainCoeffs, rainSpecificDbKm: rainSpecificDbKm,
    rainPathFactor: rainPathFactor, rainAttenDb: rainAttenDb,
    noiseFloorDbm: noiseFloorDbm, snrForQamDb: snrForQamDb, qInv: qInv,
    snrCeilFromEvmDb: snrCeilFromEvmDb, combineSnrDb: combineSnrDb,
    shannonBps: shannonBps,
    db2lin: db2lin, lin2db: lin2db, deg2rad: deg2rad, rad2deg: rad2deg,
    multDb: multDb, uncorrDb: uncorrDb,
    lineAlphaDbCm: lineAlphaDbCm, lineDelayPsCm: lineDelayPsCm,
    umPerDeg: umPerDeg, degFromLengthUm: degFromLengthUm,
    refPnDbc: refPnDbc, refScaleDb: refScaleDb,
    vcoPnDbc: vcoPnDbc, pllFloorDbc: pllFloorDbc, pllFlickerDbc: pllFlickerDbc,
    loopFnFromBw: loopFnFromBw, loopMags: loopMags,
    additivePnDbc: additivePnDbc,
    pnIntegrateLin: pnIntegrateLin, pnIntegrateRad: pnIntegrateRad, jitterS: jitterS,
    degPerPs: degPerPs, zohKernel: zohKernel, calCornerHz: calCornerHz,
    decorrKernel: decorrKernel, pairwiseFactor: pairwiseFactor,
    meanReferredFactor: meanReferredFactor,
    hpbwDeg: hpbwDeg, ruzeLossDb: ruzeLossDb, gainLossDb: gainLossDb,
    rmsSllDb: rmsSllDb, pointingFromRampDeg: pointingFromRampDeg,
    pointingFromRandomDeg: pointingFromRandomDeg,
    pointingFromWalkDeg: pointingFromWalkDeg, walkRmsFactor: walkRmsFactor,
    squintDeg: squintDeg, apertureDelayPs: apertureDelayPs, squintLossDb: squintLossDb,
    evmPctFromPhi: evmPctFromPhi, phiFromEvmPct: phiFromEvmPct,
    evmDb: evmDb, evmPctFromDb: evmPctFromDb, evmDbFromPhi: evmDbFromPhi,
    phiFromEvmDb: phiFromEvmDb, shareDb: shareDb,
    maxQam: maxQam, maxQamFromDb: maxQamFromDb,
    evmLimitForQam: evmLimitForQam, evmLimitDbForQam: evmLimitDbForQam,
    driftResidualDeg: driftResidualDeg, optimalUpdatePeriodS: optimalUpdatePeriodS,
    quantResidualDeg: quantResidualDeg, quantResidualPs: quantResidualPs,
    rss: rss, peakFactor: peakFactor, seriesRandom: seriesRandom,
    SERDES_LANE_GBPS: SERDES_LANE_GBPS,
    serdesLaneGbps: serdesLaneGbps, serdesLanes: serdesLanes,
    thermalDriftDegPerK: thermalDriftDegPerK,
    bbSkewDegAtEdge: bbSkewDegAtEdge, bbRampSteerDeg: bbRampSteerDeg,
    activeTreeNoiseFactor: activeTreeNoiseFactor, treeNoisePenaltyDb: treeNoisePenaltyDb,
    cascadeIip3PenaltyDb: cascadeIip3PenaltyDb,
    splitLossDb: splitLossDb, resistiveSplitLossDb: resistiveSplitLossDb,
    friisNfDb: friisNfDb, repeaterCount: repeaterCount
  };
})();
