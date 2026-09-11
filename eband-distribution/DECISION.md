# Distribution architecture — decision and rationale

**Deliverable:** *Distribution comparison tool — September (3 weeks).*
One parameterized model covering clock/reference and LO distribution and the
baseband split/combine options, with numbers next to each option and a written
decision.

**Decision:**

- **LO / reference distribution → A4, mid-frequency distribution with a per-tile ×4 multiplier.**
  Distribute 19.5 GHz on the board; multiply to 78 GHz at each tile.
- **Baseband split/combine → B3, H-tree with active cells**, with B4
  (current-mode summing) as the first alternative. The weighted score cannot
  separate the two — it puts them 0.001 apart on a 0–1 scale and the tool
  reports them as tied — so the decision rests on a criterion the score does
  not carry: how much of the coarse TTD range each spends on its own geometry.

All numbers below come from the tool at its default configuration: 78 GHz LO,
2 GHz RF bandwidth, 30 cm aperture, 6 cm tiles (5×5 = 25 tiles, 4 dies each,
100 RFIC dies, 400 elements), RFSoC CLK104 100 MHz reference, RO3003 GCPW,
BIST at 1 Hz, 95 W array budget. Change any of them in the tool and the
ranking recomputes; the permalink captures the exact configuration.

**On the 6 cm tile pitch.** The 30 cm aperture is a hard system spec from the
proposal; the tile pitch is the design choice that has to fit inside it, and
6 cm is the one that does. It divides 30 exactly, so the array uses the whole
aperture rather than 28 cm of it; 5×5 × 4 dies is exactly the 100-die
inventory, with nothing stranded; and it sits inside the proposal's own
5–10 cm sub-tiling range (§4.5), where 4 cm does not. Against a 4 cm pitch it
costs 0.004° of inter-tile residual — on a 5° spec — and buys 2.2 dB of
distribution loss, 6.7 W of distribution power, the full aperture, the two
stranded dies (+0.09 dB) and a narrower beam (0.650° against 0.696° broadside).
It is also
the configuration this document has always been written against; the tool's
default had drifted to 4 cm and is now back in step.

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

## 2. The six LO options, side by side

Regenerated from the model at its current defaults. The inter-tile spec is
**5.00° RMS** (binding constraint: proposal Eq. 16); the null-depth target is
−35.2 dB and the array-output EVM budget 1.38° RMS for 64QAM against a 95 W
array.

| Metric | A1 Local PLL | A2 HF foldback | A3 Daisy chain | **A4 Mid + ×4** | A5 Stabilised link | A6 Injection lock |
|:---|---:|---:|---:|---:|---:|---:|
| Residual inter-tile φ (°) | 3.139 | 0.212 | 0.249 | **0.147** | 0.770 | 2.235 |
| — irreducible phase-noise part (°) | 3.137 | 0.193 | 0.235 | 0.104 | 0.104 | **0.086** |
| — drift left after BIST (°) | 0.107 | 0.086 | 0.078 | 0.086 | 0.761 | 2.232 |
| Null-depth floor (dB) | −39.2 | −62.6 | −61.2 | **−65.8** | −51.4 | −42.2 |
| Distribution loss, worst path (dB) | **1.0** | 62.9 | 45.7 | 36.5 | 36.5 | 36.5 |
| — on the mean path (dB) | **1.0** | 60.6 | 31.5 | 35.4 | 35.4 | 35.4 |
| Repeater amplifiers | **0** | 51 | 9 | 32 | 32 | 32 |
| Distribution power (W) | 10.85 | 10.12 | 9.89 | 9.96 | 11.08 | **9.36** |
| Share of array budget (%) | 11.4 | 10.7 | 10.4 | 10.5 | 11.7 | **9.8** |
| Frequency on the board (GHz) | 0.1 | 78 | 39 | 19.5 | 19.5 | 19.5 |
| Array-output EVM (%) | **1.08** | 4.11 | 3.38 | 3.37 | 3.37 | 3.36 |
| Highest supportable QAM | **64QAM** | QPSK | 16QAM | 16QAM | 16QAM | 16QAM |
| Static offset to calibrate (wraps) | 8.0 | **6.4** | 47.9 | **6.4** | **6.4** | **6.4** |
| Risk | medium | high | high | **low** | medium | medium |

Every option clears the 5.00° inter-tile spec except A1, which fails on
per-tile oscillator phase noise, and A6, which fails on the temperature drift
of its locked phase offset unless the tanks are trimmed. A4 wins the metric
the decision turns on by 1.4× over its nearest competitor.

> The residual column moved materially in the September audit: the
> phase-shifter LSB had been counted at the tile level as well as the element
> level, and being a per-element RFIC property it was identical for every
> option, compressing A2/A3/A4 into a 4.6% band. With it removed from the
> tile-level figure — it still reaches the beam through the element term —
> the architectures separate. See the audit notes in the honesty ledger.

All four **pass** the 5° coherence spec. The choice is therefore about margin,
board cost and risk — not about one option failing outright.

## 3. Why A4

**Coherence margin is the first discriminator, and it is a 27 dB effect.** A1's
residual inter-tile phase error is 3.139°, almost all of it irreducible
free-running VCO and PFD noise above the PLL loop bandwidth. That puts its
null-depth floor at −39.2 dB against −65.8 dB for a shared LO. It clears the
5° spec, but with 1.6× margin against 34× for A4, and nothing
recovers the difference: at a 1 Hz BIST rate with loop gain µ = 0.3 the
calibration corner is 0.048 Hz, while essentially all of the integrated phase
error lives in the kHz-to-MHz decades. If the demonstration ever needs deeper
nulls or more spatial streams, that 27 dB is the headroom you gave away.

**But A1 is genuinely better for the link, and this is worth stating plainly.**
Uncorrelated per-tile noise *averages down* by 10log10(25) = 14.0 dB in the
coherent sum, so A1's array-output phase error is 0.62° against 1.94° for a
single tile — it is the only option that supports 64QAM at these defaults
(1.08 % EVM), where the shared-LO options manage 16QAM. This is exactly the effect the
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

**Among the three shared-LO options, A4 wins on the board.** A2, A3 and A4 sit
at 0.212°, 0.249° and 0.147° — a spread of 1.7× on a quantity all three clear
by 20× or better, so coherence does not separate them and the decision falls to
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
| Routed wire, inter-tile (cm) | 644 | **192** | 262 |
| Mean → longest path (cm) | 26 → 44 | 118 → 190 | **50 → 53** |
| Geometric skew, raw (ps) | 602 | 2738 | **101** |
| Beyond the 867 ps TTD range (ps) | 0 | **1872** | 0 |
| Share of TTD range consumed (%) | 69 | 316 | **12** |
| Geometric skew after coarse TTD (ps) | **21.7** | 1872 | **21.7** |
| Band-averaged squint loss (dB) | **0.027** | 11.2 | 0.029 |
| Net insertion loss (dB) | 16.0 | 17.0 | **1.8** |
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
real cost of a star. Add 16.0 dB of insertion loss against 1.8 dB, 2.5× the
routed wire, and 554 mW against 477 mW — because the passive network needs a
strong TX-direction driver fighting the whole tree — and B3 wins on the network.

B1's genuine advantage is stability: 0.002 °/K against 0.050 °/K, and no
linearity penalty against B3's 7.0 dB cascaded IIP3 cost. The noise-figure
argument usually made for active combining is close to vacuous here — with
30 dB of RFIC gain ahead of it even the passive network costs only 1.20 dB — so
do not lead with it.

**B4 current-mode ties B3 on the weighted score, and the tie is informative.**
The tool ranks B4 at 0.832 against B3's 0.831 — a lead of 0.001 on a 0–1 scale,
where shifting 0.01 of weight between two criteria can move a gap by 0.02. The
tool therefore reports the two as **tied** rather than crowning B4, which is the
honest reading. B4 is best understood as B1's flat star with current-mode
summing instead of a resistive one: it keeps the star's short answer to loss
(0.9 dB) and noise (0.01 dB), pays no cascaded-IIP3 penalty at all against B3's
7.0 dB, drifts at 0.020 °/K against 0.050, and costs 440 mW per tile against
477 — but it also inherits the star's geometry, consuming **69 % of the coarse
TTD range** on its own arm mismatch against the H-tree's 12 %.

That last line is the tiebreaker, and it is one the weighted score does not
carry: TTD-range consumption is not one of the five criteria. So the ranking is
right to call it a tie, and the argument two paragraphs above — the 867 ps
exists for steering, not for absorbing the combiner's own geometry — is what
decides it. **Take B3.** Keep B4 as the first alternative rather than B1: it
dominates B1 on every axis where B1 was the fallback, so if the H-tree's PVT
drift or linearity on first silicon disappoints, B4 is the better place to go.
Two constraints must be
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

## 6b. Antenna-side caveat: the lattice decides the ordering

This section was added after the pattern model was corrected and independently
reviewed. It does not change the LO or baseband decision — both reviewers
confirmed that the 10log10(N) beam-output averaging of uncorrelated per-tile
PLL noise against its full appearance in the inter-tile differential is
independent of the lattice, and so is the three-chip partition of §4. What it
changes is the **order in which the coherence argument may be made**, and it
adds one parameter to the list of architectural choices.

Numbers here are at the tool's default configuration, the same one §1–§6 are
written against: 6 cm tiles, 5×5 = 25 tiles, 4 dies per tile, 400 elements
over the full 30 cm.

**1. The error floor is not the binding metric on a periodic lattice.**
400 elements over 30 cm is a square 3.90λ × 3.90λ lattice. That puts
π·A_cell/λ² = **44 grating lobes** inside the horizon, and because a uniform
progressive-phase array has |AF| = N at every one of them, only the element
pattern suppresses them: the binding lobe sits at **14.85° and is 0.146 dB
below the main beam**. Steered to 30° a grating lobe is **0.62 dB above** the
intended beam; at 45°, 1.48 dB above; at 60°, 2.96 dB above. The array is
angularly ambiguous 45 ways.
Against that, the whole distribution-error floor is at −46 to −47 dB. So on a
periodic lattice the null-depth floor of §1 is **not** what limits the array —
it becomes the binding metric only once the lattice is made aperiodic. The
coherence argument is correct, but it has a precondition, and the precondition
has to be stated first.

**2. Making it aperiodic lands back on the distribution network.** Aperiodicity
costs no gain — N·D_el is unchanged; the 45 lattice beams are redistributed
into a floor, mean −26.0 dB with an expected peak near −19.0 dB. But breaking
the periodicity properly needs ~5.8 mm RMS position randomisation, and
dithering within one 1.5 × 1.5 cm cell supplies at most 4.3 mm, which leaves a
quasi-grating residue near −14.3 dB at the old lobe angles. (The square cell
of the 6 cm tiling is materially better placed here than the 1 × 2 cm cell of
the old 4 cm tiling, which supplied only 2.9 mm against a 7.8 mm need — the
short axis is what limits the dither.) Doing it properly
means positions that do **not** repeat tile to tile — i.e. tiles that are no
longer identical, per-element position and phase calibration that is mandatory
rather than optional, and therefore a higher calibration bandwidth and
stability requirement on exactly the distribution network this thesis is about.

**3. The element, not the layout, is the recoverable term.** The 16.82 dB gap
between the 400-element directivity (32.02 dBi) and the filled aperture
(48.84 dBi) is not a thinning loss to be accepted. It is exactly
10log10(4π·A_cell/(λ²·D_el)) — the ratio of the element's effective area
(4.68 mm²) to its cell (225 mm²), i.e. 2.08% — and identically 10log10 of the
48 co-equal lattice beams. It closes as element directivity rises toward the
22.82 dBi ceiling a 1.5 × 1.5 cm cell can support. A cell-filling *nulled*
radiator puts its sinc nulls exactly on the reciprocal lattice, removing every
grating lobe at broadside and recovering the full 48.84 dBi — but only at broadside:
at 5° the first lobe is already only 5.8 dB down, and steered to 30° a
grating lobe overtakes the beam by 33 dB. That is a broadside instrument, and
it is what the *first* version of the tool's pattern model was accidentally
describing.

**4. The TTD step is an architectural parameter, and it is set by the
quantisation lobe, not by the squint loss.** §1 justifies the 75 ps step on
loss: it costs 0.007 dB. That is true and it is the wrong criterion. The
quantisation residual e_t = Δτ·round(τ_t/Δτ) − τ_t is deterministic, exactly
zero at broadside, and common to a whole tile column when scanning in one
plane — so it averages by 5, not 25, and scatters into the scan plane. Swept
over commanded angles at ±1 GHz it produces a **discrete lobe at −18.9 dB**
(worst at 34° commanded), against −25.8 dB from the angle-averaged variance
proxy and −46 dB for everything else in the error budget. It is the dominant
band-edge artefact by a wide margin. A finer step buys it down directly
(−42 dB at 5 ps by the same measure), so the LSB should be specified against
the lobe, with the loss figure as a secondary check.

**5. The lattice improvement is already banked, and the gain one is not
available at all.** At the old 4 cm tiling this section recommended replacing
the rectangular 4×2 in-tile lattice with a sheared one: 4×2 was the **worst**
of the index-8 sublattices, putting the binding lobe at 11.08° against 15.77°
for a1 = (1,−1) cm, a2 = (0,2) cm, and 1.41 cm of minimum element separation
against 1.00. The 6 cm tiling takes that win by construction — 16 elements in
a 6 cm tile lay out 4×4 on a square 1.5 cm lattice, which is simultaneously
the rectangular arrangement and the widest-separation sublattice available, so
there is nothing left to trade and minimum separation is 1.50 cm. It still
does not rescue a periodic layout and it still does not reduce the lobe count,
which is fixed by element density alone. Separately, a compact filled
λ/2 array of the same 400 elements would be 3.8 × 3.8 cm, have a 5.1° beam and
the **same** 32.02 dBi. Spreading 400 channels over 30 cm buys angular
resolution and buys zero gain.

**Consequence for how this is presented.** The 30 cm panel is not justified by
array performance; it is justified by the research question, which is LO and
baseband distribution over a 30 cm baseline. The demonstrator should be labelled
a **sparse / thinned interferometric aperture** and scored with sparse-array
metrics — grating-lobe or pedestal level, ambiguity count, PSF sidelobe
statistics, G/T — not with "full-aperture beamwidth plus −13.26 dB uniform
sidelobe level", which is the one figure of merit it does not earn.

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
