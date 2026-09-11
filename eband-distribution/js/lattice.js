/* ============================================================================
   lattice.js — the two-dimensional element lattice and its grating-lobe set.

   WHY THIS FILE EXISTS. An earlier version of the beam model took the element
   pitch on ONE axis (elemDxM) and reported the first grating lobe as
   asin(lambda/dx). For a 4 cm tile carrying 8 elements as 4 x 2 that is
   asin(lambda/1 cm) = 22.60 deg — the SECOND-worst lobe. The binding lobe
   comes from the 2 cm pitch on the other axis, 11.08 deg, and it is
   suppressed by only 0.08 dB. Reporting one axis understated the problem by
   0.26 dB and 11.5 deg, and hid the count entirely: this lattice puts
   pi*A_cell/lambda^2 = 42 grating lobes in visible space at broadside, most
   of which lie in neither principal plane and so appear in neither cut.

   The lobe positions are the RECIPROCAL LATTICE of the element lattice,
   scaled by lambda:

       (u,v)_lobe = (u,v)_beam + lambda * (m*b1 + n*b2),   a_i . b_j = delta_ij

   so this module works in reciprocal space, where the lobes actually live,
   and derives the element positions from it by duality.

   IN-TILE LATTICE CHOICE. "8 elements per tile" does not force 4 x 2. Any
   sublattice L of index 8 that CONTAINS the tile lattice keeps every tile
   identical, and by duality those are exactly the index-8 sublattices of the
   tile reciprocal lattice — a finite set, enumerated here in Hermite normal
   form. Their worst grating lobe ranges from 5.51 deg (8 x 1) through
   11.08 deg (4 x 2, the tool's old hard-coded choice — the worst of the
   sensible options) to 15.77 deg for the sheared lattice a1 = (1,-1) cm,
   a2 = (0,2) cm, which also raises minimum element separation from 1.00 to
   1.41 cm. Same channel count, same die count, same tile: strictly better.
   The lobe COUNT is unchanged — that is fixed by element density alone.

   That worked example is the OLD 4 cm / 8-element default, kept because it
   is the case where the choice bites. At today's 6 cm / 16-element default
   the enumeration returns a square 4 x 4 at a 1.5 cm pitch as both the
   rectangular representative and the widest-separation sublattice, so the
   parameter is real but inert: there is nothing to trade.

   Exposes window.Lat.
   ========================================================================= */
(function () {
  'use strict';

  var K = window.K;

  function divisors(n) {
    var d = [];
    for (var i = 1; i <= n; i++) if (n % i === 0) d.push(i);
    return d;
  }

  /* Shortest non-zero vector of the lattice spanned by b1, b2. Brute force
     over a window that is generous for any Hermite basis of index <= 64;
     both bases here are near-reduced so the true minimum is found well
     inside it. */
  function shortest(b1, b2) {
    var best = Infinity, bv = [0, 0], R = 14;
    for (var m = -R; m <= R; m++) {
      for (var q = -R; q <= R; q++) {
        if (m === 0 && q === 0) continue;
        var x = m * b1[0] + q * b2[0], y = m * b1[1] + q * b2[1];
        var L = Math.sqrt(x * x + y * y);
        if (L < best - 1e-12) { best = L; bv = [x, y]; }
      }
    }
    return { len: best, v: bv };
  }

  /* Dual basis: a_i . b_j = delta_ij (no 2*pi). */
  function dual(b1, b2) {
    var det = b1[0] * b2[1] - b1[1] * b2[0];
    if (Math.abs(det) < 1e-15) return null;
    return [[b2[1] / det, -b2[0] / det], [-b1[1] / det, b1[0] / det]];
  }

  /* Coset representatives of the tile lattice in L: every lattice point
     inside one tile. Exactly N of them, by construction. */
  function offsets(a1, a2, period, N) {
    var out = [], seen = {}, R = N + 2;
    for (var i = -R; i <= R && out.length < N; i++) {
      for (var j = -R; j <= R && out.length < N; j++) {
        var x = i * a1[0] + j * a2[0], y = i * a1[1] + j * a2[1];
        x = x - period * Math.floor(x / period + 1e-9);
        y = y - period * Math.floor(y / period + 1e-9);
        var key = Math.round(x * 1e6) + '|' + Math.round(y * 1e6);
        if (seen[key]) continue;
        seen[key] = 1;
        out.push([x, y]);
      }
      if (out.length >= N) break;
    }
    out.sort(function (p, q) { return (p[1] - q[1]) || (p[0] - q[0]); });
    return out.slice(0, N);
  }

  function fmt(v) { return (Math.round(v * 100) / 100).toString(); }

  /* ---------------------------------------------------------------------
     Every admissible in-tile lattice of index N, deduplicated by geometry
     and sorted worst-lobe-angle ascending (so the last entry is the best).
     Lengths in cm.
     ------------------------------------------------------------------- */
  var cache = {};
  function candidates(N, tileCm, lamCm) {
    var ck = N + '|' + tileCm + '|' + lamCm;
    if (cache[ck]) return cache[ck];
    var out = candidatesRaw(N, tileCm, lamCm);
    cache[ck] = out;
    return out;
  }

  function candidatesRaw(N, tileCm, lamCm) {
    var raw = [], divs = divisors(N);
    /* Above a few dozen elements per tile the full Hermite enumeration is
       sigma(N) bases, each needing a coset walk — not worth the milliseconds
       for a configuration this tool is not really about. Rectangular only. */
    var rectOnly = N > 32;
    divs.forEach(function (a) {
      var c = N / a;
      for (var b = 0; b < a && !(rectOnly && b > 0); b++) {
        var b1 = [a / tileCm, 0], b2 = [b / tileCm, c / tileCm];
        var sh = shortest(b1, b2);
        var A = dual(b1, b2);
        if (!A) continue;
        var offs = offsets(A[0], A[1], tileCm, N);
        var sep = shortest(A[0], A[1]);
        raw.push({
          hnf: [a, b, c], b1: b1, b2: b2, a1: A[0], a2: A[1],
          offsets: offs,
          minSinLobe: lamCm * sh.len,
          minSepCm: sep.len,
          rect: b === 0, nx: a, ny: c
        });
      }
    });
    /* Dedupe on the two invariants that matter, preferring the rectangular
       representative — so that "4 x 2" is still called 4 x 2 — and among
       rectangular ones the orientation with more columns along x, since x is
       the scan and cut axis and that is the orientation the write-up uses. */
    var byKey = {};
    raw.forEach(function (r) {
      var key = Math.round(r.minSinLobe * 1e6) + '|' + Math.round(r.minSepCm * 1e4);
      var cur = byKey[key];
      if (!cur || (r.rect && !cur.rect) || (r.rect && cur.rect && r.nx > cur.nx)) byKey[key] = r;
    });
    var out = [];
    for (var k in byKey) out.push(byKey[k]);
    out.forEach(function (r) {
      r.lobeDeg = r.minSinLobe <= 1 ? Math.asin(r.minSinLobe) * K.DEG : NaN;
      r.label = r.rect ? (r.nx + '×' + r.ny + ' rectangular')
                       : 'sheared (' + fmt(r.a1[0]) + ',' + fmt(r.a1[1]) + ') (' +
                         fmt(r.a2[0]) + ',' + fmt(r.a2[1]) + ') cm';
    });
    out.sort(function (p, q) { return p.minSinLobe - q.minSinLobe; });
    return out;
  }

  /* Pick a named candidate: 'best' = largest worst-lobe angle; 'rect' = the
     squarest rectangular one (the historical hard-coded choice); 'row' = the
     1 x N strip; otherwise match a label. */
  function pick(list, key, N) {
    if (!list.length) return null;
    if (key === 'best') return list[list.length - 1];
    if (key === 'row') {
      for (var i = 0; i < list.length; i++) if (list[i].rect && (list[i].nx === 1 || list[i].ny === 1)) return list[i];
    }
    if (key === 'rect' || !key) {
      var want = Math.round(Math.sqrt(N));
      while (want > 1 && N % want !== 0) want--;
      var nx = Math.max(want, N / want), ny = Math.min(want, N / want), fb = null;
      for (var j = 0; j < list.length; j++) {
        var r = list[j];
        if (!r.rect) continue;
        if ((r.nx === nx && r.ny === ny) || (r.nx === ny && r.ny === nx)) return r;
        if (!fb) fb = r;
      }
      return fb || list[0];
    }
    for (var m = 0; m < list.length; m++) if (list[m].label === key) return list[m];
    return list[0];
  }

  /* ---------------------------------------------------------------------
     Grating lobes in visible space, for a beam steered to (u0,v0).
     Returns [{m,n,u,v,sinT,thetaDeg,phiDeg,dU}], main beam excluded.
     ------------------------------------------------------------------- */
  function lobes(b1, b2, lamCm, u0, v0) {
    var out = [];
    var s1 = Math.sqrt(b1[0] * b1[0] + b1[1] * b1[1]);
    var s2 = Math.sqrt(b2[0] * b2[0] + b2[1] * b2[1]);
    if (!(s1 > 0) || !(s2 > 0)) return out;
    var M1 = Math.min(400, Math.ceil(2.2 / (lamCm * s1)) + 2);
    var M2 = Math.min(400, Math.ceil(2.2 / (lamCm * s2)) + 2);
    for (var m = -M1; m <= M1; m++) {
      for (var q = -M2; q <= M2; q++) {
        if (m === 0 && q === 0) continue;
        var du = lamCm * (m * b1[0] + q * b2[0]);
        var dv = lamCm * (m * b1[1] + q * b2[1]);
        var u = u0 + du, v = v0 + dv;
        var s = Math.sqrt(u * u + v * v);
        if (s > 1) continue;
        out.push({
          m: m, n: q, u: u, v: v, sinT: s,
          thetaDeg: Math.asin(Math.min(1, s)) * K.DEG,
          phiDeg: Math.atan2(v, u) * K.DEG,
          dU: Math.sqrt(du * du + dv * dv)
        });
      }
    }
    out.sort(function (p, r) { return p.sinT - r.sinT; });
    return out;
  }

  /* ---------------------------------------------------------------------
     THE UNIT RADIATOR. Two self-consistent models, because one cos^n curve
     cannot be both a 6 dBi directivity-matched element (n = 0.99, 120 deg
     HPBW, only 3 dB of scan loss at 60 deg) and a real package patch
     (65-80 deg HPBW, n = 3.5, 10 dB at 60 deg). The old model used the
     first for grating-lobe suppression AND for scan loss, which is
     pessimistic about the lobe and optimistic about the scan with the same
     curve. The choice is explicit:

       dir    cos^n with n from D = 2(n+1). D IS the integral of its own
              pattern, by that closed form. Broad, honest about the lobe,
              optimistic about scan loss. The conservative lobe case.
       hpbw   cos^n with n from a stated HPBW, directivity kept at the
              PARAMETER value and deliberately NOT re-derived from the
              pattern: a real patch has back radiation and E/H asymmetry,
              so D < 2(n+1). This asymmetry is the whole point of the
              selector and anything that "fixes" it destroys the model.

     A THIRD KIND, 'nulled', USED TO LIVE HERE and has been removed. It was a
     uniformly illuminated cell whose sinc nulls land on the reciprocal
     lattice; C3 at K = 64 in span mode is the same antenna built out of
     discrete radiators, reaches the same 22.82 dBi, and unlike the old kind
     never asserts a directivity its own pattern disagrees with. The old one
     did: its powAt carries a cos(theta) obliquity factor that 4*pi*A/lambda^2
     does not, so it integrated to 23.0446 dBi against the 22.8194 it
     reported — 0.225 dB of self-contradiction. Deleting it removes that
     rather than clamping around it. Its HPBW line carried a second defect:
     0.6031 is the sinc = 0.5 point, which is the -6 dB point of a POWER
     pattern; the half-power constant is 0.4429, so the width it reported was
     1.36x the true one. That was dead code — nothing read hpbwDeg for that
     kind — which is exactly how it survived, and why the kinds now go
     through one table that surfaces every field uniformly.

     THE SUBARRAY. One controllable port may feed kx * ky radiators through a
     FIXED corporate tree. The beamformer cannot see inside a cell, so this
     changes the ELEMENT PATTERN and nothing else: not the port count, not
     the port lattice, not the grating-lobe positions, not their count.

     powAt(u,v) is POWER relative to the element's own boresight.
     ------------------------------------------------------------------- */
  var KINDS = {
    dir: {
      label: 'directivity-matched',
      nOf: function (c) { return Math.max(0, Math.pow(10, c.dUnitDbi / 10) / 2 - 1); },
      /* D = 2(n+1) is the integral of cos^n, so this kind's directivity is
         derived from its own pattern and the two can never disagree. */
      dOf: function (c) { return c.dUnitDbi; }
    },
    hpbw: {
      label: 'HPBW-matched patch',
      nOf: function (c) {
        if (!(c.hpbwDeg > 0 && c.hpbwDeg < 179.9)) return 1;
        var ch = Math.cos(K.deg2rad(c.hpbwDeg / 2));
        return ch > 0 && ch < 1 ? Math.log(0.5) / Math.log(ch) : 1;
      },
      /* ASSERTED, not integrated — see the note above. */
      dOf: function (c) { return c.dUnitDbi; }
    }
  };
  var KIND_KEYS = ['dir', 'hpbw'];

  /* Normalised power array factor of N radiators at pitch p (cm), fed in
     phase, evaluated at direction cosine w. N < 2 is the identity, which is
     what lets the K = 1 path below be the old code verbatim. */
  function af2(N, pCm, w, lamCm) {
    if (!(N > 1)) return 1;
    var x = Math.PI * pCm * w / lamCm;
    var s = Math.sin(x);
    if (Math.abs(s) < 1e-13) return 1;            /* the N-fold main/grating lobe */
    var r = Math.sin(N * x) / (N * s);
    return r * r;
  }

  /* Directivity of a subarray, as a RATIO of quadratures rather than an
     absolute integral.

       dElDbi = dUnitDbi + 10 log10( I_unit / I_sub )

     Both integrals run on the SAME grid over the visible disc, so the
     quadrature error cancels and kx = ky = 1 returns dUnitDbi EXACTLY, for
     BOTH unit kinds. That exactness is the point: an unconditional
     D = 4*pi*powAt(0,0)/integral would return about 13.9 dBi for a 6 dBi
     HPBW-matched patch and silently destroy the dir/hpbw distinction this
     file exists to create.

     The result is NEVER clamped. dElDbi is always the integral, so the
     identity thinningLossDb = dCellDbi - dElDbi survives untouched, and a
     cell-spanning subarray is allowed to integrate a few hundredths of a dB
     past 4*pi*A_cell/lambda^2 — which it does, because that bound is
     obliquity-free and this pattern carries cos(theta). The caller reports
     that rather than hiding it. */
  var dCache = {};
  function dOfRatio(n, kx, ky, pxCm, pyCm, lamCm) {
    if (kx <= 1 && ky <= 1) return 0;
    var ck = n.toFixed(6) + '|' + kx + '|' + ky + '|' + pxCm.toFixed(6) + '|' +
      pyCm.toFixed(6) + '|' + lamCm.toFixed(6);
    if (dCache[ck] != null) return dCache[ck];
    var N = 700, iU = 0, iS = 0, step = 2 / N;
    for (var i = 0; i < N; i++) {
      var u = -1 + (i + 0.5) * step;
      for (var j = 0; j < N; j++) {
        var v = -1 + (j + 0.5) * step;
        var c2 = 1 - u * u - v * v;
        if (c2 <= 0) continue;
        var ct = Math.sqrt(c2);
        /* du dv / cos(theta) is the solid-angle element in direction cosines */
        var w = Math.pow(ct, n) / ct;
        iU += w;
        iS += w * af2(kx, pxCm, u, lamCm) * af2(ky, pyCm, v, lamCm);
      }
    }
    var out = iS > 0 ? 10 * Math.log10(iU / iS) : 0;
    dCache[ck] = out;
    return out;
  }

  function element(cfg) {
    var key = KINDS[cfg.key] ? cfg.key : 'dir';
    var lamCm = cfg.lamCm, a1 = cfg.a1, a2 = cfg.a2;
    var kind = KINDS[key];
    var ctx = {
      dUnitDbi: cfg.dUnitDbi != null ? cfg.dUnitDbi : cfg.elemDirDbi,
      hpbwDeg: cfg.hpbwDeg, lamCm: lamCm
    };
    var n = kind.nOf(ctx);
    var dUnit = kind.dOf(ctx);
    var aCellCm2 = Math.abs(a1[0] * a2[1] - a1[1] * a2[0]);
    var dCellDbi = 10 * Math.log10(4 * Math.PI * aCellCm2 / (lamCm * lamCm));
    var kx = Math.max(1, Math.round(cfg.kx || 1));
    var ky = Math.max(1, Math.round(cfg.ky || 1));
    var pxCm = cfg.pxCm > 0 ? cfg.pxCm : lamCm / 2;
    var pyCm = cfg.pyCm > 0 ? cfg.pyCm : lamCm / 2;

    var o = {
      key: key, n: n, nDir: KINDS.dir.nOf(ctx), nHpbw: KINDS.hpbw.nOf(ctx),
      dCellDbi: dCellDbi, aCellCm2: aCellCm2,
      kx: kx, ky: ky, kTotal: kx * ky, pxCm: pxCm, pyCm: pyCm,
      dUnitDbi: dUnit
    };

    function cosPow(u, v) {
      var c2 = 1 - u * u - v * v;
      if (c2 <= 0) return 0;
      return Math.pow(Math.sqrt(c2), n);
    }

    if (kx === 1 && ky === 1) {
      /* THE K = 1 SHORT CIRCUIT IS LOAD-BEARING. C1 back-compatibility is
         guaranteed by the integrator never running, not by it happening to
         return the right number. */
      o.dElDbi = dUnit;
      o.dGainOverUnitDb = 0;
      o.powAt = cosPow;
      o.hpbwDeg = 2 * Math.acos(Math.pow(0.5, 1 / Math.max(n, 1e-6))) * K.DEG;
      o.hpbwXDeg = o.hpbwDeg;
      o.hpbwYDeg = o.hpbwDeg;
      o.subLobes = [];
      o.label = 'cos^' + (Math.round(n * 100) / 100) + ', HPBW ' + Math.round(o.hpbwDeg) + '° (' +
        kind.label + ')';
    } else {
      var gain = dOfRatio(n, kx, ky, pxCm, pyCm, lamCm);
      o.dElDbi = dUnit + gain;
      o.dGainOverUnitDb = gain;
      o.powAt = function (u, v) {
        var p = cosPow(u, v);
        if (p <= 0) return 0;
        return p * af2(kx, pxCm, u, lamCm) * af2(ky, pyCm, v, lamCm);
      };
      o.hpbwXDeg = halfPowerConeDeg(o.powAt, 'x') * 2;
      o.hpbwYDeg = halfPowerConeDeg(o.powAt, 'y') * 2;
      o.hpbwDeg = Math.min(o.hpbwXDeg, o.hpbwYDeg);
      /* the subarray's OWN grating lobes, i.e. where its fixed feed puts a
         full-strength replica. Empty whenever every axis pitch is < lambda. */
      o.subLobes = [];
      [[kx, pxCm, 'x'], [ky, pyCm, 'y']].forEach(function (ax) {
        if (!(ax[0] > 1)) return;
        var du = lamCm / ax[1];
        for (var m = 1; m * du <= 1; m++) {
          o.subLobes.push(ax[2] === 'x' ? { u: m * du, v: 0 } : { u: 0, v: m * du });
          o.subLobes.push(ax[2] === 'x' ? { u: -m * du, v: 0 } : { u: 0, v: -m * du });
        }
      });
      o.label = kx + '×' + ky + ' ' + kind.label + ' subarray at ' +
        (Math.round(100 * pxCm / lamCm) / 100) + 'λ, ' +
        (Math.round(o.dElDbi * 100) / 100) + ' dBi';
    }
    return o;
  }

  /* -3 dB HALF-angle along one principal axis, by bisection on the pattern
     itself rather than on a closed form, because a subarray pattern is
     cos^n times an array factor and has no closed-form half-power point. */
  function halfPowerConeDeg(powAt, axis) {
    var p0 = axis === 'x' ? powAt(0, 0) : powAt(0, 0);
    if (!(p0 > 0)) return 0;
    var at = function (s) { return axis === 'x' ? powAt(s, 0) : powAt(0, s); };
    var lo = 0, hi = 1;
    if (at(hi) > p0 / 2) return 90;
    for (var i = 0; i < 60; i++) {
      var mid = (lo + hi) / 2;
      if (at(mid) > p0 / 2) lo = mid; else hi = mid;
    }
    return Math.asin(Math.min(1, (lo + hi) / 2)) * K.DEG;
  }

  /* Level of each grating lobe relative to the intended beam, which for a
     uniform periodic array is set by the element pattern alone. Sorted
     strongest first — that, not the smallest angle, is the binding lobe
     (with a subarray element the two are not the same).

     NOTE FOR CALLERS: this MUTATES the list it is handed — it writes relDb
     and re-sorts in place. Anything that levels several element options
     against the same geometry must call lobes() fresh for each one, or the
     shared list ends up carrying the last option's levels and the map, the
     beam and the tables describe different arrays. */
  function withLevels(list, elem, u0, v0) {
    var g0 = Math.max(elem.powAt(u0, v0), 1e-12);
    list.forEach(function (l) {
      l.relDb = 10 * Math.log10(Math.max(elem.powAt(l.u, l.v), 1e-14) / g0);
    });
    list.sort(function (p, q) { return q.relDb - p.relDb; });
    return list;
  }

  window.Lat = {
    divisors: divisors, shortest: shortest, dual: dual, offsets: offsets,
    candidates: candidates, pick: pick, lobes: lobes, element: element,
    withLevels: withLevels, KIND_KEYS: KIND_KEYS, af2: af2
  };
})();
