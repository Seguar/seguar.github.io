"""All slide text and numbers. Research-dependent items are marked  # CHECK  until verified."""
import budget as B
from deckkit import INK, MUTED, FAINT, TEAL, BLUE, AMBER

F = {}

# ---------------------------------------------------------------- key assumptions (single source)
FS = 80e6               # ESP-SDR C5 max nominal rate (burst_limits.h)
N_SNAP = 16380          # ESP-SDR C5 IQ_WORDS: max complex samples per snapshot (chip.h)
R_UART = 2e6            # ESP-SDR UART0 default 2 Mbaud (8N1 -> ~1.6 Mbit/s payload)
R_USB = 12e6            # USB-Serial-JTAG full-speed line rate (upper bound)
R_SDIO = 81e6           # ESP-Hosted-MCU measured C5 -> host, 4-bit SDIO @ 40 MHz (needs new firmware for IQ)
R_PARLIO = 320e6        # PARLIO 8 bit x 40 MHz line-rate ceiling (inferred, untested)
SNAP_BYTES = N_SNAP * 2  # IQ8 wire format (CAP16)
T_CAP = N_SNAP / FS

# ---------------------------------------------------------------- existing work
F["existing_source_line"] = "Sources: ESPARGOS One datasheet (June 2026), espargos.net, pyespargos, arXiv 2502.09405; ESP-SDR page and repository (HEAD 2026-10-08)."
F["espargos_points"] = [
    ("C", "ESPARGOS One: 8 ESP32-C61 sensors + a controller ESP32; 4 × 2 dual-polarized patches, 2.4 GHz"),
    ("C", "shared 40 MHz clock + 2.4 GHz reference through a splitter and an RF switch at every sensor"),
    ("C", "PLL phase changes after every reset and channel change, so calibration is repeated per configuration"),
    ("C", "raw IQ (closed firmware): wired trigger, packet timestamps ≤ 37.5 ns apart, CW tone from the controller’s PLL"),
    ("C", "up to 4 boards (32 elements) combined; clock + reference share one SMA cable in a star"),
]
F["espsdr_points"] = [
    ("C", "raw IQ from an undocumented modem sample-dump engine; 10 chips; open source since Sept 2026"),
    ("C", "ESP32-C5 receives at 5 GHz: a 5.5 GHz test tone, and a second C5 on channels 36/48 (5.17–5.25 GHz)"),
    ("C", "C5: snapshots of ≤ 16,380 samples at up to 80 MS/s, 10-bit I/Q, sent over USB or UART"),
    ("C", "software trigger only; no timestamps, no multi-device synchronization"),
    ("C", "receive-only; ESP-SDR's CPU spectrum mode on the C5 returns power, not complex bins"),
]
F["new_points"] = [
    ("I", "the ESPARGOS synchronization principle at 5.2 GHz with a 48 MHz reference"),
    ("O", "one external 48 MHz clock driving 16 ESP32-C5 chips; C5 LO-phase behaviour"),
    ("O", "hardware trigger and capture alignment for C5 snapshots"),
    ("O", "a faster output port (SDIO / parallel IO) for captured samples"),
    ("I", "in-band 5.2 GHz calibration network; tiled aggregation and on-tile reduction"),
]
F["existing_step"] = 0.88

# ---------------------------------------------------------------- chips
F["chips_source_line"] = "Sources: Espressif datasheets (C5 v1.5, S31 v0.5 pre-release, others current); ESP-SDR README chip-support table. Checked 12 Oct 2026."
F["chips_rows"] = [
    ["Chip", "Wi-Fi", "5 GHz", "Main crystal", "Relevance here"],
    [{"c": "ESP32-C5", "color": TEAL}, "Wi-Fi 6, 2412–2484 + 5180–5885 MHz", {"c": "yes", "color": TEAL}, "48 MHz",
     {"c": "only 5 GHz part; separate ANT_5G pin; ESP-SDR snapshot IQ", "color": INK}],
    ["ESP32", "Wi-Fi 4, 2.4 GHz", "no", "40 MHz", "2.4 GHz only"],
    ["ESP32-S2 / S3", "Wi-Fi 4, 2.4 GHz", "no", "40 MHz", "2.4 GHz only"],
    ["ESP32-C2 / C3", "Wi-Fi 4, 2.4 GHz", "no", "26 or 40 / 40 MHz", "2.4 GHz only"],
    ["ESP32-C6 / C61", "Wi-Fi 6, 2.4 GHz", "no", "40 MHz", "C61 is the sensor in ESPARGOS One"],
    ["ESP32-H2", "none (BLE, 802.15.4)", "no", "32 MHz", "no Wi-Fi; ESP-SDR still receives"],
    ["ESP32-S31", "Wi-Fi 6, 2.4 GHz", "no", "40 MHz", "continuous IQ streaming in ESP-SDR (experimental), 2.4 GHz only"],
]
F["chips_takeaway"] = [
    [("Only the ESP32-C5 reaches 5.2 GHz natively. ", {}),
     ("ESP-SDR receives on all ten parts, but every other chip would need an external mixer and LO per element "
      "to reach 5.2 GHz — which defeats the point of a low-cost array. The price: the C5 has no continuous IQ path today.",
      {"color": MUTED})]]

# ---------------------------------------------------------------- clock
F["clock_source_line"] = "ESP32-C5 HW design guidelines (48 MHz only, ±10 ppm, >500 mV, 24 nH series L); ESP32-S2 HDG oscillator note; TI SWRA029 (20·log N); buffer and TCXO datasheets."
F["clock_items"] = [
    ("Frequency", "All 16 LOs derive from one oscillator, so carrier offsets between elements vanish. "
                  "The absolute ppm error is common to all and harmless.", 1.12),
    ("Static skew", "Buffer skew becomes a fixed LO phase: 50 ps ≈ 94° at 5.2 GHz. Calibration removes it — but "
                    "skew drifting with temperature shows up as phase drift.", 1.12),
    ("Jitter", "In-band reference noise rises by 20·log(5200/48) = 40.7 dB. Jitter common to all elements cancels "
               "in relative phase; buffer additive jitter (20–160 fs max ≈ 0.04–0.3°) does not.", 1.3),
    ("Injection", "The C5 design guidelines cover only a 48 MHz ±10 ppm crystal, with no external-oscillator requirements "
                  "(the datasheet calls XTAL_P/N a crystal or oscillator input). Precedents: "
                  "the ESP32-S2 guide (oscillator into XTAL_P via ~50 pF), ESPARGOS (40 MHz shared), Espressif’s "
                  "esp-crab (two C5s, “co-crystal”). C5 modules carry their own crystal.", 1.85),
]
F["clock_injection_status"] = "O"
F["clock_numbers"] = [
    ["N = 5200 / 48", "≈ 108 (+40.7 dB)"],
    ["1 ps rms jitter", "1.87° rms"],
    ["50 ps static skew", "94° (calibrated)"],
    ["108 × 48 MHz", "5184 MHz — in band"],
]

# ---------------------------------------------------------------- cal network
F["cal_source_line"] = "Architecture adapted from ESPARGOS (shared phase reference + per-antenna switch). Loss numbers are indicative, not designed."

# ---------------------------------------------------------------- tile
F["tile_source_line"] = "Block diagram of the proposed tile. Part choices (switch, buffer, controller) are candidates, not selections."
F["tile_note_geometry"] = ("A WROOM-1U module (18 × 21.2 mm) would fit behind a 28.8 mm cell, but clock, cal, switch and power "
                           "routing would not. Keep the patch board separate (as ours is) and cable each element to its tile.")
F["tile_note_clock"] = ("Modules contain a crystal. To share 48 MHz the tile uses bare ESP32-C5 chips with "
                        "XTAL_P driven from the buffer.")   # CHECK
F["tile_note_data"] = ("ESP-SDR exports over USB / UART only. The tile needs new C5 firmware that pushes the "
                       "snapshot out over SDIO (4-bit, ≤ 50 MHz) or PARLIO (8-bit, ≤ 40 MHz) with the tile as host.")

# ---------------------------------------------------------------- data problem
F["dataproblem_source_line"] = "C5 links: datasheet line rates; SDIO figure measured by Espressif (ESP-Hosted-MCU, 4-bit @ 40 MHz); PARLIO = 8 bit × 40 MHz ceiling. Raw IQ as 8-bit I + 8-bit Q."
F["dataproblem_items"] = [
    ("C5 UART (ESP-SDR default)", 2, "link"),
    ("C5 USB-Serial-JTAG (ESP-SDR)", 12, "link"),
    ("C5 SDIO slave, measured", 81, "link"),
    ("C5 PARLIO ceiling", 320, "link"),
    ("Gigabit Ethernet", 1000, "link"),
    ("1 element, 80 MS/s", 1280, "need"),
    ("16 elements, 20 MS/s", 5120, "need"),
    ("10 Gigabit Ethernet", 10000, "link"),
    ("16 elements, 80 MS/s", 20480, "need"),
]
F["dataproblem_text"] = [
    "The C5 samples at up to 80 MS/s internally, but ESP-SDR moves captures out over USB (12 Mbit/s line rate) "
    "or UART — about a hundred times slower than one element produces data.",
    "The fastest documented C5 ports (SDIO, parallel IO) would need new firmware and still stay below one "
    "element’s raw rate. Continuous raw transport of 16 channels is out of scope.",
    "So the real question is how many useful snapshots per second we need, and how much we can reduce them "
    "before they leave the tile.",
]

# ---------------------------------------------------------------- snapshots
F["snap_title"] = "What ESP-SDR gives us today: snapshots, not streams"
F["snap_source_line"] = "ESP-SDR C5 limits from chip.h (IQ_WORDS = 16,380), README and PR #9 (retune time). Transfer times are upper bounds from line rates — no measured C5 snapshot rate is published."
cap_us = T_CAP * 1e6
F["snap_segments"] = [("capture", 0.75, "cap"), ("transfer to host / tile", 3.3, "xfer"), ("re-arm", 0.55, "idle"),
                      ("capture", 0.75, "cap"), ("transfer to host / tile", 3.3, "xfer"), ("re-arm", 0.55, "idle"),
                      ("capture", 0.75, "cap"), ("…", 0.5, "idle")]
F["snap_timeline_note"] = (f"The largest C5 snapshot is {N_SNAP:,} complex samples: {cap_us:.2f} µs at 80 MS/s, "
                           f"{SNAP_BYTES:,} bytes as 8-bit I/Q. Moving it out takes 100–1000× longer than capturing it, "
                           "so the duty cycle is set by the output port, not by the ADC.")
rows = [["Output port (per element)", "Transfer time", "Snapshots / s", "Duty cycle"]]
for lab, r in (("UART, 2 Mbaud (ESP-SDR today)", R_UART * 0.8), ("USB-Serial-JTAG, 12 Mbit/s line", R_USB),
               ("SDIO 4-bit, 81 Mbit/s (new firmware)", R_SDIO), ("PARLIO 8-bit × 40 MHz (ceiling)", R_PARLIO)):
    t = SNAP_BYTES * 8 / r
    rows.append([lab, f"{t * 1e3:.1f} ms", f"≤ {1 / (t + T_CAP):.0f}", f"≤ {T_CAP / (t + T_CAP) * 100:.2g} %"])
F["snap_table_title"] = f"Best case for one {N_SNAP:,}-sample IQ8 snapshot"
F["snap_table_cols"] = [3.0, 1.2, 1.25, 1.2]
F["snap_table_rows"] = rows
F["snap_points"] = [
    "Raw snapshots suit calibration research, beamforming and offline algorithm work — the first milestones.",
    "Doppler and tracking need many snapshots with no retune in between (a C5 retune takes ~28–35 ms at 5 GHz).",
    "Higher duty cycle has to come from a faster C5 port or from reducing data before it leaves the C5 or tile.",
]

# ---------------------------------------------------------------- options
F["options_source_line"] = "Effort and suitability are judgements for a student team. A–D assume the C5 (slave ports, snapshots); E assumes an ESP32 with its own Ethernet MAC (S31)."
hdr = ["", "A · Direct to host", "B · Central MCU", "C · Central FPGA", "D · Smart tiles", "E · Ethernet per element"]
F["options_rows"] = [
    hdr,
    ["Topology", "each C5 → USB hub → PC", "16 C5 → one MCU → Ethernet", "16 C5 → FPGA → DDR → Ethernet",
     "4 × (4 C5 → tile FPGA) → hub", "8 ESP → own 100 Mbit link → 8 + 1 switch → GbE"],
    ["Good for", "bring-up, 1–4 channels, CSI", "sparse snapshots, CSI, control",
     "deterministic capture, on-board DSP", "scaling, modular PCBs, local reduction", "continuous IQ, standard networking"],
    ["Data limit", "USB full speed per C5", "MCU must host 16 slave ports",
     "set by the 16 C5 ports", "¼ of the array per tile", "≈ 96 Mbit/s per element (≈ 6 MS/s IQ8)"],
    ["Trigger timing", "shared GPIO possible; capture latency unknown",
     "µs-level GPIO", "ns-level, deterministic", "ns inside a tile; hub aligns tiles", "shared reference + GPIO; Ethernet gives coarse time"],
    ["Hardware effort", "low", "medium", "high: one dense board", "medium–high: two board types", "medium: PHY per element, one switch"],
    ["Where it fits", {"c": "phase 1", "color": TEAL}, {"c": "C5 alternative", "color": BLUE},
     {"c": "only with fast C5 output", "color": MUTED}, {"c": "5.2 GHz C5 path", "color": TEAL}, {"c": "2.4 GHz S31 path", "color": TEAL}],
]
F["options_row_heights"] = [0.45, 0.78, 0.62, 0.78, 0.78, 0.62, 0.45]

# ---------------------------------------------------------------- data flow
F["dataflow_source_line"] = "Today = ESP-SDR over USB-Serial-JTAG. SDIO = 81 Mbit/s measured by Espressif for C5 → host (ESP-Hosted-MCU); pushing IQ over it needs new firmware."
F["dataflow_rates"] = [
    "today ≤ 12 Mbit/s (USB)\nSDIO firmware ≈ 80 Mbit/s",
    "≈ 320 Mbit/s raw per tile\nmuch less after reduction",
    "≈ 1.3 Gbit/s raw peak\nbuffer in DDR, reduce",
]
F["dataflow_tasks"] = [
    ["RF tuning, fixed gain", "snapshot ≤ 16,380 samples into SRAM", "(80 MS/s × 32-bit words, on-chip only)",
     "pack to 8- or 10-bit I/Q", "push out over the slave port"],
    ["trigger + ANT/CAL sequencing", "4 parallel captures (SDIO/PARLIO host)", "phase / gain correction",
     "decimation, FFT, bin selection", "tile packets with timestamps"],
    ["epoch master, timestamps", "align 4 tiles", "DDR snapshot buffer", "array calibration, beamforming", "UDP to host"],
    ["store snapshots + cal state", "DOA / MUSIC, radar DSP", "visualization", "algorithm development"],
]
F["dataflow_insight"] = [
    [("The bottleneck sits inside each C5 — 64 KiB of capture memory and a slow output port — not in the backbone. ", {}),
     ("Even with a faster SDIO path, raw snapshots from 16 elements peak just above Gigabit Ethernet, so the hub buffers "
      "bursts in DDR and the tiles reduce. 10 GbE only matters if continuous C5 output becomes possible.", {"color": MUTED})]]

# ---------------------------------------------------------------- budget
el = B.raw_rate(FS)
def r3(x):
    return B.fmt_rate(x)
SNAPS = 100
cov_bytes = 136 * 8
rows = [["Stage", "per element", "per tile (×4)", "array (×16)", "comment"]]
rows.append(["Internal IQ, 80 MS/s, 8-bit I/Q", r3(el), r3(4 * el), r3(16 * el), "inside the chip only (native words are 32 bit)"])
rows.append([f"One snapshot, {N_SNAP:,} samples (IQ8)", B.fmt_bytes(SNAP_BYTES), B.fmt_bytes(4 * SNAP_BYTES),
             B.fmt_bytes(16 * SNAP_BYTES), f"{cap_us:.2f} µs of signal at 80 MS/s"])
rows.append([f"{SNAPS} raw snapshots/s", r3(SNAP_BYTES * 8 * SNAPS), r3(4 * SNAP_BYTES * 8 * SNAPS),
             r3(16 * SNAP_BYTES * 8 * SNAPS), "more than USB can carry per element"])
rows.append(["Today: USB-Serial-JTAG (line rate)", r3(R_USB), "—", "—", "≤ 45 snapshots/s, before overheads"])
rows.append(["With SDIO firmware (measured link)", r3(R_SDIO), r3(4 * R_SDIO), r3(16 * R_SDIO), "array peak above GbE: buffer and reduce"])
fft_bins = 64
fb = fft_bins * 4 * SNAPS * 8
rows.append([f"{fft_bins} FFT bins per snapshot, {SNAPS}/s", r3(fb), r3(4 * fb), r3(16 * fb), "complex, 16-bit I/Q"])
cov = cov_bytes * 8 * SNAPS
rows.append([f"16 × 16 covariance, {SNAPS}/s", "—", "—", r3(cov), "136 complex float32 per band"])
bm = 32 * 32 * 2 * 8 * SNAPS
rows.append([f"32 × 32 beam-power map, {SNAPS}/s", "—", "—", r3(bm), "16-bit power per direction"])
csi = 64 * 2 * 8 * SNAPS
rows.append([f"CSI, 64 subcarriers, {SNAPS} packets/s", r3(csi), r3(4 * csi), r3(16 * csi), "8-bit I/Q per subcarrier"])
F["budget_rows"] = rows
F["budget_row_heights"] = [0.42] + [0.48] * (len(rows) - 1)
F["budget_source_line"] = f"Assumptions: 80 MS/s, 8-bit I/Q, {N_SNAP:,}-sample snapshots (ESP-SDR maximum on C5), {SNAPS} snapshots or packets per second. Replace with phase-1 measurements."
F["budget_takeaway"] = ("Four orders of magnitude separate raw IQ from beamforming products. Deciding where the reduction "
                        "happens is the main architecture decision.")

# ---------------------------------------------------------------- modes
F["modes_source_line"] = "Sizes for the whole 16-element array per snapshot or packet, using the budget assumptions."
F["modes_rows"] = [
    ["Mode", "What leaves the tile", "Array data per event", "Used for", "Computed where"],
    [[[("1  Raw snapshot", {"color": INK})]], "synchronized IQ window from all 16 elements",
     B.fmt_bytes(16 * SNAP_BYTES), "calibration research, offline algorithms, radar trials", "nothing — stored as captured"],
    [[[("2  Local FFT", {"color": INK})]], "selected bins / channels, complex (magnitude + phase)",
     B.fmt_bytes(16 * fft_bins * 4), "narrowband DOA, spectral snapshots, sensing", "tile FPGA — the C5 FFT exports power only today"],
    [[[("3  Array features", {"color": INK})]], "phase-corrected samples, beam sums, covariance / correlation matrices",
     B.fmt_bytes(cov_bytes), "MUSIC / ESPRIT, beam scanning, nulling", "tile + hub"],
    [[[("4  CSI / packet data", {"color": INK})]], "per-packet channel estimates from the Wi-Fi receiver",
     B.fmt_bytes(16 * 64 * 2), "AoA of Wi-Fi stations, channel sounding, sensing", "C5 Wi-Fi stack"],
]
F["modes_row_heights"] = [0.42, 1.0, 1.0, 1.0, 1.0]
F["modes_takeaway"] = [[("Phases 1–3 live in modes 1 and 4. ", {}),
                        ("Modes 2 and 3 need the tile FPGA and become the default once calibration is stable — "
                         "they are what makes repeated, Doppler-capable measurements possible.", {"color": MUTED})]]

# ---------------------------------------------------------------- central vs tiled
F["cvt_source_line"] = "Qualitative comparison for a 16-element system; numbers depend on the measured C5 output rate."
F["cvt_rows"] = [
    ["", "Central (one board, 16 links)", "Tiled (4 × 2×2 + hub)"],
    ["High-speed routing", "16 links converge on one connector field", "4 short links per tile, 4 uplinks"],
    ["Clock / cal distribution", "1:16 trees on one board", "1:4 at the hub, 1:4 on each tile"],
    ["Bring-up and debugging", "all-or-nothing", "one tile works alone"],
    ["PCB risk", "one large, dense RF + digital board", "small boards, built four times"],
    ["Backbone bandwidth", "all raw data reaches the centre", "reduced data from each tile"],
    ["Scaling beyond 16", "redesign", "add tiles (hub ports permitting)"],
    ["Cost of the extra layer", "none", "4 tile controllers, inter-tile alignment"],
]
F["cvt_row_heights"] = [0.45] + [0.52] * 7
F["cvt_takeaway"] = ("Tiling wins on everything except the extra controller per tile and the need to align tiles "
                     "to each other — which the shared references already provide.")

# ---------------------------------------------------------------- processors
F["proc_source_line"] = "C5 port limits from the ESP32-C5 datasheet v1.5; controller capabilities from vendor documentation. Examples, not selections."
F["proc_rows"] = [
    ["Role", "Candidates", "Why", "When it is the right choice"],
    ["Tile, small FPGA", "Lattice ECP5, iCE40 UltraPlus, Efinix Trion",
     "four C5 slave ports need four hosts: 4 SDIO hosts or 4 × 8-bit parallel receivers are easy in fabric; open toolchain (ECP5 / iCE40)",
     "default tile controller: deterministic triggers, capture, correction, FFT"],
    ["Tile, MCU", "STM32H7-class", "DMA, ~1 MB SRAM, 100 Mbit Ethernet; but only two SDMMC hosts",
     "two C5s per MCU, snapshots and CSI only"],
    ["Control plane", "RP2350", "PIO state machines for trigger and ANT/CAL timing; cheap; USB full speed",
     "sequencing next to an FPGA or MCU — not a data path"],
    ["Hub, SoC FPGA", "Zynq-7020 (PYNQ-Z2, Zybo Z7)", "ARM + FPGA, DDR3, Gigabit Ethernet, mature student tooling",
     "snapshot mode: ~1.3 Gbit/s peaks buffered in DDR"],
    ["Hub, larger", "Zynq UltraScale+ / Kria K26", "more fabric, DDR4, multi-gigabit transceivers",
     "only if continuous C5 output becomes possible"],
]
F["proc_row_heights"] = [0.42] + [0.72] * 5
F["proc_takeaway"] = ("Size the hardware from the measured output of one C5 × 16, not from 80 MS/s × 16. "
                      "Because every C5 port is a slave port, the tile controller must host four of them at once — "
                      "the strongest argument for a small FPGA per tile.")

# ---------------------------------------------------------------- beamforming
F["bf_source_line"] = "Array factor computed for ideal isotropic elements; real embedded patterns and coupling will differ."
F["bf_steps"] = [
    "Place a 5.2 GHz CW or Wi-Fi source in the far field (2D²/λ ≈ 0.9 m for the 163 mm aperture diagonal; use ≥ 1 m).",
    "Calibrate with the internal tone, then capture snapshots with the source at known angles.",
    "Form beams digitally: y = wᴴx with w = steering vector; scan azimuth and elevation.",
    "Estimate angle with conventional beamforming and MUSIC; add a second source for nulling.",
]
F["bf_success"] = [
    "The measured beam pattern matches the predicted one to within a few dB in the main lobe.",
    "The estimated angle repeats after a power cycle and retune — proving that calibration, not luck, "
    "produced coherence.",
]

# ---------------------------------------------------------------- radar
F["radar_source_line"] = "Status = evidence on ESP32-class hardware. Literature: Chetty 2012, Colone 2011, Yildirim 2020, Euchner 2025 (passive channel charting). f_D = 2v/λ; Δr = c/2B."
F["radar_intro"] = None
F["radar_rows"] = [
    ["", "Experiment", "What we would measure", "Evidence and dependencies"],
    ["C", "Wi-Fi sensing from CSI", "motion, presence, gestures, breathing-scale phase changes",
     "CSI on ESP32 is widely used; C5 CSI gives 52–242 subcarriers"],
    ["I", "Passive localization of people / objects", "angle of arrival, multipath changes, position",
     "ESPARGOS: 4 arrays + Wi-Fi beacons, 0.25–0.43 m error on a robot (2.4 GHz)"],
    ["I", "Passive Doppler radar, access point as illuminator", "Doppler and angle of moving people",
     "no ESP32 Doppler demo published; limited by direct-signal leakage, not SNR"],
    ["I", "Bistatic / TDM-MIMO, one C5 sends packets", "AoA + Doppler with a controlled source",
     "ESPARGOS One radar mode: one sensor transmits frames, the others receive"],
    ["O", "Active CW or stepped-frequency on C5", "Doppler (CW), coarse range (stepping)",
     "a 5 GHz tone from a C5 is undocumented; regulatory status unclear"],
    ["S", "FMCW- or pulse-like waveforms", "range–Doppler maps",
     "needs arbitrary TX, which is not public; outside the RLAN exemption"],
]
F["radar_row_heights"] = [0.42] + [0.56] * 6
F["radar_after"] = (5.45, 1.2, [
    "Doppler at 5.2 GHz is 34.7 Hz per m/s. A walking person (≈ 1.4 m/s) needs ≈ 60 ms of coherent slow time for 0.5 m/s resolution "
    "and ≥ 100 snapshots/s to stay unambiguous — more than USB transport allows, so Doppler waits for a faster port or CSI.",
    "Range resolution is c/2B: 7.5 m at 20 MHz, ≈ 3.1 m at the C5’s 48 MHz analog limit. Angle and Doppler are the strengths."])

# ---------------------------------------------------------------- comms
F["comms_source_line"] = "Receive-side items need calibrated coherent capture or CSI; the TX item depends on the open questions on the next slide."
F["comms_intro"] = None
F["comms_rows"] = [
    ["", "Experiment", "Content", "Builds on"],
    ["I", "Receive beamforming", "steer a digital beam to a Wi-Fi station; measure SNR gain against one element", "calibrated snapshots"],
    ["I", "Interference nulling", "two transmitters; place a null on one, keep the other", "covariance estimation"],
    ["I", "Wi-Fi angle of arrival", "AoA of real stations from per-packet CSI — shown at 2.4 GHz by ESPARGOS", "CSI mode + calibration"],
    ["I", "MIMO channel measurements", "16-element channel matrices, multipath, angle–delay profiles", "CSI or raw snapshots"],
    ["I", "Localization and beam tracking", "follow a moving station; compare with ground truth", "repeated snapshots / CSI"],
    ["O", "Distributed coherent TX", "beam-steered transmission from several C5s", "TX phase control (open)"],
]
F["comms_row_heights"] = [0.42] + [0.62] * 6

# ---------------------------------------------------------------- TX
F["tx_source_line"] = "C5 datasheet v1.5; ESP-SDR README, issue #3; ESP-IDF esp_phy_cert_test.h; ESPARGOS One manual §9.4; ECC/DEC/(04)08; Israeli regs 2021."
F["tx_intro"] = None
F["tx_rows"] = [
    ["", "Capability", "Evidence / comment"],
    ["C", "Standard Wi-Fi packet TX at 5 GHz on every C5", "datasheet: 18 dBm typ. at low rates (chip level)"],
    ["C", "One element transmits, the others receive (TDM)", "ESPARGOS One radar mode does this at 2.4 GHz"],
    ["I", "All TX carriers on the same frequency", "follows from the shared 48 MHz reference"],
    ["O", "Known, repeatable TX LO phase after each PLL lock", "unknown; RX calibration does not measure the TX path"],
    ["O", "Simultaneous TX start on 16 chips", "packet TX timing belongs to the Wi-Fi MAC, not to us"],
    ["O", "CW tone at 5 GHz on the C5", "cert-test API esp_phy_wifi_tx_tone() is documented for channels 1–14 only"],
    ["O", "Arbitrary IQ playback on the C5", "ESP-SDR is receive-only; its authors say arbitrary TX works but are not releasing it (misuse and certification concerns)"],
    ["S", "16-element coherent transmit beamforming", "needs all of the above plus over-the-air TX calibration"],
]
F["tx_row_heights"] = [0.42] + [0.45] * 8
F["tx_after"] = (5.55, 1.1, [
    "Regulation: 5150–5250 MHz allows 200 mW EIRP, indoor, in both the EU and Israel, for EN 301 893 RLAN equipment. "
    "Sixteen coherent elements add up to 24 dB over one, and custom radar waveforms are probably not covered — "
    "do TX experiments cabled, shielded or at low power, on channels 36–48."])

# ---------------------------------------------------------------- power
I_RX, I_TX = 110, 408   # mA, ESP32-C5 datasheet v1.5 Table 5-8 (5 GHz RX HT20, TX 11a @ 18 dBm)
pr = [["Load", "per unit", "count", "total"]]
pr.append(["ESP32-C5, receive (5 GHz)", f"{I_RX} mA", "16", f"{16 * I_RX / 1000:.2f} A"])
pr.append(["ESP32-C5, transmit peak (5 GHz)", f"{I_TX} mA", "16", f"{16 * I_TX / 1000:.2f} A"])
pr.append(["Tile controller (small FPGA)", "≈ 150 mA", "4", "0.60 A"])
pr.append(["Clock buffers, TCXO, switches", "≈ 30 mA", "6", "0.18 A"])
pr.append(["Hub SoC board (own supply)", "≈ 5 W", "1", "—"])
rx_total = (16 * I_RX + 600 + 180) / 1000
tx_total = (16 * I_TX + 600 + 180) / 1000
pr.append([[[("All receiving", {"color": INK})]], "", "", f"{rx_total:.1f} A · {rx_total * 3.3:.1f} W"])
pr.append([[[("All transmitting (worst case)", {"color": INK})]], "", "", f"{tx_total:.1f} A · {tx_total * 3.3:.0f} W"])
F["power_rows"] = pr
F["power_notes"] = [
    "Espressif asks for ≥ 0.6 A of supply capability per chip: 2.4 A per tile, 9.6 A for the array, plus 10 µF on each VDDA rail.",
    "TX current comes in bursts; a shared rail droops and can pull the reference — keep clock buffers on a separate, quiet LDO.",
    f"Heat: about {rx_total * 3.3:.0f} W in receive spread over four tiles is easy; continuous all-TX ({tx_total * 3.3:.0f} W) needs airflow and should not be the normal mode.",
]
F["power_source_line"] = "ESP32-C5 datasheet v1.5, Table 5-8 (peak, 3.3 V, 25 °C) and HW design guidelines (≥ 0.6 A supply per chip). Controller and clock figures are rough planning values."
F["board_points"] = [
    "Antenna aperture stays a separate board (ours): no tile seams across the radiating surface.",
    "One coax per element from patch board to tile; phase-matched or measured once with a VNA.",
    "Bare ESP32-C5 chips on the tile so XTAL_P can be driven; each with its own flash and RF matching.",
    "RF: 50 Ω grounded coplanar lines, short runs from SMA to SPDT to C5, via fences between lanes.",
    "Clock: point-to-point traces from a 1:4 buffer, series-terminated, away from RF and switching regulators.",
    "Calibration splitter on the tile with a test SMA, so one tile can be calibrated on the bench alone.",
]

# ---------------------------------------------------------------- stages
F["stages_source_line"] = "Each exit test is a go / no-go decision. Phase 1 also picks the band; no 16-element hardware is ordered before phase 2 shows stable coherence."
F["stages"] = [
    {"n": "1", "title": "One C5, one S31", "when": "dev boards, ESP-SDR, pinned toolchains",
     "goals": ["C5: 5.2 GHz snapshots, rates, retune time", "S31: 2.4 GHz stream over USB HS and 100 Mbit Ethernet",
               "I/Q order, spectral sign, gain tables", "compare duty cycle, stability, effort"],
     "gate": "measured capture paths; band and chip chosen on data"},
    {"n": "2", "title": "Two coherent radios", "when": "small chip-down board",
     "goals": ["one TCXO (48 or 40 MHz) into both XTAL_P", "shared trigger or timestamps",
               "split one reference tone into both", "phase vs time, temperature, retune, reset",
               "(τ, φ) estimation and correction"],
     "gate": "relative phase stable to a few degrees between calibrations"},
    {"n": "3", "title": "One tile", "when": "2×2 C5 + FPGA, or 8 S31 + switch",
     "goals": ["elements, SPDTs, splitter, clock buffer", "synchronized capture or streaming",
               "tile calibration", "AoA and beamforming on one tile"],
     "gate": "repeatable AoA within a few degrees after a power cycle"},
    {"n": "4", "title": "4×4 array", "when": "4 C5 tiles + hub, or 2 S31 tiles + switch",
     "goals": ["reference distribution across tiles", "inter-tile alignment", "2D beam scan and DOA",
               "one sensing or comms demo"],
     "gate": "16-element calibrated beam scan; dataset + report"},
]

# ---------------------------------------------------------------- risks
F["risks_source_line"] = "Ordered roughly by impact. Each risk has a test in phase 1 or 2 and a fallback that keeps a useful result."
F["risk_rows"] = [
    ["Risk", "Why it matters", "How we find out early", "Fallback"],
    ["External reference drive (48 MHz C5 / 40 MHz S31) misbehaves", "no frequency lock across elements",
     "phase 2 board: CFO and phase drift vs drive level", "per-snapshot calibration with own crystals"],
    ["No usable capture trigger on the C5", "channels start at unknown times",
     "phase 2: GPIO-triggered capture, measure jitter", "align on a shared reference packet (ESPARGOS)"],
    ["LO phase re-rolls on every capture", "calibration before each snapshot",
     "phase 2: repeated captures without retune", "CAL and ANT inside one capture window"],
    ["C5 output stays at USB speed", "few snapshots per second, no Doppler",
     "phase 1: SDIO / PARLIO prototype", "S31 Ethernet path, or CSI mode"],
    ["S31 stream unstable on 8–16 boards", "gaps break coherent integration",
     "phase 1: hours-long stream at 4 MS/s over 100 Mbit", "lower rate, or bursts with sequence numbers"],
    ["Ethernet loss or queueing in the switch", "missing or late packets",
     "phase 3: 8 streams through one switch", "sequence numbers + host re-alignment"],
    ["ESP-SDR internals change", "private PHY calls pinned to one IDF commit",
     "pin IDF, silicon revision and firmware", "keep a frozen toolchain image"],
    ["Clock harmonics and RF layout", "spurs (e.g. 5184 MHz), switch leakage",
     "spectrum of a tile prototype; VNA", "clipped-sine clock, shielding, move LO"],
]
F["risk_row_heights"] = [0.42] + [0.6] * 8

# ---------------------------------------------------------------- claims register
F["claims_source_line"] = "Checked 12–13 Oct 2026 against the references; open items become bench tests in phases 1–2."
F["claims_rows"] = [
    ["", "Claim", "Basis"],
    ["C", "ESP32-C5 receives 5180–5885 MHz (covers 5.2 GHz), separate ANT_5G pin", "Espressif datasheet v1.5"],
    ["C", "ESP32-C5 needs a 48 MHz, ±10 ppm main crystal", "datasheet; HW design guidelines"],
    ["C", "ESP-SDR captures raw IQ on the C5: ≤ 16,380 samples, ≤ 80 MS/s, out via USB / UART", "ESP-SDR source (chip.h) and README"],
    ["C", "ESP32-S31: 2.4 GHz-only Wi-Fi 6 with a 1000 Mbit/s Ethernet MAC, 40 MHz crystal", "S31 datasheet v0.5 (pre-release)"],
    ["C", "ESP-SDR streams S31 IQ continuously, up to 40 MS/s over GbE (experimental)", "ESP-SDR docs; 600 s loss-free test"],
    ["C", "Shared clock + switched in-band reference gives phase coherence at 2.4 GHz", "ESPARGOS papers and product"],
    ["C", "ESP32 PLL phase changes after reset and retune", "ESPARGOS hardware paper (arXiv 2502.09405)"],
    ["C", "No quantitative ESPARGOS phase-error figures have been published", "same paper: listed as future work"],
    ["I", "The same principle works at 5.2 GHz with a 48 MHz reference", "same mechanism; N ≈ 108 instead of ≈ 60"],
    ["I", "A 100 Mbit link carries ≈ 6 MS/s of continuous IQ8 per element", "UDP payload arithmetic"],
    ["O", "XTAL_P can be driven cleanly from a shared buffer (C5 and S31)", "not documented — bench test"],
    ["O", "S31 streaming at 4 MS/s over 100 Mbit on 16 boards at once", "only single-board GbE / USB tests published"],
    ["O", "Capture start / stream alignment across chips", "ESP-SDR has no multi-device sync"],
    ["O", "Continuous output from a C5", "no C5 continuous mode today — do not assume"],
    ["S", "16-channel phase-coherent transmit", "no evidence yet"],
]

# ---------------------------------------------------------------- BOM
F["bom_source_line"] = "Example parts anchor the design; final choices after phases 1–2. Lab instruments (VNA, signal generator, spectrum analyzer, scope) assumed available."
F["bom_rows"] = [
    ["Block", "Qty", "Example / note", "Purpose"],
    ["Antenna aperture", "1", "existing 4×4 patch board, SMA per element", "radiating elements"],
    ["RF cables", "16", "SMA, equal length, characterised once with a VNA", "patch board → tiles"],
    ["ESP32-C5 (chip-down)", "16 (+1)", "QFN48 6 × 6 mm + flash + ANT_5G match; +1 as reference source", "RF elements"],
    ["ESP32-C5 dev boards", "2–4", "DevKitC-1 (module, own crystal) for phase 1", "bring-up, firmware"],
    ["SPDT RF switch", "16", "≥ 6 GHz, high isolation, fast switching", "ANT / CAL selection"],
    ["5.2 GHz reference", "1", "PLL synthesizer module, or a C5 if a 5 GHz tone works", "calibration tone"],
    ["Power splitters", "5", "1:4 at 5–6 GHz (hub + 4 tiles), fixed attenuators", "reference distribution"],
    ["48 MHz TCXO", "1", "±0.5 ppm, clipped sine (e.g. Epson TG2016SMN, SiT5356)", "frequency reference"],
    ["Clock fan-out", "5", "1:4 LVCMOS, ≤ 50 ps skew (e.g. TI LMK1C1104)", "clock distribution"],
    ["Tile controller", "4", "small FPGA (ECP5 / iCE40 / Trion)", "4 port hosts, trigger, reduction"],
    ["Hub", "1", "Zynq-7020 board (PYNQ-Z2 / Zybo Z7)", "aggregation, DDR, Ethernet"],
    ["Interconnect", "4 + 8", "tile data cables; coax for clock and reference per tile", "tile ↔ hub"],
    ["Power", "1 + 4", "5 V supply; per-tile 3.3 V rated 4 × 0.6 A", "supply"],
]

# ---------------------------------------------------------------- success
F["success_source_line"] = "Each tier is a complete project outcome on its own."
F["success_tiers"] = [
    ("Minimum", "a solid result even if the PCB is late",
     ["IQ capture on C5 characterised: rates, timing, limits", "two C5s on one reference, phase-calibrated",
      "measured phase stability and calibration repeatability", "open-source code + measurement report"]),
    ("Target", "the proposal as planned",
     ["one 2×2 tile working, then the 4×4 array", "calibrated digital beamforming and 2D angle estimation",
      "at least one data-reduction mode on the tile", "a published dataset of synchronized snapshots"]),
    ("Stretch", "only after the target is met",
     ["Doppler / passive or bistatic sensing demo", "CSI-based communications experiments",
      "first TX experiments: shared-clock packet TX, phase measurements"]),
]
F["success_takeaway"] = ("A good outcome is measured coherence and a reusable platform — not a single beam plot. "
                         "Every result should survive a power cycle.")

# ---------------------------------------------------------------- references
REFS = [
    ("F. Euchner, T. Schneider, M. Gauger, S. ten Brink, “ESPARGOS: An ultra low-cost, realtime-capable multi-antenna WiFi channel sounder,” WSA & SCC 2023.", "arxiv.org/abs/2502.09405"),
    ("F. Euchner, S. ten Brink, “ESPARGOS: Phase-coherent WiFi CSI datasets for wireless sensing research,” 2024.", "arxiv.org/abs/2408.16377"),
    ("F. Euchner, D. Kellner, P. Stephan, S. ten Brink, “Passive channel charting: Locating passive targets using Wi-Fi CSI,” 2025.", "arxiv.org/abs/2504.09924"),
    ("ESPARGOS One datasheet and Quick Start Manual Rev 1.0, June 2026.", "espargos.net/espargos-one/"),
    ("ESPARGOS documentation: phase-coherent multi-array systems; IQ sampling.", "espargos.net/docs/combined-arrays.html"),
    ("pyespargos library (LGPL-3.0): iq_sync, iq_pool, iq_tone, csi_calibration.", "github.com/ESPARGOS/pyespargos"),
    ("ESP-SDR: raw IQ capture with Espressif’s ESP32 chips (project page).", "espargos.net/espsdr/"),
    ("ESPARGOS/esp-sdr (GPL-3.0), HEAD e74f2a4, 8 Oct 2026: README, targets/esp32c5/chip.h, docs/rx-controls.md, issues #3 #5, PRs #6 #9.", "github.com/ESPARGOS/esp-sdr"),
    ("Espressif, ESP32-C5 Series Datasheet v1.5, Sept 2026.", "espressif.com/sites/default/files/documentation/esp32-c5_datasheet_en.pdf"),
    ("Espressif, ESP32-C5 Hardware Design Guidelines: schematic checklist, PCB layout.", "docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32c5/"),
    ("Espressif, ESP32-C5-WROOM-1/1U Datasheet v1.3; ESP32-S31 Datasheet v0.5 (pre-release).", "espressif.com/en/support/documents/technical-documents"),
    ("Espressif, ESP32-S2 Hardware Design Guidelines — oscillator input on XTAL_P.", "docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s2/"),
    ("Espressif, ESP-Hosted-MCU performance (C5 SDIO throughput).", "github.com/espressif/esp-hosted-mcu/blob/main/docs/design/performance.md"),
    ("Espressif, esp-csi and the esp-crab two-ESP32-C5 example.", "github.com/espressif/esp-csi/tree/master/examples/esp-crab"),
    ("Espressif, ESP-IDF: ESP32-C5 Wi-Fi CSI; esp_phy_cert_test.h (TX tone API).", "docs.espressif.com/projects/esp-idf/en/latest/esp32c5/"),
    ("C. Barrett (ed.), “Fractional/Integer-N PLL basics,” Texas Instruments SWRA029, 1999.", "ti.com/lit/an/swra029/swra029.pdf"),
    ("Datasheets: TI LMK1C1104 (SNAS791D), Epson TG2016SMN, SiTime SiT5356.", "ti.com/lit/ds/symlink/lmk1c1104.pdf"),
    ("K. Chetty, G. E. Smith, K. Woodbridge, “Through-the-wall sensing of personnel using passive bistatic WiFi radar at standoff distances,” IEEE TGRS 50(4), 2012.", "doi.org/10.1109/TGRS.2011.2164411"),
    ("F. Colone, K. Woodbridge, H. Guo, D. Mason, C. J. Baker, “Ambiguity function analysis of wireless LAN transmissions for passive radar,” IEEE TAES 47(1), 2011.", "doi.org/10.1109/TAES.2011.5705673"),
    ("H. C. Yildirim et al., “High resolution 802.11ax-based passive radar for human movement monitoring,” EuRAD 2020 (held January 2021).", "research.dial.uclouvain.be/handle/2078.5/218703"),
    ("S. M. Hernandez, E. Bulut, “Lightweight and standalone IoT based WiFi sensing for active repositioning and mobility,” WoWMoM 2020 (ESP32 CSI Tool).", "github.com/StevenMHernandez/ESP32-CSI-Tool"),
    ("IEEE 802.11bf-2025, Enhancements for WLAN sensing.", "standards.ieee.org/ieee/802.11bf/11574/"),
    ("CEPT ECC/DEC/(04)08 (amended 2021); Israel Wireless Telegraphy (Conformity Approvals) Regulations 2021.", "docdb.cept.org/download/3450"),
    ("h0m3us3r, eSpDR — ESP32-S3 + FPGA raw IQ at 80 MS/s.", "github.com/h0m3us3r/eSpDR"),
]
