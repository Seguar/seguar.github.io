"""Slides for the 2 x 8-element tile architecture (8 x C5 -> 2-bit PARLIO -> ESP32-S31 -> GbE)."""
from deckkit import *
from slides_arch import box2, antenna, stack_shadow, legend_lines

DCLK = "6F4E9E"   # 40 MHz PARLIO data clock (muted violet)


# ------------------------------------------------------------------ system: two tiles
def slide_system(d, F):
    s = d.slide("Two 8-element tiles and one timing board", source=F["sys_source"])
    # master board
    mx, my, mw, mh = 0.6, 1.5, 2.35, 4.9
    rect(s, mx, my, mw, mh, fill=BG2, line=INK, lw=1.0)
    text(s, mx + 0.12, my + 0.08, mw - 0.2, 0.3, "Master timing / RF board", size=12, color=INK)
    items = [("48 MHz TCXO", "+ fan-out → 16 C5", BLUE, 1.95),
             ("40 MHz data clock", "+ fan-out → PARLIO", DCLK, 2.95),
             ("Trigger / GO", "common capture start", AMBER, 3.95),
             ("5.2 GHz source", "MAX2871-class + 1:2", TEAL, 4.95)]
    for t, sub, col, yy in items:
        rect(s, mx + 0.15, yy - 0.05, mw - 0.3, 0.8, fill=WHITE, line=col, lw=1.0,
             content=[[t], [(sub, {"size": 9, "color": MUTED})]], size=11)
    # tiles
    tiles = [(3.85, 1.5), (3.85, 4.05)]
    for i, (tx, ty) in enumerate(tiles):
        rect(s, tx, ty, 5.4, 2.35, line=LINE, lw=0.75)
        text(s, tx + 0.1, ty + 0.05, 3.5, 0.25, f"Tile {'AB'[i]} — 8 × ESP32-C5 (2 × 4)", size=11, color=MUTED)
        for r in range(2):
            for c in range(4):
                cx, cy = tx + 0.3 + c * 0.66, ty + 0.5 + r * 0.85
                antenna(s, cx + 0.25, cy, 0.13)
                line(s, cx + 0.25, cy + 0.065, cx + 0.25, cy + 0.2, TEAL, 0.75)
                rect(s, cx, cy + 0.2, 0.5, 0.36, fill=TEAL_L, line=TEAL, lw=0.75, content="C5", size=9)
        rect(s, tx + 3.0, ty + 0.55, 1.05, 1.4, fill=BG2, line=INK, lw=1.0,
             content=[["ESP32-S31"], [("16-bit PARLIO in", {"size": 8, "color": MUTED})]], size=10)
        line(s, tx + 2.88, ty + 1.25, tx + 3.0, ty + 1.25, DCLK, 1.5, tail=True)
        text(s, tx + 2.6, ty + 1.97, 1.8, 0.25, "8 × 2-bit @ 40 MHz", size=8, color=DCLK)
        rect(s, tx + 4.3, ty + 0.85, 0.95, 0.8, line=INK, lw=0.75,
             content=[["PHY"], [("RTL8211F", {"size": 8, "color": MUTED})]], size=10)
        line(s, tx + 4.05, ty + 1.25, tx + 4.3, ty + 1.25, INK, 1.25, tail=True)
        text(s, tx + 4.0, ty + 0.95, 0.35, 0.25, "RGMII", size=7, color=MUTED, align="c")
        # references into tile (four parallel lines on the left edge)
        for k, (col, dash, yy) in enumerate(((BLUE, None, 2.3), (DCLK, None, 3.3), (AMBER, "dash", 4.3), (TEAL, None, 5.3))):
            xb = 3.05 + k * 0.17
            line(s, mx + mw - 0.15, yy, xb, yy, col, 1.25, dash)
            line(s, xb, yy, xb, ty + 0.35 + k * 0.42 if i == 0 else ty + 0.35 + k * 0.42, col, 1.25, dash)
            line(s, xb, ty + 0.35 + k * 0.42, tx, ty + 0.35 + k * 0.42, col, 1.25, dash, tail=True)
        # GbE out
        line(s, tx + 5.25, ty + 1.25, 10.0, ty + 1.25, INK, 1.75, tail=True)
        text(s, tx + 5.3, ty + 0.95, 0.8, 0.25, "1 GbE", size=9, color=INK)
    # host
    box2(s, 10.0, 2.2, 2.73, 3.2, "Host PC", ["2 × GbE NIC", "bit de-interleaving", "calibration, FFT",
                                              "beamforming, AoA", "radar / sensing"], line_c=LINE, sub_size=10)
    legend_lines(s, 0.6, 6.62, [("48 MHz RF reference", BLUE, None), ("40 MHz PARLIO clock", DCLK, None),
                                ("trigger", AMBER, "dash"), ("5.2 GHz calibration", TEAL, None), ("data", INK, None)])
    return s


# ------------------------------------------------------------------ one tile
def slide_tile8(d, F):
    s = d.slide("One tile: eight C5s, one S31, one Gigabit port", source=F["tile8_source"])
    yc = 2.75
    stack_shadow(s, 0.6, 2.4, 0.95, 0.7)
    box2(s, 0.6, 2.4, 0.95, 0.7, "Patch", "5.2 GHz", line_c=TEAL)
    stack_shadow(s, 1.9, 2.4, 0.85, 0.7)
    box2(s, 1.9, 2.4, 0.85, 0.7, "SPDT", "ANT / CAL", line_c=INK)
    stack_shadow(s, 3.15, 2.2, 1.6, 1.1)
    rect(s, 3.15, 2.2, 1.6, 1.1, fill=TEAL_L, line=TEAL, lw=1.0,
         content=[["ESP32-C5"], [("IQ snapshot → PARLIO TX", {"size": 9, "color": MUTED})]], size=13)
    text(s, 4.65, 1.8, 0.6, 0.3, "×8", size=16, color=TEAL, font=FONT_LIGHT)
    line(s, 1.55, yc, 1.9, yc, TEAL, 1.5, tail=True)
    line(s, 2.75, yc, 3.15, yc, TEAL, 1.5, tail=True)
    # S31
    sx, sy, sw, sh = 5.75, 1.55, 2.0, 3.0
    rect(s, sx, sy, sw, sh, fill=BG2, line=INK, lw=1.0)
    text(s, sx + 0.12, sy + 0.08, sw - 0.2, 0.3, "ESP32-S31", size=13, color=INK)
    text(s, sx + 0.12, sy + 0.45, sw - 0.2, 2.5, F["tile8_s31_items"], size=10, color=MUTED, bullets=True, para_space=2)
    line(s, 4.75, 2.6, sx, 2.6, DCLK, 1.75, tail=True)
    text(s, 4.78, 2.3, 1.0, 0.28, "2 bit × 40 MHz", size=8, color=DCLK, align="c")
    line(s, sx, 3.05, 4.75, 3.05, AMBER, 1.0, dash="dash", tail=True)
    line(s, 4.75, 3.25, sx, 3.25, AMBER, 1.0, dash="dash", tail=True)
    text(s, 4.78, 3.27, 1.0, 0.26, "READY / GO", size=8, color=AMBER, align="c")
    # network side
    box2(s, 8.2, 2.25, 1.25, 0.95, "PHY", ["RTL8211F", "10/100/1000"], line_c=INK, sub_size=9)
    line(s, sx + sw, 2.72, 8.2, 2.72, INK, 1.5, tail=True)
    text(s, sx + sw, 2.42, 0.45, 0.25, "RGMII", size=8, color=MUTED, align="c")
    box2(s, 9.85, 2.25, 1.2, 0.95, "MagJack", "RJ45", line_c=INK, sub_size=9)
    line(s, 9.45, 2.72, 9.85, 2.72, INK, 1.5, tail=True)
    line(s, 11.05, 2.72, 11.6, 2.72, INK, 1.75, tail=True)
    text(s, 11.6, 2.55, 1.2, 0.35, "1 GbE", size=13, color=INK)
    # shared references (from master board)
    box2(s, 1.45, 4.75, 1.45, 0.58, "1:8 splitter", None, line_c=TEAL, size=11)
    line(s, 2.2, 4.75, 2.2, 3.1, TEAL, 1.25, tail=True)
    box2(s, 3.15, 4.75, 1.55, 0.58, "1:8 buffer 48 MHz", None, line_c=BLUE, size=10)
    line(s, 3.6, 4.75, 3.6, 3.3, BLUE, 1.25, tail=True)
    text(s, 3.65, 3.85, 0.8, 0.25, "XTAL_P", size=8, color=BLUE)
    box2(s, 4.9, 4.75, 1.55, 0.58, "1:10 buffer 40 MHz", None, line_c=DCLK, size=10)
    line(s, 5.05, 4.75, 5.05, 3.75, DCLK, 1.25)
    line(s, 5.05, 3.75, 4.4, 3.75, DCLK, 1.25)
    line(s, 4.4, 3.75, 4.4, 3.3, DCLK, 1.25, tail=True)
    line(s, 6.25, 4.75, 6.25, 4.55, DCLK, 1.25, tail=True)
    text(s, 4.45, 3.5, 0.7, 0.25, "PCLK", size=8, color=DCLK)
    # SPDT control
    path(s, [(sx, 4.25), (2.45, 4.25), (2.45, 3.1)], AMBER, 1.0, dash="dash", end_arrow=True)
    text(s, 2.55, 3.98, 1.6, 0.25, "ANT / CAL via C5", size=8, color=AMBER)
    for lab, x, col in (("from master: 5.2 GHz", 1.45, TEAL), ("from master: 48 MHz", 3.15, BLUE),
                        ("from master: 40 MHz", 4.9, DCLK)):
        line(s, x + 0.7, 5.65, x + 0.7, 5.33, col, 1.25, tail=True)
        text(s, x - 0.1, 5.66, 1.8, 0.25, lab, size=8, color=col, align="c")
    text(s, 8.2, 3.55, 4.5, 1.9, F["tile8_notes"], size=11, color=MUTED, bullets=True, para_space=5)
    line(s, 0.6, 6.05, 12.73, 6.05, RULE, 0.75)
    text(s, 0.6, 6.15, 12.1, 0.75, F["tile8_take"], size=12, color=INK)
    return s


# ------------------------------------------------------------------ bus mapping
def slide_parlio_map(d, F):
    s = d.slide("Eight 2-bit streams on one 16-bit bus", source=F["map_source"])
    # clock box
    box2(s, 0.6, 1.45, 1.6, 0.5, "40 MHz PCLK", None, line_c=DCLK, size=10)
    line(s, 2.2, 1.7, 3.0, 1.7, DCLK, 1.25)
    line(s, 3.0, 1.7, 3.0, 6.25, DCLK, 1.0)
    bus_x = 4.2
    y0, step, h = 2.2, 0.52, 0.38
    for k in range(8):
        yy = y0 + k * step
        rect(s, 0.6, yy, 1.35, h, fill=TEAL_L, line=TEAL, lw=0.75, content=f"C5 #{k}", size=10)
        line(s, 3.0, yy + h / 2, 1.95, yy + h / 2, DCLK, 0.75, tail=True)
        # 2 data lines
        line(s, 1.95, yy + 0.12, bus_x, yy + 0.12, INK, 1.0)
        line(s, 1.95, yy + 0.26, bus_x, yy + 0.26, INK, 1.0)
        text(s, 3.15, yy - 0.07, 1.0, 0.22, f"D[{2 * k + 1}:{2 * k}]", size=8, color=MUTED, align="c")
    # bus bar and S31
    rect(s, bus_x, y0, 0.08, 8 * step - (step - h), fill=INK, line=None)
    rect(s, 4.65, 3.3, 1.6, 1.8, fill=BG2, line=INK, lw=1.0,
         content=[["ESP32-S31"], [("PARLIO RX", {"size": 9, "color": MUTED})], [("16 bit × 40 MHz", {"size": 9, "color": MUTED})]], size=12)
    line(s, bus_x + 0.08, 4.2, 4.65, 4.2, INK, 2.0, tail=True)
    line(s, 3.0, 6.25, 5.45, 6.25, DCLK, 1.0)
    line(s, 5.45, 6.25, 5.45, 5.1, DCLK, 1.0, tail=True)
    text(s, 3.1, 6.27, 2.4, 0.25, "same PCLK at the receiver", size=8, color=DCLK)
    # right column: sequence and frame
    x0 = 6.75
    text(s, x0, 1.4, 6.0, 0.3, "Start sequence", size=14, color=INK)
    text(s, x0, 1.75, 6.0, 1.9, F["map_sequence"], size=11, color=MUTED, para_space=1)
    text(s, x0, 3.6, 6.0, 0.3, "Per-lane frame (every C5 sends the same layout)", size=14, color=INK)
    table(s, x0, 3.95, [1.55, 0.75, 3.68], F["map_frame_rows"], row_h=0.265, size=10, col_align=["l", "r", "l"])
    text(s, x0, 6.25, 6.0, 0.7, F["map_note"], size=11, color=INK)
    return s


# ------------------------------------------------------------------ two data modes
def slide_modes2(d, F):
    s = d.slide("Two data modes", source=F["modes2_source"])
    for i, (title, st, lede, rows, notes_) in enumerate(F["modes2_cols"]):
        x = 0.6 + i * 6.2
        status_mark(s, x + 0.09, 1.62, st)
        text(s, x + 0.3, 1.45, 5.6, 0.35, title, size=17, color=INK, font=FONT_LIGHT)
        text(s, x, 1.95, 5.85, 0.7, lede, size=12, color=MUTED)
        table(s, x, 2.7, [3.4, 2.45], rows, row_h=0.32, size=11, header=False, col_align=["l", "r"])
        text(s, x, 2.7 + 0.32 * len(rows) + 0.2, 5.85, 2.2, notes_, size=11, color=MUTED, bullets=True, para_space=4)
    status_legend(s, 0.6, 6.62, ("C", "I", "O"))
    return s


# ------------------------------------------------------------------ plan B FPGA
def slide_planb(d, F):
    s = d.slide("Plan B: a small FPGA between the C5s and the S31", source=F["planb_source"])
    y0 = 1.7
    for k in range(4):
        rect(s, 0.6, y0 + k * 0.62, 1.2, 0.42, fill=TEAL_L, line=TEAL, lw=0.75, content=f"C5 #{k}", size=10)
        line(s, 1.8, y0 + k * 0.62 + 0.21, 3.0, y0 + k * 0.62 + 0.21, DCLK, 1.25, tail=True)
    text(s, 0.6, y0 + 4 * 0.62 - 0.05, 1.2, 0.3, "⋮  (×8)", size=12, color=MUTED, align="c")
    text(s, 1.85, y0 - 0.32, 1.3, 0.25, "own clock each", size=8, color=DCLK)
    rect(s, 3.0, 1.55, 2.6, 2.85, fill=BG2, line=INK, lw=1.0)
    text(s, 3.12, 1.62, 2.4, 0.3, "small FPGA", size=13, color=INK)
    text(s, 3.12, 2.0, 2.4, 2.4, F["planb_fpga_items"], size=10, color=MUTED, bullets=True, para_space=2)
    rect(s, 6.1, 2.4, 1.4, 0.95, fill=BG2, line=INK, lw=1.0, content=[["ESP32-S31"], [("or GbE PHY", {"size": 9, "color": MUTED})]], size=11)
    line(s, 5.6, 2.87, 6.1, 2.87, INK, 1.75, tail=True)
    line(s, 7.5, 2.87, 8.1, 2.87, INK, 1.75, tail=True)
    text(s, 8.15, 2.7, 1.0, 0.3, "1 GbE", size=12, color=INK)
    x0 = 9.0
    text(s, x0, 1.45, 3.75, 0.3, "Switch to Plan B if", size=14, color=INK)
    text(s, x0, 1.85, 3.75, 2.4, F["planb_when"], size=11, color=MUTED, bullets=True, para_space=4)
    line(s, 0.6, 4.75, 12.73, 4.75, RULE, 0.75)
    text(s, 0.6, 4.9, 6.0, 0.3, "What it costs", size=13, color=INK)
    text(s, 0.6, 5.25, 5.9, 1.5, F["planb_cost"], size=11, color=MUTED, bullets=True, para_space=3)
    text(s, 6.75, 4.9, 6.0, 0.3, "What it adds", size=13, color=INK)
    text(s, 6.75, 5.25, 5.95, 1.5, F["planb_adds"], size=11, color=MUTED, bullets=True, para_space=3)
    return s


# ------------------------------------------------------------------ tile PCB and seam
def slide_tile_pcb(d, F):
    s = d.slide("Tile PCB: geometry, seam and stack-up", source=F["pcb_source"])
    # scaled drawing: 1 mm = 0.024 in
    k = 0.0205
    ox, oy = 0.9, 1.5
    tw, th = 150 * k, 100 * k
    p = 28.8 * k
    # tile A (antenna rows at bottom edge), tile B mirrored below
    for i in range(2):
        ty = oy + i * th
        rect(s, ox, ty, tw, th, fill=WHITE, line=LINE, lw=1.0)
        text(s, ox + 0.08, ty + (0.05 if i == 0 else th - 0.3), 2.5, 0.25, f"Tile {'AB'[i]} (≈150 × 100 mm)", size=9, color=MUTED)
        # antenna block 4 x 2 next to the seam
        blk_x0 = ox + (tw - 4 * p) / 2 + p / 2
        rows_y = [ty + th - 0.5 * p - 1 * p, ty + th - 0.5 * p] if i == 0 else [ty + 0.5 * p, ty + 1.5 * p]
        for ry in rows_y:
            for c in range(4):
                cx = blk_x0 + c * p
                rect(s, cx - 0.13, ry - 0.1, 0.26, 0.2, fill=TEAL_L, line=TEAL, lw=0.75)
        # electronics zone
        ez_y = ty + 0.35 if i == 0 else ty + 2 * p + 0.1
        rect(s, ox + 0.15, ez_y, tw - 0.3, th - 2 * p - 0.5, fill=BG2, line=None,
             content="back: S31, PHY, clock buffers, power", size=9, color=MUTED)
    # seam line
    line(s, ox - 0.15, oy + th, ox + tw + 0.15, oy + th, RED, 1.0, dash="dash")
    text(s, ox + tw + 0.2, oy + th - 0.13, 1.3, 0.26, "seam", size=9, color=RED)
    # dimension: half pitch to edge
    cx0 = ox + (tw - 4 * p) / 2 + p / 2
    line(s, cx0 - 0.35, oy + th - 0.5 * p, cx0 - 0.35, oy + th, INK, 0.75, head=True, tail=True)
    text(s, cx0 - 1.45, oy + th - 0.42, 1.05, 0.25, "14.4 mm", size=9, color=INK, align="r")
    text(s, 0.6, oy + 2 * th + 0.12, 4.1, 0.9, F["pcb_geom_note"], size=10, color=MUTED)
    # stack-up and notes
    x0 = 5.05
    text(s, x0, 1.45, 3.4, 0.3, "Rev 1 stack-up (custom 4-layer FR-4)", size=13, color=INK)
    table(s, x0, 1.8, [0.55, 2.85], F["pcb_stack_rows"], row_h=0.3, size=10, header=False)
    text(s, x0, 3.15, 3.4, 0.3, "Fab cost (team estimate)", size=13, color=INK)
    table(s, x0, 3.5, [2.2, 1.2], F["pcb_cost_rows"], row_h=0.28, size=10, header=False, col_align=["l", "r"])
    x1 = 8.85
    text(s, x1, 1.45, 3.9, 0.3, "The patch substrate", size=13, color=INK)
    text(s, x1, 1.8, 3.9, 4.6, F["pcb_patch_notes"], size=11, color=MUTED, bullets=True, para_space=5)
    return s


# ------------------------------------------------------------------ bench tests
def slide_bench(d, F):
    rows = F["bench_rows"]
    s = d.slide("Critical bench experiments before the tile PCB", source=F["bench_source"])
    body = [[""] + rows[0][1:]] + [[""] + r[1:] for r in rows[1:]]
    col_w = [0.55, 3.2, 3.6, 4.78]
    shp = table(s, 0.6, 1.4, col_w, body, row_h=0.54, size=11, valign="m", header_size=12,
                row_heights=F.get("bench_row_heights"))
    tbl = shp.table
    yy = 1.4 + Emu(tbl.rows[0].height).inches
    for i, r in enumerate(rows[1:], start=1):
        hh = Emu(tbl.rows[i].height).inches
        status_mark(s, 0.6 + col_w[0] / 2, yy + hh / 2, r[0])
        yy += hh
    status_legend(s, 0.6, 6.62, ("C", "I", "O"))
    return s


# ------------------------------------------------------------------ development sequence
def slide_devseq(d, F):
    s = d.slide("Development sequence", source=F["dev_source"])
    steps = F["dev_steps"]
    n = len(steps)
    w, gap = 1.88, 0.13
    for i, st in enumerate(steps):
        x = 0.6 + i * (w + gap)
        fill = BLUE_L if i < 5 else BG2
        lc = BLUE if i < 5 else LINE
        rect(s, x, 1.45, w, 0.75, fill=fill, line=lc, lw=0.75,
             content=[[(st["n"] + "  ", {"color": BLUE}), (st["title"], {})]], size=13, align="l", margin=0.1)
        text(s, x, 2.32, w, 2.2, st["goals"], size=12, color=MUTED, bullets=True, para_space=3)
        line(s, x, 4.55, x + w, 4.55, RULE, 0.75)
        text(s, x, 4.65, w, 0.3, "Done when", size=12, color=AMBER if i < 5 else TEAL)
        text(s, x, 4.98, w, 1.4, st["gate"], size=12, color=INK)
    return s


# ------------------------------------------------------------------ alternatives considered
def slide_alternatives(d, F):
    s = d.slide("Alternatives we considered", source=F["alt_source"])
    table(s, 0.6, 1.4, [2.9, 4.65, 4.58], F["alt_rows"], row_h=0.6, size=11, valign="m", header_size=12,
          row_heights=F.get("alt_row_heights"))
    return s


# ------------------------------------------------------------------ TX steering maths
def slide_tx_steer(d, F):
    s = d.slide("Transmit steering: easy maths, hard hardware", source=F["txs_source"])
    text(s, 0.6, 1.4, 5.2, 0.3, "Phase step between neighbours at λ/2", size=14, color=INK)
    text(s, 0.6, 1.8, 5.2, 0.45, [[("Δφ = −π · sin θ,   s", {}), ("k", {"size": 12}), ("[n] = s[n] · e", {}),
                                    ("jkΔφ", {"sup": True})]], size=17, font="Cambria Math")
    table(s, 0.6, 2.45, [2.0, 2.0], F["txs_rows"], row_h=0.34, size=12, col_align=["r", "r"])
    x0 = 6.2
    text(s, x0, 1.4, 6.5, 0.3, "What is actually hard", size=14, color=INK)
    text(s, x0, 1.8, 6.5, 2.5, F["txs_hard"], size=12, color=MUTED, bullets=True, para_space=5)
    text(s, x0, 4.3, 6.5, 0.3, "If steering is needed before that is solved", size=14, color=INK)
    text(s, x0, 4.7, 6.5, 2.0, F["txs_fallback"], size=12, color=MUTED, bullets=True, para_space=5)
    return s


# ------------------------------------------------------------------ cost
def slide_cost(d, F):
    s = d.slide("What a tile and the full array cost", source=F["cost_source"])
    text(s, 0.6, 1.4, 6.3, 0.3, "One 8-element tile (electronics)", size=14, color=INK)
    table(s, 0.6, 1.75, [4.3, 1.9], F["cost_tile_rows"], row_h=0.3, size=11, col_align=["l", "r"])
    x0 = 7.35
    text(s, x0, 1.4, 5.4, 0.3, "Full 16-element system", size=14, color=INK)
    table(s, x0, 1.75, [3.5, 1.88], F["cost_sys_rows"], row_h=0.32, size=11, col_align=["l", "r"])
    text(s, x0, F.get("cost_note_y", 4.2), 5.4, 2.4, F["cost_notes"], size=11, color=MUTED, bullets=True, para_space=4)
    return s


# ------------------------------------------------------------------ synchronization domains
def slide_domains(d, F):
    s = d.slide("Four synchronization domains — and what Ethernet is not for", source=F["dom_source"])
    table(s, 0.6, 1.4, [2.1, 3.9, 3.0, 3.13], F["dom_rows"], row_h=0.6, size=12, valign="m", header_size=12,
          row_heights=F.get("dom_row_heights"))
    text(s, 0.6, 5.55, 12.1, 0.9, F["dom_take"], size=14, color=INK)
    return s
