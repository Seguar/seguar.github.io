# seguar.github.io

Static tools, served from this repository at <https://seguar.github.io/>.

| Path | Tool |
|:---|:---|
| [`/`](https://seguar.github.io/) | **Multi-Domain Radar Simulator (MIMO/FMCW)** — single-page simulator |
| [`/eband-distribution/`](https://seguar.github.io/eband-distribution/) | **E-Band Distribution Comparison Tool** — interactive hardware map and parameterized model for LO/reference and baseband distribution in a tiled E-band array |

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
