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
  function prose(res, budget, loRank, bbRank) {
    var g = res.g;
    var pick = loRank[0], second = loRank[1];
    var bpick = bbRank[0], bsecond = bbRank[1];
    var a1 = res.lo['local-pll'], a2 = res.lo['hf-foldback'], a3 = res.lo['daisy-chain'], a4 = res.lo['mid-mult'];
    var nT = budget.nTiles;
    var t = [];

    t.push('### The decision');
    t.push('For the LO and reference distribution, take **' + pick.name + '**' +
      (pick.r.tileMultiplier > 1 ? ' at ×' + pick.r.tileMultiplier + ', distributing ' + n(pick.r.distFreqGHz) + ' GHz on the board' : '') +
      '. For the baseband split and combine, take **' + bpick.name + '**.');

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
    if (Math.round(g.latticePeriodic) === 1 && g.lobeCount > 0) {
      t.push('- **The antenna lattice, which decides whether any of this is the binding metric.** At the current ' +
        'geometry the element lattice puts `' + g.lobeCount + '` grating lobes inside the horizon and the binding ' +
        'one is only `' + n(-g.gratingSuppDb, 2) + ' dB` below the main beam, against the `' +
        n(budget.nullFloorDb, 1) + ' dB` coherence floor this whole comparison is judged on. On a ' +
        '**periodic** lattice the null-depth floor is therefore ' +
        'not what limits the array — the coherence argument becomes decisive only once the lattice is made ' +
        'aperiodic, and that ordering has to be stated before the floor is quoted. Making it aperiodic costs no ' +
        'gain but forces non-identical tiles and mandatory per-element calibration, which raises the requirement on ' +
        'this very distribution network. See the Beam view.');
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
    return {
      loRank: loRank, bbRank: bbRank,
      loPick: loRank[0], bbPick: bbRank[0],
      weights: WEIGHTS,
      text: prose(res, budget, loRank, bbRank)
    };
  }

  window.Decision = { build: build, WEIGHTS: WEIGHTS };
})();
