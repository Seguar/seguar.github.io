# seguar.github.io

Static tools, served from this repository at <https://seguar.github.io/>.

| Path | Tool |
|:---|:---|
| [`/`](https://seguar.github.io/) | **Multi-Domain Radar Simulator (MIMO/FMCW)** — single-page simulator |
| [`/eband-distribution/`](https://seguar.github.io/eband-distribution/) | **E-Band Distribution Comparison Tool** — interactive hardware map and parameterized model for LO/reference and baseband distribution in a tiled E-band array |
| [`/rfsoc-pulse-array/`](https://seguar.github.io/rfsoc-pulse-array/) | **ZU67DR Pulse Array** — interactive design walkthrough for a 4-module RFSoC pulse generator with 32 RF-DAC and 32 one-bit outputs |

## E-Band Distribution Comparison Tool

Candidacy deliverable *"Distribution comparison tool — September"* for
**New Hardware Architectures and Hybrid OTA + BIST Calibration for Large E-Band
Massive MIMO Arrays**.

Pick a connection type and a reference clock and see the build drawn on a
floorplan of the 30 cm aperture — both the LO/reference tier and the baseband
tier, with the RFIC dies and their 78 GHz LO taps to scale. Every candidate
architecture gets numbers for phase noise, jitter, inter-tile phase error,
skew, loss and power, and the recorded decision is in
[`eband-distribution/DECISION.md`](eband-distribution/DECISION.md).

No build step and no dependencies — see
[`eband-distribution/README.md`](eband-distribution/README.md) for the model,
the equations, and the honesty ledger listing which numbers are datasheet-grade
and which are engineering estimates.

## ZU67DR Pulse Array

Design walkthrough for a pulse generator built from four HamGeek XCZU67DR
RFSoC cards, each plugged into a custom AFE + PA carrier board: 32 RF-DAC
outputs and 32 one-bit GTY outputs, 1 MHz–5 GHz, 3 V into 50 Ω, with a DC
level per channel and a shared reference and SYSREF for multi-board sync.

The page walks through 13 stages from concept to roadmap: system and module
diagrams, findings from the card schematic, the carrier block schematic with
clickable nets and parts, a pulse-fidelity lab, a trigger-alignment simulator,
the frequency plan and power budget, mechanics, scaling and the parts list.
Choosing a module count in one stage updates the others.

One self-contained HTML file, no build step needed to serve it. Part numbers
are first candidates to check against datasheets, and dimensions and power
figures are estimates until the hardware is measured.
