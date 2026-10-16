# seguar.github.io

A home page and static tools, served from this repository at <https://seguar.github.io/>.

| Path | Page |
|:---|:---|
| [`/`](https://seguar.github.io/) | **Home page** — a short about, links to the tools below and to my projects on GitHub |
| [`/radar-sim/`](https://seguar.github.io/radar-sim/) | **MIMO/FMCW Radar Simulator** — single-page simulator for first-order MIMO FMCW radar sizing (it used to be served at `/`) |
| [`/eband-distribution/`](https://seguar.github.io/eband-distribution/) | **E-Band Distribution Comparison Tool** — interactive hardware map and parameterized model for LO/reference and baseband distribution in a tiled E-band array |
| [`/rfsoc-pulse-array/`](https://seguar.github.io/rfsoc-pulse-array/) | **ZU67DR Pulse Array** — interactive design walkthrough for a 4-module RFSoC pulse generator with 32 RF-DAC and 32 one-bit outputs |
| [`/esp32-c5-phased-array/`](https://seguar.github.io/esp32-c5-phased-array/) | **ESP32-C5 Phased Array** — student-project proposal and design walkthrough for a 16-element 5.2 GHz digital array built from ESP32-C5 radios |

To add a tool or a repository to the home page, copy an entry in `index.html`;
the HTML comments above the tools list and the repository list say what to change.
Tool thumbnails live in `assets/img/` (1200×750 JPEG). `favicon.ico` at the
root is the fallback icon for every page that does not set its own; the home
page also links `favicon.svg` and `apple-touch-icon.png`. Keep the three in sync.

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

The page walks through 14 stages from concept to roadmap: system and module
diagrams, findings from the card schematic, the carrier block schematic with
clickable nets and parts, a pulse-fidelity lab, a trigger-alignment simulator,
the daisy-chain option, the frequency plan and power budget, mechanics with a
3D model, scaling and the parts list. Choosing a module count in one stage
updates the others.

One HTML file with no build step needed to serve it; the 3D view loads
three.js from a CDN and the fonts come from Google Fonts. Part numbers are
first candidates to check against datasheets, and dimensions and power figures
are estimates until the hardware is measured.

## ESP32-C5 Phased Array

Student-project proposal for a low-cost 16-element 4 × 4 digital array at
5.2 GHz, inspired by ESPARGOS and ESP-SDR. Every element is an ESP32-C5
transceiver; the array is two 8-element tiles, and in each tile eight 2-bit
PARLIO lanes feed one ESP32-S31 that forwards about 640 Mbit/s over one
Gigabit port. A master board shares the 48 MHz reference, the 40 MHz PARLIO
clock, the capture trigger and a 5.2 GHz calibration tone.

The page walks through synchronization, calibration, the data path and its
rate budget, the tile PCB with an interactive 3D model of the tile and the two-tile array
(antennas only on the front, each ESP32-C5 behind its own patch, equal RF paths), experiments (receive beamforming with a steering
slider, radar, communications, transmit), costs, the bench tests that decide
the design, and the staged plan. Every claim carries a status — confirmed,
inference, open or speculative — backed by
[`esp32-c5-phased-array/evidence.html`](esp32-c5-phased-array/evidence.html).
The slide deck (PDF and PowerPoint) is in
[`esp32-c5-phased-array/deck/`](esp32-c5-phased-array/deck/), and the Python
that builds both the deck and the page is in
[`esp32-c5-phased-array/deck-src/`](esp32-c5-phased-array/deck-src/).
