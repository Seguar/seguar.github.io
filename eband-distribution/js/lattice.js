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
     Element pattern. THREE self-consistent models, because one cos^n curve
     cannot be both a 6 dBi directivity-matched element (n = 0.99, 120 deg
     HPBW, only 3 dB of scan loss at 60 deg) and a real package patch
     (65-80 deg HPBW, n = 3.5, 10 dB at 60 deg). The old model used the
     first for grating-lobe suppression AND for scan loss, which is
     pessimistic about the lobe and optimistic about the scan with the same
     curve. Now the choice is explicit:

       dir    cos^n with n from D = 2(n+1). Broad, honest about the lobe,
              optimistic about scan loss. The conservative lobe case.
       hpbw   cos^n with n from a stated HPBW, directivity kept at the
              parameter value (a real patch has back radiation and E/H
              asymmetry, so D < 2(n+1)). Realistic scan loss.
       nulled cell-filling radiator: uniformly illuminated parallelogram of
              the lattice cell. Its nulls land exactly on the reciprocal
              lattice, i.e. exactly on every grating lobe, and its
              directivity is the cell ceiling 4*pi*A_cell/lambda^2. This is
              the filled-subarray trick done in metal instead of silicon —
              the only way to keep a periodic lattice — and it costs scan
              range, because the nulls sit on the lobes only at broadside.

     powAt(u,v) is POWER relative to the element's own boresight.
     ------------------------------------------------------------------- */
  function element(cfg) {
    var key = cfg.key || 'dir';
    var lamCm = cfg.lamCm, a1 = cfg.a1, a2 = cfg.a2;
    var dParam = cfg.elemDirDbi;
    var nDir = Math.max(0, Math.pow(10, dParam / 10) / 2 - 1);
    var nHp = 1;
    if (cfg.hpbwDeg > 0 && cfg.hpbwDeg < 179.9) {
      var ch = Math.cos(K.deg2rad(cfg.hpbwDeg / 2));
      nHp = ch > 0 && ch < 1 ? Math.log(0.5) / Math.log(ch) : 1;
    }
    var aCellCm2 = Math.abs(a1[0] * a2[1] - a1[1] * a2[0]);
    var dCellDbi = 10 * Math.log10(4 * Math.PI * aCellCm2 / (lamCm * lamCm));

    function sinc(x) { return Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x); }

    var n = key === 'hpbw' ? nHp : nDir;
    var o = {
      key: key, n: n, nDir: nDir, nHpbw: nHp,
      dCellDbi: dCellDbi, aCellCm2: aCellCm2,
      dElDbi: key === 'nulled' ? dCellDbi : dParam,
      hpbwDeg: key === 'nulled'
        ? 2 * Math.asin(0.6031 * lamCm / Math.sqrt(aCellCm2)) * K.DEG
        : 2 * Math.acos(Math.pow(0.5, 1 / Math.max(n, 1e-6))) * K.DEG
    };
    o.powAt = key === 'nulled'
      ? function (u, v) {
          var c2 = 1 - u * u - v * v;
          if (c2 <= 0) return 0;
          var f = sinc((a1[0] * u + a1[1] * v) / lamCm) * sinc((a2[0] * u + a2[1] * v) / lamCm);
          return Math.sqrt(c2) * f * f;
        }
      : function (u, v) {
          var c2 = 1 - u * u - v * v;
          if (c2 <= 0) return 0;
          return Math.pow(Math.sqrt(c2), n);
        };
    o.label = key === 'nulled'
      ? 'cell-filling nulled radiator, ' + (Math.round(dCellDbi * 10) / 10) + ' dBi'
      : 'cos^' + (Math.round(n * 100) / 100) + ', HPBW ' + Math.round(o.hpbwDeg) + '° (' +
        (key === 'hpbw' ? 'HPBW-matched patch' : 'directivity-matched') + ')';
    return o;
  }

  /* Level of each grating lobe relative to the intended beam, which for a
     uniform periodic array is set by the element pattern alone. Sorted
     strongest first — that, not the smallest angle, is the binding lobe (for
     a nulled element the two are not the same). */
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
    withLevels: withLevels
  };
})();
