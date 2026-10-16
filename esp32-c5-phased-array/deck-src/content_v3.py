"""v3 overrides: the 2 x 8-tile PARLIO / S31 architecture. Builds on content.F and content_tile8.T."""
import budget as B
from deckkit import INK, MUTED, FAINT, TEAL, BLUE, AMBER, BG2, WHITE, TEAL_L, LINE
from content import F as F0, REFS as REFS0
from content_tile8 import T

F = dict(F0)
F.update(T)
DCLK = "6F4E9E"

# ---------------------------------------------------------------- title + what
F["title_text"] = "A 4×4 phased-array research platform built from ESP32-C5 radios"
F["title_sub"] = "5.2 GHz · two 8-element tiles · PARLIO aggregation into one ESP32-S31 per tile · 1 GbE per tile"
F["what_chain"] = [("Patch + SPDT", "5.2 GHz, ANT / CAL"), ("ESP32-C5", "RF transceiver, raw IQ"),
                   ("2-bit PARLIO", "80 Mbit/s lane"), ("ESP32-S31", "8 lanes → 1 GbE")]
F["what_uses"] = [("Receive", "digital beamforming, AoA / direction finding (shown by ESPARGOS at 2.4 GHz)", "C"),
                  ("Sense", "Wi-Fi sensing, passive and bistatic radar, Doppler", "I"),
                  ("Sound", "channel sounding, MIMO measurements, localization", "I"),
                  ("Transmit coherently", "TX beamforming, if raw TX can be reproduced", "S")]

# ---------------------------------------------------------------- antenna board
F["antenna_means"] = [
    "Rev 1 can use this board as the aperture and cable each element to its tile — no seam crosses the radiating surface.",
    "Or the tiles carry their own patches (next section) — then substrate thickness and the seam need care.",
    "Either way, measure S11 and neighbour coupling per element first.",
]

# ---------------------------------------------------------------- clock (two tiles)
F["clock_stubs"] = ["tile B"]
F["clock_fanout"] = "1:2 fan-out"
F["clock_fanout_sub"] = "master board"
F["clock_tile_label"] = "tile A (4 of 8 shown)"
F["clock_tilebuf"] = "1:8 buffer"

# ---------------------------------------------------------------- existing work: what is new
F["new_points"] = [
    ("I", "the ESPARGOS synchronization principle at 5.2 GHz with a 48 MHz reference"),
    ("O", "one external 48 MHz clock driving 16 chip-down ESP32-C5s; C5 LO-phase behaviour"),
    ("O", "hardware trigger and capture alignment for C5 snapshots"),
    ("O", "IQ export over 2-bit PARLIO into one ESP32-S31 per tile, then 1 GbE"),
    ("I", "in-band 5.2 GHz calibration network; two 8-element tiles with a master timing board"),
]

# ---------------------------------------------------------------- snapshots: PARLIO lane instead of SDIO
_rows = [["Output port (per element)", "Transfer time", "Snapshots / s", "Duty cycle"]]
for lab, r in (("UART, 2 Mbaud (ESP-SDR today)", 1.6e6), ("USB-Serial-JTAG, 12 Mbit/s line", 12e6),
               ("PARLIO lane, 2 bit × 40 MHz (planned)", 80e6), ("PARLIO, 8 bit × 40 MHz (ceiling)", 320e6)):
    t = 16380 * 2 * 8 / r
    _rows.append([lab, f"{t * 1e3:.1f} ms", f"≤ {1 / (t + 16380 / 80e6):.0f}", f"≤ {16380 / 80e6 / (t + 16380 / 80e6) * 100:.2g} %"])
F["snap_table_rows"] = _rows
F["snap_points"] = [
    "Raw snapshots suit calibration research, beamforming and offline algorithm work — the first milestones.",
    "Doppler and tracking need many snapshots with no retune in between (a C5 retune takes ~28–35 ms at 5 GHz).",
    "The planned 2-bit PARLIO lane drains a full snapshot in 3.3 ms — about 7× faster than USB at its line rate.",
]

# ---------------------------------------------------------------- calibration network (two tiles)
F["calnet_stubs"] = ["tile B"]
F["calnet_hub_split"] = "1:2 splitter"
F["calnet_hub_sub"] = "master board"
F["calnet_tile_label"] = "tile A (4 of 8 shown)"
F["calnet_tile_split"] = "1:8"
F["calnet_routing"] = "2 cables"
F["calnet_sources"] = "2 sources"
F["calnet_proposal"] = "one MAX2871-class source on the master board, a 1:2 split to the tiles, a 1:8 Wilkinson tree and eight SPDTs per tile. "
F["calnet_budget"] = [["Stage", "Loss"], ["1:2 + 1:8 split (ideal 3 + 9 dB)", "≈ 14–15 dB"],
                      ["cables + ≈ 18 cm of tile lines", "≈ 5–7 dB"], ["SPDT insertion loss", "≈ 1 dB"],
                      ["source 0 dBm → at each C5", "≈ −20 to −23 dBm"]]
F["cal_source_line"] = "Adapted from ESPARGOS. MAX2871: VCO 3–6 GHz, −1 to +8 dBm, mutable outputs. SKY13351: 0.35 dB loss, 24 dB isolation at 2.45 GHz (datasheet); less expected at 5 GHz."
F["calnet_note"] = ("Well below the C5's +5 dBm maximum input, but enough to clip the 10-bit samples at high gain: attenuate and "
                    "use one low, fixed gain index. SKY13351-class switches specify ≈ 24 dB isolation (at 2.45 GHz; likely less at "
                    "5 GHz), so mute the synthesizer during antenna captures.")

# ---------------------------------------------------------------- data problem chart
F["dataproblem_source_line"] = "Line rates from datasheets; ESP-SDR uses UART / USB on the C5 today. PARLIO figures are width × 40 MHz. Raw IQ as 8-bit I + 8-bit Q."
F["dataproblem_items"] = [
    ("C5 UART (ESP-SDR default)", 2, "link"),
    ("C5 USB-Serial-JTAG (ESP-SDR)", 12, "link"),
    ("C5 PARLIO, 2 bit × 40 MHz", 80, "link"),
    ("C5 PARLIO, 8 bit × 40 MHz", 320, "link"),
    ("S31 PARLIO, 16 bit × 40 MHz", 640, "link"),
    ("Gigabit Ethernet", 1000, "link"),
    ("1 element, 80 MS/s", 1280, "need"),
    ("16 elements, 20 MS/s", 5120, "need"),
    ("16 elements, 80 MS/s", 20480, "need"),
]
F["dataproblem_text"] = [
    "The C5 samples at up to 80 MS/s internally, but ESP-SDR moves captures out over USB (12 Mbit/s) or UART.",
    "A 2-bit PARLIO lane at 40 MHz gives each C5 80 Mbit/s: enough for ~4 MS/s continuous, or for draining full-rate "
    "snapshots in a few milliseconds.",
    "Eight lanes fill one 16-bit S31 bus (640 Mbit/s) and one Gigabit port per tile — a rate ESP-SDR already pushes "
    "through an S31 (≈ 687 Mbit/s on the wire). Continuous raw 80 MS/s from 16 elements stays out of scope.",
]

# ---------------------------------------------------------------- options (A–E)
F["options_source_line"] = "Effort and suitability are judgements for a student team. E is the current team proposal."
hdr = ["", "A · Direct to host", "B · Ethernet per C5", "C · Central FPGA", "D · 4 × 2×2 FPGA tiles", "E · 2 × 8 tiles, PARLIO → S31"]
F["options_rows"] = [
    hdr,
    ["Topology", "each C5 → USB hub → PC", "C5 → W5500 → switch → GbE", "16 C5 → one FPGA → Ethernet",
     "4 × (4 C5 → FPGA) → hub", "8 × 2-bit PARLIO → S31 → RTL8211F → GbE"],
    ["Good for", "bring-up, 1–4 channels", "separate networked nodes", "deterministic capture, DSP", "local reduction, scaling",
     "cheap integrated tile, two uplinks"],
    ["Data limit", "USB full speed per C5", "SPI bridge ≤ 100 Mbit per C5", "16 C5 slave ports", "¼ of the array per tile",
     "80 Mbit/s per lane, 640 per tile"],
    ["Sample alignment", "software only", "none from Ethernet", "ns, in fabric", "ns inside a tile",
     "shared PCLK + GO; to be proven"],
    ["Hardware effort", "low", "high: 8 bridges + PHYs + switch", "high: dense board", "high: FPGA per tile", "medium: one S31 + one PHY per tile"],
    ["Where it fits", {"c": "step 1", "color": TEAL}, {"c": "rejected", "color": MUTED}, {"c": "Plan B variant", "color": BLUE},
     {"c": "Plan B variant", "color": BLUE}, {"c": "Rev 1 baseline", "color": TEAL}],
]
F["options_row_heights"] = [0.45, 0.78, 0.62, 0.62, 0.62, 0.62, 0.45]
F["options_title"] = "Five ways to collect the data"

# ---------------------------------------------------------------- data flow
F["dataflow_stages"] = [("ESP32-C5", "×16", TEAL_L, TEAL), ("ESP32-S31", "×2", BG2, INK),
                        ("Host capture", "2 × GbE", WHITE, INK), ("Host DSP", "", WHITE, LINE)]
F["dataflow_source_line"] = "Lane = 2 bit × 40 MHz. S31 PARLIO→GbE at 640 Mbit/s is shown by ESP-SDR's S31 streaming firmware (one board, internal source)."
F["dataflow_rates"] = ["80 Mbit/s per lane\n(2 bit × 40 MHz)", "640 Mbit/s per tile\non 1 GbE", "≈ 1.3 Gbit/s total\ninto RAM"]
F["dataflow_tasks"] = [
    ["capture on common trigger", "snapshot or 4 MS/s stream", "frame: sync, ID, counters", "PARLIO TX on shared PCLK"],
    ["16-bit PARLIO RX by DMA", "sync-word alignment check", "UDP packets, timestamps", "ANT / CAL and READY / GO"],
    ["two NIC ports", "bit de-interleaving", "frame / sequence checks", "dataset recording"],
    ["(φₖ, τₖ) calibration per FFT bin", "beamforming, AoA / MUSIC", "radar and sensing", "later: move to S31 / FPGA / GPU"],
]
F["dataflow_insight"] = [
    [("The bottleneck is still inside each C5 — capture memory and how fast the IQ reaches PARLIO. ", {}),
     ("Everything after the S31 is ordinary Gigabit networking; the host does the heavy DSP at first.", {"color": MUTED})]]

# ---------------------------------------------------------------- budget
N, FS = 16380, 80e6
IQ8 = N * 2
cap = N / FS
lane = 80e6
rows = [["Stage", "per element", "per tile (×8)", "array (×16)", "comment"]]
rows.append(["Internal IQ, 80 MS/s, IQ8", B.fmt_rate(FS * 16), B.fmt_rate(8 * FS * 16), B.fmt_rate(16 * FS * 16), "inside the chip only"])
rows.append([f"Snapshot, {N:,} samples (IQ8)", B.fmt_bytes(IQ8), B.fmt_bytes(8 * IQ8), B.fmt_bytes(16 * IQ8), f"{cap * 1e6:.0f} µs of signal"])
rows.append(["Today: USB-Serial-JTAG", "12 Mbit/s", "—", "—", "ESP-SDR, line rate"])
rows.append(["PARLIO lane, 2 bit × 40 MHz", B.fmt_rate(lane), B.fmt_rate(8 * lane), B.fmt_rate(16 * lane), "64 % of GbE per tile"])
rows.append(["Mode 1: 4 MS/s IQ8 continuous", "64 Mbit/s", "512 Mbit/s", "1.02 Gbit/s", "C5 continuous capture is open"])
rows.append(["Mode 2: snapshot drain (IQ8)", f"{IQ8 * 8 / lane * 1e3:.1f} ms", "same, parallel", "same, parallel", f"≤ {1 / (IQ8 * 8 / lane + cap):.0f} snapshots/s"])
rows.append(["64 FFT bins per snapshot, 100/s", "205 kbit/s", "1.64 Mbit/s", "3.28 Mbit/s", "complex, 16-bit I/Q"])
rows.append(["16 × 16 covariance, 100/s", "—", "—", "870 kbit/s", "136 complex float32"])
F["budget_rows"] = rows
F["budget_row_heights"] = [0.42] + [0.48] * (len(rows) - 1)
F["budget_source_line"] = "Assumptions: IQ8, 16,380-sample snapshots (ESP-SDR maximum on C5), 2 bit × 40 MHz per lane. Replace with step-1/2 measurements."
F["budget_takeaway"] = ("Per tile the lanes add up to 640 Mbit/s and one Gigabit port; the array needs two ports at the host. "
                        "Reduction (FFT bins, covariance) can move to the S31 or an FPGA later.")

# ---------------------------------------------------------------- radar
F["radar_rows"] = [
    ["", "Experiment", "What we would measure", "Evidence and dependencies"],
    ["C", "Wi-Fi sensing from CSI", "motion, presence, gestures, breathing-scale phase", "widely shown on ESP32; C5 CSI gives 52–242 subcarriers"],
    ["I", "Passive radar / localization with AP illuminators", "AoA, Doppler, multipath changes, position",
     "ESPARGOS passive localization at 2.4 GHz; needs mode 1 or fast snapshots"],
    ["I", "Separate TX and RX elements", "1–2 C5s transmit packets, 14–15 receive coherently",
     "standard packet TX; ESPARGOS radar mode does one-TX / rest-RX"],
    ["I", "Pulsed / switched (TDM)", "transmit a burst, switch to RX, capture echoes",
     "C5 is half-duplex; TX→RX switching time unknown"],
    ["O", "Active CW or stepped frequency", "Doppler (CW), coarse range (stepping)", "5 GHz tone from a C5 undocumented"],
    ["S", "FMCW-like on the same radio", "range–Doppler maps", "needs simultaneous TX + RX and arbitrary TX — not the starting point"],
]
F["radar_after"] = (5.45, 1.2, [
    "Doppler at 5.2 GHz is 34.7 Hz per m/s; 0.5 m/s resolution (walking people) needs ≈ 60 ms of coherent slow time. Mode 1 at 4 MS/s "
    "or back-to-back snapshots make this possible; USB-only snapshots do not.",
    "Range resolution is c/2B: 7.5 m at 20 MHz, ≈ 3.1 m at the C5's 48 MHz analog limit. Angle and Doppler are the strengths."])

# ---------------------------------------------------------------- power
I_RX, I_TX = 110, 408
pr = [["Load", "per unit", "count", "total"]]
pr.append(["ESP32-C5, receive (5 GHz)", f"{I_RX} mA", "16", f"{16 * I_RX / 1000:.2f} A"])
pr.append(["ESP32-C5, transmit peak (5 GHz)", f"{I_TX} mA", "16", f"{16 * I_TX / 1000:.2f} A"])
pr.append(["ESP32-S31 + RTL8211F (estimate)", "≈ 400 mA", "2", "0.80 A"])
pr.append(["Clock buffers, oscillators, SPDTs", "≈ 40 mA", "6", "0.24 A"])
pr.append(["Master board incl. synthesizer", "≈ 200 mA", "1", "0.20 A"])
rx_total = (16 * I_RX + 800 + 240 + 200) / 1000
tx_total = (16 * I_TX + 800 + 240 + 200) / 1000
pr.append([[[("All receiving", {"color": INK})]], "", "", f"{rx_total:.1f} A · {rx_total * 3.3:.0f} W"])
pr.append([[[("All transmitting (worst case)", {"color": INK})]], "", "", f"{tx_total:.1f} A · {tx_total * 3.3:.0f} W"])
F["power_rows"] = pr
F["power_notes"] = [
    "Espressif asks for ≥ 0.6 A of supply capability per C5: 4.8 A per tile. Plus 10 µF on each VDDA rail.",
    "TX bursts droop a shared rail and can disturb the reference — give clock buffers and oscillators their own quiet LDO.",
    f"Heat: ≈ {rx_total * 3.3:.0f} W in receive over two tiles is easy; continuous all-TX ({tx_total * 3.3:.0f} W) needs airflow.",
]
F["power_source_line"] = "C5: datasheet v1.5 Table 5-8 (peak, 3.3 V). S31, PHY and master-board figures are planning estimates — measure in steps 2 and 4."
F["board_points"] = [
    "Two tile PCBs, custom 4-layer FR-4 with controlled impedance; one master timing / RF board.",
    "Front: patches only. Each chip-down ESP32-C5 sits behind its own patch, so XTAL_P can take the shared 48 MHz.",
    "PARLIO lines on L4, series-terminated; ≈ 1.2 ns of layout skew (data plus PCLK) and the C5 clock-to-out spread (a bench test) against the 12.5 ns half-period.",
    "48 and 40 MHz point-to-point from 1:8 / 1:10 buffers: on L3 from the buffers, the last few cm to each C5 on L4; series-terminated, away from RF lines.",
    "RF: 50 Ω lines on L4 over a solid L3 ground; each SPDT 1 mm from its probe via and 2.5 mm from its C5.",
    "Antenna substrate: the 1.065 mm core under L1 (see the tile PCB slide).",
]

# ---------------------------------------------------------------- software
F["sw_cols"] = [
    ("ESP32-C5 firmware", TEAL_L, TEAL,
     ["ESP-SDR capture (pinned IDF)", "fixed gain, RF tuning", "trigger input, READY", "pack IQ8 / IQ10", "PARLIO TX by GDMA",
      "frame header: sync, ID, counters"]),
    ("ESP32-S31 firmware", BG2, INK,
     ["16-bit PARLIO RX by DMA", "lane alignment check", "READY / GO, ANT / CAL", "UDP packetization", "PTP timestamps",
      "control API"]),
    ("Host", WHITE, LINE,
     ["two GbE capture threads", "bit de-interleaving (NumPy)", "frame / sequence checks", "calibration (φₖ, τₖ per bin)",
      "beamforming, MUSIC, radar", "Python, SciPy; MATLAB optional"]),
    ("Later", WHITE, LINE,
     ["reduction on the S31", "FPGA preprocessing (Plan B)", "GPU (CuPy) for real-time", "GNU Radio blocks",
      "dataset publishing", ""]),
]

# ---------------------------------------------------------------- risks
F["risks_source_line"] = "The first eight are the team's list; the last two came out of the research. Each except coherent TX (step 6) has a bench test in steps 1–4."
F["risk_rows"] = [
    ["Risk", "Early test", "Fallback"],
    ["C5 raw IQ cannot reach PARLIO by DMA at the needed rate", "step 1: snapshot → PARLIO, bit-exact", "CPU copy at lower rate; snapshots only"],
    ["Eight lanes not cycle-aligned (40 MHz is PARLIO's limit)", "steps 2 and 4: sync-word checks, eye margin", "Plan B: FPGA with per-lane FIFOs"],
    ["S31 cannot ingest and send 640 Mbit/s at once", "step 2 → 4: 80 → 640 Mbit/s", "lower lane rate, or FPGA → GbE PHY"],
    ["Shared 48 MHz gives poor phase stability", "step 3: phase vs time and temperature", "per-snapshot calibration"],
    ["C5 LO phase not repeatable across resets / retunes", "step 3: repeated resets and retunes", "calibrate every epoch (as ESPARGOS)"],
    ["Coherent TX method not reproducible on C5", "step 6, research only", "RX-only results stand alone"],
    ["FR-4 antenna / array consistency insufficient", "VNA on the first tile", "separate aperture board (ours) or better laminate"],
    ["Power and heat with 16 active C5s", "current and temperature on one tile", "duty-cycle TX, airflow"],
    ["No continuous capture on the C5 (mode 1)", "step 1: back-to-back snapshot timing", "mode 2 only; quasi-continuous snapshots"],
    ["Custom stack: cost, warpage; patches lossy (≤ 53 %)", "quote; simulate + VNA one tile", "standard stack + our aperture board"],
]
F["risk_row_heights"] = [0.42] + [0.5] * 10
F["risk_cols"] = [4.9, 3.7, 3.53]

# ---------------------------------------------------------------- claims
F["claims_rows"] = [
    ["", "Claim", "Basis"],
    ["C", "ESP32-C5 receives 5180–5885 MHz; 1T1R; 18 dBm TX, −94 dBm sensitivity (low rates)", "Espressif datasheet v1.5"],
    ["C", "ESP-SDR raw IQ on C5: 80/40/20/10/8/4 MS/s, ≤ 16,380 samples, USB / UART out", "ESP-SDR source and README"],
    ["C", "C5 PARLIO TX: 1/2/4/8 bit, ≤ 40 MHz, external clock pad, GDMA; not an ETM peripheral", "C5 TRM v1.1, ESP-IDF source"],
    ["C", "S31 streams 16-lane PARLIO capture to GbE at ≈ 687 Mbit/s (experimental)", "ESP-SDR S31 docs; 600 s, 0 lost"],
    ["C", "S31 EMAC: 10/100/1000, MII / RMII / RGMII, IEEE 1588 timestamps", "S31 datasheet v0.5 (pre-release)"],
    ["C", "ESP32-C5 modules integrate their own 48 MHz crystal", "module datasheet v1.3"],
    ["C", "ESP32 PLL phase changes after reset and retune", "ESPARGOS hardware paper"],
    ["I", "2-bit lanes from eight C5s can be packed into one 16-bit S31 bus", "PARLIO widths and clocks"],
    ["I", "A 2-bit lane carries 4 MS/s IQ8 continuously (64 of 80 Mbit/s)", "arithmetic"],
    ["O", "C5 IQ buffer → GDMA → PARLIO without CPU copies", "untested"],
    ["O", "Eight C5 PARLIO transmitters stay in lockstep", "untested"],
    ["O", "XTAL_P can be driven cleanly from a shared 48 MHz buffer", "not documented for C5"],
    ["O", "Continuous IQ capture on the C5", "no C5 continuous mode today"],
    ["O", "Coherent TX on C5", "ESPARGOS: works on ESPARGOS One, unpublished"],
    ["S", "16-element coherent TX beamforming", "no evidence yet"],
]

# ---------------------------------------------------------------- success
F["success_tiers"] = [
    ("Minimum", "a solid result even if the tile PCB is late",
     ["C5 raw IQ exported over PARLIO, measured", "C5 + S31 streaming to a PC over GbE", "two C5s on one reference, phase-calibrated",
      "open-source code + measurement report"]),
    ("Target", "the proposal as planned",
     ["one 8-element tile at 640 Mbit/s", "two tiles: calibrated 4 × 4 beamforming and AoA", "both data modes working",
      "a published dataset of synchronized captures"]),
    ("Stretch", "only after the target is met",
     ["Doppler / passive radar demo", "separate-TX bistatic experiments", "first coherent-TX experiments", "FPGA or S31 preprocessing"]),
]

# ---------------------------------------------------------------- references (additions)
_extra = [
    ("Espressif, ESP32-C5 Technical Reference Manual v1.1 — Parallel IO (ch. 43), GDMA, ETM.", "documentation.espressif.com/esp32-c5_technical_reference_manual_en.pdf"),
    ("Espressif, ESP32-S31 Series Datasheet v0.5 (pre-release), 2026 — PARLIO, Gigabit EMAC with IEEE 1588.", "documentation.espressif.com/esp32-s31_datasheet_en.html"),
    ("ESP-SDR, ESP32-S31 streaming notes and test reports (16-lane PARLIO, ESR2 over GbE).", "github.com/ESPARGOS/esp-sdr/blob/main/docs/s31-streaming.md"),
    ("Espressif, ESP-IDF Parallel IO (PARLIO) TX driver, ESP32-C5.", "docs.espressif.com/projects/esp-idf/en/latest/esp32c5/api-reference/peripherals/parlio/parlio_tx.html"),
    ("Analog Devices, MAX2871 23.5–6000 MHz synthesizer with integrated VCO, datasheet.", "analog.com/en/products/max2871.html"),
    ("Skyworks, SKY13351-378LF 0.02–6 GHz SPDT switch, datasheet.", "skyworksinc.com"),
    ("Broadcom, BCM53202M product brief (53202M-PB00-R).", "docs.broadcom.com/doc/53202M-PB00-R"),
    ("Realtek, RTL8211F(I)-CG integrated 10/100/1000 Ethernet transceiver, datasheet.", "realtek.com"),
]
_drop = {"IEEE 802.11bf-2025, Enhancements for WLAN sensing."}
REFS = list(REFS0[:13]) + _extra + [r for r in REFS0[13:] if r[0] not in _drop]
