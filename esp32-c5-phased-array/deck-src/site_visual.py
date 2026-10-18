"""Picture-first figures and small HTML blocks for the walkthrough page (imported by site_build.py).

Each figure is an inline SVG built with site_build's Svg mini-kit, passed in as `Svg`. Text stays inside the pictures; long
tables move into collapsed <details> blocks.
"""
import math
import html as H

E = H.escape


def more(*parts, label="Details"):
    return (f'<details class="more"><summary>{E(label)}</summary><div class="more-b">' + "".join(parts) + "</div></details>")


def cap(s):
    return f'<p class="cap">{s}</p>'


def stats(items):
    return '<div class="stats">' + "".join(f'<div class="stat"><b>{v}</b><span>{E(k)}</span></div>' for v, k in items) + "</div>"


def cards(items, tag, cls=""):
    out = []
    for st, t, sub in items:
        out.append(f'<div class="crd">{tag(st) if st else ""}<b>{E(t)}</b>' + (f"<span>{E(sub)}</span>" if sub else "") + "</div>")
    return f'<div class="cards {cls}">' + "".join(out) + "</div>"


# ------------------------------------------------------------------ concept
ICONS = {
    "beam": '<path d="M6 34h28M10 34v-6M17 34v-6M24 34v-6M31 34v-6" class="ic"/><path d="M20 26 L8 6 M20 26 L32 6 M20 26 L20 4" class="ic2"/>',
    "sense": '<circle cx="20" cy="20" r="4" class="ic"/><path d="M11 11a13 13 0 0 0 0 18M29 11a13 13 0 0 1 0 18M6 6a20 20 0 0 0 0 28M34 6a20 20 0 0 1 0 28" class="ic2"/>',
    "sound": '<path d="M4 30 L12 14 L20 24 L28 8 L36 18" class="ic2"/><path d="M4 34h32" class="ic"/>',
    "tx": '<path d="M20 34V14" class="ic"/><path d="M14 8a8 8 0 0 1 12 0M10 4a14 14 0 0 1 20 0" class="ic2"/><circle cx="20" cy="12" r="3" class="ic"/>',
}


def uses_html(F, tag):
    keys = ["beam", "sense", "sound", "tx"]
    out = []
    for (t, d, st), k in zip(F["what_uses"], keys):
        short = d.split(" (")[0].split(",")[0]
        out.append(f'<div class="use"><svg viewBox="0 0 40 40" aria-hidden="true">{ICONS[k]}</svg><b>{E(t)}</b>'
                   f'<span>{E(short)}</span>{tag(st)}</div>')
    return '<div class="uses">' + "".join(out) + "</div>"


def fig_bands(Svg):
    rows = [("ESP32-C5", "y", "Wi-Fi 6, separate 5 GHz pin"), ("ESP32-S31", "n", "Wi-Fi 6, Gigabit MAC"),
            ("ESP32-C6 / C61", "n", "C61: ESPARGOS One sensor"), ("ESP32, S2, S3", "n", ""), ("ESP32-C2, C3", "n", ""),
            ("ESP32-H2", "x", "no Wi-Fi")]
    h = 70 + 46 * len(rows)
    s = Svg(960, h, "Band chart: every listed Espressif chip covers 2.4 GHz Wi-Fi except the H2, and only the ESP32-C5 reaches 5 GHz", 640)
    x24, w24, x5, w5 = 300, 120, 470, 300
    s.t(x24 + w24 / 2, 30, "2.4 GHz", "b", "m")
    s.t(x5 + w5 / 2, 30, "5 GHz (5180–5885 MHz)", "b", "m")
    xm = x5 + (5200 - 5180) / (5885 - 5180) * w5
    s.raw(f'<line x1="{xm}" y1="40" x2="{xm}" y2="{h - 18}" class="rfc"/>')
    s.t(xm + 6, h - 6, "5.2 GHz: our band", "s wt")
    for i, (name, five, note) in enumerate(rows):
        y = 48 + 46 * i
        s.t(20, y + 21, name, "b" if five == "y" else "")
        if five != "x":
            s.box(x24, y + 6, w24, 22, "zc", 4)
        if five == "y":
            s.box(x5, y + 6, w5, 22, "zr", 4)
        elif five == "n":
            s.raw(f'<rect x="{x5}" y="{y + 6}" width="{w5}" height="22" rx="4" class="zone"/>')
        if note:
            s.t(x5 + w5 + 14, y + 21, note, "s")
    return s.render()


# ------------------------------------------------------------------ synchronization
def fig_domains(Svg):
    s = Svg(1100, 336, "Four shared signals keep the C5s coherent; Ethernet and PTP only coordinate", 780)
    s.label(20, 40, 170, 250, "Master board", ["TCXO, PCLK, GO,", "5.2 GHz source"], "grp", "b")
    rows = [("clk", "48 MHz reference", "one frequency for every LO", (2, 0, 1, 0, 0, 0)),
            ("pclk", "40 MHz PCLK", "one bit clock for every lane: aligns lanes, not samples", (0, 0, 0, 0, 0, 0)),
            ("ctl", "GO (PCLK enable)", "one start in a tile", (0, 0, 1, 2, 0, 0)),
            ("rfc", "5.2 GHz tone", "measures phase, delay, gain (gain if fixed)", (0, 2, 2, 1, 1, 1))]
    cols = ["frequency", "LO phase", "sample time", "start", "path", "gain"]
    xm = 728
    for j, c in enumerate(cols):
        s.t(xm + 40 + j * 62, 30, c, "s", "m")
    for i, (cls, name, what, dots) in enumerate(rows):
        y = 70 + i * 62
        s.ln(190, y, 600, y, cls)
        s.t(205, y - 10, name, "b")
        s.t(205, y + 20, what, "s")
        for j, d in enumerate(dots):
            cx = xm + 40 + j * 62
            if d == 2:
                s.raw(f'<circle cx="{cx}" cy="{y}" r="9" class="dot-full"/>')
            elif d == 1:
                s.raw(f'<circle cx="{cx}" cy="{y}" r="9" class="dot-half"/>')
            else:
                s.raw(f'<circle cx="{cx}" cy="{y}" r="3" class="dot-none"/>')
    s.label(602, 44, 116, 196, "16 × C5", ["+ 2 × S31"], "zr", "b")
    y = 318
    s.raw(f'<line x1="190" y1="{y}" x2="600" y2="{y}" class="wire" stroke-dasharray="4 4"/>')
    s.t(205, y - 8, "Ethernet / PTP: timestamps and coordination only, never sample alignment", "s")
    s.raw(f'<circle cx="{xm + 30}" cy="{y - 4}" r="8" class="dot-full"/>')
    s.t(xm + 46, y, "removes", "s")
    s.raw(f'<circle cx="{xm + 140}" cy="{y - 4}" r="8" class="dot-half"/>')
    s.t(xm + 156, y, "partly", "s")
    return s.render()


def fig_calloop(Svg):
    s = Svg(980, 330, "Calibration loop: five steps around an ellipse, repeated after every reset, retune or rate change", 640)
    cx, cy, rx, ry = 490, 172, 300, 138
    steps = [("1  Lock, fix gain", "AGC off, one gain index"), ("2  Tone on, sweep", "all switches to CAL"),
             ("3  Fit gₖ, φₖ, τₖ", "relative to element 1"), ("4  Antennas, capture", "tone muted"),
             ("5  Correct, combine", "per FFT bin")]
    pts = [(cx + rx * math.cos(math.radians(-90 + i * 72)), cy + ry * math.sin(math.radians(-90 + i * 72))) for i in range(5)]
    for i in range(5):
        (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % 5]
        s.ln(x1 + (x2 - x1) * 0.34, y1 + (y2 - y1) * 0.34, x1 + (x2 - x1) * 0.66, y1 + (y2 - y1) * 0.66, "rfc")
    for (x, y), (t, sub) in zip(pts, steps):
        s.label(x - 95, y - 26, 190, 52, t, sub, "zr", "b")
    s.t(cx, cy + 4, "repeat after every", "s", "m")
    s.t(cx, cy + 22, "reset, retune or rate change", "s", "m")
    return s.render()


# ------------------------------------------------------------------ data path
def logbars(Svg, items, label, lo=0, hi=5, unit="Mbit/s", marker=None):
    w, h = 980, 40 + 34 * len(items) + 50
    s = Svg(w, h, label, 700)
    x0, x1 = 300, 900

    def X(v):
        return x0 + (math.log10(max(v, 10 ** lo)) - lo) / (hi - lo) * (x1 - x0)
    for dec in range(lo, hi + 1):
        xx = X(10 ** dec)
        s.raw(f'<line x1="{xx}" y1="20" x2="{xx}" y2="{h - 40}" stroke="var(--line)"/>')
        s.t(xx, h - 22, f"{10 ** dec:g}", "s", "m")
    s.t((x0 + x1) / 2, h - 4, f"{unit} (log scale)", "s", "m")
    if marker:
        xx = X(marker[0])
        s.raw(f'<line x1="{xx}" y1="14" x2="{xx}" y2="{h - 40}" class="ctl"/>')
        s.t(xx + 4, 14, marker[1], "s wt")
    for i, (lab, v, kind, txt) in enumerate(items):
        yy = 28 + 34 * i
        s.t(x0 - 10, yy + 16, lab, "s", "e")
        s.raw(f'<rect x="{x0}" y="{yy}" width="{X(v) - x0:.1f}" height="22" rx="3" class="{"bar-need" if kind == "need" else "bar-link"}"/>')
        s.t(X(v) + 6, yy + 16, txt, "s")
    return s.render()


def fig_modes(Svg):
    s = Svg(1000, 260, "Two data modes on a time line: continuous narrow-band streaming, or full-rate snapshots then a drain", 700)
    s.t(20, 52, "Mode 1", "t")
    s.t(20, 70, "continuous", "s")
    s.box(160, 34, 800, 40, "zk", 6)
    s.t(560, 59, "4 MS/s IQ8 per element · 64 Mbit/s · 512 Mbit/s per tile", "b", "m")
    s.t(160, 94, "open: the C5 has no continuous capture yet", "s wt")
    s.t(20, 158, "Mode 2", "t")
    s.t(20, 176, "snapshots", "s")
    x = 160
    for k in range(3):
        s.box(x, 140, 18, 40, "zr", 3)
        s.box(x + 22, 140, 230, 40, "box", 6)
        s.t(x + 137, 165, "drain 3.3 ms over PARLIO", "s", "m")
        x += 266
    s.t(160, 204, "▲ 16,380 samples at 80 MS/s = 205 µs", "s")
    s.t(160, 222, "≤ 287 snapshots per second, all elements at once (not to scale)", "s")
    return s.render()


def fig_planb(Svg, F):
    s = Svg(1000, 250, "Plan B: a small FPGA takes the eight lanes, aligns and reduces them, then hands them to the S31", 700)
    for k in range(4):
        s.box(20 + k * 6, 40 + k * 6, 120, 140, "zr", 6)
    s.t(110, 120, "8 × C5", "b", "m")
    s.ln(170, 120, 268, 120, "data")
    s.t(220, 110, "8 lanes", "s", "m")
    s.label(270, 40, 260, 160, "FPGA", ["per-lane FIFOs", "align, timestamp", "decimate / FFT", "later: beamform"], "zv")
    s.ln(530, 120, 618, 120, "data")
    s.label(620, 80, 140, 80, "S31 or PHY", None, "zk")
    s.ln(760, 120, 820, 120, "data")
    s.t(826, 124, "1 GbE", "b")
    s.t(20, 228, "Switch to it if: " + " · ".join(F["planb_when"]), "s wt")
    return s.render()


# ------------------------------------------------------------------ board
def fig_stack(Svg):
    s = Svg(1000, 300, "Stack-up drawing: patches on L1 over a 1.065 mm core, L2 ground, L3 ground and clocks, every part on L4 at the back", 700)
    x0, x1 = 60, 600
    layers = [("L1", "copper", 8, "patches only (the front)"), ("1.065 mm core", "fr4", 70, "the patch substrate"),
              ("L2", "copper", 8, "solid ground: the patch ground"), ("0.21 mm prepreg", "fr4", 30, ""),
              ("L3", "copper", 8, "ground, clock lines, 3.3 V spine"), ("0.2 mm core", "fr4", 30, ""),
              ("L4", "copper", 8, "every part, RF and data lines")]
    y = 50
    ys = {}
    for name, kind, t, note in layers:
        fill = {"copper": "#b8763f", "fr4": "#e3d9ad"}[kind]
        if name == "L1":
            s.raw(f'<rect x="{x0 + 110}" y="{y}" width="150" height="{t}" fill="#d6ab4f"/>')
            s.raw(f'<rect x="{x0 + 370}" y="{y}" width="150" height="{t}" fill="#d6ab4f"/>')
        else:
            s.raw(f'<rect x="{x0}" y="{y}" width="{x1 - x0}" height="{t}" fill="{fill}"/>')
        ys[name] = (y, t)
        yc = y + t / 2 + 4
        s.raw(f'<line x1="{x1 + 4}" y1="{yc - 4}" x2="{x1 + 22}" y2="{yc - 4}" stroke="var(--line)"/>')
        s.t(x1 + 28, yc, name, "b" if kind == "copper" else "s")
        if note:
            s.t(x1 + 150, yc, note, "s")
        y += t
    yb = y
    s.raw(f'<rect x="{x0 + 110}" y="{yb}" width="70" height="14" fill="#1f2326"/>')
    s.t(x0 + 145, yb + 32, "C5", "s", "m")
    s.raw(f'<rect x="{x0 + 200}" y="{yb}" width="22" height="10" fill="#1f2326"/>')
    s.t(x0 + 211, yb + 28, "SPDT", "s", "m")
    xv = x0 + 240
    for L in ("L2", "L3"):
        s.raw(f'<rect x="{xv - 8}" y="{ys[L][0]}" width="16" height="{ys[L][1]}" fill="#e3d9ad"/>')
    s.raw(f'<rect x="{xv - 3}" y="{ys["L1"][0]}" width="6" height="{yb - ys["L1"][0]}" fill="#8c5a2b"/>')
    s.t(xv + 10, ys["1.065 mm core"][0] + 30, "probe via to the patch", "s")
    xb = x0 + 470
    s.raw(f'<rect x="{xb - 3}" y="{ys["L3"][0]}" width="6" height="{yb - ys["L3"][0]}" fill="#8c5a2b"/>')
    s.t(xb, yb + 26, "blind via, L4 to L3", "s", "m")
    s.t(x0, 36, "front (antennas) ↑", "s")
    s.t(x0, yb + 52, "back (parts) ↓ · thin layers drawn thicker", "s")
    return s.render()


def fig_cost(Svg):
    tile = [("8 × C5", 40, "zr"), ("S31", 7.5, "zk"), ("PHY", 1.4, "box"), ("MagJack", 2.5, "box"), ("clocks", 7.5, "zc"),
            ("8 × SPDT", 5, "zr"), ("power", 3, "zw"), ("misc", 4, "zone")]
    system = [("2 tiles", 150, "zr"), ("master", 17.5, "zv"), ("PCBs, assembly, shipping", 90, "zone")]
    s = Svg(1000, 230, "Stacked cost bars: one tile about 70 to 80 dollars of electronics; the full prototype about 220 to 300 dollars", 700)
    x0, k = 170, 2.8

    def bar(y, items, scale, total):
        x, rest = x0, []
        for name, v, cls in items:
            w = v * scale
            s.box(x, y, w, 34, cls, 3)
            if w > 6.0 * len(name) + 8:
                s.t(x + w / 2, y + 22, name, "s", "m")
            else:
                rest.append(name)
            x += w
        s.t(x + 10, y + 22, total, "b")
        if rest:
            s.t(x0, y + 52, "small, left to right: " + ", ".join(rest), "s")
    s.t(20, 62, "One tile", "b")
    bar(40, tile, k, "≈ $70–80")
    s.t(20, 162, "Full prototype", "b")
    bar(140, system, k, "≈ $220–300")
    s.t(x0, 210, "team estimates, low volume, not quotes; the custom stack-up needs a fab quote", "s")
    return s.render()


def fig_power(Svg):
    s = Svg(1000, 150, "Power bars: about 10 W with every element receiving, about 26 W worst case with every element transmitting", 700)
    x0, k = 220, 24
    for i, (name, w, txt, cls) in enumerate([("All receiving", 10, "3.0 A · 10 W", "zc"), ("All transmitting", 26, "7.8 A · 26 W (worst case)", "zw")]):
        y = 26 + i * 56
        s.t(20, y + 22, name, "b")
        s.box(x0, y, w * k, 34, cls, 4)
        s.t(x0 + w * k + 10, y + 22, txt, "s")
    return s.render()


# ------------------------------------------------------------------ experiments
def fig_tx(Svg):
    s = Svg(1000, 250, "Transmit steering to 30 degrees: each element lags its neighbour by 90 degrees", 700)
    x0, y0, p = 110, 200, 140
    for k in range(4):
        x = x0 + k * p
        s.box(x - 30, y0, 60, 16, "zr", 3)
        r, cx, cy = 34, x, y0 - 62
        s.raw(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="var(--line)" stroke-width="1.5"/>')
        ph = math.radians(-90 * k)
        s.ln(cx, cy, cx + 0.92 * r * math.cos(ph), cy - 0.92 * r * math.sin(ph), "rf")
        s.t(x, y0 + 38, f"{-90 * k}°".replace("-", "−"), "b", "m")
    xc, yc = x0 + 1.5 * p, 64
    a = math.radians(30)
    s.raw(f'<line x1="{xc}" y1="{yc}" x2="{xc}" y2="{yc - 50}" stroke="var(--line)" stroke-dasharray="3 3"/>')
    s.ln(xc, yc, xc + 54 * math.sin(a), yc - 54 * math.cos(a), "rf")
    s.t(xc + 46, 22, "beam 30°", "s")
    xt = x0 + 3 * p + 90
    s.t(xt, 70, "Δφ = −180° · sin θ", "t")
    s.t(xt, 94, "θ = 30°: −90° per element", "s")
    s.t(xt, 132, "easy: the phases are known", "s")
    s.t(xt, 152, "hard: a known TX phase after", "s wt")
    s.t(xt, 170, "every lock, and one start", "s wt")
    return s.render()


def fig_steps(Svg, F):
    st = F["dev_steps"]
    n = len(st)
    s = Svg(1100, 200, "Development sequence: six steps, each with a pass gate", 760)
    x0, x1, y = 70, 1030, 60
    s.raw(f'<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" class="wire"/>')
    for i, d in enumerate(st):
        x = x0 + i * (x1 - x0) / (n - 1)
        s.raw(f'<circle cx="{x}" cy="{y}" r="22" class="stepdot"/>')
        s.t(x, y + 6, d["n"], "t", "m")
        s.t(x, y + 50, d["title"], "b", "m")
        words, line, lines = d["gate"].split(), "", []
        for wd in words:
            if len(line) + len(wd) > 20:
                lines.append(line)
                line = wd
            else:
                line = (line + " " + wd).strip()
        lines.append(line)
        for j, ln in enumerate(lines[:5]):
            s.t(x, y + 76 + j * 16, ln, "s", "m")
    return s.render()


RISK_STEPS = [("1", ["IQ → PARLIO by DMA", "no continuous capture"]),
              ("2", ["S31 640 Mbit/s in + out"]),
              ("3", ["48 MHz phase stability", "LO phase after reset"]),
              ("4", ["8 lanes in lockstep", "power and heat", "FR-4 array consistency", "stack: cost, warp, lossy patches"]),
              ("6", ["coherent TX on the C5"])]


def fig_risks(Svg, F):
    titles = {st["n"]: st["title"] for st in F["dev_steps"]}
    s = Svg(1100, 290, "Each main risk mapped to the bench step that tests it first", 760)
    w = 1100 / len(RISK_STEPS)
    for i, (n, risks) in enumerate(RISK_STEPS):
        x = i * w + 8
        s.box(x, 10, w - 16, 44, "zk", 6)
        s.t(x + (w - 16) / 2, 38, f"{n}  {titles[n]}", "b", "m")
        for j, r in enumerate(risks):
            s.box(x, 66 + j * 54, w - 16, 44, "zw", 6)
            s.t(x + (w - 16) / 2, 66 + j * 54 + 27, r, "s", "m")
    return s.render()


def fig_evidence(Svg, counts, total, label="claims"):
    order = [("C", "confirmed", "zc"), ("I", "inference", "zk"), ("O", "open", "zw"), ("S", "speculative", "zone")]
    s = Svg(1000, 110, f"Status of the {total} {label}", 700)
    x, W = 20, 960
    for k, name, cls in order:
        c = counts.get(k, 0)
        w = W * c / max(total, 1)
        s.box(x, 20, w, 44, cls, 0)
        if w > 70:
            s.t(x + w / 2, 47, f"{name} {c}", "b", "m")
        x += w
    lx = 20
    for k, name, cls in order:
        if counts.get(k, 0):
            s.box(lx, 82, 14, 14, cls, 2)
            s.t(lx + 20, 94, f"{name} {counts[k]}", "s")
            lx += 40 + 7 * len(f"{name} {counts[k]}")
    s.t(lx + 10, 94, f"of {total} {label}", "s")
    return s.render()


def fig_success(Svg, F):
    s = Svg(1000, 290, "Three result tiers: minimum, target and stretch", 700)
    tiers = list(reversed(F["success_tiers"]))   # stretch on top
    cls = {"Minimum": "zc", "Target": "zk", "Stretch": "zv"}
    for i, (name, sub, items) in enumerate(tiers):
        y = 14 + i * 90
        inset = (2 - i) * 70
        s.raw(f'<polygon points="{40 + inset},{y + 84} {960 - inset},{y + 84} {960 - inset - 35},{y} {40 + inset + 35},{y}" '
              f'class="{cls.get(name, "box")}"/>')
        s.t(500, y + 26, name, "t", "m")
        s.t(500, y + 48, " · ".join(items[:2]), "s", "m")
        if len(items) > 2:
            s.t(500, y + 66, " · ".join(items[2:4]), "s", "m")
    return s.render()


# ------------------------------------------------------------------ alternatives: 16 C5s on one board
def _board(s, x, y, w, h, title):
    s.box(x, y, w, h, "frame", 8)
    s.t(x + 10, y + 20, title, "s")


def _c5grid(s, x, y, kinds, cols=4, cell=22, gap=6, letters=False):
    for i, k in enumerate(kinds):
        cx, cy = x + (i % cols) * (cell + gap), y + (i // cols) * (cell + gap)
        s.box(cx, cy, cell, cell, {"rx": "zr", "tx": "zw"}[k], 3)
        if letters:
            s.t(cx + cell / 2, cy + cell / 2 + 4, "R" if k == "rx" else "T", "s", "m")


ALT_LABELS = {"A": "Two 8-element tiles, each with one S31 and its own Gigabit port",
              "B": "One 16-element board, all receive, sixteen 1-bit lanes into one S31",
              "C": "One 16-element board: 8 receivers on 2-bit lanes into one S31, 8 transmitters on control lines and the shared 48 MHz, no data lanes",
              "D": "One 16-element board with an FPGA that drives the Gigabit PHY",
              "E": "One 16-element board with two S31s behind a Gigabit switch",
              "F": "One 16-element board, sixteen 2-bit lanes into one S31 through PARLIO and its camera port"}


def fig_alt(Svg, key):
    """One option per small SVG, so the grid can wrap on a phone."""
    s = Svg(380, 232, ALT_LABELS[key])
    if key == "A":
        for i in range(2):
            y = 8 + i * 112
            _board(s, 8, y, 364, 100, f"tile {'AB'[i]}")
            _c5grid(s, 22, y + 30, ["rx"] * 8, cols=4, cell=24, gap=6)
            s.ln(140, y + 57, 196, y + 57, "data")
            s.t(168, y + 49, "8×2", "s", "m")
            s.label(198, y + 36, 70, 42, "S31", None, "zk", "b")
            s.ln(268, y + 57, 286, y + 57, "data")
            s.t(290, y + 53, "GbE", "b")
            s.t(290, y + 70, "USB", "b")
        s.raw('<line x1="8" y1="114" x2="372" y2="114" class="pwr" stroke-dasharray="6 4"/>')
        return s.render()
    _board(s, 8, 8, 364, 216, "one board, 4 × 4")
    kinds = ["rx"] * 8 + ["tx"] * 8 if key == "C" else ["rx"] * 16
    _c5grid(s, 22, 36, kinds, cols=4, cell=30, gap=8, letters=key == "C")
    if key in ("B", "C"):
        yl = 108 if key == "B" else 70
        s.ln(170, yl, 214, yl, "data")
        s.t(192, yl - 8, "16×1" if key == "B" else "8×2", "s", "m")
        s.label(216, yl - 26 if key == "B" else 52, 70, 52 if key == "B" else 60, "S31", None, "zk", "b")
        ym = yl if key == "B" else 82
        s.ln(286, ym, 304, ym, "data")
        s.t(308, ym - 3, "GbE", "b")
        s.t(308, ym + 14, "USB", "b")
        if key == "C":
            s.pl([(251, 112), (251, 146), (172, 146)], "ctl")
            s.t(258, 140, "control", "s")
        s.t(22, 208, "16 receivers, 1 bit each at 40 MHz" if key == "B" else "top: 8 receive · bottom: 8 transmit", "s")
    elif key == "F":
        for y, lab in ((70, "PARLIO"), (146, "camera")):
            s.ln(170, y, 234, y if y == 70 else 128, "data")
            s.t(174, y - 8 if y == 70 else y + 16, lab, "s")
        s.label(236, 52, 64, 90, "S31", None, "zk", "b")
        s.ln(300, 97, 314, 97, "data")
        s.t(318, 94, "GbE", "b")
        s.t(318, 111, "USB", "b")
        s.t(22, 208, "2-bit lanes from all 16 · 60 of 60 pins", "s")
    elif key == "D":
        s.ln(170, 108, 204, 108, "data")
        s.t(187, 100, "16×2", "s", "m")
        s.label(206, 80, 60, 56, "FPGA", None, "zv", "b")
        s.ln(266, 108, 278, 108, "data")
        s.label(280, 92, 40, 32, "PHY", None, "box", "s")
        s.t(326, 112, "GbE", "b")
        s.label(206, 150, 74, 40, "ESP", "control", "zk", "s")
        s.ln(280, 170, 296, 170, "data")
        s.t(300, 174, "USB", "b")
        s.ln(206, 176, 172, 176, "ctl")
        s.ln(236, 150, 236, 140, "ctl")
        s.t(22, 208, "16 receivers, 2 bits each: 1.28 Gbit/s in", "s")
    else:
        for i, y in enumerate((70, 146)):
            s.ln(170, y, 198, y, "data")
            s.t(184, y - 8, "8×2", "s", "m")
            s.label(200, y - 18, 50, 36, "S31", None, "zk", "s")
            s.ln(250, y, 266, 108 + (i * 2 - 1) * 6, "data")
        s.label(268, 92, 50, 32, "switch", None, "box", "s")
        s.ln(318, 108, 330, 108, "data")
        s.t(332, 112, "GbE", "b")
        s.ln(225, 52, 225, 30, "data")
        s.t(232, 36, "USB", "b")
        s.t(22, 208, "two 8-lane buses, one shared uplink", "s")
    return s.render()


GPIO16 = [("data", 16, "PARLIO data", "zr"), ("pclk", 2, "PCLK, GO", "zk"), ("uart", 2, "UART", "zv"),
          ("mux", 4, "mux select", "zv"), ("i2c", 2, "I²C", "zv"), ("rdy", 3, "BOOT, READY, trigger", "zv"),
          ("eth", 15, "RGMII, MDIO, PHY reset", "box"), ("usb", 2, "USB", "box"), ("flash", 7, "flash", "grp")]


def fig_control16(Svg, gpio_total, gpio_note=""):
    s = Svg(1100, 430, "One ESP32-S31 controls sixteen ESP32-C5s over shared buses: 16 data bits, a broadcast UART, a 16:1 mux, "
            "a 16-bit I2C expander for the resets, one shared BOOT net, a wired-AND READY line and the PCLK buffer enable as GO; "
            "with a GPIO budget bar", 780)
    s.t(30, 300, "16 × ESP32-C5", "b")
    for i in range(16):
        x, y = 30 + (i % 4) * 50, 90 + (i // 4) * 50
        s.box(x, y, 40, 40, "zr", 4)
        s.t(x + 20, y + 25, str(i), "s", "m")
    s.box(236, 96, 6, 178, "dk", 2)
    xa, xs = 244, 698
    s.label(700, 86, 190, 196, "ESP32-S31", ["PARLIO RX, 16 bit", "UART, I²C, GPIO", "RGMII MAC", "USB"], "zk", "t")
    buses = [  # (y, label, cls, toward S31?, part)
        (104, "D[k] ← C5 #k: 1 bit at 40 MHz", "data", True, None),
        (130, "UART TX → all 16, addressed", "ctl", False, None),
        (156, "UART RX, flashing", "ctl", True, "16:1 mux"),
        (182, "EN × 16 (resets)", "ctl", False, "16-bit I²C I/O"),
        (208, "BOOT: one shared net", "ctl", False, None),
        (234, "READY: wired-AND", "ctl", True, None),
    ]
    for y, lab, cls, inward, part in buses:
        if part:
            px = 456
            if inward:
                s.ln(xa, y, px, y, cls, False)
                s.ln(px + 90, y, xs, y, cls)
            else:
                s.ln(xs, y, px + 90, y, cls, False)
                s.ln(px, y, xa, y, cls)
            s.label(px, y - 11, 90, 22, part, None, "zv", "s")
        elif inward:
            s.ln(xa, y, xs, y, cls)
        else:
            s.ln(xs, y, xa, y, cls)
        s.t(252, y - 6, lab, "s")
    # PCLK: the buffer feeds all 16 C5s and the S31; the S31 drives its enable (GO)
    s.label(536, 252, 106, 22, "1:2 + 2 × 1:10", None, "zk", "s")
    s.ln(536, 263, xa, 263, "pclk")
    s.t(252, 257, "PCLK to all 16 and the S31; GO = its enable", "s")
    s.ln(642, 257, xs, 257, "pclk")
    s.ln(xs, 269, 644, 269, "ctl")
    s.t(670, 285, "GO", "s", "m")
    s.ln(585, 20, 585, 250, "pclk")
    s.t(592, 32, "40 MHz from the master", "s")
    s.label(30, 34, 190, 22, "48 MHz: 2 × 1:8 buffers", None, "zc", "s")
    s.ln(200, 6, 200, 33, "clk")
    s.t(208, 18, "48 MHz from the master", "s")
    s.ln(125, 56, 125, 84, "clk", False)
    s.ln(30, 84, 220, 84, "clk", False)
    # right side: PHY, RJ45, USB
    s.ln(890, 140, 930, 140, "data")
    s.label(932, 118, 70, 44, "PHY", None, "box", "b")
    s.ln(1002, 140, 1030, 140, "data")
    s.t(1034, 144, "1 GbE", "b")
    s.ln(890, 230, 930, 230, "data")
    s.label(932, 208, 70, 44, "USB-C", None, "box", "b")
    s.t(1008, 234, "host", "s")
    # GPIO budget bar
    used = sum(n for _, n, _, _ in GPIO16)
    tot = max(gpio_total or used, used)
    x0, W, yb = 30, 1040, 340
    s.t(x0, yb - 14, f"S31 GPIO budget: {used} of {gpio_total}, including 7 for the external flash" if gpio_total
        else f"S31 GPIO budget: {used} used", "b")
    x = x0
    for _, n, lab, cls in GPIO16:
        w = W * n / tot
        s.box(x, yb, w, 34, cls, 2)
        if w > 6.4 * len(f"{lab} {n}") + 8:
            s.t(x + w / 2, yb + 22, f"{lab} {n}", "s", "m")
        elif w > 16:
            s.t(x + w / 2, yb + 22, str(n), "s", "m")
        x += w
    if gpio_total and gpio_total > used:
        s.raw(f'<rect x="{x}" y="{yb}" width="{x0 + W - x:.1f}" height="34" rx="2" class="zone"/>')
        s.t((x + x0 + W) / 2, yb + 22, f"free {gpio_total - used}", "s", "m")
    small = [f"{lab} {n}" for _, n, lab, _ in GPIO16 if W * n / tot <= 6.4 * len(f"{lab} {n}") + 8]
    s.t(x0, yb + 56, "narrow segments: " + " · ".join(small), "s")
    if gpio_note:
        s.t(x0, yb + 76, gpio_note, "s wt")
    return s.render()


GLYPH = {2: "●●", 1: "●○", 0: "○○"}
GRADE = {2: "better", 1: "middle", 0: "weaker"}


def alt_matrix(rows, cols):
    """rows: [(criterion, [(text, grade)...])]; grade 2 good, 1 middle, 0 weak."""
    out = ['<div class="tbl"><table class="heat"><thead><tr><th></th>' + "".join(f"<th>{E(c)}</th>" for c in cols) + "</tr></thead><tbody>"]
    for crit, cells in rows:
        out.append(f"<tr><th scope='row'>{E(crit)}</th>" + "".join(
            f'<td class="g{g}"><span class="gm" aria-hidden="true">{GLYPH[g]}</span> {E(t)}'
            f'<span class="vh"> ({GRADE[g]})</span></td>' for t, g in cells) + "</tr>")
    out.append("</tbody></table></div>")
    return "".join(out)


def fig_floor16(Svg):
    """Option B to scale: 4 x 4 patches at 28.8 mm, one C5 cell under each, the hub along one edge."""
    k = 2.6
    bw, bd = 150, 180
    s = Svg(bw * k + 380, bd * k + 40, "Option B floor plan to scale: a 150 by 180 mm board with sixteen cells under a 4 by 4 patch block and the hub along one edge", 600)
    ox, oy = 20, 20
    s.box(ox, oy, bw * k, bd * k, "frame", 6)
    pitch = 28.8
    x0 = ox + (bw - 3 * pitch) / 2 * k
    y0 = oy + 20 * k
    for r in range(4):
        for c in range(4):
            cx, cy = x0 + c * pitch * k, y0 + r * pitch * k
            s.box(cx - 17.5 * k / 2, cy - 13.5 * k / 2, 17.5 * k, 13.5 * k, "zr", 2)
            s.raw(f'<rect x="{cx - 3 * k:.1f}" y="{cy + 2.2 * k:.1f}" width="{6 * k:.1f}" height="{6 * k:.1f}" rx="1" fill="none" '
                  f'stroke="var(--ink)" stroke-width="1.3" stroke-dasharray="3 2"/>')
    hy = oy + (20 + 3 * pitch + 20) * k
    s.box(ox + 10 * k, hy, (bw - 20) * k, (bd - (20 + 3 * pitch + 20)) * k, "zone", 6)
    s.t(ox + 13 * k, hy + 4.4 * k, "back", "s")
    s.label(ox + 16 * k, hy + 6 * k, 32 * k, 12 * k, "clock buffers", None, "zc", "s")
    s.label(ox + 16 * k, hy + 22 * k, 32 * k, 12 * k, "mux + I²C I/O", None, "zv", "s")
    s.label(ox + 53 * k, hy + 8 * k, 22 * k, 22 * k, "S31", None, "zk", "s")
    s.label(ox + 80 * k, hy + 12 * k, 14 * k, 14 * k, "PHY", None, "box", "s")
    s.label(ox + 98 * k, oy + (bd - 21.3) * k, 16.2 * k, 21.3 * k, "RJ45", None, "box", "s")
    s.label(ox + 124 * k, oy + (bd - 7.4) * k, 12 * k, 7.4 * k, "USB", None, "box", "s")
    nx = ox + bw * k + 30
    notes = ["To scale: 150 × 180 mm.", "", "4 × 4 patches at 28.8 mm: no seam,", "one board is the whole array.", "",
             "Each C5 (dashed) on the back,", "under its own patch, as on", "the 8-element tile.", "", "Hub on the back, along one edge:", "S31, PHY, RJ45, USB,",
             "clock buffers, mux, I²C I/O.", "", "Timing can stay on the master", "board or move onto this one."]
    for i, l in enumerate(notes):
        s.t(nx, oy + 14 + 20 * i, l, "b" if i == 0 else "s")
    return s.render()


# ------------------------------------------------------------------ prior work and bench tests
def fig_prior(Svg):
    s = Svg(1100, 290, "Three small block diagrams: ESPARGOS One at 2.4 GHz, ESP-SDR on one C5, and this project's two "
            "5.2 GHz tiles; the parts this project adds are marked open", 780)
    # ESPARGOS One
    s.t(20, 28, "ESPARGOS One", "t")
    s.t(20, 46, "2.4 GHz · shown", "s")
    for i in range(8):
        s.box(24 + (i % 4) * 36, 66 + (i // 4) * 36, 28, 28, "zc", 3)
    s.t(84, 154, "8 × ESP32-C61", "s", "m")
    s.ln(172, 98, 206, 98, "data")
    s.label(208, 72, 110, 52, "controller", "ESP32", "zk", "b")
    s.ln(263, 124, 263, 166, "data")
    s.t(249, 160, "100 Mb Ethernet", "s", "e")
    s.ln(20, 196, 330, 196, "clk", False)
    s.t(20, 214, "40 MHz + 2.4 GHz reference to all 8", "s")
    s.t(20, 232, "raw IQ: closed firmware", "s")
    # ESP-SDR
    x = 380
    s.t(x, 28, "ESP-SDR", "t")
    s.t(x, 46, "open source · one C5", "s")
    s.label(x, 72, 96, 52, "ESP32-C5", "5 GHz RX", "zr", "b")
    s.ln(x + 96, 98, x + 134, 98, "data")
    s.t(x + 115, 90, "USB", "s", "m")
    s.label(x + 136, 72, 70, 52, "PC", None, "box", "b")
    s.t(x, 160, "snapshots ≤ 16,380 samples", "s")
    s.t(x, 178, "at up to 80 MS/s", "s")
    s.t(x, 214, "software trigger, no sync", "s wt")
    s.t(x, 232, "receive only", "s wt")
    # this project
    x = 720
    s.t(x, 28, "This project", "t")
    s.t(x, 46, "5.2 GHz · to build", "s")
    for i, y in enumerate((66, 120)):
        s.label(x, y, 92, 40, "8 × C5", None, "zr", "b")
        s.ln(x + 92, y + 20, x + 150, y + 20, "data")
        s.t(x + 121, y + 12, "2 bit", "s", "m")
        s.label(x + 152, y, 64, 40, "S31", None, "zk", "b")
        s.ln(x + 216, y + 20, x + 244, y + 20, "data")
        s.t(x + 248, y + 24, "GbE", "b")
    s.ln(x, 196, x + 340, 196, "clk", False)
    s.t(x, 214, "48 MHz, PCLK, GO and a 5.2 GHz tone to all 16", "s")
    s.t(x, 232, "new and open: shared 48 MHz, PARLIO export, hardware start", "s wt")
    for xx in (360, 700):
        s.raw(f'<line x1="{xx}" y1="16" x2="{xx}" y2="244" stroke="var(--line)"/>')
    return s.render()


BENCH_MARKS = [  # (x, y) of each bench test's marker on the chain, in the order of F["bench_rows"]
    (338, 72), (376, 124), (424, 124), (478, 150), (760, 100), (250, 52), (150, 124), (980, 72)]


def fig_bench(Svg, F):
    rows = F["bench_rows"][1:]
    s = Svg(1100, 330, "The signal chain with a numbered marker where each bench test applies, coloured by status", 780)
    y = 100
    s.label(20, y - 26, 110, 52, "patch + SPDT", None, "zr", "s")
    s.ln(130, y, 168, y, "rf")
    s.label(170, y - 26, 160, 52, "ESP32-C5 × 8", "raw IQ, PARLIO TX", "zr", "b")
    s.ln(330, y, 468, y, "data")
    s.t(412, y - 10, "8 × 2 bit, 40 MHz", "s", "m")
    s.label(470, y - 26, 150, 52, "ESP32-S31", "PARLIO RX, DMA", "zk", "b")
    s.ln(620, y, 668, y, "data")
    s.label(670, y - 26, 70, 52, "PHY", None, "box", "b")
    s.ln(740, y, 868, y, "data")
    s.t(800, y - 10, "1 GbE", "s", "m")
    s.label(870, y - 26, 110, 52, "PC", "calibrate, combine", "box", "b")
    s.pl([(20, 52), (250, 52), (250, y - 28)], "clk")
    s.t(24, 44, "48 MHz reference", "s")
    cls = {"C": "mk-c", "I": "mk-i", "O": "mk-o", "S": "mk-s"}
    for i, ((mx, my), r) in enumerate(zip(BENCH_MARKS, rows)):
        s.raw(f'<circle cx="{mx}" cy="{my}" r="11" class="{cls[r[0]]}"/>')
        s.t(mx, my + 4, str(i + 1), "b mk", "m")
    for i, r in enumerate(rows):
        cx, cy = 20 + (i // 4) * 540, 192 + (i % 4) * 30
        s.raw(f'<circle cx="{cx + 10}" cy="{cy - 4}" r="10" class="{cls[r[0]]}"/>')
        s.t(cx + 10, cy, str(i + 1), "b mk", "m")
        s.t(cx + 28, cy, r[1], "s")
    s.raw('<circle cx="30" cy="318" r="6" class="mk-o"/>')
    s.t(42, 322, "open: needs a bench test", "s")
    s.raw('<circle cx="230" cy="318" r="6" class="mk-i"/>')
    s.t(242, 322, "inference", "s")
    s.raw('<circle cx="350" cy="318" r="6" class="mk-c"/>')
    s.t(362, 322, "shown elsewhere (ESP-SDR on one S31)", "s")
    return s.render()
