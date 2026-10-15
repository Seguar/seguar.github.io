"""Content slides (text, tables, charts)."""
import numpy as np
from pptx.chart.data import CategoryChartData, XyChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_LABEL_POSITION, XL_TICK_LABEL_POSITION
from pptx.util import Inches, Pt
from deckkit import *
import budget as B


# ------------------------------------------------------------------ title
def slide_title(d, assets, F=None):
    F = F or {}
    s = d.prs.slides.add_slide(d.layout)
    d.n += 1
    t = s.shapes.title
    t.left, t.top, t.width, t.height = Inches(0.6), Inches(1.7), Inches(7.4), Inches(1.9)
    tf = t.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.BOTTOM
    tf.text = F.get("title_text", "A 4×4 phased-array research platform built from ESP32-C5 radios")
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.LEFT
    for r in p.runs:
        r.font.size = Pt(38)
        r.font.name = FONT_LIGHT
        r.font.color.rgb = rgb(INK)
    text(s, 0.6, 3.85, 7.2, 0.9,
         F.get("title_sub", "5.2 GHz · 16 transceiver elements · shared clock, in-band calibration and a multi-rate IQ data path"),
         size=18, color=MUTED)
    text(s, 0.6, 5.2, 7.2, 0.9,
         ["Student project proposal — technical concept", "October 2026"],
         size=14, color=INK, para_space=4)
    text(s, 0.6, 6.55, 7.4, 0.5,
         "Builds on the open ESPARGOS and ESP-SDR projects. Photo: our existing 4×4 patch board (5.2 GHz, FR4).",
         size=10, color=FAINT)
    picture(s, assets + r"\patch_side.jpg", 8.45, 0.75, h=6.0, name="Photo of the 4x4 patch antenna board")
    notes(s, "Purpose of the talk: propose a staged student project. The hardest problems are synchronization, "
             "calibration and moving/reducing IQ data — not the antennas and not the beamforming maths.")
    return s


# ------------------------------------------------------------------ existing work
def slide_existing(d, F):
    s = d.slide("What already exists, and what is new here", source=F["existing_source_line"])
    cols = [("ESPARGOS (Univ. of Stuttgart)", F["espargos_points"]),
            ("ESP-SDR", F["espsdr_points"]),
            ("What this project adds", F["new_points"])]
    x0, w, gap = 0.6, 3.85, 0.27
    for i, (t, pts) in enumerate(cols):
        x = x0 + i * (w + gap)
        text(s, x, 1.45, w, 0.35, t, size=16, color=INK)
        line(s, x, 1.88, x + w, 1.88, LINE if i < 2 else BLUE, 1.0)
        yy = 2.05
        for st, body in pts:
            status_mark(s, x + 0.08, yy + 0.13, st)
            tb = text(s, x + 0.28, yy, w - 0.3, 0.8, body, size=13, color=INK if i == 2 else MUTED)
            yy += F.get("existing_step", 0.78)
    status_legend(s, 0.6, 6.55, ("C", "I", "O", "S"))
    return s


# ------------------------------------------------------------------ chip choice
def slide_chips(d, F):
    s = d.slide("Why ESP32-C5?", source=F["chips_source_line"])
    rows = F["chips_rows"]
    table(s, 0.6, 1.4, [1.7, 3.0, 1.45, 2.35, 3.6], rows, row_h=0.4, size=12,
          col_align=["l", "l", "c", "l", "l"])
    text(s, 0.6, 5.0, 12.1, 1.0, F["chips_takeaway"], size=14, color=INK)
    return s


# ------------------------------------------------------------------ antenna board
def slide_antenna(d, assets, F=None):
    F = F or {}
    s = d.slide("The antenna board we already have",
                source="Observations from photos; pitch and patch size to be confirmed against the layout files. Patch estimate: transmission-line model, εr = 4.5, h = 1.52 mm.")
    picture(s, assets + r"\patch_side.jpg", 0.6, 1.4, h=4.9, name="Patch side of antenna board")
    picture(s, assets + r"\sma_side.jpg", 5.0, 1.4, h=4.9, name="Connector side of antenna board")
    text(s, 0.6, 6.35, 4.2, 0.3, "radiating side: 16 probe-fed patches + 4 test patches", size=10, color=MUTED)
    text(s, 5.0, 6.35, 4.2, 0.3, "back: one SMA per element", size=10, color=MUTED)
    x0 = 9.95
    text(s, x0, 1.4, 2.8, 0.3, "What we can read off it", size=14, color=INK)
    text(s, x0, 1.8, 2.8, 2.4,
         ["4 × 4 rectangular patches, linear polarization",
          "silkscreen: f₀ = 5.2 GHz, FR4 εr = 4.5, h = 60 mil",
          "pitch ≈ 30 mm from the ruler, consistent with λ/2 = 28.8 mm",
          "expected patch ≈ 13 × 17 mm — matches the proportions"],
         size=11, color=MUTED, bullets=True, para_space=4)
    text(s, x0, 4.05, 2.8, 0.3, "What it means", size=14, color=INK)
    text(s, x0, 4.45, 2.8, 2.4,
         F.get("antenna_means", ["the aperture is passive and cabled — tiles do not have to carry antennas, so tile seams do not touch the aperture",
          "cables sit before the calibration switch: measure them once with a VNA",
          "first bench work: S11 per element, neighbour coupling"]),
         size=11, color=MUTED, bullets=True, para_space=4)
    return s


# ------------------------------------------------------------------ data problem chart
def _log_axis(chart, lo=1, hi=100000):
    va = chart.value_axis
    va.minimum_scale = lo
    va.maximum_scale = hi
    scaling = va._element.find(qn("c:scaling"))
    lb = etree.SubElement(scaling, qn("c:logBase"))
    lb.set("val", "10")
    scaling.remove(lb)
    scaling.insert(0, lb)


def _style_axis(ax, size=11, color=MUTED):
    ax.tick_labels.font.size = Pt(size)
    ax.tick_labels.font.color.rgb = rgb(color)
    ax.tick_labels.font.name = FONT
    ax.format.line.color.rgb = rgb(RULE)


def slide_dataproblem(d, F):
    s = d.slide("Sixteen receivers create a data problem", source=F["dataproblem_source_line"])
    items = F["dataproblem_items"]  # (label, Mbit/s, kind) kind: 'need' or 'link'
    cd = CategoryChartData()
    cd.categories = [i[0] for i in items]
    cd.add_series("Mbit/s", [i[1] for i in items])
    gf = s.shapes.add_chart(XL_CHART_TYPE.BAR_CLUSTERED, Inches(0.6), Inches(1.4), Inches(7.6), Inches(5.3), cd)
    gf.name = "Chart: raw IQ rates vs link capacities"
    ch = gf.chart
    ch.has_legend = False
    ch.has_title = False
    ch.font.name = FONT
    ch.font.size = Pt(11)
    plot = ch.plots[0]
    plot.gap_width = 55
    plot.has_data_labels = True
    dl = plot.data_labels
    dl.number_format = '#,##0" Mbit/s"'
    dl.number_format_is_linked = False
    dl.position = XL_LABEL_POSITION.OUTSIDE_END
    dl.font.size = Pt(10)
    dl.font.color.rgb = rgb(INK)
    ser = plot.series[0]
    for idx, it in enumerate(items):
        pt = ser.points[idx]
        pt.format.fill.solid()
        pt.format.fill.fore_color.rgb = rgb(BLUE if it[2] == "need" else "B8C1CA")
        pt.format.line.fill.background()
    _log_axis(ch, 1, 100_000)
    va = ch.value_axis
    va.has_major_gridlines = True
    va.major_gridlines.format.line.color.rgb = rgb("E6EAEE")
    va.tick_labels.number_format = '#,##0'
    va.tick_labels.number_format_is_linked = False
    _style_axis(va, 10)
    ca = ch.category_axis
    _style_axis(ca, 11, INK)
    ca.reverse_order = False
    va.has_title = True
    va.axis_title.text_frame.text = "Mbit/s (log scale)"
    r = va.axis_title.text_frame.paragraphs[0].runs[0]
    r.font.size = Pt(10)
    r.font.color.rgb = rgb(MUTED)
    r.font.bold = False
    # key
    rect(s, 2.3, 6.78, 0.16, 0.12, fill=BLUE, line=None)
    text(s, 2.52, 6.72, 2.2, 0.24, "what the array produces", size=10, color=MUTED, anchor="m")
    rect(s, 4.6, 6.78, 0.16, 0.12, fill="B8C1CA", line=None)
    text(s, 4.82, 6.72, 2.4, 0.24, "what common links carry", size=10, color=MUTED, anchor="m")

    x0 = 8.75
    text(s, x0, 1.45, 4.0, 0.9, [[("16 × 80 MS/s × 16 bit", {})], [("= 20.48 Gbit/s", {"size": 26})]],
         size=16, color=INK, font=FONT_LIGHT)
    text(s, x0, 2.65, 4.0, 4.0, F["dataproblem_text"], size=12, color=MUTED, para_space=8)
    return s


# ------------------------------------------------------------------ snapshots
def slide_snapshots(d, F):
    s = d.slide(F["snap_title"], source=F["snap_source_line"])
    # timeline
    y0 = 1.65
    text(s, 0.6, y0 - 0.1, 3.0, 0.3, "One element, snapshot mode", size=13, color=INK)
    tx0, scale = 0.6, 1.0
    ty = y0 + 0.45
    segs = F["snap_segments"]  # list of (label, width_in, kind)
    x = tx0
    for lab, w, kind in segs:
        col = {"cap": TEAL_L, "xfer": BG2, "idle": WHITE}[kind]
        lc = {"cap": TEAL, "xfer": LINE, "idle": RULE}[kind]
        rect(s, x, ty, w, 0.5, fill=col, line=lc, lw=0.75, content=lab, size=10,
             color=INK if kind != "idle" else FAINT)
        x += w
    line(s, tx0, ty + 0.75, x, ty + 0.75, LINE, 0.75, tail=True)
    text(s, x - 0.6, ty + 0.78, 0.8, 0.25, "time", size=10, color=MUTED, align="r")
    text(s, 0.6, ty + 1.05, 12.1, 0.6, F["snap_timeline_note"], size=12, color=MUTED)

    # duty-cycle table
    text(s, 0.6, 3.75, 6.0, 0.3, F["snap_table_title"], size=13, color=INK)
    table(s, 0.6, 4.1, F["snap_table_cols"], F["snap_table_rows"], row_h=0.34, size=11,
          col_align=["l", "r", "r", "r"])
    x0 = 7.6
    text(s, x0, 3.75, 5.1, 0.3, "What this means", size=13, color=INK)
    text(s, x0, 4.1, 5.1, 2.7, F["snap_points"], size=12, color=MUTED, bullets=True, para_space=6)
    return s


# ------------------------------------------------------------------ options A-D
def slide_options(d, F):
    s = d.slide("Five ways to collect the data", source=F["options_source_line"])
    rows = F["options_rows"]
    table(s, 0.6, 1.4, [1.6, 2.1, 2.1, 2.1, 2.1, 2.13], rows, row_h=0.62, size=11,
          col_align=["l", "l", "l", "l", "l", "l"], valign="t", header_size=12,
          row_heights=F["options_row_heights"])
    return s


# ------------------------------------------------------------------ budget table
def slide_budget(d, F):
    s = d.slide("Data-rate budget, stage by stage", source=F["budget_source_line"])
    table(s, 0.6, 1.4, [3.5, 1.75, 1.75, 1.75, 3.38], F["budget_rows"], row_h=0.4, size=12,
          col_align=["l", "r", "r", "r", "l"], row_heights=F.get("budget_row_heights"))
    text(s, 0.6, 6.3, 12.1, 0.5, F["budget_takeaway"], size=13, color=INK)
    return s


# ------------------------------------------------------------------ modes
def slide_modes(d, F):
    s = d.slide("From raw samples to useful information", source=F["modes_source_line"])
    rows = F["modes_rows"]
    table(s, 0.6, 1.4, [2.3, 3.2, 1.75, 3.0, 1.88], rows, row_h=0.8, size=12, valign="t",
          col_align=["l", "l", "r", "l", "l"], header_size=12, row_heights=F.get("modes_row_heights"))
    text(s, 0.6, 5.95, 12.1, 0.8, F["modes_takeaway"], size=13, color=INK)
    return s


# ------------------------------------------------------------------ central vs tiled
def slide_central_vs_tiled(d, F):
    s = d.slide("Central or tiled processing?", source=F["cvt_source_line"])
    table(s, 0.6, 1.4, [2.6, 4.75, 4.75], F["cvt_rows"], row_h=0.5, size=12, valign="m",
          header_size=13, row_heights=F.get("cvt_row_heights"))
    text(s, 0.6, 6.15, 12.1, 0.7, F["cvt_takeaway"], size=13, color=INK)
    return s


# ------------------------------------------------------------------ processors
def slide_processors(d, F):
    s = d.slide("Candidate tile and hub processors", source=F["proc_source_line"])
    table(s, 0.6, 1.4, [1.75, 3.05, 3.65, 3.68], F["proc_rows"], row_h=0.55, size=11, valign="m",
          header_size=12, row_heights=F.get("proc_row_heights"))
    text(s, 0.6, 6.25, 12.1, 0.6, F["proc_takeaway"], size=13, color=INK)
    return s


# ------------------------------------------------------------------ beamforming
def slide_beamforming(d, F):
    s = d.slide("First useful experiment: receive beamforming", source=F["bf_source_line"])
    th = np.arange(-90, 91, 1)
    cd = XyChartData()
    for steer, name in ((0, "steered to 0°"), (30, "steered to 30°")):
        ser = cd.add_series(name)
        for t, v in zip(th, B.array_factor_db(4, steer, th)):
            ser.add_data_point(float(t), float(v))
    gf = s.shapes.add_chart(XL_CHART_TYPE.XY_SCATTER_LINES_NO_MARKERS, Inches(0.6), Inches(1.45),
                            Inches(6.6), Inches(4.4), cd)
    gf.name = "Chart: 4-element array factor"
    ch = gf.chart
    ch.font.name = FONT
    ch.font.size = Pt(10)
    ch.has_title = False
    ch.has_legend = True
    ch.legend.position = XL_LEGEND_POSITION.TOP
    ch.legend.include_in_layout = False
    ch.legend.font.size = Pt(10)
    ch.legend.font.color.rgb = rgb(MUTED)
    cols = [BLUE, TEAL]
    for i, ser in enumerate(ch.plots[0].series):
        ser.format.line.color.rgb = rgb(cols[i])
        ser.format.line.width = Pt(1.75)
        ser.smooth = False
    va, ca = ch.value_axis, ch.category_axis
    va.minimum_scale, va.maximum_scale, va.major_unit = -40, 0, 10
    ca.minimum_scale, ca.maximum_scale, ca.major_unit = -90, 90, 30
    va.has_major_gridlines = True
    va.major_gridlines.format.line.color.rgb = rgb("E6EAEE")
    ca.has_major_gridlines = True
    ca.major_gridlines.format.line.color.rgb = rgb("E6EAEE")
    ca.tick_label_position = XL_TICK_LABEL_POSITION.LOW
    _style_axis(va, 10)
    _style_axis(ca, 10)
    for ax, t in ((va, "normalized gain (dB)"), (ca, "angle (degrees)")):
        ax.has_title = True
        ax.axis_title.text_frame.text = t
        r = ax.axis_title.text_frame.paragraphs[0].runs[0]
        r.font.size = Pt(10)
        r.font.color.rgb = rgb(MUTED)
        r.font.bold = False
    text(s, 0.6, 5.95, 6.6, 0.75,
         "Array factor of one 4-element row at λ/2, uniform weights. Half-power beamwidth ≈ 25° at broadside, "
         "first sidelobe −11.3 dB. The full 4×4 array steers in both azimuth and elevation.",
         size=10, color=MUTED)
    x0 = 7.65
    text(s, x0, 1.45, 5.1, 0.3, "Experiment", size=14, color=INK)
    text(s, x0, 1.85, 5.1, 2.4, F["bf_steps"], size=12, color=MUTED, bullets=True, para_space=5)
    text(s, x0, 4.35, 5.1, 0.3, "Success criterion", size=14, color=INK)
    text(s, x0, 4.75, 5.1, 1.9, F["bf_success"], size=12, color=INK, para_space=5)
    return s


# ------------------------------------------------------------------ status table (radar / comms / TX)
def slide_status_table(d, title, source, rows, col_w, intro=None, after=None, row_h=0.62, legend=("C", "I", "O", "S"),
                       size=11, row_heights=None, y=None):
    s = d.slide(title, source=source)
    y0 = 1.4
    if intro:
        text(s, 0.6, 1.3, 12.1, 0.6, intro, size=14, color=INK)
        y0 = 2.0
    if y:
        y0 = y
    # rows: [status, c1, c2, ...]; the first column holds status mark
    body = [[""] + rows[0][1:]]
    for r in rows[1:]:
        body.append([""] + r[1:])
    shp = table(s, 0.6, y0, col_w, body, row_h=row_h, size=size, valign="m", header_size=12,
                row_heights=row_heights)
    # place status marks centred in first column
    tbl = shp.table
    yy = y0 + Emu(tbl.rows[0].height).inches
    for i, r in enumerate(rows[1:], start=1):
        h = Emu(tbl.rows[i].height).inches
        status_mark(s, 0.6 + col_w[0] / 2, yy + h / 2, r[0])
        yy += h
    if after:
        text(s, 0.6, after[0], 12.1, after[1], after[2], size=12, color=MUTED)
    if legend:
        status_legend(s, 0.6, 6.62, legend)
    return s


# ------------------------------------------------------------------ power & thermal
def slide_power(d, F):
    s = d.slide("Power, heat and board constraints", source=F["power_source_line"])
    text(s, 0.6, 1.4, 6.0, 0.3, "Supply estimate (3.3 V rail)", size=14, color=INK)
    table(s, 0.6, 1.8, [2.9, 1.25, 1.3, 1.25], F["power_rows"], row_h=0.36, size=11,
          col_align=["l", "r", "r", "r"])
    text(s, 0.6, 5.0, 6.7, 1.7, F["power_notes"], size=11, color=MUTED, bullets=True, para_space=4)
    x0 = 7.75
    text(s, x0, 1.4, 5.0, 0.3, "Board-level points", size=14, color=INK)
    text(s, x0, 1.8, 5.0, 5.0, F["board_points"], size=11, color=MUTED, bullets=True, para_space=6)
    return s


# ------------------------------------------------------------------ stages
def slide_stages(d, F):
    s = d.slide("How we would build it in stages", source=F["stages_source_line"])
    ph = F["stages"]
    x0, w, gap = 0.6, 2.9, 0.17
    # timeline bar
    for i, p in enumerate(ph):
        x = x0 + i * (w + gap)
        rect(s, x, 1.45, w, 0.5, fill=BLUE_L if i < 3 else BG2, line=BLUE if i < 3 else LINE, lw=0.75,
             content=[[(p["n"] + "  ", {"color": BLUE}), (p["title"], {})]], size=14, align="l", margin=0.12)
        text(s, x, 2.02, w, 0.3, p["when"], size=10, color=MUTED)
        text(s, x, 2.4, w, 0.3, "Goals", size=11, color=INK)
        text(s, x, 2.7, w, 2.6, p["goals"], size=12, color=MUTED, bullets=True, para_space=3)
        line(s, x, 5.25, x + w, 5.25, RULE, 0.75)
        text(s, x, 5.35, w, 0.3, "Exit test", size=12, color=AMBER if i < 3 else TEAL)
        text(s, x, 5.68, w, 1.2, p["gate"], size=12, color=INK)
    return s


# ------------------------------------------------------------------ risks
def slide_risks(d, F):
    s = d.slide("Main technical risks", source=F["risks_source_line"])
    table(s, 0.6, 1.4, F.get("risk_cols", [3.05, 3.2, 2.95, 2.93]), F["risk_rows"], row_h=0.6, size=11, valign="m",
          header_size=12, row_heights=F.get("risk_row_heights"))
    return s


# ------------------------------------------------------------------ claims register
def slide_claims(d, F):
    rows = F["claims_rows"]
    return slide_status_table(d, "What we know, what we infer, what we must test", F["claims_source_line"], rows,
                              [0.6, 6.6, 4.93], row_h=0.305, size=11, legend=("C", "I", "O", "S"))


# ------------------------------------------------------------------ BOM
def slide_bom(d, F):
    s = d.slide("Block-level bill of materials", source=F["bom_source_line"])
    table(s, 0.6, 1.4, [2.4, 0.8, 4.6, 4.33], F["bom_rows"], row_h=0.36, size=11, valign="m",
          col_align=["l", "c", "l", "l"], header_size=12)
    return s


# ------------------------------------------------------------------ success
def slide_success(d, F):
    s = d.slide("What a successful student project looks like", source=F["success_source_line"])
    tiers = F["success_tiers"]
    x0, w, gap = 0.6, 3.9, 0.2
    for i, (t, sub, items) in enumerate(tiers):
        x = x0 + i * (w + gap)
        text(s, x, 1.45, w, 0.4, t, size=20, color=[INK, BLUE, MUTED][i], font=FONT_LIGHT)
        text(s, x, 1.95, w, 0.3, sub, size=11, color=MUTED)
        line(s, x, 2.35, x + w, 2.35, [INK, BLUE, RULE][i], 1.0)
        text(s, x, 2.5, w, 3.6, items, size=14, color=INK if i < 2 else MUTED, bullets=True, para_space=8)
    text(s, 0.6, 6.15, 12.1, 0.6, F["success_takeaway"], size=13, color=INK)
    return s


# ------------------------------------------------------------------ references
def slide_refs(d, title, refs, source=None, start=1):
    s = d.slide(title, source=source)
    paras = []
    for i, (txt, url) in enumerate(refs):
        paras.append({"runs": [(f"[{i + start}]  ", {"color": FAINT}), (txt, {"color": INK}),
                               ("  " + url, {"color": BLUE, "size": 10})], "space": 6})
    text(s, 0.6, 1.4, 12.1, 5.4, paras, size=11)
    return s
