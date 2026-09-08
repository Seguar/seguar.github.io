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
    tiles.forEach(function (t) { layDies(t, g, tileCm); });
    return grid;
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
      var alpha = window.K.lineAlphaDbCm(g.refMedium, refHz);
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
      var alpha = window.K.lineAlphaDbCm(g.loMedium, fHz);
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
      var alpha = window.K.lineAlphaDbCm(g.loMedium, fHz);
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
    'mid-mult': function (g, grid) {
      var M = Math.max(2, Math.round(g.midM));
      var fHz = g.fLoGHz * 1e9 / M;
      var alpha = window.K.lineAlphaDbCm(g.loMedium, fHz);
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
  function buildBb(id, g) {
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
          ['bbTap', nCh * 2, 'one tap per channel per rail (I and Q)'],
          ['bbRootAmp', 2, 'one root amplifier per rail']
        ]),
        note: 'One wire, ' + nCh + ' taps. Simplest routing, but tap capacitance grows with channel count so ' +
              'the bandwidth collapses, and the delay ramp survives calibration as a frequency-dependent beam steer.'
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
     the same aperture as the LO network. The three options give genuinely
     different inter-tile wiring, for a physical reason:

       B1 passive resistive -> a FLAT STAR. An N-way resistive combiner is N
          arms meeting at one summing node; hierarchy buys it nothing, so the
          natural layout is every tile routed directly to one node. Long,
          unequal arms and one large driver.
       B2 daisy chain -> a SERPENTINE BUS, tapped and passed at every tile.
       B3 H-tree active -> a HIERARCHICAL H-TREE. Active cells must be staged
          2:1, so the layout is recursive with a cell at every junction.

     The backend sits above the aperture, opposite the LO source below it.
     ================================================================== */
  function bbNet(grid, g) {
    var id = g.bbOptionId || 'h-tree-active';
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
        note: kind === 'star'
          ? grid.nTiles + ' arms meeting at one summing node. Hierarchy buys a resistive combiner nothing, so the natural layout is a flat star — at the cost of long unequal arms and one large driver.'
          : kind === 'bus'
            ? 'One bus tapped and passed at all ' + grid.nTiles + ' tiles. Shortest total wire of the three, but the delay accumulates monotonically along it.'
            : depth + ' levels of 2:1 active cells. Nominally equal path lengths, so the inter-tile skew comes from cell mismatch rather than geometry.'
      };
    }
  }

  /* ======================================================================
     Public entry point.
     ================================================================== */
  function build(g) {
    var grid = makeGrid(g);
    var fn = OPTS[g.loOption] || OPTS['mid-mult'];
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
      bb: buildBb(g.bbOptionId || g.bbOption, g),   /* intra-tile, 32 channels */
      bbInter: bbNet(grid, g),                      /* inter-tile, tiles → RFSoC */
      grid: grid
    };
  }

  window.Topo = {
    build: build, buildBb: buildBb, bbNet: bbNet,
    makeGrid: makeGrid, manhattan: manhattan
  };
})();
