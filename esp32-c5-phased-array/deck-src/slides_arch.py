"""Architecture / diagram slides."""
from deckkit import *
import budget as B


def legend_lines(s, x, y, items, size=10):
    """items: list of (label, color, dash)."""
    cx = x
    for label, col, dash in items:
        line(s, cx, y + 0.11, cx + 0.4, y + 0.11, col, 1.5, dash)
        w = 0.068 * len(label) + 0.15
        text(s, cx + 0.48, y, w, 0.22, label, size=size, color=MUTED, anchor="m")
        cx += 0.48 + w + 0.3


SIG = {
    "rf": TEAL,
    "clk": BLUE,
    "data": INK,
    "ctl": AMBER,
}


def box2(s, x, y, w, h, title, sub=None, fill=WHITE, line_c=LINE, size=12, sub_size=10, lw=0.75,
         dash=None, align="c", anchor="m", title_color=INK):
    content = [[(title, {"color": title_color})]]
    if sub:
        for ln in (sub if isinstance(sub, list) else [sub]):
            content.append([(ln, {"size": sub_size, "color": MUTED})])
    return rect(s, x, y, w, h, fill=fill, line=line_c, lw=lw, dash=dash, content=content, size=size,
                align=align, anchor=anchor)


def antenna(s, x, y, size=0.16, color=TEAL):
    """Small patch symbol (square) centred at x,y."""
    return rect(s, x - size / 2, y - size / 2, size, size, fill=TEAL_L, line=color, lw=0.75)


def stack_shadow(s, x, y, w, h, n=3, dx=0.06, dy=-0.06):
    for i in range(n, 0, -1):
        rect(s, x + dx * i, y + dy * i, w, h, fill=WHITE, line=RULE, lw=0.75)


# ------------------------------------------------------------------ slide: what we build
def slide_what(d, F=None):
    s = d.slide("What are we trying to build?",
                source="λ = c / 5.2 GHz = 57.7 mm; d = λ/2 = 28.8 mm. Status = shown on ESP32-class hardware (ESPARGOS, 2.4 GHz) — none of it is shown on the C5 at 5 GHz yet.")
    text(s, 0.6, 1.3, 7.2, 0.95,
         "A 16-element digital array at 5.2 GHz in which every element is a complete ESP32-C5 "
         "transceiver. The aim is a research platform for receiving, sensing and communication, "
         "with coherent transmission as a later research question.",
         size=16, color=INK, line_spacing=1.05)

    # element chain
    y0 = 2.75
    text(s, 0.6, y0 - 0.38, 5, 0.3, "One element (×16)", size=12, color=MUTED)
    xs = [0.6, 2.35, 4.25, 6.15]
    labels = (F or {}).get("what_chain", [("Patch antenna", "5.2 GHz, linear pol."),
              ("ESP32-C5", "RF transceiver + baseband"),
              ("IQ snapshot", "on-chip buffer"),
              ("Tile aggregator", "4 elements per tile")])
    ws = [1.45, 1.6, 1.6, 1.6]
    for (t, sub), x, w in zip(labels, xs, ws):
        box2(s, x, y0, w, 0.75, t, sub, fill=TEAL_L if t == "ESP32-C5" else WHITE,
             line_c=TEAL if t == "ESP32-C5" else LINE)
    for i in range(3):
        line(s, xs[i] + ws[i], y0 + 0.375, xs[i + 1], y0 + 0.375, TEAL if i == 0 else INK, 1.25, tail=True)
    # shared refs into the C5
    refs = [("48 MHz reference", BLUE, None), ("5.2 GHz calibration tone", TEAL, None),
            ("trigger / timestamp", AMBER, "dash")]
    ry = y0 + 1.15
    for i, (lab, col, dash) in enumerate(refs):
        yy = ry + i * 0.3
        line(s, 0.6, yy, 2.85 + i * 0.25, yy, col, 1.25, dash)
        line(s, 2.85 + i * 0.25, yy, 2.85 + i * 0.25, y0 + 0.75, col, 1.25, dash, tail=True)
        text(s, 3.05 + 0.5, yy - 0.12, 3.5, 0.24, lab, size=11, color=col)
    text(s, 0.6, ry + 0.95, 7.2, 0.3, "Shared by all 16 elements — this is what turns 16 radios into one array.",
         size=12, color=MUTED)

    # array geometry (right)
    gx, gy, p = 8.85, 1.55, 0.62
    sq = 0.3
    for r in range(4):
        for c in range(4):
            cx, cy = gx + c * p, gy + r * p
            rect(s, cx - sq / 2, cy - sq / 2, sq, sq, fill=TEAL_L, line=TEAL, lw=0.75)
    # dimension line for pitch
    yd = gy + 3 * p + 0.45
    line(s, gx, yd, gx + p, yd, INK, 0.75, head=True, tail=True)
    text(s, gx - 0.2, yd + 0.05, p + 0.4, 0.25, "28.8 mm", size=11, align="c", color=INK)
    yd2 = yd + 0.5
    line(s, gx, yd2, gx + 3 * p, yd2, INK, 0.75, head=True, tail=True)
    text(s, gx, yd2 + 0.05, 3 * p, 0.25, "86.5 mm between outer element centres", size=11, align="c", color=INK)
    for xx in (gx, gx + p, gx + 3 * p):
        line(s, xx, gy + 3 * p + sq / 2 + 0.05, xx, yd2 if xx != gx + p else yd, RULE, 0.5)
    text(s, gx + 4 * p - 0.05, gy - 0.1, 2.0, 1.2,
         ["4 × 4 elements", "λ/2 pitch at 5.2 GHz", "no grating lobes for", "±90° scan"],
         size=11, color=MUTED)

    # uses
    uy = 5.45
    line(s, 0.6, uy - 0.15, 12.73, uy - 0.15, RULE, 0.75)
    uses = (F or {}).get("what_uses", [("Receive", "direction finding, digital beamforming, interference nulling", "C"),
            ("Sense", "passive / bistatic radar, Wi-Fi sensing, Doppler", "I"),
            ("Communicate", "CSI, MIMO channel sounding, beam tracking", "I"),
            ("Transmit coherently", "phase-controlled multi-element TX", "S")])
    w = 3.0
    for i, (t, sub, st) in enumerate(uses):
        x = 0.6 + i * 3.06
        status_mark(s, x + 0.08, uy + 0.17, st)
        text(s, x + 0.25, uy + 0.03, w - 0.3, 0.3, t, size=14, color=INK)
        text(s, x + 0.25, uy + 0.36, w - 0.35, 0.6, sub, size=11, color=MUTED)
    status_legend(s, 0.6, 6.55, ("C", "I", "S"))
    notes(s, "The project is framed as a platform, not a single demo. The status markers say how much of each use "
             "case is already demonstrated on ESP32 hardware by others (receive-side coherence: yes, via ESPARGOS at "
             "2.4 GHz), what is a reasonable inference, and what is speculative (coherent multi-element TX).")
    return s


# ------------------------------------------------------------------ slide: synchronization error terms
def slide_sync(d):
    s = d.slide("The hard part is synchronization",
                source="Error model follows the ESPARGOS approach (shared clock + in-band phase reference + digital correction); C5-specific behaviour must be measured.")
    text(s, 0.6, 1.3, 12, 0.6,
         "Sixteen independent radios disagree in frequency, phase, timing and gain. A shared clock fixes only "
         "the first of these; the rest have to be measured and removed.",
         size=16, color=INK)
    Y, P, N = ({"c": "removes", "color": TEAL}, {"c": "partly", "color": BLUE}, {"c": "—", "color": FAINT})
    rows = [
        ["Error term", "Where it comes from", "Shared 48 MHz clock", "5.2 GHz cal. tone", "Common trigger"],
        ["Carrier frequency offset, drift", "independent crystals (tens of ppm)", Y, N, N],
        ["LO phase offset", "each PLL locks with an arbitrary phase", N, Y, N],
        ["Sampling-time offset", "independent sample clocks and start times", P, {"c": "removes (swept tone)", "color": TEAL}, P],
        ["Capture start misalignment", "firmware / interrupt latency", N, P, Y],
        ["Fixed path mismatch", "cables, PCB traces, switches, filters", N, {"c": "after the switch", "color": BLUE}, N],
        ["Gain mismatch", "AGC state, LNA spread", N, {"c": "if gain is fixed", "color": BLUE}, N],
        ["Uncorrelated phase noise", "additive jitter of buffers, PLL noise", P, N, N],
    ]
    table(s, 0.6, 2.15, [3.0, 3.75, 1.85, 1.85, 1.65], rows, row_h=0.42, size=13,
          col_align=["l", "l", "c", "c", "c"])
    text(s, 0.6, 5.75, 12.1, 0.9,
         [[("Consequence: ", {"color": INK}),
           ("calibration is not a one-off factory step. The LO phase changes every time a PLL relocks, so the array "
            "must be able to re-measure itself on demand — that is why the calibration network is part of the hardware.",
            {"color": MUTED})]],
         size=14)
    notes(s, "This table is the core argument of the proposal. ESPARGOS documents the same three ingredients at 2.4 GHz. "
             "What changes for C5: 48 MHz reference instead of 40 MHz, 5 GHz LO multiplication factor, and an unknown "
             "behaviour of the C5 PLL after retune — to be measured in phase 2.")
    return s


# ------------------------------------------------------------------ slide: clock tree
def slide_clock(d, F):
    s = d.slide("Sharing one 48 MHz reference",
                source=F["clock_source_line"])
    # diagram
    y = 1.55
    box2(s, 0.6, y + 1.0, 1.55, 0.85, "48 MHz TCXO", ["±0.5 ppm, clipped sine", "e.g. TG2016SMN"], fill=BLUE_L, line_c=BLUE, sub_size=9)
    box2(s, 2.55, y + 1.0, 1.45, 0.85, F.get("clock_fanout", "1:4 fan-out"), [F.get("clock_fanout_sub", "hub board"), "e.g. LMK1C1104"], line_c=BLUE, sub_size=9)
    line(s, 2.15, y + 1.425, 2.55, y + 1.425, BLUE, 1.5, tail=True)
    # four outputs: three stubs + one expanded
    outs_y = [y + 0.2, y + 0.75, y + 1.3, y + 1.85]
    for i, oy in enumerate(outs_y):
        line(s, 4.0, y + 1.425, 4.3, y + 1.425, BLUE, 1.5)
    line(s, 4.3, outs_y[0], 4.3, outs_y[-1] + 0.85, BLUE, 1.5)
    for i, lab in enumerate(F.get("clock_stubs", ["tile 2", "tile 3", "tile 4"])):
        oy = outs_y[i]
        line(s, 4.3, oy, 5.0, oy, BLUE, 1.5, tail=True)
        text(s, 5.05, oy - 0.13, 2.0, 0.26, lab, size=11, color=MUTED)
    # expanded tile
    ty = outs_y[-1] + 0.85
    line(s, 4.3, ty, 5.0, ty, BLUE, 1.5, tail=True)
    text(s, 4.4, outs_y[0] - 0.45, 2.6, 0.26, "one cable per tile", size=10, color=MUTED)
    rect(s, 4.95, ty - 0.55, 3.75, 2.55, fill=None, line=RULE, lw=0.75, dash="dash")
    text(s, 5.05, ty + 1.68, 3.0, 0.26, F.get("clock_tile_label", "tile 1"), size=11, color=MUTED)
    box2(s, 5.15, ty - 0.35, 1.2, 0.7, F.get("clock_tilebuf", "1:4 buffer"), "LVCMOS", line_c=BLUE)
    line(s, 5.0, ty, 5.15, ty, BLUE, 1.5)
    for k in range(4):
        cy = ty - 0.4 + k * 0.5
        line(s, 6.35, ty, 6.6, ty, BLUE, 1.25)
    line(s, 6.6, ty - 0.4, 6.6, ty + 1.1, BLUE, 1.25)
    for k in range(4):
        cy = ty - 0.4 + k * 0.5
        line(s, 6.6, cy, 6.85, cy, BLUE, 1.25)
        rect(s, 6.85, cy - 0.06, 0.12, 0.12, fill=WHITE, line=BLUE, lw=0.75)  # coupling / attenuator
        line(s, 6.97, cy, 7.2, cy, BLUE, 1.25, tail=True)
        rect(s, 7.2, cy - 0.17, 1.35, 0.34, fill=TEAL_L, line=TEAL, lw=0.75,
             content=[[("ESP32-C5 ", {}), ("XTAL_P", {"size": 9, "color": MUTED})]], size=11)
    text(s, 5.15, ty + 1.2, 1.7, 0.4, "coupling network\n(level per HW guide)", size=9, color=MUTED)
    line(s, 6.4, ty + 1.2, 6.85, ty + 1.07, RULE, 0.5)

    # notes column
    x0 = 9.1
    items = F["clock_items"]
    yy = 1.4
    for (t, body, h) in items:
        text(s, x0, yy, 3.65, 0.28, t, size=13, color=INK)
        tb = text(s, x0, yy + 0.3, 3.65, h - 0.3, body, size=11, color=MUTED, line_spacing=1.0)
        if t == "Injection":
            status_mark(s, x0 + 0.95, yy + 0.14, F["clock_injection_status"])
        yy += h
    # numbers at 5.2 GHz
    text(s, 0.6, 4.75, 3.6, 0.3, "Numbers at 5.2 GHz", size=12, color=INK)
    table(s, 0.6, 5.08, [1.75, 1.95], F["clock_numbers"], row_h=0.3, size=10, header=False,
          col_align=["l", "r"])
    return s


# ------------------------------------------------------------------ slide: calibration network
def slide_calnet(d, F):
    s = d.slide("A 5.2 GHz calibration network",
                source=F["cal_source_line"])
    y = 1.5
    box2(s, 0.6, y + 0.9, 1.6, 0.95, "5.2 GHz source", ["PLL synthesizer, or a", "17th C5 (cf. ESPARGOS)"],
         fill=TEAL_L, line_c=TEAL)
    box2(s, 2.6, y + 0.95, 1.2, 0.85, F.get("calnet_hub_split", "1:4 splitter"), F.get("calnet_hub_sub", "hub"), line_c=TEAL)
    line(s, 2.2, y + 1.375, 2.6, y + 1.375, TEAL, 1.5, tail=True)
    line(s, 3.8, y + 1.375, 4.05, y + 1.375, TEAL, 1.5)
    line(s, 4.05, y + 0.35, 4.05, y + 2.9, TEAL, 1.5)
    stub_labels = F.get("calnet_stubs", ["tile 2", "tile 3", "tile 4"])
    for i, oy in enumerate([y + 0.35, y + 0.9, y + 1.45][:len(stub_labels)]):
        line(s, 4.05, oy, 4.6, oy, TEAL, 1.5, tail=True)
        text(s, 4.65, oy - 0.13, 1.0, 0.26, stub_labels[i], size=11, color=MUTED)
    ty = y + 2.9
    line(s, 4.05, ty, 4.6, ty, TEAL, 1.5, tail=True)
    rect(s, 4.55, ty - 1.25, 4.1, 2.35, line=RULE, dash="dash")
    text(s, 4.65, ty - 1.2, 2.5, 0.26, F.get("calnet_tile_label", "tile 1"), size=11, color=MUTED)
    box2(s, 4.7, ty - 0.35, 0.95, 0.7, F.get("calnet_tile_split", "1:4"), "Wilkinson", line_c=TEAL)
    line(s, 4.6, ty, 4.7, ty, TEAL, 1.5)
    line(s, 5.65, ty, 5.85, ty, TEAL, 1.25)
    rows_y = [ty - 0.85 + k * 0.6 for k in range(4)]
    line(s, 5.85, rows_y[0] + 0.08, 5.85, rows_y[-1] + 0.08, TEAL, 1.25)
    for cy in rows_y:
        line(s, 5.85, cy + 0.08, 6.6, cy + 0.08, TEAL, 1.25, tail=True)       # CAL port
        antenna(s, 6.2, cy - 0.12, 0.13)
        line(s, 6.27, cy - 0.08, 6.6, cy - 0.08, TEAL, 0.75, tail=True)      # ANT port
        rect(s, 6.6, cy - 0.19, 0.75, 0.38, line=INK, lw=0.75, content="SPDT", size=10)
        line(s, 7.35, cy, 7.6, cy, TEAL, 1.25, tail=True)
        rect(s, 7.6, cy - 0.17, 0.9, 0.34, fill=TEAL_L, line=TEAL, lw=0.75, content="C5", size=10)
    text(s, 0.6, 4.25, 3.3, 0.6, "Each SPDT: upper input from the antenna, lower input from the calibration splitter.",
         size=10, color=MUTED)

    # loss budget below diagram
    text(s, 0.6, 5.3, 3.6, 0.3, "Indicative level budget", size=13, color=INK)
    rows = F.get("calnet_budget", [["Stage", "Loss"],
            ["1:4 split ×2 (ideal 6 dB each)", "≈ 13–14 dB"],
            ["inter-tile cable + connectors", "≈ 1–2 dB"],
            ["SPDT insertion loss", "≈ 1 dB"],
            ["source 0 dBm → at each C5", "≈ −15 to −17 dBm"]])
    table(s, 0.6, 5.65, [2.6, 1.35], rows, row_h=0.25, size=10, col_align=["l", "r"])
    text(s, 4.65, 5.65, 4.0, 1.2,
         F.get("calnet_note", "Well below the C5’s +5 dBm maximum input, but enough to clip the 10-bit samples at high manual gain: "
         "add a fixed attenuator and use one low, fixed gain index for calibration. Switch isolation (ANT ↔ CAL) "
         "sets how much of the tone leaks into normal measurements."), size=11, color=MUTED)

    # comparison right
    x0 = 8.95
    text(s, x0, 1.4, 3.8, 0.3, "Global source or one per tile?", size=14, color=INK)
    rows = [
        ["", "Global", "Per tile"],
        ["Inter-tile phase reference", "yes, common", "none — needs OTA step"],
        ["RF routing", F.get("calnet_routing", "4 long cables"), "local only"],
        ["Cost / parts", "1 source", F.get("calnet_sources", "4 sources")],
        ["Tiles testable alone", "with a jumper", "yes"],
    ]
    table(s, x0, 1.8, [1.5, 1.05, 1.25], rows, row_h=0.5, size=10, header_color=MUTED)
    text(s, x0, 4.45, 3.8, 1.9,
         [[("Proposal: ", {"color": INK}),
           (F.get("calnet_proposal", "one global source and splitter on the hub, a 1:4 splitter and four SPDTs on every tile. ") +
            "Each tile also gets a local test input so it can be calibrated alone during bring-up.",
            {"color": MUTED})]], size=11)
    status_mark(s, x0 + 0.08, 6.15, "I")
    text(s, x0 + 0.25, 6.03, 3.5, 0.26, "architecture choice, adapted from ESPARGOS", size=10, color=MUTED)
    return s


# ------------------------------------------------------------------ slide: calibration loop
def slide_calloop(d):
    s = d.slide("Calibration is a measurement loop",
                source="Procedure follows ESPARGOS One IQ mode (pyespargos iq_sync / iq_pool): packet-timestamp coarse sync, swept CW tone for (τ, φ), valid for one capture epoch.")
    steps = [("1", "Lock and fix gain", "tune all C5s, disable AGC, set the same manual gain"),
             ("2", "Measure the reference", "all SPDTs to CAL; step the tone across the band, one snapshot per step"),
             ("3", "Estimate offsets", "per element: gain gₖ, phase φₖ; delay τₖ from the phase slope across steps"),
             ("4", "Measure the scene", "all SPDTs to ANT; synchronized snapshot(s)"),
             ("5", "Correct", "multiply by (gₖ·e^(jφₖ))⁻¹ and remove τₖ before any array processing")]
    x, y, w = 0.6, 1.55, 2.25
    for i, (n, t, sub) in enumerate(steps):
        xx = x + i * 2.45
        rect(s, xx, y, w, 1.35, line=LINE, lw=0.75, fill=WHITE)
        text(s, xx + 0.12, y + 0.1, 0.4, 0.4, n, size=20, color=BLUE, font=FONT_LIGHT)
        text(s, xx + 0.12, y + 0.5, w - 0.24, 0.3, t, size=13, color=INK)
        text(s, xx + 0.12, y + 0.82, w - 0.24, 0.5, sub, size=10, color=MUTED)
        if i < 4:
            line(s, xx + w, y + 0.675, xx + 2.45, y + 0.675, LINE, 1.0, tail=True)
    # loop back arrow
    path(s, [(x + 4 * 2.45 + w / 2, y + 1.35), (x + 4 * 2.45 + w / 2, y + 1.7), (x + w / 2, y + 1.7),
             (x + w / 2, y + 1.35)], BLUE, 1.0, dash="dash", end_arrow=True)
    text(s, 2.5, y + 1.75, 8.5, 0.3, "repeat after every reset, retune or sample-rate change — ESPARGOS treats a calibration as valid for one capture epoch",
         size=11, color=BLUE, align="c")

    # model
    text(s, 0.6, 4.1, 5.8, 0.3, "Per-element model during a snapshot", size=14, color=INK)
    text(s, 0.6, 4.55, 5.8, 0.45,
         [[("yₖ[n] = gₖ · e", {}), ("jφₖ", {"sup": True}), (" · x(nTₛ − τₖ) + wₖ[n]", {})]],
         size=18, font="Cambria Math")
    text(s, 0.6, 5.2, 5.8, 1.5,
         ["In CAL mode x is the common reference, so gₖ, φₖ, τₖ follow from comparing each yₖ with element 1. "
          "A single CW tone cannot separate φₖ from τₖ; ESPARGOS sweeps the tone across the band and fits both, "
          "after coarse alignment on a shared reference packet."],
         size=12, color=MUTED)

    # what calibration cannot see
    x0 = 7.0
    text(s, x0, 4.1, 5.7, 0.3, "What the tone cannot see", size=14, color=INK)
    items = [
        "Everything before the switch: patch, feed, cable from the antenna board. Measure once with a VNA, "
        "or calibrate over the air with a far-field source.",
        "Mutual coupling between elements: measure embedded element patterns once the 2×2 tile works.",
        "Errors that change faster than the calibration interval.",
    ]
    text(s, x0, 4.55, 5.7, 2.3, items, size=12, color=MUTED, bullets=True, para_space=6)
    return s


# ------------------------------------------------------------------ slide: four tiles
def slide_tiles(d):
    s = d.slide("A tiled architecture makes more sense",
                source="Four identical 2×2 tiles; the hub sees four links instead of sixteen. Link types are chosen after the C5 output rate is measured.")
    # sources on the left
    box2(s, 0.6, 1.55, 1.75, 0.8, "48 MHz TCXO", "+ 1:4 fan-out", fill=BLUE_L, line_c=BLUE)
    box2(s, 0.6, 2.95, 1.75, 0.8, "5.2 GHz source", "+ 1:4 splitter", fill=TEAL_L, line_c=TEAL)
    text(s, 0.6, 4.0, 1.8, 1.4, "Both references are generated once and distributed to every tile.",
         size=10, color=MUTED)
    # trunks
    xc, xr = 2.65, 2.85
    line(s, 2.35, 1.95, xc, 1.95, BLUE, 1.5)
    line(s, 2.35, 3.35, xr, 3.35, TEAL, 1.5)
    tiles_y = [1.5, 2.83, 4.16, 5.49]
    th = 1.1
    line(s, xc, tiles_y[0] + 0.35, xc, tiles_y[-1] + 0.35, BLUE, 1.5)
    line(s, xr, tiles_y[0] + 0.75, xr, tiles_y[-1] + 0.75, TEAL, 1.5)
    tx, tw = 3.2, 5.0
    for i, ty in enumerate(tiles_y):
        rect(s, tx, ty, tw, th, line=LINE, lw=0.75)
        text(s, tx + 0.1, ty + 0.05, 1.5, 0.25, f"Tile {i + 1}", size=11, color=MUTED)
        line(s, xc, ty + 0.35, tx, ty + 0.35, BLUE, 1.25, tail=True)
        line(s, xr, ty + 0.75, tx, ty + 0.75, TEAL, 1.25, tail=True)
        # four C5 with antennas
        for k in range(4):
            cx = tx + 0.35 + k * 0.82
            antenna(s, cx + 0.32, ty + 0.2, 0.13)
            line(s, cx + 0.32, ty + 0.265, cx + 0.32, ty + 0.42, TEAL, 0.75)
            rect(s, cx, ty + 0.42, 0.64, 0.38, fill=TEAL_L, line=TEAL, lw=0.75, content="C5", size=10)
            line(s, cx + 0.32, ty + 0.8, cx + 0.32, ty + 0.95, INK, 0.75)
        # tile controller
        rect(s, tx + 3.75, ty + 0.18, 1.1, 0.84, line=INK, lw=1.0,
             content=[["tile"], ["FPGA / MCU"]], size=10)
        line(s, tx + 0.67, ty + 0.95, tx + 3.75, ty + 0.95, INK, 0.75, tail=True)
        # data up, trigger/config down
        line(s, tx + 4.85, ty + 0.42, 8.75, ty + 0.42, INK, 1.25, tail=True)
        line(s, 8.75, ty + 0.72, tx + 4.85, ty + 0.72, AMBER, 1.0, dash="dash", tail=True)
    # hub
    hx, hy, hw, hh = 8.75, 1.5, 2.0, 5.09
    rect(s, hx, hy, hw, hh, fill=BG2, line=INK, lw=1.0)
    text(s, hx + 0.15, hy + 1.2, hw - 0.3, 0.3, "Hub FPGA / SoC", size=13, color=INK)
    text(s, hx + 0.15, hy + 1.6, hw - 0.3, 2.6,
         ["trigger + timestamps", "4 tile-link receivers", "DDR snapshot buffer", "array calibration",
          "beamforming / DSP", "Ethernet to host"], size=11, color=MUTED, bullets=True, para_space=4)
    # host
    box2(s, 11.25, 3.45, 1.48, 1.2, "Host PC", ["Python / MATLAB"], line_c=LINE)
    line(s, 10.75, 4.05, 11.25, 4.05, INK, 1.25, tail=True)
    text(s, 10.75, 4.1, 0.5, 0.3, "GbE", size=9, color=MUTED, align="c")

    legend_lines(s, 3.2, 6.72, [("48 MHz reference", BLUE, None), ("5.2 GHz calibration", TEAL, None),
                                ("data to hub", INK, None), ("trigger / config from hub", AMBER, "dash")])
    return s


# ------------------------------------------------------------------ slide: one tile
def slide_onetile(d, F):
    s = d.slide("One 2×2 tile",
                source=F["tile_source_line"])
    # stacked lanes
    yc = 2.875
    stack_shadow(s, 0.6, 2.5, 1.3, 0.75)
    box2(s, 0.6, 2.5, 1.3, 0.75, "SMA in", "from patch board", line_c=TEAL)
    stack_shadow(s, 2.35, 2.5, 0.95, 0.75)
    box2(s, 2.35, 2.5, 0.95, 0.75, "SPDT", "ANT / CAL", line_c=INK)
    stack_shadow(s, 4.0, 2.3, 2.0, 1.25)
    rect(s, 4.0, 2.3, 2.0, 1.25, fill=TEAL_L, line=TEAL, lw=1.0,
         content=[["ESP32-C5"], [("RF · XTAL_P · GPIO · data port", {"size": 9, "color": MUTED})]], size=13)
    text(s, 6.25, 1.85, 0.6, 0.3, "×4", size=16, color=TEAL, font=FONT_LIGHT)
    line(s, 1.9, yc, 2.35, yc, TEAL, 1.5, tail=True)
    line(s, 3.3, yc, 4.0, yc, TEAL, 1.5, tail=True)

    # tile controller
    fx, fy, fw, fh = 7.3, 1.6, 2.1, 3.0
    rect(s, fx, fy, fw, fh, fill=BG2, line=INK, lw=1.0)
    text(s, fx + 0.12, fy + 0.1, fw - 0.2, 0.3, "Tile FPGA / MCU", size=13, color=INK)
    text(s, fx + 0.12, fy + 0.5, fw - 0.2, 2.4,
         ["4 slave/DMA ports", "snapshot buffer", "trigger fan-out", "switch control", "phase correction",
          "decimation / FFT", "framing to hub"], size=10, color=MUTED, bullets=True, para_space=2)
    line(s, 6.0, 2.65, fx, 2.65, INK, 1.25, tail=True)
    text(s, 6.08, 2.38, 1.2, 0.26, "IQ data", size=9, color=MUTED)
    line(s, fx, 3.2, 6.0, 3.2, AMBER, 1.0, dash="dash", tail=True)
    text(s, 6.08, 3.23, 1.2, 0.26, "trigger, EN", size=9, color=AMBER)
    # switch control (FPGA -> SPDT)
    path(s, [(fx, 4.3), (2.83, 4.3), (2.83, 3.25)], AMBER, 1.0, dash="dash", end_arrow=True)
    text(s, 3.0, 4.03, 2.0, 0.26, "ANT/CAL select", size=9, color=AMBER)

    # uplink
    box2(s, 10.0, 2.35, 2.73, 1.1, "Uplink to hub", ["data ↑   trigger + config ↓"], line_c=INK)
    line(s, fx + fw, 2.7, 10.0, 2.7, INK, 1.25, tail=True)
    line(s, 10.0, 3.1, fx + fw, 3.1, AMBER, 1.0, dash="dash", tail=True)

    # shared references
    box2(s, 2.0, 4.75, 1.55, 0.6, "1:4 Wilkinson", None, line_c=TEAL, size=11)
    line(s, 2.55, 4.75, 2.55, 3.25, TEAL, 1.25, tail=True)
    line(s, 0.6, 5.05, 2.0, 5.05, TEAL, 1.5, tail=True)
    text(s, 0.6, 4.75, 1.4, 0.28, "5.2 GHz from hub", size=9, color=TEAL)
    box2(s, 4.25, 4.75, 1.5, 0.6, "1:4 clock buffer", None, line_c=BLUE, size=11)
    line(s, 5.0, 4.75, 5.0, 3.55, BLUE, 1.25, tail=True)
    text(s, 5.07, 3.95, 0.8, 0.26, "XTAL_P", size=9, color=BLUE)
    line(s, 5.0, 5.6, 5.0, 5.35, BLUE, 1.5, tail=True)
    text(s, 5.1, 5.38, 1.6, 0.26, "48 MHz from hub", size=9, color=BLUE)
    box2(s, 7.3, 4.85, 2.1, 0.55, "Power", "5 V in → per-element 3.3 V", line_c=LINE, size=11, sub_size=9)

    # notes row
    line(s, 0.6, 5.8, 12.73, 5.8, RULE, 0.75)
    cols = [("Geometry", F["tile_note_geometry"]), ("Clock injection", F["tile_note_clock"]),
            ("Data port", F["tile_note_data"])]
    for i, (t, body) in enumerate(cols):
        x = 0.6 + i * 4.1
        text(s, x, 5.92, 3.9, 0.28, t, size=12, color=INK)
        text(s, x, 6.2, 3.9, 0.75, body, size=10, color=MUTED)
    return s


# ------------------------------------------------------------------ slide: data flow
def slide_dataflow(d, F):
    s = d.slide("What happens to the IQ data?",
                source=F["dataflow_source_line"])
    stages = F.get("dataflow_stages", [("ESP32-C5", "×16", TEAL_L, TEAL),
              ("Tile FPGA / MCU", "×4", WHITE, INK),
              ("Hub FPGA / SoC", "×1", BG2, INK),
              ("Host PC", "", WHITE, LINE)])
    xs = [0.6, 4.03, 7.46, 10.73]
    w, y, h = 2.0, 2.15, 0.8
    for (t, n, f, lc), x in zip(stages, xs):
        rect(s, x, y, w, h, fill=f, line=lc, lw=1.0,
             content=[[(t, {}), ("  " + n, {"color": MUTED, "size": 11})]], size=14)
    rates = F["dataflow_rates"]  # list of 3 (label, sub)
    for i in range(3):
        x1, x2 = xs[i] + w, xs[i + 1]
        line(s, x1, y + h / 2, x2, y + h / 2, INK, 1.5, tail=True)
        text(s, x1 - 0.12, y - 0.68, x2 - x1 + 0.24, 0.62, rates[i], size=10, color=INK, align="c", anchor="b")
    tasks = F["dataflow_tasks"]  # list of 4 lists
    for x, items in zip(xs, tasks):
        text(s, x, y + h + 0.2, w, 2.6, items, size=11, color=MUTED, bullets=True, para_space=4)
    # bottom insight
    line(s, 0.6, 5.55, 12.73, 5.55, RULE, 0.75)
    text(s, 0.6, 5.7, 12.1, 1.2, F["dataflow_insight"], size=14, color=INK)
    return s


# ------------------------------------------------------------------ slide: software stack
def slide_software(d, F=None):
    s = d.slide("Software stack",
                source="Everything above the C5 firmware is ordinary open tooling; the C5 layer depends on ESP-SDR and ESP-IDF internals.")
    cols = (F or {}).get("sw_cols") or [
        ("ESP32-C5 firmware", TEAL_L, TEAL,
         ["RF / LO configuration", "fixed-gain mode", "snapshot arm / trigger", "IQ capture to RAM (ESP-SDR)",
          "DMA out over slave port", "optional local FFT", "frame header: id, seq, timestamp"]),
        ("Tile FPGA / MCU", WHITE, INK,
         ["trigger fan-out", "4-port capture + buffer", "ANT/CAL switch sequencing", "timestamp alignment",
          "phase / gain correction", "decimate, FFT, select bins", "tile packetization"]),
        ("Hub FPGA / SoC", BG2, INK,
         ["epoch + trigger master", "4 tile-link receivers", "DDR snapshot store", "array calibration tables",
          "beamforming / covariance", "radar DSP (later)", "UDP / Ethernet to host"]),
        ("Host", WHITE, LINE,
         ["Python, NumPy, SciPy", "CuPy (optional)", "GNU Radio (optional)", "MATLAB (optional)",
          "calibration + DOA library", "dataset recorder", "control API"]),
    ]
    x0, w, gap = 0.6, 2.85, 0.24
    for i, (t, f, lc, items) in enumerate(cols):
        x = x0 + i * (w + gap)
        rect(s, x, 1.45, w, 0.55, fill=f, line=lc, lw=1.0, content=t, size=13)
        text(s, x + 0.05, 2.15, w - 0.1, 2.9, items, size=12, color=MUTED, bullets=True, para_space=5)
        if i < 3:
            line(s, x + w, 1.725, x + w + gap, 1.725, INK, 1.0, tail=True)
    # visualization strip
    line(s, 0.6, 4.75, 12.73, 4.75, RULE, 0.75)
    text(s, 0.6, 4.95, 3, 0.3, "Visualization", size=13, color=INK)
    vis = ["beam pattern", "AoA / MUSIC spectrum", "spectrogram", "range–Doppler map",
           "per-element phase vs time", "calibration health"]
    for i, v in enumerate(vis):
        x = 0.6 + i * 2.03
        rect(s, x, 5.4, 1.88, 0.55, fill=WHITE, line=RULE, lw=0.75, content=v, size=11, color=INK)
    text(s, 0.6, 6.15, 12, 0.3, "Every captured snapshot is stored with its calibration state, so results can be re-processed offline.",
         size=11, color=MUTED)
    return s
