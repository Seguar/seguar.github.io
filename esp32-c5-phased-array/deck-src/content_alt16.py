"""Sixteen ESP32-C5s on one board: the options, the control plane and the verdict (site section "alt16").

Researched 16 October 2026: ESP32-S31 datasheet v0.5 (CN) and ESP-IDF soc_caps / PARLIO docs, ESP32-P4 datasheet,
esp-serial-flasher README, esptool C5 boot-mode guide, ESP-USB host docs for the S31, LCSC / DigiKey part pages.
The facts are in the evidence register (research_13 to research_15).

Rates: a 2-bit lane at 40 MHz is 80 Mbit/s, a 1-bit lane 40 Mbit/s; IQ8 is 16 bits per sample. A snapshot is 16,380
samples per element (262 kbit), captured in 205 us at 80 MS/s, then drained: 3.28 ms at 80 Mbit/s (A, C: <= 287/s),
6.55 ms at 40 Mbit/s (B: <= 148/s). One GbE carries 957 Mbit/s of UDP payload at a 1500-byte MTU, 932 Mbit/s of IQ
after ESP-SDR's 32-byte headers: 58 Mbit/s or 3.6 MS/s per element for sixteen; a 16-element snapshot (4.2 Mbit) then
drains in 4.5 ms (D, E: about 210/s).
"""
import html as H

E = H.escape

ALT = {}
ALT["gpio_total"] = 60

ALT["options"] = [
    {"key": "A", "name": "2 × 8 tiles (the plan)", "status": "I",
     "line": "Two S31s and two GbE ports. 2-bit lanes: up to 4 MS/s per element, a snapshot in 3.3 ms. One seam."},
    {"key": "B", "name": "16 receivers, 1-bit lanes", "status": "I",
     "line": "One S31, one GbE, no seam. Snapshots are still 80 MS/s but take 6.6 ms to drain (≤ 148/s); "
             "streaming ≈ 2 MS/s per element."},
    {"key": "C", "name": "8 transmit + 8 receive", "status": "S",
     "line": "One S31: 8 receivers keep 2-bit lanes (4 MS/s, ≤ 287/s) while 8 C5s transmit. A makes the same split "
             "on two tiles, B only on 1-bit lanes. The transmitters have no lanes and today send only Wi-Fi frames."},
    {"key": "D", "name": "FPGA hub", "status": "I",
     "line": "16 × 2-bit lanes (1.28 Gbit/s) into an FPGA that drives the PHY. One GbE still caps each element at "
             "≈ 3.6 MS/s; a small ESP keeps USB and control."},
    {"key": "E", "name": "2 × S31 + GbE switch", "status": "I",
     "line": "Tile A's electronics twice behind a GbE switch: one cable, USB on the first S31, but the shared uplink "
             "caps each element below 4 MS/s."},
    {"key": "F", "name": "One S31, PARLIO + camera port", "status": "S",
     "line": "The bigger-ESP answer: 2-bit lanes from all sixteen, 16 into PARLIO and 16 into the S31's 16-bit camera "
             "input. No FPGA or switch, but all 60 pins are used and the camera clock limit is undocumented."},
]

# (criterion, [(text, grade) for A..E]); grade 2 good, 1 middle, 0 weak
ALT["matrix"] = [
    ("Receivers", [("16", 2), ("16", 2), ("8", 0), ("16", 2), ("16", 2), ("16", 2)]),
    ("Receivers while 8 transmit", [("8 on 2-bit", 2), ("8 on 1-bit", 1), ("8 on 2-bit", 2), ("8 on 2-bit", 2),
                                    ("8 on 2-bit", 2), ("8 on 2-bit", 2)]),
    ("IQ per element, streaming*", [("4 MS/s", 2), ("≈ 2 MS/s", 1), ("4 MS/s", 2), ("≈ 3.6 MS/s", 2), ("≈ 3.3 MS/s", 1),
                                    ("≈ 3.3 MS/s", 1)]),
    ("Snapshots per second", [("≤ 287", 2), ("≤ 148", 1), ("≤ 287", 2), ("≈ 210", 2), ("≈ 210", 2), ("≈ 210", 2)]),
    ("Links to the PC", [("2 GbE, 2 USB", 1), ("1 GbE, USB", 2), ("1 GbE, USB", 2), ("1 GbE, USB", 2), ("1 GbE, USB", 2),
                         ("1 GbE, USB", 2)]),
    ("Boards", [("2, with a seam", 1), ("1", 2), ("1", 2), ("1", 2), ("1", 2), ("1", 2)]),
    ("New work vs A", [("—", 2), ("1-bit lanes, C5 decimation", 1), ("one board, fixed TX/RX roles", 1), ("FPGA gateware", 0),
                       ("switch, C5 decimation", 1), ("camera-port capture, C5 decimation", 0)]),
    ("Parts vs A", [("—", 2), ("≈ −$10", 2), ("≈ −$10", 2), ("≈ −$3 to +$15", 1), ("≈ +$8", 1), ("≈ −$9", 2)]),
]
ALT["matrix_note"] = ("* Only if the C5 can stream at all, which is open for every option. D's FPGA resamples to the GbE "
                      "ceiling; in E and F the C5s decimate 10 MS/s by 3. A snapshot is 16,380 samples per element, all "
                      "elements at once.")

ALT["verdict"] = (
    "<b>Verdict.</b> One S31 can run all sixteen (B): the same 80 MS/s snapshots, drained half as fast "
    "(≤ 148 instead of ≤ 287 per second). Only the S31 has Gigabit Ethernet (the P4 is 10/100); D, E and F reach "
    "≈ 210 per second but need an FPGA, a switch or every S31 pin. Rev 1: the 2 × 8 tiles (one tile is bench step 4). "
    "Rev 2: B if 148 snapshots per second is enough; C only if transmit experiments need full-rate receivers on one "
    "board.")

ctl_rows = [
    ["Signal", "How", "S31 pins", "Part (price at 1 pc)"],
    ["IQ data", "PARLIO RX, 16 bit, 1 bit per C5, 40 MHz", "16", "—"],
    ["PCLK and GO", "PCLK from the master through a 1:2 buffer whose enable is GO, then two 1:10 buffers: one gate "
     "for all 17 loads", "2", "1:2 + 2 × 1:10 (CDCLVC1110-class, $6.41 each)"],
    ["48 MHz reference", "from the master, two 1:8 buffers for the 16 XTAL_P inputs", "—", "2 × LMK1C1108 ($5.19 each)"],
    ["Commands", "one UART TX to all 16 RXD pins, addressed frames", "1", "—"],
    ["Replies, logs, flashing", "the 16 TXD pins through one 16:1 mux back to UART RX", "1 + 4", "CD74HC4067 ($0.66)"],
    ["Reset (CHIP_PU)", "one line per C5 from a 16-bit I²C expander", "2", "NCA9555 ($0.80)"],
    ["Boot mode (GPIO28)", "one shared net, driven push-pull: only the C5 that is reset while it is low enters download",
     "1", "—"],
    ["READY", "open-drain, wired-AND: high only when all 16 are armed", "1", "pull-up"],
    ["Trigger", "from the master, for multi-board captures", "1", "—"],
    ["Gigabit Ethernet", "RGMII 12, MDIO 2, PHY reset 1", "15", "YT8531 / RTL8211F"],
    ["USB to the PC", "USB-Serial-JTAG (or the HS OTG port, on its own pins)", "2", "—"],
]

ALT["details"] = [
    "<h3>Controlling sixteen C5s from one S31</h3>",
    "<div class='tbl'><table><thead><tr>" + "".join(f"<th>{E(c)}</th>" for c in ctl_rows[0]) + "</tr></thead><tbody>"
    + "".join("<tr>" + "".join(f"<td>{E(c)}</td>" for c in r) + "</tr>" for r in ctl_rows[1:]) + "</tbody></table></div>",
    "<ul>"
    "<li>Total: ≈ 46 signal pins plus 7 for the external flash (GPIO26–32), 53 of the S31's 60 GPIOs. The S31 has four "
    "UARTs, so sixteen C5s need the shared bus. A 24-bit expander (TCA6424, $1.79) can take the mux select lines too.</li>"
    "<li>The mux and the expander are the only extra parts, about $2. Two tiles need the same kind of clock buffers "
    "(a 1:8 and a 1:10 each), so those cost about the same. Prices here are for 1 pc; at 100 pc a 1:8 + 1:10 "
    "pair is ≈ $7.45, the 7.5 in the tile cost.</li>"
    "<li>40 Mbit/s per 1-bit lane is 2.5 MS/s of IQ8 before framing. ESP-SDR's rates are 80/40/20/10/8/4 MS/s, so B "
    "streams ≈ 2 MS/s (8 MS/s decimated by 4 in the C5).</li>"
    "<li>Flashing: esp-serial-flasher runs on an ESP32 host, supports the C5 over UART, and lets the port code supply its own "
    "reset and boot callbacks, so they can drive the expander and the mux. It flashes one target at a time: sixteen in a row.</li>"
    "<li>The C5 latches GPIO26–28 when it leaves reset (GPIO28 low and GPIO27 high: download mode), so one shared BOOT net "
    "is enough. Drive it push-pull from the S31 (sixteen ≈ 45 kΩ internal pull-ups sink ≈ 1.2 mA) and fit no pull-down: "
    "a 10 kΩ pull-down, right for one chip, would only reach ≈ 2.6 V against sixteen pull-ups. Pull it low just before the "
    "target's EN rises, hold it at least 3 ms, then release, so a C5 that resets later boots normally. Keep GPIO27 high.</li>"
    "<li>No hub on the S31's own USB host: with no transaction translator, the C5's full-speed USB works behind a hub only "
    "if the host is forced to full speed, and 16 host channels are not enough for 16 C5s plus the hubs. A hub tree to the "
    "PC is possible: three 7-port FE2.1 hubs (≈ $2 each) give 19 ports, and esptool flashes all 17 chips in parallel, at "
    "the cost of 16 USB pairs to route.</li>"
    "<li>C's transmitters need control lines and the shared 48 MHz, no data lanes. Streaming waveforms down to them on the "
    "S31's PARLIO TX would need 16 more pins for 2 bits each: 69 of 60. It reaches 60 of 60, with nothing spare, only if "
    "the mux select, BOOT and PHY reset move to a 24-bit expander, USB moves to the OTG port and the trigger is dropped. "
    "Running PARLIO RX, TX and Ethernet at full rate together is untested. And no public firmware plays raw IQ on the C5: "
    "ESP-SDR is receive-only, the documented tone test lists 2.4 GHz channels only, and Wi-Fi frames are started by the "
    "MAC, so whether GO can align them is open.</li>"
    "<li>PHY: Espressif's S31 board uses a Motorcomm YT8531, and ESPHome supports it on the S31; the ESP-IDF Ethernet page "
    "still says RMII only. Prefer the YT8531 unless the RTL8211F driver is checked.</li>"
    "</ul>",
    "<h3>Why not a bigger ESP</h3>",
    "<ul><li>ESP32-P4: 16-bit PARLIO at 40 MHz like the S31, USB 2.0 HS, but Ethernet is 10/100 (MII/RMII).</li>"
    "<li>ESP32-S31: already the widest PARLIO RX (16 lines, 40 MHz) and the only Gigabit MAC in the family.</li>"
    "<li>Sixteen C5s at 2 bits is 1.28 Gbit/s: more than one S31's PARLIO and more than one GbE link.</li>"
    "<li>The S31's camera (DVP) input is a second 16-bit parallel port with an external pixel clock, so PARLIO plus camera "
    "could take 2-bit lanes from all sixteen (F). Pins: 32 data, 2 clocks, 15 Ethernet and 7 flash make 56 of 60, so the "
    "resets, BOOT, mux select, GO and PHY reset all move to a 24-bit I²C expander, READY is read through it, and USB goes "
    "to the HS OTG port on its own pins. The camera port's maximum clock is not in the datasheet, nobody has shown more "
    "than 640 Mbit/s into an S31, and snapshots must sit in its PSRAM while GbE drains them (inference).</li></ul>",
    "<h3>Cheap full-rate options</h3>",
    "<ul><li>One GbE carries ≈ 957 Mbit/s of UDP payload at a 1500-byte MTU (1472 of 1538 bytes of line time), ≈ 932 "
    "Mbit/s of IQ after ESP-SDR's packet headers: 58 Mbit/s, a 3.6 MS/s ceiling of IQ8, per element for sixteen. 4 MS/s "
    "(1.02 Gbit/s) does not fit, so the rate is cut before the link: resampled in D's FPGA (or cut to 7-bit IQ at 4 MS/s), "
    "or decimated in E's C5s to ≈ 3.3 MS/s (10 MS/s ÷ 3).</li>"
    "<li>Snapshots in D and E: one 16-element snapshot is 4.2 Mbit and drains over GbE in ≈ 4.5 ms, so ≈ 210 per "
    "second. At full lane speed the input runs ≈ 1.1 Mbit ahead of the link per snapshot, about all of the ≈ 1 Mbit of "
    "block RAM in a T20 or an ECP5-25, so either clock the lanes at ≈ 29 MHz or add an external RAM (≈ +$2–4).</li>"
    "<li>FPGA: Efinix T20 ≈ $12.75, Lattice ECP5-25 ≈ $21.78 (DigiKey, 1 pc); the open LiteEth core has RGMII PHYs for "
    "both. It needs a config flash and its own rails, and a small ESP (C3-class) still handles USB and control. D's "
    "parts against A: −$19 (two S31s, a PHY, a MagJack), then +$13–22 for the FPGA, ≈ $1–3 for its flash and rails, "
    "$0–4 for RAM, ≈ $2 for the small ESP and ≈ $1.5 for the control fan-out: ≈ −$3 to +$15.</li>"
    "<li>Switch: the Microchip KSZ9897R (≈ $12.83) has two RGMII MAC ports for the two S31s and integrated PHYs for the "
    "uplink. The KSZ9893, RTL8363NB and RTL8367S have one RGMII port each. A MAC-to-MAC link needs a fixed-link PHY "
    "driver, as Espressif's KSZ8863 driver does.</li></ul>",
    "<p class='note'>Sources: ESP32-S31 datasheet v0.5 and ESP-IDF docs (PARLIO RX/TX, USB host, Ethernet, soc_caps); ESP32-P4 "
    "and ESP32-C5 datasheets; esp-serial-flasher README; esptool boot-mode guide for the C5; LCSC and DigiKey part pages, "
    "16 October 2026, all in the <a href='evidence.html'>evidence register</a>. Rates and costs are the team's "
    "estimates.</p>",
]
