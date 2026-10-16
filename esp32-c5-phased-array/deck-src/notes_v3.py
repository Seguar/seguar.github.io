"""Speaker notes for the v3 deck (2 x 8 tiles, PARLIO -> S31 -> GbE), one per slide in order."""

NOTES = [
    # 1 title
    "A staged student project: a 16-element 5.2 GHz digital array from ESP32-C5 radios, built as two 8-element tiles. Each tile funnels eight 2-bit PARLIO lanes into one ESP32-S31 and one Gigabit port. The hard parts are synchronization, calibration and getting IQ out of the C5.",
    # 2 what
    "Every element is a complete C5 transceiver with a calibration switch in front. The status markers are strict: 'confirmed' means shown on ESP32 hardware (ESPARGOS, 2.4 GHz), not on the C5 at 5 GHz.",
    # 3 existing
    "ESPARGOS proves the synchronization recipe; ESP-SDR proves raw IQ from the C5 at 5 GHz. Neither gives a synchronized, triggered, fast multi-C5 capture — that is our new work.",
    # 4 chips
    "Only the C5 reaches 5.2 GHz. The S31 is 2.4 GHz only, which is why it serves as the tile's digital and network aggregator rather than as an RF element.",
    # 5 antenna
    "Our existing 4×4 board is a ready-made aperture. Rev 1 can cable it to the tiles, or the tiles can carry their own patches — the tile PCB slide explains the trade-off.",
    # 6 sync table
    "The shared clock fixes frequency only. LO phase, timing and fixed path errors need the in-band reference; ESPARGOS measured that the PLL phase re-rolls after each reset or channel change.",
    # 7 domains
    "Four separate domains: 48 MHz RF reference, 40 MHz data clock, capture trigger, 5.2 GHz calibration. Ethernet and PTP are for logs and coordination, never for sample alignment. Wideband correction is a phase plus a delay per element, applied per FFT bin.",
    # 8 clock
    "Espressif documents only a 48 MHz ±10 ppm crystal for the C5; driving XTAL_P from a buffer is our first clock bench test. Static skew becomes static phase and is calibrated out; the 108th harmonic of 48 MHz falls at 5184 MHz.",
    # 9 cal network
    "One MAX2871-class source, split 1:2 to the tiles and 1:8 on each tile, into an SPDT in front of every C5. Fixed attenuation and a fixed low gain index keep the 10-bit samples from clipping.",
    # 10 cal loop
    "Lock, fix gain, measure the reference, estimate gain, phase and delay per element, then measure the scene and correct. ESPARGOS treats a calibration as valid for one capture epoch.",
    # 11 data problem
    "The internal rate (80 MS/s) is not the export rate. ESP-SDR exports over USB or UART today. A 2-bit PARLIO lane gives 80 Mbit/s per C5, eight lanes 640 Mbit/s per tile — the same rate ESP-SDR already pushes through an S31 to Gigabit Ethernet.",
    # 12 snapshots
    "What ESP-SDR offers on the C5 today: snapshots of at most 16,380 samples, sent slowly over USB. This is the starting point of step 1.",
    # 13 options
    "Five ways to collect the data. E is the team proposal: no Ethernet per element, one S31 and one PHY per tile. C and D are the FPGA variants we keep as Plan B.",
    # 14 system
    "A master timing / RF board provides the 48 MHz reference, the 40 MHz PARLIO clock, the trigger and the 5.2 GHz calibration tone. Two identical tiles each send one Gigabit stream to the host.",
    # 15 tile
    "One lane drawn, eight per tile. C5s are chip-down so XTAL_P can take the shared reference. The S31 receives 16 bits at 40 MHz and forwards them over RGMII to a Gigabit PHY.",
    # 16 bus mapping
    "Each C5 owns two bits of the S31's 16-bit bus. All lanes must stay cycle-aligned, so they share one PCLK and start together after a READY / GO handshake. A common sync word at the start of each frame makes misalignment visible immediately. Bit de-interleaving is left to the PC.",
    # 17 modes
    "Mode 1 needs continuous capture on the C5, which does not exist today — back-to-back snapshots at 4 MS/s may approximate it. Mode 2 uses the full 80 MS/s for 205 µs and drains in about 3.3 ms; it is the realistic first target.",
    # 18 budget
    "Per tile the lanes add up to 640 Mbit/s, one Gigabit port; two ports at the host. Reduction products are orders of magnitude smaller and can move to the S31 or an FPGA later.",
    # 19 data flow
    "Everything after the S31 is ordinary networking. Early on, the PC does all DSP: unpacking, calibration, FFT, beamforming, AoA, radar.",
    # 20 plan B
    "If eight C5 lanes cannot be kept in lockstep, or the S31 cannot sustain 640 Mbit/s in and out, a small FPGA takes over the per-lane capture and alignment.",
    # 21 PCB
    "Two constraints drive the tile layout. First, the antenna block must sit against the seam so rows stay 28.8 mm apart across boards. Second, a patch on the thin 0.21 mm L1–L2 dielectric of a standard 4-layer board radiates poorly, so Rev 1 uses a custom stack with a 1.065 mm core under the patches. The front carries only the patches; each C5 sits behind its own patch, and all digital lines are behind the L2 ground.",
    # 22 beamforming
    "Receive steering is purely digital: rotate each element's IQ and sum. The real success test is repeatability after a power cycle — that proves the calibration works.",
    # 23 radar
    "Realistic radar modes respect that the C5 is half-duplex: passive radar, separate TX and RX elements, and pulsed / switched operation. Continuous FMCW on one radio is not the starting point.",
    # 24 comms
    "Communications experiments reuse the receive chain; coherent TX depends on the open TX questions.",
    # 25 TX status
    "Packet TX is standard; phase-controlled TX is not public. ESPARGOS says it achieved coherent TX on ESPARGOS One but has not released it. Regulation (200 mW EIRP indoors) and 24 dB of array gain argue for cabled or shielded TX tests.",
    # 26 TX steering
    "The steering maths is trivial; the hardware is not. Until raw coherent TX exists, use separate TX/RX roles or TDM-MIMO; external phase shifters are possible but not for Rev 1.",
    # 27 power
    "Receive-only operation is about 10 W for the whole system. All-TX bursts need roughly 8 A at 3.3 V; Espressif asks for 0.6 A of supply capability per C5.",
    # 28 cost
    "Team estimates, not quotes: about $70–80 of electronics per tile and $220–300 for a complete prototype. Chip-down C5s replace modules because modules carry their own crystal.",
    # 29 software
    "C5 firmware builds on ESP-SDR (pinned toolchain) plus a PARLIO exporter. The S31 firmware is a DMA-to-UDP pipe with alignment checks; the host does the science.",
    # 30 bench tests
    "Eight bench experiments decide the PCB. Two are partly de-risked already: ESP-SDR shows 16-lane PARLIO capture and ≈ 687 Mbit/s Gigabit streaming on one S31. The C5-side tests are all open.",
    # 31 dev sequence
    "Six steps, each ending with a measurable result. Nothing larger is built until the previous step passes; step 3 (two C5s on one reference) is the key go / no-go point.",
    # 32 risks
    "The team's eight risks plus two from the research: no continuous capture on the C5, and patches that stay narrowband and lossy on FR-4.",
    # 33 claims
    "The evidence summary. Notice how much of the C5 side is still open — that is the research content of the project.",
    # 34 alternatives
    "Design-decision record: why not Ethernet per element, why not a switch, why not 2.4 GHz S31 elements, and when we would revisit each.",
    # 35 success
    "Three tiers, each a complete outcome. The minimum tier — C5 IQ over PARLIO, C5 + S31 streaming and two coherent C5s — is already publishable.",
    # 36, 37 refs
    "Primary sources: ESPARGOS papers and docs, ESP-SDR source, Espressif datasheets and guidelines.",
    "Further sources: clocking, radar literature and regulation.",
]
