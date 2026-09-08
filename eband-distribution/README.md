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

> **Live tool:** enable GitHub Pages for this repository (Settings → Pages →
> *Source: GitHub Actions*) and it deploys from `main` with no build step.

---

## What it compares

**Family A — clock/reference and LO distribution**

| id | Architecture |
|:---|:---|
| `local-pll`   | Local PLL per tile + low-frequency reference distribution |
| `hf-foldback` | High-frequency (near-E-band) LO distribution / foldback |
| `daisy-chain` | Daisy-chained LO, tile to tile |
| `mid-mult`    | Mid-frequency LO distribution + per-tile ×M multiplier |

**Family B — baseband split/combine**

| id | Architecture |
|:---|:---|
| `passive-50`    | Passive 50 Ω corporate network (Wilkinson / resistive) |
| `bb-daisy`      | Baseband daisy chain |
| `h-tree-active` | H-tree with active splitter/combiner cells |

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
  Below: the intra-tile baseband network drawn for one tile's 32 channels, a
  live cost strip, and a hardware bill of materials with block counts and
  per-block power taken from the drawn topology.
- **Compare** — the full metric tables, M1–M6, for all seven options.
- **Phase noise** — three L(f) overlays: absolute per tile, inter-tile
  differential (the curve that decides the architecture), and array-output
  (where uncorrelated noise has averaged down by 10log10 N).
- **Sweeps** — multiplication factor, PLL loop bandwidth, BIST update rate,
  tile count, length tolerance, aperture.
- **Decision** — the written recommendation, regenerated from the live numbers,
  with the scoring weights shown as the editable judgement they are.
- **Assumptions** — every parameter and every block with its provenance and
  confidence label, plus the honesty ledger.
- **Method** — the equations, and the three rules the model enforces.

## Repository layout

```
index.html            the tool (single page, tabbed views)
assets/style.css      stylesheet
js/kernels.js         shared physics kernels (line loss, PLL PN, integration,
                      correlation/calibration kernels, Ruze, squint, EVM)
js/topology.js        the physical construction of each network — ONE generator
                      feeding both the map and the numbers
js/model.js           global parameters, block library, reference-clock menu,
                      and the seven option evaluations
js/budget.js          derivation of the requirement the options are judged on
js/decision.js        the written recommendation, with live numbers
js/diagram.js         the interactive hardware map, inspector and BOM
js/charts.js          dependency-free inline-SVG plotting
js/ui.js              parameter panel, tables, provenance ledger
js/export.js          permalink state, CSV / Markdown export
js/content.js         method and honesty-ledger prose
js/app.js             state, routing, rendering
DECISION.md           the written decision, standalone
build-standalone.ps1  optional: inline everything into dist/index.html
```

No build step, no dependencies, no network calls — the repo root **is** the
site. Serve it with any static server, or run `build-standalone.ps1` to inline
everything into a single `dist/index.html` you can open straight off disk
(browsers block `<script src>` from `file://` in some contexts, which is the
only reason that script exists).

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
