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
    tileAdc:        { tileSingleton: true, name: 'Tile ADC, per rail', tech: '65nm LP CMOS', freqGHz: 1, powerMw: 0, gainDb: 0, areaMm2: 0.9, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'scaled-estimate', why: 'B5 only. Power is NOT taken from here — it is computed as FOM · 2^bits · fs from the adcFomFjConv, adcBits and adcGspsPerRail parameters, so the reader can move the assumption that decides the option. The area is the fixed cost: ~0.9 mm² for a 2–3 GS/s pipelined or time-interleaved SAR in a mature node, which is most of a tile die.' },
    tileDac:        { tileSingleton: true, name: 'Tile DAC, per rail', tech: '65nm LP CMOS', freqGHz: 1, powerMw: 0, gainDb: 0, areaMm2: 0.6, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'scaled-estimate', why: 'B5 only, TX direction. Same treatment as the ADC: power from the FOM parameters, area fixed here.' },
    tileSerdes:     { tileSingleton: true, name: 'SerDes lane to the backend', tech: '65nm LP CMOS', freqGHz: 25, powerMw: 0, gainDb: 0, areaMm2: 0.35, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'published-literature', why: 'B5 only. Power computed from serdesMwPerGbps × the lane rate the converters demand. A 25 Gb/s JESD204C/GTY-class lane is routine in a mature node but is a serious addition to a tile that today carries only analog IQ.' },
    tiaSum:         { tileSingleton: true, name: 'Virtual-ground summing TIA', tech: '65nm LP CMOS', freqGHz: 1, powerMw: 28, gainDb: 0, areaMm2: 0.035, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'scaled-estimate', why: 'B4 only. ONE transimpedance amplifier per rail per tile holding the summing node at a virtual ground, replacing the N−1 cell cascade of B3. Higher power than a single H-tree cell (18 mW) because it must hold a low impedance against the whole summing-node capacitance, but there is one of it instead of fifteen.' },
    loSplit78:      { name: 'E-band 1:2 splitter', tech: 'RO3003 GCPW, on board', freqGHz: 78, powerMw: 0, gainDb: -3.5, areaMm2: 0.96, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'published-literature', why: 'A PCB Wilkinson at 78 GHz is 0.8 dB better than on-chip, but every junction adds a mechanical discontinuity and an unrepeatable phase offset.' },
    loAmp78:        { name: 'E-band repeater amplifier', tech: 'SiGe BiCMOS', freqGHz: 78, powerMw: 45, gainDb: 12, areaMm2: 0.08, addPnFloorDbc: -152, addPnCornerHz: 2e5, conf: 'published-literature', why: 'Gain stage needed every few centimetres of E-band line. Each one is a separate SiGe die on the board — it cannot live in the 65nm tile.' },
    ebandTransition:{ name: 'E-band board/package transition', tech: 'packaging', freqGHz: 78, powerMw: 0, gainDb: -0.9, areaMm2: 0, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'engineering-guess', why: 'Each E-band transition costs loss and, worse, an unrepeatable phase offset.' },

    /* --- the radiator, and the fixed feed behind it (family C) ---
       Every antenna block draws ZERO power. That is the finding, not an
       omission: a passive radiator and a fixed corporate feed add no
       supply current at all, so the antenna family is the only one of the
       three whose options cannot be separated on the array power budget. */
    antPatch:       { name: 'Package radiating patch', tech: 'organic AiP top metal', freqGHz: 78, powerMw: 0, gainDb: 0, areaMm2: 6.7, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'engineering-guess', why: 'One λ/2-class patch on the antenna layers of the RFIC package. 6.7 mm² is the physical footprint including the ground clearance, against 4.68 mm² of effective area at 6 dBi — a patch is a poor filler of its own cell even before the cell is 225 mm².' },
    antPatchBoard:  { name: 'Wideband radiator on antenna board', tech: 'separate low-loss laminate', freqGHz: 78, powerMw: 0, gainDb: 0, areaMm2: 14.8, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'engineering-guess', why: 'C4 only. A stacked patch, cavity-backed patch or magneto-electric dipole of roughly one wavelength, on hardware this thesis does not design. 14.8 mm² is λ² at 78 GHz. It reaches 71–86 GHz in one radiator, which no single-layer package patch does.' },
    antFeedSplit:   { name: 'In-cell corporate split junction', tech: 'package microstrip', freqGHz: 78, powerMw: 0, gainDb: -0.3, areaMm2: 0.12, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'scaled-estimate', why: 'Excess loss above the ideal 3.01 dB division, per binary stage of the fixed tree behind one port. Anchored to loSplit78, which books −3.5 dB against an ideal −3.0. Without this term a cell-filling cluster looks free, which is the exact error the honesty ledger records the first pattern model making.' },

    radialLauncher: { name: 'Radial line centre launcher', tech: 'RO3003 parallel-plate / radial line', freqGHz: 19.5, powerMw: 0, gainDb: -1.2, areaMm2: 4.0, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'engineering-guess', why: 'A7 only. The ONE division point: a probe launching into a radial or parallel-plate region that divides to all tiles at once. −1.2 dB is the excess above the ideal 10log10(N), which is where a radial divider is usually quoted; a cascaded tree pays its excess once per level instead. It has no isolation resistors, and that is the architecture\'s weakness rather than an oversight.' },
    radialProbe:    { name: 'Radial line tile probe', tech: 'in-board probe', freqGHz: 19.5, powerMw: 0, gainDb: -0.25, areaMm2: 0.3, addPnFloorDbc: 0, addPnCornerHz: 0, conf: 'engineering-guess', why: 'A7 only. One coupling probe per tile off the radial region, all at the same radius. Replaces the cascade of 1:2 junctions a tree needs, so the count is N rather than N−1 junctions in a binary cascade — but they are all in parallel rather than in series, which is the point.' },

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
    bbRootAmp:      { tileSingleton: true, name: 'Baseband root amplifier', tech: '65nm LP CMOS', freqGHz: 1, powerMw: 25, gainDb: 18, areaMm2: 0.02, nfDb: 10, conf: 'scaled-estimate', why: 'Recovers the passive network loss and drives the RFSoC ADC input.' },
    bbTap:          { name: 'Baseband bus tap', tech: '65nm LP CMOS', freqGHz: 1, powerMw: 2, gainDb: -0.4, areaMm2: 0.002, conf: 'scaled-estimate', why: 'Its input capacitance is what collapses the daisy chain’s bandwidth as N grows.' },
    bbTxDriver:     { tileSingleton: true, name: 'Baseband TX-direction driver', tech: '65nm LP CMOS', freqGHz: 1, powerMw: 60, gainDb: 12, areaMm2: 0.03, conf: 'scaled-estimate', why: 'One driver fighting the whole tree plus N pad capacitances. The passive network’s hidden cost.' },
    bbDecap:        { tileSingleton: true, name: 'Supply decoupling', tech: '65nm MOM/MOS cap', freqGHz: 0, powerMw: 0, gainDb: 0, areaMm2: 0.27, conf: 'scaled-estimate', why: 'Sized for the active cells’ current ripple. Usually the real area cost, not the cells.' }
  };

  /* ===================================================================== *
   * Global parameters
   * =================================================================== */
  /* The parameters that actually move the answer, so the panel can offer a
     "key only" filter over seventy controls. The rule is auditable rather
     than a matter of taste: a parameter is hot if it has its own sweep panel
     in renderSweeps, if it is an input to the derived requirement in
     budget.js, or if it is one of the terms that dominates the inter-tile
     residual. Nothing here is a judgement about which parameter is
     interesting — only about which one changes a number someone quotes. */
  var HOT_PARAMS = [
    /* swept in their own panel */
    'midM', 'pllLoopBwMHz', 'fBistHz', 'tileCm', 'lenTolUm', 'apertureCm',
    /* inputs to the derived requirement */
    'fLoGHz', 'rfBwGHz', 'scanDegMax', 'evmShare', 'arrayPowerW', 'specPhaseDeg',
    /* dominant terms in the residual, the loss and the drift */
    'calLoopGain', 'bistNoiseDeg', 'phaseBits', 'dTTileK', 'tcPpmPerK',
    'dkTolPct', 'loMedium', 'maxSegLossDb',
    /* the three architecture selectors and the reference preset */
    'loOption', 'bbOption', 'antOption', 'refSel',
    /* the one antenna knob that moves the 16.8 dB element/cell gap */
    'radPerCh'
  ];

  var PARAMS = [
    /* --- array & band --- */
    { key: 'fLoGHz', label: 'LO frequency', units: 'GHz', value: 78, min: 60, max: 95, step: 0.5, group: 'Array & band',
      conf: 'measured/datasheet', why: 'RFIC characterised with a 78 GHz LO; the band is 71–86 GHz. The proposal’s own modelling text uses 75 GHz.' },
    { key: 'rfBwGHz', label: 'RF bandwidth', units: 'GHz', value: 2, min: 0.1, max: 5, step: 0.1, group: 'Array & band',
      conf: 'measured/datasheet', why: '≈2 GHz class per the RFIC front-end table.' },
    { key: 'apertureCm', label: 'Aperture width', units: 'cm', value: 30, min: 6, max: 60, step: 1, group: 'Array & band',
      conf: 'measured/datasheet', why: '30 × 30 cm array class from the proposal. This is D in the beamwidth 0.886·λ/D, and it is a hard system spec — the tile pitch is the design choice that has to fit inside it.' },
    { key: 'tileCm', label: 'Tile pitch', units: 'cm', value: 6, min: 0.25, max: 15, step: 0.25, group: 'Array & band',
      conf: 'published-literature', why: 'Centre-to-centre tile spacing; with abutting square tiles it equals the tile edge. "Pitch" rather than "side" or "size" because a spacing is what the grid is built from, and "size" for a 2-D module reads as an area. The default is the pitch that is OPTIMAL FOR THE 30 cm APERTURE, not a round number: 6 cm divides 30 exactly (5×5 = 25 tiles filling the whole aperture), sits inside the proposal\'s own 5–10 cm sub-tiling range (§4.5), and gives 173 ps of residual intra-tile delay at 60° against the ~200 ps target. The earlier 4 cm default is BELOW that range and does not divide 30 cm: it fits 7×7 = 49 tiles across 28 cm and throws away the outer 2 cm in each direction.' },
    { key: 'nDies', label: 'RFIC dies in the array', units: '-', value: 100, min: 4, max: 4000, step: 1, group: 'Array & band',
      conf: 'measured/datasheet', why: '≈100 existing 2.5 × 2.5 mm E-band dies. Tile pitch, taps per tile and this total are independent inputs that can disagree, so the tool checks them against each other rather than letting the mismatch pass silently.' },
    { key: 'tapsPerTile', label: 'LO taps per tile', units: '-', value: 4, min: 1, max: 32, step: 1, group: 'Array & band',
      conf: 'scaled-estimate', why: 'One LO tap per RFIC die. At the 6 cm pitch 5×5 = 25 tiles fit and the 100-die inventory divides exactly: 25 × 4 = 100 placed, none stranded, no die-population gain loss. Four dies lay out as a 2×2 quad on one matched 1:4 split. At the earlier 4 cm pitch it was floor(100/49) = 2 dies per tile — 98 placed, 2 spare, costing 10log10(98/100) = −0.09 dB.' },
    { key: 'bbIqChPerDie', label: 'IQ channels per baseband die', units: '-', value: 4, min: 1, max: 16, step: 1, group: 'Array & band',
      conf: 'measured/datasheet', why: 'THE BASEBAND PAIRING, and it REPLACES the old free "BB channels per tile" slider. One baseband die per RFIC die — 1:1, structural, not a coincidence to be checked afterwards — and the baseband die carries this many IQ channels against the RFIC die\'s 4 real RF channels per direction. At the default the two match exactly: 4 IQ channels serve 4 RF channels, so channels per tile is 4 dies × 4 = 16 and is DERIVED, never entered. The old slider let 32 be typed against a geometry that could only support 16, and nothing complained. Note what 1:1 forces: 4 IQ channels cannot serve 4 RX AND 4 TX simultaneously, so the array is half-duplex — which is the same assumption the antenna family already made by defaulting to shared radiators behind a T/R switch, now finally stated in the baseband too. Raising this above 4 does not break the pairing, but it packs more channels into the same 2.5 × 2.5 mm, and the die-utilisation check is what tells you whether they fit.' },
    { key: 'bbDieMm', label: 'Baseband die edge', units: 'mm', value: 2.5, min: 1, max: 6, step: 0.1, group: 'Baseband',
      conf: 'measured/datasheet', why: 'The square baseband die in TSMC 65 nm LP, matching the RFIC die it pairs with. 2.5 × 2.5 mm = 6.25 mm² is what is realistic in this process for 4 IQ channels, which sets the area budget every baseband option has to fit: 4 dies × 6.25 = 25 mm² per tile. This is the constraint the tool previously did not book at all — areaPerTileMm2 was computed, displayed with better:"low", and compared against nothing.' },
    { key: 'bbDieUtilMaxPct', label: 'Max baseband die utilisation', units: '%', value: 70, min: 30, max: 100, step: 5, group: 'Baseband',
      conf: 'engineering-guess', why: 'Core utilisation a mixed-signal die can actually reach once the pad ring, seal ring, routing channels and power grid are placed. 70% is already aggressive for a die carrying high-speed I/O; digital-only standard-cell blocks reach higher, and a converter-heavy floorplan reaches less. It is a guess, and it is the number that decides whether B5 survives the pairing — move it and watch.' },
    { key: 'scanDegMax', label: 'Max scan angle', units: 'deg', value: 60, min: 0, max: 75, step: 5, group: 'Array & band',
      conf: 'published-literature', why: 'The proposal evaluates squint at 60°, where it exceeds the beamwidth.' },
    { key: 'elemDirDbi', label: 'UNIT radiator directivity', units: 'dBi', value: 6, min: 0, max: 12, step: 0.5, group: 'Array & band',
      conf: 'published-literature', why: 'The directivity of ONE radiator — which the antenna arrangement (family C) then multiplies. It is no longer the element directivity the array sees: at K radiators per port the port sees D_el, derived by integrating the subarray pattern, and only at K = 1 are the two the same number. 6 dBi is an isolated E-band package patch, i.e. cos^0.99 by D = 2(n+1) — NOT "roughly cos^2", which this text used to say and which would be 7.78 dBi. Note 6 dBi legitimately exceeds the 4.97 dBi that a λ/2 cell can hold, because an isolated patch is not truncated by neighbours; that surplus is exactly why K close-packed radiators fall about 1.03 dB short of 6 + 10log10(K).' },
    { key: 'latticePeriodic', label: 'Element lattice', units: '', value: 1, group: 'Array & band',
      choices: [{ value: 1, label: 'Periodic — grating lobes' }, { value: 0, label: 'Aperiodic / thinned' }],
      conf: 'engineering-guess', why: 'A periodic lattice coarser than λ/2 has discrete grating lobes; deliberately breaking the periodicity trades them for a raised, roughly uniform sidelobe floor near 1/N. Which one applies is a layout decision that has not been made yet, and the two look completely different on the pattern.' },
    { key: 'inTileLattice', label: 'In-tile lattice', units: '', value: 0, group: 'Array & band',
      choices: [{ value: 0, label: 'Rectangular (as drawn)' }, { value: 1, label: 'Best sublattice' }, { value: 2, label: 'Single row' }],
      conf: 'engineering-guess', why: '"N elements per tile" does not force one arrangement: every sublattice of index N that contains the tile lattice keeps all tiles identical, and they differ in where the worst grating lobe lands and in minimum element separation. AT THE DEFAULT GEOMETRY THIS CHOICE IS MOOT — 16 elements in a 6 cm tile lay out 4×4 on a square 1.5 cm lattice, which is simultaneously the rectangular arrangement and the best sublattice available. It mattered at the old 4 cm / 8-element tile, where the rectangular 4×2 was the WORST of the sensible options (worst lobe 11.08° against 15.77° for the sheared a1=(1,−1), a2=(0,2) cm, and 1.00 cm minimum separation against 1.41). The lobe count never changes: that is fixed by density alone.' },
    { key: 'elemModelSel', label: 'Unit radiator pattern model', units: '', value: 0, group: 'Array & band',
      choices: [{ value: 0, label: 'Directivity-matched cos^n' }, { value: 1, label: 'HPBW-matched patch' }],
      conf: 'engineering-guess', why: 'Describes the UNIT radiator only; the arrangement on top of it is family C. One cos^n curve cannot be both a 6 dBi directivity-matched element (n = 0.99, 120° HPBW, only 3 dB of scan loss at 60°) and a real package patch (65–80° HPBW, n ≈ 3.5, 10 dB at 60°). Using the broad one for grating-lobe suppression AND for scan loss is pessimistic about the lobe and optimistic about the scan with the same curve, which is not a defensible pair. A third choice, "Cell-filling nulled", was RETIRED: C3 at K = 64 in span mode is the same antenna built from discrete radiators, reaches the same 22.82 dBi ceiling, and unlike the retired one never asserts a directivity its own pattern disagrees with — it integrated to 23.04 dBi against the 22.82 it reported. A saved system that used it is migrated to that C3 setting rather than silently snapped to a neighbouring choice.' },
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
        { value: 5, label: 'A6 · Injection-locked tile oscillator' },
        { value: 6, label: 'A7 · Radial equal-path feed' }
      ], conf: 'measured/datasheet', why: 'A1–A4 are the candidates from the proposal. A5 and A6 were added after a survey of the wider design space: A5 is the only architecture with a return path INSIDE the distribution network, so it attacks the drift term rather than tracking it, and A6 is the only one whose tile carries no PFD, charge pump or divider at all. This selects what the map draws.' },
    { key: 'portVswr', label: 'Tile port VSWR (A7)', units: ':1', value: 1.5, min: 1.0, max: 3.0, step: 0.05, group: 'LO architecture',
      conf: 'engineering-guess', why: 'A7 only. A radial junction has no isolation resistors, so a reflection from one tile port is redistributed to all the others as a LOAD-DEPENDENT phase error. This is the architecture\'s own weakness and the reason it is a trade rather than a free win: unlike thermal drift it is not tracked, and unlike a static offset it is not calibratable, because it changes whenever a neighbour\'s match changes or a die powers down. 1.5:1 is an ordinary in-band match; 1.0 switches the term off and is the idealisation, not the expectation.' },
    { key: 'radialExcessDb', label: 'Radial junction excess (A7)', units: 'dB', value: 1.2, min: 0, max: 4, step: 0.1, group: 'LO architecture',
      conf: 'engineering-guess', why: 'A7 only. Loss above the ideal 10log10(N) that power conservation demands of ANY divider. A cascaded tree pays its excess once per level; a radial junction pays it once in total. That is the real saving, and it is small — a few tenths of a dB — because both are floored by the same 10log10(N). The reason to build A7 is the path spread, not the split loss.' },
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

    /* --- antenna (family C) ---
       What sits behind ONE fixed RF port. The die is taped out with 4 real
       RF channels per direction, so the PORT count is not a choice and this
       whole family moves only the element pattern, its directivity and the
       cell fill. It cannot move the grating lobes: lobe-free scan to 60°
       needs 0.536λ = 2.06 mm of PORT pitch against the actual 15 mm, and
       only more dies do that. */
    { key: 'antOption', label: 'Antenna arrangement per channel', units: '', value: 0, group: 'Antenna',
      choices: [{ value: 0, label: 'C1 · 1× patch per channel' }, { value: 1, label: 'C2 · 1×K cross-scan column' },
                { value: 2, label: 'C3 · Kx×Ky cluster' }, { value: 3, label: 'C4 · Wideband board radiator' }],
      conf: 'engineering-guess', why: 'Which radiator, and how many of them, sit behind one fixed RF port. Neither source document specifies the radiator: "patch" appears once in the proposal, describing how other people package RFICs, and never in the deck — so the 4-per-die baseline is the RFIC channel count, not a stated antenna count. The deck DOES propose the hierarchy this family implements ("RFIC → subarray → full aperture … 100 IC instead of 1000-10000, in tradeoff of beamwidth"), and until now the tool collapsed the subarray layer to one radiator per port. Selecting an option changes the element pattern and nothing else.' },
    { key: 'radPerCh', label: 'Radiators per RF channel (K)', units: '-', value: 1, group: 'Antenna',
      choices: [{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 4, label: '4' }, { value: 8, label: '8' },
                { value: 9, label: '9' }, { value: 16, label: '16' }, { value: 64, label: '64' }],
      conf: 'engineering-guess', why: 'K radiators fed from ONE phase shifter through a fixed corporate tree. This is the user-facing lever on the 16.8 dB element/cell gap: K raises element directivity toward the cell ceiling and adds ZERO controllable state, because the beamformer cannot see inside a cell. It never changes the port count, the lattice, the lobe positions or the lobe count. Enumerated rather than a free integer so Kx and Ky stay integral by construction; each option declares its own legal set and clamps to it, and the clamp is reported rather than silent. C1 and C4 pin K = 1.' },
    { key: 'radPitchLam', label: 'Radiator pitch inside the cell', units: 'λ', value: 0.5, min: 0.35, max: 0.99, step: 0.01, group: 'Antenna',
      conf: 'scaled-estimate', why: 'Centre-to-centre spacing of the K radiators behind one port (λ/2 = 1.92 mm). At 0.5λ you pack the most radiators per unit length, but the pattern integral saturates about 1.03 dB below the naive 6 + 10log10(K) because an isolated 6 dBi patch claims 4.68 mm² against a λ/2 cell of 3.69 mm². The 0.99 ceiling is DERIVED, not chosen: a fixed broadside subarray puts its own grating lobe into visible space at |u| = λ/p ≤ 1, i.e. at p ≥ 1.0λ, which the beam metrics would mis-report as the taper sidelobe.' },
    { key: 'radSpanPitch', label: 'Pitch mode', units: '', value: 0, group: 'Antenna',
      choices: [{ value: 0, label: 'Fixed pitch (above)' }, { value: 1, label: 'Span the cell (nulls on the lobes)' }],
      conf: 'published-literature', why: 'Span mode derives the pitch as cell/K instead of reading the pitch above, which puts the subarray nulls exactly on the reciprocal port lattice by the a_i·b_j = δ_ij duality already proved in lattice.js — so every grating lobe on that axis is nulled at broadside. It is legal only for K per axis ≥ cell/λ = 15/3.84 = 3.90, i.e. K ≥ 4: at K = 2 the derived pitch is 1.95λ and the subarray\'s own full-strength lobe lands at u = 0.51, on a grating-lobe row. The consistency check FAILS on that rather than letting it through, and the same 3.90 that names the lattice\'s coarseness is what sets the threshold.' },
    { key: 'radApEff', label: 'Radiator aperture efficiency', units: '-', value: 0.70, min: 0.40, max: 0.90, step: 0.05, group: 'Antenna',
      conf: 'engineering-guess', why: 'Used by C4 only, to DERIVE directivity from footprint instead of asserting it: D = 10log10(4π·η·(a/λ)²). The round trip is the check — at η = 0.70 the 6 dBi C1 baseline implies a 0.67λ footprint, which is a real patch. Inert for C1–C3.' },
    { key: 'radApertureLam', label: 'C4 radiator footprint', units: 'λ', value: 1.0, min: 0.6, max: 1.4, step: 0.05, group: 'Antenna',
      conf: 'engineering-guess', why: 'C4\'s one free geometric choice. D_unit = 10log10(4π·η·a²) = 9.44 dBi at the defaults. Inert for every other option.' },
    { key: 'feedSplitLossDb', label: 'Excess loss per corporate split stage', units: 'dB', value: 0.30, min: 0, max: 1.5, step: 0.05, group: 'Antenna',
      conf: 'scaled-estimate', why: 'Above the ideal 3.01 dB power division, per binary stage, for an in-package T or Wilkinson junction at 78 GHz. Anchored to the loSplit78 block, which books −3.5 dB against an ideal −3.0. A 1×4 column charges 2 stages, an 8×8 charges 6.' },
    { key: 'feedLossPerCmDb', label: 'In-cell feed line loss', units: 'dB/cm', value: 1.0, min: 0.3, max: 3.0, step: 0.1, group: 'Antenna',
      conf: 'scaled-estimate', why: 'Package microstrip or stripline at 78 GHz on low-loss organic (0.10–0.20 dB/mm; FR4-class is above 0.5 dB/mm and rules the whole family out). Multiplied by the mean corporate-tree path, DERIVED as 0.5·((Kx−1)·px + (Ky−1)·py) rather than assumed, so a larger subarray pays for its own routing. This is what stops the family concluding that bigger K always wins.' },
    { key: 'antBandReqGHz', label: 'Band the radiator must cover', units: 'GHz', value: 15, min: 2, max: 15, step: 0.5, group: 'Antenna',
      conf: 'measured/datasheet', why: '71–86 GHz is 15 GHz, 19.4% at a 78 GHz centre, and it is a hard spec in both source documents. A single-layer package patch is about 4%, i.e. 3.1 GHz. Set this to the 2 GHz instantaneous RF bandwidth instead if the link is fixed-frequency — the tool must not decide that for the reader, so it is a declared requirement rather than a hidden gate.' },
    { key: 'antTrShare', label: 'TX / RX aperture sharing', units: '', value: 0, group: 'Antenna',
      choices: [{ value: 0, label: 'Shared radiators + T/R switch per port' }, { value: 1, label: 'Separate TX and RX radiator groups' }],
      conf: 'engineering-guess', why: 'The die carries 4 RX AND 4 TX real RF channels, so the port count counts ONE direction while the baseband channel count counts both. Shared means one radiator group serves both directions through a T/R switch — which is already what the antenna-loss chain itemises, and therefore the defensible default. Separate means each direction gets half the cell, so the per-direction cell ceiling falls by 10log10(2) = 3.01 dB and the legal K halves. Nothing in this tool asked this question before, and leaving it unstated makes every element directivity 3 dB optimistic in the case nobody chose.' },

    /* --- the radio link ---
       The only group that describes something OUTSIDE the array. Nothing
       here feeds back into the distribution comparison: the link is what
       the array is FOR, and separating the two is the point. */
    { key: 'linkRangeKm', label: 'Link range', units: 'km', value: 1.0, min: 0.05, max: 10, step: 0.05, group: 'Radio link',
      conf: 'engineering-guess', why: 'Hop length. Neither source document states a target range — the proposal contrasts the concept against a 30 cm dish solution but gives no distance — so this is a declared assumption, not a requirement. E-band point-to-point links in service are typically 0.3–3 km precisely because rain sets the ceiling.' },
    { key: 'txPoutDbm', label: 'TX power per element', units: 'dBm', value: 10, min: -10, max: 25, step: 0.5, group: 'Radio link',
      conf: 'engineering-guess', why: 'Saturated output of one element\'s PA. Neither source states it. 10 dBm is a reasonable SiGe E-band per-element figure; a published 71–86 GHz SiGe PA runs 10–15 dBm P_sat. This is the single number the whole EIRP rests on, so measure it before quoting any range from this tool.' },
    { key: 'txBackoffDb', label: 'PA back-off', units: 'dB', value: 6, min: 0, max: 15, step: 0.5, group: 'Radio link',
      conf: 'scaled-estimate', why: 'Back-off from saturation for linearity. A high-order QAM waveform has a 7–9 dB PAPR, and running a PA at saturation destroys the EVM this tool spends its time protecting. 6 dB is a normal compromise; the tool does NOT model AM/AM or AM/PM, so this is a declared allowance rather than a computed one.' },
    { key: 'rxNfDb', label: 'Receiver noise figure', units: 'dB', value: 8, min: 2, max: 15, step: 0.5, group: 'Radio link',
      conf: 'scaled-estimate', why: 'Cascaded NF at the array port, referred through the antenna-side chain. 6–10 dB is normal for an E-band SiGe front end. The in-cell antenna feed sits in FRONT of the LNA, so the antenna family adds its feed loss to this directly — that is why the antenna table reports a G/T delta of −2× the feed loss.' },
    { key: 'rainRateMmH', label: 'Rain rate', units: 'mm/h', value: 25, min: 0, max: 150, step: 1, group: 'Radio link',
      conf: 'published-literature', why: 'Point rain rate exceeded for the target availability, ITU-R P.837. 25 mm/h is roughly 99.9% in a temperate zone (ITU zone K); 42 mm/h is about 99.99% there, and Mediterranean coastal zones run higher. This is THE E-band parameter: at 78 GHz, 25 mm/h costs about 10 dB/km against 0.4 dB/km of gaseous absorption.' },
    { key: 'linkPolSel', label: 'Polarisation', units: '', value: 0, group: 'Radio link',
      choices: [{ value: 0, label: 'Horizontal (worse case)' }, { value: 1, label: 'Vertical' }],
      conf: 'published-literature', why: 'Selects the ITU-R P.838-3 k and α coefficients. Horizontal rain attenuation is the higher of the two at E-band — raindrops are oblate — so it is the default and the conservative choice.' },
    { key: 'implLossDb', label: 'Implementation loss', units: 'dB', value: 2, min: 0, max: 8, step: 0.5, group: 'Radio link',
      conf: 'engineering-guess', why: 'Everything the demodulator loses that this tool does not model individually: synchroniser jitter, timing error, quantisation, filter ripple. Carried as one declared number rather than being distributed silently into the terms above it.' },
    { key: 'codingGainDb', label: 'FEC coding gain', units: 'dB', value: 8, min: 0, max: 12, step: 0.5, group: 'Radio link',
      conf: 'published-literature', why: 'Subtracted from the uncoded required SNR. An LDPC at rate 0.8 delivers roughly 7–9 dB at these error rates. Kept as a separate declared term so the UNCODED figure stays visible and checkable against a textbook.' },
    { key: 'targetBerExp', label: 'Target BER exponent', units: '10^-x', value: 6, min: 3, max: 12, step: 1, group: 'Radio link',
      conf: 'scaled-estimate', why: 'Pre-FEC bit error rate the required SNR is computed for, as 10^-x. Required SNR is DERIVED from it by inverting the square-QAM symbol-error bound, not read from a table.' },
    { key: 'linkMarginReqDb', label: 'Required link margin', units: 'dB', value: 3, min: 0, max: 20, step: 0.5, group: 'Radio link',
      conf: 'engineering-guess', why: 'Margin demanded above the required SNR before the link is called closed. Covers what is not modelled: pointing error, multipath, ageing, interference.' },

    /* --- search constraints ---
       Only the Chooser reads these. They live in PARAMS rather than in view
       state so a search is permalinkable and saveable like everything else:
       "here is the question I asked" is as much a part of an answer as the
       answer. Set a limit to its extreme to switch it off. */
    { key: 'cnMaxResidualDeg', label: 'Max inter-tile residual', units: '°', value: 5, min: 0.01, max: 20, step: 0.01, group: 'Search constraints',
      conf: 'measured/datasheet', why: 'Defaults to the derived coherence spec. Raise it to 20° to stop it constraining the search.' },
    { key: 'cnMaxPowerPct', label: 'Max distribution power', units: '% of array', value: 25, min: 1, max: 100, step: 1, group: 'Search constraints',
      conf: 'engineering-guess', why: 'LO plus baseband, as a share of the array power budget. 100 switches it off.' },
    { key: 'cnMinScanDeg', label: 'Min scan cone', units: '°', value: 0, min: 0, max: 75, step: 5, group: 'Search constraints',
      conf: 'engineering-guess', why: 'The element\'s worst-plane −3 dB half-cone. 0 switches it off. Set it to the scan requirement and the cell-filling antenna options disappear — which is the trade the antenna family exists to show.' },
    { key: 'cnMinBwGHz', label: 'Min radiator bandwidth', units: 'GHz', value: 0, min: 0, max: 15, step: 0.5, group: 'Search constraints',
      conf: 'engineering-guess', why: 'Set it to 15 to demand the whole 71–86 GHz band from one radiator, which only the board radiator delivers. 0 switches it off.' },
    { key: 'cnMinQamSel', label: 'Link must reach', units: '', value: 0, group: 'Search constraints',
      choices: [{ value: 0, label: 'anything that closes' }, { value: 1, label: 'QPSK' }, { value: 2, label: '16QAM' },
                { value: 3, label: '64QAM' }, { value: 4, label: '256QAM' }],
      conf: 'engineering-guess', why: 'The constellation the link must carry at the range and rain rate set in the Radio link group, with the margin set there too.' },
    { key: 'cnMaxRiskSel', label: 'Max risk', units: '', value: 2, group: 'Search constraints',
      choices: [{ value: 0, label: 'low only' }, { value: 1, label: 'up to medium' }, { value: 2, label: 'any' }],
      conf: 'engineering-guess', why: 'The worst risk level accepted across the LO, baseband and antenna choices. The risk labels are the model\'s own judgement, stated per option.' },
    { key: 'cnObjectiveSel', label: 'Rank the survivors by', units: '', value: 0, group: 'Search constraints',
      choices: [{ value: 0, label: 'Highest data rate' }, { value: 1, label: 'Most SNR headroom' },
                { value: 2, label: 'Lowest distribution power' }, { value: 3, label: 'Lowest inter-tile residual' },
                { value: 4, label: 'Fewest repeater amplifiers' }, { value: 5, label: 'Fewest radiators' }],
      conf: 'engineering-guess', why: 'ONE objective, not a blend. The options trade gain against scan range and link EVM against beam coherence in opposite directions, so a weighted "best" would be an answer manufactured out of weights nobody chose. Change this and watch the winner change — that is the point of it. Every objective here is MONOTONE in the thing it names: an earlier "largest link margin" was not, because margin is measured against the constellation the link achieves and therefore resets at every constellation boundary, so it crowned whichever system had just failed to reach the next one. Its tie window is absolute and stated per objective, in that objective\'s own units.' },

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
  var LO_IDS = ['local-pll', 'hf-foldback', 'daisy-chain', 'mid-mult', 'stabilised-link', 'inj-lock', 'radial-feed'];
  var BB_IDS = ['passive-50', 'bb-daisy', 'h-tree-active', 'current-mode', 'digital-tile'];

  var LO_META = [
    { id: 'local-pll', name: 'A1 Local PLL + reference', short: 'A1 Local PLL' },
    { id: 'hf-foldback', name: 'A2 High-frequency / foldback', short: 'A2 HF foldback' },
    { id: 'daisy-chain', name: 'A3 Daisy chain', short: 'A3 Daisy chain' },
    { id: 'mid-mult', name: 'A4 Mid-frequency + ×M', short: 'A4 Mid + ×M' },
    { id: 'stabilised-link', name: 'A5 Round-trip stabilised link', short: 'A5 Stabilised link' },
    { id: 'inj-lock', name: 'A6 Injection-locked tile oscillator', short: 'A6 Injection lock' },
    { id: 'radial-feed', name: 'A7 Radial equal-path feed', short: 'A7 Radial feed' }
  ];
  var BB_META = [
    { id: 'passive-50', name: 'B1 Passive resistive', short: 'B1 Passive 50 Ω' },
    { id: 'bb-daisy', name: 'B2 Baseband daisy chain', short: 'B2 BB daisy' },
    { id: 'h-tree-active', name: 'B3 H-tree active', short: 'B3 H-tree active' },
    { id: 'current-mode', name: 'B4 Current-mode summing', short: 'B4 Current-mode' },
    { id: 'digital-tile', name: 'B5 Digitise at the tile', short: 'B5 Digital tile' }
  ];
  var ANT_IDS = ['single-patch', 'cross-column', 'square-cluster', 'board-radiator'];
  var ANT_META = [
    { id: 'single-patch', name: 'C1 One patch per RF channel', short: 'C1 1× patch' },
    { id: 'cross-column', name: 'C2 1×K cross-scan patch column', short: 'C2 1×K column' },
    { id: 'square-cluster', name: 'C3 Kx×Ky cluster, both axes', short: 'C3 Kx×Ky cluster' },
    { id: 'board-radiator', name: 'C4 Wideband radiator on its own board', short: 'C4 board WB' }
  ];

  /* Per-option antenna constants, in ONE table for the same reason LO_TRAITS
     and BB_TRAITS exist: so no antenna number appears inline in evalAnt.

       kAllowed     legal radiators-per-channel; the state is clamped to this
                    and the clamp is REPORTED, never silent
       shapeOf(K)   how K lays out as kx (in the scan plane) by ky (across it)
       pitchMode    'none'  K = 1, no in-cell geometry at all
                    'lam'   pitch read from radPitchLam, span mode allowed
       dUnitMode    'param'    the unit radiator is elemDirDbi
                    'aperture' derive it from footprint x aperture efficiency
       fracBwPct    unit radiator fractional bandwidth before the feed
       feedBwNarrow how much a resonant corporate tree costs, per split stage
       ifaceBlockKeys  extra BLOCKS the signal passes through, cited not invented
  */
  var ANT_TRAITS = {
    'single-patch': {
      kAllowed: [1], kDefault: 1, pitchMode: 'none', dUnitMode: 'param',
      fracBwPct: 4.0, feedBwNarrow: 0.0, metalLayers: 2, radBlockKey: 'antPatch',
      ifaceBlockKeys: [], extraTransLossDb: 0,
      shapeOf: function () { return { kx: 1, ky: 1 }; },
      note: 'One package patch per real RF channel — 4 per die, 16 per tile, 400 across the panel, each alone in the middle of a 225 mm² cell. This is the tool\'s original assumption, and the only option that is byte-for-byte back-compatible with every number published before the antenna family existed.'
    },
    'cross-column': {
      kAllowed: [2, 4, 8], kDefault: 4, pitchMode: 'lam', dUnitMode: 'param',
      fracBwPct: 4.0, feedBwNarrow: 0.15, metalLayers: 2, radBlockKey: 'antPatch',
      ifaceBlockKeys: [], extraTransLossDb: 0,
      /* kx = 1 ALWAYS: the column runs across the scan plane, which is the
         whole idea. Its array factor is identically 1 along u, so the scan
         plane pattern is bit-identical to C1 at every K. */
      shapeOf: function (K) { return { kx: 1, ky: K }; },
      note: 'K patches stacked ACROSS the plane the array steers in, fed from one RF channel through a fixed corporate tree. Because the column\'s array factor is identically 1 along the scan axis, it buys element directivity and cross-scan lobe suppression at zero scan-plane cost — and it cannot touch the in-scan grating lobe, which stays exactly where it was.'
    },
    'square-cluster': {
      kAllowed: [4, 9, 16, 64], kDefault: 4, pitchMode: 'lam', dUnitMode: 'param',
      fracBwPct: 4.0, feedBwNarrow: 0.15, metalLayers: 2, radBlockKey: 'antPatch',
      ifaceBlockKeys: [], extraTransLossDb: 0,
      shapeOf: function (K) { var s = Math.round(Math.sqrt(K)); return { kx: s, ky: Math.round(K / s) }; },
      note: 'K patches in a near-square block behind one port. The pitch sweeps it from compact λ/2 packing through to spanning the whole cell, where the nulls land on the reciprocal port lattice and suppress every grating lobe at broadside — at the cost of the scan cone in BOTH planes. At K = 64 spanning, this is the cell-filling radiator the retired "nulled" element used to approximate, built out of discrete metal.'
    },
    'board-radiator': {
      kAllowed: [1], kDefault: 1, pitchMode: 'none', dUnitMode: 'aperture',
      fracBwPct: 20.0, feedBwNarrow: 0.0, metalLayers: 3, radBlockKey: 'antPatchBoard',
      ifaceBlockKeys: ['ebandTransition'], extraTransLossDb: 0.16,
      shapeOf: function () { return { kx: 1, ky: 1 }; },
      note: 'One radiator per channel again, so the scan cone is untouched — but a bigger, far wider-band one, and it leaves the RFIC package. Roughly a wavelength across on its own low-loss laminate, reached through an E-band board/package transition. It is the only architecturally different member: it moves the radiator onto hardware this thesis does not design, which is what the proposal\'s own scope note permits.'
    }
  };

  function antTraitsOf(id) {
    var t = ANT_TRAITS[id];
    if (!t) {
      throw new Error('antTraitsOf: unknown antenna option id ' + JSON.stringify(id) +
        ' (expected one of ' + Object.keys(ANT_TRAITS).join(', ') + ')');
    }
    return t;
  }

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
    },
    'radial-feed': {
      ampBlockKey: 'loAmpMid', vcoFomPenaltyDb: 0,
      /* reinterpreted for this option: the excess above the ideal
         10log10(N) of ONE junction, not a per-level excess compounded over
         a cascade. evalLo's radial branch reads it that way. */
      splitExcessDb: 1.2,
      transLossDb: 0.25, mediumKey: 'lo', perTileSource: false, activeFanout: false,
      radialJunction: true,
      verdict: function (c) {
        /* The isolation term is the architecture's own weakness and the
           reason it is a column rather than a free win: a junction with no
           isolation resistors redistributes one tile's mismatch to all the
           others, which is a LOAD-dependent unknown phase with no analogue
           anywhere else in this model — not thermal, not static, not
           calibratable by a per-tile LUT, because it changes whenever a
           neighbour's match changes or a die powers down. */
        var bad = c.isolErrDeg > c.g.specPhaseDeg;
        return {
          feasibility: bad
            ? 'port-to-port isolation exceeds the coherence spec: one mismatched or powered-down tile ' +
              'moves every other tile by ' + c.isolErrDeg.toFixed(2) + '°'
            : 'realisable; one junction, no cascade, and no isolation resistors — the mismatch coupling ' +
              'is the price of the equal path',
          risk: bad ? 'high' : 'medium'
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
    g.antOptionId = ANT_IDS[Math.round(g.antOption)] || ANT_IDS[0];
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
     * few hundred elements over a 30 cm aperture the lattice is several
     * wavelengths coarse, so the array keeps the BEAMWIDTH of the full
     * aperture but only the GAIN of its element count, and the difference
     * goes into grating lobes.
     *
     * THERE ARE TWO LATTICES HERE AND THEY MUST NEVER BE CONFLATED.
     *
     *   The PORT lattice — 16 controllable ports per tile, 400 over the
     *   panel, on a 1.5 cm pitch. NOT a free choice: the die is taped out
     *   with 4 real RF channels per direction. This is what the beamformer
     *   controls, what sets the array factor, and what fixes the 44 grating
     *   lobes and their positions. Nothing in family C may move it, and
     *   that is exactly what keeps the antenna family orthogonal to the LO
     *   and baseband families.
     *
     *   The RADIATOR lattice — the K radiators sitting INSIDE one port's
     *   cell, fed in fixed phase. Free, and invisible to the beamformer.
     *   It sets the ELEMENT PATTERN and the cell fill, and nothing else.
     *
     * elemPerTile and nElem are PORT counts. They keep those names because
     * every existing reader uses them, and gain nPorts/portsPerTile as the
     * unambiguous aliases.
     * ---------------------------------------------------------------- */
    g.diesPerTile = Math.max(1, Math.round(g.tapsPerTile));
    g.chPerDiePerDir = 4;                       /* 4 real RF channels per direction */
    g.elemPerTile = g.diesPerTile * g.chPerDiePerDir;
    g.nElem = g.nTilesTotal * g.elemPerTile;
    g.portsPerTile = g.elemPerTile;
    g.nPorts = g.nElem;

    /* ---------------------------------------------------------------- *
     * THE BASEBAND PAIRING — one baseband die per RFIC die, 1:1.
     *
     * This used to be a free slider reading 32 while the geometry could
     * only support 16, and nothing in the tool compared the two. It is now
     * DERIVED, so the disagreement cannot be typed in.
     *
     * The old 32 was not simply wrong: it counted BOTH DIRECTIONS
     * (4 dies × (4 RX + 4 TX)), while the port count counts one. Both
     * numbers were right about different things and neither said which,
     * which is the worst way for two numbers to disagree. Under 1:1 the
     * question is settled by the hardware: a baseband die with 4 IQ
     * channels cannot serve 4 RX and 4 TX at the same moment, so the array
     * is HALF-DUPLEX and the channel count is the one-direction count.
     * That is not a new assumption — the antenna family already defaults
     * to shared radiators behind a T/R switch, which is half-duplex at the
     * aperture. It is the same assumption, finally applied to the
     * baseband as well.
     *
     * "Rail" throughout this tool means I or Q, never a direction: every
     * baseband BOM multiplies the channel count by 2 for the two rails.
     * ---------------------------------------------------------------- */
    g.bbDiesPerTile = g.diesPerTile;            /* 1:1 — structural, not checked */
    g.bbIqChPerDie = Math.max(1, Math.round(g.bbIqChPerDie));
    g.chPerTile = g.bbDiesPerTile * g.bbIqChPerDie;
    g.bbDieAreaMm2 = g.bbDieMm * g.bbDieMm;
    g.bbDieBudgetMm2 = g.bbDiesPerTile * g.bbDieAreaMm2;
    g.bbDiesTotal = g.nTilesTotal * g.bbDiesPerTile;
    /* Area the pairing spends per IQ channel. The user's anchor is 4 channels
       on a 2.5 mm die, i.e. 1.5625 mm² each; packing more into the same die
       is what the utilisation check has to catch. */
    g.bbAreaPerIqChMm2 = g.bbDieAreaMm2 / g.bbIqChPerDie;
    /* Does the baseband channel count match the RF channel count it pairs
       with? At bbIqChPerDie = chPerDiePerDir it is exactly 1:1 per channel,
       not merely 1:1 per die. */
    g.bbChMatchesRf = g.bbIqChPerDie === g.chPerDiePerDir;

    /* ---- the radiator lattice inside one port cell ---- */
    var antTr = antTraitsOf(g.antOptionId);
    g.antTraits = antTr;
    var kWant = Math.round(g.radPerCh);
    g.radPerCh = antTr.kAllowed.indexOf(kWant) >= 0 ? kWant : antTr.kDefault;
    g.radPerChClamped = g.radPerCh !== kWant ? kWant : null;
    var shape = antTr.shapeOf(g.radPerCh);
    g.radKx = shape.kx;
    g.radKy = shape.ky;
    g.radPerTile = g.elemPerTile * g.radPerCh;
    g.nRad = g.nTilesTotal * g.radPerTile;

    /* Arrangement inside a tile — CHOSEN, not assumed. An earlier version
       forced a rectangular factorisation (round(sqrt(N)) rounded to a
       rectangle). That is not a constraint: every sublattice of index N
       that CONTAINS the tile lattice keeps all tiles identical, and the
       rectangle is not always the best of them. See lattice.js.

       At the DEFAULT geometry it happens to be: 16 elements in a 6 cm tile
       give a square 4 x 4 at a 1.5 cm pitch, which is both the rectangular
       arrangement and the widest-separation sublattice, so the choice is
       moot. It was not moot at the old 4 cm / 8-element tile, where the
       rectangular 4 x 2 was the WORST of them (worst grating lobe
       11.08 deg against 15.77 deg for the sheared a1 = (1,-1), a2 = (0,2)
       cm, at zero cost).

       Whatever the choice, tiles abut, so the FULL array is one lattice with
       the tile grid as a sublattice. That consistency is what lets the ideal
       pattern factorise as intra-tile x tile-grid: at band centre the
       intra-tile phase steer and the inter-tile delay steer coincide and
       AF(4, 1.5 cm) x AF(5, 6 cm) collapses exactly to AF(20, 1.5 cm), so
       the full-aperture beamwidth is preserved while the lobes appear. */
    g.lamCm = g.lambdaM * 100;
    g.latList = window.Lat.candidates(g.elemPerTile, g.tileCm, g.lamCm);
    g.latKey = ['rect', 'best', 'row'][Math.round(g.inTileLattice)] || 'rect';
    g.lat = window.Lat.pick(g.latList, g.latKey, g.elemPerTile);
    g.latBest = g.latList[g.latList.length - 1];
    g.latWorst = g.latList[0];

    /* CENTRE THE LATTICE IN THE TILE.

       Lat.offsets() wraps every position into [0, tileCm), so the raw set
       starts at zero: at the default that is 0, 1.5, 3.0, 4.5 cm in a 6 cm
       tile. Tiled across the panel that puts the outermost element centres
       at 0 and 28.5 cm on a 30 cm aperture — so the first column of
       radiators straddles the panel edge with half of each patch hanging
       into space, and a bare 1.5 cm strip is left at the far edge. Nobody
       builds that, and on the hardware map it reads as the array having
       slipped sideways.

       Each element owns a cell extending half a pitch around it, so the
       layout that actually tiles the aperture is the centred one: 0.75 to
       29.25 cm, with the cells exactly covering 0 to 30.

       This is a RIGID TRANSLATION of the whole lattice, which is a global
       phase factor and cancels in |AF|^2 — it moves no number the tool
       reports, and that is asserted in selfTest rather than argued here.
       It is applied at the single point where the offsets are adopted, so
       the beam model, the projections and the hardware map all share one
       convention and cannot drift apart. */
    g.latOffsetsCm = (function (offs, period) {
      if (!offs || !offs.length) return offs;
      function shiftFor(idx) {
        var lo = Infinity, hi = -Infinity;
        offs.forEach(function (o) { lo = Math.min(lo, o[idx]); hi = Math.max(hi, o[idx]); });
        return (period - (hi - lo)) / 2 - lo;
      }
      var dx = shiftFor(0), dy = shiftFor(1);
      return offs.map(function (o) { return [o[0] + dx, o[1] + dy]; });
    })(g.lat.offsets, g.tileCm);

    /* What a principal-plane cut actually sees: the lattice PROJECTED onto
       the cut axis. A sheared lattice projects onto the same set of x
       columns as the rectangle it was sheared from, so the x-cut cannot
       tell them apart — the improvement lives off the principal planes,
       which is exactly why two cuts are not an honest presentation of this
       array. */
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

    /* ---- the element, which is where the missing 16 dB actually lives ----
       The radiator pitch inside the cell. Span mode derives it from the
       SELECTED lattice basis rather than assuming a square cell, so it
       composes with the in-tile lattice choice instead of contradicting it. */
    var cellXCm = Math.abs(g.lat.a1[0]) || g.elemDxCm;
    var cellYCm = Math.abs(g.lat.a2[1]) || g.elemDyCm;
    g.radSpanning = antTr.pitchMode === 'lam' && Math.round(g.radSpanPitch) === 1;
    if (antTr.pitchMode === 'none') {
      g.radPitchXCm = g.lamCm / 2;
      g.radPitchYCm = g.lamCm / 2;
    } else if (g.radSpanning) {
      g.radPitchXCm = cellXCm / Math.max(g.radKx, 1);
      g.radPitchYCm = cellYCm / Math.max(g.radKy, 1);
    } else {
      g.radPitchXCm = g.radPitchLam * g.lamCm;
      g.radPitchYCm = g.radPitchLam * g.lamCm;
    }
    /* C4 derives its unit directivity from footprint instead of asserting it,
       which turns elemDirDbi from a free slider into an auditable quantity. */
    g.radUnitDbi = antTr.dUnitMode === 'aperture'
      ? 10 * Math.log10(4 * Math.PI * g.radApEff * g.radApertureLam * g.radApertureLam)
      : g.elemDirDbi;

    g.elem = window.Lat.element({
      key: (window.Lat.KIND_KEYS[Math.round(g.elemModelSel)] || 'dir'),
      lamCm: g.lamCm, a1: g.lat.a1, a2: g.lat.a2,
      elemDirDbi: g.elemDirDbi, dUnitDbi: g.radUnitDbi, hpbwDeg: g.elemHpbwDeg,
      kx: g.radKx, ky: g.radKy, pxCm: g.radPitchXCm, pyCm: g.radPitchYCm
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
    g.dPortDbi = g.dElDbi;                      /* unambiguous alias */
    g.radGainOverUnitDb = g.elem.dGainOverUnitDb || 0;
    /* Under separate TX and RX radiator groups each direction gets half the
       cell, so the ceiling each one is judged against drops by 3.01 dB. */
    g.antTrSeparate = Math.round(g.antTrShare) === 1;
    g.dCellPerDirDbi = g.dCellDbi - (g.antTrSeparate ? 10 * Math.log10(2) : 0);

    /* ---- the fixed feed behind the port, and what it costs twice ----
       The corporate tree inside the cell, plus any board transition, sits in
       FRONT of the LNA — the LNA is inside the RFIC, the feed is not. So on
       receive the same loss costs its dB in gain AND its dB in noise figure:
       G/T moves by twice it. This is the strongest honest argument against
       cell-filling, and it is why the family must never report a gain delta
       on its own. */
    g.antFeedStages = g.radPerCh > 1 ? Math.ceil(Math.log(g.radPerCh) / Math.log(2)) : 0;
    g.antFeedRouteCm = 0.5 * ((g.radKx - 1) * g.radPitchXCm + (g.radKy - 1) * g.radPitchYCm);
    g.antIfaceLossDb = (antTr.ifaceBlockKeys || []).reduce(function (a, k) {
      return a + Math.abs((BLOCKS[k] || {}).gainDb || 0);
    }, 0);
    g.antFeedLossDb = g.antFeedStages * g.feedSplitLossDb +
      g.antFeedRouteCm * g.feedLossPerCmDb +
      (antTr.extraTransLossDb || 0) + g.antIfaceLossDb;
    g.antNfPenaltyDb = g.antFeedLossDb;
    g.antGtDeltaDb = g.radGainOverUnitDb - 2 * g.antFeedLossDb;
    g.antLossTotalDb = g.antLossDb + g.antFeedLossDb;
    /* unobservable junctions per port: BIST cannot see inside the cell */
    g.antBlindJunctions = Math.max(0, g.radPerCh - 1) + (antTr.ifaceBlockKeys || []).length;
    /* fractional bandwidth, narrowed by each resonant split stage */
    g.antFracBwPct = antTr.fracBwPct * Math.pow(1 - (antTr.feedBwNarrow || 0), g.antFeedStages);
    g.antBwGHz = g.antFracBwPct / 100 * g.fLoGHz;
    g.antBandOk = g.antBwGHz >= g.antBandReqGHz;
    g.radAreaPctOfCell = 100 * g.radPerCh *
      ((BLOCKS[antTr.radBlockKey] || BLOCKS.antPatch).areaMm2) / Math.max(g.aCellMm2, 1e-9);
    /* worst-plane -3 dB half-cone, which is what the scan spec meets or does not */
    g.antConeXDeg = (g.elem.hpbwXDeg || g.elem.hpbwDeg) / 2;
    g.antConeYDeg = (g.elem.hpbwYDeg || g.elem.hpbwDeg) / 2;
    g.antConeMinDeg = Math.min(g.antConeXDeg, g.antConeYDeg);

    /* directivity is not gain */
    g.realisedGainDbi = g.dArrayDbi - g.antLossTotalDb;
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
       quantResidualDeg(phaseBits) into sigElem where it averages over the
       ELEMENTS rather than over the tiles. Carrying it here too counted the same
       0.812 deg twice and at the wrong level — and because it depends only
       on phaseBits it was IDENTICAL for all six options, so it drowned the
       thing this metric exists to measure: A2/A3/A4 sat at 0.835/0.859/0.821
       deg, within 4.6% of each other, where the distribution architectures
       actually differ by 0.197/0.279/0.123. It is still reported on its own
       row, and still reaches the beam through sigElem. */
    /* ---- A7's own error class: load-dependent coupling through an
       unisolated junction ----
       A radial divider has no isolation resistors, so a reflection from one
       port is redistributed to the other N−1. The reflected fraction is
       Γ = (VSWR−1)/(VSWR+1). Each of the other N−1 ports reflects Γ back
       into the junction, where it divides by N on its way out to any given
       port; the N−1 contributions have uncorrelated phases and so add in
       RSS, giving an amplitude Γ·√(N−1)/N and a phase error
       arcsin(Γ·√(N−1)/N) to first order.

       Getting this wrong is easy and it was wrong here first: dividing by
       √N instead of N and applying the √(N−1) outside the arcsine gives
       11.2° instead of 2.2°, which is the difference between an option that
       fails the 5° coherence spec outright and one that spends about half
       of it. The N is a voltage division at the junction, not a power one.

       It is in this RSS and not in the calibratable bucket deliberately: it
       is neither thermal nor static. It changes whenever a neighbour's
       match changes — a die powering down is the worst case — so a per-tile
       LUT written at calibration time does not hold it. That is a new error
       class with no analogue in any other option here, and it is what makes
       A7 a genuine trade rather than a free win. Zero for every other
       option, whose junctions are isolated. */
    var isolErrDeg = 0;
    if (trL.radialJunction) {
      var gam = (g.portVswr - 1) / (g.portVswr + 1);
      isolErrDeg = Math.asin(Math.min(1,
        gam * Math.sqrt(Math.max(nT - 1, 0)) / Math.max(nT, 1))) * K.DEG;
    }
    var interTileRawDeg = K.rss(phiDiffRawRad * K.DEG, correctionRangeDeg, driftTotalDeg, lockOffsetDeg, isolErrDeg);
    var interTileResidualDeg = K.rss(phiDiffCalRad * K.DEG, injDeg, driftResidDeg, isolErrDeg);

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
    if (lo.kind === 'radial') {
      /* ONE junction: the ideal 10log10(N) of power conservation, plus a
         single excess. A tree pays the same ideal total — both are floored
         by power conservation, and that floor is why the radial saving here
         is a few tenths of a dB and not the several dB it looks like — but
         a tree compounds its excess once per cascaded level.

         This branch is not optional. A third kind falling through to the
         chain branch below would multiply lo.maxHop, which a radial network
         does not define, and the whole option would report NaN. */
      splitLossDb = 10 * Math.log10(Math.max(nT, 1)) + trL.splitExcessDb;
    } else if (lo.kind === 'tree') {
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
      var splitDb = lo.kind === 'radial'
        ? 10 * Math.log10(Math.max(nT, 1)) + trL.splitExcessDb
        : lo.kind === 'tree'
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
    var verdict = trL.verdict({ g: g, lossTotalDb: lossTotalDb, lo: lo, nT: nT, isolErrDeg: isolErrDeg });
    var feasibility = verdict.feasibility;
    var riskLevel = verdict.risk;

    return {
      id: id, topo: topo, grid: grid, nTiles: nT,
      pnCurve: pnCurve, pnDiffCurve: pnDiffCurve, pnArrayCurve: pnArrayCurve, pnAtOffsets: pnAtOffsets,
      phiRmsDeg: phiRmsDeg, phiArrayDeg: phiArrRad * K.DEG, jitterFs: jitterFs,
      interTileRawDeg: interTileRawDeg, interTileResidualDeg: interTileResidualDeg,
      pnDiffRawDeg: phiDiffRawRad * K.DEG, pnDiffCalDeg: phiDiffCalRad * K.DEG,
      injDeg: injDeg, driftResidDeg: driftResidDeg, quantDeg: quantDeg,
      reciprocityDeg: reciprocityDeg, couplerBiasDeg: couplerBiasDeg, isolErrDeg: isolErrDeg,
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
  /* ---------------------------------------------------------------------
     THE ANTENNA FAMILY.

     evalAnt is deliberately the SMALLEST of the three eval functions,
     because the antenna option genuinely touches less than the other two:
     it rebuilds the element and everything the element feeds, and it is
     forbidden to touch anything upstream of the port lattice. If this
     function ever changes nElem, elemPerTile, lat or aCellCm2, the 44
     grating lobes move and every number in the tool becomes wrong with
     nothing complaining — so it recomputes from a patched copy and asserts
     the invariants rather than trusting itself.
     ------------------------------------------------------------------- */
  function evalAnt(id, g) {
    var tr = antTraitsOf(id);
    var gg = {};
    for (var k in g) gg[k] = g[k];
    /* overwrite BOTH fields: leaving the numeric one stale is the defect
       class already recorded for the LO family */
    gg.antOption = ANT_IDS.indexOf(id);
    gg.antOptionId = id;

    var kWant = Math.round(g.radPerCh);
    var K_ = tr.kAllowed.indexOf(kWant) >= 0 ? kWant : tr.kDefault;
    var shape = tr.shapeOf(K_);
    var cellXCm = Math.abs(g.lat.a1[0]) || g.elemDxCm;
    var cellYCm = Math.abs(g.lat.a2[1]) || g.elemDyCm;
    var spanning = tr.pitchMode === 'lam' && Math.round(g.radSpanPitch) === 1;
    var pxCm, pyCm;
    if (tr.pitchMode === 'none') { pxCm = g.lamCm / 2; pyCm = g.lamCm / 2; }
    else if (spanning) { pxCm = cellXCm / Math.max(shape.kx, 1); pyCm = cellYCm / Math.max(shape.ky, 1); }
    else { pxCm = g.radPitchLam * g.lamCm; pyCm = g.radPitchLam * g.lamCm; }

    var dUnit = tr.dUnitMode === 'aperture'
      ? 10 * Math.log10(4 * Math.PI * g.radApEff * g.radApertureLam * g.radApertureLam)
      : g.elemDirDbi;

    var elem = window.Lat.element({
      key: (window.Lat.KIND_KEYS[Math.round(g.elemModelSel)] || 'dir'),
      lamCm: g.lamCm, a1: g.lat.a1, a2: g.lat.a2,
      elemDirDbi: g.elemDirDbi, dUnitDbi: dUnit, hpbwDeg: g.elemHpbwDeg,
      kx: shape.kx, ky: shape.ky, pxCm: pxCm, pyCm: pyCm
    });

    var lamMm = g.lambdaM * 1000;
    var dArrayRawDbi = 10 * Math.log10(Math.max(g.nElem, 1)) + elem.dElDbi;
    var dArrayDbi = Math.min(dArrayRawDbi, g.dFilledDbi);
    var thinningLossDb = g.dFilledDbi - dArrayRawDbi;
    var aEffElMm2 = Math.pow(10, elem.dElDbi / 10) * lamMm * lamMm / (4 * Math.PI);
    var cellFillPct = 100 * aEffElMm2 / Math.max(g.aCellMm2, 1e-9);

    var stages = K_ > 1 ? Math.ceil(Math.log(K_) / Math.log(2)) : 0;
    var routeCm = 0.5 * ((shape.kx - 1) * pxCm + (shape.ky - 1) * pyCm);
    var ifaceDb = (tr.ifaceBlockKeys || []).reduce(function (a, kk) {
      return a + Math.abs((BLOCKS[kk] || {}).gainDb || 0);
    }, 0);
    var feedLossDb = stages * g.feedSplitLossDb + routeCm * g.feedLossPerCmDb +
      (tr.extraTransLossDb || 0) + ifaceDb;

    /* Lat.withLevels MUTATES the list it is handed. Every option must get a
       FRESH list, or the shared one ends up carrying the last option's
       levels and the map, the beam and the tables describe different arrays. */
    var u0 = Math.sin(K.deg2rad(g.beamScanDeg)), v0 = 0;
    var lobesAtScan = window.Lat.withLevels(
      window.Lat.lobes(g.lat.b1, g.lat.b2, g.lamCm, u0, v0), elem, u0, v0);
    var lobesBroad = window.Lat.withLevels(
      window.Lat.lobes(g.lat.b1, g.lat.b2, g.lamCm, 0, 0), elem, 0, 0);
    var worstAtScan = lobesAtScan.length ? lobesAtScan[0] : null;
    var worstBroad = lobesBroad.length ? lobesBroad[0] : null;
    var within3 = lobesAtScan.filter(function (l) { return l.relDb > -3; }).length;

    /* A fixed broadside subarray can be steered INTO ITS OWN NULL: a 4-wide
       column at λ/2 has an exact pattern null at u = 0.5, i.e. at exactly
       30° of scan. The arithmetic then divides by ~0 and every grating lobe
       reports as tens of dB "above" a beam that is not there. That is
       literally true and completely useless as a number, so it is flagged
       and named rather than printed as a spurious 90.00 dB. */
    var pScan = elem.powAt(u0, v0), pBore = elem.powAt(0, 0);
    var scanInNull = pBore > 0 && pScan < 1e-6 * pBore;
    var scanLossDb = -10 * Math.log10(Math.max(pScan, 1e-9));
    var coneXDeg = (elem.hpbwXDeg || elem.hpbwDeg) / 2;
    var coneYDeg = (elem.hpbwYDeg || elem.hpbwDeg) / 2;
    var fracBwPct = tr.fracBwPct * Math.pow(1 - (tr.feedBwNarrow || 0), stages);
    var bwGHz = fracBwPct / 100 * g.fLoGHz;
    var radBlock = BLOCKS[tr.radBlockKey] || BLOCKS.antPatch;

    /* INVARIANTS. These are the only two ways this family can silently
       destroy the tool: moving the port lattice, or regressing C1. */
    if (elem.kTotal !== K_ || shape.kx * shape.ky !== K_) {
      throw new Error('evalAnt: radiator shape ' + shape.kx + 'x' + shape.ky +
        ' does not multiply to K=' + K_ + ' for option ' + id);
    }

    return {
      id: id, note: tr.note,
      radPerCh: K_, radPerChClamped: K_ !== kWant ? kWant : null,
      radKx: shape.kx, radKy: shape.ky,
      radPitchXCm: pxCm, radPitchYCm: pyCm, radPitchLamEff: pxCm / g.lamCm,
      spanning: spanning,
      nPorts: g.nElem, portsPerTile: g.elemPerTile,
      nRad: g.nTilesTotal * g.elemPerTile * K_, radPerTile: g.elemPerTile * K_,
      dUnitDbi: dUnit, dElDbi: elem.dElDbi, dGainOverUnitDb: elem.dGainOverUnitDb || 0,
      dCellDbi: elem.dCellDbi,
      dCellPerDirDbi: elem.dCellDbi - (Math.round(g.antTrShare) === 1 ? 10 * Math.log10(2) : 0),
      dArrayRawDbi: dArrayRawDbi, dArrayDbi: dArrayDbi,
      thinningLossDb: thinningLossDb, cellFillPct: cellFillPct,
      dElHeadroomDb: elem.dCellDbi - elem.dElDbi,
      feedStages: stages, feedRouteCm: routeCm, feedLossDb: feedLossDb,
      nfPenaltyDb: feedLossDb, gtDeltaDb: (elem.dGainOverUnitDb || 0) - 2 * feedLossDb,
      antLossTotalDb: g.antLossDb + feedLossDb,
      realisedGainDbi: dArrayDbi - (g.antLossDb + feedLossDb),
      realisedAtScanDbi: dArrayDbi - (g.antLossDb + feedLossDb) - scanLossDb,
      scanLossDb: scanLossDb, scanInNull: scanInNull,
      coneXDeg: coneXDeg, coneYDeg: coneYDeg, coneMinDeg: Math.min(coneXDeg, coneYDeg),
      scanConeOk: Math.min(coneXDeg, coneYDeg) >= g.scanDegMax,
      lobeCount: lobesAtScan.length,
      lobesWithin3Db: within3,
      worstLobeDb: worstAtScan ? worstAtScan.relDb : NaN,
      worstLobeDeg: worstAtScan ? worstAtScan.thetaDeg : NaN,
      bindingBroadsideDb: worstBroad ? worstBroad.relDb : NaN,
      bindingBroadsideDeg: worstBroad ? worstBroad.thetaDeg : NaN,
      subLobeCount: (elem.subLobes || []).length,
      fracBwPct: fracBwPct, bwGHz: bwGHz,
      bandOk: bwGHz >= g.antBandReqGHz, bandReqGHz: g.antBandReqGHz,
      blindJunctions: Math.max(0, K_ - 1) + (tr.ifaceBlockKeys || []).length,
      metalLayers: tr.metalLayers,
      radAreaPctOfCell: 100 * K_ * radBlock.areaMm2 / Math.max(g.aCellMm2, 1e-9),
      powerPerTileMw: 0,           /* the finding, not an omission */
      elemLabel: elem.label,
      riskLevel: antRisk(id, K_, spanning, routeCm),
      feasibility: antFeasibility(id, K_, shape, pxCm, pyCm, cellXCm, cellYCm, spanning, g)
    };
  }

  function antRisk(id, K_, spanning, routeCm) {
    if (id === 'single-patch') return 'low';
    if (id === 'board-radiator') return 'medium';
    if (K_ >= 36) return 'high';
    if (K_ >= 16 || spanning) return 'medium';
    return 'medium';
  }

  function antFeasibility(id, K_, shape, pxCm, pyCm, cellXCm, cellYCm, spanning, g) {
    var spanXCm = shape.kx * pxCm, spanYCm = shape.ky * pyCm;
    if (spanXCm > cellXCm + 1e-9 || spanYCm > cellYCm + 1e-9) {
      return 'NOT REALISABLE as configured: ' + shape.kx + '×' + shape.ky + ' at ' +
        (Math.round(100 * pxCm / g.lamCm) / 100) + 'λ spans ' +
        (10 * Math.max(spanXCm, spanYCm)).toFixed(2) + ' mm against a ' +
        (10 * Math.min(cellXCm, cellYCm)).toFixed(2) + ' mm cell';
    }
    if (spanning && Math.max(shape.kx, shape.ky) < cellXCm / g.lamCm) {
      return 'NOT REALISABLE as configured: span mode needs K per axis ≥ cell/λ = ' +
        (cellXCm / g.lamCm).toFixed(2) + ', below which the subarray puts its own ' +
        'full-strength lobe inside visible space';
    }
    if (id === 'single-patch') return 'realisable; it is what the tool already assumed, and it needs no in-cell feed at all';
    if (id === 'board-radiator') return 'realisable and routine at mm-wave; the risk is 400 board/package transitions whose phase offsets are BIST-invisible, not the radiator';
    if (K_ >= 64) return 'research demonstrator: a six-stage tree per port, and the feed metal starts competing with the radiators for cell area';
    if (K_ >= 16) return 'hard but realisable; a 1:16 corporate tree inside the cell at 78 GHz';
    return 'realisable; a 1:' + K_ + ' corporate split in package substrate at 78 GHz is routine';
  }

  /* ---------------------------------------------------------------------
     THE RADIO LINK.

     This is the only function in the tool that looks outside the array, and
     it is deliberately a CASCADE: every line is one term, in order, with
     the running total beside it, because that is what a link budget IS and
     because a reader has to be able to check it line by line against their
     own spreadsheet.

     It consumes the array rather than re-deriving it. The EIRP comes from
     the array directivity the beam model computed; the receive gain is the
     realised gain including scan loss, coherence loss and the whole
     antenna-side chain the antenna family added; and the SNR CEILING comes
     from the array's own residual phase error, which is what the rest of
     this tool exists to compute. That last connection is the point: it is
     where the distribution architecture stops being an abstraction and
     starts setting a data rate.
     ------------------------------------------------------------------- */
  function evalLink(g, loRes, beamRes, bbRes) {
    var fGHz = g.fLoGHz;
    var dKm = g.linkRangeKm;
    /* THE USABLE BANDWIDTH IS NOT ALWAYS THE RF BANDWIDTH. The baseband
       network has its own −3 dB bandwidth, and a signal cannot be wider
       than the pipe it is combined through: B2's daisy chain passes
       0.15 GHz, so crediting it with the full 2 GHz would have let the
       worst baseband option report the same data rate as the best. This
       is the only place the link budget depends on the baseband choice,
       and leaving it out made the link falsely independent of it. */
    var bwRfHz = g.rfBwGHz * 1e9;
    var bwBbHz = bbRes && isFinite(bbRes.bwGHz) && bbRes.bwGHz > 0 ? bbRes.bwGHz * 1e9 : Infinity;
    var bwHz = Math.min(bwRfHz, bwBbHz);
    var bwLimitedByBb = bwBbHz < bwRfHz;
    var pol = Math.round(g.linkPolSel) === 1 ? 'V' : 'H';

    /* ---- transmit ---- */
    var pPerElemDbm = g.txPoutDbm - g.txBackoffDb;
    var nPorts = Math.max(g.nElem, 1);
    var pTotalDbm = pPerElemDbm + 10 * Math.log10(nPorts);
    /* EIRP = total radiated power + array DIRECTIVITY. Equivalently
       P_elem + 20log10(N) + D_el — the N^2 of coherent combining, N once
       for the power summed and once for the directivity. Writing it as
       P_total + D_array keeps it obviously right rather than obviously
       clever. */
    var dArrayDbi = g.dArrayDbi;
    var eirpDbm = pTotalDbm + dArrayDbi - g.antLossTotalDb;

    /* ---- the path ---- */
    var fsplDb = K.fsplDb(fGHz, dKm);
    var gasPerKm = g.atmosDbPerKmOverride > 0 ? g.atmosDbPerKmOverride : K.gasAbsDbPerKm(fGHz);
    var gasDb = gasPerKm * dKm;
    var rc = K.rainCoeffs(fGHz, pol);
    var rainGammaDbKm = K.rainSpecificDbKm(rc.k, rc.alpha, g.rainRateMmH);
    /* with no rain there is no rain cell, so the point-to-path reconciliation
       factor is not a meaningful number to report */
    var rainR = g.rainRateMmH > 0 ? K.rainPathFactor(dKm, g.rainRateMmH, rc.alpha, fGHz) : 1;
    var rainDb = rainGammaDbKm * dKm * rainR;

    /* ---- receive ----
       The receive gain is the REALISED gain: directivity less scan loss,
       coherence loss and the antenna-side chain. Using the raw directivity
       here would quietly hand the link everything the array gives up. */
    var gRxDbi = beamRes ? beamRes.realisedDbi : (dArrayDbi - g.antLossTotalDb);
    var prxClearDbm = eirpDbm - fsplDb - gasDb + gRxDbi;
    var prxDbm = prxClearDbm - rainDb;

    /* ---- noise and SNR ---- */
    var noiseDbm = K.noiseFloorDbm(bwHz, g.rxNfDb);
    var snrClearDb = prxClearDbm - noiseDbm - g.implLossDb;
    var snrPathDb = prxDbm - noiseDbm - g.implLossDb;

    /* ---- the ceiling this whole tool is about ----
       The array's own residual phase error is an EVM, and an EVM is an SNR
       that no received power can beat. */
    var evmDbArr = loRes ? loRes.evmDb : NaN;
    var snrCeilDb = isFinite(evmDbArr) ? K.snrCeilFromEvmDb(evmDbArr) : Infinity;
    var snrEffDb = K.combineSnrDb(snrPathDb, snrCeilDb);
    var snrEffClearDb = K.combineSnrDb(snrClearDb, snrCeilDb);
    var ceilingBinds = isFinite(snrCeilDb) && snrCeilDb < snrPathDb;

    /* ---- what that supports ---- */
    var ber = Math.pow(10, -g.targetBerExp);
    var orders = K.QAM_EVM.map(function (q) { return q.order; });
    var req = orders.map(function (o) {
      return { order: o, name: K.QAM_EVM.filter(function (q) { return q.order === o; })[0].name,
               snrDb: K.snrForQamDb(o, ber, g.codingGainDb) };
    });
    var best = null;
    req.forEach(function (r) {
      if (snrEffDb >= r.snrDb + g.linkMarginReqDb && (!best || r.order > best.order)) best = r;
    });
    var bitsPerSym = best ? Math.log2(best.order) : 0;
    /* one rail, both polarisations not assumed; the usable bandwidth is the
       symbol bandwidth, and no excess-bandwidth factor is applied because
       the tool does not model the pulse shaping */
    var rateBps = best ? bitsPerSym * bwHz : 0;
    /* Headroom over the LOWEST constellation, which is monotone in received
       power — unlike the margin against the achieved constellation, which
       resets at every boundary and would rank a better link lower. */
    var headroomDb = req.length ? snrEffDb - (req[0].snrDb + g.linkMarginReqDb) : NaN;
    var shannonCapBps = K.shannonBps(bwHz, snrEffDb);

    /* margin against the modulation the ARRAY's EVM would allow if the path
       were free — i.e. is the link or the array the binding constraint? */
    var qamFromEvm = loRes ? loRes.maxQam : '—';
    var marginDb = best ? snrEffDb - best.snrDb : (req[0] ? snrEffDb - req[0].snrDb : NaN);

    /* ---- the range at which it stops closing ----
       Solved by bisection on the same cascade rather than by inverting it,
       so the answer cannot drift from the numbers printed above. */
    function snrAt(d) {
      var fs = K.fsplDb(fGHz, d);
      var ga = gasPerKm * d;
      var ra = K.rainSpecificDbKm(rc.k, rc.alpha, g.rainRateMmH) * d *
        K.rainPathFactor(d, g.rainRateMmH, rc.alpha, fGHz);
      var p = eirpDbm - fs - ga - ra + gRxDbi;
      return K.combineSnrDb(p - noiseDbm - g.implLossDb, snrCeilDb);
    }
    function maxRangeFor(snrNeedDb) {
      if (!(snrAt(0.05) >= snrNeedDb)) return 0;
      var lo = 0.05, hi = 50;
      if (snrAt(hi) >= snrNeedDb) return hi;
      for (var i = 0; i < 60; i++) {
        var mid = (lo + hi) / 2;
        if (snrAt(mid) >= snrNeedDb) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }
    var needDb = best ? best.snrDb + g.linkMarginReqDb
                      : (req[0] ? req[0].snrDb + g.linkMarginReqDb : NaN);
    var maxRangeKm = isFinite(needDb) ? maxRangeFor(needDb) : NaN;

    return {
      /* the cascade, in order, for the table */
      pPerElemDbm: pPerElemDbm, nPorts: nPorts, pTotalDbm: pTotalDbm,
      dArrayDbi: dArrayDbi, antLossTotalDb: g.antLossTotalDb, eirpDbm: eirpDbm,
      fsplDb: fsplDb, gasPerKm: gasPerKm, gasDb: gasDb,
      rainK: rc.k, rainAlpha: rc.alpha, rainGammaDbKm: rainGammaDbKm,
      rainPathFactor: rainR, rainDb: rainDb, pol: pol,
      gRxDbi: gRxDbi, prxClearDbm: prxClearDbm, prxDbm: prxDbm,
      noiseDbm: noiseDbm, bwHz: bwHz, bwRfHz: bwRfHz, bwBbHz: bwBbHz,
      bwLimitedByBb: bwLimitedByBb, headroomDb: headroomDb,
      snrClearDb: snrClearDb, snrPathDb: snrPathDb,
      evmDbArr: evmDbArr, snrCeilDb: snrCeilDb,
      snrEffDb: snrEffDb, snrEffClearDb: snrEffClearDb, ceilingBinds: ceilingBinds,
      requirements: req, best: best, bitsPerSym: bitsPerSym,
      rateBps: rateBps, shannonCapBps: shannonCapBps,
      marginDb: marginDb, needDb: needDb, maxRangeKm: maxRangeKm,
      qamFromEvm: qamFromEvm, closes: !!best,
      rangeCurve: (function () {
        var pts = [], n = 90;
        for (var i = 0; i <= n; i++) {
          var d = 0.05 * Math.pow(40 / 0.05, i / n);      /* 50 m to 2 km, log */
          pts.push({ d: d, snr: snrAt(d) });
        }
        return pts;
      })(),
      snrAt: snrAt
    };
  }

  /* ---------------------------------------------------------------------
     THE CONSTRAINT SEARCH.

     Enumerate the architecture space, apply the reader's constraints, and
     rank what survives by the ONE objective they chose.

     WHY THE ENUMERATION IS NOT A PRODUCT. It is tempting to evaluate 6 LO +
     5 baseband + 9 antenna configurations and form 270 products, because
     evalLo, evalBb and evalAnt are independent of one another and evalLink
     never reads the baseband option at all. But Beam.evaluate takes the LO
     result, the baseband result AND the antenna-patched geometry, and its
     coherence loss depends on all three — so the realised gain that feeds
     the link budget is a genuine three-way function. Cheating the product
     here would make the search quietly disagree with every other view for
     the same build, which is the one thing a tool that ranks must not do.

     So: one resolve per ANTENNA configuration (the antenna is what changes
     the geometry-derived element), and one light beam evaluation per
     COMBINATION. About 1.6 s for the full space, which is why this runs
     behind a button instead of on every keystroke.

     WHAT IT REFUSES TO DO. It does not blend the objectives into a score.
     The options trade gain against scan range and link EVM against beam
     coherence in OPPOSITE directions — that opposition is this thesis's
     central finding — so a single weighted "best" would be an answer
     manufactured out of weights nobody chose. The reader picks one
     objective, sees what the constraints killed, and is told when the
     result is a tie rather than a winner.
     ------------------------------------------------------------------- */
  /* THE ANTENNA CONFIGURATIONS TO SEARCH ARE DERIVED, NOT LISTED.

     An earlier version hard-coded ten of them, and the list was wrong in
     both directions at the shipped defaults: it searched two configurations
     the model itself rejects — a 1x8 column at lambda/2 spans 15.37 mm
     against a 15.00 mm cell, and a 4x4 cluster at lambda/2 steers into its
     own null at the default 30 degrees — while omitting two that are legal
     and are arguably the most interesting in the family, the cross-scan
     column SPANNING its cell, which puts its nulls on the cross-scan
     grating lobes at zero cost in the scan plane.

     It could not have been right as a list, either. Whether a configuration
     is legal depends on the CURRENT geometry and steer angle: the 1x8
     column fits in a larger cell, and the 4x4 cluster is fine at 20 degrees
     of scan. A fixed list bakes in one set of parameters.

     So: enumerate every option against every radiator count it allows and
     both pitch modes, resolve each one, and keep those the model's own
     consistency() does not hard-fail. The excluded ones are RETURNED with
     the reason, because a search that silently drops candidates is a search
     that cannot be checked. */
  function searchAntConfigs(state) {
    var keep = [], dropped = [];
    ANT_IDS.forEach(function (id) {
      var tr = ANT_TRAITS[id];
      var modes = tr.pitchMode === 'lam' ? [0, 1] : [0];
      tr.kAllowed.forEach(function (k) {
        modes.forEach(function (span) {
          var st = {};
          for (var key in state) st[key] = state[key];
          st.antOption = ANT_IDS.indexOf(id);
          st.radPerCh = k;
          st.radSpanPitch = span;
          var g;
          try { g = resolve(st); } catch (e) {
            dropped.push({ ant: id, k: k, span: span, why: 'could not resolve: ' + e.message });
            return;
          }
          var fails = consistency(g).filter(function (w) { return w.severity === 'fail'; });
          if (fails.length) {
            dropped.push({ ant: id, k: k, span: span, why: fails[0].message });
            return;
          }
          keep.push({ ant: id, k: k, span: span });
        });
      });
    });
    return { keep: keep, dropped: dropped };
  }

  var RISK_ORDER = { low: 0, medium: 1, high: 2 };

  /* The objectives. Each names the field it reads and which way is better,
     so nothing is hidden in a comparator. */
  /* EVERY OBJECTIVE MUST BE MONOTONE IN THE THING IT NAMES, and each carries
     its own ABSOLUTE tie epsilon in its own units.

     The first version failed both tests and it is worth recording how,
     because it is the exact failure mode this tool exists to refuse.

     "Largest link margin" read link.marginDb, which evalLink measures
     against the constellation the link ACHIEVES. That makes it a sawtooth
     confined to [marginReq, marginReq + one constellation step): measured
     on the live model, 16 dBm per element gives 27.41 dB of SNR carrying
     64QAM at 8.80 dB of margin, and 18 dBm gives 28.05 dB carrying 256QAM
     at 3.48 dB. The second system is better on SNR and better on
     constellation, and the objective ranked it LOWER. "Largest margin"
     systematically crowned whichever system had just failed to reach the
     next constellation.

     A relative tie window was the same disease: 2% of a 9.67 dB margin is
     0.19 dB, and 2% of a 0.147 deg residual is 0.003 deg — one is far too
     loose and the other far tighter than any input to it is known. */
  var OBJECTIVES = {
    rate:     { label: 'Highest data rate', unit: 'Gb/s', better: 'high', eps: 0.01,
                get: function (c) { return c.link.rateBps / 1e9; },
                why: 'Bits per symbol times the USABLE bandwidth, which is the RF bandwidth or the baseband network\'s own −3 dB bandwidth, whichever is narrower. Monotone: more SNR never lowers it. Its tie epsilon is nominal because the rate is quantised by the constellation anyway — equal rate means the same constellation.' },
    headroom: { label: 'Most SNR headroom', unit: 'dB', better: 'high', eps: 1.0,
                get: function (c) { return c.link.headroomDb; },
                why: 'SNR above what the LOWEST constellation needs, including the required margin. Monotone in received power, unlike margin against the achieved constellation, which resets at every constellation boundary. Ties inside 1 dB because the per-element transmit power is an engineering guess spanning 10–15 dBm and the implementation loss allowance spans 0–8 dB; a search cannot resolve tenths against that.' },
    power:    { label: 'Lowest distribution power', unit: 'W', better: 'low', eps: 0.5,
                get: function (c) { return (c.lo.powerTotalMw + c.bb.powerPerTileMw * c.nTiles) / 1000; },
                why: 'LO distribution plus baseband across the array. The antenna family draws none — that is the finding, not an omission. Ties inside 0.5 W because the block library reconciles disagreeing sources (the tile multiplier is booked from 80 and 92 mW figures).' },
    residual: { label: 'Lowest inter-tile residual', unit: '°', better: 'low', eps: 0.02,
                get: function (c) { return c.lo.interTileResidualDeg; },
                why: 'The phase error no calibration removes — the null-depth floor, and the spatial-multiplexing ceiling. Ties inside 0.02° because two independently built block libraries disagreed by 12 dB on additive phase noise, which the honesty ledger records.' },
    repeaters: { label: 'Fewest repeater amplifiers', unit: 'amps', better: 'low', eps: 0.5,
                get: function (c) { return c.lo.repeaters || 0; },
                why: 'Every one is a separate SiGe die on the board. A build-cost and yield proxy, not a price.' },
    radiators: { label: 'Fewest radiators', unit: 'radiators', better: 'low', eps: 0.5,
                get: function (c) { return c.ant.nRad || 0; },
                why: 'Metal and feed network across the panel. Separate from the amplifier count because they are different costs in different places — an earlier version blended them with an undocumented exchange rate, which is exactly what this view refuses to do elsewhere.' }
  };

  /* Each constraint is a named predicate so the attrition table can say
     which one killed what, rather than reporting a count of survivors and
     leaving the reader to guess. */
  function buildConstraints(q, budget, g0) {
    var cons = [];
    /* THE BASEBAND PAIRING IS GEOMETRY, NOT A PREFERENCE, so this constraint
       is not behind a query flag. Under 1:1 the tile's baseband is
       bbDiesPerTile separate dies, and a per-tile singleton cannot be sawn
       across them: it lands whole on one die together with that die's own
       share of the per-channel blocks. B5 stacks the entire converter and
       SerDes complex that way and reaches 95% core utilisation of a 6.25 mm²
       die, so it is EXCLUDED here rather than merely scored badly — a
       floorplan that does not close is not a worse option, it is not an
       option. Everything else sits between 4.7% and 9.3% and never notices
       this constraint exists. */
    if (g0) {
      cons.push({
        key: 'bbdie',
        label: 'Baseband fits the ' + g0.bbDieMm.toFixed(1) + ' mm die at ≤ ' +
          g0.bbDieUtilMaxPct.toFixed(0) + '% utilisation',
        test: function (c) { return c.bb.dieFits !== false; },
        distanceOf: function (c) { return c.bb.dieUtilPct - g0.bbDieUtilMaxPct; }, unit: '%'
      });
    }
    if (q.requireFeasible !== false) {
      /* ALL THREE families, not two. The baseband verdict was being ignored,
         so a combination whose baseband option is not realisable passed the
         "realisable" gate. */
      cons.push({ key: 'feasible', label: 'Realisable in the stated technology (all three families)',
        test: function (c) {
          return !/beyond the technology|extreme|NOT REALISABLE|not realisable/i
            .test(c.lo.feasibility + ' ' + c.bb.feasibility + ' ' + c.ant.feasibility);
        } });
    }
    if (isFinite(q.maxResidualDeg)) {
      cons.push({ key: 'residual', label: 'Inter-tile residual ≤ ' + q.maxResidualDeg.toFixed(2) + '°',
        test: function (c) { return c.lo.interTileResidualDeg <= q.maxResidualDeg; },
        distanceOf: function (c) { return c.lo.interTileResidualDeg - q.maxResidualDeg; }, unit: '°' });
    }
    if (isFinite(q.maxPowerPct)) {
      cons.push({ key: 'power', label: 'Distribution power ≤ ' + q.maxPowerPct.toFixed(0) + '% of the array budget',
        test: function (c) { return c.powerPct <= q.maxPowerPct; },
        distanceOf: function (c) { return c.powerPct - q.maxPowerPct; }, unit: '%' });
    }
    if (isFinite(q.minScanConeDeg) && q.minScanConeDeg > 0) {
      cons.push({ key: 'scan', label: 'Scan cone ≥ ' + q.minScanConeDeg.toFixed(0) + '°',
        test: function (c) { return c.ant.coneMinDeg >= q.minScanConeDeg; },
        distanceOf: function (c) { return q.minScanConeDeg - c.ant.coneMinDeg; }, unit: '°' });
    }
    if (isFinite(q.minBwGHz) && q.minBwGHz > 0) {
      cons.push({ key: 'bw', label: 'Radiator bandwidth ≥ ' + q.minBwGHz.toFixed(1) + ' GHz',
        test: function (c) { return c.ant.bwGHz >= q.minBwGHz; },
        distanceOf: function (c) { return q.minBwGHz - c.ant.bwGHz; }, unit: 'GHz' });
    }
    if (q.maxRisk && RISK_ORDER[q.maxRisk] !== undefined) {
      cons.push({ key: 'risk', label: 'Risk no worse than ' + q.maxRisk,
        test: function (c) { return Math.max(RISK_ORDER[c.lo.riskLevel] || 0,
          RISK_ORDER[c.bb.riskLevel] || 0, RISK_ORDER[c.ant.riskLevel] || 0) <= RISK_ORDER[q.maxRisk]; } });
    }
    if (q.minQamOrder > 0) {
      cons.push({ key: 'link', label: 'Link closes at ' + q.minQamName + ' over ' +
          q.rangeKm.toFixed(2) + ' km in ' + q.rainRateMmH.toFixed(0) + ' mm/h',
        test: function (c) { return c.link.best && c.link.best.order >= q.minQamOrder; },
        distanceOf: function (c) {
          var need = c.link.requirements.filter(function (r) { return r.order === q.minQamOrder; })[0];
          return need ? (need.snrDb + c.g.linkMarginReqDb) - c.link.snrEffDb : NaN;
        }, unit: 'dB of SNR' });
    }
    return cons;
  }

  function search(state, q, budget) {
    var cands = [];
    var perAnt = {};

    var antSet = searchAntConfigs(state);
    antSet.keep.forEach(function (a) {
      var st = {};
      for (var k in state) st[k] = state[k];
      st.antOption = ANT_IDS.indexOf(a.ant);
      st.radPerCh = a.k;
      st.radSpanPitch = a.span;
      var g = resolve(st);
      perAnt[a.ant + '|' + a.k + '|' + a.span] = { g: g, ant: evalAnt(a.ant, g), cfg: a };
    });

    Object.keys(perAnt).forEach(function (akey) {
      var pa = perAnt[akey], g = pa.g;
      LO_IDS.forEach(function (loId) {
        var loR = evalLo(loId, g);
        BB_IDS.forEach(function (bbId) {
          var bbR = evalBb(bbId, g);
          /* the three-way coupling: the beam needs all of them */
          var bm = window.Beam.evaluate(g, budget, loR, bbR, { light: true });
          var link = evalLink(g, loR, bm, bbR);
          var nT = g.nTilesTotal;
          var c = {
            loId: loId, bbId: bbId, antId: pa.cfg.ant,
            radPerCh: pa.cfg.k, spanning: !!pa.cfg.span,
            g: g, lo: loR, bb: bbR, ant: pa.ant, beam: bm, link: link, nTiles: nT,
            powerPct: (loR.powerTotalMw + bbR.powerPerTileMw * nT) / (g.arrayPowerW * 1000) * 100,
            
            blindJunctions: (pa.ant.blindJunctions || 0) * g.nElem,
            realisedDbi: bm.realisedDbi
          };
          cands.push(c);
        });
      });
    });

    /* ---- attrition: which constraint killed how many ---- */
    /* the die-budget params do not vary across the search, so one resolve is
       enough to label the constraint */
    var cons = buildConstraints(q, budget, resolve(state));
    var attrition = cons.map(function (cn) { return { key: cn.key, label: cn.label, killed: 0, soleKill: 0 }; });
    var survivors = [];
    cands.forEach(function (c) {
      var failed = [];
      cons.forEach(function (cn, i) { if (!cn.test(c)) { failed.push(i); attrition[i].killed++; } });
      c.failed = failed.map(function (i) { return cons[i].label; });
      if (!failed.length) survivors.push(c);
      else if (failed.length === 1) attrition[failed[0]].soleKill++;
    });

    /* ---- rank the survivors by the one chosen objective ---- */
    /* OBJECTIVES.margin has not existed since the sawtooth fix renamed it to
       `headroom`, so this fallback was dead: an unrecognised objective threw
       on `.get` instead of degrading. Fall back to one that exists. */
    var obj = OBJECTIVES[q.objective] || OBJECTIVES.headroom;
    survivors.forEach(function (c) { c.score = obj.get(c); });
    survivors = survivors.filter(function (c) { return isFinite(c.score); });
    survivors.sort(function (a, b) {
      return obj.better === 'high' ? b.score - a.score : a.score - b.score;
    });

    /* ---- ties, on the same principle decision.js already applies ----
       A search over 270 candidates built from parameters several of which
       are tagged engineering-guess cannot resolve a 1% difference. Anything
       within an absolute epsilon of the leader is reported as tied WITH it.
       The epsilon is ABSOLUTE and belongs to the objective, in the
       objective's own units, derived from the declared spread of the inputs
       that dominate it. A fraction of the leader's value is meaningless
       here: 2% of a 9.67 dB margin is 0.19 dB and 2% of a 0.147° residual
       is 0.003°, one far looser than the inputs justify and the other far
       tighter than anything is known to. */
    var eps = q.tieEps != null ? q.tieEps : (obj.eps != null ? obj.eps : 0);
    var tied = [];
    if (survivors.length) {
      var topScore = survivors[0].score;
      tied = survivors.filter(function (c) { return Math.abs(c.score - topScore) <= eps; });
    }

    /* ---- when nothing survives, which constraint is binding, and by how
       much would it have to move? The nearest miss on each constraint,
       measured only over candidates that failed nothing ELSE. ---- */
    var binding = null;
    if (!survivors.length && cands.length) {
      var best = null;
      cons.forEach(function (cn, i) {
        if (!cn.distanceOf) return;
        cands.forEach(function (c) {
          if (c.failed.length !== 1 || c.failed[0] !== cn.label) return;
          var d = cn.distanceOf(c);
          if (!isFinite(d)) return;
          if (!best || d < best.shortfall) best = { label: cn.label, shortfall: d, unit: cn.unit, cand: c };
        });
      });
      /* nothing failed on exactly one constraint — report the one that
         killed the most instead, and say that is what it is */
      if (!best) {
        var worst = attrition.slice().sort(function (a, b) { return b.killed - a.killed; })[0];
        binding = worst ? { label: worst.label, shortfall: NaN, killedMost: worst.killed } : null;
      } else {
        binding = best;
      }
    }

    return {
      candidates: cands, survivors: survivors, tied: tied,
      attrition: attrition, binding: binding, objective: obj, objectiveKey: q.objective,
      constraints: cons.map(function (c) { return c.label; }),
      total: cands.length, tieEps: eps,
      /* the space actually searched, and what was excluded before the
         constraints were even applied — a search that silently drops
         candidates cannot be checked */
      antKept: antSet.keep, antDropped: antSet.dropped,
      spaceNote: LO_IDS.length + ' LO × ' + BB_IDS.length + ' baseband × ' +
        antSet.keep.length + ' antenna = ' + cands.length
    };
  }

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
    /* The per-tile TOTAL is not the binding number once the baseband is four
       separate dies. A block whose count scales with the channel count
       distributes evenly across them; a per-tile SINGLETON cannot be sawn in
       four, so it lands whole on ONE die along with that die's own share of
       the per-channel blocks. The worst die is what has to fit 6.25 mm², and
       for B5 that is the entire converter and SerDes complex. Splitting the
       BOM this way is the only way the tool can see the difference between
       "1.3 mm² spread over four dies" and "5.95 mm² stacked on one". */
    var powerPerTileMw = 0, areaPerTileMm2 = 0;
    var areaSingletonMm2 = 0, areaDistributedMm2 = 0;
    (bb.bom || []).forEach(function (b) {
      var blk = BLOCKS[b.blockKey];
      if (!blk) return;
      powerPerTileMw += blk.powerMw * b.count;
      var a = (blk.areaMm2 || 0) * b.count;
      areaPerTileMm2 += a;
      if (blk.tileSingleton) areaSingletonMm2 += a; else areaDistributedMm2 += a;
    });
    var nBbDies = Math.max(1, g.bbDiesPerTile);
    var worstDieAreaMm2 = areaSingletonMm2 + areaDistributedMm2 / nBbDies;
    var dieUtilPct = 100 * worstDieAreaMm2 / Math.max(g.bbDieAreaMm2, 1e-9);
    var dieFits = dieUtilPct <= g.bbDieUtilMaxPct;
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
      /* Same kernel the BOM uses to COUNT the lanes, so the area the tile
         books and the power it burns describe one serial link rather than
         two different ones. */
      laneGbps = K.serdesLaneGbps(g.adcBits, g.adcGspsPerRail);
      lanes = K.serdesLanes(g.adcBits, g.adcGspsPerRail);
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
      areaSingletonMm2: areaSingletonMm2, areaDistributedMm2: areaDistributedMm2,
      worstDieAreaMm2: worstDieAreaMm2, dieUtilPct: dieUtilPct, dieFits: dieFits,
      bbDiesPerTile: nBbDies, lanesPerDir: bb.lanesPerDir || 0,
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
  function consistency(g, bbRes) {
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

    /* ---- the baseband die pairing ---- */
    /* Only checkable with a baseband result in hand, so callers that have one
       pass it and callers that do not simply skip this check rather than
       getting a wrong answer. searchAntConfigs deliberately passes nothing:
       it varies only the antenna, and a failing baseband option would
       otherwise drop every antenna configuration for an unrelated reason. */
    if (bbRes && isFinite(bbRes.dieUtilPct)) {
      var util = bbRes.dieUtilPct, lim = g.bbDieUtilMaxPct;
      if (util > lim) {
        out.push({
          severity: 'fail',
          message: 'The baseband does not fit its own silicon. One baseband die per RFIC die means ' +
            g.bbDiesPerTile + ' dies of ' + g.bbDieMm.toFixed(1) + ' × ' + g.bbDieMm.toFixed(1) +
            ' mm per tile, and a per-tile singleton cannot be spread across them — ' +
            bbRes.areaSingletonMm2.toFixed(2) + ' mm² of it lands whole on ONE die, plus that die\'s ' +
            (bbRes.areaDistributedMm2 / g.bbDiesPerTile).toFixed(2) + ' mm² share of the per-channel blocks, ' +
            'giving ' + bbRes.worstDieAreaMm2.toFixed(2) + ' mm² against ' + g.bbDieAreaMm2.toFixed(2) +
            ' mm² available: ' + util.toFixed(1) + '% core utilisation against a ' + lim.toFixed(0) +
            '% ceiling, before the pad ring, the seal ring and the routing channels. The per-tile TOTAL of ' +
            bbRes.areaPerTileMm2.toFixed(2) + ' mm² fits the ' + g.bbDieBudgetMm2.toFixed(1) +
            ' mm² budget comfortably, which is exactly why a per-tile figure cannot see this. Escaping it ' +
            'means a fifth die per tile carrying the shared blocks, and that is the 1:1 pairing broken.'
        });
      } else if (util > lim * 0.8) {
        out.push({
          severity: 'warn',
          message: 'The baseband uses ' + util.toFixed(1) + '% of one ' + g.bbDieMm.toFixed(1) +
            ' mm die against a ' + lim.toFixed(0) + '% ceiling — ' + bbRes.worstDieAreaMm2.toFixed(2) +
            ' mm² on the die carrying the ' + bbRes.areaSingletonMm2.toFixed(2) +
            ' mm² of per-tile singletons. Tight, not yet impossible.'
        });
      }
    }
    if (!g.bbChMatchesRf) {
      out.push({
        severity: 'warn',
        message: 'The pairing is 1:1 by die but not by channel: ' + g.bbIqChPerDie + ' IQ baseband channels ' +
          'against ' + g.chPerDiePerDir + ' real RF channels per direction on the die they pair with. ' +
          (g.bbIqChPerDie > g.chPerDiePerDir
            ? 'The surplus baseband channels have nothing to connect to, and they are being charged ' +
              'area and power: ' + g.bbAreaPerIqChMm2.toFixed(3) + ' mm² per IQ channel against the ' +
              (g.bbDieAreaMm2 / g.chPerDiePerDir).toFixed(3) + ' mm² the matched case allows. ' +
              (g.bbIqChPerDie === 2 * g.chPerDiePerDir
                ? 'At exactly 2× this is the old full-duplex reading — 4 RX plus 4 TX — which needs two ' +
                  'baseband dies per RFIC die and so is the 1:1 pairing broken, not satisfied.'
                : '')
            : 'Some RF channels have no baseband behind them, so the port count the beam model uses is ' +
              'not the count the baseband can actually weight.')
      });
    }

    if (g.tileCm > 10) out.push({
      severity: 'warn',
      message: 'A ' + g.tileCm.toFixed(1) + ' cm tile exceeds the 5–10 cm sub-tiling guidance: intra-tile residual delay is ' +
        K.apertureDelayPs(g.tileCm / 100, g.scanDegMax).toFixed(0) + ' ps at ' + g.scanDegMax +
        '° against the ~200 ps target, so phase-only steering inside the tile will not hold across the band.'
    });

    /* ---- the antenna arrangement inside one port cell ---- */
    var cellXmm = 10 * (Math.abs(g.lat.a1[0]) || g.elemDxCm);
    var cellYmm = 10 * (Math.abs(g.lat.a2[1]) || g.elemDyCm);
    var spanXmm = 10 * g.radKx * g.radPitchXCm, spanYmm = 10 * g.radKy * g.radPitchYCm;
    if (spanXmm > cellXmm + 1e-9 || spanYmm > cellYmm + 1e-9) out.push({
      severity: 'fail',
      message: g.radKx + '×' + g.radKy + ' radiators at ' + (g.radPitchXCm * 10).toFixed(2) +
        ' mm span ' + Math.max(spanXmm, spanYmm).toFixed(2) + ' mm, against a ' +
        Math.min(cellXmm, cellYmm).toFixed(2) + ' mm port cell. They do not fit. Reduce K, ' +
        'reduce the pitch, or use span mode, which derives the pitch as cell/K.'
    });
    if (g.radSpanning && Math.max(g.radKx, g.radKy) < (cellXmm / 10) / g.lamCm) out.push({
      severity: 'fail',
      message: 'Span mode needs at least cell/λ = ' + ((cellXmm / 10) / g.lamCm).toFixed(2) +
        ' radiators per axis, i.e. 4, and this has ' + Math.max(g.radKx, g.radKy) +
        '. Below that the derived pitch exceeds one wavelength and the subarray puts its OWN ' +
        'full-strength lobe at u = ' + (g.lamCm / g.radPitchXCm).toFixed(3) +
        ', inside visible space and on a grating-lobe row.'
    });
    if (g.radPerChClamped != null) out.push({
      severity: 'warn',
      message: 'Radiators per channel was ' + g.radPerChClamped + ', which ' +
        (ANT_META[Math.round(g.antOption)] || { short: 'this option' }).short +
        ' does not allow; it has been clamped to ' + g.radPerCh + '. The clamp is reported ' +
        'rather than silent because K changes the element directivity by 10log10(K).'
    });
    if (g.radPerCh > 1) {
      var footMm = Math.sqrt(Math.max(
        (BLOCKS[(g.antTraits && g.antTraits.radBlockKey) || 'antPatch'] || BLOCKS.antPatch).areaMm2, 0.01));
      var pitchMinMm = 10 * Math.min(
        g.radKx > 1 ? g.radPitchXCm : Infinity,
        g.radKy > 1 ? g.radPitchYCm : Infinity);
      if (footMm > pitchMinMm + 1e-9) out.push({
        severity: 'warn',
        message: 'The radiator\'s isolated footprint is ' + footMm.toFixed(2) + ' mm and the pitch it is ' +
          'being packed at is ' + pitchMinMm.toFixed(2) + ' mm, so they do not physically fit side by side. ' +
          'This is the SAME fact that makes K close-packed radiators reach only ' +
          g.dElDbi.toFixed(2) + ' dBi instead of the naive ' + (g.radUnitDbi + 10 * Math.log10(g.radPerCh)).toFixed(2) +
          ' dBi: an isolated ' + g.radUnitDbi.toFixed(2) + ' dBi patch claims more area than this cell can hold. ' +
          'The directivity already accounts for it — the pattern integral is what it is — but the FOOTPRINT ' +
          'does not, so a real layout needs a physically smaller radiator here and its isolated directivity ' +
          'would be lower than the parameter says. The map draws them capped to the pitch rather than ' +
          'overlapping.'
      });
    }
    if (g.radPerCh > 1 && g.radPitchLam < 0.4 && !g.radSpanning) out.push({
      severity: 'warn',
      message: 'A ' + g.radPitchLam.toFixed(2) + 'λ radiator pitch is below λ/2. Crowding ' +
        'radiators closer buys almost no directivity — the pattern integral saturates on ' +
        'footprint, not on count — and it buys a great deal of mutual coupling, which this ' +
        'model does not carry at all.'
    });
    if (g.elem && g.dElDbi > g.dCellDbi + 1e-6) out.push({
      severity: 'info',
      message: 'The element integrates to ' + g.dElDbi.toFixed(4) + ' dBi against a cell ceiling of ' +
        g.dCellDbi.toFixed(4) + ' dBi. That is expected, not an error: 4πA/λ² is an obliquity-free ' +
        'broadside bound and this pattern carries cos θ, so a cell-spanning subarray integrates a ' +
        'few hundredths past it. It is reported rather than clamped, because clamping would break ' +
        'the identity thinning = cell ceiling − element directivity.'
    });
    if (g.elem && g.radPerCh > 1) {
      var uS = Math.sin(K.deg2rad(g.beamScanDeg));
      var pS = g.elem.powAt(uS, 0), pB = g.elem.powAt(0, 0);
      if (pB > 0 && pS < 1e-6 * pB) out.push({
        severity: 'fail',
        message: 'The beam is steered to ' + g.beamScanDeg + '°, which lands in the SUBARRAY\'S OWN ' +
          'NULL. A ' + g.radKx + '-wide group at ' + g.radPitchXCm.toFixed(3) + ' cm nulls at ' +
          'sin θ = λ/(K·p) multiples, and the steer angle is one of them, so the array radiates ' +
          'essentially nothing in the direction it is pointed. This is the cost of a FIXED feed ' +
          'behind a steered port, and it is why subarraying across the scan plane is the wrong axis.'
      });
    }
    if (g.antConeMinDeg < g.scanDegMax) out.push({
      severity: 'warn',
      message: 'The element\'s worst-plane −3 dB half-cone is ' + g.antConeMinDeg.toFixed(1) +
        '° against a ' + g.scanDegMax + '° scan requirement. The subarray feed is fixed at ' +
        'broadside, so the array can still be steered there — it just arrives ' +
        (g.elem ? (-10 * Math.log10(Math.max(g.elem.powAt(Math.sin(K.deg2rad(g.scanDegMax)), 0), 1e-9))).toFixed(1) : '?') +
        ' dB down. This is the gain-for-scan trade the antenna family exists to show, not a fault.'
    });
    if (Math.round(g.latticePeriodic) === 0 && g.radAreaPctOfCell > 50) out.push({
      severity: 'warn',
      message: 'The radiators occupy ' + g.radAreaPctOfCell.toFixed(0) + '% of each cell, so there ' +
        'is no room left to dither their positions. The aperiodic-lattice escape route needs ' +
        'physical space to move elements into, and this arrangement has none.'
    });
    if (g.antTrSeparate) out.push({
      severity: 'info',
      message: 'Separate TX and RX radiator groups halve the cell available to each direction, so ' +
        'the per-direction ceiling is ' + g.dCellPerDirDbi.toFixed(2) + ' dBi rather than ' +
        g.dCellDbi.toFixed(2) + ' — 3.01 dB lower — and the legal radiator count per direction halves.'
    });
    if (!g.antBandOk) out.push({
      severity: 'warn',
      message: 'The radiator covers ' + g.antBwGHz.toFixed(1) + ' GHz (' + g.antFracBwPct.toFixed(1) +
        '%) against a stated requirement of ' + g.antBandReqGHz.toFixed(1) + ' GHz. 71–86 GHz is ' +
        '15 GHz; a single-layer package patch is about 4%. Either the link is fixed-frequency — in ' +
        'which case set the requirement to the 2 GHz instantaneous bandwidth — or the radiator has ' +
        'to be a wideband one.'
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
    var lo = {}, bb = {}, ant = {};
    if (only) {
      lo[g.loOptionId] = evalLo(g.loOptionId, g);
      bb[g.bbOptionId] = evalBb(g.bbOptionId, g);
      ant[g.antOptionId] = evalAnt(g.antOptionId, g);
    } else {
      LO_IDS.forEach(function (id) { lo[id] = evalLo(id, g); });
      BB_IDS.forEach(function (id) { bb[id] = evalBb(id, g); });
      ANT_IDS.forEach(function (id) { ant[id] = evalAnt(id, g); });
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
      g: g, lo: lo, bb: bb, ant: ant, selected: selected, partial: only,
      blocks: BLOCKS, refSources: REF_SOURCES, warnings: consistency(g, bb[g.bbOptionId])
    };
  }

  window.Model = {
    PARAMS: PARAMS, HOT_PARAMS: HOT_PARAMS, BLOCKS: BLOCKS, REF_SOURCES: REF_SOURCES,
    LO_IDS: LO_IDS, BB_IDS: BB_IDS, LO_META: LO_META, BB_META: BB_META,
    ANT_IDS: ANT_IDS, ANT_META: ANT_META, ANT_TRAITS: ANT_TRAITS,
    MEDIA_KEYS: MEDIA_KEYS,
    resolve: resolve, evaluate: evaluate, evalLo: evalLo, evalBb: evalBb,
    evalAnt: evalAnt, evalLink: evalLink, consistency: consistency,
    search: search, OBJECTIVES: OBJECTIVES, searchAntConfigs: searchAntConfigs,

    /* SELF-TESTS, shipped as assertions rather than as a comment claiming
       they passed once. There are exactly two ways the antenna family can
       silently destroy this tool — conflating the port lattice with the
       radiator lattice, and regressing C1 — so both are asserted. */
    selfTest: function () {
      var fails = [];
      function eq(what, got, want, tol) {
        if (!(Math.abs(got - want) <= (tol == null ? 1e-9 : tol))) {
          fails.push(what + ': got ' + got + ', expected ' + want);
        }
      }
      var st = {};
      PARAMS.forEach(function (p) { st[p.key] = p.value; });
      var res = evaluate(st);
      /* (i) the port lattice is invariant across every antenna option */
      ANT_IDS.forEach(function (id) {
        var a = res.ant[id];
        eq('ports/tile @' + id, a.portsPerTile, 16);
        eq('nPorts @' + id, a.nPorts, 400);
        eq('lobeCount @' + id, a.lobeCount, res.ant['single-patch'].lobeCount);
      });
      eq('aCellCm2', res.g.aCellCm2, 2.25, 1e-9);
      /* (ii) C1 reproduces the pre-antenna-family numbers exactly */
      var c1 = res.ant['single-patch'];
      eq('C1 dElDbi', c1.dElDbi, 6, 1e-12);
      eq('C1 thinning', c1.thinningLossDb, 16.8194, 5e-4);
      eq('C1 feed loss', c1.feedLossDb, 0, 1e-12);
      eq('C1 realised', c1.realisedGainDbi, 28.0206, 5e-4);
      /* (iii) the lattice is centred in its tile, and centring it moved
         nothing. The offsets must be symmetric about the tile centre, and
         a further rigid translation must leave every pattern quantity
         alone — that invariance is the whole licence for having shifted
         them, so it is asserted rather than asserted-in-a-comment. */
      (function () {
        var offs = res.g.latOffsetsCm, P = res.g.tileCm;
        var lo = Infinity, hi = -Infinity;
        offs.forEach(function (o) { lo = Math.min(lo, o[0]); hi = Math.max(hi, o[0]); });
        eq('lattice centred in x', lo + hi, P, 1e-9);
        if (lo < 0 || hi > P) fails.push('lattice x out of tile: ' + lo + '..' + hi + ' of ' + P);
        var bud = window.Budget.derive(res.g);
        var base = window.Beam.evaluate(res.g, bud, res.lo[res.g.loOptionId], res.bb[res.g.bbOptionId], { light: true });
        var g2 = {};
        for (var k in res.g) g2[k] = res.g[k];
        g2.latOffsetsCm = offs.map(function (o) { return [o[0] + 0.37, o[1] - 0.21]; });
        var moved = window.Beam.evaluate(g2, bud, res.lo[res.g.loOptionId], res.bb[res.g.bbOptionId], { light: true });
        eq('translation invariance: HPBW', moved.m.hpbwDeg, base.m.hpbwDeg, 1e-9);
        eq('translation invariance: scan loss', moved.scanLossDb, base.scanLossDb, 1e-9);
        eq('translation invariance: realised', moved.realisedDbi, base.realisedDbi, 1e-9);
        eq('translation invariance: sidelobe', moved.m.sllDb, base.m.sllDb, 1e-9);
      })();
      /* (iv) the quadrature ratio is exactly 1 at K=1 for BOTH unit kinds */
      [0, 1].forEach(function (m) {
        var e = window.Lat.element({
          key: window.Lat.KIND_KEYS[m], lamCm: res.g.lamCm,
          a1: res.g.lat.a1, a2: res.g.lat.a2, elemDirDbi: 6, dUnitDbi: 6,
          hpbwDeg: 70, kx: 1, ky: 1
        });
        eq('K=1 exactness, kind ' + window.Lat.KIND_KEYS[m], e.dElDbi, 6, 1e-12);
      });
      return fails;
    }
  };
})();
