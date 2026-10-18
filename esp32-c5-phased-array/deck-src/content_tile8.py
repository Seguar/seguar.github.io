"""Content for the 2 x 8 tile architecture (team proposal of 13 Oct 2026). # R = refine from research."""
from deckkit import INK, MUTED, FAINT, TEAL, BLUE, AMBER

T = {}
N = 16380
FS = 80e6
LANE = 80e6          # 2 bit x 40 MHz
IQ8 = N * 2
IQ10 = N * 2.5
RAW = N * 4
t_iq8 = IQ8 * 8 / LANE
t_iq10 = IQ10 * 8 / LANE
cap = N / FS

# ---------------------------------------------------------------- system
T["sys_source"] = "Team architecture of 13 Oct 2026. Part numbers are candidates. PARLIO export from the C5 and lockstep alignment of eight lanes are open bench questions."

# ---------------------------------------------------------------- one tile
T["tile8_source"] = "C5 PARLIO: datasheet v1.5. S31 EMAC 10/100/1000 over MII/RMII/RGMII with IEEE 1588 (datasheet v0.5). Espressif's S31 board and ESP-SDR use a YT8531 RGMII PHY."
T["tile8_s31_items"] = ["16-bit PARLIO RX, external PCLK", "GDMA into RAM", "sync-word check per frame",
                        "UDP packetization", "EMAC → RGMII", "READY / GO, ANT / CAL GPIOs",
                        "IEEE 1588 timestamps", "USB HS for debug"]
T["tile8_notes"] = [
    "Chip-down C5 (QFN48): modules carry their own 48 MHz crystal and cannot share a reference.",
    "PHY: RTL8211F is the team's choice; Espressif's S31 board uses a YT8531 — check the ESP-IDF driver before layout.",
    "The S31 forwards 16-bit words untouched; bit de-interleaving runs on the host.",
    "Ethernet and PTP give timestamps and coordination only — sample alignment comes from the shared PCLK, the GO signal and the RF calibration.",
]
T["tile8_take"] = [[("8 × 80 Mbit/s = 640 Mbit/s on one 16-bit bus at 40 MHz — 64 % of a Gigabit link. ", {}),
                    ("No Ethernet MAC, PHY, magnetics or switch per element.", {"color": MUTED})]]

# ---------------------------------------------------------------- bus mapping
T["map_source"] = "C5 TRM v1.1 §43: PARLIO ≤ 40 MHz, external TX clock, not an ETM peripheral; a gated external clock may start after TX_START. Lockstep across chips is an inference to test."
T["map_sequence"] = [
    "1   the S31 arms all C5s; each captures a snapshot and loads its PARLIO DMA descriptors",
    "2   each C5 raises READY",
    "3   the S31 waits until all eight READY lines are high",
    "4   GO: the S31 enables the PCLK buffer, so all lanes start on one edge",
    "5   all C5s shift out on the same clock edges",
    "6   the S31 captures 16-bit words by DMA",
    "7   every frame starts with a sync word common to all lanes",
]
T["map_frame_rows"] = [
    ["Field", "bits", "Purpose"],
    ["sync word", "32", "identical on all lanes → alignment check"],
    ["channel ID", "8", "which C5 / antenna"],
    ["frame sequence", "16", "detects lost frames"],
    ["sample counter", "32", "ties the frame to the capture start"],
    ["capture metadata", "32", "rate, gain index, ANT / CAL state"],
    ["payload", "N × 16", "IQ8 (or packed IQ10)"],
    ["CRC", "16", "bit errors on the parallel bus"],
]
T["map_note"] = [[("If one lane slips by a clock, the sync word no longer lines up across the 16 bits ", {}),
                  ("and the S31 sees it at once. Bit transposition is cheap on a PC and expensive on the S31 at 40 M words/s.",
                   {"color": MUTED})]]

# ---------------------------------------------------------------- two data modes
T["modes2_source"] = f"ESP-SDR C5 limits: rates 80/40/20/10/8/4 MS/s, ≤ {N:,} samples per snapshot, 11–48 MHz analog bandwidth. Lane = 2 bit × 40 MHz = 80 Mbit/s."
T["modes2_cols"] = [
    ("Mode 1 — continuous reduced rate", "O",
     "Every C5 streams a narrow band continuously over its own 2-bit lane.",
     [["Sample rate (nearest ESP-SDR rate)", "4 MS/s, IQ8"], ["Per element", "64 of 80 Mbit/s"],
      ["Per tile / array", "512 Mbit/s / 1.02 Gbit/s"], ["Instantaneous bandwidth", "≈ 4 MHz"],
      ["Doppler at 5.2 GHz", "34.7 Hz per m/s"]],
     ["5 MS/s is not an ESP-SDR rate, and 8 MS/s (128 Mbit/s) does not fit a 2-bit lane.",
      "The C5 has no continuous capture today. Back-to-back 4 MS/s snapshots (4.1 ms each, 3.3 ms to drain) "
      "would be near-continuous if capture and transfer can overlap.",
      "The C5 analog filter is at least 11 MHz wide: at 4 MS/s out-of-band signals may alias (the S31 stream "
      "subsamples without a decimation filter).",
      "On the S31, ESP-SDR streams by routing the modem debug bus into PARLIO. The C5 lists MODEM_DIAG0–31 signals, "
      "but IQ on them is undocumented — and 16–20 lanes per C5 would not fit the shared bus."]),
    ("Mode 2 — full-rate synchronized snapshots", "I",
     "All 16 elements capture the same 205 µs at 80 MS/s, then drain over their lanes.",
     [["Snapshot", f"{N:,} samples, {cap * 1e6:.0f} µs"], ["Size per element, IQ8 / IQ10", f"{IQ8 / 1e3:.1f} / {IQ10 / 1e3:.1f} kB"],
      ["Drain time at 80 Mbit/s", f"{t_iq8 * 1e3:.1f} / {t_iq10 * 1e3:.1f} ms"],
      ["Max snapshot rate (IQ8)", f"≈ {1 / (t_iq8 + cap):.0f} per second"], ["Array data per snapshot", f"{16 * IQ8 / 1e3:.0f} kB"]],
     ["Wide instantaneous bandwidth (11–48 MHz analog) with low-cost networking.",
      "Right mode for calibration, wideband channel sounding and radar trials.",
      "Needs PARLIO export firmware and a hardware capture trigger — both new work."]),
]

# ---------------------------------------------------------------- plan B
T["planb_source"] = "Candidate FPGAs: Lattice ECP5 / iCE40 UltraPlus (open toolchain), Efinix Trion. Optional for Rev 1."
T["planb_fpga_items"] = ["8 independent PARLIO receivers", "elastic FIFO per channel", "frame alignment, timestamps",
                         "trigger and switch sequencing", "calibration correction", "decimation / FFT", "later: beamforming"]
T["planb_when"] = ["eight C5 lanes cannot be kept in lockstep", "the S31 cannot sustain 640 Mbit/s in and out",
                   "real-time per-element processing (FFT, decimation) is needed"]
T["planb_cost"] = ["one more chip, toolchain and HDL work", "more power and board area", "the team needs FPGA experience"]
T["planb_adds"] = ["each C5 can run on its own lane clock", "deterministic, inspectable timing",
                   "data reduction before Ethernet", "a path to real-time beamforming"]

# ---------------------------------------------------------------- PCB
T["pcb_source"] = "To scale for 28.8 mm pitch. Custom 4-layer stack (JLCPCB's standard one has only 0.21 mm under L1). Patch: εr 4.4, tan δ 0.02; lossless BW ≈ 3.77·(εr−1)/εr²·(W/L)·(h/λ₀); efficiency counts dielectric loss only. Prices: team estimates."
T["pcb_geom_note"] = "To scale: the 2 × 4 antenna block sits against the seam. Front: patches only. Back: each C5 under its own patch, the rest on the outer half. Rows keep 28.8 mm pitch across the seam only if each board edge is 14.4 mm from its nearest row."
T["pcb_stack_rows"] = [["L1", "patches only (the front)"], ["L2", "solid ground (patch ground)"], ["L3", "ground; clock lines, 3.3 V spine"],
                       ["L4", "all parts, RF, data lines"]]
T["pcb_cost_rows"] = [["standard 4-layer, 5 boards", "$25–35"], ["+ ENIG, impedance control", "$35–55"],
                      ["Rev 1 custom stack + blind vias", "quote"], ["per tile (standard, 5 boards)", "$7–11"],
                      ["6-layer, per board", "$10–16"], ["shipping to Israel", "$20–35"]]
T["pcb_patch_notes"] = [
    "A standard 1.6 mm 4-layer board has only ≈ 0.21 mm between L1 and L2: a 5.2 GHz patch there radiates at most ≈ 18 % "
    "of its power on FR-4 (lossless bandwidth ≈ 0.3 %; the loss makes the S11 dip look wider than it is).",
    "Rev 1 uses a custom stack with a 1.065 mm core under L1: ≈ 1.6 % (≈ 85 MHz) lossless bandwidth and at most ≈ 53 % "
    "efficiency; patch ≈ 17.5 × 13.5 mm, trimmed after a test coupon (≈ 55 MHz per 0.1 of εr).",
    "Front: patches only (plus tented through-via pads). Each C5 sits behind its own patch: probe via, 1 mm to the SPDT, "
    "2.5 mm to the C5, the same for all eight. All digital lines run behind the L2 ground.",
    "Seam: the ground is cut between tiles, so bridge it continuously and calibrate per element. Tile B is turned 180°, "
    "so elements 9–16 carry a fixed 180° term.",
]

# ---------------------------------------------------------------- bench tests
T["bench_source"] = "Status = what is already stated or shown in a primary source, not on our hardware. Evidence: ESP-SDR source and docs, ESP32-C5 / S31 datasheets, ESPARGOS papers."   # R
T["bench_rows"] = [
    ["", "Test", "What it proves", "Evidence today"],
    ["O", "C5 raw IQ → GDMA → PARLIO TX", "a snapshot can leave the C5 without CPU copies",
     "GDMA can address the ESP-SDR IQ bank; ESP-SDR packs IQ8 in place on the CPU; access while the modem owns the bank is unknown"],
    ["O", "2 bit × 40 MHz from one C5", "80 Mbit/s per element in practice", "40 MHz is PARLIO's maximum clock; receiver samples on the falling edge (≈ 12.5 ns window)"],
    ["O", "eight C5 PARLIO transmitters in lockstep", "Rev 1 needs no FPGA", "PARLIO has no ETM start; the reference manual's gated external clock suggests a clock-held start — untested"],
    ["I", "16-bit PARLIO RX at 40 MHz into the S31", "tile ingress", "ESP-SDR S31: 16-lane PARLIO → GDMA ring at 40 MS/s, but fed internally with an internal sample clock — external pins + PCLK untested"],
    ["C", "S31 → GbE at ≈ 640 Mbit/s", "tile egress", "ESP-SDR: raw UDP frames at ≈ 687 Mbit/s, 600 s, 0 samples lost (one board, experimental)"],
    ["O", "shared 48 MHz into C5 XTAL_P", "frequency lock across elements", "no C5 guidance; ESP32-S2 oscillator note, ESPARGOS at 40 MHz"],
    ["O", "RF phase repeatability: reset, retune, temperature", "how often to calibrate", "ESPARGOS: phase re-rolls at 2.4 GHz; C5 unmeasured"],
    ["O", "snapshot synchronization on a wideband signal", "real phase, delay and jitter", "ESPARGOS One: ≤ 37.5 ns timestamp scatter (2.4 GHz, closed firmware)"],
]
T["bench_row_heights"] = [0.42] + [0.56] * 8

# ---------------------------------------------------------------- development sequence
T["dev_source"] = "Each step ends with a measurable result; nothing larger is built until the previous step passes."
T["dev_steps"] = [
    {"n": "1", "title": "One C5", "goals": ["run ESP-SDR", "characterise raw IQ", "inspect memory / DMA path", "implement PARLIO export"],
     "gate": "a snapshot leaves over PARLIO, bit-exact"},
    {"n": "2", "title": "C5 + S31", "goals": ["2-bit PARLIO, shared 40 MHz", "≈ 80 Mbit/s stream", "out over GbE"],
     "gate": "80 Mbit/s to the PC for hours, no loss"},
    {"n": "3", "title": "Two C5s", "goals": ["common 48 MHz reference", "common trigger", "phase calibration", "first AoA"],
     "gate": "relative phase stable to a few degrees"},
    {"n": "4", "title": "Eight C5s", "goals": ["full tile", "16-bit PARLIO, ≈ 640 Mbit/s", "receive beamforming"],
     "gate": "8 lanes aligned for hours; beam matches prediction"},
    {"n": "5", "title": "Second tile", "goals": ["16 elements", "common calibration", "4 × 4 AoA and beamforming"],
     "gate": "calibrated 2D scan, repeatable after power cycle"},
    {"n": "6", "title": "Extensions", "goals": ["radar, Wi-Fi sensing", "coherent TX research", "digital TX beamforming", "FPGA preprocessing"],
     "gate": "research results"},
]

# ---------------------------------------------------------------- alternatives
T["alt_source"] = "Design-decision record. BCM53202M product brief (Broadcom 53202M-PB00-R): 8 × 10/100 PHYs, two GMII/RGMII/TBI ports, 384 KB buffer."
T["alt_rows"] = [
    ["Alternative", "Why not for Rev 1", "Reconsider when"],
    ["W5500 SPI-Ethernet per C5", "C5 has no MAC; adds 8 bridges, PHYs, magnetics and a switch; 100 Mbit ceiling per element",
     "single-node experiments, elements on separate boards"],
    ["Ethernet switch per tile (BCM53202M: 8 × 10/100 + 2 × GbE)", "needs Ethernet on every C5 first; solves aggregation, not sample synchronization",
     "elements become separate networked boards"],
    ["ESP32-S31 as the RF element (2.4 GHz)", "continuous IQ works today, but 2.4 GHz only: new aperture, crowded band",
     "if C5 PARLIO export fails"],
    ["4 × 2×2 tiles, one FPGA each", "more boards, FPGA mandatory, four uplinks", "Plan B, or more processing per tile"],
    ["Analog phase shifter per element", "receive steering is exact and wideband in software", "deterministic TX steering before raw TX exists"],
    ["Buy 2 × ESPARGOS One (2.4 GHz)", "closed IQ firmware, 2.4 GHz, not our design", "as a reference instrument and baseline"],
]
T["alt_row_heights"] = [0.42] + [0.66] * 6

# ---------------------------------------------------------------- TX steering
T["txs_source"] = "Phase steps for λ/2 spacing. ESPARGOS states phase-coherent TX works on ESPARGOS One but has not released it (ESP-SDR page, issue #3)."
T["txs_rows"] = [["steering angle θ", "Δφ per element"], ["0°", "0°"], ["15°", "−46.6°"], ["30°", "−90.0°"],
                 ["45°", "−127.3°"], ["60°", "−155.9°"]]
T["txs_hard"] = [
    "Phase-coherent TX LOs: a shared 48 MHz fixes frequency, not the phase after each PLL lock.",
    "Deterministic TX start: normal packet TX is timed by the Wi-Fi MAC, not by us.",
    "A raw TX waveform path on the C5 — the ESP-SDR authors say arbitrary TX works but have not released it.",
    "The C5 is 1T1R and half-duplex: one chain switches between TX and RX.",
]
T["txs_fallback"] = [
    "Separate roles: 1–2 C5s transmit, the other 14–15 receive coherently.",
    "TDM / MIMO: one element transmits at a time, the TX aperture is synthesized afterwards (as in ESPARGOS radar mode).",
    "External RF phase shifters after each C5 — more BOM, loss and control lines; not for Rev 1.",
]

# ---------------------------------------------------------------- cost
T["cost_source"] = "Team low-volume estimates (Oct 2026), not quotes. Excludes lab instruments, enclosure and engineering time."
T["cost_tile_rows"] = [
    ["Item", "≈ USD"],
    ["8 × ESP32-C5 (chip-down needed for a shared reference)", "40"],
    ["1 × ESP32-S31", "7.5"],
    ["1 × RTL8211F Gigabit PHY", "1.4"],
    ["Gigabit MagJack", "2.5"],
    ["48 / 40 MHz fan-out buffers", "7.5"],
    ["40 MHz oscillator", "1.5"],
    ["8 × RF SPDT (SKY13351-class)", "5"],
    ["3.3 V regulation, power", "3"],
    ["Ethernet crystal, passives, misc.", "3–5"],
    [[[("Tile electronics", {"color": INK})]], "70–80"],
]
T["cost_sys_rows"] = [
    ["Item", "≈ USD"],
    ["Two tiles", "140–160"],
    ["Master board: 48 MHz, trigger, 5.2 GHz source, splitters", "15–20"],
    ["Electronics total", "160–180"],
    ["PCBs, assembly, shipping", "60–120"],
    [[[("Complete prototype target", {"color": INK})]], "220–300"],
]
T["cost_notes"] = [
    "Chip-down C5s replace modules because modules carry their own crystal; parts cost is similar, layout work is higher.",
    "The custom stack-up (with blind L4–L3 vias) keeps the patches on the tile but needs a quote: the PCB line assumes standard-stack prices. Ask for a balanced build and a bow/twist limit. A separate antenna board would add a second fab order and 16 RF connections.",
    "A MAX2871 evaluation board alone costs more than the $15–20 line; a bare synthesizer on the master board is assumed.",
    "For scale: an ESPARGOS One Core Kit (8 elements, 2.4 GHz, finished product with enclosure, PoE and firmware) is €350 excl. VAT.",
]
T["cost_note_y"] = 4.05

# ---------------------------------------------------------------- four sync domains
T["dom_source"] = "Team architecture; ESPARGOS uses the same split (shared clock, wired trigger, switched RF reference). Ethernet / PTP is for coordination only."
T["dom_rows"] = [
    ["Domain", "Signal and path", "Guarantees", "Does not guarantee"],
    [{"c": "RF reference", "color": BLUE}, "48 MHz TCXO → fan-out → 16 × XTAL_P", "one frequency for all LOs", "LO phase after each lock"],
    [{"c": "Data transport", "color": "6F4E9E"}, "40 MHz PCLK → fan-out → 16 C5 + 2 S31", "lane-to-lane cycle alignment", "which sample a lane starts with"],
    [{"c": "Capture trigger", "color": AMBER}, "master GO → S31 → PCLK enable (+ READY)", "common start within a tile", "tile-to-tile start (two S31s)"],
    [{"c": "RF calibration", "color": TEAL}, "5.2 GHz tone → 1:2 → 1:8 → SPDT", "measures φₖ, τₖ and path mismatch", "anything before the switch"],
    [{"c": "Ethernet / PTP", "color": MUTED}, "S31 EMAC, 1588 timestamps", "logging, tile coordination", "sample or phase alignment"],
]
T["dom_row_heights"] = [0.42] + [0.62] * 5
T["dom_take"] = [[("Wideband correction per element is a phase plus a delay: ", {}),
                  ("Cₖ(f) = exp[−j(φₖ + 2πfτₖ)], applied per FFT bin before the channels are combined.", {"color": MUTED})]]
