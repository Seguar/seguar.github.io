/* ============================================================================
   shortlist.js — nine realistic architectures, curated, for side-by-side
   comparison in the Systems view.

   WHY THIS IS NOT THE CHOOSER. search() in model.js holds the parameter state
   fixed and varies only the three OPTION axes, so every one of its 350
   candidates shares one tile pitch, one RF bandwidth, one medium and one
   converter FOM. A comparison ACROSS RF BANDWIDTH is not expressible there at
   all. A saved system is a whole parameter state, so it is — which is why the
   shortlist loads into Systems rather than becoming a twelfth view.

   WHY NINE AND NOT THE WHOLE SPACE. The space is 350 combinations before the
   bandwidth axis multiplies it. Nothing is learned by ranking 1750 rows; the
   question a candidacy committee asks is "which handful would you build, and
   what does each one teach". Every entry below earns its place by
   demonstrating something NO OTHER entry demonstrates, and that claim is
   written down next to it so it can be argued with.

   THE TWO RESULTS THE SET EXISTS TO SHOW, both measured rather than asserted:

     1. THE LO FAMILY IS A NULL RESULT ON THE LINK. Across all seven LO
        options at C1/B3/2 GHz the link returns the same 4.00 Gb/s and a
        headroom spread of 0.088 dB, while the inter-tile residual spans
        0.147° to 3.139° — a 21x spread that the link cannot see, because a
        3.1° RMS phase error is about 0.013 dB of coherence loss. Worse, the
        spread SHRINKS as the channel widens: 0.72 dB at 0.25 GHz, 0.088 at
        2 GHz, 0.045 at 4 GHz. The LO choice is decided on coherence,
        calibration burden, power and risk. It is not decided on throughput,
        and a comparison that ranks LO options by link margin is measuring
        its own noise floor.

     2. THE SAME BANDWIDTH AXIS SEPARATES THE BASEBAND FAMILY BY ~20 dB.
        Headroom spread across the five baseband options is 25.15 dB at
        0.25 GHz and 19.54 dB from 1 GHz up, and the achievable rates
        genuinely differ — at 4 GHz B3 delivers 7 Gb/s, B4 5, B5 2, and B1
        and B2 do not close the link at all. So RF bandwidth is a BASEBAND
        question wearing an RF label.

   THE BANDWIDTH LADDER is the real E-band channel plan, not round numbers:
   ITU-R F.2006 and ECC-REC-(05)07 build every channel from a 250 MHz
   elementary block, 2000 MHz is the widest single channel any shipping radio
   offers, and 4000 MHz exists only by carrier aggregation of 2 x 2000.

   Each entry stores a SPARSE override on today's defaults, deliberately: the
   shortlist should track the model as the model improves, the way a permalink
   does. A saved system stores a full state and does not move. Both behaviours
   are correct for their purpose; the Systems view says which one it is
   looking at.

   Exposes window.Shortlist.
   ========================================================================= */
(function () {
  'use strict';

  /* Option indices, resolved by NAME at load time rather than hard-coded, so
     that reordering LO_META / BB_META / ANT_META can never silently turn one
     architecture into a different one. clampParam snaps an out-of-range index
     to the NEAREST legal value without reporting it, which is exactly how a
     reordered table would rewrite this list into plausible nonsense. */
  function idx(list, id) {
    var i = list.indexOf(id);
    if (i < 0) throw new Error('shortlist.js: no option "' + id + '" — the option tables have changed ' +
      'and this entry must be revisited, not silently remapped.');
    return i;
  }

  function build() {
    var M = window.Model;
    var LO = M.LO_IDS, BB = M.BB_IDS, ANT = M.ANT_IDS;

    function S(lo, bb, ant, k, span, bw, extra) {
      var o = {
        loOption: idx(LO, lo), bbOption: idx(BB, bb), antOption: idx(ANT, ant),
        radPerCh: k, rfBwGHz: bw
      };
      if (span !== null) o.radSpanPitch = span;
      if (extra) Object.keys(extra).forEach(function (x) { o[x] = extra[x]; });
      return o;
    }

    return [
      {
        id: 'anchor',
        name: 'Anchor — A4 / B3 / 1 patch, 2 GHz',
        over: S('mid-mult', 'h-tree-active', 'single-patch', 1, null, 2),
        demonstrates: 'That the die constraint is invisible to every analog option.',
        why: 'The tool’s own default pick, at the widest single channel a shipping E-band radio ' +
          'offers. It is the reference every other row is read against: QPSK, 4.00 Gb/s, 2.84 dB of ' +
          'headroom, 0.147° of inter-tile residual against a 5° spec, and 8.6% of one baseband ' +
          'die. The 1:1 pairing costs it nothing at all — which is the point. A constraint that ' +
          'bites everything is a modelling error; this one bites exactly one option.'
      },
      {
        id: 'lo-null',
        name: 'LO null result — A4 / B3 / 1×4 col, 2 GHz',
        over: S('mid-mult', 'h-tree-active', 'cross-column', 4, 0, 2),
        demonstrates: 'That the seven-option LO family is a null result on the link, and that what ' +
          'actually moves throughput is the antenna.',
        why: 'Identical to the anchor except for four patches per channel across the scan plane. ' +
          'Element directivity goes 6 → 11.15 dBi, the array reaches 31.63 dBi, and the link steps ' +
          'from QPSK to 16QAM: 4.00 → 8.00 Gb/s, headroom 2.84 → 10.95 dB. One antenna change is ' +
          'worth 8.11 dB where the entire LO family is worth 0.088. Compare this row against the ' +
          'anchor and against row 3, and the shape of the whole trade is on one screen.'
      },
      {
        id: 'pll-tension',
        name: 'Ranked last, best link — A1 / B3 / 1×4, 2 GHz',
        over: S('local-pll', 'h-tree-active', 'cross-column', 4, 0, 2),
        demonstrates: 'That the tool’s weighted ranking and its throughput point in opposite ' +
          'directions, and why the ranking is still right.',
        why: 'A1 finishes LAST of seven on the Decision score — 0.2700 against A4’s 0.7433 — ' +
          'while returning the HIGHEST link headroom in the whole set at 11.38 dB. Both are true. The ' +
          'ranking weights coherence, calibration burden, power and risk; A1’s 3.139° residual is ' +
          'the worst here and eats 63% of the 5° spec, but 3.139° RMS is only about 0.013 dB of ' +
          'coherence loss, so the link never notices. Anyone who picks an LO on link margin picks this ' +
          'one. That is the trap this row exists to spring.'
      },
      {
        id: 'current-mode',
        name: 'Current-mode — A4 / B4 / 1 patch, 2 GHz',
        over: S('mid-mult', 'current-mode', 'single-patch', 1, null, 2),
        demonstrates: 'That the constraint’s cost to B4 is power and physics, never area.',
        why: 'B4 is the anchor’s co-leader — 0.8612 against B3’s 0.8719, inside the 0.02 tie ' +
          'epsilon, so the tool reports a tie rather than a winner. A virtual ground removes B1’s ' +
          'division loss entirely (0.911 dB against 12.952) and collapses the cascade to one stage. It ' +
          'uses 9.3% of a die, the most of any analog option, and that is still nothing. What it ' +
          'actually pays is 2.5 GHz of summing-node bandwidth — a fixed assumption about the TIA, ' +
          'not a curve the model recomputes — which is what caps it at 5 Gb/s when B3 reaches 7.'
      },
      {
        id: 'overflow',
        name: 'OVERFLOW — A4 / B5 digital tile, 1 GHz',
        over: S('mid-mult', 'digital-tile', 'single-patch', 1, null, 1),
        demonstrates: 'The 6.25 mm² trap: the only row in the set that fails, and it fails on ' +
          'floorplan rather than on any number the tool used to report.',
        why: 'INCLUDED BECAUSE IT FAILS. Its per-tile baseband area is 6.67 mm² against a 25 mm² ' +
          'budget — 27%, comfortable, and completely misleading. Under 1:1 the tile is four separate ' +
          'dies and the converter complex cannot be sawn across them: 5.71 mm² of per-tile singletons ' +
          'land whole on ONE die plus its own 0.24 mm² share, giving 95.2% core utilisation before the ' +
          'pad ring, the seal ring and the ~20 high-speed SerDes pads. Narrowing the channel cannot ' +
          'rescue it, because B5’s area is bandwidth-invariant. Escaping it needs a fifth die per ' +
          'tile, which is the pairing broken. It also takes 54.8% of the array power budget.'
      },
      {
        id: 'top-rung',
        name: 'Top rung — A4 / B1 / board radiator, 4 GHz',
        over: S('mid-mult', 'passive-50', 'board-radiator', 1, null, 4),
        demonstrates: 'That area is not what is scarce: the option with the emptiest die is the one ' +
          'that loses the link.',
        why: 'The only honest 4 GHz row in the space, and every substitution in it is forced rather ' +
          'than chosen. 4 GHz exists only as 2 × 2000 MHz carrier aggregation, and B1 is the only ' +
          'baseband whose bandwidth reaches 4.0 GHz unclipped — B3 clips to 3.5, B4 to 2.5, B5 to 1.0. ' +
          'It uses 5.7% of a die, the emptiest in the set, and pays 12.95 dB of net resistive division ' +
          'loss for the privilege, leaving 3.09 dB of headroom. C4 is required because a package patch ' +
          'covers 4% fractional bandwidth and 71–86 GHz is 15 GHz wide.'
      },
      {
        id: 'elementary',
        name: 'Elementary channel — A4 / B2 daisy, 0.25 GHz',
        over: S('mid-mult', 'bb-daisy', 'single-patch', 1, null, 0.25),
        demonstrates: 'A constraint that creates an option while the geometry destroys it anyway — ' +
          'the only row where two effects run in opposite directions.',
        why: 'The pairing is what makes this row expressible: at 16 channels B2’s derived bandwidth ' +
          'is 4/16 = 0.250 GHz EXACTLY, the ITU-R F.2006 elementary channel, where at 32 it sat below ' +
          'its own 0.15 GHz clamp and the formula never evaluated. The constraint also gave B2 6.40 dB ' +
          'of loss back. And it still does not close the link: headroom −13.75 dB, no constellation ' +
          'at all. The killer is not bandwidth and not loss — it is that a serial inter-tile chain ' +
          'spreads path delay 1872 ps beyond what the TTD’s 866 ps range can compensate, costing ' +
          '11.23 dB of squint loss and saturating the beam steer. Its other apparent advantage, being ' +
          'cheapest on power, was a BOM defect: it never booked the per-channel vector modulators.'
      },
      {
        id: 'inj-lock',
        name: 'Injection lock — A6 / B3 / 1×4 col, 2 GHz',
        over: S('inj-lock', 'h-tree-active', 'cross-column', 4, 0, 2),
        demonstrates: 'The one LO whose noise mechanism is not a loop bandwidth — and that even ' +
          'that does not move the link.',
        why: 'Injection locking has no PFD, no charge pump and no divider, and its lock corner is ' +
          'hundreds of MHz where a PLL closes a few, so it suppresses the distribution path’s ' +
          'additive noise over a far wider band than A4. It is also the cheapest LO in the set at ' +
          '16.1% of array power. Its price is a new error class: the locked phase offset ' +
          'arcsin(Δf/f_lock) differs tile to tile with process spread, giving 2.235° of residual ' +
          'against A4’s 0.147°. Set beside row 2, which is identical but for the LO: same 8.00 Gb/s, ' +
          'same 10.95 dB of headroom, to three figures. That is finding 1 in a single pair of rows.'
      },
      {
        id: 'radial',
        name: 'Radial feed — A7 / B4 / 1 patch, 2 GHz',
        over: S('radial-feed', 'current-mode', 'single-patch', 1, null, 2),
        demonstrates: 'The only architecture with zero path imbalance by construction, and the only ' +
          'one whose dominant error is neither thermal nor static.',
        why: 'One centre junction, every run meandered to the 16.97 cm corner radius: path imbalance ' +
          'is identically 0 ps against A4’s 81.3, calibration range drops from 6.45 wraps to 0.44 — ' +
          'under one wrap removes the integer ambiguity rather than shrinking it — and distribution ' +
          'loss falls 36.5 → 22.5 dB. The zero is BOUGHT, not free: a 5×5 grid has five distinct ' +
          'radii spreading 4.19 cm RMS, so every tile pays the longest path. Its weakness is the ' +
          'reason it earns a column: no isolation resistors, so mismatch coupling gives ' +
          'arcsin(Γ√(N−1)/N) = 2.249° that drifts whenever a neighbour’s match changes and no ' +
          'per-tile LUT can hold.'
      }
    ];
  }

  /* Systems.save() slices a name to 48 characters WITHOUT reporting it, so a
     name written one character too long here comes back cut mid-word as a
     column header and nothing says why. Check it at build time instead: this
     file's whole purpose is that nothing about these nine changes silently. */
  var NAME_MAX = 48;

  var cache = null;
  function list() {
    if (!cache) {
      var built = build();
      var over = built.filter(function (e) { return e.name.length > NAME_MAX; });
      if (over.length) {
        throw new Error('shortlist.js: ' + over.length + ' name(s) exceed the ' + NAME_MAX +
          '-character limit Systems.save() silently truncates at, starting with "' +
          over[0].name + '" (' + over[0].name.length + '). Shorten the name rather than ' +
          'letting it be cut mid-word in a column header.');
      }
      var ids = built.map(function (e) { return e.id; });
      ids.forEach(function (id, i) {
        if (ids.indexOf(id) !== i) throw new Error('shortlist.js: duplicate id "' + id + '".');
      });
      cache = built;
    }
    return cache;
  }

  window.Shortlist = {
    list: list,
    count: function () { return list().length; }
  };
})();
