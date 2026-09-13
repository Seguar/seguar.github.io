/* ============================================================================
   decision.js — the written recommendation, generated from the live numbers.

   Hard constraints gate first (an option that fails the coherence spec or is
   not realisable in the stated technology cannot be chosen on points), then
   a transparent weighted score ranks the survivors. The weights are visible
   and editable judgement, not physics, and the text says so.

   Exposes window.Decision.
   ========================================================================= */
(function () {
  'use strict';

  var WEIGHTS = [
    { key: 'coherence', label: 'Irreducible inter-tile phase error', w: 0.34, better: 'low',
      get: function (r) { return r.interTileResidualDeg; },
      why: 'The part no calibration removes. It sets the null-depth floor and therefore the spatial-multiplexing ceiling.' },
    { key: 'power', label: 'Distribution power', w: 0.22, better: 'low',
      get: function (r) { return r.powerFracOfArray; },
      why: 'As a percentage of the array power budget. A distribution network that costs a fifth of the array is a system-level problem.' },
    { key: 'loss', label: 'Distribution loss', w: 0.14, better: 'low',
      get: function (r) { return r.lossTotalDb; },
      why: 'Drives amplifier count, which drives power, area and additive noise.' },
    { key: 'risk', label: 'Implementation risk', w: 0.20, better: 'low',
      get: function (r) { return r.riskLevel === 'low' ? 1 : r.riskLevel === 'medium' ? 2 : 3; },
      why: 'Technology reach, mechanical tolerance, and how far one dead block propagates.' },
    { key: 'cal', label: 'Calibration burden', w: 0.10, better: 'low',
      get: function (r) { return r.calBurdenScore; },
      why: 'LO measurements per array pass, weighted by estimator conditioning.' }
  ];

  /* WHEN IS A LEAD A DECISION, AND WHEN IS IT NOISE?
     The weights above are declared judgement, written to two decimals. Move
     0.01 of weight from one criterion to another and any single option's
     score moves by at most 0.01, so the GAP between two options moves by at
     most 0.02. A lead smaller than that cannot survive a re-weighting its
     own author would sign, and reporting it as a winner is exactly the
     false precision this tool exists to avoid.

     This is not hypothetical here. At the default geometry the baseband
     lead is 0.0011 — one part in eight hundred — and it changes hands
     between B3 and B4 on a change of tile pitch. The LO lead is 0.17,
     eight times the threshold, and holds across every sweep in the tool.
     So the tool says "A4, decisively" and "B3 and B4, indistinguishable",
     which are two different kinds of claim and must not be rendered the
     same way. */
  var TIE_EPS = 0.02;

  /* The leader plus everyone within TIE_EPS of it, in rank order. Length 1
     means the lead is real. Ineligible options never join: failing a hard
     constraint is not a near-miss on points. */
  function tiedWithLeader(rank) {
    if (!rank.length) return [];
    var out = [rank[0]];
    for (var i = 1; i < rank.length; i++) {
      if (rank[0].eligible && !rank[i].eligible) break;
      if (rank[0].score - rank[i].score > TIE_EPS) break;
      out.push(rank[i]);
    }
    return out;
  }

  function normalise(vals, better) {
    var f = vals.filter(isFinite);
    if (!f.length) return vals.map(function () { return 0.5; });
    var lo = Math.min.apply(null, f), hi = Math.max.apply(null, f);
    var span = hi - lo;
    return vals.map(function (v) {
      if (!isFinite(v)) return 0.5;
      if (span < 1e-12) return 1;
      var t = (v - lo) / span;
      return better === 'low' ? 1 - t : t;
    });
  }

  function rankLo(res, budget) {
    var meta = window.Model.LO_META;
    var ids = meta.map(function (m) { return m.id; });
    var rows = ids.map(function (id) { return res.lo[id]; });

    var scores = ids.map(function () { return 0; });
    var detail = ids.map(function () { return []; });
    WEIGHTS.forEach(function (W) {
      var norm = normalise(rows.map(W.get), W.better);
      norm.forEach(function (n, i) {
        scores[i] += n * W.w;
        detail[i].push({ label: W.label, raw: W.get(rows[i]), norm: n, w: W.w });
      });
    });

    var out = ids.map(function (id, i) {
      var r = rows[i];
      var meetsSpec = r.interTileResidualDeg <= budget.sigSpecDeg;
      var infeasible = /beyond the technology|extreme/.test(r.feasibility || '');
      return {
        id: id, name: meta[i].name, short: meta[i].short, r: r,
        score: scores[i], detail: detail[i],
        meetsSpec: meetsSpec, infeasible: infeasible,
        eligible: meetsSpec && !infeasible
      };
    });

    out.sort(function (a, b) {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return b.score - a.score;
    });
    return out;
  }

  function rankBb(res, budget) {
    var meta = window.Model.BB_META;
    var ids = meta.map(function (m) { return m.id; });
    var rows = ids.map(function (id) { return res.bb[id]; });
    var W = [
      { w: 0.30, better: 'low', get: function (r) { return r.squintLossDb; } },
      { w: 0.22, better: 'low', get: function (r) { return r.powerPerTileMw; } },
      { w: 0.18, better: 'low', get: function (r) { return r.nfPenaltyDb; } },
      { w: 0.16, better: 'high', get: function (r) { return r.bwGHz; } },
      { w: 0.14, better: 'low', get: function (r) { return r.riskLevel === 'low' ? 1 : r.riskLevel === 'medium' ? 2 : 3; } }
    ];
    var scores = ids.map(function () { return 0; });
    W.forEach(function (w) {
      normalise(rows.map(w.get), w.better).forEach(function (n, i) { scores[i] += n * w.w; });
    });
    var out = ids.map(function (id, i) {
      return { id: id, name: meta[i].name, short: meta[i].short, r: rows[i], score: scores[i] };
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  function n(v, d) { return window.UI.num(v, d); }

  /* ------------------------------- the prose ------------------------------ */
  function prose(res, budget, loRank, bbRank, loTied, bbTied) {
    var g = res.g;
    var pick = loRank[0], second = loRank[1];
    var bpick = bbRank[0], bsecond = bbRank[1];
    loTied = loTied || [pick]; bbTied = bbTied || [bpick];
    function names(set) {
      var ns = set.map(function (o) { return o.short; });
      return ns.length < 2 ? ns[0] : ns.slice(0, -1).join(', ') + ' and ' + ns[ns.length - 1];
    }
    var a1 = res.lo['local-pll'], a2 = res.lo['hf-foldback'], a3 = res.lo['daisy-chain'], a4 = res.lo['mid-mult'];
    var nT = budget.nTiles;
    var t = [];

    t.push('### The decision');
    t.push('For the LO and reference distribution, take **' + pick.name + '**' +
      (pick.r.tileMultiplier > 1 ? ' at ×' + pick.r.tileMultiplier + ', distributing ' + n(pick.r.distFreqGHz) + ' GHz on the board' : '') +
      (loTied.length > 1 ? ' — though ' + names(loTied) + ' are within `' + n(Math.abs(pick.score - loTied[loTied.length - 1].score), 3) +
        '` of each other on a 0–1 score, which these weights cannot resolve' : '') +
      '. For the baseband split and combine, ' +
      (bbTied.length > 1
        ? '**' + names(bbTied) + ' are tied**: `' + bbTied.map(function (o) { return n(o.score, 3); }).join('` vs `') +
          '` on a 0–1 score, a lead of `' + n(Math.abs(bpick.score - bbTied[bbTied.length - 1].score), 3) +
          '` against the `' + n(TIE_EPS, 2) + '` that a single defensible re-weighting can move. Pick between them on ' +
          'grounds this model does not carry — the impedance regime of §5, layout area, or what the combiner IC ' +
          'already implements — not on the ranking.'
        : 'take **' + bpick.name + '**.'));

    t.push('### Why, in numbers');
    t.push('The requirement is an inter-tile differential phase error below `' + n(budget.sigSpecDeg) + '° RMS` ' +
      '(binding criterion: ' + budget.bindingName + '), which at ' + nT + ' independent tiles corresponds to a ' +
      'scattered-sidelobe and null-depth floor of `' + n(budget.nullFloorDb, 1) + ' dB`. Separately, the link needs the ' +
      '*absolute* array-output phase noise below `' + n(budget.sigForEvmDeg) + '° RMS` for ' + budget.qam + '.');

    t.push('The four options land as follows on the metric that cannot be calibrated away — the residual ' +
      'inter-tile phase error:');
    loRank.slice().sort(function (a, b) { return a.r.interTileResidualDeg - b.r.interTileResidualDeg; })
      .forEach(function (o) {
        t.push('- **' + o.short + '**: `' + n(o.r.interTileResidualDeg) + '°` residual, null floor `' +
          n(o.r.sllDb, 1) + ' dB`, loss `' + n(o.r.lossTotalDb, 1) + ' dB`, power `' +
          n(o.r.powerTotalMw / 1000, 2) + ' W` (`' + n(o.r.powerFracOfArray, 1) + '%` of the array), ' +
          'calibration must span `' + n(o.r.correctionWraps, 1) + '` wraps of static offset' +
          (o.eligible ? '' : o.infeasible ? ' — **not realisable as configured**' : ' — **fails the coherence spec**'));
      });

    t.push('#### The decisive asymmetry');
    t.push('A per-tile PLL and a shared LO are not simply better and worse — they trade *link EVM* against ' +
      '*beam coherence*, in opposite directions:');
    t.push('- With independent per-tile PLLs, the uncorrelated VCO noise **averages down** by 10log10(' + nT + ') = `' +
      n(10 * Math.log10(nT), 1) + ' dB` in the coherent sum, so the array-output absolute phase error is only `' +
      n(a1.phiArrayDeg) + '°` against `' + n(a1.phiRmsDeg) + '°` for a single tile. That is the option\'s genuine strength, ' +
      'and it is the effect the proposal\'s §4.7 is pointing at.');
    t.push('- But the same uncorrelated noise appears **in full** in the inter-tile differential: `' +
      n(a1.interTileResidualDeg) + '°`, giving a null floor of `' + n(a1.sllDb, 1) + ' dB`. A shared LO reaches `' +
      n(a4.interTileResidualDeg) + '°` and `' + n(a4.sllDb, 1) + ' dB` — a difference of `' +
      n(Math.abs(a1.sllDb - a4.sllDb), 1) + ' dB` in the coherence floor, which directly caps how many spatial streams ' +
      'the array can separate.');
    t.push('BIST cannot recover this. At a ' + n(g.fBistHz) + ' Hz update rate with loop gain µ = ' + n(g.calLoopGain) +
      ', the calibration corner is `' + n(a1.fCalHz, 3) + ' Hz` — essentially all of the integrated phase error lives ' +
      'in the kHz-to-MHz decades, far above it. Calibration re-centres the LUT and removes thermal drift; it does ' +
      'nothing to the VCO-driven inter-tile noise.');

    t.push('#### What mid-frequency distribution does and does not buy');
    t.push('The ×' + Math.round(g.midM) + ' multiplier adds exactly `' + n(20 * Math.log10(g.midM), 1) +
      ' dB` to L(f) and multiplies any distributed phase error by ' + Math.round(g.midM) + '. Since an ideal multiplier ' +
      'preserves *time* delay and multiplies *phase*, the output phase error from a given physical length mismatch is ' +
      '`2π·f_LO·τ` **regardless of the distribution frequency**. So A4 buys no skew relief over A2 — both sit at `' +
      n(a4.skewDeg78) + '°` and `' + n(a2.skewDeg78) + '°` for the same tolerances and topology.');
    t.push('What it does buy is the board. Distributing ' + n(a4.distFreqGHz) + ' GHz instead of ' + g.fLoGHz +
      ' GHz drops the line loss from `' + n(a2.lossPerCmDb, 2) + ' dB/cm` to `' + n(a4.lossPerCmDb, 2) + ' dB/cm`, the ' +
      'total distribution loss from `' + n(a2.lossTotalDb, 1) + ' dB` to `' + n(a4.lossTotalDb, 1) + ' dB`, the repeater ' +
      'count from ' + a2.repeaters + ' to ' + a4.repeaters + ', and the distribution power from `' +
      n(a2.powerTotalMw / 1000, 2) + ' W` to `' + n(a4.powerTotalMw / 1000, 2) + ' W`. It also removes every E-band ' +
      'transition from the board, which is where the unrepeatable phase offsets live.');

    t.push('#### A constraint that applies to all four, and changes the chip partition');
    t.push('!!! warn A 78 GHz gain stage is **not realisable in TSMC 65 nm LP CMOS** (f_max/f ≈ 1.9). A four-stage ' +
      'CMOS chain reaches roughly 0 dBm saturated, and the already-taped-out RFIC needs about +5.6 dBm to drive its ' +
      'four LO taps. Two independently-built block libraries reached this conclusion separately.');
    t.push('The consequence is architectural, not incremental: **the LO last mile cannot live in the 65 nm BB+LO ' +
      'tile**. Every one of the four options therefore needs a small SiGe LO chiplet at each tile, and the ' +
      'proposal\'s two-chip partition (SiGe RF front end + 65 nm BB+LO tile) is really a **three-chip** partition. ' +
      'At `' + n(res.blocks.loChipletSige.powerMw, 0) + ' mW` and `' + n(res.blocks.loChipletSige.areaMm2, 1) +
      ' mm²` per tile that is `' + n(res.blocks.loChipletSige.powerMw * nT / 1000, 2) + ' W` across the array, and ' +
      'it is in every option\'s budget above, so it does not change the ranking — but it does change the tape-out plan.');
    t.push('It does change how much SiGe each option needs, and that is a real discriminator. A2 and A3 need SiGe ' +
      'for the whole distribution network — every repeater and every splitter on the board. A4 needs it only for the ' +
      '×' + Math.round(g.midM) + ' multiplier and the taps, a single well-defined block that can be de-risked on its own. ' +
      'That is the strongest practical argument for A4 beyond the numbers.');

    t.push('#### Why not the daisy chain');
    t.push('The chain has the fewest interconnects and the simplest layout, and its delay ramp is deterministic, so ' +
      'a single calibration removes it — at the calibration frequency. Two things rule it out as the primary choice. ' +
      'First, its per-hop errors form a random **walk** along the aperture whose dominant spatial mode is a beam tilt, ' +
      'so its pointing error is `' + n(a3.pointingErrDeg, 3) + '°` against `' + n(a4.pointingErrDeg, 3) + '°` for the tree ' +
      '— the iid formula does not apply and understates it badly. Second, the residual ramp survives calibration ' +
      'across the band as a pure frequency-dependent steer that only true time delay can remove. With ' +
      Math.round(g.chainBranches) + ' branches the worst chain is ' + (res.lo['daisy-chain'].topo.lo.maxHop || 0) +
      ' hops deep, and one dead buffer disables every tile downstream of it.');
    t.push('Its static offset also accumulates to `' + n(a3.correctionWraps, 0) + '` full wraps at the LO, against `' +
      n(a4.correctionWraps, 0) + '` for the tree. Since a narrowband phase measurement resolves delay only modulo one ' +
      'LO period, that many wraps makes the integer ambiguity a genuine estimation problem rather than a detail — the ' +
      'BIST would have to measure group delay over the full baseband span just to know which wrap each tile is in.');

    t.push('#### Baseband');
    var b1 = res.bb['passive-50'], b2 = res.bb['bb-daisy'], b3 = res.bb['h-tree-active'];
    t.push('The three options give genuinely different inter-tile wiring, and the hardware map draws each of them: ' +
      'a flat **star** for the resistive network (a resistive combiner gains nothing from hierarchy, so every tile ' +
      'routes straight to one summing node), a **serpentine bus** for the daisy chain, and a hierarchical ' +
      '**H-tree** with a 2:1 active cell at every junction. That choice of wiring, not the cell type, is what ' +
      'dominates the numbers.');
    t.push('- **Star**: `' + n(b1.interRoutedCm, 0) + ' cm` of routed wire, arms from `' + n(b1.interPathMeanCm, 0) +
      '` to `' + n(b1.interPathMaxCm, 0) + ' cm`, giving `' + n(b1.interGeoRawPs, 0) + ' ps` of geometric skew.');
    t.push('- **Bus**: only `' + n(b2.interRoutedCm, 0) + ' cm` of wire but the average signal travels `' +
      n(b2.interPathMeanCm, 0) + ' cm` along it, giving `' + n(b2.interGeoRawPs, 0) + ' ps`.');
    t.push('- **H-tree**: `' + n(b3.interRoutedCm, 0) + ' cm` of wire with paths from `' + n(b3.interPathMeanCm, 0) +
      '` to `' + n(b3.interPathMaxCm, 0) + ' cm` — nominally equal, so only `' + n(b3.interGeoRawPs, 0) + ' ps`.');
    t.push('Baseband skew is a **group-delay** error, so unlike an LO phase offset no phase calibration touches it. ' +
      'But the architecture already carries a per-tile coarse true-time-delay element, and absorbing inter-tile ' +
      'delay is exactly its job — so the honest comparison is against its `' + n(b3.ttdRangeAvailPs, 0) +
      ' ps` range. The bus loses outright: `' + n(b2.interUncompPs, 0) + ' ps` of its ramp is **beyond that range**, ' +
      'leaving `' + n(b2.squintLossDb, 1) + ' dB` of band-averaged squint loss. Star and H-tree both fall inside it ' +
      'and land on the same TTD-quantisation floor of `' + n(b3.interGeoSkewPs) + ' ps`.');
    t.push('So the real discriminator is **what fraction of the TTD range each one spends on its own geometry** ' +
      'rather than on steering the beam: `' + n(b1.ttdRangeConsumedPct, 0) + '%` for the star against `' +
      n(b3.ttdRangeConsumedPct, 0) + '%` for the H-tree. Add `' + n(b1.interLossDb, 1) + ' dB` of inter-tile line ' +
      'loss for the star against `' + n(b3.interLossDb, 1) + ' dB`, and `' + n(b1.interRoutedCm / Math.max(b3.interRoutedCm, 1), 1) +
      '×` the routed wire, and the H-tree wins on the network, not on the cells.');
    t.push('The noise-figure argument usually made for active combining is nearly vacuous here: with ' +
      n(g.rficGainDb, 0) + ' dB of RFIC gain ahead of it, even the passive network costs only `' +
      n(b1.nfPenaltyDb, 2) + ' dB`. Do not lead with it.');

    var b4 = res.bb['current-mode'], b5 = res.bb['digital-tile'];
    if (b4 && b5) {
      t.push('**Two options outside the original three, and they matter for different reasons.** B4 is not another ' +
        'topology inside the same impedance regime — it is the impedance regime, which this tool\'s own method ' +
        'note says is worth more decibels than the choice among B1–B3. Every channel drives current into one ' +
        /* 10log10, not 20log10. A matched resistive star's S21 IS a voltage
           ratio of 1/N, but half of that is given straight back by the
           +10log10(N) coherent array gain, and evalBb nets the two at
           model.js:2257 with the comment "Never double-count". Printing the
           raw 20log10 here put 30.1 dB on the same page as the model's
           15.05 dB for the same quantity. */
        'virtual ground: B1\'s `' + n(b1 ? b1.lossTotalDb : 10 * Math.log10(Math.max(g.chPerTile, 2)), 1) +
        ' dB` of net division loss ' +
        'disappears, and so does the H-tree\'s cascade — one stage instead of `' +
        Math.ceil(Math.log2(Math.max(g.chPerTile, 2))) + '`, so `' + n(b4.skewIntraPs) + ' ps` of intra-tile skew ' +
        'against `' + n(b3.skewIntraPs) + ' ps`, no cascaded IIP3 penalty against `' + n(b3.iip3PenaltyDb, 1) +
        ' dB`, and `' + n(b4.nfPenaltyDb, 2) + ' dB` of noise penalty. It costs `' +
        n(b4.powerTotalMw / 1000, 2) + ' W` against the H-tree\'s `' + n(b3.powerTotalMw / 1000, 2) +
        ' W` and gives up bandwidth (`' + n(b4.bwGHz, 1) + '` against `' + n(b3.bwGHz, 1) + ' GHz`). ' +
        /* Say what the model actually does. B4's bwGHz is a CONSTANT 2.5 in
           BB_TRAITS with no bwOf(), so the summing-node capacitance is the
           REASON for the assumption, not a term computed from the channel
           count — unlike B2, which really does derive 4/nCh. Claiming a
           mechanism the model does not implement is the failure mode this
           tool exists to avoid. */
        'That figure is a fixed assumption about the TIA, not a function of the channel count: the summing node ' +
        'holding ' + Math.round(g.chPerTile) + ' channels\' worth of capacitance is why 2.5 GHz was assumed, but ' +
        'unlike B2\'s `4/N` the model does not recompute it as the count moves — so do not read it as a curve. ' +
        'It is a live alternative to B3, not a curiosity.');
      t.push('B5 deletes the analog inter-tile tier outright: combine in the tile, digitise there, send bits. It ' +
        'is what a modern massive-MIMO array actually builds, so its absence would have been the most exposed ' +
        'gap in this comparison — and now that it is priced, the answer is unambiguous. The skew story is far ' +
        'better (`' + n(b5.skewRmsPs) + ' ps` against `' + n(b3.skewRmsPs) + ' ps`, because inter-tile alignment ' +
        'becomes deterministic-latency rather than a routed path length), the loss and noise-figure penalties go ' +
        'to zero, and then the converters cost `' + n(b5.powerTotalMw / 1000, 1) + ' W` — `' +
        n(b5.powerFracOfArray, 0) + '%` of the entire array budget, against `' +
        n(b3.powerFracOfArray, 1) + '%` for the H-tree. At `' + n(g.adcFomFjConv, 0) + ' fJ/conv-step`, `' +
        g.adcBits + ' bits` and `' + n(g.adcGspsPerRail, 1) + ' GS/s` per rail that is ' +
        /* Was Math.round(4 * 49): 4 converters times the tile count of the
           RETIRED 4 cm / 7x7 geometry, frozen as a literal. At the 6 cm
           default there are 25 tiles, so it printed 196 where the array has
           100. Derive it, and it can never go stale again. */
        Math.round(4 * g.nTilesTotal) + ' converters the tile process cannot host anyway. **The right way to say this in ' +
        'the thesis is not "we did not consider digital" but "we costed it: it is ' +
        n(b5.powerTotalMw / Math.max(b3.powerTotalMw, 1), 0) + '× the analog network\'s power and the converters ' +
        'do not fit the 65 nm LP tile."** Move the converter FOM parameter and watch where the crossover lands — ' +
        'that is the number that will change with the process, not the architecture.');
    }
    t.push('Two constraints deserve to be stated explicitly because they are easy to get wrong. A baseband delay is a ' +
      '**group-delay** error at the ' + n(g.bbEdgeGHz) + ' GHz rail edge, not a phase error at ' + g.fLoGHz +
      ' GHz: `' + n(bpick.r.skewRmsPs) + ' ps` of skew is `' + n(bpick.r.skewEdgeDeg) + '°` at the band edge, not `' +
      n(bpick.r.skewRmsPs * window.K.degPerPs(g.fLoHz), 0) + '°`. And at baseband B1 must be a **resistive** network, ' +
      'not a Wilkinson — there is no DC path through a Wilkinson and its arms would need ~8 nH at 1 GHz.');

    t.push('### What would change this answer');
    t.push('- **The uncorrelated in-band share.** A1\'s standing depends on how much of its in-band noise comes from ' +
      'the per-tile PFD/charge-pump/divider rather than the shared reference. It is set to `' + n(g.uncorrInbandFrac, 2) +
      '` here and is a guess. Measure it on the first tile silicon; if it is below ~0.1 and the loop bandwidth can be ' +
      'pushed to several MHz, A1 closes most of the coherence gap and its modularity wins.');
    t.push('- **Achievable E-band line loss.** A2 is ruled out on loss and power at `' + n(a2.lossPerCmDb, 2) +
      ' dB/cm`. Substrate-integrated waveguide or WR-12 changes that by an order of magnitude; if a low-loss E-band ' +
      'medium is available at acceptable cost and assembly tolerance, re-run this comparison.');
    t.push('- **Multiplier additive noise.** A4\'s floor rests on the per-tile multiplier\'s residual phase noise. If ' +
      'measured silicon is worse than the `' + res.blocks.tileMult.addPnFloorDbc + ' dBc/Hz` assumed here, the ' +
      'advantage over A1 narrows.');
    t.push('- **Whether nulling is actually required.** The whole coherence argument rests on null depth and spatial ' +
      'multiplexing. If the demonstration only needs a single high-gain beam with sub-degree pointing, the gain-loss ' +
      'criterion applies instead, every option passes with margin, and A1 wins on modularity and board simplicity.');
    /* This paragraph used to be gated on the lattice alone, with no guard on
       the ELEMENT. With a cell-filling element it therefore printed "the
       binding one is only 140.00 dB below the main beam" and then concluded
       that the null-depth floor is not what limits the array — the opposite
       of what its own number said. It now reads the selected antenna option
       and says which of the two situations the reader is actually in. */
    if (Math.round(g.latticePeriodic) === 1 && g.lobeCount > 0) {
      var supp = -g.gratingSuppDb;
      var antName = (window.Model.ANT_META[Math.round(g.antOption)] || {}).short || 'the selected antenna';
      if (supp < 20) {
        t.push('- **The antenna lattice, which decides whether any of this is the binding metric.** At the current ' +
          'geometry the port lattice puts `' + g.lobeCount + '` grating lobes inside the horizon and the binding ' +
          'one is only `' + n(supp, 2) + ' dB` below the main beam, against the `' +
          n(budget.nullFloorDb, 1) + ' dB` coherence floor this whole comparison is judged on. On a ' +
          '**periodic** lattice the null-depth floor is therefore ' +
          'not what limits the array — the coherence argument becomes decisive only once the lattice is made ' +
          'aperiodic, and that ordering has to be stated before the floor is quoted. Making it aperiodic costs no ' +
          'gain but forces non-identical tiles and mandatory per-element calibration, which raises the requirement on ' +
          'this very distribution network. See the Beam view.');
      } else {
        t.push('- **The antenna lattice, and what ' + antName + ' has done to it.** The `' + g.lobeCount +
          '` grating lobes are still there — the antenna cannot move or remove them, because their positions come ' +
          'from the 1.5 cm PORT pitch and lobe-free scanning to `' + n(g.scanDegMax, 0) + '°` would need `' +
          n(g.lamCm * 10 / (1 + Math.sin(window.K.deg2rad(g.scanDegMax))), 2) + ' mm` of it. What this element does is ' +
          'SUPPRESS them: the binding one is now `' + n(supp, 1) + ' dB` down, so the null-depth floor of `' +
          n(budget.nullFloorDb, 1) + ' dB` genuinely is the binding metric again and the coherence argument stands ' +
          'on its own. That suppression is bought with scan range, and the nulls sit on the lobes only at ' +
          'broadside — see the antenna table for what it costs.');
      }
    }
    var a5 = res.lo['stabilised-link'], a6 = res.lo['inj-lock'];
    if (a5) {
      t.push('- **Whether the round-trip link\'s reciprocity beats what BIST achieves (A5).** A5 is A4\'s tree with ' +
        'a return path: the master mixes outgoing against returned, reads twice the one-way path phase and ' +
        'pre-corrects it at `' + n(g.linkLoopBwHz, 0) + ' Hz` — so line drift cancels itself instead of being ' +
        'tracked between BIST updates. On these numbers it does **not** win: `' + n(a5.interTileResidualDeg) +
        '°` against A4\'s `' + n(pick.r.interTileResidualDeg) + '°`, because the assumed reciprocity floor of `' +
        n(g.reciprocityErrDeg) + '°` is larger than the drift residual BIST already leaves. That single number is ' +
        'the whole decision, it is an *engineering guess*, and it is measurable on a two-tile bench long before ' +
        'anything is committed. If it comes in below `' + n(pick.r.driftResidDeg) + '°`, A5 wins and it wins ' +
        'without needing the OTA loop closed at all — which would also decouple the calibration burden from the ' +
        'beam-coherence argument.');
    }
    if (a6) {
      t.push('- **Whether the free-running spread of ' + g.nTilesTotal + ' tile oscillators can be trimmed (A6).** An ' +
        'injection-locked tile oscillator has no PFD, no charge pump and no divider, and its lock corner is `' +
        n(g.lockBwMHz, 0) + ' MHz` against the few a PLL can close — so it suppresses the line\'s additive noise ' +
        'over a far wider band than A4, at lower power (`' + n(a6.powerTotalMw / 1000, 2) + ' W` against `' +
        n(pick.r.powerTotalMw / 1000, 2) + ' W`). What sinks it here is the term with no analogue in A1–A4: a ' +
        'locked oscillator sits at `arcsin(Δf/f_lock)` from the injection, so `' + n(g.freeRunSpreadPct) +
        '%` of untrimmed spread becomes `' + n(a6.lockOffsetDeg) + '°` of deterministic inter-tile offset, and ' +
        'the part of it that moves with temperature is `' + n(a6.lockOffsetDriftDeg) + '°` that calibration ' +
        'cannot hold. Trim the tanks, or widen the lock range, and A6 becomes the cheapest option on the board.');
    }
    t.push('- **The coarse TTD step, which is set by the quantisation lobe and not by the squint loss.** The ' +
      'quantisation residual is deterministic, exactly zero at broadside, and common to a whole tile column when ' +
      'scanning in one plane, so it averages by the 1-D tile count and scatters into the scan plane as a discrete ' +
      'lobe. At `' + g.ttdStepPs + ' ps` that lobe is tens of dB above everything else in the error budget at the ' +
      'band edges, while the loss criterion says the step is nearly free. Specify the LSB against the lobe.');

    t.push('### Open questions to close before tape-out');
    t.push('1. Measure the correlated/uncorrelated split of the tile PLL in-band noise. This single number reorders the ranking.');
    t.push('2. Confirm that a per-tile LO phase can be observed at all. An intra-tile TX→RX loopback driven by the ' +
      'same LO cancels the LO phase identically, so LO calibration needs a cross-tile path, a shared tone bus, or a ' +
      'bidirectional tap on a real LO wire.');
    t.push('3. Specify the BIST to measure **group delay** across the baseband span, not phase at one frequency. ' +
      'A narrowband phase measurement resolves delay only modulo `' + n(1000 / (g.fLoGHz), 2) +
      ' ps` at ' + g.fLoGHz + ' GHz, and cannot distinguish a delay error from a phase error at all.');
    t.push('4. Decide the ×M lock ambiguity strategy. A ×' + Math.round(g.midM) + ' multiplier locks with a `' +
      n(360 / Math.round(g.midM), 0) + '°` ambiguity that is invisible at the distribution frequency and reappears at ' +
      'every power-up, forcing ' + nT + ' absolute anchors at boot.');
    t.push('5. Fix the baseband impedance regime per tier before choosing among B1/B2/B3 — matched-50 Ω versus ' +
      'voltage or current mode is worth more decibels than the topology choice, and the λ/10 test decides it.');

    return t.join('\n');
  }

  function build(res, budget) {
    var loRank = rankLo(res, budget);
    var bbRank = rankBb(res, budget);
    var loTied = tiedWithLeader(loRank);
    var bbTied = tiedWithLeader(bbRank);
    return {
      loRank: loRank, bbRank: bbRank,
      loPick: loRank[0], bbPick: bbRank[0],
      /* ids that the weights cannot separate from the leader, leader
         included; length 1 means the lead is real */
      loTied: loTied, bbTied: bbTied,
      loTieIds: loTied.map(function (o) { return o.id; }),
      bbTieIds: bbTied.map(function (o) { return o.id; }),
      tieEps: TIE_EPS,
      weights: WEIGHTS,
      text: prose(res, budget, loRank, bbRank, loTied, bbTied)
    };
  }

  window.Decision = { build: build, WEIGHTS: WEIGHTS, TIE_EPS: TIE_EPS };
})();
