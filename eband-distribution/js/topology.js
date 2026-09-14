/* ============================================================================
   topology.js — the physical construction of each distribution network.

   ONE generator, consumed by BOTH the hardware map and the numeric model, so
   the drawing and the numbers can never disagree: the path lengths the map
   draws are literally the path lengths the loss and skew figures use.

   Coordinate space is centimetres in aperture space, (0,0) top-left,
   (apertureCm, apertureCm) bottom-right.

   Emits:
     tiles  : per-tile geometry AND electrical path facts (length, segments,
              tree level, hop index, repeaters in path)
     links  : drawable segments, each tagged with the frequency it carries
     nodes  : drawable block symbols at real positions
     bom    : block counts for the hardware bill of materials
   Exposes window.Topo.
   ========================================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- utils */
  function manhattan(x1, y1, x2, y2) {
    /* horizontal first, then vertical — the classic corporate-feed look */
    var segs = [];
    if (Math.abs(x2 - x1) > 1e-9) segs.push([x1, y1, x2, y1]);
    if (Math.abs(y2 - y1) > 1e-9) segs.push([x2, y1, x2, y2]);
    if (!segs.length) segs.push([x1, y1, x2, y2]);
    return segs;
  }
  function segLen(s) { return Math.abs(s[2] - s[0]) + Math.abs(s[3] - s[1]); }

  /* ------------------------------------------------------ grid definition */
  function makeGrid(g) {
    var tileCm = g.tileCm;
    /* Model.resolve() already worked this out; trust it so the map and the
       metrics cannot disagree about how many tiles there are. */
    var cols = g.tileCols || Math.max(1, Math.floor(g.apertureCm / tileCm + 1e-9));
    var rows = cols;
    var tiles = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        tiles.push({
          i: r * cols + c, r: r, c: c,
          x: c * tileCm, y: r * tileCm, w: tileCm, h: tileCm,
          cx: (c + 0.5) * tileCm, cy: (r + 0.5) * tileCm,
          /* Two networks share the aperture, so they get separate anchor
             points inside each tile: the LO/reference feed lands at the
             centre, the baseband port sits offset toward the lower right,
             clear of the die cluster. Real boards separate them by layer;
             the map separates them in plan so both can be read at once. */
          bbX: (c + 0.5) * tileCm + tileCm * 0.36,
          bbY: (r + 0.5) * tileCm + tileCm * 0.36,
          pathCm: 0, segments: 0, level: 0, hop: 0, repeaters: 0,
          bbPathCm: 0, bbLevel: 0, bbHop: 0,
          blocks: []
        });
      }
    }
    var grid = { rows: rows, cols: cols, tileCm: tileCm, tiles: tiles, nTiles: tiles.length };
    tiles.forEach(function (t) { layDies(t, g, tileCm); layAntennas(t, g, tileCm); });
    return grid;
  }

  /* ------------------------------------------------- ports and radiators
     Two different things, and the map is the one place a reader can SEE
     that they are different.

     A PORT is a controllable RF channel — one phase shifter, one entry in
     the beamformer's state. Their positions are g.latOffsetsCm, i.e. the
     very lattice beam.js integrates over, so what is drawn and what is
     computed cannot drift apart. Note the offsets wrap into [0, tileCm),
     so a port really does sit on the tile edge: with abutting tiles the
     radiating lattice is UNIFORM across the whole aperture and the tile
     boundary is a routing boundary, not an antenna one. Drawing it that
     way is the honest picture.

     A RADIATOR is metal. K of them sit behind one port on a fixed feed,
     invisible to the beamformer. Drawn to scale from the block library's
     own footprint, because the whole point of the antenna family is that a
     2.6 mm patch alone in a 15 mm cell fills 2.08% of it — and at this
     scale that is four pixels in a sixty-pixel square. The smallness IS
     the argument.                                                        */
  function layAntennas(t, g, tileCm) {
    var offs = g.latOffsetsCm || [[0, 0]];
    var kx = Math.max(1, Math.round(g.radKx || 1));
    var ky = Math.max(1, Math.round(g.radKy || 1));
    var px = g.radPitchXCm || 0, py = g.radPitchYCm || 0;
    var blk = (g.antTraits && g.antTraits.radBlockKey) || 'antPatch';
    var areaMm2 = ((window.Model && window.Model.BLOCKS[blk]) || { areaMm2: 6.7 }).areaMm2;
    var wCm = Math.sqrt(Math.max(areaMm2, 0.01)) / 10;

    /* The port's CELL, which is what the dashed outline on the map shows.

       It is the PARALLELOGRAM spanned by the lattice basis a1, a2 — not
       elemDx x elemDy. Those come from PROJECTIONS onto the two axes, and
       on a sheared sublattice the projected columns collapse: the index-8
       sheared lattice projects onto 4 x 4, so elemDx x elemDy claims
       15 x 15 = 225 mm² when the real cell is |a1 x a2| = 450 mm². Half
       the tile would have had no cell drawn on it at all, and the legend
       would have contradicted the inspector's own cell-fill denominator by
       exactly 2x.

       Drawing the basis directly is right for every mode: for the
       rectangular lattice a1 = (dx, 0) and a2 = (0, dy), so it degenerates
       to the rectangle it always was. */
    var a1 = (g.lat && g.lat.a1) || [g.elemDxCm || tileCm, 0];
    var a2 = (g.lat && g.lat.a2) || [0, g.elemDyCm || tileCm];
    t.cellA1 = a1;
    t.cellA2 = a2;
    t.cellAreaCm2 = Math.abs(a1[0] * a2[1] - a1[1] * a2[0]);
    /* extents, for the legend's plain-language description of the cell */
    t.cellXCm = Math.abs(a1[0]) + Math.abs(a2[0]);
    t.cellYCm = Math.abs(a1[1]) + Math.abs(a2[1]);

    /* The isolated radiator's own footprint can EXCEED the space it is being
       packed into: 2.59 mm of patch on a 1.92 mm lambda/2 pitch. That is not
       a drawing quirk, it is the same physical fact that makes K close-packed
       radiators fall about 1.03 dB short of D_unit + 10log10(K) — an
       isolated 6 dBi patch claims more area than a lambda/2 cell can hold.
       Drawn at true scale the squares overlap and read as a rendering fault,
       so the drawn size is bounded and the bound is REPORTED.

       PER AXIS, because the crowding is per axis. A 1xK cross-scan column is
       crowded only in y: kx = 1 and there is a whole 15 mm of empty cell in
       x. Shrinking it in both axes understated the drawn metal by 1.8x in
       area and quietly argued the author's case, since the reader is being
       invited to eyeball the cell fill. Eight full-width 2.59 x 1.92 mm bars
       is what the metal actually is.

       The CELL is the outer bound whatever K is. An earlier version only
       compared against the intra-cluster pitch, so at K = 1 nothing was
       compared at all and a C4 board radiator could be drawn overhanging its
       own cell and overlapping its neighbours with no check firing. */
    var limX = Math.min(kx > 1 ? px : Infinity, t.cellXCm);
    var limY = Math.min(ky > 1 ? py : Infinity, t.cellYCm);
    var wxCm = Math.min(wCm, limX);
    var wyCm = Math.min(wCm, limY);
    t.radFootprintCm = wCm;
    t.radCappedToPitch = (wxCm < wCm - 1e-9) || (wyCm < wCm - 1e-9);
    t.radCapXCm = wxCm;
    t.radCapYCm = wyCm;

    t.ports = [];
    t.rads = [];
    offs.forEach(function (o, pi) {
      var cx = t.x + o[0], cy = t.y + o[1];
      t.ports.push({ i: pi, x: cx, y: cy });
      for (var iy = 0; iy < ky; iy++) {
        for (var ix = 0; ix < kx; ix++) {
          t.rads.push({
            p: pi,
            x: cx + (ix - (kx - 1) / 2) * px,
            y: cy + (iy - (ky - 1) / 2) * py,
            wx: wxCm, wy: wyCm
          });
        }
      }
    });
    t.radPerPort = kx * ky;
    t.radW = wCm;                 /* the PHYSICAL footprint, not the drawn one */
  }

  /* ------------------------------------------------------ dies and LO taps
     Each tile carries `tapsPerTile` E-band RFIC dies (2.5 x 2.5 mm each, the
     existing taped-out part) laid out on a square grid, and an intra-tile LO
     fan-out from the tile's LO node to every die. Drawn to scale: a 2.5 mm
     die on a 60 mm tile really is that small, and seeing that is the point —
     it is why the LO last mile is a packaging problem.

     The fan-out is a two-level H: one trunk from the tile centre to each die
     row, then a branch along the row to each die. That is the 9 cm / 3 cm-per-
     leaf sub-tile tree the LO budget assumes.                              */
  function layDies(t, g, tileCm) {
    var n = Math.max(1, Math.round(g.tapsPerTile || 4));
    var cols = Math.ceil(Math.sqrt(n));
    var rows = Math.ceil(n / cols);
    var dieCm = 0.25;                                  /* 2.5 mm */
    var pitch = tileCm * 0.48 / Math.max(cols, 1) * 1.0;
    var pitchX = tileCm * 0.48 / Math.max(cols - 1, 1);
    var pitchY = tileCm * 0.48 / Math.max(rows - 1, 1);
    if (cols === 1) pitchX = 0;
    if (rows === 1) pitchY = 0;
    /* centred on the tile: a 2 x 2 cluster on a 6 cm tile is a ~3 cm die
       pitch, which is what the sub-tile LO tree assumes. The baseband port
       sits further out at 0.36 of the tile, clear of the cluster. */
    var ox = t.cx;
    var oy = t.cy;

    t.dies = [];
    for (var i = 0; i < n; i++) {
      var r = Math.floor(i / cols), c = i % cols;
      t.dies.push({
        i: i,
        x: ox + (c - (cols - 1) / 2) * pitchX,
        y: oy + (r - (rows - 1) / 2) * pitchY,
        w: dieCm
      });
    }

    /* group by row y, then trunk + branch */
    t.tapLinks = [];
    var byRow = {};
    t.dies.forEach(function (d) {
      var k = d.y.toFixed(4);
      if (!byRow[k]) byRow[k] = [];
      byRow[k].push(d);
    });
    Object.keys(byRow).forEach(function (k) {
      var y = parseFloat(k);
      var row = byRow[k];
      t.tapLinks.push({ x1: t.cx, y1: t.cy, x2: t.cx, y2: y, kind: 'trunk' });
      var xs = row.map(function (d) { return d.x; });
      var lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs);
      if (hi > lo) t.tapLinks.push({ x1: lo, y1: y, x2: hi, y2: y, kind: 'branch' });
      row.forEach(function (d) {
        t.tapLinks.push({ x1: d.x, y1: y, x2: d.x, y2: d.y, kind: 'leaf', die: d.i });
      });
    });
    /* routed length of the intra-tile fan-out, per tile */
    t.tapRoutedCm = t.tapLinks.reduce(function (a, L) {
      return a + Math.abs(L.x2 - L.x1) + Math.abs(L.y2 - L.y1);
    }, 0);
  }

  /* --------------------------------------------------- recursive corporate
     Deterministic recursive bisection: split the group along its longer
     extent into two halves of equal COUNT. Note that a 5x5 = 25-tile array
     is not a power of two, so the tree is inherently unbalanced — a real,
     deterministic (and therefore calibratable) skew source that the tool
     reports rather than hides.                                            */
  /* Walk a drawable segment, inserting repeater amplifiers wherever the loss
     accumulated SINCE THE LAST AMPLIFIER would exceed maxSegLossDb. Counting
     repeaters per link instead of along the cumulative path is the classic
     error: individual links are short, so every link rounds to zero and a
     60 dB path ends up with one amplifier. Returns the new sinceAmp and
     pushes amp nodes at their real positions. */
  function walkSegment(s, state, opts, nodes) {
    var len = segLen(s);
    var loss = len * (opts.alphaDbCm || 0);
    var maxSeg = opts.maxSegLossDb || 0;
    if (!(maxSeg > 0) || !(loss > 0)) { state.sinceAmp += loss; return; }
    var travelled = 0;
    while (state.sinceAmp + (loss - travelled) > maxSeg) {
      var need = maxSeg - state.sinceAmp;                  /* dB still allowed */
      travelled += need;
      var t = travelled / loss;                            /* fraction along  */
      nodes.push({
        type: 'amp',
        x: s[0] + (s[2] - s[0]) * t,
        y: s[1] + (s[3] - s[1]) * t,
        label: 'rep', freqHz: opts.freqHz
      });
      state.ampCount++;
      state.sinceAmp = 0;
    }
    state.sinceAmp += (loss - travelled);
  }

  function corporate(grid, opts) {
    var links = [], nodes = [];
    var maxLevel = 0;
    var totalAmps = { n: 0 };
    var src = opts.source || { x: grid.cols * grid.tileCm / 2, y: grid.rows * grid.tileCm + 2.2 };

    nodes.push({ type: 'source', x: src.x, y: src.y, label: opts.sourceLabel || 'source', freqHz: opts.freqHz });

    function recurse(group, fromX, fromY, accLen, accSeg, level, walk) {
      maxLevel = Math.max(maxLevel, level);
      if (group.length === 1) {
        var t = group[0];
        var segs = manhattan(fromX, fromY, t.cx, t.cy);
        var len = 0;
        segs.forEach(function (s) {
          links.push({ x1: s[0], y1: s[1], x2: s[2], y2: s[3], freqHz: opts.freqHz, kind: 'branch', level: level });
          walkSegment(s, walk, opts, nodes);
          len += segLen(s);
        });
        t.pathCm = accLen + len;
        t.segments = accSeg + 1;
        t.level = level;
        t.repeaters = walk.ampCount;
        totalAmps.n = Math.max(totalAmps.n, walk.ampCount);
        return;
      }
      /* choose split axis by extent */
      var xs = group.map(function (t) { return t.cx; });
      var ys = group.map(function (t) { return t.cy; });
      var spanX = Math.max.apply(null, xs) - Math.min.apply(null, xs);
      var spanY = Math.max.apply(null, ys) - Math.min.apply(null, ys);
      var byX = spanX >= spanY;
      var sorted = group.slice().sort(function (a, b) { return byX ? a.cx - b.cx : a.cy - b.cy; });
      var half = Math.floor(sorted.length / 2);
      var halves = [sorted.slice(0, half), sorted.slice(half)];

      /* splitter sits at the group centroid */
      var gx = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
      var gy = ys.reduce(function (a, b) { return a + b; }, 0) / ys.length;
      var feed = manhattan(fromX, fromY, gx, gy);
      var feedLen = 0;
      feed.forEach(function (s) {
        links.push({ x1: s[0], y1: s[1], x2: s[2], y2: s[3], freqHz: opts.freqHz, kind: level === 0 ? 'trunk' : 'branch', level: level });
        walkSegment(s, walk, opts, nodes);
        feedLen += segLen(s);
      });
      nodes.push({ type: 'split', x: gx, y: gy, label: '1:2', freqHz: opts.freqHz, level: level });
      /* a 1:2 split costs its own 3 dB + excess, which counts against the
         repeater budget just as line loss does */
      walk.sinceAmp += (opts.splitLossDb || 0);

      halves.forEach(function (h) {
        /* each branch inherits the loss state at the split, independently */
        recurse(h, gx, gy, accLen + feedLen, accSeg + 1, level + 1,
          { sinceAmp: walk.sinceAmp, ampCount: walk.ampCount });
      });
    }

    recurse(grid.tiles.slice(), src.x, src.y, 0, 0, 0, { sinceAmp: 0, ampCount: 0 });
    return { links: links, nodes: nodes, maxLevel: maxLevel, source: src, maxAmpsInPath: totalAmps.n };
  }

  /* ------------------------------------------------------ radial equal-path
     One N-way junction — a radial line or parallel-plate divider — at the
     centre of the panel, with a meander-equalised run to every tile. A third
     topology class beside the corporate tree and the serpentine chain.

     THE EQUALISATION HAS TO BE DRAWN, NOT ASSUMED. It is tempting to say
     path spread goes to zero "by symmetry", and the honesty ledger said
     exactly that for two revisions. It is false on a square grid: the 25
     centre-referred radii on a 5 x 6 cm array run from 0 to 16.97 cm and
     spread 4.19 cm RMS, which is 2.6x WORSE than the bisection tree's
     1.589 cm. Symmetry gives equal phase only to tiles at equal radius, and
     a square grid has five distinct radii. So every run is meandered out to
     the CORNER radius, which is what buys the zero spread and what it costs:
     the mean routed length rises from 11.25 cm to 16.97 cm and every tile
     pays the longest path's line loss.

     What it buys is not mainly split loss — both this and a tree are floored
     at 10log10(N) by power conservation, so the saving there is a few tenths
     of a dB. It is that the path-delay spread is identically zero, and the
     path-delay spread is the ONLY mechanism by which a shared source's
     correlated phase noise leaks into the inter-tile differential, through
     decorrKernel = 4 sin^2(pi f dTau). At the tree's 81.3 ps that leak is
     -5.9 dB at the 1 GHz rail edge; here it does not exist at any offset.  */
  function radial(grid, opts) {
    var links = [], nodes = [];
    var cx = grid.cols * grid.tileCm / 2, cy = grid.rows * grid.tileCm / 2;
    var src = { x: cx, y: cy };
    nodes.push({ type: 'source', x: src.x, y: src.y, label: opts.sourceLabel || 'source', freqHz: opts.freqHz });
    nodes.push({ type: 'split', x: cx, y: cy, label: '1:' + grid.nTiles, freqHz: opts.freqHz, level: 0 });

    /* the corner radius every run is equalised to */
    var rMax = 0;
    grid.tiles.forEach(function (t) {
      var r = Math.sqrt(Math.pow(t.cx - cx, 2) + Math.pow(t.cy - cy, 2));
      if (r > rMax) rMax = r;
    });

    var amps = 0;
    grid.tiles.forEach(function (t) {
      var r = Math.sqrt(Math.pow(t.cx - cx, 2) + Math.pow(t.cy - cy, 2));
      /* the direct radial run, drawn to scale */
      links.push({ x1: cx, y1: cy, x2: t.cx, y2: t.cy, freqHz: opts.freqHz, kind: 'branch', level: 1 });
      /* the meander that equalises it to rMax is real copper and real loss,
         so it is carried in the path length even though drawing its
         serpentine would only clutter the map */
      t.pathCm = rMax;
      t.level = 1;
      t.hop = 0;
      t.segments = 1;
      t.meanderCm = rMax - r;
      var loss = rMax * (opts.alphaDbCm || 0) + (opts.splitLossDb || 0);
      t.repeaters = opts.maxSegLossDb > 0 ? Math.max(0, Math.ceil(loss / opts.maxSegLossDb) - 1) : 0;
      amps = Math.max(amps, t.repeaters);
      if (t.repeaters) nodes.push({ type: 'amp', x: (cx + t.cx) / 2, y: (cy + t.cy) / 2, freqHz: opts.freqHz, tile: t.i });
    });

    return {
      links: links, nodes: nodes, maxLevel: 1, source: src, maxAmpsInPath: amps,
      equalisedCm: rMax
    };
  }

  /* ------------------------------------------------------- daisy / serpent
     Boustrophedon order: row by row, reversing on odd rows, so consecutive
     tiles are always physical neighbours. Optionally split into `branches`
     independent chains from the source to bound the chain length — a real
     design lever, since chain length drives both accumulated skew and the
     blast radius of a single dead buffer.                                  */
  function daisy(grid, opts) {
    var links = [], nodes = [];
    var branches = Math.max(1, Math.min(opts.branches || 1, grid.rows));
    var src = opts.source || { x: grid.cols * grid.tileCm / 2, y: grid.rows * grid.tileCm + 2.2 };
    nodes.push({ type: 'source', x: src.x, y: src.y, label: opts.sourceLabel || 'source', freqHz: opts.freqHz });

    /* serpentine order over the whole grid */
    var order = [];
    for (var r = 0; r < grid.rows; r++) {
      var row = grid.tiles.filter(function (t) { return t.r === r; });
      row.sort(function (a, b) { return r % 2 === 0 ? a.c - b.c : b.c - a.c; });
      order = order.concat(row);
    }

    /* deal the serpentine into `branches` contiguous chains */
    var per = Math.ceil(order.length / branches);
    var chains = [];
    for (var b = 0; b < branches; b++) {
      var ch = order.slice(b * per, Math.min((b + 1) * per, order.length));
      if (ch.length) chains.push(ch);
    }

    /* if branched, a splitter at the source feeds each chain head */
    if (chains.length > 1) {
      nodes.push({ type: 'split', x: src.x, y: src.y - 0.9, label: '1:' + chains.length, freqHz: opts.freqHz, level: 0 });
    }

    var maxHop = 0, maxAmps = 0;
    chains.forEach(function (chain) {
      var px = src.x, py = src.y, acc = 0, seg = 0;
      var walk = { sinceAmp: 0, ampCount: 0 };
      chain.forEach(function (t, hopIdx) {
        var segs = manhattan(px, py, t.cx, t.cy);
        var len = 0;
        segs.forEach(function (s) {
          links.push({
            x1: s[0], y1: s[1], x2: s[2], y2: s[3],
            freqHz: opts.freqHz, kind: hopIdx === 0 ? 'trunk' : 'hop', level: hopIdx
          });
          walkSegment(s, walk, opts, nodes);
          len += segLen(s);
        });
        acc += len; seg += 1;
        t.pathCm = acc;
        t.segments = seg;
        t.hop = hopIdx + 1;
        t.level = hopIdx + 1;
        t.repeaters = walk.ampCount;
        maxHop = Math.max(maxHop, t.hop);
        maxAmps = Math.max(maxAmps, walk.ampCount);
        /* the per-hop buffer re-amplifies, so the loss budget resets here —
           this is the daisy chain's one genuine electrical advantage */
        walk.sinceAmp = (opts.tapLossDb || 0);
        nodes.push({ type: 'buftap', x: t.cx, y: t.cy, label: 'buf+tap', freqHz: opts.freqHz, tile: t.i });
        px = t.cx; py = t.cy;
      });
      /* the chain must be terminated, or the last tile sees a reflection */
      var last = chain[chain.length - 1];
      nodes.push({ type: 'term', x: last.cx + grid.tileCm * 0.3, y: last.cy + grid.tileCm * 0.3, label: '50Ω', freqHz: opts.freqHz });
    });

    return {
      links: links, nodes: nodes, maxLevel: maxHop, source: src,
      chains: chains.length, maxAmpsInPath: maxAmps
    };
  }

  /* total repeater amplifiers actually placed on the drawing */
  function countAmps(nodes) {
    return nodes.filter(function (n) { return n.type === 'amp'; }).length;
  }

  /* ======================================================================
     Per-option builders. Each returns the full drawable + electrical model.
     ================================================================== */

  var OPTS = {

    /* --------------------------------------------------------- A1 local-pll
       A low-frequency reference is distributed on a corporate tree; every
       tile synthesises its own LO. Physically the easiest board to build:
       the reference runs on inner layers, needs no E-band transitions, and
       is electrically short. All the cost moves into the tile die.        */
    'local-pll': function (g, grid) {
      var refHz = g.fRefMHz * 1e6;
      var alpha = window.K.lineAlphaDbCm(g.refMediumKey, refHz);
      var net = corporate(grid, {
        freqHz: refHz, sourceLabel: g.refName || 'REF',
        alphaDbCm: alpha, maxSegLossDb: g.maxSegLossDb, splitLossDb: 0.5
      });
      var reps = countAmps(net.nodes);
      var M = Math.max(1, Math.round(g.pllMult));
      grid.tiles.forEach(function (t) {
        t.blocks = [{ type: 'pll', label: 'PLL' }];
        if (M > 1) t.blocks.push({ type: 'mult', label: '×' + M });
        t.blocks.push({ type: 'amp', label: 'LO buf' });
      });
      net.nodes = net.nodes.concat(grid.tiles.map(function (t) {
        return { type: 'pll', x: t.cx, y: t.cy, label: 'PLL' + (M > 1 ? ' ×' + M : ''), freqHz: g.fLoGHz * 1e9, tile: t.i };
      }));
      return {
        net: net, distFreqHz: refHz, tileMultiplier: M, repeaters: reps,
        kind: 'tree',
        bom: bomOf([
          ['refSource', 1, 'one board-level reference oscillator'],
          ['clkFanout', net.nodes.filter(function (n) { return n.type === 'split'; }).length, 'reference fanout buffers at tree nodes'],
          ['refRepeater', reps, 'reference line repeaters (usually zero — the reference is electrically short)'],
          ['tilePll', grid.nTiles, 'one full PLL per tile, inside the 65nm BB+LO die'],
          ['tileMult', M > 1 ? grid.nTiles : 0, 'per-tile ×' + M + ' multiplier to reach the LO'],
          ['loChipletSige', grid.nTiles, 'SiGe LO last-mile chiplet per tile — mandatory: a 78 GHz gain stage is not realisable in 65nm LP CMOS'],
          ['loBuf78', grid.nTiles * g.tapsPerTile, 'per-tile LO buffers driving ' + g.tapsPerTile + ' RFIC taps']
        ]),
        note: 'No E-band routing on the board at all. Every tile is an independent synthesiser, so ' +
              'inter-tile phase noise above the PLL loop bandwidth is uncorrelated and irreducible.'
      };
    },

    /* ------------------------------------------------------ A2 hf-foldback
       One central 78 GHz source, distributed over a repeatered corporate
       network. Every branch is an E-band line and every node needs a
       driver. This is the option whose cost is on the board, not the die. */
    'hf-foldback': function (g, grid) {
      var fHz = g.fLoGHz * 1e9;
      var alpha = window.K.lineAlphaDbCm(g.loMediumKey, fHz);
      var net = corporate(grid, {
        freqHz: fHz, sourceLabel: 'E-band source',
        alphaDbCm: alpha, maxSegLossDb: g.maxSegLossDb, splitLossDb: 3.81
      });
      var reps = countAmps(net.nodes);
      var splits = net.nodes.filter(function (n) { return n.type === 'split'; }).length;
      grid.tiles.forEach(function (t) {
        t.blocks = [{ type: 'amp', label: 'LO buf' }];
      });
      /* every splitter at E-band needs a driver to make up its 3 dB + excess */
      net.nodes.forEach(function (n) {
        if (n.type === 'split') n.driven = true;
      });
      return {
        net: net, distFreqHz: fHz, tileMultiplier: 1, repeaters: reps,
        kind: 'tree',
        bom: bomOf([
          ['loSource78', 1, 'one central E-band source (PLL + VCO at 78 GHz)'],
          ['loSplit78', splits, 'E-band 1:2 splitters at every tree node'],
          ['loAmp78', reps + splits, 'E-band repeater and post-splitter driver amplifiers'],
          ['loChipletSige', grid.nTiles, 'SiGe LO last-mile chiplet per tile — mandatory: a 78 GHz gain stage is not realisable in 65nm LP CMOS'],
          ['loBuf78', grid.nTiles * g.tapsPerTile, 'per-tile LO buffers driving ' + g.tapsPerTile + ' RFIC taps'],
          ['ebandTransition', grid.nTiles * 2, 'board-to-package E-band transitions (two per tile)']
        ]),
        note: 'Phase noise is fully correlated from one source, so it cancels in the inter-tile ' +
              'differential — but every centimetre is E-band, so loss, amplifier count and power are the ' +
              'worst of the four, and the mechanical tolerance is measured in microns.'
      };
    },

    /* ------------------------------------------------------ A3 daisy-chain
       LO passed tile to tile along a serpentine, buffered and tapped at
       each hop. The simplest board layout; the errors accumulate.         */
    'daisy-chain': function (g, grid) {
      var fHz = (g.chainFreqGHz || g.fLoGHz) * 1e9;
      var alpha = window.K.lineAlphaDbCm(g.loMediumKey, fHz);
      var net = daisy(grid, {
        freqHz: fHz, sourceLabel: 'chain source', branches: g.chainBranches,
        alphaDbCm: alpha, maxSegLossDb: g.maxSegLossDb, tapLossDb: 1.2
      });
      var reps = countAmps(net.nodes);
      var M = Math.max(1, Math.round((g.fLoGHz * 1e9) / fHz));
      grid.tiles.forEach(function (t) {
        t.blocks = [{ type: 'amp', label: 'buf' }, { type: 'tap', label: 'tap' }];
        if (M > 1) t.blocks.push({ type: 'mult', label: '×' + M });
      });
      return {
        net: net, distFreqHz: fHz, tileMultiplier: M, repeaters: reps,
        kind: 'chain', chains: net.chains, maxHop: net.maxLevel,
        bom: bomOf([
          ['loSourceChain', 1, 'one source at ' + (fHz / 1e9).toFixed(1) + ' GHz'],
          ['chainBuf', grid.nTiles, 'one buffer per hop — also the failure point'],
          ['chainTap', grid.nTiles, 'directional tap per tile'],
          ['tileMult', M > 1 ? grid.nTiles : 0, 'per-tile ×' + M + ' multiplier'],
          ['loChipletSige', grid.nTiles, 'SiGe LO last-mile chiplet per tile — mandatory: a 78 GHz gain stage is not realisable in 65nm LP CMOS'],
          ['loBuf78', grid.nTiles * g.tapsPerTile, 'per-tile LO buffers driving ' + g.tapsPerTile + ' RFIC taps'],
          ['chainTerm', net.chains, 'matched termination at each chain end']
        ]),
        note: 'Fewest interconnects and the simplest layout, but the delay ramp is a random walk along the ' +
              'aperture whose dominant mode is a beam tilt, and one dead buffer kills every tile downstream.'
      };
    },

    /* --------------------------------------------------------- A4 mid-mult
       Distribute at f_LO/M on a corporate tree, multiply at each tile.
       The board carries a manageable frequency; the die carries a
       multiplier. Buys loss and power — NOT skew.                        */
    /* ------------------------------------------------------ A7 radial-feed
       One N-way radial junction at the centre, every run meander-equalised
       to the corner radius. See radial() above for why the equalisation is
       drawn rather than assumed.                                           */
    'radial-feed': function (g, grid) {
      var M = Math.max(2, Math.round(g.midM));
      var fHz = g.fLoGHz * 1e9 / M;
      var alpha = window.K.lineAlphaDbCm(g.loMediumKey, fHz);
      /* ONE junction, so the whole division happens at once: the ideal
         10log10(N) plus a single excess, not a per-level excess compounded
         over 5.6 cascaded levels. */
      var idealSplitDb = 10 * Math.log10(Math.max(grid.nTiles, 1));
      var net = radial(grid, {
        freqHz: fHz, sourceLabel: (fHz / 1e9).toFixed(1) + ' GHz radial source',
        alphaDbCm: alpha, maxSegLossDb: g.maxSegLossDb,
        splitLossDb: idealSplitDb + (g.radialExcessDb != null ? g.radialExcessDb : 1.2)
      });
      var reps = grid.tiles.reduce(function (a, t) { return a + (t.repeaters || 0); }, 0);
      grid.tiles.forEach(function (t) {
        t.blocks = [{ type: 'mult', label: '×' + M }, { type: 'amp', label: 'LO buf' }];
      });
      net.nodes = net.nodes.concat(grid.tiles.map(function (t) {
        return { type: 'mult', x: t.cx, y: t.cy, label: '×' + M, freqHz: g.fLoGHz * 1e9, tile: t.i };
      }));
      return {
        net: net, distFreqHz: fHz, tileMultiplier: M, repeaters: reps,
        kind: 'radial', equalisedCm: net.equalisedCm,
        bom: bomOf([
          ['loSourceMid', 1, 'one source at ' + (fHz / 1e9).toFixed(1) + ' GHz'],
          ['radialLauncher', 1, 'centre launcher into the radial line — the single division point'],
          ['radialProbe', grid.nTiles, 'one probe per tile off the radial line, all at the same radius'],
          ['loAmpMid', reps, 'mid-frequency repeaters on the equalised runs'],
          ['tileMult', grid.nTiles, 'per-tile ×' + M + ' multiplier to 78 GHz'],
          ['loChipletSige', grid.nTiles, 'SiGe LO last-mile chiplet per tile — mandatory: a 78 GHz gain stage is not realisable in 65nm LP CMOS'],
          ['loBuf78', grid.nTiles * g.tapsPerTile, 'per-tile LO buffers driving ' + g.tapsPerTile + ' RFIC taps'],
          ['midTransition', grid.nTiles, 'board-to-package transition at ' + (fHz / 1e9).toFixed(1) + ' GHz']
        ]),
        note: 'One N-way junction instead of ' + (Math.log(grid.nTiles) / Math.log(2)).toFixed(1) +
              ' cascaded 1:2 levels, with every run meander-equalised to the ' +
              net.equalisedCm.toFixed(1) + ' cm corner radius. The path-delay spread is then identically ' +
              'zero, which matters because that spread is the only route by which a shared source\'s ' +
              'correlated noise reaches the inter-tile differential. It is paid for in copper — every tile ' +
              'is routed at the longest length — and in isolation, because a junction with no isolation ' +
              'resistors passes one tile\'s mismatch to all the others.'
      };
    },

    'mid-mult': function (g, grid) {
      var M = Math.max(2, Math.round(g.midM));
      var fHz = g.fLoGHz * 1e9 / M;
      var alpha = window.K.lineAlphaDbCm(g.loMediumKey, fHz);
      var net = corporate(grid, {
        freqHz: fHz, sourceLabel: (fHz / 1e9).toFixed(1) + ' GHz source',
        alphaDbCm: alpha, maxSegLossDb: g.maxSegLossDb, splitLossDb: 3.31
      });
      var reps = countAmps(net.nodes);
      var splits = net.nodes.filter(function (n) { return n.type === 'split'; }).length;
      grid.tiles.forEach(function (t) {
        t.blocks = [{ type: 'mult', label: '×' + M }, { type: 'amp', label: 'LO buf' }];
      });
      net.nodes = net.nodes.concat(grid.tiles.map(function (t) {
        return { type: 'mult', x: t.cx, y: t.cy, label: '×' + M, freqHz: g.fLoGHz * 1e9, tile: t.i };
      }));
      return {
        net: net, distFreqHz: fHz, tileMultiplier: M, repeaters: reps,
        kind: 'tree',
        bom: bomOf([
          ['loSourceMid', 1, 'one source at ' + (fHz / 1e9).toFixed(1) + ' GHz'],
          ['loSplitMid', splits, '1:2 splitters at ' + (fHz / 1e9).toFixed(1) + ' GHz'],
          ['loAmpMid', reps + Math.round(splits / 2), 'mid-frequency repeaters and drivers'],
          ['tileMult', grid.nTiles, 'per-tile ×' + M + ' multiplier to 78 GHz'],
          ['loChipletSige', grid.nTiles, 'SiGe LO last-mile chiplet per tile — mandatory: a 78 GHz gain stage is not realisable in 65nm LP CMOS'],
          ['loBuf78', grid.nTiles * g.tapsPerTile, 'per-tile LO buffers driving ' + g.tapsPerTile + ' RFIC taps'],
          ['midTransition', grid.nTiles, 'board-to-package transition at ' + (fHz / 1e9).toFixed(1) + ' GHz (far more forgiving than E-band)']
        ]),
        note: 'The board never carries E-band, so loss and amplifier count collapse. The ×' + M +
              ' multiplier adds exactly ' + (20 * Math.log10(M)).toFixed(1) + ' dB to L(f) and multiplies any ' +
              'distributed phase error by ' + M + ' — so this buys loss and power, not skew.'
      };
    },

    /* ------------------------------------------------- A5 stabilised-link
       Physically A4's tree, plus a return path. Each tile carries a
       directional coupler that sends the arriving tone back down the same
       line; at the master a mixer compares outgoing against returned and
       measures TWICE the one-way path phase, which a servo then
       pre-corrects. The distribution network measures and cancels its own
       drift, continuously, with no over-the-air step and no per-element
       BIST in the loop.

       Everything downstream of the coupler is A4: the same ×M at the tile,
       the same SiGe last mile. The extra hardware is the coupler, the
       return amplifier and the phase detector, and the extra RISK is that
       the cancellation is only as good as the path's reciprocity.        */
    'stabilised-link': function (g, grid) {
      var M = Math.max(2, Math.round(g.midM));
      var fHz = g.fLoGHz * 1e9 / M;
      var alpha = window.K.lineAlphaDbCm(g.loMediumKey, fHz);
      var net = corporate(grid, {
        freqHz: fHz, sourceLabel: (fHz / 1e9).toFixed(1) + ' GHz stabilised source',
        alphaDbCm: alpha, maxSegLossDb: g.maxSegLossDb, splitLossDb: 3.31
      });
      var reps = countAmps(net.nodes);
      var splits = net.nodes.filter(function (n) { return n.type === 'split'; }).length;
      grid.tiles.forEach(function (t) {
        t.blocks = [
          { type: 'coupler', label: 'rtn' },
          { type: 'mult', label: '×' + M },
          { type: 'amp', label: 'LO buf' }
        ];
      });
      /* Drawn, A5 is A4 plus a return. The return travels the SAME trace it
         came out on — that reciprocity is the entire mechanism — so it adds
         no routed length and no link geometry, and marking the forward links
         `bidir` is the honest way to say so: the map draws a companion stroke
         alongside them rather than inventing a second trunk that no layout
         would build. What is genuinely extra hardware is the coupler at each
         tile and the comparison at the master, and those are nodes. */
      net.links.forEach(function (L) { L.bidir = true; });
      net.nodes.push({
        type: 'phasedet', x: net.source.x + grid.tileCm * 0.55, y: net.source.y,
        label: 'Δφ round-trip', freqHz: fHz
      });
      net.nodes = net.nodes.concat(grid.tiles.map(function (t) {
        return { type: 'coupler', x: t.cx - grid.tileCm * 0.22, y: t.cy, label: 'return coupler', freqHz: fHz, tile: t.i };
      }));
      net.nodes = net.nodes.concat(grid.tiles.map(function (t) {
        return { type: 'mult', x: t.cx, y: t.cy, label: '×' + M, freqHz: g.fLoGHz * 1e9, tile: t.i };
      }));
      return {
        net: net, distFreqHz: fHz, tileMultiplier: M, repeaters: reps,
        kind: 'tree',
        bom: bomOf([
          ['loSourceMid', 1, 'one source at ' + (fHz / 1e9).toFixed(1) + ' GHz'],
          ['loSplitMid', splits, '1:2 splitters at ' + (fHz / 1e9).toFixed(1) + ' GHz'],
          ['loAmpMid', reps + Math.round(splits / 2), 'mid-frequency repeaters and drivers'],
          ['rtnCoupler', grid.nTiles, 'directional coupler per tile returning the tone to the master'],
          ['rtnPhaseDet', grid.nTiles, 'round-trip phase detector and correction servo per tile'],
          ['tileMult', grid.nTiles, 'per-tile ×' + M + ' multiplier to 78 GHz'],
          ['loChipletSige', grid.nTiles, 'SiGe LO last-mile chiplet per tile'],
          ['loBuf78', grid.nTiles * g.tapsPerTile, 'per-tile LO buffers driving ' + g.tapsPerTile + ' RFIC taps'],
          ['midTransition', grid.nTiles, 'board-to-package transition at ' + (fHz / 1e9).toFixed(1) + ' GHz']
        ]),
        note: 'A4\'s tree with a return path. The master mixes outgoing against returned to read twice the ' +
              'one-way path phase and pre-corrects it at the loop bandwidth, so line drift cancels itself ' +
              'instead of being tracked by BIST. What survives is the path\'s non-reciprocity, not its drift.'
      };
    },

    /* ---------------------------------------------------- A6 inj-lock
       A4's tree again, but the tile holds an oscillator locked by
       injection instead of a multiplier chain. No PFD, no charge pump, no
       divider — and a lock bandwidth of hundreds of MHz where a PLL closes
       a few, so the line's additive noise is suppressed far wider than A4
       suppresses it. The price is a static locked phase offset that varies
       tile to tile with the free-running frequency.                      */
    'inj-lock': function (g, grid) {
      var M = Math.max(2, Math.round(g.midM));
      var fHz = g.fLoGHz * 1e9 / M;
      var alpha = window.K.lineAlphaDbCm(g.loMediumKey, fHz);
      var net = corporate(grid, {
        freqHz: fHz, sourceLabel: (fHz / 1e9).toFixed(1) + ' GHz injection source',
        alphaDbCm: alpha, maxSegLossDb: g.maxSegLossDb, splitLossDb: 3.31
      });
      var reps = countAmps(net.nodes);
      var splits = net.nodes.filter(function (n) { return n.type === 'split'; }).length;
      grid.tiles.forEach(function (t) {
        t.blocks = [{ type: 'ilo', label: 'ILO ×' + M }, { type: 'amp', label: 'LO buf' }];
      });
      net.nodes = net.nodes.concat(grid.tiles.map(function (t) {
        return { type: 'ilo', x: t.cx, y: t.cy, label: 'ILO ×' + M, freqHz: g.fLoGHz * 1e9, tile: t.i };
      }));
      return {
        net: net, distFreqHz: fHz, tileMultiplier: M, repeaters: reps,
        kind: 'tree',
        bom: bomOf([
          ['loSourceMid', 1, 'one source at ' + (fHz / 1e9).toFixed(1) + ' GHz'],
          ['loSplitMid', splits, '1:2 splitters at ' + (fHz / 1e9).toFixed(1) + ' GHz'],
          ['loAmpMid', reps + Math.round(splits / 2), 'mid-frequency repeaters and drivers'],
          ['tileIlo', grid.nTiles, 'injection-locked oscillator per tile, locked to the ×' + M + ' sub-harmonic'],
          ['loChipletSige', grid.nTiles, 'SiGe LO last-mile chiplet per tile'],
          ['loBuf78', grid.nTiles * g.tapsPerTile, 'per-tile LO buffers driving ' + g.tapsPerTile + ' RFIC taps'],
          ['midTransition', grid.nTiles, 'board-to-package transition at ' + (fHz / 1e9).toFixed(1) + ' GHz']
        ]),
        note: 'The tile oscillator is locked by harmonic injection, not by a PLL, so there is no PFD, charge ' +
              'pump or divider noise at all — and the lock corner is hundreds of MHz rather than a few. The ' +
              'new error is the locked phase offset arcsin(Δf/f_lock), which differs tile to tile.'
      };
    }
  };

  function bomOf(rows) {
    return rows.filter(function (r) { return r[1] > 0; }).map(function (r) {
      return { blockKey: r[0], count: r[1], where: r[2] };
    });
  }

  /* ======================================================================
     Baseband topologies — drawn as a ZOOM into one tile: nCh channels from
     nDies RFIC dies, combined to the tile output that feeds the RFSoC.
     Everything here is PER RAIL, and there are two rails (I and Q).
     ================================================================== */
  var BB_KINDS = ['passive-50', 'bb-daisy', 'h-tree-active', 'current-mode', 'digital-tile'];

  function buildBb(id, g) {
    if (BB_KINDS.indexOf(id) < 0) {
      throw new Error('Topo.buildBb: unknown baseband option id ' + JSON.stringify(id) +
        ' (expected one of ' + BB_KINDS.join(', ') + ')');
    }
    var nCh = Math.max(2, Math.round(g.chPerTile));
    var levels = Math.ceil(Math.log2(nCh));
    var W = 100, H = 62;                       /* abstract tile-zoom canvas */
    var links = [], nodes = [], leaves = [];
    var yStep = H / (nCh + 1);

    for (var i = 0; i < nCh; i++) {
      leaves.push({ i: i, x: 6, y: yStep * (i + 1) });
      nodes.push({ type: 'ch', x: 6, y: yStep * (i + 1), label: 'ch' + i });
    }

    if (id === 'bb-daisy') {
      /* serial bus: every channel taps onto one line running to the root */
      var busX = 26;
      links.push({ x1: busX, y1: yStep, x2: busX, y2: yStep * nCh, kind: 'bus' });
      leaves.forEach(function (L, i) {
        links.push({ x1: L.x, y1: L.y, x2: busX, y2: L.y, kind: 'tap' });
        nodes.push({ type: 'tap', x: busX, y: L.y, label: 'tap', hop: i + 1 });
      });
      links.push({ x1: busX, y1: yStep * nCh, x2: W - 14, y2: H / 2, kind: 'root' });
      nodes.push({ type: 'out', x: W - 10, y: H / 2, label: 'to RFSoC' });
      return {
        id: id, nCh: nCh, levels: 1, hops: nCh, links: links, nodes: nodes, W: W, H: H,
        bom: bomOf([
          /* The per-channel weight is NOT optional here. B1, B3, B4 and B5 all
             book one vector modulator per channel per rail; B2 booked none,
             which made it look like the cheapest option in the comparison by a
             factor of three. A daisy chain still has to apply the beamforming
             weight before the channel reaches the shared bus — there is no
             arrangement in which the control point disappears — so the
             omission was a BOM defect, not a design statement. */
          ['bbVectorMod', nCh * 2, 'per-channel IQ vector modulator / VGA, ahead of the tap'],
          ['bbTap', nCh * 2, 'one tap per channel per rail (I and Q)'],
          ['bbRootAmp', 2, 'one root amplifier per rail']
        ]),
        note: 'One wire, ' + nCh + ' taps. Simplest routing, but tap capacitance grows with channel count so ' +
              'the bandwidth collapses, and the delay ramp survives calibration as a frequency-dependent beam steer.'
      };
    }

    /* B4 current-mode: every channel drives current into ONE virtual
       ground. Not a tree — a single node — which is the whole point: no
       staging, no cascade, no accumulated cell mismatch. */
    if (id === 'current-mode') {
      var sumX = 26 + (W - 46) * 0.35;
      leaves.forEach(function (L) {
        links.push({ x1: L.x, y1: L.y, x2: sumX, y2: L.y, kind: 'branch', level: 1 });
        links.push({ x1: sumX, y1: L.y, x2: sumX, y2: H / 2, kind: 'join', level: 1 });
      });
      nodes.push({ type: 'cell', x: sumX, y: H / 2, label: 'TIA', level: 1 });
      links.push({ x1: sumX, y1: H / 2, x2: W - 14, y2: H / 2, kind: 'root' });
      nodes.push({ type: 'out', x: W - 10, y: H / 2, label: 'to RFSoC' });
      return {
        id: id, nCh: nCh, levels: 1, hops: 1, links: links, nodes: nodes, W: W, H: H,
        bom: bomOf([
          ['tiaSum', 2, 'one summing transimpedance amplifier per rail — replaces ' + (nCh - 1) + ' cascaded cells'],
          ['bbVectorMod', nCh * 2, 'per-channel IQ vector modulator / VGA, now current-output'],
          ['bbDecap', 1, 'supply decoupling for the TIA']
        ]),
        note: 'One node, one amplifier per rail. A virtual ground removes B1\'s 20log10(N) voltage division ' +
              'and B3\'s ' + levels + '-level cascade at the same time — the impedance regime, not the topology. ' +
              'What limits it is the summing-node capacitance of ' + nCh + ' channels against the TIA bandwidth.'
      };
    }

    /* B5 digitise at the tile: the analog network stops at one combiner per
       rail; after that it is bits. Drawn as the combine plus the converter
       and the serial lane, because that is what is physically in the tile. */
    if (id === 'digital-tile') {
      var cmX = 26 + (W - 46) * 0.28;
      leaves.forEach(function (L) {
        links.push({ x1: L.x, y1: L.y, x2: cmX, y2: L.y, kind: 'branch', level: 1 });
        links.push({ x1: cmX, y1: L.y, x2: cmX, y2: H / 2, kind: 'join', level: 1 });
      });
      nodes.push({ type: 'cell', x: cmX, y: H / 2, label: 'Σ', level: 1 });
      var adcX = cmX + (W - cmX) * 0.34, serX = cmX + (W - cmX) * 0.66;
      links.push({ x1: cmX, y1: H / 2, x2: adcX, y2: H / 2, kind: 'root' });
      nodes.push({ type: 'adc', x: adcX, y: H / 2, label: 'ADC' });
      links.push({ x1: adcX, y1: H / 2, x2: serX, y2: H / 2, kind: 'root' });
      nodes.push({ type: 'serdes', x: serX, y: H / 2, label: 'SerDes' });
      links.push({ x1: serX, y1: H / 2, x2: W - 14, y2: H / 2, kind: 'digital' });
      nodes.push({ type: 'out', x: W - 10, y: H / 2, label: 'lanes to RFSoC' });
      /* The tileSerdes block is priced PER LANE, so the count has to be the
         lane count the converters actually demand — not a placeholder 1 each
         way. At 10 bits and 2.5 GS/s the two rails need 51.56 Gb/s, which is
         3 lanes of 25, so this books 6 rather than 2 and B5's serial link
         triples its die area. Same kernel as the power model. */
      var serLanes = window.K.serdesLanes(g.adcBits, g.adcGspsPerRail);
      return {
        id: id, nCh: nCh, levels: 1, hops: 1, links: links, nodes: nodes, W: W, H: H,
        bom: bomOf([
          ['tiaSum', 2, 'one summing amplifier per rail ahead of the converter'],
          ['bbVectorMod', nCh * 2, 'per-channel IQ vector modulator / VGA'],
          ['tileAdc', 2, 'one ADC per rail — power computed from the converter FOM parameters, not from this entry'],
          ['tileDac', 2, 'one DAC per rail, TX direction'],
          ['tileSerdes', serLanes * 2, serLanes + ' serial lane' + (serLanes === 1 ? '' : 's') + ' each way to the backend'],
          ['bbDecap', 2, 'supply decoupling for the converters and the SerDes']
        ]),
        note: 'The analog inter-tile tier does not exist: the tile combines, digitises and sends bits. ' +
              'Inter-tile alignment becomes deterministic-latency rather than a routed path length, which is ' +
              'a strictly better skew story — and the converters are what you pay for it.'
      };
    }

    /* corporate / H-tree: recursive pairwise combine, active or resistive */
    var active = (id === 'h-tree-active');
    var cur = leaves.slice();
    var lev = 0;
    while (cur.length > 1) {
      lev++;
      var next = [];
      var colX = 6 + (W - 26) * lev / (levels + 0.4);
      for (var k = 0; k < cur.length; k += 2) {
        var a = cur[k], b = cur[k + 1];
        if (!b) { next.push({ x: colX, y: a.y, i: -1 }); links.push({ x1: a.x, y1: a.y, x2: colX, y2: a.y, kind: 'pass' }); continue; }
        var my = (a.y + b.y) / 2;
        links.push({ x1: a.x, y1: a.y, x2: colX, y2: a.y, kind: 'branch', level: lev });
        links.push({ x1: b.x, y1: b.y, x2: colX, y2: b.y, kind: 'branch', level: lev });
        links.push({ x1: colX, y1: a.y, x2: colX, y2: b.y, kind: 'join', level: lev });
        nodes.push({ type: active ? 'cell' : 'res', x: colX, y: my, label: active ? 'act' : 'R', level: lev });
        next.push({ x: colX, y: my, i: -1 });
      }
      cur = next;
    }
    links.push({ x1: cur[0].x, y1: cur[0].y, x2: W - 14, y2: H / 2, kind: 'root' });
    nodes.push({ type: 'out', x: W - 10, y: H / 2, label: 'to RFSoC' });

    if (active) {
      return {
        id: id, nCh: nCh, levels: levels, hops: 0, links: links, nodes: nodes, W: W, H: H,
        bom: bomOf([
          ['bbActiveCell', (nCh - 1) * 2, 'active combine cells, both rails — ' + (nCh - 1) + ' per rail over ' + levels + ' levels'],
          ['bbVectorMod', nCh * 2, 'per-channel IQ vector modulator / VGA'],
          ['bbDecap', 1, 'supply decoupling sized for the active cells']
        ]),
        note: levels + ' symmetric levels, ' + (nCh - 1) + ' active cells per rail. Nominally equal path lengths, so ' +
              'skew comes only from cell mismatch accumulating over ' + levels + ' levels.'
      };
    }
    return {
      id: id, nCh: nCh, levels: levels, hops: 0, links: links, nodes: nodes, W: W, H: H,
      bom: bomOf([
        ['bbResistor', (nCh - 1) * 3 * 2, 'resistive star arms, both rails (a Wilkinson is impossible at baseband — no DC path, ~8 nH arms at 1 GHz)'],
        ['bbRootAmp', 2, 'one root amplifier per rail to recover the network loss'],
        ['bbVectorMod', nCh * 2, 'per-channel IQ vector modulator / VGA'],
        ['bbTxDriver', 2, 'strong TX-direction driver fighting the whole tree']
      ]),
      note: 'Purely passive and therefore essentially drift-free — the strongest argument for it. ' +
            'At baseband it must be RESISTIVE, not Wilkinson.'
    };
  }

  /* ======================================================================
     BASEBAND INTER-TILE NETWORK — tiles to the RFSoC backend.

     This is the second tier of the two-stage architecture and it is drawn on
     the same aperture as the LO network. The options give different
     inter-tile wiring, for a physical reason:

       B1 passive resistive -> a FLAT STAR. An N-way resistive combiner is N
          arms meeting at one summing node; hierarchy buys it nothing, so the
          natural layout is every tile routed directly to one node. Long,
          unequal arms and one large driver.
       B2 daisy chain -> a SERPENTINE BUS, tapped and passed at every tile.
       B3 H-tree active -> a HIERARCHICAL H-TREE. Active cells must be staged
          2:1, so the layout is recursive with a cell at every junction.
       B4 current-mode -> the SAME FLAT STAR as B1, deliberately. Its claim
          is about the impedance at the node, not the routing, so the arms
          are identical and only the node and the arm terminations change.
          Drawing it differently would be inventing a distinction.
       B5 digitise-at-tile -> LANES. There is no analog inter-tile network
          to draw at all; each tile owns a serial link to the backend.

     The backend sits above the aperture, opposite the LO source below it.
     ================================================================== */
  function bbNet(grid, g) {
    var id = g.bbOptionId;
    if (BB_KINDS.indexOf(id) < 0) {
      throw new Error('Topo.bbNet: unknown baseband option id ' + JSON.stringify(id) +
        ' (expected one of ' + BB_KINDS.join(', ') + ')');
    }
    var apCm = grid.cols * grid.tileCm;
    var root = { x: apCm / 2, y: -2.6 };
    var links = [], nodes = [];
    var fBb = (g.bbEdgeGHz || 1) * 1e9;

    nodes.push({ type: 'backend', x: root.x, y: root.y, label: 'RFSoC', freqHz: fBb });

    function emit(x1, y1, x2, y2, kind, level) {
      manhattan(x1, y1, x2, y2).forEach(function (s) {
        links.push({ x1: s[0], y1: s[1], x2: s[2], y2: s[3], kind: kind, level: level, net: 'bb' });
      });
      return Math.abs(x2 - x1) + Math.abs(y2 - y1);
    }

    if (id === 'passive-50') {
      /* flat star: one summing node just inside the aperture edge */
      var sum = { x: apCm / 2, y: -0.9 };
      nodes.push({ type: 'sum', x: sum.x, y: sum.y, label: 'Σ', freqHz: fBb });
      emit(sum.x, sum.y, root.x, root.y, 'bbroot', 0);
      grid.tiles.forEach(function (t) {
        var len = emit(t.bbX, t.bbY, sum.x, sum.y, 'bbarm', 1);
        t.bbPathCm = len;
        t.bbLevel = 1;
        nodes.push({ type: 'res', x: t.bbX, y: t.bbY, label: 'R', freqHz: fBb, tile: t.i });
      });
      nodes.push({ type: 'drv', x: sum.x + 1.6, y: sum.y, label: 'drv', freqHz: fBb });
      return finish('star', 1);
    }

    if (id === 'bb-daisy') {
      /* serpentine bus, tapped at every tile */
      var order = [];
      for (var r = 0; r < grid.rows; r++) {
        var row = grid.tiles.filter(function (t) { return t.r === r; });
        row.sort(function (a, b) { return r % 2 === 0 ? a.c - b.c : b.c - a.c; });
        order = order.concat(row);
      }
      var px = order[0].bbX, py = order[0].bbY, acc = 0;
      nodes.push({ type: 'term', x: px - grid.tileCm * 0.34, y: py, label: '50Ω', freqHz: fBb });
      emit(px - grid.tileCm * 0.34, py, px, py, 'bbhop', 0);
      order.forEach(function (t, k) {
        if (k > 0) acc += emit(px, py, t.bbX, t.bbY, 'bbhop', k);
        t.bbPathCm = acc;
        t.bbHop = k + 1;
        t.bbLevel = k + 1;
        nodes.push({ type: 'tap', x: t.bbX, y: t.bbY, label: 'tap', freqHz: fBb, tile: t.i });
        px = t.bbX; py = t.bbY;
      });
      /* the far end of the bus runs up to the backend. Signals travel FROM
         each tap TOWARD that end, so tile k's path is the remaining bus
         length after it, not the length before it. */
      var tail = emit(px, py, root.x, root.y, 'bbroot', 0);
      var busTotal = acc;
      grid.tiles.forEach(function (t) { t.bbPathCm = (busTotal - t.bbPathCm) + tail; });
      nodes.push({ type: 'drv', x: root.x - 1.8, y: root.y, label: 'drv', freqHz: fBb });
      return finish('bus', order.length);
    }

    /* B4 current-mode: like B1 a single summing node, because a virtual
       ground gains nothing from hierarchy either — but the node is held low
       by a TIA rather than being a resistive junction, so the arms carry
       current and their length costs delay, not division. */
    if (id === 'current-mode') {
      var vg = { x: apCm / 2, y: -0.9 };
      nodes.push({ type: 'cell', x: vg.x, y: vg.y, label: 'TIA', freqHz: fBb });
      emit(vg.x, vg.y, root.x, root.y, 'bbroot', 0);
      grid.tiles.forEach(function (t) {
        var len = emit(t.bbX, t.bbY, vg.x, vg.y, 'bbarm', 1);
        t.bbPathCm = len;
        t.bbLevel = 1;
        nodes.push({ type: 'src', x: t.bbX, y: t.bbY, label: 'I', freqHz: fBb, tile: t.i });
      });
      return finish('star', 1);
    }

    /* B5 digitise at the tile: there is no analog inter-tile network to
       draw. Each tile has its own serial lane to the backend, and the
       drawing says so — the arms are digital links, not signal paths whose
       length enters a phase budget. */
    if (id === 'digital-tile') {
      grid.tiles.forEach(function (t) {
        var len = emit(t.bbX, t.bbY, root.x, root.y, 'bbdigital', 1);
        t.bbPathCm = len;
        t.bbLevel = 1;
        nodes.push({ type: 'serdes', x: t.bbX, y: t.bbY, label: 'SerDes', freqHz: fBb, tile: t.i });
      });
      return finish('lanes', 1);
    }

    /* B3: hierarchical H-tree with an active cell at every junction */
    var maxLev = 0;
    function recurse(group, fromX, fromY, acc, level) {
      maxLev = Math.max(maxLev, level);
      if (group.length === 1) {
        var t = group[0];
        t.bbPathCm = acc + emit(fromX, fromY, t.bbX, t.bbY, 'bbarm', level);
        t.bbLevel = level;
        nodes.push({ type: 'cell', x: t.bbX, y: t.bbY, label: 'act', freqHz: fBb, tile: t.i });
        return;
      }
      var xs = group.map(function (t) { return t.bbX; });
      var ys = group.map(function (t) { return t.bbY; });
      var byX = (Math.max.apply(null, xs) - Math.min.apply(null, xs)) >=
                (Math.max.apply(null, ys) - Math.min.apply(null, ys));
      var sorted = group.slice().sort(function (a, b) { return byX ? a.bbX - b.bbX : a.bbY - b.bbY; });
      var half = Math.floor(sorted.length / 2);
      var gx = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
      var gy = ys.reduce(function (a, b) { return a + b; }, 0) / ys.length;
      var fed = acc + emit(fromX, fromY, gx, gy, level === 0 ? 'bbroot' : 'bbarm', level);
      nodes.push({ type: 'cell', x: gx, y: gy, label: '2:1', freqHz: fBb, level: level });
      recurse(sorted.slice(0, half), gx, gy, fed, level + 1);
      recurse(sorted.slice(half), gx, gy, fed, level + 1);
    }
    recurse(grid.tiles.slice(), root.x, root.y, 0, 0);
    return finish('htree', maxLev);

    function finish(kind, depth) {
      var lens = grid.tiles.map(function (t) { return t.bbPathCm; });
      var mean = lens.reduce(function (a, b) { return a + b; }, 0) / lens.length;
      var spread = Math.sqrt(lens.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / lens.length);
      var total = links.reduce(function (a, L) {
        return a + Math.abs(L.x2 - L.x1) + Math.abs(L.y2 - L.y1);
      }, 0);
      return {
        id: id, kind: kind, depth: depth, links: links, nodes: nodes, root: root,
        pathMeanCm: mean, pathMaxCm: Math.max.apply(null, lens),
        pathMinCm: Math.min.apply(null, lens), pathRmsSpreadCm: spread,
        totalRoutedCm: total,
        cellCount: nodes.filter(function (n) { return n.type === 'cell'; }).length,
        /* B1 and B4 route identically — both are a flat star into one node,
           and the map draws the same arms for each. That is not the drawing
           losing the distinction: the difference between them is the
           impedance at the node, not the geometry, and the note is where it
           has to be said. */
        note: kind === 'star'
          ? (id === 'current-mode'
              ? grid.nTiles + ' arms meeting at one virtual ground. The routing is the same flat star the resistive network uses — what differs is the node: each arm delivers current into a held-at-zero summing point, so arm impedance and arm mismatch stop dividing the signal and one TIA per rail replaces the whole staged combine.'
              : grid.nTiles + ' arms meeting at one summing node. Hierarchy buys a resistive combiner nothing, so the natural layout is a flat star — at the cost of long unequal arms and one large driver.')
          : kind === 'bus'
            ? 'One bus tapped and passed at all ' + grid.nTiles + ' tiles. Shortest total wire of any of the options, but the delay accumulates monotonically along it.'
            : kind === 'lanes'
              ? 'No analog inter-tile network at all: ' + grid.nTiles + ' independent serial lanes to the backend. The arms drawn are digital links, so their length sets a latency to be de-skewed, not a phase to be budgeted.'
              : depth + ' levels of 2:1 active cells. Nominally equal path lengths, so the inter-tile skew comes from cell mismatch rather than geometry.'
      };
    }
  }

  /* ======================================================================
     Public entry point.
     ================================================================== */
  /* OPTS is keyed by the STRING option id. `g.loOption` is the raw numeric
     slider index and `g.loOptionId` the resolved id; Model.evalLo hands us a
     copy of g whose loOptionId it has overwritten with the option under test.
     Read the id, and refuse an unknown one — indexing this table with the
     numeric field silently returned undefined, and the `|| OPTS['mid-mult']`
     that used to catch it made the hardware map draw A4 for every one of the
     six architectures without any visible sign that it had. */
  function loBuilder(g) {
    var id = g.loOptionId;
    if (!OPTS[id]) {
      throw new Error('Topo.build: unknown LO option id ' + JSON.stringify(id) +
        ' (expected one of ' + Object.keys(OPTS).join(', ') + ')');
    }
    return OPTS[id];
  }

  function build(g) {
    var grid = makeGrid(g);
    var fn = loBuilder(g);
    var lo = fn(g, grid);
    lo.grid = grid;

    /* path-length statistics used by the numeric model */
    var lens = grid.tiles.map(function (t) { return t.pathCm; });
    lo.pathMinCm = Math.min.apply(null, lens);
    lo.pathMaxCm = Math.max.apply(null, lens);
    lo.pathMeanCm = lens.reduce(function (a, b) { return a + b; }, 0) / lens.length;
    var mu = lo.pathMeanCm;
    lo.pathRmsSpreadCm = Math.sqrt(lens.reduce(function (a, b) { return a + (b - mu) * (b - mu); }, 0) / lens.length);
    lo.totalRoutedCm = lo.net.links.reduce(function (a, L) {
      return a + Math.abs(L.x2 - L.x1) + Math.abs(L.y2 - L.y1);
    }, 0);
    lo.maxSeriesSegments = Math.max.apply(null, grid.tiles.map(function (t) { return t.segments; }));
    lo.maxRepeatersInPath = lo.net.maxAmpsInPath || 0;
    lo.splitCount = lo.net.nodes.filter(function (n) { return n.type === 'split'; }).length;

    return {
      lo: lo,
      bb: buildBb(g.bbOptionId, g),                 /* intra-tile, 32 channels */
      bbInter: bbNet(grid, g),                      /* inter-tile, tiles → RFSoC */
      grid: grid
    };
  }

  window.Topo = {
    build: build, buildBb: buildBb, bbNet: bbNet,
    makeGrid: makeGrid, manhattan: manhattan
  };
})();
