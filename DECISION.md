# Distribution architecture — decision and rationale

**Deliverable:** *Distribution comparison tool — September (3 weeks).*
One parameterized model covering clock/reference and LO distribution and the
baseband split/combine options, with numbers next to each option and a written
decision.

**Decision:**

- **LO / reference distribution → A4, mid-frequency distribution with a per-tile ×4 multiplier.**
  Distribute 19.5 GHz on the board; multiply to 78 GHz at each tile.
- **Baseband split/combine → B3, H-tree with active cells**, with B1 (passive
  resistive) kept as a live fallback — the two are close and the choice rests
  on drive power and PVT, not on noise.

All numbers below come from the tool at its default configuration: 78 GHz LO,
2 GHz RF bandwidth, 30 cm aperture, 6 cm tiles (5×5 = 25 tiles, 100 RFIC dies),
RFSoC CLK104 100 MHz reference, RO3003 GCPW, BIST at 1 Hz, 95 W array budget.
Change any of them in the tool and the ranking recomputes; the permalink
captures the exact configuration.

---

## 1. The requirement

Two **separate** budgets, and conflating them is the classic error:

| Budget | Applies to | Value | Set by |
|:---|:---|---:|:---|
| Inter-tile coherence | *Differential* phase error between tiles | **5.00° RMS** | the proposal's own Eq. 16 |
| Array-output EVM | *Absolute* phase noise after the coherent sum | **1.38° RMS** | 64QAM at 30 % of the EVM budget |

At 25 independent tiles, 5.00° RMS corresponds to a scattered-sidelobe and
null-depth floor of **−35.2 dB** — that is what the coherence budget actually
buys, and it is the quantity that caps spatial multiplexing.

Supporting geometry: 0.65° beamwidth broadside; 867 ps of true-time-delay
**range** required at 60° scan (range binds, not resolution — a 75 ps step
costs 0.007 dB); 173 ps of residual delay inside a 6 cm sub-tile.

## 2. The four LO options, side by side

| Metric | A1 Local PLL | A2 HF foldback | A3 Daisy chain | **A4 Mid + ×4** |
|:---|---:|---:|---:|---:|
| Residual inter-tile φ (°) | 3.24 | 0.835 | 0.847 | **0.821** |
| — irreducible phase-noise part (°) | 3.14 | 0.193 | 0.235 | 0.104 |
| Null-depth floor (dB) | −38.9 | −50.7 | −50.6 | **−50.9** |
| Distribution loss (dB) | **1.0** | **60.6** | 31.5 | 35.4 |
| Repeater amplifiers | **0** | 51 | 9 | 32 |
| Distribution power (W) | 10.85 | 10.12 | **9.89** | 9.96 |
| Share of array budget (%) | 11.4 | 10.7 | 10.4 | 10.5 |
| Frequency on the board (GHz) | 0.1 | 78 | 39 | 19.5 |
| Array-output EVM (%) | **1.08** | 4.11 | 3.38 | 3.37 |
| Highest supportable QAM | **64QAM** | QPSK | 16QAM | 16QAM |
| Static offset to calibrate (wraps) | 8.0 | 6.4 | **47.9** | 6.4 |
| Risk | medium | high | high | **low** |

All four **pass** the 5° coherence spec. The choice is therefore about margin,
board cost and risk — not about one option failing outright.

## 3. Why A4

**Coherence margin is the first discriminator, and it is a 12 dB effect.** A1's
residual inter-tile phase error is 3.24°, almost all of it irreducible
free-running VCO and PFD noise above the PLL loop bandwidth. That puts its
null-depth floor at −38.9 dB against −50.9 dB for a shared LO. It clears the
5° spec, but with 1.5× margin against 6× for the shared-LO options, and nothing
recovers the difference: at a 1 Hz BIST rate with loop gain µ = 0.3 the
calibration corner is 0.048 Hz, while essentially all of the integrated phase
error lives in the kHz-to-MHz decades. If the demonstration ever needs deeper
nulls or more spatial streams, that 12 dB is the headroom you gave away.

**But A1 is genuinely better for the link, and this is worth stating plainly.**
Uncorrelated per-tile noise *averages down* by 10log10(25) = 14.0 dB in the
coherent sum, so A1's array-output phase error is 0.62° against 1.94° for a
single tile — it is the only option that supports 64QAM at these defaults,
where the shared-LO options manage 16QAM. This is exactly the effect the
proposal's §4.7 identifies, and the tool confirms it quantitatively. It also has
by far the simplest board: 1.0 dB of distribution loss, **zero** repeater
amplifiers, and no E-band or mid-band routing at all.

The two budgets point in opposite directions, and the architecture choice is
which one you refuse to give up. **Beam coherence is the one that cannot be
bought back later** — EVM can be recovered with a better reference, a wider
carrier-recovery loop or a lower modulation order, whereas the coherence floor
is set by silicon that is already committed. That is the reasoning behind
choosing A4, and it is a judgement call, not a numerical knockout. If the link
budget turns out to demand 64QAM and nulling turns out not to matter, A1 is the
better answer and the tool will say so.

**Among the three shared-LO options, A4 wins on the board.** A2, A3 and A4 all
land within 2 % of each other on residual phase error, so the decision falls to
loss, power and risk:

- A2 puts 78 GHz on 45 cm of routed line at 0.872 dB/cm — 60.6 dB total,
  needing 51 repeater amplifiers. Every one is a separate SiGe die on the board.
- A4 distributes at 19.5 GHz and 0.403 dB/cm, 35.4 dB total with 32 repeaters,
  and **removes E-band from the board entirely**.
- A3 has the lowest loss and part count but accumulates 47.9 wraps of static
  offset and fails on failure propagation (below).

**What mid-frequency distribution does *not* buy: skew.** The ×4 multiplier adds
exactly 12.0 dB to L(f) and multiplies any distributed phase error by 4. Since
an ideal multiplier preserves *time* delay and multiplies *phase*, the output
phase error from a given physical length mismatch is `2π·f_LO·τ` regardless of
distribution frequency. A2 and A4 both show 18.2° of thermal drift skew for the
same tolerances and topology — identical, as the algebra requires. Anyone
claiming a low-frequency distribution relaxes skew should be shown this. What
it buys is loss, power, repeater count, packaging tolerance in
fractional-wavelength terms, and the removal of E-band transitions.

**Why not the daisy chain.** Its delay ramp is deterministic, so a single
calibration removes it — at the calibration frequency only. Across 2 GHz it
survives as a frequency-dependent beam steer that only true time delay can
remove. Its per-hop errors form a random *walk* whose dominant spatial mode is a
beam tilt, so the iid pointing formula does not apply and understates it. It
accumulates 47.9 wraps of static offset against 6.4 for the tree, which turns
the integer ambiguity into a real estimation problem. And one dead buffer
disables every tile downstream.

## 4. A constraint that applies to all four, and changes the chip partition

A 78 GHz gain stage is **not realisable in TSMC 65 nm LP CMOS** (f_max/f ≈ 1.9).
A four-stage CMOS chain reaches roughly 0 dBm saturated; the already-taped-out
RFIC needs about +5.6 dBm to drive its four LO taps. Two independently
constructed block libraries reached this conclusion separately.

**The LO last mile therefore cannot live in the 65 nm BB+LO tile.** Every option
needs a small SiGe LO chiplet at each tile, so the proposal's two-chip partition
(SiGe RF front end + 65 nm BB+LO tile) is really a **three-chip** partition — at
165 mW and ~1 mm² per tile, 4.13 W across the array. It is in every option's
budget above, so it does not change the ranking, but it does change the
tape-out plan and should be reflected in the P1 architecture specification.

It does change *how much* SiGe each option needs, which is a real discriminator:
A2 and A3 need SiGe for the entire distribution network — every repeater and
splitter on the board. A4 needs it only for the ×4 multiplier and the taps: one
well-defined block that can be de-risked on its own. That is the strongest
practical argument for A4 beyond the numbers.

## 5. Baseband

The three options give genuinely **different inter-tile wiring**, and that
choice — not the cell type — dominates the numbers. A resistive combiner gains
nothing from hierarchy, so its natural layout is a flat **star**: every tile
routed straight to one summing node. Active cells must be staged 2:1, so theirs
is a hierarchical **H-tree**. The daisy chain is a **serpentine bus**. The
hardware map draws whichever one is selected.

| Metric | B1 Passive · star | B2 Daisy · bus | **B3 Active · H-tree** |
|:---|---:|---:|---:|
| Inter-tile topology | flat star | serpentine bus | H-tree, 5 levels |
| Routed wire, inter-tile (cm) | 626 | **191** | 261 |
| Mean → longest path (cm) | 25 → 43 | 117 → 189 | **49 → 52** |
| Geometric skew, raw (ps) | 600 | 2738 | **101** |
| Beyond the 867 ps TTD range (ps) | 0 | **1872** | 0 |
| Share of TTD range consumed (%) | 69 | — | **12** |
| Geometric skew after coarse TTD (ps) | **21.7** | 1872 | **21.7** |
| Band-averaged squint loss (dB) | **0.027** | 11.2 | 0.029 |
| Net insertion loss (dB) | 15.9 | 16.9 | **1.7** |
| Noise-figure penalty (dB) | 1.20 | 0.75 | **0.26** |
| −3 dB bandwidth (GHz) | **4.0** | 0.15 | 3.5 |
| Power per tile, both rails (mW) | 554 | **178** | 477 |
| Delay drift (°/K) | **0.002** | 0.030 | 0.050 |

**B2 is eliminated twice over.** Its capacitive loading grows with channel
count and the bandwidth collapses to 0.15 GHz against a 1 GHz rail; and its
2738 ps inter-tile ramp is 1872 ps **beyond the coarse TTD's entire range**,
leaving 11.2 dB of band-averaged squint loss. It routes the least wire of the
three and that is its only virtue.

**B1 versus B3 turns on the TTD budget, not on noise.** Baseband skew is a
*group-delay* error, so unlike an LO phase offset no phase calibration touches
it — but the architecture already carries a per-tile coarse TTD element, and
absorbing inter-tile delay is exactly its job. Both the star and the H-tree fall
inside its 867 ps range and land on the same 21.7 ps quantisation floor, so
squint loss does **not** separate them.

What separates them is what fraction of that range each spends on its own
geometry rather than on steering the beam: **69 % for the star against 12 % for
the H-tree**. The 867 ps exists because a 30 cm aperture at 60° needs it for
steering; handing two-thirds of it to the combiner's own arm mismatch is the
real cost of a star. Add 15.9 dB of insertion loss against 1.7 dB, 2.4× the
routed wire, and 554 mW against 477 mW — because the passive network needs a
strong TX-direction driver fighting the whole tree — and B3 wins on the network.

B1's genuine advantage is stability: 0.002 °/K against 0.050 °/K, and no
linearity penalty against B3's 7.0 dB cascaded IIP3 cost. The noise-figure
argument usually made for active combining is close to vacuous here — with
30 dB of RFIC gain ahead of it even the passive network costs only 1.20 dB — so
do not lead with it.

**Take B3, and keep B1 as a live fallback.** If measured PVT drift or linearity
on the first tile silicon is worse than modelled, B1 costs only drive power to
fall back to, and its stability advantage is real. Two constraints must be
stated in the specification regardless of choice:

1. At baseband, B1 means a **resistive** network. A Wilkinson passes no DC and
   its arms would need ~8 nH at 1 GHz — 5 mm² at 64 ports, larger than the die.
2. A baseband delay is a **group-delay** error at the rail edge, not a phase
   error at 78 GHz: 6.7 ps of skew is 2.41° at 1 GHz, not 188°. The BIST must
   measure group delay across the baseband span; a single-tone phase
   measurement cannot distinguish a delay error from a phase error at all.

Decide the **impedance regime per tier before** choosing among B1/B2/B3 —
matched-50 Ω versus voltage or current mode is worth more decibels than the
topology choice, and the λ/10 test decides it.

## 6. What would overturn this

- **The PFD/CP uncorrelated share** (`uncorrInbandFrac`, set to 1.0). How much
  of a tile PLL's own in-band noise is genuinely independent between tiles.
  Physically it should be close to 1 — only shared bias or a shared reference
  buffer makes any of it common — but it is the parameter A1's standing is most
  sensitive to. Measure it on the first tile silicon. If it is materially below
  1, or if the loop bandwidth can be pushed to several MHz, A1 closes the
  coherence gap and its modularity, zero repeaters and 64QAM capability win.
- **Whether 64QAM is required.** A1 is the only option reaching it at these
  defaults. If the link budget demands it, that alone can outweigh the 12 dB of
  coherence margin — widen the carrier-recovery bandwidth in the tool and see
  where the crossover lands before deciding.
- **Achievable E-band line loss.** A2 is ruled out at 0.872 dB/cm. SIW or WR-12
  changes that by an order of magnitude; if a low-loss E-band medium is
  affordable at acceptable assembly tolerance, re-run the comparison.
- **Multiplier additive phase noise.** A4's floor rests on it, and the two block
  libraries disagreed by 12 dB (−146 vs −158 dBc/Hz). This is the single
  measurement that most needs doing before committing.
- **Whether nulling is actually required.** The entire coherence argument rests
  on null depth and spatial multiplexing. If the demonstration needs only a
  single high-gain beam with sub-degree pointing, the gain-loss criterion
  applies instead, every option passes with margin, and A1 wins.

## 7. Open questions to close before tape-out

1. Measure the correlated/uncorrelated split of the tile PLL in-band noise, and
   the achievable loop bandwidth. Together they set A1's coherence floor and are
   what the A1-versus-A4 choice actually turns on.
2. Confirm a per-tile LO phase can be observed **at all**. An intra-tile TX→RX
   loopback driven by the same LO cancels the LO phase identically, so LO
   calibration needs a cross-tile path, a shared tone bus, or a bidirectional
   tap on a real LO wire. A calibration plan built on intra-tile loopback alone
   leaves 24 LO dimensions unobservable and no BIST cadence helps.
3. Specify the BIST to measure **group delay** across the baseband span. A
   narrowband phase measurement resolves delay only modulo 12.8 ps at 78 GHz,
   and A4 carries 6.4 wraps of static offset that must be unwrapped.
4. Decide the ×M lock-ambiguity strategy. A ×4 multiplier locks with a 90°
   ambiguity, invisible at the distribution frequency, reappearing at every
   power-up and forcing 25 absolute anchors at boot.
5. Confirm the RFIC LO port drive requirement. It is what makes the SiGe LO
   chiplet mandatory, and it sizes the chiplet.
6. Budget the three-chip partition into the P1 architecture specification.

---

*Generated from the [E-Band Distribution Comparison Tool](index.html). Numbers
are architecture-selection estimates, not measured data — see the tool's
honesty ledger for which values are datasheet-grade and which are engineering
guesses.*
