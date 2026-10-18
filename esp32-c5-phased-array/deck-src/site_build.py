"""Build the GitHub Pages walkthrough for the ESP32-C5 phased array from the deck's content files.

Usage: python site_build.py <out_dir> [<research_dir>]   (index.html; evidence.html only with research_dir)
"""
import sys, os, json, glob, math, html as H
import numpy as np
from content_v3 import F, REFS
import budget as B

OUT = sys.argv[1]
RESEARCH = sys.argv[2] if len(sys.argv) > 2 else None
E = H.escape

# ------------------------------------------------------------------ helpers
STATUS = {"C": ("confirmed", "t-c"), "I": ("inference", "t-i"), "O": ("open", "t-o"), "S": ("speculative", "t-s")}


def tag(st):
    name, cls = STATUS[st]
    return f'<span class="tag {cls}">{name}</span>'


def plain(v):
    """Flatten the deck's rich-text cell formats to plain text."""
    if v is None:
        return ""
    if isinstance(v, dict):
        return plain(v.get("c", v.get("runs", "")))
    if isinstance(v, tuple):
        return str(v[0])
    if isinstance(v, list):
        parts = [plain(x) for x in v]
        # list of paragraphs (each a list of runs) -> join runs without separator
        return "".join(parts) if all(isinstance(x, (tuple, str)) for x in v) else " ".join(parts)
    return str(v)


def table(rows, status_first=False, cls="", num_cols=()):
    h = rows[0]
    out = [f'<div class="tbl"><table class="{cls}"><thead><tr>']
    for j, c in enumerate(h):
        if status_first and j == 0:
            out.append('<th class="st">Status</th>')
        else:
            out.append(f"<th>{E(plain(c))}</th>")
    out.append("</tr></thead><tbody>")
    for r in rows[1:]:
        out.append("<tr>")
        for j, c in enumerate(r):
            if status_first and j == 0:
                out.append(f'<td class="st">{tag(c)}</td>')
            else:
                k = ' class="n"' if j in num_cols else ""
                out.append(f"<td{k}>{E(plain(c))}</td>")
        out.append("</tr>")
    out.append("</tbody></table></div>")
    return "".join(out)


def ul(items, cls=""):
    return f'<ul class="{cls}">' + "".join(f"<li>{E(plain(i))}</li>" for i in items) + "</ul>"


# ------------------------------------------------------------------ SVG mini-kit
class Svg:
    def __init__(self, w, h, label, minw=None):
        self.w, self.h, self.aria, self.minw = w, h, label, minw
        self.p = []

    def box(self, x, y, w, h, cls="box", rx=7):
        self.p.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" class="{cls}"/>')

    def t(self, x, y, s, cls="", anchor=None):
        a = {"m": " mid", "e": " end"}.get(anchor, "")
        self.p.append(f'<text x="{x}" y="{y}" class="{cls}{a}">{E(s)}</text>')

    def label(self, x, y, w, h, title, sub=None, cls="box", tcls="b"):
        self.box(x, y, w, h, cls)
        cy = y + h / 2 + (4 if not sub else -3)
        self.t(x + w / 2, cy, title, tcls, "m")
        if sub:
            for i, s in enumerate(sub if isinstance(sub, list) else [sub]):
                self.t(x + w / 2, cy + 15 + 13 * i, s, "s", "m")

    def ln(self, x1, y1, x2, y2, cls="wire", arrow=True):
        m = f' marker-end="url(#a-{cls.split()[0]})"' if arrow else ""
        self.p.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" class="{cls}"{m}/>')

    def pl(self, pts, cls="wire", arrow=True):
        d = " ".join(f"{x},{y}" for x, y in pts)
        m = f' marker-end="url(#a-{cls.split()[0]})"' if arrow else ""
        self.p.append(f'<polyline points="{d}" class="{cls}"{m}/>')

    def raw(self, s):
        self.p.append(s)

    def render(self):
        style = f' style="min-width:{self.minw}px"' if self.minw else ""
        return (f'<div class="draw"><svg viewBox="0 0 {self.w} {self.h}" role="img" aria-label="{E(self.aria)}"{style}>'
                + "".join(self.p) + "</svg></div>")


MARKERS = """<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>""" + "".join(
    f'<marker id="a-{k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
    f'<path d="M0,0 L10,5 L0,10 z" fill="var(--{v})"/></marker>'
    for k, v in (("wire", "ink"), ("data", "ink"), ("rf", "rf"), ("rfc", "rf"), ("clk", "clk"), ("pclk", "card"), ("ctl", "ctl"))
) + "</defs></svg>"


# ------------------------------------------------------------------ diagrams
def svg_chain():
    s = Svg(1080, 300, "One element: patch, RF switch, ESP32-C5, 2-bit PARLIO lane into the ESP32-S31, Gigabit Ethernet", 760)
    y, h = 36, 70
    s.label(20, y, 120, h, "Patch", "5.2 GHz", "zr")
    s.label(180, y, 110, h, "SPDT", "ANT / CAL")
    s.label(330, y, 180, h, "ESP32-C5", ["raw IQ snapshot", "PARLIO TX, 2 bit"], "zr")
    s.label(600, y, 180, h, "ESP32-S31", ["16-bit PARLIO RX", "1 per 8 elements"], "zk")
    s.label(830, y, 100, h, "PHY", "RGMII → GbE")
    s.ln(140, y + 35, 178, y + 35, "rf")
    s.ln(290, y + 35, 328, y + 35, "rf")
    s.ln(510, y + 35, 598, y + 35, "data")
    s.t(555, y + 26, "80 Mbit/s", "s", "m")
    s.ln(780, y + 35, 828, y + 35, "data")
    s.ln(930, y + 35, 995, y + 35, "data")
    s.t(1000, y + 39, "1 GbE", "b")
    s.t(470, 20, "× 8 per tile, × 16 in the array", "s wt", "m")
    # references
    refs = [("48 MHz reference → XTAL_P", "clk", 400, 160), ("40 MHz PARLIO clock (PCLK)", "pclk", 440, 190),
            ("common trigger / GO", "ctl", 480, 220), ("5.2 GHz calibration tone", "rfc", 235, 250)]
    for lab, cls, xt, yy in refs:
        s.ln(20, yy, xt, yy, cls, False)
        s.ln(xt, yy, xt, y + h + 2, cls)
        s.t(24, yy - 6, lab, "s")
    s.ln(440, 190, 690, 190, "pclk", False)
    s.ln(690, 190, 690, y + h + 2, "pclk")
    s.ln(480, 220, 650, 220, "ctl", False)
    s.ln(650, 220, 650, y + h + 2, "ctl")
    s.t(700, 215, "S31 checks READY, releases GO / PCLK", "s")
    return s.render()


def svg_system():
    s = Svg(1120, 560, "System: master timing and RF board, two 8-element tiles with one ESP32-S31 and one Gigabit PHY each, host PC", 900)
    s.box(20, 20, 230, 520, "grp")
    s.t(135, 46, "Master timing / RF board", "t", "m")
    items = [("48 MHz TCXO + fan-out", "→ XTAL_P of 16 C5s", "zc", 80), ("40 MHz PCLK + fan-out", "→ 16 C5 TX + 2 S31 RX", "zk", 190),
             ("Trigger / GO", "common capture start", "zv", 300), ("5.2 GHz source", "MAX2871-class, 1:2 split", "zr", 410)]
    for t, sub, cls, yy in items:
        s.label(40, yy, 190, 80, t, sub, cls)
    tiles = [(330, 30), (330, 300)]
    lines = [("clk", 120), ("pclk", 230), ("ctl", 340), ("rfc", 450)]
    for i, (tx, ty) in enumerate(tiles):
        s.box(tx, ty, 560, 230, "frame")
        s.t(tx + 14, ty + 24, f"Tile {'AB'[i]} — 8 × ESP32-C5 (2 × 4)", "b")
        for r in range(2):
            for c in range(4):
                cx, cy = tx + 22 + c * 74, ty + 52 + r * 84
                s.box(cx + 18, cy, 22, 16, "zr", 3)
                s.ln(cx + 29, cy + 16, cx + 29, cy + 30, "rft", False)
                s.label(cx, cy + 30, 60, 34, "C5", None, "zr", "s")
        s.label(tx + 330, ty + 60, 120, 110, "ESP32-S31", ["16-bit PARLIO", "UDP, PTP"], "zk")
        s.ln(tx + 312, ty + 115, tx + 328, ty + 115, "data")
        s.t(tx + 160, ty + 220, "8 × 2-bit lanes @ 40 MHz = 640 Mbit/s", "s", "m")
        s.label(tx + 470, ty + 85, 76, 60, "PHY", "RTL8211F", "box")
        s.ln(tx + 450, ty + 115, tx + 468, ty + 115, "data")
        # references
        for k, (cls, yy) in enumerate(lines):
            xb = 262 + k * 14
            ty_in = ty + 50 + k * 40
            s.ln(250, yy, xb, yy, cls, False)
            s.ln(xb, yy, xb, ty_in, cls, False)
            s.ln(xb, ty_in, tx - 2, ty_in, cls)
        xv, ye = (922, 250) if i == 0 else (936, 310)
        s.pl([(tx + 546, ty + 115), (xv, ty + 115), (xv, ye), (948, ye)], "data")
        s.t(tx + 560, ty + 108, "1 GbE", "s")
    s.label(950, 200, 150, 160, "Host PC", ["2 × GbE", "de-interleave bits", "calibrate, FFT", "beamform, AoA", "radar / sensing"], "box")
    return s.render()


def svg_bus():
    s = Svg(1100, 482, "Eight C5s each drive two bits of the ESP32-S31's 16-bit PARLIO bus on a shared 40 MHz clock; READY/GO start", 900)
    y0, step = 40, 50
    s.label(20, 0 + 4, 140, 30, "40 MHz PCLK", None, "zk", "s")
    s.ln(160, 19, 200, 19, "pclk", False)
    s.ln(200, 19, 200, y0 + 8 * step - 10, "pclk", False)
    for k in range(8):
        yy = y0 + k * step
        s.label(20, yy, 110, 36, f"C5 #{k}", None, "zr", "s")
        s.ln(200, yy + 18, 132, yy + 18, "pclk")
        s.ln(130, yy + 10, 340, yy + 10, "data", False)
        s.ln(130, yy + 26, 340, yy + 26, "data", False)
        s.t(270, yy + 6, f"D[{2 * k + 1}:{2 * k}]", "m s", "m")
        s.ln(130, yy + 33, 300, yy + 33, "ctl", False)
    s.box(340, y0, 8, 8 * step - 14, "dk", 2)
    s.label(390, 160, 150, 120, "ESP32-S31", ["PARLIO RX", "16 bit × 40 MHz"], "zk")
    s.ln(348, 220, 388, 220, "data")
    s.pl([(300, y0 + 33), (300, y0 + 7 * step + 33), (465, y0 + 7 * step + 33), (465, 282)], "ctl")
    s.t(352, y0 + 7 * step + 27, "READY × 8 → S31", "s")
    s.pl([(200, y0 + 8 * step - 10), (200, 452), (515, 452), (515, 282)], "pclk")
    s.t(210, 472, "same PCLK at the receiver (sampled on the falling edge)", "s")
    # waveform panel
    x0, wy = 600, 30
    s.t(x0, wy, "Clock-held start (inference to test)", "b")
    rows = [("PCLK", "clk"), ("GO", "ctl"), ("C5 #0 D[1:0]", "d"), ("C5 #1 D[3:2]", "d"), ("C5 #7 D[15:14]", "d")]
    t0, per = x0 + 120, 22
    for i, (name, kind) in enumerate(rows):
        yy = wy + 40 + i * 52
        s.t(x0, yy + 12, name, "s")
        if kind == "clk":
            pts = [(t0, yy + 18), (t0 + 3 * per, yy + 18)]
            x = t0 + 3 * per
            for n in range(9):
                pts += [(x, yy), (x + per / 2, yy), (x + per / 2, yy + 18), (x + per, yy + 18)]
                x += per
            s.pl(pts, "pclk", False)
            s.t(t0, yy - 6, "held", "s")
        elif kind == "ctl":
            s.pl([(t0, yy + 18), (t0 + 3 * per - 6, yy + 18), (t0 + 3 * per - 6, yy), (t0 + 12 * per, yy)], "ctl", False)
        else:
            s.pl([(t0, yy + 9), (t0 + 3 * per, yy + 9)], "wire", False)
            x = t0 + 3 * per
            for n in range(9):
                s.raw(f'<polygon points="{x},{yy + 9} {x + 4},{yy} {x + per - 4},{yy} {x + per},{yy + 9} {x + per - 4},{yy + 18} {x + 4},{yy + 18}" '
                      f'class="{"zw" if n < 3 else "box"}"/>')
                x += per
    s.raw(f'<line x1="{t0 + 3 * per}" y1="{wy + 30}" x2="{t0 + 3 * per}" y2="{wy + 40 + 5 * 52}" class="ctl"/>')
    s.t(t0 + 3 * per + 4, wy + 40 + 5 * 52 + 10, "first edge: every lane starts its sync word together", "s")
    s.t(t0 + 3 * per + 4, wy + 40 + 5 * 52 + 26, "sync word (shaded) identical on all lanes", "s wt")
    return s.render()


def svg_cal():
    s = Svg(1000, 300, "Calibration path: synthesizer, 1:2 and 1:8 splitters, one RF switch per element choosing antenna or calibration", 760)
    s.label(20, 110, 150, 70, "5.2 GHz source", ["MAX2871-class", "mute in ANT mode"], "zr")
    s.label(210, 110, 100, 70, "1:2", "to tiles A / B")
    s.label(350, 110, 100, 70, "1:8", "Wilkinson tree")
    s.ln(170, 145, 208, 145, "rfc")
    s.ln(310, 145, 348, 145, "rfc")
    s.ln(260, 180, 260, 240, "rfc", False)
    s.ln(260, 240, 300, 240, "rfc")
    s.t(305, 244, "tile B", "s")
    for k in range(4):
        yy = 30 + k * 64
        s.pl([(450, 145), (480, 145), (480, yy + 34), (598, yy + 34)], "rfc")
        s.box(530, yy + 2, 22, 16, "zr", 3)
        s.pl([(552, yy + 10), (598, yy + 18)], "rf")
        s.label(600, yy, 90, 46, "SPDT", None, "box", "s")
        s.ln(690, yy + 23, 738, yy + 23, "rf")
        s.label(740, yy, 110, 46, "ESP32-C5", None, "zr", "s")
    s.t(560, 290, "4 of 8 elements shown · upper SPDT input: patch · lower input: calibration", "s", "m")
    s.t(870, 60, "≈ −20 to −23 dBm", "b")
    s.t(870, 78, "at each C5 for 0 dBm", "s")
    s.t(870, 94, "source (estimate)", "s")
    s.t(870, 130, "SPDT isolation ≈ 24 dB", "s wt")
    s.t(870, 146, "(datasheet, 2.45 GHz):", "s wt")
    s.t(870, 162, "mute the source while", "s wt")
    s.t(870, 178, "measuring the scene", "s wt")
    return s.render()


def svg_pcb():
    k = 2.3   # px per mm
    tw, th, p = 150 * k, 100 * k, 28.8 * k
    s = Svg(900, 520, "Two tile PCBs drawn to scale with the 2 by 4 antenna block of each tile against the seam", 640)
    ox, oy = 30, 20
    for i in range(2):
        ty = oy + i * th
        s.box(ox, ty, tw, th, "frame", 4)
        s.t(ox + 8, ty + (16 if i == 0 else th - 8), f"Tile {'AB'[i]} (≈ 150 × 100 mm)", "s")
        x0 = ox + (tw - 4 * p) / 2 + p / 2
        rows = [ty + th - 1.5 * p, ty + th - 0.5 * p] if i == 0 else [ty + 0.5 * p, ty + 1.5 * p]
        for ry in rows:
            for c in range(4):
                cx = x0 + c * p
                s.box(cx - 17.5 * k / 2, ry - 13.5 * k / 2, 17.5 * k, 13.5 * k, "zr", 2)
        ez = ty + 24 if i == 0 else ty + 2 * p + 8
        s.box(ox + 12, ez, tw - 24, th - 2 * p - 34, "zone", 6)
        s.t(ox + tw / 2, ez + (th - 2 * p - 34) / 2 + 4, "back: S31, PHY, clock buffers, power", "s", "m")
    s.raw(f'<line x1="{ox - 10}" y1="{oy + th}" x2="{ox + tw + 10}" y2="{oy + th}" class="pwr" stroke-dasharray="6 4"/>')
    s.t(ox + tw + 14, oy + th + 4, "seam", "s")
    cx0 = ox + (tw - 4 * p) / 2 + p / 2
    s.raw(f'<line x1="{cx0 - 30}" y1="{oy + th - 0.5 * p}" x2="{cx0 - 30}" y2="{oy + th}" class="wire" marker-start="url(#a-wire)" marker-end="url(#a-wire)"/>')
    s.t(cx0 - 36, oy + th - 0.25 * p + 4, "14.4 mm", "s", "e")
    xr = cx0 + 3 * p + 34
    s.raw(f'<line x1="{xr}" y1="{oy + th - 1.5 * p}" x2="{xr}" y2="{oy + th - 0.5 * p}" class="wire" marker-start="url(#a-wire)" marker-end="url(#a-wire)"/>')
    s.t(xr + 6, oy + th - p + 4, "28.8 mm", "s")
    # notes
    nx = ox + tw + 70
    s.t(nx, 40, "Drawn to scale (patch ≈ 17.5 × 13.5 mm).", "b")
    lines = ["Rows stay 28.8 mm apart across the", "seam only if each board edge is", "14.4 mm from its nearest row.",
             "", "So the antenna block sits against", "the seam and the electronics grow", "away from it.", "",
             "The ground plane is cut at the seam:", "edge rows will have different embedded", "patterns — calibrate per element.", "",
             "Front: patches only. Back: each C5", "under its own patch."]
    for i, l in enumerate(lines):
        s.t(nx, 66 + 18 * i, l, "s")
    return s.render()


def svg_bars():
    items = F["dataproblem_items"]
    w, h = 980, 40 + 34 * len(items) + 50
    s = Svg(w, h, "Bar chart on a log scale: data produced by the array versus link capacities", 720)
    x0, x1 = 260, 900
    lo, hi = 0, 5   # log10 Mbit/s

    def X(v):
        return x0 + (math.log10(v) - lo) / (hi - lo) * (x1 - x0)
    for dec in range(lo, hi + 1):
        xx = X(10 ** dec)
        s.raw(f'<line x1="{xx}" y1="20" x2="{xx}" y2="{h - 40}" stroke="var(--line)"/>')
        s.t(xx, h - 22, f"{10 ** dec:,}", "s", "m")
    s.t((x0 + x1) / 2, h - 4, "Mbit/s (log scale)", "s", "m")
    for i, (lab, v, kind) in enumerate(sorted(items, key=lambda t: -t[1])):
        yy = 28 + 34 * i
        s.t(x0 - 10, yy + 16, lab, "s", "e")
        cls = "bar-need" if kind == "need" else "bar-link"
        s.raw(f'<rect x="{x0}" y="{yy}" width="{X(v) - x0:.1f}" height="22" rx="3" class="{cls}"/>')
        s.t(X(v) + 6, yy + 16, f"{v:,} Mbit/s", "s")
    return s.render()


def af_points(steer, n=4):
    th = np.arange(-90, 90.5, 1.0)
    af = B.array_factor_db(n, steer, th)
    return th, af


def svg_af():
    w, h = 720, 340
    s = Svg(w, h, "Array factor of one 4-element row at half-wavelength spacing, steered by the slider", 520)
    x0, x1, y0, y1 = 60, 700, 20, 290

    def X(t):
        return x0 + (t + 90) / 180 * (x1 - x0)

    def Y(db):
        return y0 + (0 - db) / 40 * (y1 - y0)
    for db in range(0, -41, -10):
        s.raw(f'<line x1="{x0}" y1="{Y(db)}" x2="{x1}" y2="{Y(db)}" stroke="var(--line)"/>')
        s.t(x0 - 8, Y(db) + 4, f"{db}", "s", "e")
    for t in range(-90, 91, 30):
        s.raw(f'<line x1="{X(t)}" y1="{y0}" x2="{X(t)}" y2="{y1}" stroke="var(--line)"/>')
        s.t(X(t), y1 + 18, f"{t}°", "s", "m")
    s.t((x0 + x1) / 2, h - 4, "angle (degrees)", "s", "m")
    s.t(14, (y0 + y1) / 2, "dB", "s", "m")
    th, af = af_points(0)
    pts = " ".join(f"{X(t):.1f},{Y(v):.1f}" for t, v in zip(th, af))
    s.raw(f'<polyline points="{pts}" class="af0"/>')
    s.raw('<polyline id="afSteer" points="" class="af1"/>')
    return s.render()


# ------------------------------------------------------------------ sections
SECTIONS = []   # (id, phase, title, html)


def sec(id_, phase, title, body, step=None):
    SECTIONS.append((id_, phase, title, body))


lam = 299792458 / 5.2e9

HAND = [  # (status, claim, source)
    ("C", "Broadcom BCM53202M: eight 10/100 PHYs plus two GMII/RGMII/TBI Gigabit interfaces and a 384 KB packet buffer.",
     "https://docs.broadcom.com/doc/53202M-PB00-R"),
    ("C", "MAX2871: 23.5–6000 MHz; integrated VCOs cover 3.0–6.0 GHz (5.2 GHz is a VCO fundamental); outputs −1 to +8 dBm and can be muted.",
     "https://www.analog.com/en/products/max2871.html"),
    ("C", "SKY13351-378LF SPDT: 0.35 dB insertion loss and 24 dB isolation at 2.45 GHz (datasheet typical); 5–6 GHz values only from distributor summaries — to be measured.",
     "https://shop.richardsonrfpd.com/Products/Product/SKY13351-378LF"),
    ("C", "RTL8211F(I)-CG: integrated 10/100/1000 Ethernet PHY with an RGMII MAC interface (3.3/2.5/1.8/1.5 V signalling).",
     "https://www.armdesigner.com/download/RTL8211F-CG-Realtek.pdf"),
    ("C", "JLCPCB 4-layer 7628 stack-up: about 0.2 mm prepreg between L1 and L2 (0.2104 mm in current data), 1.065 mm core.",
     "https://jlcpcb.com/quote/pcbOrderFaq/PCB%20Stackup"),
    ("I", "Patch on FR-4 (εr 4.4, tan δ 0.02) at 5.2 GHz: lossless radiation bandwidth about 0.3 % and efficiency at most about 18 % for h ≈ 0.21 mm; about 1.6 % and 53 % for h ≈ 1.065 mm (the Rev 1 custom stack); about 2.3 % and 62 % for h ≈ 1.5 mm. From BW ≈ 3.77·(εr−1)/εr²·(W/L)·(h/λ₀) (lossless space-wave bandwidth) with efficiency from dielectric loss only; conductor and surface-wave loss lower it.",
     "https://www.mikrocontroller.net/attachment/208694/microstrip_antennas_overview.pdf"),
]

def key_counts():
    c = {}
    for r in F["claims_rows"][1:]:
        c[r[0]] = c.get(r[0], 0) + 1
    return c, sum(c.values())


def evidence_counts():
    c = {}
    files = sorted(glob.glob(os.path.join(RESEARCH, "research_*.json"))) if RESEARCH else []
    for p in files:
        for cl in json.load(open(p, encoding="utf-8"))["result"]["claims"]:
            k = {"CONFIRMED": "C", "INFERRED": "I", "UNKNOWN": "O"}[cl["status"]]
            c[k] = c.get(k, 0) + 1
    if not files:
        for r in F["claims_rows"][1:]:
            c[r[0]] = c.get(r[0], 0) + 1
    else:
        for st, _, _ in HAND:
            c[st] = c.get(st, 0) + 1
    return c, sum(c.values())


import site_visual as V

LEG = """<div class="legend"><span><i class="sw" style="border-color:var(--rf)"></i>RF</span>
<span><i class="sw d" style="border-color:var(--rf)"></i>5.2 GHz calibration</span>
<span><i class="sw" style="border-color:var(--clk)"></i>48 MHz reference</span>
<span><i class="sw" style="border-color:var(--card)"></i>40 MHz PARLIO clock</span>
<span><i class="sw d" style="border-color:var(--ctl)"></i>trigger / READY / GO</span>
<span><i class="sw" style="border-color:var(--ink)"></i>data</span></div>"""

sec("build", "concept", "What we are building", svg_chain() + LEG
    + V.stats([("16", "ESP32-C5 elements, 4 × 4"), ("5.2 GHz", "λ/2 = 28.8 mm"), ("640 Mbit/s", "per 8-element tile, 1 GbE"),
               ("≈ $220–300", "hardware target")])
    + V.uses_html(F, tag)
    + V.more(table([["Quantity", "Value"], ["Wavelength at 5.2 GHz", f"{lam * 1e3:.1f} mm"], ["Element pitch (λ/2)", f"{lam / 2 * 1e3:.1f} mm"],
                    ["Outer element centres", f"{3 * lam / 2 * 1e3:.1f} mm"], ["Half-power beamwidth, 4 elements", "≈ 25°"],
                    ["Tiles", "2 × (2 × 4), stacked to 4 × 4"]], num_cols=(1,)),
             "<ul class='open'>" + "".join(f'<li>{tag(st)}<span><b>{E(t)}</b> — {E(d)}</span></li>' for t, d, st in F["what_uses"]) + "</ul>"))

ex_cols = [("ESPARGOS", "Univ. of Stuttgart", F["espargos_points"]), ("ESP-SDR", "raw IQ on ESP32s", F["espsdr_points"]),
           ("This project", "what is new", F["new_points"])]
sec("prior", "concept", "What exists, and what is new", V.fig_prior(Svg)
    + V.more("<div class='grid3'>" + "".join(
        f"<div><h3>{E(t)}</h3><ul class='open'>" + "".join(f"<li>{tag(st)}<span>{E(b)}</span></li>" for st, b in pts) + "</ul></div>"
        for t, _, pts in ex_cols) + "</div>"))

sec("chip", "concept", "Why the ESP32-C5", V.fig_bands(Svg)
    + """<div class="grid2"><figure><img src="img/patch_side.jpg" alt="Our 4 by 4 patch antenna board, radiating side" loading="lazy" width="731" height="820">
<figcaption>Our 5.2 GHz 4 × 4 patch board.</figcaption></figure>
<figure><img src="img/sma_side.jpg" alt="Back of the antenna board with one SMA connector per element" loading="lazy" width="785" height="820">
<figcaption>Back: one SMA per element.</figcaption></figure></div>"""
    + V.more(table(F["chips_rows"]), f"<p>{E(plain(F['chips_takeaway']))}</p>"))

clock_rows = [["Topic", "What we know"]] + [[t, b] for t, b, _ in F["clock_items"]]
sec("sync", "timing", "Four shared signals keep sixteen radios coherent", V.fig_domains(Svg)
    + V.stats([(E(v), k) for k, v in F["clock_numbers"]])
    + V.more(table(F["dom_rows"]), f"<p>{E(plain(F['dom_take']))}</p>", table([
        ["Error term", "Cause", "Shared clock", "Calibration tone", "Common trigger"],
        ["Carrier frequency offset", "independent crystals", "removes", "—", "—"],
        ["LO phase offset", "each PLL locks with an arbitrary phase", "—", "removes", "—"],
        ["Sampling-time offset", "independent sample clocks and starts", "partly", "removes (swept tone)", "partly"],
        ["Capture start misalignment", "firmware / interrupt latency", "—", "partly", "removes in a tile"],
        ["Fixed path mismatch", "cables, traces, switches", "—", "after the switch", "—"],
        ["Gain mismatch", "AGC state, LNA spread", "—", "if gain is fixed", "—"]]),
        "<h3>Sharing one 48 MHz reference</h3>", table(clock_rows),
        "<p class='note'>" + tag(F["clock_injection_status"]) + " Driving XTAL_P of every chip-down C5 from one buffered TCXO is the "
        "first clock bench test. The 108th harmonic of 48 MHz falls at 5184 MHz and the 130th of the 40 MHz PARLIO clock at 5200 MHz: "
        "series-terminate and slew-limit both clocks, keep them away from the RF lines, and if the spurs show use "
        "channel 44 (5210–5230 MHz), the only one of channels 36–48 clear of both clocks' harmonics.</p>"))

steps = ["Lock and fix gain: tune all C5s, disable AGC, set one manual gain index.",
         "Measure the reference: all SPDTs to CAL; step the tone across the capture band (as ESPARGOS One does), one synchronized snapshot per step.",
         "Estimate per element, relative to element 1: gain gₖ and phase φₖ, and delay τₖ from the phase slope across the tone steps.",
         "Measure the scene: all SPDTs to ANT, synchronized snapshots (source muted).",
         "Correct per FFT bin with Cₖ(f) = exp[−j(φₖ + 2πfτₖ)] / gₖ, then combine."]
sec("cal", "timing", "Calibration: one tone, five steps", svg_cal() + V.fig_calloop(Svg)
    + V.more("<ol class='steps'>" + "".join(f"<li>{E(x)}</li>" for x in steps) + "</ol>",
             "<p>Repeat after every reset, retune or sample-rate change. The tone cannot see anything before the switch: on the tile "
             "that is the patch, its probe via and a 1 mm line, the same for all eight elements, so calibrate it once over the air. "
             "That step also absorbs the tone's own distribution (splitter, cables, trees): repeat it when a calibration cable "
             "moves. Tile B is turned 180°, so its elements carry a fixed 180° term.</p>"))

sec("data", "data", "Sixteen receivers make a data problem", svg_bars()
    + "<div class='legend'><span><i class='blk' style='background:var(--card)'></i>what the array produces</span>"
      "<span><i class='blk' style='background:#c3ccd6'></i>what links and ports carry</span></div>"
    + V.more(ul(F["dataproblem_text"])))

sec("system", "data", "Two 8-element tiles and one timing board", svg_system()
    + V.more(ul(F["tile8_notes"])))

sec("bus", "data", "Eight 2-bit streams on one 16-bit bus", svg_bus()
    + "<ol class='flow'>" + "".join(f"<li>{E(x.split('   ', 1)[-1])}</li>" for x in F["map_sequence"]) + "</ol>"
    + V.more("<h3>Per-lane frame</h3>", table(F["map_frame_rows"], num_cols=(1,)), f"<p>{E(plain(F['map_note']))}</p>",
             f"<p class='note'>{E(F['map_source'])}</p>"))

m1, m2 = F["modes2_cols"]
sec("modes", "data", "Two data modes", V.fig_modes(Svg)
    + V.more("<div class='grid2'>" + "".join(
        f"<div><h3>{tag(st)} {E(t)}</h3><p>{E(lede)}</p>" + table([["Quantity", "Value"]] + rows, num_cols=(1,)) + ul(nts) + "</div>"
        for t, st, lede, rows, nts in (m1, m2)) + "</div>"))

sec("budget", "data", "Data rate, stage by stage (one tile)", V.logbars(Svg, [
    ("inside the 8 C5s, 80 MS/s", 10240, "need", "10.2 Gbit/s"),
    ("Gigabit Ethernet", 1000, "link", "1 Gbit/s"),
    ("PARLIO, 8 × 2 bit × 40 MHz", 640, "link", "640 Mbit/s"),
    ("Mode 1: 4 MS/s IQ8 × 8", 512, "need", "512 Mbit/s"),
    ("USB-Serial-JTAG (one C5 today)", 12, "link", "12 Mbit/s"),
    ("64 FFT bins per snapshot, 100/s", 1.64, "need", "1.6 Mbit/s")],
    "Per-tile data rates on a log scale, from the raw IQ inside the chips down to reduced FFT bins", lo=0, hi=5)
    + "<div class='legend'><span><i class='blk' style='background:var(--card)'></i>what the tile produces</span>"
      "<span><i class='blk' style='background:#c3ccd6'></i>what links and ports carry</span></div>"
    + V.more(table(F["budget_rows"], num_cols=(1, 2, 3)), f"<p>{E(plain(F['budget_takeaway']))}</p>",
             f"<p class='note'>{E(F['budget_source_line'])}</p>"))

sec("planb", "data", "Plan B: a small FPGA in front of the S31", V.fig_planb(Svg, F)
    + V.more("<div class='grid3'><div><h3>Switch to Plan B if</h3>" + ul(F["planb_when"]) + "</div>"
             "<div><h3>What the FPGA does</h3>" + ul(F["planb_fpga_items"]) + "</div>"
             "<div><h3>Cost and benefit</h3>" + ul(F["planb_cost"] + F["planb_adds"]) + "</div></div>",
             f"<p class='note'>{E(F['planb_source'])}</p>"))

sec("pcb", "board", "Tile PCB: seam and stack-up", svg_pcb() + V.fig_stack(Svg)
    + V.more("<div class='grid2'><div><h3>Rev 1 stack-up (custom 4-layer)</h3>", table([["Layer", "Use"]] + F["pcb_stack_rows"]),
             "<h3>Fab cost (team estimate)</h3>", table([["Item", "≈ USD"]] + F["pcb_cost_rows"], num_cols=(1,)),
             "</div><div><h3>The patch substrate</h3>", ul(F["pcb_patch_notes"]), "</div></div>",
             f"<p class='note'>{E(F['pcb_source'])}</p>"))

HERE = os.path.dirname(os.path.abspath(__file__))
M3_CSS = open(os.path.join(HERE, "tile3d.css"), encoding="utf-8").read()
M3_JS = open(os.path.join(HERE, "tile3d.js"), encoding="utf-8").read()
POSTER = os.path.join(OUT, "img", "tile3d-poster.jpg")
M3_LEGEND = [
    ("Patch block", "2 × 4, ≈ 17.5 × 13.5 mm, probe-fed; the only parts on the front."),
    ("RF switch", "SKY13351-class, 1 mm from the probe via."),
    ("8 × ESP32-C5", "each under its own patch; 3.5 mm RF path, equal for all eight."),
    ("Bundles", "PARLIO, control, clocks and 3.3 V from each C5."),
    ("ESP32-S31", "PARLIO RX, DMA, Gigabit MAC; enables the PCLK."),
    ("PHY and RJ45", "RGMII to 1 GbE: 640 Mbit/s out."),
    ("Calibration tree", "1:8 for the 5.2 GHz tone; every branch 90.6 mm."),
    ("Clock buffers", "48 MHz 1:8 and 40 MHz 1:10, point-to-point."),
    ("SMAs", "48 MHz, PCLK, trigger; the tone on the side."),
    ("Seam", "rows stay 28.8 mm apart; continuous ground joint."),
    ("Master board", "clocks, GO and the 5.2 GHz source (Array)."),
]
m3_has = os.path.exists(POSTER)
m3_poster = '<img class="m3-poster" src="img/tile3d-poster.jpg" width="1600" height="1000" alt="" decoding="async">' if m3_has else ""
m3_legend = "".join(f'<li data-k="{i + 1}"><button type="button" class="m3-legbtn" aria-pressed="false" disabled>{E(t)}</button>: {E(d)}</li>'
                    for i, (t, d) in enumerate(M3_LEGEND))
sec("tile3d", "board", "The tile in 3D", f"""
<div class="m3" id="m3">
<p class="cap">Front: only the patches. Back: every part, each C5 under its own patch. A Rev 1 concept, not a layout.</p>
<div class="toolbar m3-ctl" id="m3-ctl" hidden>
<div class="m3-grp"><span class="m3-lbl" id="m3-mode-l">Show</span>
<div class="seg" role="radiogroup" id="m3-mode" aria-labelledby="m3-mode-l">
<button type="button" role="radio" aria-checked="true" data-m3-mode="tile">One tile</button>
<button type="button" role="radio" aria-checked="false" data-m3-mode="array">Array</button></div></div>
<div class="m3-grp" id="m3-modx"><button type="button" class="btn sm" id="m3-exp" aria-pressed="false">Exploded layers</button></div>
</div>
<div class="m3-stage" id="m3-stage">
<div class="m3-ph {'m3-hasimg' if m3_has else 'm3-noimg'}" id="m3-ph">{m3_poster}
<p class="m3-msg" id="m3-msg" role="status" tabindex="-1">Interactive 3D model of one tile. It needs JavaScript; the drawings above show the same board.</p>
<button type="button" class="btn sm primary" id="m3-load" hidden>Load 3D view</button></div>
<p class="m3-cap" id="m3-cap" hidden></p>
</div>
<p class="m3-sr" id="m3-status" role="status"></p>
<div class="toolbar m3-ctl" id="m3-camrow" hidden>
<div class="m3-grp"><span class="m3-lbl" id="m3-cam-l">View</span>
<div class="seg" role="radiogroup" id="m3-cam" aria-labelledby="m3-cam-l">
<button type="button" role="radio" aria-checked="true" data-m3-cam="back">Back</button>
<button type="button" role="radio" aria-checked="false" data-m3-cam="front">Front</button>
<button type="button" role="radio" aria-checked="false" data-m3-cam="plan">Plan</button>
<button type="button" role="radio" aria-checked="false" data-m3-cam="seam">Seam</button></div></div>
<div class="m3-grp">
<button type="button" class="btn sm" id="m3-zout" aria-label="Zoom out">−</button>
<button type="button" class="btn sm" id="m3-zin" aria-label="Zoom in">+</button>
<button type="button" class="btn sm" id="m3-reset">Reset view</button>
<button type="button" class="btn sm" id="m3-lbls" aria-pressed="true">Labels</button>
<button type="button" class="btn sm" id="m3-cola" aria-pressed="false" title="330 ml can, 66 × 115 mm, for scale">Cola can for scale</button></div>
</div>
<p class="note" id="m3-hint" hidden>Drag to turn, Shift-drag to pan, Ctrl + scroll to zoom, double-click to reset; arrow keys, + and − work too.</p>
<ol class="m3-leg" id="m3-legend">{m3_legend}</ol>
</div>""")

# ---- 16 C5s on one board: the alternatives ----
ALT = __import__("content_alt16").ALT
sec("alt16", "board", "Sixteen C5s on one board?", "<p class='cap'>Five ways to put all sixteen C5s on one board with "
    "the same 1 GbE + USB (B–F), next to today's 2 × 8 plan (A). All of them use the master board for the clocks, GO "
    "and the 5.2 GHz tone.</p><div class='altgrid'>" + "".join(
    f"<figure class='alt'><figcaption><b>{E(o['key'])} · {E(o['name'])}</b>{tag(o['status'])}</figcaption>{V.fig_alt(Svg, o['key'])}"
    f"<p class='cap'>{E(o['line'])}</p></figure>" for o in ALT["options"])
    + f"<div class='verdict'><p>{ALT['verdict']}</p></div></div>"
    + "<h3>Side by side</h3>" + V.alt_matrix(ALT["matrix"], [o["key"] for o in ALT["options"]])
    + f"<p class='note'>●● better · ●○ middle · ○○ weaker. {E(ALT['matrix_note'])}</p>"
    + "<h3>One S31 controls sixteen C5s</h3>" + V.fig_control16(Svg, ALT["gpio_total"])
    + "<h3>Option B to scale</h3>" + V.fig_floor16(Svg)
    + V.more(*ALT["details"], "<h3>Other alternatives considered</h3>", table(F["alt_rows"]), f"<p class='note'>{E(F['alt_source'])}</p>"))

sec("power", "board", "Power and cost", "<p class='cap'>Power: the whole array at 3.3 V (16 C5s, 2 S31s with PHYs, "
    "clocks, master board). Cost: one tile, then the full prototype.</p>" + V.fig_power(Svg) + V.fig_cost(Svg)
    + V.more("<div class='grid2'><div><h3>3.3 V supply estimate</h3>", table(F["power_rows"], num_cols=(1, 2, 3)), ul(F["power_notes"]),
             "</div><div><h3>One tile (electronics)</h3>", table(F["cost_tile_rows"], num_cols=(1,)), "<h3>Full system</h3>",
             table(F["cost_sys_rows"], num_cols=(1,)), "</div></div>", ul(F["cost_notes"]), f"<p class='note'>{E(F['cost_source'])}</p>"))

sec("beam", "exp", "First experiment: receive beamforming", """
<div class="ctl-row"><label for="steer">Steering angle <b id="steerVal">30°</b></label>
<input id="steer" type="range" min="-60" max="60" step="1" value="30"><span>Δφ per element: <b id="dphi">−90.0°</b></span></div>
""" + svg_af() + """
<div class="legend"><span><i class="sw" style="border-color:var(--muted)"></i>broadside (0°)</span>
<span><i class="sw" style="border-color:var(--rf)"></i>steered</span></div>
""" + V.more("<div class='grid2'><div><h3>Experiment</h3>" + ul(F["bf_steps"]) + "</div><div><h3>Success criterion</h3>" + ul(F["bf_success"]) + "</div></div>"))

sec("radar", "exp", "Radar and communications experiments",
    V.cards([(r[0], r[1], "") for r in F["radar_rows"][1:]] + [(r[0], r[1], "") for r in F["comms_rows"][1:]], tag)
    + V.more(table(F["radar_rows"], status_first=True), ul(F["radar_after"][2]), "<h3>Communications</h3>",
             table(F["comms_rows"], status_first=True)))

sec("tx", "exp", "Transmit: steering is the easy part", V.fig_tx(Svg)
    + V.cards([(r[0], r[1], "") for r in F["tx_rows"][1:]], tag)
    + V.more(table(F["tx_rows"], status_first=True), "<div class='grid2'><div><h3>Phase step at λ/2</h3>",
             table(F["txs_rows"], num_cols=(0, 1)), "</div><div><h3>What is actually hard</h3>", ul(F["txs_hard"]),
             "<h3>Until then</h3>", ul(F["txs_fallback"]), "</div></div>", ul(F["tx_after"][2])))

sec("bench", "plan", "Bench tests that decide the design", V.fig_bench(Svg, F)
    + V.more(table(F["bench_rows"], status_first=True), f"<p class='note'>{E(F['bench_source'])}</p>"))

sec("steps", "plan", "Development sequence", V.fig_steps(Svg, F)
    + V.more("<div class='seq'>" + "".join(
        f"<div class='card'><div class='num'>{E(st['n'])}</div><h3>{E(st['title'])}</h3>{ul(st['goals'])}"
        f"<p class='gate'><b>Done when</b> {E(st['gate'])}</p></div>" for st in F["dev_steps"]) + "</div>"))

sec("risks", "plan", "Main risks, and the step that tests each", V.fig_risks(Svg, F)
    + V.more(table(F["risk_rows"]), f"<p class='note'>{E(F['risks_source_line'])}</p>"))

_rc, _rt = evidence_counts()
sec("evidence", "plan", "What we know, infer and must test", V.fig_evidence(Svg, *key_counts(), label="key design claims")
    + V.more(table(F["claims_rows"], status_first=True))
    + f"<p class='cap'>Behind them: the <a href='evidence.html'>evidence register</a>, {_rt} sourced claims "
      f"({_rc.get('C', 0)} confirmed, {_rc.get('I', 0)} inference, {_rc.get('O', 0)} open).</p>")

sec("success", "plan", "What success looks like", V.fig_success(Svg, F)
    + V.more("<div class='grid3'>" + "".join(
        f"<div><h3>{E(t)}</h3><p class='note'>{E(sub)}</p>{ul(items)}</div>" for t, sub, items in F["success_tiers"]) + "</div>"))

refs_html = "<ol class='refs'>" + "".join(
    f"<li>{E(t)} <a href='https://{E(u)}'>{E(u)}</a></li>" if not u.startswith("http") else f"<li>{E(t)} <a href='{E(u)}'>{E(u)}</a></li>"
    for t, u in REFS) + "</ol>"
sec("refs", "plan", "References", V.more(refs_html, label=f"{len(REFS)} references"))


PHASES = [("concept", "Concept", "card"), ("timing", "Synchronization", "clk"), ("data", "Data path", "rf"),
          ("board", "Board", "pwr"), ("exp", "Experiments", "ctl"), ("plan", "Plan and evidence", "warn")]

# ------------------------------------------------------------------ page
rail = ["<a class='brand' href='#top'>ESP32-C5 Phased Array</a>"]
n = 0
for ph, name, col in PHASES:
    rail.append(f"<div class='grp' style='--ph:var(--{col})'><div class='grp-h'>{E(name)}</div><ol>")
    for id_, p, title, _ in SECTIONS:
        if p == ph:
            n += 1
            rail.append(f"<li><a href='#{id_}'><span class='num'>{n:02d}</span>{E(title)}</a></li>")
    rail.append("</ol></div>")

body = []
n = 0
for id_, ph, title, inner in SECTIONS:
    n += 1
    col = dict((p, c) for p, _, c in PHASES)[ph]
    body.append(f"<section class='sheet' id='{id_}' style='--ph:var(--{col})'><div class='step'>{n:02d} · "
                f"{E(dict((p, nm) for p, nm, _ in PHASES)[ph])}</div><h2>{E(title)}</h2>{inner}</section>")

AF_JS = """
(function(){
  var s=document.getElementById('steer'), pl=document.getElementById('afSteer');
  if(!s||!pl) return;
  var x0=60,x1=700,y0=20,y1=290;
  function X(t){return x0+(t+90)/180*(x1-x0);} function Y(d){return y0+(0-d)/40*(y1-y0);}
  function draw(){
    var a=+s.value, sa=Math.sin(a*Math.PI/180), pts=[];
    for(var t=-90;t<=90;t+=1){
      var psi=Math.PI*(Math.sin(t*Math.PI/180)-sa), re=0, im=0;
      for(var m=0;m<4;m++){re+=Math.cos(m*psi); im+=Math.sin(m*psi);}
      var af=Math.sqrt(re*re+im*im)/4, db=Math.max(20*Math.log10(Math.max(af,1e-6)),-40);
      pts.push(X(t).toFixed(1)+','+Y(db).toFixed(1));
    }
    pl.setAttribute('points',pts.join(' '));
    document.getElementById('steerVal').textContent=a+'\\u00b0';
    document.getElementById('dphi').textContent=(-180*sa).toFixed(1).replace('-','\\u2212')+'\\u00b0';
  }
  s.addEventListener('input',draw); draw();
})();
(function(){
  var links=[].slice.call(document.querySelectorAll('#rail a[href^="#"]'));
  var map={}; links.forEach(function(a){map[a.getAttribute('href').slice(1)]=a;});
  if(!('IntersectionObserver' in window)) return;
  var io=new IntersectionObserver(function(es){
    es.forEach(function(e){ if(e.isIntersecting){
      links.forEach(function(a){a.removeAttribute('aria-current');});
      var a=map[e.target.id]; if(a){a.setAttribute('aria-current','step');}
    }});
  },{rootMargin:'-20% 0px -70% 0px'});
  document.querySelectorAll('section.sheet').forEach(function(s){io.observe(s);});
})();
"""

CSS = """
:root{color-scheme:light;--bg:#f3f5f8;--paper:#fff;--ink:#24313c;--muted:#5b6670;--line:#d8dee5;--zone:#f8fafc;
--rf:#d4652a;--rf-t:#fdf0e6;--clk:#12897d;--clk-t:#e2f4f1;--pwr:#c4475a;--pwr-t:#fbe8eb;--ctl:#5e55c4;--ctl-t:#eeedfb;
--card:#4570a6;--card-t:#e8eff8;--warn:#b26f12;--warn-t:#fdf2dc;
--ink2:#0e7268;--sans:"Figtree","Segoe UI",system-ui,sans-serif;--mono:"JetBrains Mono",ui-monospace,Consolas,monospace}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 var(--sans)}
a{color:var(--card)}
.layout{max-width:1460px;margin:0 auto}
@media(min-width:1100px){.layout{display:grid;grid-template-columns:250px minmax(0,1fr);gap:8px;align-items:start}
#rail{position:sticky;top:0;height:100vh;overflow-y:auto;padding:28px 10px 24px 20px}}
@media(max-width:1099.98px){#rail{display:none}}
#rail .brand{display:block;font:700 15px/1.2 var(--sans);color:var(--ink);text-decoration:none;margin-bottom:14px}
#rail .grp{margin-bottom:10px}
#rail .grp-h{font:600 11.5px/1 var(--sans);letter-spacing:.05em;text-transform:uppercase;color:color-mix(in srgb,var(--ph) 78%,#000);margin:8px 0 4px 2px}
#rail ol{list-style:none;margin:0;padding:0;display:grid;gap:1px}
#rail li a{display:grid;grid-template-columns:24px 1fr;gap:4px;padding:5px 8px;border-radius:8px;font-size:13.5px;line-height:1.3;
color:var(--ink);text-decoration:none;border-left:3px solid transparent}
#rail li a:hover{background:var(--paper)}
#rail li a[aria-current]{background:var(--paper);border-left-color:var(--ph);font-weight:600;box-shadow:0 1px 2px rgba(36,49,60,.06)}
#rail .num{font:600 11px/1.6 var(--mono);color:var(--muted)}
.wrap{min-width:0;padding:32px 20px 72px;display:grid;grid-template-columns:minmax(0,1fr);gap:28px}
header>*{min-width:0}
header{display:grid;gap:14px;padding:8px 0 4px}
.kicker{font:600 13px/1 var(--sans);color:#0e7268;letter-spacing:.02em}
h1{font:700 clamp(30px,5vw,44px)/1.1 var(--sans);margin:0;letter-spacing:-.01em;text-wrap:balance}
h2{font:700 24px/1.25 var(--sans);margin:0;text-wrap:balance}
h3{font:600 17px/1.3 var(--sans);margin:4px 0 2px}
p{margin:0;max-width:78ch}
.lede{font-size:17.5px;color:#44515c}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{font:600 13px/1 var(--sans);padding:8px 12px;border-radius:999px;background:var(--paper);border:1px solid var(--line)}
.chip b{color:#a94d1c}
.dl{display:flex;flex-wrap:wrap;gap:10px}
.dl a{display:inline-flex;align-items:center;gap:8px;font:600 14px/1 var(--sans);padding:10px 14px;border-radius:10px;
background:var(--paper);border:1px solid var(--line);text-decoration:none;color:var(--ink)}
.dl a:hover{border-color:var(--card)}
.dl a small{color:var(--muted);font-weight:500}
.toc{display:none}
@media(max-width:1099.98px){.toc{display:block;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:10px 14px}
.toc summary{font-weight:600;cursor:pointer}.toc ol{margin:8px 0 0;padding-left:22px;columns:2;column-gap:28px;font-size:14px}}
@media(max-width:560px){.toc ol{columns:1}}
section.sheet{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:24px;display:grid;gap:16px;min-width:0;
box-shadow:0 1px 2px rgba(36,49,60,.04);scroll-margin-top:16px}
.step{font:600 12.5px/1 var(--sans);color:color-mix(in srgb,var(--ph,var(--muted)) 78%,#000);letter-spacing:.04em;text-transform:uppercase}
.draw{overflow-x:auto;border-radius:10px;background:var(--zone);border:1px solid var(--line)}
.draw svg{display:block;width:100%;height:auto}
.legend{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13.5px;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:7px}
.sw{width:26px;height:0;border-top:3px solid;display:inline-block}.sw.d{border-top-style:dashed}
.blk{width:16px;height:12px;border-radius:2px;display:inline-block}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:24px}
.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px}
.grid2>*,.grid3>*{min-width:0;display:grid;gap:10px;align-content:start}
.tbl{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:14.5px}
th,td{text-align:left;padding:8px 14px 8px 0;border-bottom:1px solid var(--line);vertical-align:top}
th{font:600 12.5px/1.3 var(--sans);color:var(--muted)}
td.n{font-variant-numeric:tabular-nums;white-space:nowrap}
td.st,th.st{width:1%;white-space:nowrap}
ul{margin:0;padding-left:20px;display:grid;gap:6px}
ul.open{padding-left:0;list-style:none;gap:10px}
ul.open li{display:grid;grid-template-columns:96px 1fr;gap:12px;align-items:start}
.tag{font:700 11.5px/1.9 var(--sans);text-align:center;border-radius:999px;padding:0 10px;display:inline-block;white-space:nowrap;justify-self:start}
.t-c{color:#0e7268;background:var(--clk-t)}.t-i{color:#3d6596;background:var(--card-t)}
.t-o{color:#8f580c;background:var(--warn-t)}.t-s{color:#5b6670;background:#eef1f4}
.note{font-size:14px;color:var(--muted)}
ol.steps{margin:0;padding-left:22px;display:grid;gap:6px;max-width:90ch}
ol.refs{margin:0;padding-left:26px;display:grid;gap:6px;font-size:14px}
ol.refs a{word-break:break-all}
figure{margin:0;display:grid;gap:6px}
figure img{width:100%;height:auto;max-height:380px;object-fit:contain;background:var(--zone);border-radius:10px;border:1px solid var(--line)}
figcaption{font-size:13.5px;color:var(--muted)}
.seq{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}
.card{border:1px solid var(--line);border-radius:12px;padding:14px;display:grid;gap:8px;align-content:start;background:var(--zone)}
.card .num{font:700 13px/1 var(--mono);color:var(--card)}
.card ul{font-size:14px}
.gate{font-size:14px;border-top:1px solid var(--line);padding-top:8px}
.gate b{color:#8f580c;display:block;font-size:12.5px}
.ctl-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px 18px}
.ctl-row input{width:min(320px,100%)}
footer{font-size:13.5px;color:var(--muted);display:grid;gap:6px}
svg text{font-family:var(--sans);font-size:12px;fill:var(--ink)}
svg .b{font-weight:700;font-size:13px}svg .t{font-weight:700;font-size:14px}
svg .s{font-size:11.5px;fill:var(--muted)}svg .m{font-family:var(--mono)}
svg .mid{text-anchor:middle}svg .end{text-anchor:end}svg .wt{fill:#8f580c}
.box{fill:var(--paper);stroke:#c9d1da;stroke-width:1.2}
.frame{fill:var(--paper);stroke:#c9d1da;stroke-width:1.2}
.grp{fill:#f1f4f7;stroke:#c3ccd6;stroke-width:1.2;stroke-dasharray:7 4}
.zone{fill:var(--zone);stroke:#d3dae2;stroke-width:1;stroke-dasharray:6 4}
.zr{fill:var(--rf-t);stroke:var(--rf);stroke-width:1.3}.zc{fill:var(--clk-t);stroke:var(--clk);stroke-width:1.3}
.zk{fill:var(--card-t);stroke:var(--card);stroke-width:1.3}.zv{fill:var(--ctl-t);stroke:var(--ctl);stroke-width:1.3}
.zw{fill:var(--warn-t);stroke:var(--warn);stroke-width:1.2}
.dk{fill:var(--ink)}
.wire,.data{stroke:var(--ink);fill:none}.wire{stroke-width:1.3}.data{stroke-width:2.2}
.rf{stroke:var(--rf);stroke-width:2.4;fill:none}.rft{stroke:var(--rf);stroke-width:1.4;fill:none}
.rfc{stroke:var(--rf);stroke-width:1.8;fill:none;stroke-dasharray:6 3}
.clk{stroke:var(--clk);stroke-width:1.8;fill:none}.pclk{stroke:var(--card);stroke-width:1.8;fill:none}
.ctl{stroke:var(--ctl);stroke-width:1.5;fill:none;stroke-dasharray:5 3}
.pwr{stroke:var(--pwr);stroke-width:1.6;fill:none}
.bar-need{fill:var(--card)}.bar-link{fill:#c3ccd6}
.af0{stroke:var(--muted);stroke-width:1.6;fill:none}.af1{stroke:var(--rf);stroke-width:2.2;fill:none}
.cap{font-size:15px;color:#44515c;max-width:80ch}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.stat{background:var(--zone);border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:grid;gap:2px;align-content:start}
.stat b{font:700 21px/1.2 var(--sans);color:color-mix(in srgb,var(--ph,var(--card)) 80%,#000)}
.stat span{font-size:13px;line-height:1.35;color:var(--muted)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}
.crd{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--zone);display:grid;gap:6px;align-content:start}
.crd b{font-size:15px;line-height:1.3}.crd span{font-size:13.5px;line-height:1.45;color:var(--muted)}
.uses{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
.use{border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:grid;gap:4px;justify-items:start;align-content:start;background:var(--zone)}
.use svg{width:40px;height:40px}.use b{font-size:15px}.use span{font-size:13.5px;line-height:1.4;color:var(--muted)}
.ic{stroke:var(--ink);stroke-width:2;fill:none;stroke-linecap:round}.ic2{stroke:var(--rf);stroke-width:2;fill:none;stroke-linecap:round}
.pc{border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--zone)}
.pc ul.open li{grid-template-columns:96px 1fr;font-size:14px}
details.more{border-top:1px solid var(--line);padding-top:10px}
details.more>summary{cursor:pointer;font:600 14px/1.5 var(--sans);color:var(--card);list-style:none;display:inline-flex;gap:8px;align-items:center;
border-radius:8px;padding:2px 6px 2px 0}
details.more>summary::-webkit-details-marker{display:none}
details.more>summary::before{content:"+";display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;
background:var(--card-t);color:var(--card);font:700 14px/1 var(--mono)}
details.more[open]>summary::before{content:"\2212"}
details.more>summary:focus-visible{outline:2px solid var(--card);outline-offset:2px}
.more-b{display:grid;gap:14px;margin-top:12px}
.dot-full{fill:var(--clk)}.dot-half{fill:var(--clk-t);stroke:var(--clk);stroke-width:2}.dot-none{fill:#c3ccd6}
.stepdot{fill:var(--card-t);stroke:var(--card);stroke-width:2}
ol.flow{list-style:none;counter-reset:f;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px}
ol.flow li{counter-increment:f;background:var(--zone);border:1px solid var(--line);border-radius:999px;padding:5px 12px 5px 5px;
font-size:13.5px;line-height:1.35;display:inline-flex;gap:8px;align-items:center}
ol.flow li::before{content:counter(f);flex:none;font:700 12px/22px var(--mono);width:22px;height:22px;border-radius:50%;background:var(--card);color:#fff;text-align:center}
.altgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:14px}
figure.alt{border:1px solid var(--line);border-radius:12px;padding:12px;gap:8px;align-content:start}
figure.alt figcaption{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px;color:var(--ink);font-size:14.5px}
figure.alt .cap{font-size:13.5px}
table.heat{font-size:13.5px}table.heat td,table.heat th{padding:7px 10px}
table.heat thead th{text-align:center}table.heat td{text-align:center;border:0;border-radius:6px}
table.heat th[scope=row]{color:var(--ink);font-size:13px;white-space:nowrap}
td.g2{background:var(--clk-t);color:#0b5c54}td.g1{background:var(--warn-t);color:#7a4b0a}td.g0{background:var(--pwr-t);color:#9a3043}
.mk-o{fill:var(--warn-t);stroke:var(--warn);stroke-width:2}.mk-i{fill:var(--card-t);stroke:var(--card);stroke-width:2}
.mk-c{fill:var(--clk-t);stroke:var(--clk);stroke-width:2}.mk-s{fill:#eef1f4;stroke:var(--muted);stroke-width:2}
svg .mk{font-size:12px}
figure.alt svg .s{font-size:13px}figure.alt svg .b{font-size:14.5px}
.verdict{border-left:4px solid var(--clk);background:var(--clk-t);padding:14px 18px;border-radius:0 12px 12px 0;font-size:15px;
line-height:1.55;align-self:stretch;display:grid;align-content:center}
.verdict p{max-width:none}.verdict b{color:#0b5c54}.altgrid .verdict{grid-column:1/-1}
table.heat{border-collapse:separate;border-spacing:3px}table.heat th{border-bottom:0}
.gm{font-size:10px;letter-spacing:-1px;opacity:.75}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media(max-width:560px){section.sheet{padding:16px}ul.open li{grid-template-columns:1fr;gap:2px}.wrap{padding:20px 12px 56px}.dl a{flex:1 1 100%}}
"""

toc = "<details class='toc'><summary>Sections</summary><ol>" + "".join(
    f"<li><a href='#{i}'>{E(t)}</a></li>" for i, _, t, _ in SECTIONS) + "</ol></details>"

header = f"""<header id="top">
<div class="kicker">Student project proposal · Technion · October 2026</div>
<h1>ESP32-C5 Phased Array</h1>
<p class="lede">A low-cost 16-element 5.2 GHz digital phased-array research platform built from ESP32-C5 radios, inspired by
ESPARGOS and ESP-SDR. The hard problems are synchronization, calibration and getting raw IQ out of the C5 — not the
beamforming maths.</p>
<div class="chips"><span class="chip"><b>16</b> × ESP32-C5</span><span class="chip"><b>5.2</b> GHz, λ/2 = 28.8 mm</span>
<span class="chip"><b>2</b> tiles of 8</span><span class="chip">8 × 2-bit PARLIO → <b>ESP32-S31</b> → 1 GbE</span>
<span class="chip">hardware target <b>≈ $220–300</b></span></div>
<div class="dl"><a href="deck/esp32_c5_phased_array_2x8_tiles.pdf">Slides (PDF) <small>37 pages</small></a>
<a href="deck/esp32_c5_phased_array_2x8_tiles.pptx">Slides (PowerPoint) <small>with speaker notes</small></a>
<a href="evidence.html">Evidence register <small>researched claims + sources</small></a>
<a href="https://github.com/seguar/seguar.github.io/tree/main/esp32-c5-phased-array/deck-src">Deck generator <small>Python source</small></a></div>
<div class="legend"><span>{tag('C')} stated or shown in a primary source (often on other ESP32 hardware, not yet the C5)</span><span>{tag('I')} engineering inference</span>
<span>{tag('O')} needs a bench test</span><span>{tag('S')} no evidence yet</span></div>
{toc}
</header>"""

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ESP32-C5 Phased Array</title>
<meta name="description" content="Design walkthrough for a 16-element 5.2 GHz phased-array research platform built from ESP32-C5 radios: two 8-element tiles, PARLIO aggregation into an ESP32-S31, synchronization, calibration and data path.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%F0%9F%93%A1%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap">
<style>{CSS}{M3_CSS}</style>
</head>
<body>
{MARKERS}
<div class="layout">
<nav id="rail" aria-label="Sections">{"".join(rail)}</nav>
<main class="wrap">
{header}
{"".join(body)}
<footer><p>Research claims are sourced in the <a href="evidence.html">evidence register</a>; part choices are candidates
to check against datasheets, and costs are the team's estimates. Research checked 12–16 October 2026.</p>
<p><a href="../">seguar.github.io</a></p></footer>
</main>
</div>
<script>{AF_JS}</script>
<script>{M3_JS}</script>
</body>
</html>
"""
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(page)
print("index.html", len(page))

# ------------------------------------------------------------------ evidence page
import re as _re

FIXES = [   # research-tool remarks and inconsistencies -> publishable text
    (r"Option A: UART bus from S31 \(cheapest\)", "UART bus from the S31 (cheapest)"),
    (r"Option B: USB hub tree to PC", "USB hub tree to the PC"),
    (r"Option A: 16 RX x 1-bit", "main-page option B: 16 RX x 1-bit"),
    (r"Option B: 8 TX \+ 8 RX", "main-page option C: 8 TX + 8 RX"),
    (r"Option A's 40 Mbit/s per element", "the 1-bit 16-RX option's 40 Mbit/s per element (option B on the main page)"),
    (r", so TX and RX run at the same time\.", ". Whether 16-bit RX and 16-bit TX run together at 40 MHz is untested."),
    (r" The extracted datasheet table was garbled: 'pull GPIO28 low for download' is an inference, so verify the exact levels in the PDF\.",
     " Download mode needs GPIO28 low and GPIO27 high at reset (Table 3-3; see the control topic)."),
    (r"I could not fetch the ESP32-C5 Technical Reference Manual: the PDF is over the 10 MB WebFetch limit, and I did not bulk-download it without permission\. ", ""),
    (r"Could not be fetched by WebFetch due to size limit; details pending", "not reviewed in this topic; the PARLIO chapter was checked later (see the PARLIO topic)"),
    (r"WebFetch returned only the page title", "product selector page; content not retrievable"),
    (r" ?\(fetched via WebFetch summary\)", ""),
    (r"Fetch failed \(bot challenge\)", "forum page not retrievable"),
    (r"I could not verify it because esp32\.com showed a bot challenge", "it could not be verified (forum page not retrievable)"),
    (r"The esp32\.com thread was behind a bot challenge", "The forum thread could not be retrieved"),
    (r"sharing one 40 MHz reference", "sharing one 48 MHz reference"),
    (r"The 2025 hardware paper", "The ESPARGOS hardware paper (WSA & SCC 2023; arXiv 2025)"),
    (r"EuRAD 2020 \(published 2021\)", "EuRAD 2020 (held January 2021)"),
    (r"Yildirim et al\. \(EuRAD 2020\)", "Yildirim et al. (EuRAD 2020, held January 2021)"),
]
URLS = [
    (r"https://punchouttest\.digikey\.[a-z.]+/[a-z]{2}/products/", "https://www.digikey.com/en/products/"),
    (r"https://api\.crossref\.org/works/", "https://doi.org/"),
]


def fix(t):
    for a, b in FIXES:
        t = _re.sub(a, b, t)
    return t


def fix_url(u):
    for a, b in URLS:
        u = _re.sub(a, b, u)
    return u


SHORT = [("Espressif chip family", "Espressif chip family and 5 GHz support"),
         ("ESP32-C5 RF, power", "ESP32-C5 RF, power, memory and interfaces"),
         ("ESP-SDR", "ESP-SDR capabilities and limits"),
         ("ESPARGOS: phase coherence", "ESPARGOS synchronization and combined arrays"),
         ("Wi-Fi sensing", "Wi-Fi sensing, passive radar and 5 GHz regulation"),
         ("ESP32-C5 clocking", "ESP32-C5 clocking and an external 48 MHz reference"),
         ("ESP32-C5 PARLIO", "ESP32-C5 PARLIO TX and the IQ buffer path"),
         ("Espressif chips with both", "ESP32 chips with Ethernet; ESP32-S31 IQ streaming"),
         ("ESPARGOS One as an existing", "ESPARGOS One as an 8-element tile (2.4 GHz variant)"),
         ("Engineering trade-offs", "2.4 GHz versus 5.2 GHz (2.4 GHz variant)"),
         ("Ethernet switching", "Ethernet switches for an 8-element tile (2.4 GHz variant)"),
         ("16-C5 board: control", "One board, 16 C5s: control and flashing from one S31"),
         ("16-C5 board: ESP32-S31", "One board, 16 C5s: ESP32-S31 and ESP32-P4 resources"),
         ("16-C5 board: data", "One board, 16 C5s: rates on one GbE, FPGA and switch options")]


if RESEARCH:
    files = sorted(glob.glob(os.path.join(RESEARCH, "research_*.json")))
    order = [k for k, _ in SHORT]

    def rank(p):
        t = json.load(open(p, encoding="utf-8"))["result"]["topic"]
        return next((i for i, k in enumerate(order) if t.startswith(k)), 99)
    files.sort(key=rank)
    blocks, nav, total = [], [], 0
    for i, p in enumerate(files):
        r = json.load(open(p, encoding="utf-8"))["result"]
        short = next((v for k, v in SHORT if r["topic"].startswith(k)), r["topic"][:60])
        rows = []
        for c in r["claims"]:
            total += 1
            st = {"CONFIRMED": "C", "INFERRED": "I", "UNKNOWN": "O"}[c["status"]]
            val = f" <b>{E(fix(c['value']))}</b>" if c.get("value") else ""
            raw = fix_url(c["source_url"])
            m = _re.search(r"https?://\S+", raw)
            notes = [fix(c["source_detail"])] if c.get("source_detail") else []
            if m:
                url = m.group(0).rstrip(".,;")
                rest = (raw[:m.start()] + raw[m.end():]).strip()
                if rest:
                    notes.insert(0, rest)
                cell = f"<a href='{E(url)}'>{E(url)}</a>"
            else:
                cell = E(raw)
            det = f" <span class='note'>({E(' / '.join(notes))})</span>" if notes else ""
            rows.append(f"<tr><td class='st'>{tag(st)}</td><td>{E(fix(c['claim']))}{val}</td><td>{cell}{det}</td></tr>")
        oq = "".join(f"<li>{E(fix(q))}</li>" for q in r["open_questions"] if fix(q).strip())
        nav.append(f"<li><a href='#t{i}'>{E(short)}</a> <span class='note'>({len(r['claims'])})</span></li>")
        blocks.append(f"<section class='sheet' id='t{i}'><h2>{E(short)}</h2><p class='note'>{E(fix(r['topic']))}</p>"
                      f"<div class='tbl'><table><thead><tr><th class='st'>Status</th>"
                      f"<th>Claim</th><th>Source</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>"
                      + (f"<h3>Open questions</h3><ul>{oq}</ul>" if oq else "") + "</section>")
    hand_rows = "".join(f"<tr><td class='st'>{tag(st)}</td><td>{E(c)}</td><td><a href='{E(u)}'>{E(u)}</a></td></tr>"
                        for st, c, u in HAND)
    blocks.append("<section class='sheet' id='parts'><h2>Parts and estimates checked by hand</h2>"
                  "<p class='note'>Checked on 13 October 2026 against the vendor or fab page given.</p>"
                  "<div class='tbl'><table><thead><tr><th class='st'>Status</th><th>Claim</th><th>Source</th></tr></thead>"
                  f"<tbody>{hand_rows}</tbody></table></div></section>")
    nav.append(f"<li><a href='#parts'>Parts and estimates checked by hand</a> <span class='note'>({len(HAND)})</span></li>")
    total += len(HAND)
    ev = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evidence register — ESP32-C5 Phased Array</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap">
<style>{CSS} td a{{word-break:break-all}} .wrap{{max-width:1180px;margin:0 auto}} ol.topics{{margin:0;padding-left:22px;display:grid;gap:4px}}</style></head><body><main class="wrap">
<header><div class="kicker"><a href="./">← ESP32-C5 Phased Array</a></div><h1>Evidence register</h1>
<p class="lede">{total} claims collected from datasheets, source code, papers and other cited sources on 12–16 October
2026, grouped by topic.</p>
<div class="legend"><span>{tag('C')} stated or shown in the cited source</span><span>{tag('I')} engineering inference</span>
<span>{tag('O')} not found, or needs a bench test</span><span>{tag('S')} used on the main page: no evidence yet</span></div>
<p class="note">An independent re-check ran for the ESP32-S31 Ethernet and ESPARGOS-One-as-a-tile topics; the most
load-bearing claims of the others were re-checked by hand (ESP-SDR IQ_WORDS = 16,380 and its transports, the C5 hardware
design guideline clock section, ESP-Hosted SDIO throughput, the ESPARGOS One sensor chip, and the parts listed at the end).
Everything else is sourced but single-checked. Topics marked “2.4 GHz variant” document an alternative that was considered
and not chosen.</p>
<ol class="topics">{''.join(nav)}</ol></header>
{''.join(blocks)}
</main></body></html>"""
    open(os.path.join(OUT, "evidence.html"), "w", encoding="utf-8").write(ev)
    print("evidence.html", len(ev), "claims", total)
