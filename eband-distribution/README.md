# E-Band Distribution Comparison Tool

An **interactive hardware map** plus a parameterized model. Pick a connection
type and a reference clock, and see on a floorplan of the aperture how the
build actually looks in hardware — where the source sits, how the trunks and
branches route, which blocks land at which tile, what each tile's path costs,
and what breaks if a block dies. Every candidate clock/reference + LO
distribution architecture and every candidate baseband split/combine
architecture for a large tiled E-band (71–86 GHz) phased array gets **numbers**
next to it, and the tool records **which one we take and why**.

The map and the tables share **one topology generator**, so the path lengths
drawn are literally the path lengths the loss, skew and power figures use —
the picture and the numbers cannot drift apart.

> **Decision:** mid-frequency distribution at 19.5 GHz with a per-tile ×4
> multiplier, and an H-tree active baseband network. Full rationale in
> [DECISION.md](DECISION.md).

Built for the candidacy deliverable *"Distribution comparison tool — September"*
of **New Hardware Architectures and Hybrid OTA + BIST Calibration for Large
E-Band Massive MIMO Arrays** (S. Efimov, adviser Prof. E. Cohen, Technion HFIC).

> **Live tool:** <https://seguar.github.io/eband-distribution/>. It is the
> `eband-distribution/` folder of the `seguar.github.io` repository, which
> GitHub Pages publishes as a branch deploy from `main` — no workflow file and
> no build step.

---

## What it compares

**Family A — clock/reference and LO distribution**

| id | Architecture |
|:---|:---|
| `local-pll`   | Local PLL per tile + low-frequency reference distribution |
| `hf-foldback` | High-frequency (near-E-band) LO distribution / foldback |
| `daisy-chain` | Daisy-chained LO, tile to tile |
| `mid-mult`    | Mid-frequency LO distribution + per-tile ×M multiplier |
| `stabilised-link` | Mid-frequency tree **with a return path**: the master reads twice the one-way path phase and pre-corrects it, so the line cancels its own drift |
| `inj-lock`    | Injection-locked tile oscillator — no PFD, no charge pump, no divider, and a lock corner hundreds of MHz wide |
| `radial-feed` | Radial equal-path feed: one N-way junction at the centre, every run meander-equalised to the corner radius, so the path-delay spread is zero — paid for in copper and in a load-dependent port-mismatch error, because the junction has no isolation resistors |

**Family B — baseband split/combine**

| id | Architecture |
|:---|:---|
| `passive-50`    | Passive 50 Ω corporate network (Wilkinson / resistive) |
| `bb-daisy`      | Baseband daisy chain |
| `h-tree-active` | H-tree with active splitter/combiner cells |
| `current-mode`  | Virtual-ground current summing — one node, one TIA per rail, the impedance regime rather than another topology |
| `digital-tile`  | Digitise at the tile and send bits: no analog inter-tile tier at all |

**Family C — antenna arrangement behind each RF port**

| id | Architecture |
|:---|:---|
| `single-patch`   | One package patch per RF channel — the original assumption |
| `cross-column`   | A 1×K patch column across the scan plane, fed from one channel through a fixed tree |
| `square-cluster` | A Kx×Ky patch cluster behind one port, pitch swept up to spanning the whole cell |
| `board-radiator` | One wider-band radiator per channel on its own board, reached through an E-band transition |

The die is taped out with 4 RF channels per direction, so family C cannot
change the port count, the port lattice or the grating lobes; it changes the
element pattern, its directivity and how much of each cell actually radiates.

A1–A4 and B1–B3 are the candidates from the proposal. A5, A6, B4 and B5 were
added after a deliberate sweep of the wider design space, and A7 after the
radial feed's original rejection turned out not to survive reading the code
(the honesty ledger on the Assumptions tab records why). The same section
lists what else was considered — photonic LO, space-fed illumination, coupled
oscillators, per-tile DDS, fully-digital-per-element and others — and why each
is *not* a column. "We costed it and it lost" is a different statement from
"we did not think of it," and only the first is worth anything in a defence.

## What it reports

Every option gets a number for all of these, recomputed live from editable
component parameters:

| id | Metric |
|:---|:---|
| **M1** | Phase noise `L(f)` at the 78 GHz carrier, curve plus values at 1 kHz … 100 MHz offsets |
| **M2** | Integrated RMS phase error (deg) and RMS jitter (fs) over a stated integration band |
| **M3** | Inter-tile phase error at 78 GHz — **raw** and **residual after BIST calibration** |
| **M4** | Inter-tile skew — ps RMS, ps peak, systematic part, and degrees at 78 GHz |
| **M5** | Distribution loss — total dB, dB/cm, and the compensating gain required |
| **M6** | Power — total mW, mW/tile, and fraction of the array power budget |

Plus, per option: area/tile, calibration burden, thermal drift sensitivity, and
the resulting **beam-level** consequences (array gain loss, RMS sidelobe level,
pointing error, EVM, highest supportable QAM order).

The tool also derives the **requirement** the options are judged against — the
inter-tile phase-error, skew and EVM budget implied by a 30 cm aperture at
78 GHz with sub-degree pointing — and marks which constraint binds.

## Design rules the model obeys

These are the places this kind of comparison usually goes wrong, so they are
enforced explicitly and are visible in the Method tab:

- **Correlated vs uncorrelated phase noise.** Noise from a shared source is
  common-mode across tiles and cancels in the inter-tile differential; noise
  from independent per-tile oscillators does not. Only the uncorrelated part
  degrades the beam. Tracked separately throughout.
- **Static error vs drift vs irreducible noise.** A static offset is removed by
  one calibration; slow drift is tracked by BIST at its update rate, leaving a
  residual; random noise above the calibration loop bandwidth is irreducible.
  Reported separately — a large calibratable error is not the same problem as a
  small uncalibratable one.
- **Multiplier algebra.** An ×M multiplier adds exactly `20·log10(M)` to `L(f)`
  and multiplies any distributed phase error by M. Distributing at `78/M` GHz
  therefore buys **no** skew relief for a given physical length mismatch — it
  buys loss, power and packaging tolerance. The tool states this rather than
  quietly claiming a skew win.
- **Integration limits are parameters,** not hidden constants. The lower limit
  for an EVM number is the carrier-recovery loop bandwidth; the lower limit for
  a beam-error number is the calibration update rate. Different questions,
  different bands.
- **Every default carries provenance.** Each parameter is labelled
  `datasheet` / `literature` / `scaled-estimate` / `guess`. See the Assumptions
  tab and the honesty ledger before quoting anything.

## The views

Thirteen, in the order of the bar at the top. Glossary terms such as L(f),
TTD or "wraps" are marked at their first occurrence in each block of text or
table; click one for its definition.

- **Start** — the landing page: the three families, the live verdict, and
  three ways in (Decision, Hardware map, Compare) by what you came to do.
- **Hardware map** — the floorplan, with **both** distribution tiers drawn on
  the one aperture:
  - the **LO / reference** tier enters from the source below and lands at each
    tile centre. Line weight and colour encode the frequency each segment
    carries, so what is actually on the board is visible at a glance — thin
    blue for a 100 MHz reference, thick orange for E-band.
  - the **baseband** tier (dashed, offset to the lower right of each tile) runs
    up to the RFSoC backend above, and its inter-tile wiring changes with the
    option: a flat **star** for the resistive network, a **serpentine bus** for
    the daisy chain, a hierarchical **H-tree** for the active one.

  Toggle either layer, colour the tiles by phase error, skew, path loss or
  power, and click any tile to inspect both tiers for it — routed length, tree
  level or chain hop, repeaters in path, loss, skew, phase error and power.
  Below: the intra-tile baseband network drawn for one tile's channels (16 at
  the defaults: 4 baseband dies × 4 IQ channels), a live cost strip, and a
  hardware bill of materials with block counts and per-block power taken from
  the drawn topology.
- **Inside a tile** — one tile cropped from the same drawing, with an
  every-tier inspector; its baseband dies and RFIC die drawn to one scale;
  the baseband die's blocks from the bill of materials; and the intra-tile
  baseband network.
- **Compare** — the full metric tables for all sixteen options: the seven LO
  options against M1–M6, the five baseband options, and the four antenna
  arrangements. Above them, the live recommendation and what the selected
  build is good and bad at; below, headline bar charts.
- **Phase noise** — three L(f) overlays for all seven LO options: absolute per
  tile, inter-tile differential (the curve that decides the architecture), and
  array-output (where uncorrelated noise has averaged down by 10log10 N); plus
  integrated phase error and jitter.
- **TX / RX beam** — what the selected build does to the beam: pattern and
  statistics, the full 2-D grating-lobe map, the in-tile lattice, both
  principal planes over the hemisphere, the main beam zoomed (mean pattern
  against one realisation), squint across the signal band, and what the
  pattern leaves out.
- **Sweeps** — multiplication factor, PLL loop bandwidth, BIST update rate,
  tile count, length tolerance (as correction range), aperture.
- **Decision** — the written recommendation, regenerated from the live numbers,
  with the scoring weights shown as the editable judgement they are.
- **Assumptions** — every parameter and every block with its provenance and
  confidence label, plus the honesty ledger, which also records the design
  space that was considered and deliberately left out.
- **Systems** — several *whole parameter sets* side by side. Name a
  configuration in the main window, press **Save system**, change things,
  save again; this view puts one column per saved system across the LO,
  baseband, power, skew and beam metrics, shows which *inputs* differ, and
  can be reduced to differences only or to deltas from a chosen baseline.

  Three things it deliberately does that a naive comparison table does not.
  The derived requirement is a *function of the parameters* — the inter-tile
  budget follows from the array geometry and the EVM allocation — so it gets
  its own panel above the results, pass/fail is judged per column against
  that column's own requirement, a **margin to requirement** row carries the
  quantity that is comparable when the thresholds are not, and the
  best-in-row marker is suppressed on any row whose threshold moves between
  columns. A saved system stores its **whole** state rather than a diff from
  the defaults, so it keeps the numbers it was costed with; parameters added
  to the tool after a system was saved are filled from today's defaults and
  flagged as filled. And each system's consistency warnings travel with it,
  so a configuration demanding more LO taps than there are dies is marked
  *inconsistent* in its own column instead of quietly reporting inflated
  power and area.

  **Load the realistic shortlist** replaces the saved set with nine curated
  architectures spanning the LO, baseband, antenna and RF-bandwidth axes,
  each chosen to show something no other one does.
- **Link calculator** — the selected build in front of a real path: a
  verdict, the link budget line by line with every term derived, range in
  clear air and in rain, what each constellation needs, and what the
  calculator does not model.
- **Chooser** — state the constraints and it searches every combination of
  LO, baseband and antenna, ranks the survivors by *one* objective you pick
  (never a blend), shows what each constraint killed, and plots the trade
  between link margin and beam coherence.
- **Method** — the equations and the three rules the model enforces.

## Repository layout

```
index.html            the tool (single page, tabbed views)
assets/style.css      stylesheet
js/kernels.js         shared physics kernels (line loss, PLL PN, integration,
                      correlation/calibration kernels, Ruze, squint, EVM)
js/topology.js        the physical construction of each network — ONE generator
                      feeding both the map and the numbers
js/lattice.js         the 2-D element lattice, its grating-lobe set, and the
                      element-pattern models
js/model.js           global parameters, block library, reference-clock menu;
                      the LO (A1–A7), baseband (B1–B5) and antenna (C1–C4)
                      evaluations, the link budget, consistency checks, the
                      Chooser's search and the self-test
js/systems.js         saved systems: storage, serialisation, evaluation cache
js/shortlist.js       the nine curated architectures the Systems view loads
js/budget.js          derivation of the requirement the options are judged on
js/beam.js            the beam pattern of the selected build: lobes, errors,
                      squint
js/decision.js        the written recommendation, with live numbers
js/diagram.js         the interactive hardware map, inspector and BOM
js/charts.js          dependency-free inline-SVG plotting
js/ui.js              parameter panel, tables, provenance ledger
js/export.js          permalink state, CSV / Markdown export
js/glossary.js        term definitions, marked in the text and opened on click
js/content.js         method and honesty-ledger prose
js/app.js             state, routing, rendering
DECISION.md           the written decision, standalone
build-standalone.ps1  optional: inline everything into dist/index.html
dist/index.html       the generated single-file copy
```

No build step and no JavaScript dependencies: this folder **is** the page,
published at `/eband-distribution/` on seguar.github.io. Its only network
dependency is the IBM Plex fonts, loaded from Google Fonts; offline it falls
back to system fonts. Serve the folder with any static server, or run
`build-standalone.ps1` to inline the stylesheet and scripts into an optional
single `dist/index.html` you can open straight off disk (browsers block
`<script src>` from `file://` in some contexts, which is the only reason that
script exists). The copy still takes its fonts from Google Fonts.

## Reproducibility

Any parameter change is captured in the URL fragment, so a specific set of
numbers is citable. **Copy permalink** puts that URL on the clipboard; only
values that differ from the defaults are stored, so links stay short and a
later change to a default does not silently freeze an old value.

Every table exports as CSV or as a Markdown table ready to paste into the
thesis, with the confidence labels intact.

## Status

The model is an **architecture-selection instrument, not a validated
simulator.** Its defaults are anchored to published mmWave IC results and
laminate datasheets where those exist, and are explicitly labelled as estimates
where they do not. It is meant to be re-run against measured numbers as chip
and tile bring-up produces them — the parameters most in need of measurement
are listed in the honesty ledger.

## License

MIT — see `LICENSE`.
