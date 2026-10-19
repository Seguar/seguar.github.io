# seguar.github.io

A home page and static tools, served from this repository at <https://seguar.github.io/>.

| Path | Page |
|:---|:---|
| [`/`](https://seguar.github.io/) | **Home page** — a short about, links to the tools below and to my projects on GitHub |
| [`/radar-sim/`](https://seguar.github.io/radar-sim/) | **MIMO/FMCW Radar Simulator** — single-page simulator for first-order MIMO FMCW radar sizing (it used to be served at `/`) |
| [`/eband-distribution/`](https://seguar.github.io/eband-distribution/) | **E-Band Distribution Comparison Tool** — interactive hardware map and parameterized model for LO/reference and baseband distribution in a tiled E-band array |
| [`/rfsoc-pulse-array/`](https://seguar.github.io/rfsoc-pulse-array/) | **ZU67DR Pulse Array** — interactive design walkthrough for an RFSoC pulse generator of 1, 2, 4 or 8 modules (32 RF-DAC and 32 one-bit outputs with the default four) |
| [`/esp32-c5-phased-array/`](https://seguar.github.io/esp32-c5-phased-array/) | **ESP32-C5 Phased Array** — student-project proposal and design walkthrough for a 16-element 5.2 GHz digital array built from ESP32-C5 radios |

GitHub Pages serves the repository as it is from the root of `main`
(`.nojekyll` turns off the Jekyll build), so every push to `main` goes straight
to the live site.

To add a tool or a repository to the home page, copy an entry in `index.html`;
the HTML comments above the tools list and the repository list say what to change.
Tool thumbnails live in `assets/img/` (1200×750 JPEG). `favicon.ico` at the
root is the fallback icon for every page that does not set its own; the home
page also links `favicon.svg` and `apple-touch-icon.png`. Keep the three in sync.

## MIMO/FMCW Radar Simulator

First-order sizing for a MIMO FMCW radar. Pick one of five band presets
(3–94 GHz), the antenna element and digital MIMO or analog beamforming, then
set the waveform, transmit power, target RCS and the TX and RX arrays. The page
draws the combined beam pattern, the physical aperture next to a human figure
and a PCB antenna layout, and works out the virtual channels, beamwidth, field
of view, range resolution, chirp slope, IF bandwidth, minimum ADC rate and
maximum detectable range. The Auto-Design tab works backwards from a target
range, range resolution, angular resolution and RCS to the sweep bandwidth, the
arrays and the transmit power. The radar equation is single-chirp with a fixed
10 dB noise figure.

One HTML file with no build step; its only dependency, Chart.js, loads from
jsDelivr pinned to version 4.5.1.

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

The folder is served as it is, with no build step and no JavaScript
dependencies; only the fonts come from Google Fonts. The optional
[`eband-distribution/build-standalone.ps1`](eband-distribution/build-standalone.ps1)
inlines the stylesheet and scripts into a single-file copy, `dist/index.html`,
for opening straight off disk. See
[`eband-distribution/README.md`](eband-distribution/README.md) for the model,
the equations, and the honesty ledger listing which numbers are datasheet-grade
and which are engineering estimates.

## ZU67DR Pulse Array

Design walkthrough for a pulse generator built from HamGeek XCZU67DR RFSoC
cards, each plugged into a custom AFE + PA carrier board. The default build is
four modules: 32 RF-DAC outputs and 32 one-bit GTY outputs, 3 V into 50 Ω, with
a DC level per channel. Only one 5 MHz clock (plus the trigger) is shared
between modules: by default each card derives its own SYSREF from that clock,
and the optional true-SYSREF mode puts the same 5 MHz edge on every card's SYNC
pin instead. The band target is 1 MHz–5 GHz, but the page's own pulse-fidelity
model shows only the one-bit single-ended path reaching it; the RF-DAC through
the card's balun as delivered covers about 30 MHz–3.44 GHz.

A configuration block in the stage rail picks the build: 1, 2, 4 or 8 modules,
DAC + one-bit or DAC-only outputs, one of four sync options (sync unit, daisy
chain, master + splitter, or master + 2 splitters for the legacy cabling),
derived or true SYSREF, and the box. Every module is built the same, so a sync
option is only a set of rear cables plus a software profile, and the later
stages follow the choice: power budget, cable count, rack height, parts
quantities and the 3D model.

The page walks through 14 stages from concept to roadmap: system and module
diagrams, findings from the card schematic, the carrier block schematic with
clickable nets and parts, a pulse-fidelity lab, sync and timing with a
trigger-alignment simulator and an operation timing diagram (bring-up, arm and
start, run), the daisy-chain option, the GPIO map, the frequency plan and power
budget, mechanics with a 3D model of the module, bench and rack, scaling and
the parts list. Mechanics offers two boxes for the same card and carrier
circuits: the card upright in a vertical PCIe x8 slot (170 × 185 × 275 mm, two
modules per 5U shelf), or flat on a right-angle PCIe connector (214 × 74 ×
324 mm, two per 2U shelf), which is rated for PCIe 3.0 and still has to be
proven at 20 Gb/s.

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

The page is drawing-first (the long tables sit in collapsed Details blocks) and walks
through synchronization, calibration, the data path and its rate budget, the tile PCB with an interactive 3D model of the tile and the two-tile array
(antennas only on the front, each ESP32-C5 behind its own patch, equal RF paths), the options for
putting all sixteen C5s on one board behind one ESP32-S31 (and how to control and flash them), experiments (receive beamforming with a steering
slider, radar, communications, transmit), costs, the bench tests that decide
the design, and the staged plan. Every claim carries a status — confirmed,
inference, open or speculative — backed by
[`esp32-c5-phased-array/evidence.html`](esp32-c5-phased-array/evidence.html).
The slide deck (PDF and PowerPoint) is in
[`esp32-c5-phased-array/deck/`](esp32-c5-phased-array/deck/), and the Python
behind it is in
[`esp32-c5-phased-array/deck-src/`](esp32-c5-phased-array/deck-src/):
`build3.py` builds the PowerPoint deck (the PDF is exported from PowerPoint),
and `site_build.py` builds the page's `index.html` from the same content files.
`evidence.html`, and the claim counts quoted on the page, also need research
data that is not published here.
