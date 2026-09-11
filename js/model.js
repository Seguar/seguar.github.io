/* ============================================================================
   model.js — global parameters, block library, reference-source menu, and the
   evaluation of all seven distribution options.

   The central asymmetry this model exists to expose:

     Uncorrelated per-tile phase noise AVERAGES DOWN by 10log10(N) at the
     coherent beam output (so it helps link EVM) but shows up in FULL in the
     inter-tile differential (so it costs beam coherence: sidelobe floor and
     null depth). Correlated noise from a shared source does the opposite.

   So per-tile PLLs and a shared LO are not "better and worse" — they trade
   link EVM against beam coherence, and the tool prices both.

   Exposes window.Model.
   ========================================================================= */
(function () {
  'use strict';

  var K = window.K;

  /* ===================================================================== *
   * Reference-clock menu. Stamped into the editable PN fields on change,
   * so a real datasheet can always be typed over the preset.
   * =================================================================== */
  var REF_SOURCES = [
    { key: 'ocxo100', name: '100 MHz OCXO (low noise)', freqMHz: 100, pn1k: -140, pn10k: -155, pn100k: -165, floor: -170, powerMw: 1500,
      cost: 'high', conf: 'published-literature',
      note: 'Wenzel/CTS-class oven-controlled 100 MHz. The best practical board reference; the oven dominates its power.' },
    { key: 'xo100', name: '100 MHz XO (low cost)', freqMHz: 100, pn1k: -110, pn10k: -135, pn100k: -150, floor: -155, powerMw: 60,
      cost: 'low', conf: 'published-literature',
      note: 'Ordinary commercial 100 MHz crystal oscillator. Included to show what the reference choice actually costs.' },
    { key: 'clk104', name: 'RFSoC CLK104 / LMK0482x output', freqMHz: 100, pn1k: -125, pn10k: -145, pn100k: -155, floor: -160, powerMw: 400,
      cost: 'already in the lab', conf: 'published-literature',
      note: 'What the existing ZCU216 + CLK104 setup already provides. The pragmatic default for the prototype.' },
    { key: 'ocxo10', name: '10 MHz OCXO', freqMHz: 10, pn1k: -145, pn10k: -160, pn100k: -165, floor: -168, powerMw: 1200,
      cost: 'high', conf: 'published-literature',
      note: 'Excellent absolute noise, but reaching 78 GHz needs N = 7800, i.e. 77.8 dB of multiplication. Included to show why a low reference frequency is the wrong lever.' },
    { key: 'lmx1g', name: '1 GHz low-noise clock (LMX259x-class)', freqMHz: 1000, pn1k: -110, pn10k: -125, pn100k: -140, floor: -157, powerMw: 500,
      cost: 'medium', conf: 'published-literature',
      note: 'A high reference frequency minimises N and therefore the in-band floor, at the cost of worse close-in noise.' }
  ];

  /* ===================================================================== *
   * Block library — power / area / gain / additive noise.
   * Values are engineering estimates anchored to published mmWave IC work
   * unless labelled otherwise; every one is exposed in the ledger.
   * =================================================================== */
  var BLOCKS = {
    refSource:      { name: 'Board reference oscillator', tech: 'module', freqGHz: 0.1, powerMw: 400, gainDb: 0, areaMm2: 0, addPnFloorDbc: -170, addPnCornerHz: 0, conf: 'published-literature', why: 'Set by the selected reference-clock preset.' },
    clkFanout:      { name: 'Clock fanout buffer', tech: 'LMK-class / on-chip CML', freqGHz: 0.1, powerMw: 30, gainDb: 0, areaMm2: 0.02, addPnFloorDbc: -160, addPnCornerHz: 1e4, conf: 'published-literature', why: 'Per-output power of a low-noise CML/LVDS clock fanout at 100 MHz.' },
    refRepeater:    { name: 'Reference line repeater', tech: '65nm CMOS', freqGHz: 0.1, powerMw: 20, gainDb: 10, areaMm2: 0.01, addPnFloorDbc: -160, addPnCornerHz: 1e4, conf: 'scaled-estimate', why: 'Rarely needed: a 30 cm board is electrically short at 100 MHz.' },

    tilePll:        { name: 'Per-tile PLL at f_LO/M', tech: '65nm LP CMOS', freqGHz: 19.5, powerMw: 42, gainDb: 0, areaMm2: 0.35, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'published-literature', why: 'Integer-N ~20 GHz PLL in 65nm: VCO + dividers + PFD/CP + output buffer. Two independent block libraries gave 32 and 52 mW; 42 is the midpoint and both agree this block is comfortable.' },
    tileMult:       { name: 'Per-tile ×M multiplier chain', tech: 'SiGe BiCMOS', freqGHz: 78, powerMw: 86, gainDb: 13, areaMm2: 0.23, addPnFloorDbc: -152, addPnCornerHz: 2e5, conf: 'scaled-estimate', why: 'Two cascaded doublers 19.5→78 GHz, no filter needed. Power reconciled from 80 and 92 mW. NOTE: the two libraries disagreed by 12 dB on additive phase noise (−146 vs −158 dBc/Hz); −152 is the midpoint and this is the number A4’s floor rests on — measure it.' },
    loChipletSige:  { name: 'SiGe LO last-mile chiplet', tech: 'SiGe BiCMOS (3rd die)', freqGHz: 78, powerMw: 165, gainDb: 20, areaMm2: 1.0, addPnFloorDbc: -155, addPnCornerHz: 3e5, conf: 'scaled-estimate', why: 'REQUIRED BY EVERY OPTION. A 78 GHz gain stage is not realisable in TSMC 65nm LP (fmax/f ≈ 1.9): a 4-stage CMOS chain reaches ≈0 dBm Psat but must source +5.6 dBm into four RFIC taps. So the LO last mile leaves the 65nm tile and becomes a third die — the proposal’s two-chip partition is really three.' },
    loBuf78:        { name: '78 GHz LO tap buffer', tech: 'SiGe BiCMOS', freqGHz: 78, powerMw: 24, gainDb: 9, areaMm2: 0.07, addPnFloorDbc: -158, addPnCornerHz: 2e5, conf: 'published-literature', why: 'Per-tap E-band driver into the existing RFIC LO port. Reconciled from 18 and 30 mW; ~2.0 mW per dB of gain in SiGe against 7.4 in 65nm LP.' },

    loSource78:     { name: 'Central 78 GHz source', tech: 'SiGe BiCMOS', freqGHz: 78, powerMw: 218, gainDb: 0, areaMm2: 0.95, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'published-literature', why: 'E-band integer-N PLL that both makes 78 GHz cleanly and can drive +2 dBm. Reconciled from 187 and 250 mW.' },

    /* --- A5 round-trip stabilised link --- */
    rtnCoupler:     { name: 'Return directional coupler', tech: 'PCB / package', freqGHz: 19.5, powerMw: 0, gainDb: -0.4, areaMm2: 1.8, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'measured/datasheet', why: 'A5 only. A 15–20 dB coupled-line coupler at the mid frequency, sending the arriving tone back down the same line. Passive, so no power; the area is board area, not die area, and its DIRECTIVITY is what bounds the correction — see the couplerDirDb parameter.' },
    rtnPhaseDet:    { name: 'Round-trip phase detector + servo', tech: '65nm LP CMOS', freqGHz: 19.5, powerMw: 45, gainDb: 0, areaMm2: 0.18, addPnFloorDbc: -150, addPnCornerHz: 1e5, conf: 'scaled-estimate', why: 'A5 only. A mixer comparing outgoing against returned, plus the integrator and the correction phase shifter. Scaled from published line-length correctors and from mid-band mixer/PLL blocks; the mid frequency is well inside what 65nm LP can do, unlike the 78 GHz last mile. Its own additive noise is inside the servo loop and so is corrected below the loop bandwidth.' },

    /* --- A6 injection-locked tile oscillator --- */
    tileIlo:        { name: 'Injection-locked tile oscillator', tech: 'SiGe BiCMOS', freqGHz: 78, powerMw: 62, gainDb: 0, areaMm2: 0.21, addPnFloorDbc: -158, addPnCornerHz: 2e5, conf: 'scaled-estimate', why: 'A6 only. An LC oscillator at 78 GHz locked by harmonic injection of the 19.5 GHz sub-harmonic. Cheaper than the ×M chain it replaces (86 mW) because there is no cascade of doublers and no interstage filtering — but it needs a clean tank and enough injection to hold the lock range. Scaled from 60/77/94 GHz ILFM results; not a datasheet number.' },

    /* --- B5 digitise at the tile ---
       Power is computed from the converter FOM parameters rather than
       frozen here, because the whole argument about this option turns on
       those numbers; these entries carry only the fixed overheads. */
    tileAdc:        { name: 'Tile ADC, per rail', tech: '65nm LP CMOS', freqGHz: 1, powerMw: 0, gainDb: 0, areaMm2: 0.9, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'scaled-estimate', why: 'B5 only. Power is NOT taken from here — it is computed as FOM · 2^bits · fs from the adcFomFjConv, adcBits and adcGspsPerRail parameters, so the reader can move the assumption that decides the option. The area is the fixed cost: ~0.9 mm² for a 2–3 GS/s pipelined or time-interleaved SAR in a mature node, which is most of a tile die.' },
    tileDac:        { name: 'Tile DAC, per rail', tech: '65nm LP CMOS', freqGHz: 1, powerMw: 0, gainDb: 0, areaMm2: 0.6, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'scaled-estimate', why: 'B5 only, TX direction. Same treatment as the ADC: power from the FOM parameters, area fixed here.' },
    tileSerdes:     { name: 'SerDes lane to the backend', tech: '65nm LP CMOS', freqGHz: 25, powerMw: 0, gainDb: 0, areaMm2: 0.35, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'published-literature', why: 'B5 only. Power computed from serdesMwPerGbps × the lane rate the converters demand. A 25 Gb/s JESD204C/GTY-class lane is routine in a mature node but is a serious addition to a tile that today carries only analog IQ.' },
    tiaSum:         { name: 'Virtual-ground summing TIA', tech: '65nm LP CMOS', freqGHz: 1, powerMw: 28, gainDb: 0, areaMm2: 0.035, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'scaled-estimate', why: 'B4 only. ONE transimpedance amplifier per rail per tile holding the summing node at a virtual ground, replacing the N−1 cell cascade of B3. Higher power than a single H-tree cell (18 mW) because it must hold a low impedance against the whole summing-node capacitance, but there is one of it instead of fifteen.' },
    loSplit78:      { name: 'E-band 1:2 splitter', tech: 'RO3003 GCPW, on board', freqGHz: 78, powerMw: 0, gainDb: -3.5, areaMm2: 0.96, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'published-literature', why: 'A PCB Wilkinson at 78 GHz is 0.8 dB better than on-chip, but every junction adds a mechanical discontinuity and an unrepeatable phase offset.' },
    loAmp78:        { name: 'E-band repeater amplifier', tech: 'SiGe BiCMOS', freqGHz: 78, powerMw: 45, gainDb: 12, areaMm2: 0.08, addPnFloorDbc: -152, addPnCornerHz: 2e5, conf: 'published-literature', why: 'Gain stage needed every few centimetres of E-band line. Each one is a separate SiGe die on the board — it cannot live in the 65nm tile.' },
    ebandTransition:{ name: 'E-band board/package transition', tech: 'packaging', freqGHz: 78, powerMw: 0, gainDb: -0.9, areaMm2: 0, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'engineering-guess', why: 'Each E-band transition costs loss and, worse, an unrepeatable phase offset.' },

    loSourceChain:  { name: 'Chain source', tech: 'SiGe BiCMOS', freqGHz: 39, powerMw: 220, gainDb: 0, areaMm2: 0.7, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'scaled-estimate', why: 'PLL at the chain frequency.' },
    chainBuf:       { name: 'Daisy-chain hop buffer', tech: 'SiGe BiCMOS', freqGHz: 39, powerMw: 40, gainDb: 10, areaMm2: 0.07, addPnFloorDbc: -155, addPnCornerHz: 4e4, conf: 'scaled-estimate', why: 'Re-amplifies the chain at every tile. Also the single point of failure.' },
    chainTap:       { name: 'Directional tap', tech: 'on-board / in-package', freqGHz: 39, powerMw: 0, gainDb: -1.2, areaMm2: 0, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'scaled-estimate', why: 'Couples a fraction off the through line at each tile.' },
    chainTerm:      { name: 'Chain termination', tech: 'passive', freqGHz: 39, powerMw: 0, gainDb: 0, areaMm2: 0, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'scaled-estimate', why: 'Without it the chain end reflects back along every hop.' },

    loSourceMid:    { name: 'Mid-frequency source', tech: 'SiGe or 65nm CMOS', freqGHz: 19.5, powerMw: 180, gainDb: 0, areaMm2: 0.55, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'scaled-estimate', why: 'PLL at f_LO/M; far easier than a 78 GHz PLL.' },
    loSplitMid:     { name: 'Mid-frequency 1:2 splitter', tech: 'on-board', freqGHz: 19.5, powerMw: 0, gainDb: -3.3, areaMm2: 0, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'scaled-estimate', why: 'Ideal 3 dB plus ~0.3 dB excess — a benign passive at this frequency.' },
    loAmpMid:       { name: 'Mid-frequency amplifier', tech: '65nm CMOS or SiGe', freqGHz: 19.5, powerMw: 25, gainDb: 14, areaMm2: 0.05, addPnFloorDbc: -158, addPnCornerHz: 3e4, conf: 'published-literature', why: 'Cheap and well-characterised at 20–40 GHz in both technologies.' },
    midTransition:  { name: 'Mid-frequency transition', tech: 'packaging', freqGHz: 19.5, powerMw: 0, gainDb: -0.25, areaMm2: 0, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'scaled-estimate', why: 'A 20 GHz transition is routine; an E-band one is not.' },

    bbActiveCell:   { name: 'Baseband active combine cell', tech: '65nm LP CMOS', freqGHz: 1, powerMw: 1.5, gainDb: 0, areaMm2: 0.004, nfDb: 12, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'scaled-estimate', why: 'Current-summing cell for a DC–1 GHz rail. Both libraries independently gave ≈1.5 mW — far cheaper than a per-cell guess suggests, because power follows total load capacitance, not cell count.' },
    bbVectorMod:    { name: 'IQ vector modulator + VGA', tech: '65nm LP CMOS', freqGHz: 1, powerMw: 6, gainDb: 0, areaMm2: 0.03, nfDb: 14, conf: 'scaled-estimate', why: 'Per-channel baseband phase/amplitude weight — the beamforming control point, and where a static LO phase offset is corrected. 32 per tile per rail dominates the tile power.' },
    bbResistor:     { name: 'Resistive network arm', tech: '65nm poly resistor', freqGHz: 1, powerMw: 0, gainDb: 0, areaMm2: 0.0008, conf: 'scaled-estimate', why: 'Essentially free in area and perfectly stable — the passive network’s main virtue.' },
    bbRootAmp:      { name: 'Baseband root amplifier', tech: '65nm LP CMOS', freqGHz: 1, powerMw: 25, gainDb: 18, areaMm2: 0.02, nfDb: 10, conf: 'scaled-estimate', why: 'Recovers the passive network loss and drives the RFSoC ADC input.' },
    bbTap:          { name: 'Baseband bus tap', tech: '65nm LP CMOS', freqGHz: 1, powerMw: 2, gainDb: -0.4, areaMm2: 0.002, conf: 'scaled-estimate', why: 'Its input capacitance is what collapses the daisy chain’s bandwidth as N grows.' },
    bbTxDriver:     { name: 'Baseband TX-direction driver', tech: '65nm LP CMOS', freqGHz: 1, powerMw: 60, gainDb: 12, areaMm2: 0.03, conf: 'scaled-estimate', why: 'One driver fighting the whole tree plus N pad capacitances. The passive network’s hidden cost.' },
    bbDecap:        { name: 'Supply decoupling', tech: '65nm MOM/MOS cap', freqGHz: 0, powerMw: 0, gainDb: 0, areaMm2: 0.27, conf: 'scaled-estimate', why: 'Sized for the active cells’ current ripple. Usually the real area cost, not the cells.' }
  };

  /* ===================================================================== *
   * Global parameters
   * =================================================================== */
  var PARAMS = [
    /* --- array & band --- */
    { key: 'fLoGHz', label: 'LO frequency', units: 'GHz', value: 78, min: 60, max: 95, step: 0.5, group: 'Array & band',
      conf: 'measured/datasheet', why: 'RFIC characterised with a 78 GHz LO; the band is 71–86 GHz. The proposal’s own modelling text uses 75 GHz.' },
    { key: 'rfBwGHz', label: 'RF bandwidth', units: 'GHz', value: 2, min: 0.1, max: 5, step: 0.1, group: 'Array & band',
      conf: 'measured/datasheet', why: '≈2 GHz class per the RFIC front-end table.' },
    { key: 'apertureCm', label: 'Aperture width', units: 'cm', value: 30, min: 6, max: 60, step: 1, group: 'Array & band',
      conf: 'measured/datasheet', why: '30 × 30 cm array class from the proposal. This is D in the beamwidth 0.886·λ/D, and it is a hard system spec — the tile pitch is the design choice that has to fit inside it.' },
    { key: 'tileCm', label: 'Tile pitch', units: 'cm', value: 4, min: 0.25, max: 15, step: 0.25, group: 'Array & band',
      conf: 'published-literature', why: 'Centre-to-centre tile spacing; with abutting square tiles it equals the tile edge. "Pitch" rather than "side" or "size" because a spacing is what the grid is built from, and "size" for a 2-D module reads as an area. Sub-tiling to 5–10 cm keeps residual intra-tile delay under ~200 ps; 4 cm gives 116 ps with margin, at the cost of more tiles. Note 4 cm does not divide 30 cm — see the derived readout.' },
    { key: 'nDies', label: 'RFIC dies in the array', units: '-', value: 100, min: 4, max: 4000, step: 1, group: 'Array & band',
      conf: 'measured/datasheet', why: '≈100 existing 2.5 × 2.5 mm E-band dies. Tile pitch, taps per tile and this total are independent inputs that can disagree, so the tool checks them against each other rather than letting the mismatch pass silently.' },
    { key: 'tapsPerTile', label: 'LO taps per tile', units: '-', value: 2, min: 1, max: 32, step: 1, group: 'Array & band',
      conf: 'scaled-estimate', why: 'One LO tap per RFIC die. At a 4 cm pitch 7×7 = 49 tiles fit, and the 100-die inventory allows floor(100/49) = 2 dies per tile: 98 placed, 2 spare, costing 10log10(98/100) = −0.09 dB of array gain. Two dies lay out as a 1×2 pair on one matched 1:2 split. At a 6 cm pitch it was 25 × 4 = 100 exactly.' },
    { key: 'chPerTile', label: 'BB channels per tile', units: '-', value: 16, min: 2, max: 64, step: 1, group: 'Array & band',
      conf: 'measured/datasheet', why: 'Each die exposes 4 RX + 4 TX IQ ports, so channels per tile per rail = 8 × dies per tile. At 2 dies per tile that is 16, and 49 × 16 = 784 per rail.' },
    { key: 'scanDegMax', label: 'Max scan angle', units: 'deg', value: 60, min: 0, max: 75, step: 5, group: 'Array & band',
      conf: 'published-literature', why: 'The proposal evaluates squint at 60°, where it exceeds the beamwidth.' },
    { key: 'elemDirDbi', label: 'Element directivity', units: 'dBi', value: 6, min: 0, max: 12, step: 0.5, group: 'Array & band',
      conf: 'published-literature', why: 'A single E-band package radiator. 6 dBi is patch-like (roughly cos^2 in power, so a ±60° usable cone); a broader element scans further but gives less realised gain. This sets the realised array gain, since a sparse array gets N × element directivity rather than the filled-aperture 4πA/λ².' },
    { key: 'latticePeriodic', label: 'Element lattice', units: '', value: 1, group: 'Array & band',
      choices: [{ value: 1, label: 'Periodic — grating lobes' }, { value: 0, label: 'Aperiodic / thinned' }],
      conf: 'engineering-guess', why: 'A periodic lattice coarser than λ/2 has discrete grating lobes; deliberately breaking the periodicity trades them for a raised, roughly uniform sidelobe floor near 1/N. Which one applies is a layout decision that has not been made yet, and the two look completely different on the pattern.' },
    { key: 'inTileLattice', label: 'In-tile lattice', units: '', value: 0, group: 'Array & band',
      choices: [{ value: 0, label: 'Rectangular (as drawn)' }, { value: 1, label: 'Best sublattice' }, { value: 2, label: 'Single row' }],
      conf: 'engineering-guess', why: '"8 elements per tile" does not force 4×2. Every sublattice of index 8 that contains the tile lattice keeps all tiles identical, and their worst grating lobe runs from 5.5° (8×1) through 11.08° (4×2 — the worst of the sensible options) to 15.77° for the sheared lattice a1=(1,−1), a2=(0,2) cm, which also raises minimum element separation from 1.00 to 1.41 cm. Same channels, same dies, same tile. The lobe count does not change: that is fixed by density alone.' },
    { key: 'elemModelSel', label: 'Element pattern model', units: '', value: 0, group: 'Array & band',
      choices: [{ value: 0, label: 'Directivity-matched cos^n' }, { value: 1, label: 'HPBW-matched patch' }, { value: 2, label: 'Cell-filling nulled' }],
      conf: 'engineering-guess', why: 'One cos^n curve cannot be both a 6 dBi directivity-matched element (n = 0.99, 120° HPBW, only 3 dB of scan loss at 60°) and a real package patch (65–80° HPBW, n ≈ 3.5, 10 dB at 60°). Using the broad one for grating-lobe suppression AND for scan loss is pessimistic about the lobe and optimistic about the scan with the same curve, which is not a defensible pair. The third option is a cell-filling radiator whose nulls land exactly on the grating lobes.' },
    { key: 'elemHpbwDeg', label: 'Element HPBW', units: 'deg', value: 70, min: 30, max: 170, step: 5, group: 'Array & band',
      conf: 'published-literature', why: 'Measured E-band package patches run 65–80° (E-plane typically narrower than H-plane). Only used by the HPBW-matched element model, where the directivity stays at the parameter value because a real patch has back radiation and E/H asymmetry, so D < 2(n+1).' },
    { key: 'antLossDb', label: 'Antenna-side loss chain', units: 'dB', value: 4, min: 0, max: 12, step: 0.5, group: 'Array & band',
      conf: 'engineering-guess', why: 'Directivity is not gain. Element radiation efficiency 0.4–0.7, package feed routing 0.8–7 (0.15–0.35 dB/mm over 5–20 mm, and unequal by 1–3 dB between near and far elements of a tile), flip-chip transition 0.3–0.8, mismatch at |S11| = −10…−12 dB 0.3–0.5, T/R switch 0–2.5, on-chip pad/balun/ESD 0.5–1.5, radome 0.3–1. 4 dB is a mid estimate; on RX it sits in front of the LNA and goes straight into G/T.' },
    { key: 'beamScanDeg', label: 'Beam steer angle', units: 'deg', value: 30, min: -75, max: 75, step: 1, group: 'Array & band',
      conf: 'scaled-estimate', why: 'Direction the Beam view steers to. Separate from the max scan angle, which sizes the TTD range and the worst-case squint.' },
    { key: 'txGainErrDb', label: 'TX amplitude spread', units: 'dB', value: 0.5, min: 0, max: 3, step: 0.05, group: 'Link & budget',
      conf: 'engineering-guess', why: 'PA-to-PA gain variation, RMS. This and its RX counterpart are the only things that make the TX and RX patterns differ in this model — the LO residual is common to both directions.' },
    { key: 'rxGainErrDb', label: 'RX amplitude spread', units: 'dB', value: 0.3, min: 0, max: 3, step: 0.05, group: 'Link & budget',
      conf: 'engineering-guess', why: 'LNA and baseband VGA gain variation, RMS. Lower than TX because no device is running near compression.' },
    /* --- A5 round-trip stabilised link --- */
    { key: 'linkLoopBwHz', label: 'Stabiliser loop bandwidth', units: 'Hz', value: 1000, min: 1, max: 100000, step: 10, group: 'Distribution options',
      conf: 'published-literature', why: 'A5 only. The round-trip corrector is a continuous servo, not a sampled calibration: the ALMA line-length correctors and the DESY/XFEL RF reference links close kHz-class loops. Anything slower than the thermal drift spectrum is what matters, and drift lives below 1 Hz, so a kHz loop tracks it completely. This is why A5 is not simply "A4 with a faster BIST" — the correction is inside the distribution network, not around the array.' },
    { key: 'reciprocityErrDeg', label: 'Round-trip reciprocity error', units: 'deg', value: 0.5, min: 0, max: 10, step: 0.1, group: 'Distribution options',
      conf: 'engineering-guess', why: 'A5 only, and the number that decides whether A5 is worth its hardware. Round-trip cancellation is exact only for a RECIPROCAL path; what survives is the forward/reverse asymmetry of the couplers, the amplifiers (which are not reciprocal at all and must be bypassed or duplicated) and the connectors. 0.5° at 78 GHz is 18 fs — aggressive but in line with what phase-stabilised links achieve at lower frequency. It is a guess and it is the first thing to measure.' },
    { key: 'couplerDirDb', label: 'Return coupler directivity', units: 'dB', value: 20, min: 6, max: 40, step: 1, group: 'Distribution options',
      conf: 'measured/datasheet', why: 'A5 only, and AT THE DEFAULT IT IS THE BINDING TERM, not the reciprocity floor — tighten the reciprocity to 0.05° and A5 still sits near 1.0° because of this. Finite directivity leaks the outgoing tone into the return path, where it adds vectorially to the reflected tone and biases the measured phase: the static bound is arcsin(10^(-D/20)), 5.7° at 20 dB. The model carries 10% of that as a drifting residual, on the argument that the servo works differentially against a stored reference so most of the leakage is a fixed offset that calibrates out — that 10% is an engineering guess and it is what decides whether A5 is worth building. A 30 dB coupler moves it by a factor of three.' },

    /* --- A6 injection-locked tile oscillator --- */
    { key: 'lockBwMHz', label: 'Injection lock bandwidth', units: 'MHz', value: 200, min: 1, max: 2000, step: 10, group: 'Distribution options',
      conf: 'published-literature', why: 'A6 only. The corner at which the tile oscillator stops following the injected reference and reverts to its own free-running noise. Injection locking reaches hundreds of MHz where a PLL closes a few — that width is the whole point, since it suppresses the distribution path\'s additive noise over a far wider band than A4 can.' },
    { key: 'lockRangePct', label: 'Injection lock range', units: '% of f', value: 2, min: 0.1, max: 20, step: 0.1, group: 'Distribution options',
      conf: 'published-literature', why: 'A6 only. Half-width of the locking range as a fraction of the oscillator frequency, set by the injection ratio (Adler). Must exceed the free-running spread or some tiles simply will not lock.' },
    { key: 'freeRunSpreadPct', label: 'Free-running spread, tile to tile', units: '% of f', value: 0.5, min: 0, max: 10, step: 0.1, group: 'Distribution options',
      conf: 'engineering-guess', why: 'A6 only, and its Achilles heel. A locked oscillator sits at a static phase offset arcsin(Δf/f_lock) from the injection, so process spread in the free-running frequency of 49 oscillators becomes a DETERMINISTIC inter-tile phase error — calibratable once, but it drifts with temperature, and that part is not. 0.5% is a plausible untrimmed LC spread and is a guess.' },

    /* --- B5 digitise at the tile --- */
    { key: 'adcGspsPerRail', label: 'Converter rate per rail', units: 'GS/s', value: 2.5, min: 0.5, max: 10, step: 0.1, group: 'Distribution options',
      conf: 'scaled-estimate', why: 'B5 only. Nyquist for a 1 GHz rail with a realisable anti-alias transition band. Sets both the converter power and the serial lane count.' },
    { key: 'adcBits', label: 'Converter resolution', units: 'bits', value: 10, min: 6, max: 16, step: 1, group: 'Distribution options',
      conf: 'scaled-estimate', why: 'B5 only. Effective bits after the tile\'s own analog combining, which has already provided array gain. Power scales as 2^bits in the Walden regime, so this is the second lever after sample rate.' },
    { key: 'adcFomFjConv', label: 'Converter figure of merit', units: 'fJ/conv-step', value: 100, min: 5, max: 1000, step: 5, group: 'Distribution options',
      conf: 'published-literature', why: 'B5 only. Walden FOM: P = FOM · 2^ENOB · fs. 100 fJ/conv-step is mid-range for a 2-3 GS/s converter in a mature node — Murmann\'s ADC survey has the state of the art an order of magnitude better in advanced nodes and worse in 65 nm LP, which is exactly the objection to putting converters in this tile.' },
    { key: 'serdesMwPerGbps', label: 'SerDes efficiency', units: 'mW/Gb/s', value: 4, min: 0.5, max: 20, step: 0.5, group: 'Distribution options',
      conf: 'published-literature', why: 'B5 only. Energy per bit on the serial link to the backend, including the SerDes and its share of the channel. 4 mW/Gb/s (4 pJ/bit) is typical for a mid-node 25 Gb/s JESD204C/GTY-class lane over a backplane.' },

    { key: 'iqPhaseDeg', label: 'Residual IQ phase error', units: 'deg', value: 3, min: 0, max: 15, step: 0.5, group: 'Link & budget',
      conf: 'engineering-guess', why: 'Baseband IQ vector-modulator gain/quadrature imbalance left after calibration, per channel, RMS. An earlier version set the per-element phase error to the phase-shifter quantisation alone, which is 1.62° at 6 bits — real per-element phase error is 2–4° on top of that. It is also what produces the image beam.' },
    { key: 'imageRejDb', label: 'Image rejection', units: 'dBc', value: 30, min: 10, max: 50, step: 1, group: 'Link & budget',
      conf: 'published-literature', why: 'Baseband-steered arrays put the residual conjugate-phase component into a MIRROR beam at −θ₀, at the image-rejection level. −25 to −35 dBc after calibration is typical and routinely measured. A phase-only error model can never produce this spur, which is why it is carried as its own number.' },
    { key: 'sigDieDeg', label: 'Per-die LO residual', units: 'deg', value: 1, min: 0, max: 20, step: 0.25, group: 'Link & budget',
      conf: 'engineering-guess', why: 'The error hierarchy has three levels, not two: a tile holds 2 dies and a die feeds 4 channels, so there is a die-common term between the tile-common LO residual and the per-element terms. Per-element baseband calibration absorbs the static part, so what is left is die-common drift between calibrations. Scatter from this level averages by the die count (98) and carries the shape of the 4-channel factor.' },

    /* --- reference clock --- */
    { key: 'refSel', label: 'Reference clock', units: '', value: 2, group: 'Reference clock',
      choices: REF_SOURCES.map(function (r, i) { return { value: i, label: r.name }; }),
      conf: 'published-literature', why: 'Selecting a preset stamps its datasheet phase noise into the four fields below, which stay editable.' },
    { key: 'fRefMHz', label: 'Reference frequency', units: 'MHz', value: 100, min: 1, max: 4000, step: 1, group: 'Reference clock',
      conf: 'published-literature', why: 'Also the PFD comparison frequency unless an R-divider is used. Higher is better for the in-band floor: −10log10(f_pfd).' },
    { key: 'ref1k', label: 'Ref L(1 kHz)', units: 'dBc/Hz', value: -125, min: -180, max: -60, step: 1, group: 'Reference clock', conf: 'published-literature', why: 'Datasheet point of the selected reference.' },
    { key: 'ref10k', label: 'Ref L(10 kHz)', units: 'dBc/Hz', value: -145, min: -180, max: -60, step: 1, group: 'Reference clock', conf: 'published-literature', why: 'Datasheet point of the selected reference.' },
    { key: 'ref100k', label: 'Ref L(100 kHz)', units: 'dBc/Hz', value: -155, min: -180, max: -60, step: 1, group: 'Reference clock', conf: 'published-literature', why: 'Datasheet point of the selected reference.' },
    { key: 'refFloor', label: 'Ref far-out floor', units: 'dBc/Hz', value: -160, min: -185, max: -100, step: 1, group: 'Reference clock', conf: 'published-literature', why: 'Broadband noise floor of the selected reference.' },

    /* --- LO architecture --- */
    { key: 'loOption', label: 'LO connection type', units: '', value: 3, group: 'LO architecture',
      choices: [
        { value: 0, label: 'A1 · Local PLL + reference' },
        { value: 1, label: 'A2 · High-frequency / foldback' },
        { value: 2, label: 'A3 · Daisy chain' },
        { value: 3, label: 'A4 · Mid-frequency + ×M' },
        { value: 4, label: 'A5 · Round-trip stabilised link' },
        { value: 5, label: 'A6 · Injection-locked tile oscillator' }
      ], conf: 'measured/datasheet', why: 'A1–A4 are the candidates from the proposal. A5 and A6 were added after a survey of the wider design space: A5 is the only architecture with a return path INSIDE the distribution network, so it attacks the drift term rather than tracking it, and A6 is the only one whose tile carries no PFD, charge pump or divider at all. This selects what the map draws.' },
    { key: 'midM', label: 'Multiplier M (A4)', units: '×', value: 4, group: 'LO architecture',
      choices: [{ value: 2, label: '×2 → 39 GHz' }, { value: 3, label: '×3 → 26 GHz' }, { value: 4, label: '×4 → 19.5 GHz' },
                { value: 6, label: '×6 → 13 GHz' }, { value: 8, label: '×8 → 9.75 GHz' }],
      conf: 'scaled-estimate', why: 'Distribution frequency is f_LO/M. M sets the 20log10(M) phase-noise penalty and the line loss.' },
    { key: 'chainFreqGHz', label: 'Chain frequency (A3)', units: 'GHz', value: 39, min: 5, max: 90, step: 1, group: 'LO architecture',
      conf: 'scaled-estimate', why: 'Frequency carried along the daisy chain. Below f_LO it needs a per-tile multiplier.' },
    { key: 'chainBranches', label: 'Chain branches (A3)', units: '-', value: 5, min: 1, max: 10, step: 1, group: 'LO architecture',
      conf: 'scaled-estimate', why: 'Splitting the serpentine into parallel chains bounds both accumulated skew and the blast radius of a dead buffer.' },
    { key: 'pllMult', label: 'Post-PLL ×M (A1)', units: '×', value: 4, group: 'LO architecture',
      choices: [{ value: 1, label: '×1 — PLL runs at 78 GHz' }, { value: 2, label: '×2' }, { value: 4, label: '×4' }, { value: 6, label: '×6' }],
      conf: 'scaled-estimate', why: 'A per-tile PLL at 78/M plus a multiplier is far more practical in 65nm than a 78 GHz PLL.' },
    { key: 'pllLoopBwMHz', label: 'PLL loop bandwidth', units: 'MHz', value: 1, min: 0.01, max: 20, step: 0.01, group: 'LO architecture',
      conf: 'scaled-estimate', why: 'Below it the tile tracks the shared reference (correlated); above it the local VCO runs free (uncorrelated). The single most important A1 parameter.' },
    { key: 'pllZeta', label: 'Loop damping ζ', units: '-', value: 0.8, min: 0.3, max: 2, step: 0.05, group: 'LO architecture',
      conf: 'scaled-estimate', why: 'Type-II 2nd-order damping. Sets the jitter peaking near the loop bandwidth.' },
    { key: 'fomPll', label: 'PLL in-band FOM', units: 'dBc/Hz', value: -231, min: -238, max: -205, step: 1, group: 'LO architecture',
      conf: 'published-literature', why: 'Normalised in-band floor. −231 is the documented LMX2594-class figure; −227 a good integer-N CMOS PLL; −220 a typical mmWave fractional-N.' },
    { key: 'pllFlickNorm', label: 'PLL 1/f norm', units: 'dBc/Hz', value: -120, min: -140, max: -95, step: 1, group: 'LO architecture',
      conf: 'scaled-estimate', why: 'In-band flicker normalised to 1 Hz offset at a 1 GHz carrier.' },
    { key: 'fomVco', label: 'VCO FOM', units: 'dBc/Hz', value: -183, min: -195, max: -160, step: 1, group: 'LO architecture',
      conf: 'published-literature', why: 'Good mmWave LC VCO. Oscillating directly at 78 GHz typically costs 8–12 dB of FOM.' },
    { key: 'vcoPowerMw', label: 'VCO power', units: 'mW', value: 12, min: 1, max: 100, step: 1, group: 'LO architecture',
      conf: 'scaled-estimate', why: 'Enters the VCO FOM expression as −10log10(P/1mW).' },
    { key: 'vcoCornerHz', label: 'VCO 1/f³ corner', units: 'Hz', value: 3e5, min: 1e3, max: 1e7, step: 1e3, group: 'LO architecture',
      conf: 'scaled-estimate', why: 'Below this the VCO noise steepens from 1/f² to 1/f³.' },
    { key: 'uncorrInbandFrac', label: 'PFD/CP noise uncorrelated share', units: '-', value: 1, min: 0, max: 1, step: 0.05, group: 'LO architecture',
      conf: 'engineering-guess', why: 'How much of the per-tile PFD/charge-pump/divider and flicker noise is genuinely independent between tiles. Physically it is close to 1: only shared bias or a shared reference buffer makes any of it common. The reference-derived term is handled separately and is always common. Lowering this is the optimistic case for A1 — it must be measured, not assumed.' },

    /* --- interconnect & packaging --- */
    { key: 'loMedium', label: 'LO line medium', units: '', value: 0, group: 'Interconnect & packaging',
      choices: [{ value: 0, label: 'RO3003 GCPW' }, { value: 1, label: 'RO3003 microstrip' }, { value: 2, label: 'SIW on RO3003' },
                { value: 3, label: 'WR-12 waveguide' }, { value: 4, label: 'RO4350B microstrip' }],
      conf: 'published-literature', why: 'Sets the loss coefficients and effective permittivity used for loss, delay and skew.' },
    { key: 'maxSegLossDb', label: 'Max segment loss', units: 'dB', value: 8, min: 2, max: 30, step: 0.5, group: 'Interconnect & packaging',
      conf: 'scaled-estimate', why: 'Repeater spacing rule: a new amplifier is inserted whenever a segment would exceed this.' },
    { key: 'lenTolUm', label: 'Length tolerance (1σ)', units: 'µm', value: 25, min: 1, max: 200, step: 1, group: 'Interconnect & packaging',
      conf: 'published-literature', why: 'Per-segment etch and registration tolerance on a controlled-impedance board. At 78 GHz on RO3003, ~6 µm is one degree.' },
    { key: 'dkTolPct', label: 'Dk tolerance', units: '%', value: 1.3, min: 0.1, max: 5, step: 0.1, group: 'Interconnect & packaging',
      conf: 'measured/datasheet', why: 'RO3003 is specified ±0.04 on Dk = 3.00. Halved into √εr, this is a large but STATIC (calibratable) phase error.' },
    { key: 'tcPpmPerK', label: 'Delay tempco', units: 'ppm/K', value: 18.5, min: 0, max: 200, step: 0.5, group: 'Interconnect & packaging',
      conf: 'measured/datasheet', why: 'CTE ≈ 17 ppm/K with TCDk ≈ −3 ppm/K for RO3003 gives ≈15.5 ppm/K of delay drift.' },
    { key: 'dTTileK', label: 'Tile-to-tile ΔT', units: 'K', value: 15, min: 0, max: 60, step: 1, group: 'Interconnect & packaging',
      conf: 'engineering-guess', why: 'Differential temperature across the aperture in operation. Drives the drift BIST has to track.' },
    { key: 'connSkewPs', label: 'Transition repeatability', units: 'ps', value: 0.5, min: 0, max: 20, step: 0.05, group: 'Interconnect & packaging',
      conf: 'engineering-guess', why: 'Unrepeatable DELAY per board/package transition. Specified in time, not degrees, because mechanical repeatability is roughly constant in µm — which is exactly why every distribution frequency sees the same skew. 0.5 ps ≈ 60 µm in this medium, and ≈14° at 78 GHz.' },

    /* --- baseband --- */
    { key: 'bbOption', label: 'BB split/combine', units: '', value: 2, group: 'Baseband',
      choices: [{ value: 0, label: 'B1 · Passive resistive' }, { value: 1, label: 'B2 · Daisy chain' },
                { value: 2, label: 'B3 · H-tree active' }, { value: 3, label: 'B4 · Current-mode summing' },
                { value: 4, label: 'B5 · Digitise at the tile' }],
      conf: 'measured/datasheet', why: 'B1–B3 are the candidates from the proposal. B4 and B5 were added after a survey: B4 is the IMPEDANCE REGIME rather than another topology inside it — this tool\'s own method note says that is worth more decibels than the B1/B2/B3 choice, and nothing exercised it — and B5 deletes the analog inter-tile tier outright, which is what a modern massive-MIMO array actually builds and the option a committee raises first. Selects what the tile-zoom diagram draws.' },
    { key: 'bbEdgeGHz', label: 'BB rail edge', units: 'GHz', value: 1, min: 0.1, max: 2.5, step: 0.1, group: 'Baseband',
      conf: 'measured/datasheet', why: 'IQ downconversion of a 2 GHz RF band gives ±1 GHz, so each rail is DC–1 GHz. Using 2 GHz here inflates every noise number by 3 dB.' },
    { key: 'bbCellSkewPs', label: 'BB cell skew (1σ)', units: 'ps', value: 3, min: 0.1, max: 40, step: 0.1, group: 'Baseband',
      conf: 'scaled-estimate', why: 'Per-cell / per-junction delay mismatch, accumulating over the tree levels or chain hops.' },
    { key: 'rficGainDb', label: 'RFIC gain ahead of BB', units: 'dB', value: 30, min: 0, max: 50, step: 1, group: 'Baseband',
      conf: 'measured/datasheet', why: 'RX gain is 20–40 dB. This is what makes the combiner’s noise-figure penalty nearly irrelevant.' },
    { key: 'ttdStepPs', label: 'Coarse TTD step', units: 'ps', value: 75, min: 10, max: 400, step: 5, group: 'Baseband',
      conf: 'published-literature', why: '50–100 ps class per the proposal. Note the binding constraint is RANGE (866 ps at 60° over 30 cm), not resolution.' },

    /* --- calibration --- */
    { key: 'fBistHz', label: 'BIST update rate', units: 'Hz', value: 1, min: 0.01, max: 1000, step: 0.01, group: 'Calibration',
      conf: 'scaled-estimate', why: 'Calibration-state update rate. Note this need NOT equal the ~100 Hz beam-update rate — drift bandwidth is ~0.3–3 Hz.' },
    { key: 'bistNoiseDeg', label: 'BIST phase noise (1 meas)', units: 'deg', value: 1.5, min: 0.05, max: 20, step: 0.05, group: 'Calibration',
      conf: 'engineering-guess', why: 'Single-measurement phase-estimate error. Too aggressive a loop imports this instead of removing drift.' },
    { key: 'bistMeasRateHz', label: 'BIST measurement rate', units: 'Hz', value: 2000, min: 1, max: 1e6, step: 1, group: 'Calibration',
      conf: 'scaled-estimate', why: 'How fast individual BIST observations can be taken, setting how many average into one update.' },
    { key: 'calLoopGain', label: 'Calibration loop gain µ', units: '-', value: 0.3, min: 0.02, max: 1, step: 0.02, group: 'Calibration',
      conf: 'scaled-estimate', why: 'Tracking-loop gain. The calibration corner is f_cal = µ·f_upd/2π — about 0.05 Hz at µ=0.3 and 1 Hz updates.' },
    { key: 'phaseBits', label: 'BB phase-shifter bits', units: 'bit', value: 7, min: 3, max: 12, step: 1, group: 'Calibration',
      conf: 'scaled-estimate', why: 'Quantisation residual is LSB/√12. There is no point buying bits below the irreducible noise floor.' },

    /* --- link & budget --- */
    { key: 'carrierTrackMHz', label: 'Carrier-recovery BW', units: 'MHz', value: 1, min: 0.001, max: 100, step: 0.001, group: 'Link & budget',
      conf: 'scaled-estimate', why: 'Lower integration limit for EVM: below it the receiver tracks the carrier out. A different limit from the beam-error band.' },
    { key: 'evmShare', label: 'EVM share for LO', units: '-', value: 0.3, min: 0.05, max: 1, step: 0.05, group: 'Link & budget',
      conf: 'engineering-guess', why: 'Fraction of the total EVM budget allocated to LO phase noise; the rest goes to PA, ADC and channel.' },
    { key: 'arrayPowerW', label: 'Array power budget', units: 'W', value: 95, min: 5, max: 500, step: 1, group: 'Link & budget',
      conf: 'scaled-estimate', why: '100 dies × ≈840 mW for 4 TX + 4 RX at E-band. Distribution power is expressed as a fraction of this.' },
    { key: 'specPhaseDeg', label: 'Inter-tile phase spec', units: 'deg', value: 5, min: 0.2, max: 30, step: 0.1, group: 'Link & budget',
      conf: 'measured/datasheet', why: 'The proposal’s own Eq. 16: |φ_dist| < 5° to avoid sidelobe degradation and squint amplification.' }
  ];

  var MEDIA_KEYS = ['ro3003_gcpw', 'ro3003_ms', 'siw_ro3003', 'wr12', 'ro4350_ms'];
  var LO_IDS = ['local-pll', 'hf-foldback', 'daisy-chain', 'mid-mult', 'stabilised-link', 'inj-lock'];
  var BB_IDS = ['passive-50', 'bb-daisy', 'h-tree-active', 'current-mode', 'digital-tile'];

  var LO_META = [
    { id: 'local-pll', name: 'A1 Local PLL + reference', short: 'Local PLL' },
    { id: 'hf-foldback', name: 'A2 High-frequency / foldback', short: 'HF foldback' },
    { id: 'daisy-chain', name: 'A3 Daisy chain', short: 'Daisy chain' },
    { id: 'mid-mult', name: 'A4 Mid-frequency + ×M', short: 'Mid + ×M' },
    { id: 'stabilised-link', name: 'A5 Round-trip stabilised link', short: 'Stabilised link' },
    { id: 'inj-lock', name: 'A6 Injection-locked tile oscillator', short: 'Injection lock' }
  ];
  var BB_META = [
    { id: 'passive-50', name: 'B1 Passive resistive', short: 'Passive 50 Ω' },
    { id: 'bb-daisy', name: 'B2 Baseband daisy chain', short: 'BB daisy' },
    { id: 'h-tree-active', name: 'B3 H-tree active', short: 'H-tree active' },
    { id: 'current-mode', name: 'B4 Current-mode summing', short: 'Current-mode' },
    { id: 'digital-tile', name: 'B5 Digitise at the tile', short: 'Digital tile' }
  ];

  /* ---------------------------------------------------------------------
     Per-option constants, in ONE table rather than scattered through
     evalLo as `id === 'hf-foldback' ? 0.8 : 0.3` chains.

     Those chains all defaulted to the mid-mult values, so any option added
     later would silently inherit mid-mult's repeater block, its splitter
     excess loss and its transition loss without anyone noticing — the
     numbers would look plausible and be wrong. A table forces a new option
     to state what it is, and traitsOf() refuses to guess.

       ampBlockKey      the repeater/buffer this option's line uses
       vcoFomPenaltyDb  FOM penalty for running the source at this frequency
       splitExcessDb    excess loss per corporate split, above the ideal 3.01
       transLossDb      per board/package transition
       mediumKey        which medium parameter applies: 'ref' or 'lo'
       perTileSource    true if each tile generates its own carrier
       activeFanout     true if the tree is fanned out with buffers rather
                        than passive splitters, so it pays no 3 dB per level
     ------------------------------------------------------------------- */
  var LO_TRAITS = {
    'local-pll': {
      ampBlockKey: 'refRepeater', vcoFomPenaltyDb: 0, splitExcessDb: 0.3,
      transLossDb: 0.25, mediumKey: 'ref', perTileSource: true, activeFanout: true,
      verdict: function (c) {
        var bare = Math.round(c.g.pllMult) === 1;
        return {
          feasibility: bare
            ? 'a 78 GHz PLL per tile in 65nm LP CMOS is beyond the technology'
            : 'realisable',
          risk: bare ? 'high' : 'medium'
        };
      }
    },
    'hf-foldback': {
      ampBlockKey: 'loAmp78', vcoFomPenaltyDb: 3, splitExcessDb: 0.8,
      transLossDb: 0.9, mediumKey: 'lo', perTileSource: false, activeFanout: false,
      verdict: function (c) {
        return {
          feasibility: c.lossTotalDb > 60
            ? 'E-band distribution loss is extreme'
            : 'realisable but E-band routing dominates the board',
          risk: 'high'
        };
      }
    },
    'daisy-chain': {
      ampBlockKey: 'chainBuf', vcoFomPenaltyDb: 0, splitExcessDb: 0.3,
      transLossDb: 0.25, mediumKey: 'lo', perTileSource: false, activeFanout: false,
      verdict: function () {
        return {
          feasibility: 'realisable; one dead buffer disables every downstream tile',
          risk: 'high'
        };
      }
    },
    'mid-mult': {
      ampBlockKey: 'loAmpMid', vcoFomPenaltyDb: 0, splitExcessDb: 0.3,
      transLossDb: 0.25, mediumKey: 'lo', perTileSource: false, activeFanout: false,
      verdict: function () {
        return { feasibility: 'realisable; the board never carries E-band', risk: 'low' };
      }
    },
    /* A5. The same mid-frequency tree as A4, plus a return path: a coupler at
       each tile sends the tone back, the master mixes outgoing against
       returned to measure TWICE the one-way path phase, and pre-corrects it
       continuously. This is the ALMA line-length-corrector / accelerator
       RF-reference technique. What it changes is not the phase noise but the
       DRIFT term: the correction runs at the loop bandwidth (kHz) instead of
       the BIST update rate (~1 Hz), and what is left is not a tracking
       residual but a RECIPROCITY error — round-trip cancellation is exact
       only for a reciprocal path, and couplers, amplifiers and connectors
       are not perfectly reciprocal. */
    'stabilised-link': {
      ampBlockKey: 'loAmpMid', vcoFomPenaltyDb: 0, splitExcessDb: 0.3,
      transLossDb: 0.25, mediumKey: 'lo', perTileSource: false, activeFanout: false,
      selfCorrecting: true,
      verdict: function () {
        return {
          feasibility: 'realisable; adds a coupler, a return path and a phase detector per tile',
          risk: 'medium'
        };
      }
    },
    /* A6. Distribute the sub-harmonic as in A4, but the tile holds an
       oscillator LOCKED BY INJECTION rather than a multiplier chain. Three
       consequences the other options cannot reproduce:
         - there is no PFD, no charge pump and no divider, so that whole
           in-band term does not exist rather than being reduced;
         - the injected reference is low-passed and the tile VCO high-passed
           at the LOCK bandwidth, which is hundreds of MHz rather than the
           few MHz a PLL can close, so the distribution path's additive noise
           is suppressed above the corner where A4 passes it in full;
         - a locked oscillator sits at a static phase offset
           arcsin(delta_f / f_lock) from the injection, so per-tile
           free-running frequency spread becomes a DETERMINISTIC inter-tile
           phase error that also drifts — an error term with no analogue in
           A1-A4. */
    'inj-lock': {
      ampBlockKey: 'loAmpMid', vcoFomPenaltyDb: 0, splitExcessDb: 0.3,
      transLossDb: 0.25, mediumKey: 'lo', perTileSource: false, activeFanout: false,
      injectionLocked: true,
      verdict: function (c) {
        var over = c.g.freeRunSpreadPct >= c.g.lockRangePct;
        return {
          feasibility: over
            ? 'free-running spread exceeds the lock range — tiles will not all lock'
            : 'realisable; no PFD, no divider, but the locked phase offset is a new error term',
          risk: over ? 'high' : 'medium'
        };
      }
    }
  };

  function traitsOf(id) {
    var t = LO_TRAITS[id];
    if (!t) throw new Error('model.js: no LO_TRAITS entry for option "' + id +
      '" — a new distribution option must declare its own constants rather than ' +
      'inheriting another option\'s by falling through a conditional.');
    return t;
  }

  /* The same discipline for the baseband options. Only the pure constants
     live here; the loss, noise-figure and skew MODELS differ in form
     between options, not just in value, so they stay as explicit branches
     in evalBb where they can be read. */
  var BB_TRAITS = {
    'passive-50': {
      driftDegPerK: 0.002, bwGHz: 4.0, cascadedIip3: false,
      verdict: function () {
        return {
          feasibility: 'realisable and essentially drift-free; the cost is TX-direction drive power',
          risk: 'low'
        };
      }
    },
    'bb-daisy': {
      driftDegPerK: 0.03, bwGHz: null, cascadedIip3: false,
      bwOf: function (c) { return Math.max(0.15, 4 / c.nCh); },
      verdict: function () {
        return { feasibility: 'bandwidth collapses as channel count grows', risk: 'high' };
      }
    },
    'h-tree-active': {
      driftDegPerK: 0.05, bwGHz: 3.5, cascadedIip3: true,
      verdict: function () {
        return { feasibility: 'realisable; needs group-delay BIST', risk: 'medium' };
      }
    },
    /* B4. Not another topology inside the same impedance regime — the
       impedance regime itself, which this tool's own method note says is
       worth more decibels than the choice among B1/B2/B3, and which no row
       exercised until now. Every channel drives current into one virtual
       ground held by a single transimpedance amplifier per rail: coherent
       transfer is 0 dB (B1's 20log10(N) voltage division is exactly what a
       virtual ground removes), the N-1 cell cascade collapses to ONE stage,
       and with one stage there is no cascaded IIP3 penalty and no
       sqrt(levels) skew accumulation. */
    'current-mode': {
      driftDegPerK: 0.02, bwGHz: 2.5, cascadedIip3: false,
      verdict: function (c) {
        return {
          feasibility: c.nCh > 32
            ? 'realisable, but the summing node capacitance is what limits bandwidth at this channel count'
            : 'realisable; one stage, no cascade',
          risk: 'medium'
        };
      }
    },
    /* B5. Deletes the analog inter-tile tier outright: combine within the
       tile, digitise there, and send bits. It is what a modern massive-MIMO
       array actually builds, so a comparison that omits it reads a decade
       out of date — and it is the option a committee raises first. The
       analog inter-tile skew budget disappears and is replaced by
       deterministic-latency lane alignment; what it costs is converter
       power, and that is the number that decides it. */
    'digital-tile': {
      driftDegPerK: 0.0, bwGHz: null, cascadedIip3: false,
      digital: true,
      bwOf: function (c) { return Math.max(0.1, c.g.adcGspsPerRail / 2.5); },
      verdict: function (c) {
        var frac = c.powerFracOfArray;
        return {
          feasibility: frac > 40
            ? 'converter power alone takes ' + frac.toFixed(0) + '% of the array budget'
            : 'realisable in principle; the converters do not fit the 65nm LP tile process',
          risk: 'high'
        };
      }
    }
  };

  function bbTraitsOf(id) {
    var t = BB_TRAITS[id];
    if (!t) throw new Error('model.js: no BB_TRAITS entry for option "' + id + '".');
    return t;
  }

  /* resolve the raw numeric state into a convenient object */
  function resolve(state) {
    var g = {};
    PARAMS.forEach(function (p) { g[p.key] = state[p.key]; });
    g.loOptionId = LO_IDS[Math.round(g.loOption)] || LO_IDS[3];
    g.bbOptionId = BB_IDS[Math.round(g.bbOption)] || BB_IDS[2];
    g.loMediumKey = MEDIA_KEYS[Math.round(g.loMedium)] || MEDIA_KEYS[0];
    g.refMediumKey = 'stripline';
    g.refName = REF_SOURCES[Math.round(g.refSel)] ? REF_SOURCES[Math.round(g.refSel)].name : 'reference';
    g.epsEff = K.MEDIA[g.loMediumKey].epsEff;
    g.fLoHz = g.fLoGHz * 1e9;
    g.bbEdgeHz = g.bbEdgeGHz * 1e9;
    g.lambdaM = K.C0 / g.fLoHz;
    g.apertureM = g.apertureCm / 100;

    /* A tile pitch need not divide the aperture. The grid is a whole number
       of tiles, so the POPULATED aperture is cols*pitch, which can differ
       from the requested figure — 4 cm over 30 cm is the obvious case. Beam
       metrics must use the populated aperture, because that is the radiating
       extent; the requested figure is only a target. Both are carried so the
       UI can report the difference instead of printing a number that has
       quietly stopped being true. */
    /* FLOOR, never round. The aperture is a hard mechanical spec — a panel.
       Rounding can overflow it (round(30/4) = 8 would draw a 32 cm array
       inside a 30 cm panel, which cannot be built); flooring can only
       under-fill, and an under-filled panel is buildable. The epsilon keeps
       exact divisors exact against binary floating point, so 30/6 gives 5
       and not 4. */
    g.tileCols = Math.max(1, Math.floor(g.apertureCm / g.tileCm + 1e-9));
    g.nTilesTotal = g.tileCols * g.tileCols;
    g.effApertureCm = g.tileCols * g.tileCm;
    g.effApertureM = g.effApertureCm / 100;
    g.apertureMarginCm = (g.apertureCm - g.effApertureCm) / 2;   /* per side, >= 0 */
    g.apertureFillSide = g.effApertureCm / g.apertureCm;
    g.aperturePitchExact = Math.abs(g.apertureCm - g.effApertureCm) < 5e-3;
    /* peak directivity relative to filling the panel: a side-length ratio on
       an amplitude-like extent in each of two dimensions, so 20log10 of the
       side ratio, identical to 10log10 of the area ratio */
    g.apertureDirDeltaDb = 20 * Math.log10(g.apertureFillSide);
    /* pitches that fill exactly, keeping this tile count or adding one row */
    g.snapCoarseCm = g.apertureCm / g.tileCols;
    g.snapFineCm = g.apertureCm / (g.tileCols + 1);
    g.loTapsTotal = g.nTilesTotal * Math.round(g.tapsPerTile);
    g.diesPlaced = Math.min(g.loTapsTotal, Math.round(g.nDies));
    g.diePopGainDb = 10 * Math.log10(Math.max(g.diesPlaced, 1) / Math.max(Math.round(g.nDies), 1));

    /* ---------------------------------------------------------------- *
     * THE ELEMENT LATTICE — the geometry that actually radiates.
     *
     * This is the layer the beam model was missing. One LO tap feeds one
     * die, and a die carries 4 RX + 4 TX channels, so the radiating count
     * follows from the tap count and is NOT a free choice. Antennas sit on
     * the package rather than on the 2.5 mm die (4 elements at lambda/2
     * span 5.8 mm, more than the die is wide), so the lattice pitch is set
     * by how the elements are distributed over the tile, not by the die.
     *
     * The consequence is the headline fact about this architecture: with a
     * few hundred elements over a 28 cm aperture the lattice is several
     * wavelengths coarse, so the array keeps the BEAMWIDTH of the full
     * aperture but only the GAIN of its element count, and the difference
     * goes into grating lobes.
     * ---------------------------------------------------------------- */
    g.diesPerTile = Math.max(1, Math.round(g.tapsPerTile));
    g.chPerDiePerDir = 4;                       /* 4 RX + 4 TX per die */
    g.elemPerTile = g.diesPerTile * g.chPerDiePerDir;
    g.nElem = g.nTilesTotal * g.elemPerTile;

    /* Arrangement inside a tile — CHOSEN, not assumed. An earlier version
       forced a rectangular factorisation (round(sqrt(8)) -> 4 x 2). That is
       not a constraint: every sublattice of index 8 that CONTAINS the tile
       lattice keeps all tiles identical, and 4 x 2 turns out to be the worst
       of them (worst grating lobe 11.08 deg, against 15.77 deg for the
       sheared lattice a1 = (1,-1), a2 = (0,2) cm, at zero cost). See
       lattice.js.

       Whatever the choice, tiles abut, so the FULL array is one lattice with
       the tile grid as a sublattice. That consistency is what lets the ideal
       pattern factorise as intra-tile x tile-grid: at band centre the
       intra-tile phase steer and the inter-tile delay steer coincide and
       AF(4, 1 cm) x AF(7, 4 cm) collapses exactly to AF(28, 1 cm), so the
       full-aperture beamwidth is preserved while the grating lobes appear. */
    g.lamCm = g.lambdaM * 100;
    g.latList = window.Lat.candidates(g.elemPerTile, g.tileCm, g.lamCm);
    g.latKey = ['rect', 'best', 'row'][Math.round(g.inTileLattice)] || 'rect';
    g.lat = window.Lat.pick(g.latList, g.latKey, g.elemPerTile);
    g.latBest = g.latList[g.latList.length - 1];
    g.latWorst = g.latList[0];
    g.latOffsetsCm = g.lat.offsets;

    /* What a principal-plane cut actually sees: the lattice PROJECTED onto
       the cut axis. For the sheared lattice the 8 offsets project onto 4
       distinct x columns of 2, so the x-cut is indistinguishable from 4 x 2
       — the improvement lives off the principal planes, which is exactly why
       two cuts are not an honest presentation of this array. */
    function project(offs, idx, period) {
      var seen = {}, xs = [];
      offs.forEach(function (p) {
        var v = p[idx] - period * Math.floor(p[idx] / period + 1e-9);
        var k = Math.round(v * 1e6);
        if (!seen[k]) { seen[k] = 1; xs.push(v); }
      });
      xs.sort(function (a, b) { return a - b; });
      return xs;
    }
    g.colsXCm = project(g.latOffsetsCm, 0, g.tileCm);
    g.colsYCm = project(g.latOffsetsCm, 1, g.tileCm);
    g.elemPerTileX = g.colsXCm.length;
    g.elemPerTileY = g.colsYCm.length;
    g.elemDxCm = g.tileCm / Math.max(g.elemPerTileX, 1);
    g.elemDyCm = g.tileCm / Math.max(g.elemPerTileY, 1);
    g.elemDxM = g.elemDxCm / 100;
    g.nElemX = g.tileCols * g.elemPerTileX;
    g.elemDxLam = g.elemDxM / g.lambdaM;
    /* N*d is the right length for the beamwidth formula, but it is not the
       physical extent of the radiators: the outermost element centres are
       one pitch closer together than that. Both get reported. */
    g.ndXCm = g.effApertureCm;
    g.extentXCm = Math.max(g.effApertureCm - g.elemDxCm, 0);
    g.extentYCm = Math.max(g.effApertureCm - g.elemDyCm, 0);
    g.minSepCm = g.lat ? g.lat.minSepCm : g.elemDxCm;

    var areaM2 = g.effApertureM * g.effApertureM;
    /* uniform-lattice pitch that spreads nElem over the populated aperture */
    g.elemSpacingM = g.nElem > 0 ? Math.sqrt(areaM2 / g.nElem) : g.lambdaM / 2;
    g.elemSpacingCm = g.elemSpacingM * 100;
    g.elemSpacingLam = g.elemSpacingM / g.lambdaM;
    /* how far from a critically sampled lambda/2 lattice */
    g.sparsityFactor = g.elemSpacingM / (g.lambdaM / 2);
    g.nElemFilled = areaM2 / Math.pow(g.lambdaM / 2, 2);

    /* ---- the element, which is where the missing 16 dB actually lives ---- */
    g.elem = window.Lat.element({
      key: ['dir', 'hpbw', 'nulled'][Math.round(g.elemModelSel)] || 'dir',
      lamCm: g.lamCm, a1: g.lat.a1, a2: g.lat.a2,
      elemDirDbi: g.elemDirDbi, hpbwDeg: g.elemHpbwDeg
    });
    g.elemPowExp = g.elem.n;
    g.aCellCm2 = g.elem.aCellCm2;
    g.dCellDbi = g.elem.dCellDbi;
    g.dElDbi = g.elem.dElDbi;

    /* Directivity chain, all in dBi. The cap matters: N x D_el is only valid
       until the element saturates its own cell, beyond which the array can
       do no better than the filled aperture. */
    g.dFilledDbi = 10 * Math.log10(4 * Math.PI * areaM2 / (g.lambdaM * g.lambdaM));
    g.dArrayRawDbi = 10 * Math.log10(Math.max(g.nElem, 1)) + g.dElDbi;
    g.dArrayDbi = Math.min(g.dArrayRawDbi, g.dFilledDbi);
    /* NOT a "thinning" loss. It is 10log10(4*pi*A_cell/(lambda^2 * D_el)) —
       the ratio of the element's effective area to the area of the cell it
       sits in — and it is recoverable by making the element bigger, up to
       the cell ceiling D_cell. It is also, identically, 10log10 of the
       number of lattice lobes the sparse grid creates: the "loss" is the
       power split among co-equal beams. */
    g.thinningLossDb = g.dFilledDbi - g.dArrayRawDbi;
    g.apertureEffPct = 100 * Math.pow(10, -g.thinningLossDb / 10);
    var lamMm = g.lambdaM * 1000;
    g.aEffElMm2 = Math.pow(10, g.dElDbi / 10) * lamMm * lamMm / (4 * Math.PI);
    g.aCellMm2 = g.aCellCm2 * 100;
    g.cellFillPct = 100 * g.aEffElMm2 / Math.max(g.aCellMm2, 1e-9);
    g.dElHeadroomDb = g.dCellDbi - g.dElDbi;
    /* directivity is not gain */
    g.realisedGainDbi = g.dArrayDbi - g.antLossDb;
    /* far-field distance of the populated aperture */
    g.farFieldM = 2 * g.effApertureM * g.effApertureM / g.lambdaM;

    /* ---- grating lobes: the whole 2-D set, not one axis ----
       For a UNIFORM PERIODIC lattice a grating lobe is a full-amplitude
       replica of the main beam — suppressed only by the element pattern. The
       lobe positions are the reciprocal lattice scaled by lambda, so there
       are pi*A_cell/lambda^2 of them in visible space at broadside, and the
       binding one is whichever has the most element gain, not whichever lies
       on the axis the cut happens to use. */
    g.lobesBroadside = window.Lat.withLevels(
      window.Lat.lobes(g.lat.b1, g.lat.b2, g.lamCm, 0, 0), g.elem, 0, 0);
    g.lobeCount = g.lobesBroadside.length;
    g.lobeCountClosed = Math.PI * g.aCellCm2 / (g.lamCm * g.lamCm);
    g.gratingVisible = g.lobeCount > 0;
    g.gratingDegBroadside = g.lobeCount ? g.lobesBroadside[0].thetaDeg : NaN;
    g.gratingSuppDb = g.lobeCount ? g.lobesBroadside[0].relDb : NaN;
    /* kept for the one-axis readout, now clearly labelled as such */
    g.gratingDeltaSin = g.lambdaM / g.elemDxM;
    /* filled-lattice reference counts, so the sparsity is unmissable */
    g.filledPerTile = Math.pow(g.tileCm / (g.lamCm / 2), 2);
    /* An aperiodic lattice trades the discrete lobes for a raised sidelobe
       floor near 1/N. The MEAN is 1/N; the expected PEAK over a cut of
       aperture L is higher by 10log10(ln(2L/lambda)), which is the number
       that actually has to be met. */
    g.thinnedFloorDb = -10 * Math.log10(Math.max(g.nElem, 1));
    g.peakOverMeanDb = 10 * Math.log10(Math.max(Math.log(2 * g.effApertureM / g.lambdaM), 1.01));
    g.thinnedPeakDb = g.thinnedFloorDb + g.peakOverMeanDb;
    /* How much position randomisation it takes to actually break the
       periodicity, and how much is available inside one cell. A random
       position offset delta perturbs the phase at a lobe offset dU by
       2*pi*delta*dU/lambda, so the coherent lobe residue is exp(-sigma^2)
       and reaching the 1/N floor needs sigma^2 = ln(N):

           delta_needed = lambda*sqrt(ln N) / (2*pi*dU)

       Dithering within the cell can supply at most cell/sqrt(12) RMS. When
       that is less than delta_needed — and at this lattice it is, by a
       factor of a few — a perturbed-periodic layout keeps a QUASI-GRATING
       residue at the old lobe angles, well above the 1/N floor. Breaking it
       properly needs a non-repeating layout over the whole aperture, which
       means tiles that are no longer identical. */
    var dUbind = g.lobeCount ? g.lobesBroadside[0].dU : 0;
    g.thinNeedRmsMm = dUbind > 0
      ? lamMm * Math.sqrt(Math.log(Math.max(g.nElem, 2))) / (2 * Math.PI * dUbind) : NaN;
    g.thinAvailRmsMm = 10 * Math.min(g.elemDxCm, g.elemDyCm) / Math.sqrt(12);
    var sigDith = 2 * Math.PI * g.thinAvailRmsMm * dUbind / lamMm;
    g.thinResidueDb = dUbind > 0 ? -10 * Math.log10(Math.exp(sigDith * sigDith)) : NaN;
    return g;
  }

  /* ===================================================================== *
   * Phase-noise assembly for one LO option.
   * Returns { abs(f), uncorr(f), corr(f), arrayOut(f), diff(f) } in dBc/Hz
   * at the E-band carrier.
   * =================================================================== */
  function pnModel(id, g, topo) {
    var fLo = g.fLoHz;
    var nT = topo.grid.nTiles;
    var lin = K.db2lin, dbl = K.lin2db;

    /* --- source PLL, at whatever frequency it runs, then multiplied --- */
    function sourcePn(fOsc, M, fomVco, ampCount, ampBlock, multBlock) {
      var fPfd = g.fRefMHz * 1e6;
      var N = fOsc / fPfd;
      var fn = K.loopFnFromBw(g.pllLoopBwMHz * 1e6, g.pllZeta);
      return function (f) {
        var L = K.loopMags(f, fn, g.pllZeta);
        /* in-band contributors, referred to fOsc */
        var refPart = lin(K.refPnDbc(f, { ref1k: g.ref1k, ref10k: g.ref10k, ref100k: g.ref100k, refFloor: g.refFloor })
          + 20 * Math.log10(N));
        var pfdPart = lin(K.pllFloorDbc(fOsc, fPfd, g.fomPll));
        var flickPart = lin(K.pllFlickerDbc(f, fOsc, g.pllFlickNorm));
        var vcoPart = lin(K.vcoPnDbc(f, fOsc, fomVco, g.vcoPowerMw, g.vcoCornerHz));
        /* Kept apart deliberately: the reference-derived term is common to
           every tile that shares the reference and must NEVER enter the
           uncorrelated bucket, while the PFD/charge-pump/divider and flicker
           terms are generated inside each tile and are uncorrelated. */
        var inbandRef = refPart * L.H2;
        var inbandLocal = (pfdPart + flickPart) * L.H2;
        var inband = inbandRef + inbandLocal;
        var outband = vcoPart * L.S2;
        var atOsc = inband + outband;
        /* multiplication to fLo: phase multiplies, so +20log10(M) */
        var atLo = atOsc * M * M;
        /* additive noise of the multiplier and of the amplifier chain */
        var add = 0;
        if (M > 1 && multBlock) add += lin(K.additivePnDbc(f, multBlock.addPnFloorDbc, multBlock.addPnCornerHz, 1));
        if (ampCount > 0 && ampBlock) add += lin(K.additivePnDbc(f, ampBlock.addPnFloorDbc, ampBlock.addPnCornerHz, ampCount));
        return {
          total: atLo + add, corrAtLo: atLo, uncorrAdd: add,
          inbandAtLo: inband * M * M,
          inbandRefAtLo: inbandRef * M * M,
          inbandLocalAtLo: inbandLocal * M * M,
          vcoAtLo: outband * M * M
        };
      };
    }

    var dTauS = (topo.lo.pathRmsSpreadCm * K.lineDelayPsCm(g.loMediumKey)) * 1e-12;
    var nAmp = Math.max(1, topo.lo.maxRepeatersInPath + (topo.lo.kind === 'chain' ? topo.lo.maxHop : topo.lo.splitCount ? 2 : 1));

    if (id === 'local-pll') {
      var M1 = Math.max(1, Math.round(g.pllMult));
      var fOsc1 = fLo / M1;
      /* a VCO forced to run at 78 GHz loses ~10 dB of FOM */
      var fom1 = M1 === 1 ? g.fomVco + 3 : g.fomVco;
      var src = sourcePn(fOsc1, M1, fom1, 1, BLOCKS.loBuf78, BLOCKS.tileMult);
      return {
        abs: function (f) { return dbl(src(f).total); },
        parts: function (f) {
          var s = src(f);
          /* Reference-derived in-band noise is COMMON to every tile locked to
             the same reference, so it cancels in the differential. The
             PFD/CP/divider and flicker terms and the whole free-running VCO
             term are generated per tile and do not cancel. uncorrInbandFrac
             scales only the local in-band term, for the case where some of it
             is common through shared bias or a shared reference buffer. */
          var localUnc = s.inbandLocalAtLo * g.uncorrInbandFrac;
          var corr = s.inbandRefAtLo + s.inbandLocalAtLo * (1 - g.uncorrInbandFrac);
          var unc = localUnc + s.vcoAtLo + s.uncorrAdd;
          return { corr: corr, uncorr: unc };
        },
        decorrTau: 0,
        nAmpPath: 1
      };
    }

    /* --- shared-source options --- */
    var fDist = topo.lo.distFreqHz;
    var Ms = Math.max(1, topo.lo.tileMultiplier);
    var trS = traitsOf(id);
    var ampBlk = BLOCKS[trS.ampBlockKey] || BLOCKS.loAmpMid;
    var fomS = g.fomVco + trS.vcoFomPenaltyDb;   /* FOM penalty at this frequency */
    var srcS = sourcePn(fDist, Ms, fomS, nAmp, ampBlk, BLOCKS.tileMult);

    /* A6: the tile oscillator is locked by injection, so the composite is a
       first-order crossover at the LOCK bandwidth — the injected reference
       low-passed, the tile tank high-passed. Two things follow that no PLL
       option reproduces. The corner is hundreds of MHz rather than the few
       a PLL can close, so the line's additive noise is suppressed over a
       far wider band than A4 suppresses it; and there is no PFD, charge
       pump or divider anywhere, so that term is absent rather than small.
       Above the corner the tile tank's own free-running noise takes over,
       and being per-tile it is uncorrelated. */
    if (trS.injectionLocked === true) {
      var fLockHz = Math.max(g.lockBwMHz, 1e-3) * 1e6;
      var tankFom = g.fomVco + 3;   /* a 78 GHz tank pays the same FOM penalty as any 78 GHz VCO */
      var tankPn = function (f) {
        return K.vcoPnDbc(f, fLo, tankFom, BLOCKS.tileIlo.powerMw, g.vcoFlickerCornerHz || 3e5);
      };
      return {
        abs: function (f) {
          var s = srcS(f);
          var w = 1 / (1 + Math.pow(f / fLockHz, 2));          /* |H|^2 of the lock */
          var inj = s.corrAtLo + s.uncorrAdd;
          return dbl(inj * w + K.db2lin(tankPn(f)) * (1 - w));
        },
        parts: function (f) {
          var s = srcS(f);
          var w = 1 / (1 + Math.pow(f / fLockHz, 2));
          /* the injected part keeps the shared source's correlation, minus
             the delay decorrelation, and is attenuated above the corner;
             the tank part is per tile and never correlates */
          var corr = s.corrAtLo * w;
          var unc = (s.uncorrAdd + s.corrAtLo * K.decorrKernel(f, dTauS)) * w +
                    K.db2lin(tankPn(f)) * (1 - w);
          return { corr: corr, uncorr: unc };
        },
        decorrTau: dTauS,
        nAmpPath: nAmp
      };
    }

    return {
      abs: function (f) { return dbl(srcS(f).total); },
      parts: function (f) {
        var s = srcS(f);
        /* shared source is correlated, but only to within the path delay
           mismatch: residual = 4 sin^2(pi f dTau) */
        var corr = s.corrAtLo;
        var unc = s.uncorrAdd + s.corrAtLo * K.decorrKernel(f, dTauS);
        return { corr: corr, uncorr: unc };
      },
      decorrTau: dTauS,
      nAmpPath: nAmp
    };
  }

  /* ===================================================================== *
   * Evaluate one LO option end to end.
   * =================================================================== */
  function evalLo(id, g) {
    var trL = traitsOf(id);
    var gg = {};
    for (var k in g) gg[k] = g[k];
    /* Topo.build reads loOptionId, so overwrite BOTH fields: leaving the
       numeric one pointing at the user's selection while the id points at
       the option under test is exactly the kind of split that let the map
       draw one architecture while the tables described another. */
    gg.loOptionId = id;
    gg.loOption = LO_IDS.indexOf(id);
    /* `gg.refMedium = gg.refMediumKey` and its loMedium twin used to live
       here, because topology.js read the numeric slider fields and needed
       them substituted. It now reads the resolved *Key fields directly, so
       there is one convention instead of two — and the map, which is built
       from an unpatched g, no longer silently gets a null line loss and
       draws a network with no repeaters in it. */
    var topo = window.Topo.build(gg);
    var grid = topo.grid, lo = topo.lo;
    var nT = grid.nTiles;
    var pn = pnModel(id, g, topo);

    /* ---------------- M1: L(f) curve and named offsets ---------------- */
    var pnCurve = [], pnAtOffsets = {};
    for (var i = 0; i <= 60; i++) {
      var f = Math.pow(10, 2 + 7 * i / 60);          /* 100 Hz .. 1 GHz */
      pnCurve.push({ fOffsetHz: f, dBcPerHz: pn.abs(f) });
    }
    [1e3, 1e4, 1e5, 1e6, 1e7, 1e8].forEach(function (f) { pnAtOffsets[f] = pn.abs(f); });

    /* differential (inter-tile, mean-referred) curve — the decision curve */
    var mr2 = Math.max(nT - 1, 0) / Math.max(nT, 1);
    function diffLin(f) { return pn.parts(f).uncorr * mr2; }
    var pnDiffCurve = pnCurve.map(function (p) {
      return { fOffsetHz: p.fOffsetHz, dBcPerHz: K.lin2db(diffLin(p.fOffsetHz)) };
    });

    /* array-output curve: uncorrelated noise averages down by N in the
       coherent sum, correlated noise does not. This is why per-tile PLLs
       can give BETTER link EVM while giving WORSE beam coherence. */
    function arrayOutLin(f) { var p = pn.parts(f); return p.corr + p.uncorr / nT; }
    var pnArrayCurve = pnCurve.map(function (p) {
      return { fOffsetHz: p.fOffsetHz, dBcPerHz: K.lin2db(arrayOutLin(p.fOffsetHz)) };
    });

    /* ---------------- M2: integrated phase error / jitter ---------------- */
    var fEvmLo = g.carrierTrackMHz * 1e6, fEvmHi = g.bbEdgeHz;
    var phiAbsRad = K.pnIntegrateRad(function (f) { return pn.abs(f); }, fEvmLo, fEvmHi);
    var phiArrRad = K.pnIntegrateRad(function (f) { return K.lin2db(arrayOutLin(f)); }, fEvmLo, fEvmHi);
    var phiRmsDeg = phiAbsRad * K.DEG;
    var jitterFs = K.jitterS(phiAbsRad, g.fLoHz) * 1e15;

    /* ---------------- M3: inter-tile phase error ---------------- */
    /* raw: differential phase noise over the full band the beam sees */
    var fBeamLo = 1;                                  /* 1 Hz */
    var phiDiffRawRad = K.pnIntegrateRad(function (f) { return K.lin2db(diffLin(f)); }, fBeamLo, fEvmHi);

    /* calibrated: a first-order tracking loop of corner f_cal high-passes
       the differential noise, and injects its own measurement noise */
    var fCal = g.calLoopGain * g.fBistHz / (2 * Math.PI);
    var phiDiffCalRad = K.pnIntegrateRad(function (f) {
      var hp = (f / fCal) * (f / fCal) / (1 + (f / fCal) * (f / fCal));
      return K.lin2db(diffLin(f) * hp);
    }, fBeamLo, fEvmHi);

    var tUpd = 1 / Math.max(g.fBistHz, 1e-6);
    var nAvg = Math.max(1, tUpd * g.bistMeasRateHz);
    var injDeg = g.bistNoiseDeg * Math.sqrt(g.calLoopGain / (2 - g.calLoopGain) / nAvg);
    /* A4's BIST measurement made at the distribution frequency is
       multiplied by M when referred to the LO */
    /* a per-tile multiplier multiplies the BIST measurement noise too */
    if (!trL.perTileSource && lo.tileMultiplier > 1) injDeg *= lo.tileMultiplier;

    /* ---------------- M4: skew ----------------
       Three distinct classes, kept apart because they have different fates:

       (a) GEOMETRIC path-length imbalance. Known by construction from the
           drawn topology. A designer equalises it, and whatever is left is a
           one-time static offset. It is a DESIGN REQUIREMENT, not an error —
           reporting it as a phase error gives thousands of degrees, which is
           just "unknown phase" and wraps meaninglessly.
       (b) STATIC but unknown: Dk tolerance over the path. Large, removed by
           the first calibration, but it returns after any rework.
       (c) RANDOM: per-segment etch tolerance and transition repeatability.
           This is the part that survives calibration, and it is the only one
           that belongs in the inter-tile phase error.                       */
    var medKey = trL.mediumKey === 'ref' ? g.refMediumKey : g.loMediumKey;
    var psPerCm = K.lineDelayPsCm(medKey);
    var alpha = K.lineAlphaDbCm(medKey, lo.distFreqHz);
    var degPs = K.degPerPs(g.fLoHz);

    /* (a) geometric imbalance from the topology itself */
    var pathImbalancePs = lo.pathRmsSpreadCm * psPerCm;
    var pathImbalanceWraps = pathImbalancePs * degPs / 360;

    /* (b) static and unknown until measured: Dk tolerance over the path,
       per-segment etch tolerance, and transition repeatability. These are
       UNKNOWN but they do not fluctuate — a solder joint's phase is fixed
       once assembled — so a single calibration removes all of them. They set
       the required correction RANGE, not the residual error. */
    var dkPs = lo.pathMeanCm * psPerCm * (0.5 * g.dkTolPct / 100);
    var segTolPs = (g.lenTolUm * 1e-4) * psPerCm;
    var nTrans = lo.kind === 'chain' ? lo.maxHop : 2;
    var etchPs = K.seriesRandom(segTolPs, lo.maxSeriesSegments);
    var transPs = K.seriesRandom(g.connSkewPs, nTrans);
    var staticUnknownPs = K.rss(dkPs, etchPs, transPs);
    /* a chain's per-hop errors compound as a random WALK along the aperture,
       so its static spread grows as sqrt(n/6) rather than staying put */
    if (lo.kind === 'chain') staticUnknownPs *= K.walkRmsFactor(Math.max(lo.maxHop, 2));
    var skewStaticPs = K.rss(staticUnknownPs, pathImbalancePs);

    /* (c) what actually SURVIVES calibration: thermal drift of the
       differential path between BIST updates. Everything static is gone. */
    var driftPsPerK = lo.pathMeanCm * psPerCm * g.tcPpmPerK * 1e-6;
    var skewDriftPs = driftPsPerK * g.dTTileK;

    var skewRmsPs = K.rss(skewStaticPs, skewDriftPs);
    var skewPeakPs = skewRmsPs * K.peakFactor(nT);
    /* Open-loop correction range the calibration must cover, in degrees at
       the LO. Quoting it as an "error" would be wrong — it is a requirement,
       and it wraps, so the BIST must resolve the integer ambiguity too. */
    var correctionRangeDeg = skewStaticPs * degPs;
    var skewDeg78 = skewDriftPs * degPs;
    var skewRandomPs = skewDriftPs;

    /* thermal drift of the differential path — what BIST must track */
    var driftDegPerK = lo.pathMeanCm * psPerCm * g.tcPpmPerK * 1e-6 * degPs;
    var driftTotalDeg = driftDegPerK * g.dTTileK;
    /* assume the differential thermal excursion plays out over ~10 min */
    var driftRateDegPerS = driftTotalDeg / 600;
    var driftResidDeg = K.driftResidualDeg(driftRateDegPerS, tUpd, g.calLoopGain);
    var quantDeg = K.quantResidualDeg(g.phaseBits);

    /* A5: the line corrects ITSELF. A round-trip servo running at
       linkLoopBwHz sees the whole drift spectrum — thermal drift lives well
       below 1 Hz and the loop closes at kHz — so the sampled-calibration
       residual above is replaced, not reduced. What survives is the path's
       NON-RECIPROCITY: round-trip cancellation is exact only if forward and
       reverse traverse the same electrical length, and couplers, amplifiers
       and connectors do not oblige. Finite coupler directivity adds a
       measurement bias on top, bounded by arcsin(10^(-D/20)) and reduced by
       the fact that the servo works differentially against a stored
       reference rather than absolutely. */
    var linkTracksDrift = trL.selfCorrecting === true;
    var reciprocityDeg = 0, couplerBiasDeg = 0;
    if (linkTracksDrift) {
      /* the fraction of the drift spectrum the loop cannot follow: drift is
         a ramp over ~600 s, so a loop at even 1 Hz leaves essentially none */
      var uncorrectedFrac = Math.min(1, (1 / 600) / Math.max(g.linkLoopBwHz, 1e-6));
      var residualDriftDeg = driftTotalDeg * uncorrectedFrac;
      reciprocityDeg = g.reciprocityErrDeg;
      couplerBiasDeg = Math.asin(Math.min(1, Math.pow(10, -g.couplerDirDb / 20))) * K.DEG * 0.1;
      driftResidDeg = K.rss(residualDriftDeg, reciprocityDeg, couplerBiasDeg);
    }

    /* A6: a locked oscillator does not sit ON the injected phase, it sits at
       arcsin(delta_f / f_lock) from it. Tile-to-tile spread in the
       free-running frequency therefore becomes a deterministic inter-tile
       phase error — calibratable once, but it moves with temperature, and
       that part is not. Reported separately because it is an error class
       none of A1-A4 has. */
    var lockOffsetDeg = 0, lockOffsetDriftDeg = 0;
    if (trL.injectionLocked === true) {
      var ratio = Math.min(1, (g.freeRunSpreadPct || 0) / Math.max(g.lockRangePct, 1e-6));
      lockOffsetDeg = Math.asin(ratio) * K.DEG;
      /* the tank's own temperature coefficient moves the detuning, and with
         it the locked phase; d(theta)/d(delta_f) = 1/(f_lock cos theta) */
      var dRatio = ratio * (g.dTTileK / 100);       /* ~1%/K of the spread */
      lockOffsetDriftDeg = Math.min(90, Math.asin(Math.min(1, ratio + dRatio)) * K.DEG) - lockOffsetDeg;
      driftResidDeg = K.rss(driftResidDeg, lockOffsetDriftDeg);
    }

    /* Raw = what you get with no calibration at all, EXCLUDING the geometric
       imbalance (which is designed out, not calibrated out) but including the
       unknown static Dk term. Residual = what survives calibration.        */
    /* Raw = open loop, including every static offset. Residual = what a
       working calibration leaves: differential phase noise above the
       calibration corner, the estimator's own injected noise, and the drift
       it could not follow between updates. No static term appears in the
       residual — that is what calibration IS.

       Phase-shifter quantisation is NOT in this list, and that is the fix,
       not an omission. A phase shifter sits at the element; its LSB residual
       has no tile-common part, and js/beam.js already puts
       quantResidualDeg(phaseBits) into sigElem where it averages over 392
       elements rather than 49 tiles. Carrying it here too counted the same
       0.812 deg twice and at the wrong level — and because it depends only
       on phaseBits it was IDENTICAL for all six options, so it drowned the
       thing this metric exists to measure: A2/A3/A4 sat at 0.835/0.859/0.821
       deg, within 4.6% of each other, where the distribution architectures
       actually differ by 0.197/0.279/0.123. It is still reported on its own
       row, and still reaches the beam through sigElem. */
    var interTileRawDeg = K.rss(phiDiffRawRad * K.DEG, correctionRangeDeg, driftTotalDeg, lockOffsetDeg);
    var interTileResidualDeg = K.rss(phiDiffCalRad * K.DEG, injDeg, driftResidDeg);

    /* ---------------- M5: loss ----------------
       A link budget and the gain that compensates it are set by the WORST
       path, not the average one — the tile at the end of the longest run is
       the one that has to close. The split and transition counts here were
       already worst-case (net.maxLevel, nTrans), so pairing them with a MEAN
       line length was mixing conventions inside one sum: on the daisy chain
       the mean path is 43.6 cm against a worst of 76.2, and the reported
       25.7 dB of line loss was 19.2 dB short of the 44.9 dB the last tile in
       the chain actually sees. Both are kept and both are reported. */
    var lineLossDb = lo.pathMaxCm * alpha;
    var lineLossMeanDb = lo.pathMeanCm * alpha;
    var splitLossDb = 0;
    if (lo.kind === 'tree') {
      /* A low-frequency reference tree is fanned out with ACTIVE CML/LVDS
         buffers, not passive splitters, so it pays no 3 dB per level — the
         cost shows up as buffer power instead. Charging it passive split
         loss would be double-counting. */
      if (!trL.activeFanout) {
        splitLossDb = lo.net.maxLevel * (3.01 + trL.splitExcessDb);
      }
    } else {
      splitLossDb = lo.maxHop * 1.2;                    /* per-hop tap loss */
    }
    var transLossDb = nTrans * trL.transLossDb;
    var lossTotalDb = lineLossDb + splitLossDb + transLossDb;
    var lossMeanDb = lineLossMeanDb + splitLossDb + transLossDb;
    var lossPerCmDb = alpha;
    /* requiredGainDb is lossTotalDb — the same number, because the gain the
       network must CONTAIN is exactly the loss it has. That identity is fine;
       what was not fine is presenting it as a second ranked row, where it
       read as an independent metric and was scored as one. The table now
       carries it as a caption on Total loss instead, and reports where that
       gain already sits: gainInPlaceDb is what the repeaters and per-hop
       buffers the topology has already drawn supply, so the reader can see
       that A2's 64.3 dB is not 64.3 dB of missing amplifier.

       Note the chain: daisy() resets its loss budget at every tile because
       each tap is buffered, so its lossTotalDb is a CUMULATIVE figure no
       single span ever sees. maxSpanLossDb is the honest per-span number and
       is bounded by maxSegLossDb by construction. */
    var requiredGainDb = lossTotalDb;
    var gainInPlaceDb = lo.kind === 'chain'
      ? (lo.maxHop || 0) * 1.2 + (lo.maxRepeatersInPath || 0) * g.maxSegLossDb
      : (lo.maxRepeatersInPath || 0) * g.maxSegLossDb;
    var maxSpanLossDb = Math.min(lossTotalDb, g.maxSegLossDb);

    /* ---------------- M6: power ---------------- */
    var powerTotalMw = 0, areaPerTileMm2 = 0;
    (lo.bom || []).forEach(function (b) {
      var blk = BLOCKS[b.blockKey];
      if (!blk) return;
      powerTotalMw += blk.powerMw * b.count;
      areaPerTileMm2 += (blk.areaMm2 || 0) * b.count / nT;
    });
    /* the reference oscillator's own power follows the selected preset */
    var refSrc = REF_SOURCES[Math.round(g.refSel)];
    if (trL.perTileSource && refSrc) powerTotalMw += refSrc.powerMw - BLOCKS.refSource.powerMw;
    var powerPerTileMw = powerTotalMw / nT;
    var powerFracOfArray = powerTotalMw / (g.arrayPowerW * 1000);

    /* ---------------- beam consequences ---------------- */
    var sigRad = interTileResidualDeg / K.DEG;
    var gainLossDb = K.ruzeLossDb(sigRad);
    var sllDb = K.rmsSllDb(sigRad, nT);
    var pointingErrDeg = lo.kind === 'chain'
      ? K.pointingFromWalkDeg(interTileResidualDeg / Math.sqrt(Math.max(lo.maxHop, 1)), lo.maxHop, (g.effApertureM || g.apertureM), g.lambdaM, g.scanDegMax)
      : K.pointingFromRandomDeg(interTileResidualDeg, nT, (g.effApertureM || g.apertureM), g.lambdaM, g.scanDegMax);
    var evmPct = K.evmPctFromPhi(phiArrRad);
    var evmDbVal = K.evmDbFromPhi(phiArrRad);
    var maxQamStr = K.maxQamFromDb(evmDbVal, g.evmShare);

    /* ---------------- calibration burden (physical counts) ---------------- */
    var nMeasLo = lo.kind === 'chain' ? (nT - lo.chains) : (nT - 1);
    var condG = lo.kind === 'chain' ? K.walkRmsFactor(Math.max(lo.maxHop, 2)) : Math.sqrt(Math.max(lo.net.maxLevel, 1));
    var bootAnchors = lo.tileMultiplier > 1 ? nT : 0;   /* 360/M lock ambiguity */
    var calBurdenScore = nMeasLo;
    var calBurdenDetail = nMeasLo + ' LO measurements per array pass, conditioning G = ' + condG.toFixed(2) +
      (bootAnchors ? ', plus ' + bootAnchors + ' absolute anchors at every power-up (the ×' + lo.tileMultiplier +
        ' lock ambiguity is ' + (360 / lo.tileMultiplier).toFixed(0) + '° and is invisible at the distribution frequency)' : '');

    /* ---------------- per-tile map values ---------------- */
    /* Per-tile map values. Deliberately NOT "phase error in degrees" from the
       geometric path deviation: that is a static, calibratable offset of many
       full wraps, and colouring tiles by it would repeat exactly the mistake
       the aggregate metrics were corrected for. Instead: the offset expressed
       as the number of wraps calibration must resolve, and separately the
       thermal drift, which is the part that actually survives. */
    /* Every per-tile value here has to be built from the SAME terms as the
       aggregate it sits next to, or the map and the table describe different
       builds. Three ways that went wrong and are fixed:

         - the split term ignored trL.activeFanout, so A1 — whose aggregate
           loss is 0.97 dB because a buffered reference tree pays no passive
           split loss — was drawn at 17.0 to 20.3 dB per tile;
         - the transition loss in the aggregate was missing here entirely;
         - the repeater power was added on top of powerPerTileMw, which is
           powerTotalMw/nT and already contains every repeater in the BOM.
           The tiles summed to 21.6 W against a 16.7 W total on A4, and to
           31.3 W against 16.2 W on A2.

       Repeater power still has to VARY across tiles or the fill is flat, so
       it is redistributed: each tile carries the array's repeater power in
       proportion to the repeaters in its own path, and the total is
       preserved by construction. */
    var ampMw = (BLOCKS[trL.ampBlockKey] || BLOCKS.loAmpMid).powerMw;
    var repsTotal = grid.tiles.reduce(function (a, t) { return a + (t.repeaters || 0); }, 0);
    var repPoolMw = Math.min(lo.repeaters * ampMw, powerTotalMw);
    var basePerTileMw = (powerTotalMw - repPoolMw) / nT;
    grid.tiles.forEach(function (t) {
      var dev = (t.pathCm - lo.pathMeanCm) * psPerCm;
      var splitDb = lo.kind === 'tree'
        ? (trL.activeFanout ? 0 : t.level * (3.01 + trL.splitExcessDb))
        : t.hop * 1.2;
      /* transitions in THIS tile's path: source and tile for a tree, one per
         hop along a chain — the same convention nTrans uses for the total */
      var transDb = (lo.kind === 'chain' ? Math.max(1, t.hop) : 2) * trL.transLossDb;
      t.m = {
        lossDb: t.pathCm * alpha + splitDb + transDb,
        skewPs: dev,
        wraps: Math.abs(dev) * degPs / 360,
        driftDeg: t.pathCm * psPerCm * g.tcPpmPerK * 1e-6 * g.dTTileK * degPs,
        powerMw: basePerTileMw + (repsTotal > 0
          ? repPoolMw * (t.repeaters || 0) / repsTotal
          : repPoolMw / nT)
      };
    });

    /* feasibility flags — from the option's own verdict() in LO_TRAITS, so
       an option added later cannot fall through to another one's */
    var verdict = trL.verdict({ g: g, lossTotalDb: lossTotalDb, lo: lo, nT: nT });
    var feasibility = verdict.feasibility;
    var riskLevel = verdict.risk;

    return {
      id: id, topo: topo, grid: grid, nTiles: nT,
      pnCurve: pnCurve, pnDiffCurve: pnDiffCurve, pnArrayCurve: pnArrayCurve, pnAtOffsets: pnAtOffsets,
      phiRmsDeg: phiRmsDeg, phiArrayDeg: phiArrRad * K.DEG, jitterFs: jitterFs,
      interTileRawDeg: interTileRawDeg, interTileResidualDeg: interTileResidualDeg,
      pnDiffRawDeg: phiDiffRawRad * K.DEG, pnDiffCalDeg: phiDiffCalRad * K.DEG,
      injDeg: injDeg, driftResidDeg: driftResidDeg, quantDeg: quantDeg,
      reciprocityDeg: reciprocityDeg, couplerBiasDeg: couplerBiasDeg,
      selfCorrecting: linkTracksDrift,
      lockOffsetDeg: lockOffsetDeg, lockOffsetDriftDeg: lockOffsetDriftDeg,
      skewRmsPs: skewRmsPs, skewPeakPs: skewPeakPs, skewSystematicPs: skewStaticPs,
      skewRandomPs: skewRandomPs, skewDeg78: skewDeg78,
      pathImbalancePs: pathImbalancePs, pathImbalanceWraps: pathImbalanceWraps,
      dkSkewPs: dkPs, psPerCm: psPerCm, etchSkewPs: etchPs, transSkewPs: transPs,
      staticUnknownPs: staticUnknownPs, skewDriftPs: skewDriftPs,
      correctionRangeDeg: correctionRangeDeg,
      correctionWraps: correctionRangeDeg / 360,
      lossTotalDb: lossTotalDb, lossMeanDb: lossMeanDb,
      lossPerCmDb: lossPerCmDb, requiredGainDb: requiredGainDb,
      gainInPlaceDb: gainInPlaceDb, maxSpanLossDb: maxSpanLossDb,
      lineLossDb: lineLossDb, lineLossMeanDb: lineLossMeanDb, splitLossDb: splitLossDb,
      powerTotalMw: powerTotalMw, powerPerTileMw: powerPerTileMw, powerFracOfArray: powerFracOfArray * 100,
      areaPerTileMm2: areaPerTileMm2,
      calBurdenScore: calBurdenScore, calBurdenDetail: calBurdenDetail,
      driftDegPerK: driftDegPerK, driftTotalDeg: driftTotalDeg,
      gainLossDb: gainLossDb, sllDb: sllDb, pointingErrDeg: pointingErrDeg,
      evmPct: evmPct, evmDb: evmDbVal, maxQam: maxQamStr,
      feasibility: feasibility, riskLevel: riskLevel,
      distFreqGHz: lo.distFreqHz / 1e9, tileMultiplier: lo.tileMultiplier,
      pathMeanCm: lo.pathMeanCm, pathMaxCm: lo.pathMaxCm, totalRoutedCm: lo.totalRoutedCm,
      repeaters: lo.repeaters, splitCount: lo.splitCount,
      fCalHz: fCal, note: lo.note, bom: lo.bom
    };
  }

  /* ===================================================================== *
   * Evaluate one baseband option.
   * Deliberately does NOT populate M1/M2: the baseband network sits after
   * the mixer and contributes zero phase noise at the carrier.
   * =================================================================== */
  function evalBb(id, g) {
    var trB = bbTraitsOf(id);
    var gg = {};
    for (var k in g) gg[k] = g[k];
    gg.bbOption = BB_IDS.indexOf(id);
    gg.bbOptionId = id;
    var bb = window.Topo.buildBb(id, gg);
    var nCh = bb.nCh, levels = bb.levels;
    var side = g.tileCols || Math.max(1, Math.floor(g.apertureCm / g.tileCm + 1e-9));
    var nT = side * side;
    /* The INTER-TILE tier — the network the hardware map draws from tiles to
       the RFSoC. Built from the same generator, so the path lengths below are
       the ones on the map. */
    var grid2 = window.Topo.makeGrid(gg);
    var inter = window.Topo.bbNet(grid2, gg);
    var psPerCmBb = K.lineDelayPsCm('stripline');
    /* Geometric skew of the inter-tile tier: for a star the arms are grossly
       unequal, for an H-tree nominally equal, for a bus a monotonic ramp.

       Crucially this is a GROUP-DELAY error, so unlike an LO phase offset a
       phase calibration cannot remove it — but the architecture already has a
       per-tile coarse true-time-delay element, and compensating inter-tile
       delay is exactly what it is for. So the residual is the TTD's own
       quantisation, plus whatever exceeds its range. That reframes the
       comparison: the H-tree's advantage is not that it alone is correctable,
       it is that it needs far less TTD range and leaves less to correct. */
    var interGeoRawPs = inter.pathRmsSpreadCm * psPerCmBb;
    var ttdRangePs = K.apertureDelayPs((g.effApertureM || g.apertureM), g.scanDegMax);
    var ttdQuantPs = K.quantResidualPs(g.ttdStepPs);
    var interUncompPs = Math.max(0, interGeoRawPs - ttdRangePs);
    var interGeoPs = K.rss(ttdQuantPs, interUncompPs);
    var interLossDb = inter.pathMeanCm * K.lineAlphaDbCm('stripline', g.bbEdgeHz);

    /* ---- loss / gain ---- */
    var lossTotalDb, nfPenaltyDb, requiredGainDb;
    if (id === 'passive-50') {
      /* at baseband a matched resistive star's S21 is a VOLTAGE ratio of
         1/N, so its insertion loss is 20log10(N) — but the coherent array
         gain of +10log10(N) offsets half of it. Never double-count. */
      lossTotalDb = K.resistiveSplitLossDb(nCh) - 10 * Math.log10(nCh);
      var fPost = K.db2lin(10);
      nfPenaltyDb = 10 * Math.log10(1 + (K.db2lin(lossTotalDb) * fPost - 1) / K.db2lin(g.rficGainDb));
      requiredGainDb = lossTotalDb + 10;
    } else if (id === 'bb-daisy') {
      lossTotalDb = nCh * 0.4;
      nfPenaltyDb = 10 * Math.log10(1 + (K.db2lin(lossTotalDb) * K.db2lin(10) - 1) / K.db2lin(g.rficGainDb));
      requiredGainDb = lossTotalDb + 6;
    } else if (id === 'current-mode') {
      /* Channels drive CURRENT into a virtual ground, so there is no
         voltage division to lose: coherent transfer is 0 dB, exactly as for
         the active tree, but in ONE stage rather than ceil(log2 N). The
         noise penalty is the TIA's own input-referred noise seen behind the
         RFIC gain — a single stage, so no tree accumulation. */
      lossTotalDb = 0;
      nfPenaltyDb = 10 * Math.log10(1 + K.db2lin(-g.rficGainDb) * 2);
      requiredGainDb = 0;
    } else if (id === 'digital-tile') {
      /* There is no analog inter-tile path at all: the tile combines,
         digitises and sends bits. Insertion loss is not a meaningful
         quantity, and the noise penalty is the converter's, set by its
         effective resolution against the signal already amplified by the
         RFIC and the tile's own combining. */
      lossTotalDb = 0;
      var adcSnrDb = 6.02 * g.adcBits + 1.76;
      nfPenaltyDb = Math.max(0, 10 * Math.log10(1 + K.db2lin(-(g.rficGainDb + adcSnrDb - 30))));
      requiredGainDb = 0;
    } else {
      lossTotalDb = 0;
      nfPenaltyDb = K.treeNoisePenaltyDb(nCh, levels, K.db2lin(-g.rficGainDb / 2));
      requiredGainDb = 0;
    }
    /* the inter-tile run is real line loss on top of the network's own */
    /* no analog inter-tile run in the digital option, so no line loss on it */
    if (!trB.digital) {
      lossTotalDb += interLossDb;
      requiredGainDb += interLossDb;
    }

    /* ---- skew: a GROUP-DELAY error at the baseband edge, never a
            78 GHz phase error ---- */
    var skewRmsPs, skewSystematicPs, hops;
    if (id === 'bb-daisy') {
      hops = nCh;
      skewSystematicPs = g.bbCellSkewPs * nCh / 2;            /* the ramp */
      skewRmsPs = g.bbCellSkewPs * Math.sqrt(nCh) * K.walkRmsFactor(nCh) / Math.sqrt(nCh);
      skewRmsPs = K.rss(g.bbCellSkewPs * Math.sqrt(nCh), 0);
    } else if (id === 'h-tree-active') {
      hops = levels;
      skewSystematicPs = 0;
      skewRmsPs = g.bbCellSkewPs * Math.sqrt(levels);
    } else if (id === 'current-mode') {
      /* one stage, so one cell's mismatch — no sqrt(levels) accumulation */
      hops = 1;
      skewSystematicPs = 0;
      skewRmsPs = g.bbCellSkewPs;
    } else if (id === 'digital-tile') {
      /* The analog inter-tile skew budget does not exist. What replaces it
         is lane-to-lane alignment, which is DETERMINISTIC: JESD204C/SYSREF
         aligns to a sample clock, so the residual is the sampling aperture
         and the SYSREF distribution skew, not a routed path length. That is
         a genuinely better number and it is why this option exists — the
         price is elsewhere, in the converter power. */
      hops = 1;
      skewSystematicPs = 0;
      skewRmsPs = 1 / (2 * Math.max(g.adcGspsPerRail, 0.1)) * 1000 / Math.sqrt(12) * 0.05;
    } else {
      hops = levels;
      skewSystematicPs = 0;
      skewRmsPs = g.bbCellSkewPs * 0.4 * Math.sqrt(levels);   /* passive: no active mismatch */
    }
    /* Intra-tile and inter-tile skew add in quadrature for the random part;
       the inter-tile geometric spread is deterministic, so it joins the
       systematic ramp rather than the random total. */
    /* B5 has no analog inter-tile path, so the routed geometric skew every
       analog option carries is simply not there — inter-tile alignment is
       deterministic-latency and is already counted above. */
    var interGeoEff = trB.digital ? 0 : interGeoPs;
    var skewIntraPs = skewRmsPs;
    skewRmsPs = K.rss(skewIntraPs, interGeoEff);
    skewSystematicPs = K.rss(skewSystematicPs, interGeoEff);

    var skewPeakPs = skewRmsPs * K.peakFactor(nCh);
    var skewEdgeDeg = K.bbSkewDegAtEdge(skewRmsPs, g.bbEdgeHz);
    var rampSteerDeg = K.bbRampSteerDeg(skewSystematicPs, g.rfBwGHz * 1e9);
    var squintLossDb = K.squintLossDb(skewRmsPs * 1e-12, g.rfBwGHz * 1e9);

    /* ---- power / area, per tile, BOTH rails ---- */
    var powerPerTileMw = 0, areaPerTileMm2 = 0;
    (bb.bom || []).forEach(function (b) {
      var blk = BLOCKS[b.blockKey];
      if (!blk) return;
      powerPerTileMw += blk.powerMw * b.count;
      areaPerTileMm2 += (blk.areaMm2 || 0) * b.count;
    });
    /* B5: the converters and the serial link dominate, and their power is
       computed from the exposed FOM parameters rather than frozen in the
       block library — the whole argument about this option turns on those
       numbers, so the reader has to be able to move them.

         P_conv = FOM · 2^bits · fs      (Walden)
         lanes  = ceil(2 rails · bits · fs / lane rate)

       Two rails, and both directions: an ADC and a DAC per rail per tile. */
    var convMw = 0, serdesMw = 0, laneGbps = 0, lanes = 0;
    if (trB.digital) {
      var fsHz = g.adcGspsPerRail * 1e9;
      var perConvMw = g.adcFomFjConv * 1e-15 * Math.pow(2, g.adcBits) * fsHz * 1e3;
      convMw = perConvMw * 4;                     /* I+Q rails x (ADC + DAC) */
      laneGbps = 2 * g.adcBits * fsHz / 1e9 * (66 / 64);   /* 64b/66b overhead, RX */
      lanes = Math.max(1, Math.ceil(laneGbps / 25));
      serdesMw = g.serdesMwPerGbps * laneGbps * 2;         /* both directions */
      powerPerTileMw += convMw + serdesMw;
    }
    var powerTotalMw = powerPerTileMw * nT;

    /* ---- PVT drift ---- */
    var driftDegPerK = trB.driftDegPerK;
    /* ---- linearity ---- */
    var iip3PenaltyDb = trB.cascadedIip3 ? K.cascadeIip3PenaltyDb(levels) : 0;
    /* ---- bandwidth ---- */
    var bwGHz = trB.bwOf ? trB.bwOf({ nCh: nCh, levels: levels, g: g }) : trB.bwGHz;
    var bbVerdict = trB.verdict({
      nCh: nCh, levels: levels, g: g,
      powerFracOfArray: powerTotalMw / (g.arrayPowerW * 1000) * 100
    });

    return {
      id: id, bb: bb, inter: inter, nCh: nCh, levels: levels, hops: hops,
      interKind: inter.kind, interDepth: inter.depth,
      interPathMeanCm: inter.pathMeanCm, interPathMaxCm: inter.pathMaxCm,
      interRoutedCm: inter.totalRoutedCm,
      interGeoRawPs: interGeoRawPs, interGeoSkewPs: interGeoPs,
      interUncompPs: interUncompPs, ttdRangeNeededPs: interGeoRawPs,
      ttdRangeAvailPs: ttdRangePs,
      /* The coarse TTD's range exists to steer the beam. Geometric skew the
         same element has to absorb is range stolen from that job. */
      ttdRangeConsumedPct: interGeoRawPs / ttdRangePs * 100,
      interLossDb: interLossDb, skewIntraPs: skewIntraPs,
      pnCurve: null, pnDiffCurve: null, pnAtOffsets: null,
      phiRmsDeg: NaN, jitterFs: NaN,
      interTileRawDeg: skewEdgeDeg, interTileResidualDeg: K.rss(skewEdgeDeg * 0.25, K.quantResidualDeg(g.phaseBits)),
      skewRmsPs: skewRmsPs, skewPeakPs: skewPeakPs, skewSystematicPs: skewSystematicPs,
      skewDeg78: NaN, skewEdgeDeg: skewEdgeDeg, rampSteerDeg: rampSteerDeg, squintLossDb: squintLossDb,
      lossTotalDb: lossTotalDb, lossPerCmDb: NaN, requiredGainDb: requiredGainDb, nfPenaltyDb: nfPenaltyDb,
      powerTotalMw: powerTotalMw, powerPerTileMw: powerPerTileMw,
      powerFracOfArray: powerTotalMw / (g.arrayPowerW * 1000) * 100,
      areaPerTileMm2: areaPerTileMm2, bwGHz: bwGHz, iip3PenaltyDb: iip3PenaltyDb,
      driftDegPerK: driftDegPerK,
      calBurdenScore: nCh, calBurdenDetail: nCh + ' per-channel baseband weights per rail; group delay must be ' +
        'measured with a two-tone or swept baseband loopback, since a single-tone phase measurement cannot ' +
        'distinguish a delay error from a phase error',
      gainLossDb: squintLossDb, sllDb: NaN, pointingErrDeg: Math.abs(rampSteerDeg), evmPct: NaN, maxQam: '—',
      feasibility: bbVerdict.feasibility,
      riskLevel: bbVerdict.risk,
      note: bb.note, bom: bb.bom
    };
  }

  /* ===================================================================== *
   * Consistency checks. Tile pitch, taps per tile and the die count are
   * independent inputs, so they can disagree without anything failing —
   * which is worse than an error. Surfaced rather than silently tolerated.
   * =================================================================== */
  function consistency(g) {
    var out = [];

    if (!g.aperturePitchExact) {
      out.push({
        severity: 'warn',
        message: 'A ' + g.tileCm.toFixed(2) + ' cm tile pitch does not divide the ' + g.apertureCm.toFixed(1) +
          ' cm panel. ' + g.tileCols + '×' + g.tileCols + ' = ' + g.nTilesTotal + ' whole tiles fit, populating ' +
          g.effApertureCm.toFixed(1) + ' cm — ' + g.apertureMarginCm.toFixed(2) + ' cm of inactive margin per side, ' +
          (100 * g.apertureFillSide).toFixed(1) + '% of the side and ' + g.apertureDirDeltaDb.toFixed(2) +
          ' dB of peak directivity. The grid is floored rather than rounded, because a rounded grid would ' +
          'overflow a hard mechanical spec and an under-filled panel is at least buildable. Beam metrics use the ' +
          'populated ' + g.effApertureCm.toFixed(1) + ' cm, since that is what radiates. For an exact fill use ' +
          g.snapCoarseCm.toFixed(2) + ' cm (same ' + g.nTilesTotal + ' tiles) or ' + g.snapFineCm.toFixed(2) +
          ' cm (' + Math.pow(g.tileCols + 1, 2) + ' tiles).'
      });
    }

    var taps = g.nTilesTotal * Math.round(g.tapsPerTile);
    if (taps > g.nDies + 0.5) {
      out.push({
        severity: 'fail',
        message: g.nTilesTotal + ' tiles × ' + Math.round(g.tapsPerTile) + ' LO taps = ' + taps +
          ' taps, but only ' + g.nDies + ' RFIC dies exist — ' + (taps / g.nDies).toFixed(2) +
          '× over the inventory. The die count is a hard limit, not a design variable. At this tile count the ' +
          'inventory allows ' + Math.floor(g.nDies / g.nTilesTotal) + ' dies per tile. Distribution power and ' +
          'the BOM scale with the tap count, so leaving this inflates M6.'
      });
    } else if (taps < g.nDies - 0.5) {
      out.push({
        severity: 'warn',
        message: g.nTilesTotal + ' tiles × ' + Math.round(g.tapsPerTile) + ' LO taps places ' + taps + ' of the ' +
          g.nDies + ' available dies, leaving ' + (g.nDies - taps) + ' spare and costing ' +
          g.diePopGainDb.toFixed(2) + ' dB of array gain against a fully populated aperture. ' +
          (g.nDies % g.nTilesTotal === 0 ? '' : 'An exact fit is not possible at this tile count: ' +
            g.nDies + ' / ' + g.nTilesTotal + ' = ' + (g.nDies / g.nTilesTotal).toFixed(2) + ' dies per tile.')
      });
    }

    if (g.tileCm > 10) out.push({
      severity: 'warn',
      message: 'A ' + g.tileCm.toFixed(1) + ' cm tile exceeds the 5–10 cm sub-tiling guidance: intra-tile residual delay is ' +
        K.apertureDelayPs(g.tileCm / 100, g.scanDegMax).toFixed(0) + ' ps at ' + g.scanDegMax +
        '° against the ~200 ps target, so phase-only steering inside the tile will not hold across the band.'
    });

    return out;
  }

  /* opts.onlySelected evaluates ONLY the selected LO and baseband option and
     skips building the map topology. The Systems view compares whole
     parameter sets, and for each one it reads exactly one LO option, one
     baseband option and no map — while a full evaluation builds all seven
     option topologies plus the map's, which at a fine tile pitch is most of
     the wall time and all of it unread. Anything that ranks the options
     (Decision.build) or draws the map needs the full evaluation and must
     not pass this. */
  function evaluate(state, opts) {
    var g = resolve(state);
    var only = !!(opts && opts.onlySelected);
    var lo = {}, bb = {};
    if (only) {
      lo[g.loOptionId] = evalLo(g.loOptionId, g);
      bb[g.bbOptionId] = evalBb(g.bbOptionId, g);
    } else {
      LO_IDS.forEach(function (id) { lo[id] = evalLo(id, g); });
      BB_IDS.forEach(function (id) { bb[id] = evalBb(id, g); });
    }
    var selected = null;
    if (!only) {
      /* the built topology for the CURRENTLY SELECTED options, for the map */
      selected = window.Topo.build(g);
      /* re-attach the per-tile metrics of the selected LO option */
      var sel = lo[g.loOptionId];
      selected.grid.tiles.forEach(function (t, i) {
        var st = sel.grid.tiles[i];
        if (st) { t.m = st.m; t.pathCm = st.pathCm; t.level = st.level; t.hop = st.hop; t.segments = st.segments; t.repeaters = st.repeaters; t.blocks = st.blocks; }
      });
    }
    return {
      g: g, lo: lo, bb: bb, selected: selected, partial: only,
      blocks: BLOCKS, refSources: REF_SOURCES, warnings: consistency(g)
    };
  }

  window.Model = {
    PARAMS: PARAMS, BLOCKS: BLOCKS, REF_SOURCES: REF_SOURCES,
    LO_IDS: LO_IDS, BB_IDS: BB_IDS, LO_META: LO_META, BB_META: BB_META,
    MEDIA_KEYS: MEDIA_KEYS,
    resolve: resolve, evaluate: evaluate, evalLo: evalLo, evalBb: evalBb,
    consistency: consistency
  };
})();
