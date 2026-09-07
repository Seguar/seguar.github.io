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
| Residual inter-tile φ (°) | **24.8** | 0.835 | 0.847 | **0.821** |
| — irreducible phase-noise part (°) | 24.8 | 0.193 | 0.235 | 0.104 |
| Null-depth floor (dB) | **−21.3** | −50.7 | −50.6 | **−50.9** |
| Distribution loss (dB) | 1.0 | **60.6** | 31.5 | 35.4 |
| Repeater amplifiers | **0** | 51 | 9 | 32 |
| Distribution power (W) | 10.85 | 10.12 | 9.89 | 9.96 |
| Share of array budget (%) | 11.4 | 10.7 | 10.4 | 10.5 |
| Frequency on the board (GHz) | 0.1 | 78 | 39 | 19.5 |
| Array-output EVM (%) | **1.80** | 4.11 | 3.38 | 3.37 |
| Highest supportable QAM | **64QAM** | QPSK | 16QAM | 16QAM |
| Static offset to calibrate (wraps) | 8.0 | 6.4 | **47.9** | 6.4 |
| Risk | medium | high | high | **low** |

## 3. Why A4

**The coherence floor decides it, and it is a 30 dB effect.** A1's residual
inter-tile phase error is 24.8°, essentially all of it irreducible free-running
VCO noise above the PLL loop bandwidth. That puts its null floor at −21.3 dB
against −50.9 dB for a shared LO. Nothing recovers this: at a 1 Hz BIST rate
with loop gain µ = 0.3 the calibration corner is 0.048 Hz, while essentially
all of the integrated phase error lives in the kHz-to-MHz decades.

**But A1 is genuinely better for the link, and this is worth stating plainly.**
Uncorrelated per-tile noise *averages down* by 10log10(25) = 14.0 dB in the
coherent sum, so A1's array-output phase error is 1.03° against 1.93° for a
shared LO — it is the only option that supports 64QAM at these defaults. This
is exactly the effect the proposal's §4.7 identifies. The two budgets point in
opposite directions, and the architecture choice is which one you refuse to
give up. Beam coherence is the one that cannot be bought back later.

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

| Metric | B1 Passive resistive | B2 Daisy chain | **B3 H-tree active** |
|:---|---:|---:|---:|
| RMS skew across ports (ps) | **2.7** | 17.0 | 6.7 |
| Phase error at 1 GHz rail edge (°) | **0.97** | 6.11 | 2.41 |
| Band-averaged squint loss (dB) | **0.000** | 0.016 | 0.003 |
| Beam steer from the ramp (°) | 0.000 | **5.51** | 0.000 |
| Net insertion loss (dB) | 15.1 | 12.8 | **0.0** |
| Noise-figure penalty (dB) | 1.20 | 0.75 | **0.26** |
| −3 dB bandwidth (GHz) | **4.0** | **0.15** | 3.5 |
| Power per tile, both rails (mW) | 554 | **178** | 477 |
| Delay drift (°/K) | **0.002** | 0.030 | 0.050 |

B2 is eliminated: its capacitive loading grows with channel count and the
bandwidth collapses to 0.15 GHz against a 1 GHz rail, and its 48 ps delay ramp
becomes a 5.5° beam steer that phase calibration cannot remove.

**B1 versus B3 is genuinely close**, and the argument usually made for B3 is
close to vacuous here: with 30 dB of RFIC gain ahead of it, even the passive
network costs only 1.20 dB of noise figure. What actually separates them is
drive power and stability, and they split the difference — B3 wins on loss
(0 dB vs 15.1 dB), noise (0.26 dB vs 1.20 dB) and power (477 mW vs 554 mW,
because the passive network needs a strong TX-direction driver fighting the
whole tree), while B1 wins decisively on PVT stability (0.002 °/K vs 0.050 °/K)
and carries no linearity penalty against B3's 7.0 dB cascaded IIP3 cost.

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

- **The uncorrelated in-band share** (`uncorrInbandFrac`, set to 0.5 and an
  explicit guess). How much of a tile PLL's in-band noise comes from its own
  PFD/charge-pump/divider rather than the shared reference. Measure it on the
  first tile silicon. If it is below ~0.1 and the loop bandwidth can be pushed
  to several MHz, A1 closes most of the coherence gap and its modularity,
  zero repeaters and 64QAM capability win.
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

1. Measure the correlated/uncorrelated split of the tile PLL in-band noise.
   This single number reorders the ranking.
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
