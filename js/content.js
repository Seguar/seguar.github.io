/* ============================================================================
   content.js — the static prose: method/equations and the honesty ledger.
   Kept out of app.js so the text can be edited without touching logic.
   Exposes window.Content.
   ========================================================================= */
(function () {
  'use strict';

  var METHOD = [
    '### What this tool is',
    'A parameterised architecture-selection instrument, not a validated simulator. It computes closed-form ' +
    'estimates for the six required metrics from editable component parameters, so that the choice of ' +
    'distribution architecture can be argued with numbers instead of adjectives. Every default is labelled with ' +
    'its provenance; see the Assumptions tab before quoting anything.',

    '### The three rules the model enforces',
    '**1. 20log10 versus 10log10.** Phase multiplies, so an ×M multiplier or a ÷N PLL scales phase noise power by ' +
    'M², i.e. `+20log10(M)`. Independent noise powers add, so *n* uncorrelated contributors give `+10log10(n)`. ' +
    'The PFD/charge-pump term gets `+10log10(f_pfd)` because it is an independent-event rate whose power density ' +
    'is linear in rate. Using 20log10 on a count of cascaded buffers overstates a 4-hop chain by 6 dB; using ' +
    '10log10 on N understates the reference term by 28.9 dB at N = 780.',

    '**2. Correlated versus uncorrelated.** Noise from a shared source is common-mode across tiles. It cancels in ' +
    'the inter-tile differential — but only to within the path delay mismatch, with residual kernel ' +
    '`4·sin²(π·f·Δτ)`, which is −64 dB at 1 MHz for 100 ps but only −4.2 dB at 1 GHz. Noise from independent ' +
    'per-tile oscillators does not cancel at all. The differential of two independent identical sources is 3.01 dB ' +
    'above one of them; referred to the array *mean* rather than to a neighbour it is `(N−1)/N` of the per-tile ' +
    'variance, about 3 dB below the pairwise figure. The tool reports the mean-referred number, because that is ' +
    'what beamforming sees.',

    '**3. Static error, drift, and irreducible noise are three different things.** A static offset is removed by ' +
    'one calibration, leaving only quantisation. Slow drift is tracked by BIST, leaving a residual that has a ' +
    'genuine optimum update period. Random noise above the calibration loop bandwidth is irreducible. Summing ' +
    'them into one figure hides the only distinction that matters: a large calibratable error is not the same ' +
    'problem as a small uncalibratable one.',

    '### Phase noise',
    'A type-II second-order loop with natural frequency `f_n` and damping ζ, parameterised by the −3 dB closed-loop ' +
    'bandwidth `f_c`:',
    '    |H|²   = (1 + 4ζ²u²) / ((1−u²)² + 4ζ²u²),   u = f/f_n',
    '    |1−H|² = u⁴ / ((1−u²)² + 4ζ²u²)',
    'Note that `|1−H|² ≠ 1 − |H|²`: H and 1−H sum to unity in complex amplitude, not in power, so near `f_c` the ' +
    'total can sit several dB above what the complementary assumption predicts. The one-line Butterworth ' +
    'approximation satisfies the complementary relation by construction and therefore always underestimates the ' +
    'peaking region — it is not used here.',
    'The composite, referred to the oscillator and then multiplied to the LO:',
    '    L_osc(f) = |H|²·(L_ref + 20log10 N  +  FOM_pll + 20log10 f_out − 10log10 f_pfd  +  L_flicker)',
    '               + |1−H|²·L_vco(f)',
    '    L_LO(f)  = L_osc(f) + 20log10(M) ⊕ L_mult,add ⊕ 10log10(n_amp)·L_amp,add',
    'The in-band identity `FOM + 10log10(f_pfd) + 20log10(N) ≡ FOM + 20log10(f_out) − 10log10(f_pfd)` is worth ' +
    'reading twice: raising the comparison frequency buys 10 dB per decade, and inserting an R-divider to lower it ' +
    'costs the same, even though `f_ref` never changed.',

    '### Integration',
    'L(f) is single-sideband, so the phase PSD is twice it:',
    '    φ_rms² = 2·∫ L_lin(f) df      t_j = φ_rms / (2π·f_carrier)',
    'Omitting the factor of 2 understates every phase error by 1.5 dB. Integration uses the piecewise power-law ' +
    'segment rule, with the `p = −1` branch (`S₁f₁·ln(f₂/f₁)`) that a −10 dB/decade segment requires — a linear ' +
    'trapezoid on a log grid overestimates convex regions badly.',
    'Integration limits are parameters, not hidden constants, because they answer different questions. The **EVM** ' +
    'figure runs from the carrier-recovery loop bandwidth to the rail edge; the **beam-error** figure runs from the ' +
    'calibration corner to the rail edge. A mismatched pair of limits can flip the ranking.',

    '### Skew',
    'Accumulated in the **time** domain and converted **once**, at the output frequency:',
    '    Δφ(f_LO) = 360·f_LO·τ        1 ps = 28.08° at 78 GHz',
    'This is the algebra behind the tool\'s least intuitive result. An ideal ×M multiplier preserves time delay and ' +
    'multiplies phase by exactly the factor by which the frequency was reduced, so a path delay τ always produces ' +
    '`2π·f_LO·τ` at the output **regardless of the distribution frequency**. Low-frequency or mid-frequency ' +
    'distribution therefore buys *no* skew relief. It buys loss, power, amplifier count, packaging tolerance in ' +
    'fractional-wavelength terms, and phase-measurement resolution — all real, none of them skew.',
    'Contributions: the topology\'s own path-length spread (deterministic, calibratable); per-segment etch ' +
    'tolerance accumulating as √n; Dk tolerance acting on the whole path (large but static); and transition ' +
    'repeatability. A daisy chain\'s per-hop errors are a random **walk**, not iid, with RMS-about-mean factor ' +
    '`√((n²−1)/6n)`, so the iid pointing formula does not apply to it.',

    '### Calibration',
    'A sample-and-hold corrector of update period T has error kernel',
    '    W(f,T) = 2·(1 − sin(2πfT)/(2πfT)),    W → 2 for f ≫ 1/T,    W = 1 at f = 0.3017/T',
    'so a corrector *injects* the high-frequency content of its own samples: calibration is not free above its ' +
    'bandwidth. The tool models the tracking loop as first-order with corner `f_cal = µ·f_upd/2π` and adds the ' +
    'injected measurement noise `σ_bist·√(µ/(2−µ)/N_avg)` separately. Drift residual is ' +
    '`√((rate·T)²/3 + σ_bist²/N_avg)`, which has a minimum at `T³ = 3σ²/(2·rate²·f_meas)`.',
    'A ~100 Hz beam-update rate is **not** a 100 Hz calibration rate and does not need to be: the drift bandwidth ' +
    'is fractions of a hertz, and nothing at 100 Hz touches the kHz-to-MHz decades where essentially all the ' +
    'integrated phase error lives.',
    '!!! warn An intra-tile TX→RX loopback driven by the same LO cancels the LO phase **identically** — it can ' +
    'never observe the tile\'s LO phase. LO calibration requires a cross-tile path, a shared tone bus, or a ' +
    'bidirectional tap on a real LO wire. A narrowband phase measurement also resolves delay only modulo one LO ' +
    'period (12.8 ps at 78 GHz), so the BIST must measure group delay across the baseband span.',

    '### Beam metrics',
    '    gain loss      G/G₀ = exp(−σ_φ²)',
    '    sidelobe floor P_sl/P_pk = σ_φ² / N_indep',
    '    pointing (iid) δθ = σ_φ·√12·λ / (2π·√N·D·cosθ)',
    '    squint         Δθ ≈ θ·(B/2)/f_c        (proposal Eq. 6)',
    '    band loss      G = ⟨exp(−(2π·Δf·σ_τ)²)⟩ over the band',
    'Ruze gain loss is reported but should not be used to choose: at these error levels it is negligible ' +
    '(4.2° RMS costs 0.023 dB). The **sidelobe and null-depth floor** is the metric that separates the ' +
    'architectures, because it caps the achievable spatial-multiplexing SINR. `N_indep` is the number of ' +
    'independent radiating groups — for a per-tile LO error that is the **tile** count, not the element count, ' +
    'which is why a per-tile error is far more damaging than a per-element one.',

    '### The pattern model',
    'The Beam view does not use those closed forms. It sums the actual lattice, because on an array this sparse ' +
    'the geometry decides the answer and a single-axis formula gets it wrong.',
    '**Lobe set.** Grating lobes are the reciprocal lattice of the element lattice, scaled by λ:',
    '    (u,v)_lobe = (u₀,v₀) + λ·(m·b₁ + n·b₂),    aᵢ·b_j = δᵢ_j',
    'so their number in visible space is `π·A_cell/λ²` and is fixed by element **density** alone — changing the ' +
    'lattice shape moves lobes but removes none. Taking `λ/dx` on one axis reports whichever lobe happens to lie ' +
    'on that axis, which is not the binding one. For a uniform progressive-phase array |AF| = N at every lobe ' +
    '(Dirichlet kernel), so only the element pattern suppresses them, and lobes are ranked by **level**, not by ' +
    'angle: when the beam is scanned a high-order lobe can land closer to boresight than the beam itself and so ' +
    'exceed it.',
    '**Directivity.** `D = min(N·D_el, 4π·A_pop/λ²)`. The gap to the filled aperture is exactly',
    '    Δ = 10log10(4π·A_cell/(λ²·D_el)) = 10log10(A_cell / A_eff,element)',
    'i.e. a statement about the *element*, not about thinning — and identically 10log10 of the number of lattice ' +
    'lobes, since that is what the radiated power is split among. It closes as `D_el` rises toward the cell ' +
    'ceiling `4π·A_cell/λ²`. Aperiodicity does not change `N·D_el` at all: it redistributes the lobes into a ' +
    'floor, mean `1/N`, with expected **peak** higher by `10log10(ln(2L/λ))`.',
    '**Errors.** Grouped errors (tile-common, die-common, per-element, amplitude) use the exact mean pattern',
    '    E|AF|² = e₁|AF₀|² + (e₂−e₁)·N_t|S_t|² + (e₃−e₂)·N_d|S_d|² + ((1+σ_A²)−e₃)·N_e',
    '    e₁ = exp(−(σ_T²+σ_D²+σ_E²)) ≤ e₂ = exp(−(σ_D²+σ_E²)) ≤ e₃ = exp(−σ_E²)',
    'which integrates to exactly `N_e(1+σ_A²)` — power is conserved by construction. The consequence is that the ' +
    'scatter from a grouped error is **not flat**: it carries the shape of that group\'s own pattern, so it sits ' +
    'at `σ²/N_group` only at the main beam and at that group\'s comb angles, and falls to `σ²/N_elem` between ' +
    'them. Adding `σ_T²/N_t` flat at every angle — as an earlier version did — radiates 10log10(M) too much ' +
    'scattered power. Amplitude spread does not reduce the coherent field (E[1+δ] = 1); it raises total radiated ' +
    'power, so it belongs in the denominator of the gain derate, not in the exponent.',
    '**TTD quantisation** is deterministic, not random: `e_t = Δτ·round(τ_t/Δτ) − τ_t`, exactly zero at ' +
    'broadside, and the band-centre part is absorbed by the per-tile phase trim so only `−2π(f−f_c)·e_t` ' +
    'survives. It is computed exactly and carried in the coherent field. Scanning in one plane it is common to a ' +
    'whole tile **column**, so it averages by the 1-D tile count and scatters into the scan plane; the worst case ' +
    'over commanded angles runs about 7 dB above the `Δτ²/12` variance proxy, which is therefore reported as a ' +
    'labelled angle-average rather than as the answer.',
    '**Mean versus realised.** Everything above is an expectation. No array radiates it, and it cannot show a ' +
    'null filling in at a specific angle; the expected peak error sidelobe on a cut exceeds the mean floor by ' +
    '`10log10(ln(2L/λ))` ≈ 7 dB. A seeded element-by-element realisation is drawn alongside the mean for that ' +
    'reason.',

    '### Baseband',
    'The baseband network sits after the mixer, so it contributes **zero** phase noise at the carrier: M1 and M2 ' +
    'are reported as not applicable for family B rather than fabricated. Its metrics are gain/phase error, skew, ' +
    'loss and power.',
    'A baseband delay is a group-delay error at the rail edge, `Δφ = 360·f_b·τ` with `f_b ≤ 1 GHz` — never at ' +
    '78 GHz. IQ downconversion of a 2 GHz RF band gives ±1 GHz, so each rail is DC–1 GHz and the per-rail noise ' +
    'bandwidth is 1 GHz; using 2 GHz inflates every integrated-noise figure by 3 dB. Everything is per rail and ' +
    'there are two rails, so cell counts, power, decoupling and area all double.',
    'Passive split loss `10log10(N)` and coherent array gain `+10log10(N)` cancel exactly — the tool credits each ' +
    'once. A matched resistive star\'s S21 is a *voltage* ratio of 1/N, hence `20log10(N)`, but that penalty ' +
    'applies only if every port is matched: a high-impedance or current-mode node gives 0 dB of coherent transfer. ' +
    'The choice of impedance regime is worth more decibels than the choice among B1/B2/B3. At baseband B1 means a ' +
    '**resistive** network — a Wilkinson passes no DC and would need ~8 nH arms at 1 GHz.',
    'The active tree\'s output-referred cell noise is `v²·(2 − 2^(1−n))`, bounded at twice one cell for any N; ' +
    'naive Friis overstates a 6-level tree threefold. Its power is set by total load capacitance and target ' +
    'bandwidth, not by a fixed mW per cell, so fewer stronger buffers beat many weak ones — add levels only for ' +
    'isolation, skew control or wire-capacitance shielding. Cascaded IIP3 for n unity-gain stages is ' +
    '`−10log10(n)`, not `−20log10(n)`.'
  ].join('\n');

  var HONESTY = [
    '!!! warn This model is an architecture-selection instrument, not a validated simulator. It is built to be ' +
    're-run against measured numbers as chip and tile bring-up produces them. Below is every place a reader ' +
    'should not trust it without measuring first.',

    '### Values that decide the answer and are currently guesses',
    '- **Uncorrelated in-band share** (`uncorrInbandFrac`, default 0.5). How much of a tile PLL\'s in-band noise ' +
    'comes from its own PFD/charge-pump/divider rather than the shared reference. This single number reorders the ' +
    'LO ranking and is labelled *engineering-guess*. Measure it on the first tile silicon.',
    '- **Transition repeatability** (`connPhaseDeg`, default 3°). Unrepeatable phase per board/package transition. ' +
    'At E-band this is the difference between a calibratable offset and a rework-sensitive one, and it is a guess.',
    '- **Tile-to-tile ΔT** (`dTTileK`, default 8 K). Sets the drift BIST must track. Needs thermal measurement of ' +
    'a populated tile, not a datasheet.',
    '- **BIST phase-measurement noise** (`bistNoiseDeg`, default 1.5°). Determines whether calibration removes ' +
    'drift or imports noise. Unknown until the BIST paths are measured.',
    '- **EVM share allocated to the LO** (`evmShare`, default 0.3). A budgeting decision, not a measurement.',

    '### Block library',
    'Power, area and additive-noise figures for the circuit blocks are scaled estimates anchored to published ' +
    'mmWave IC results, not to silicon from this project. Two are worth singling out:',
    '- The **central 78 GHz source** and the **E-band repeater** figures set option A2\'s entire power case. If ' +
    'E-band amplifiers in the chosen process are materially better than assumed, A2 improves.',
    '- The **per-tile multiplier\'s additive phase noise** sets option A4\'s irreducible floor. If measured silicon ' +
    'is worse, A4\'s advantage over A1 narrows.',

    '### Structural simplifications',
    '- The corporate tree is built by recursive bisection into halves of equal *count*. For a 5×5 grid that is ' +
    'inherently unbalanced, which the tool reports as deterministic skew. A real design would likely use a 5-way ' +
    'split or pad to a power of two, changing the skew and the block count.',
    '- Routing is Manhattan and the path length is the drawn length. Real boards have keep-outs, vias and layer ' +
    'transitions that add both length and discontinuities.',
    '- Mutual coupling between distribution lines, and coupling into the antenna aperture, is not modelled at all. ' +
    'The proposal treats coupling as a calibration state; nothing here contributes to it.',
    '- Amplifier compression, LO leakage, and spurious tones from the multipliers are not modelled. The ×M lock ' +
    'ambiguity is reported as a calibration burden but its spur consequences are not costed.',
    '- The thermal drift rate is assumed to play out over ten minutes to convert a total excursion into a rate. ' +
    'That divisor is a guess and it moves the drift residual directly.',

    '### The beam model, and what it still does not capture',
    'The pattern is built from the real element lattice — element count and spacing derived from dies per tile ' +
    'and channels per die — rather than from a fictitious filled subarray. An earlier version modelled each tile ' +
    'as a uniformly illuminated continuous aperture the width of the tile pitch, which made its sinc nulls fall ' +
    'exactly on the tile-grid grating lobes and cancel them. That is right for contiguous *filled* subarrays and ' +
    'wrong here, and it hid the dominant effect in the whole view.',
    '- **The element positions are assumed, not designed.** The in-tile lattice is now a selectable sublattice ' +
    'rather than a hard-coded 4×2, but it is still a choice made in this tool and not by a layout. A real layout ' +
    'might cluster the four elements of a die instead, which is worse — clusters on the 4 cm tile pitch put ' +
    'grating lobes every 5.5°. Treat the lattice as a parameter, not a result.',
    '- **The aperiodic mode is a model, not a design.** It replaces the periodic structure with the full-aperture ' +
    'main lobe plus a uniform 1/N floor. A real thinned array has a specific, non-uniform sidelobe structure that ' +
    'depends on the actual positions, and achieving the ideal floor takes deliberate optimisation.',
    '- **No mutual coupling, no edge truncation, no feed or mismatch loss.** At these spacings coupling is weaker ' +
    'than in a λ/2 array, but the element pattern in an array is not the isolated element pattern, and the realised ' +
    'gain will be below the figure shown.',
    '- **The element pattern is an idealised cos^n** (or an idealised uniformly illuminated cell). A real E-band ' +
    'package radiator has ripple, finite ground-plane effects, separate E- and H-plane widths and a pattern that ' +
    'varies across the band. Worse, one cos^n cannot be both directivity-matched and HPBW-matched, and the two ' +
    'differ by about 7 dB of scan loss at 60° — so the element model is now an explicit selector, and the right ' +
    'fix is one *embedded* pattern from EM simulation used for suppression, scan loss and floor shape alike.',
    '- **Cuts are cuts.** The lobe positions and levels come from the full 2-D reciprocal lattice, and the (u,v) ' +
    'map shows all of them, but the plotted patterns are still two principal-plane cuts and most lobes lie in ' +
    'neither. Directivity is computed from the element count with the cell ceiling applied, not by integrating ' +
    'the modelled pattern, so the two are consistent by construction rather than by verification.',
    '- **Realised gain is one lumped number.** The antenna-side loss chain is a single parameter. Its dominant ' +
    'term — package feed routing at 0.15–0.35 dB/mm — is *position dependent* by 1–3 dB within a tile, which is ' +
    'an amplitude taper and not an offset, and there is no G/T anywhere in the tool even though on RX that loss ' +
    'sits in front of the LNA.',
    '- **All error classes are i.i.d.** Thermal gradients across the panel, supply droop, LO amplitude tilt along ' +
    'the feed and the periodic intra-tile feed taper are none of those things. They produce pointing error, ' +
    'near-in sidelobe growth and gain loss rather than a σ²/N floor, and they are what actually sets measured ' +
    'sidelobe level at −9 to −12 dB against the −13.26 dB a uniform aperture predicts. Nothing in this tool ' +
    'models them.',
    '- **No polarisation, and no IQ image beam in the pattern.** Cross-pol is absent entirely. The mirror beam a ' +
    'baseband-steered array puts at −θ₀ is carried as a parameter and reported, not radiated in the plot, because ' +
    'a phase-only error model cannot produce it.',

    '### Comparing saved systems',
    'The Systems view compares whole parameter sets, and the trap it is built around is worth stating on its own: ' +
    '**the requirement is derived, not fixed.** `budget.sigSpecDeg` is the minimum of three criteria, two of which ' +
    'move with the array — the 30 dB sidelobe criterion loosens as √N, and the null-depth floor `10log10(σ²/N)` ' +
    'improves with N on top of that. So a system with a coarser tile pitch is held to a laxer phase-error spec ' +
    '*and* gets less null depth for meeting it. Two consequences are built into the view rather than left to the ' +
    'reader: pass/fail colouring is per column against that column\'s own requirement, and the best-in-row marker ' +
    'is suppressed on any row whose threshold is not the same for every column. The row to read when the specs ' +
    'differ is **margin to requirement**, not the residual.',
    '- Saved systems store the **whole** parameter set, not the difference from the defaults. A sparse record ' +
    'would silently re-cost itself whenever a default moved, which is the opposite of what "the build I costed" ' +
    'means. Parameters added to the tool after a save are filled from today\'s defaults and reported as filled.',
    '- Each system is evaluated through the same function the main window uses, in a reduced-cost mode that drops ' +
    'the plot-only parts of the pattern calculation and coarsens two sampling grids. Measured agreement with the ' +
    'full evaluation is within 0.031 dB on every scalar shown, across scan angle, tile pitch, TTD step and both ' +
    'lattice modes — below the precision anything is displayed to, but not exact.',
    '- Consistency warnings travel with each system. A configuration demanding more LO taps than there are dies ' +
    'reports inflated power, area and BOM, so its column is badged rather than left looking cheap.',
    '- A comparison set shared by URL carries each system as a diff against the defaults, so it is pinned to the ' +
    'defaults of whoever opens it, and it is shown as "from a link" until imported rather than being written over ' +
    'what the recipient had saved.',

    '### The design space, and what is not in the option list',
    'The original four LO options and three baseband options came from the proposal. The space was then swept ' +
    'deliberately — classical RF architectures, photonic and digital LO generation, baseband alternatives, and ' +
    'what is actually built and measured in tiled mmWave arrays — and four things were added: **A5** round-trip ' +
    'stabilised link, **A6** injection-locked tile oscillator, **B4** current-mode summing, **B5** digitise at ' +
    'the tile. Each earned a column by being *distinct*, not merely different: A5 is the only architecture with a ' +
    'return path inside the distribution network, so it attacks drift instead of tracking it; A6 is the only one ' +
    'whose tile contains no PFD, charge pump or divider, and the only one with a locked-phase-offset error term; ' +
    'B4 changes the impedance regime rather than the topology; B5 deletes the analog inter-tile tier.',
    'The following were considered and are **not** modelled. They are listed because "we did not think of it" and ' +
    '"we costed it and it lost" are very different statements, and only the second is worth anything in a defence.',
    '- **Sub-harmonic distribution with a subharmonic mixer at the tile.** Real and attractive — it removes the ' +
    'explicit multiplier chain — but the phase-noise accounting is identical to A4 with M = 2 (the mixer does the ' +
    'doubling), so it is a tile-implementation choice inside A4 rather than a separate column.',
    '- **Photonic / RF-over-fibre LO, optical heterodyne, frequency combs, optoelectronic oscillators.** The right ' +
    'answer at a different scale. Fibre earns its E/O and O/E conversion over hundreds of metres, as at ALMA; over ' +
    'a 30 cm panel with 49 tiles it adds a laser, a modulator and 49 photodiodes to beat a copper run whose total ' +
    'loss is 38 dB at 19.5 GHz. Worth revisiting only if the array grows to a distributed aperture.',
    '- **Space-fed / quasi-optical LO illumination.** Genuinely distinct — no distribution network at all, and a ' +
    'per-tile phase that is a closed-form function of geometry rather than a manufactured artefact. Not modelled ' +
    'because it brings error classes this tool has no machinery for (illumination taper, feed pointing, LO ' +
    'leakage into the RX aperture) and because it needs a standoff the panel does not have.',
    '- **Radial / parallel-plate equal-path feed.** The sharpest of the rejected ideas, and the one to revisit ' +
    'first. It is a third topology class — one N-way junction at equal radius instead of 5.6 cascaded levels of ' +
    '2-way splitters — so path spread goes to zero by symmetry, cascaded transitions go from ~6 to 1, and ' +
    'repeaters in path go to zero. This tool\'s honesty ledger already admits that recursive bisection on a ' +
    'non-power-of-two grid manufactures deterministic skew, and a radial feed is the standard answer to exactly ' +
    'that. It is not modelled because it belongs as a *topology* axis under A2/A4 rather than as a fifth LO ' +
    'family, and adding an axis is a larger change than adding a column. Its own weakness is port-to-port ' +
    'isolation: one mismatched tile perturbs all the others.',
    '- **Coupled-oscillator arrays, standing-wave/resonant networks, two-tone difference-frequency LO, reference ' +
    'multiplexed onto the baseband or power interconnect, per-tile DDS, SYSREF-only synchronisation.** All real ' +
    'techniques; none distinct enough at this scale to earn a column against A1–A6.',
    '- **Fully digital per element** (784 converters rather than 98). The limiting case of B5, and it loses by the ' +
    'same argument by a factor of eight.',
    '- **Frequency-division-multiplexed IF over one coax, delta-sigma bitstream distribution, transformer ' +
    'combining, TDM calibration receivers.** Each solves a narrower problem than the one this comparison is about.',

    '### Things the model deliberately refuses to do',
    '- It does not report M1 or M2 for the baseband options. The network is after the mixer and contributes no ' +
    'carrier phase noise; a number there would be fabricated.',
    '- It does not show a dramatic post-calibration improvement in inter-tile phase noise. Above the calibration ' +
    'corner there is none, and a corrector actually injects its own sample noise. Any tool that shows calibration ' +
    'fixing MHz-offset phase noise is wrong.',
    '- It does not credit low-frequency distribution with reduced skew sensitivity, because the multiplier algebra ' +
    'cancels it exactly.',
    '- The scoring weights on the Decision tab are visible judgement, not physics. They are only meaningful for ' +
    'comparing options computed with the *same* weights, and no weighted score should appear in the thesis without ' +
    'the sub-scores and raw inputs beside it.'
  ].join('\n');

  /* ---------------------------------------------------------------------
     Beam-view caveats. Written as a function because the numbers that make
     each caveat concrete come from the current parameter set, and a caveat
     without a number is decoration.
     ------------------------------------------------------------------- */
  function num(v, d) { return window.UI.num(v, d); }

  function beamCaveats(g, b) {
    var periodic = Math.round(g.latticePeriodic) === 1;
    var worst = b.lobes && b.lobes.length ? b.lobes[0] : null;
    var off = (b.lobes || []).filter(function (L) {
      var a = Math.abs(L.phiDeg);
      return !(a < 1 || Math.abs(a - 180) < 1 || Math.abs(a - 90) < 1);
    }).length;
    var out = [];

    out.push('!!! warn This is a scalar, co-polarised, mean-plus-one-realisation pattern model of an ' +
      'array whose antennas do not exist yet. It is built to rank distribution architectures, and the ' +
      'LO and baseband conclusions do not depend on the lattice. The antenna-side numbers do, and ' +
      'the list below is what is missing from them.');

    out.push('### Not in the model at all');
    out.push('- **Cross-polarisation.** There is no polarisation in the model. Real AiP arrays run −15 ' +
      'to −20 dB cross-pol on boresight, degrading to −10 to −13 dB at 20–30° off-axis, with cross-pol ' +
      'grating lobes of their own. For a massive-MIMO channel argument that matters as much as co-pol ' +
      'sidelobes.');
    out.push('- **The IQ image beam.** Baseband IQ vector-modulator phase shifting leaves a residual ' +
      'conjugate-phase component, which radiates as a *mirror* beam steered to −θ₀ — here ' +
      num(-g.beamScanDeg, 0) + '° — at about the image-rejection level, ' + num(-g.imageRejDb, 0) +
      ' dBc. It is routinely measured on baseband-steered arrays, and it is the one spur a phase-only ' +
      'error model can never produce, so it is carried as its own parameter rather than folded in.');
    out.push('- **Active element pattern and the embedded environment.** One isolated element pattern ' +
      'is used for all ' + g.nElem + ' elements. In reality ' + num(4 * (g.tileCols - 1) * g.tileCols / (g.tileCols * g.tileCols) * 100, 0) +
      '% of tiles are boundary tiles, each tile has its own finite ' + num(g.tileCm, 0) + ' cm ground ' +
      'plane, the ground is electrically discontinuous across every tile seam (slot radiation, ripple, ' +
      'cross-pol) and the package supports surface waves at −20 to −25 dB. Expect ±0.5–1.5 dB of ' +
      'element-pattern ripple and 1–3 dB of left/right asymmetry in every measured cut, plus possible ' +
      'narrow scan-blindness dips that no cos^n model can represent.');
    out.push('- **Correlated, non-averaging errors.** Every error class here is i.i.d. and therefore ' +
      'averages as σ²/N. The ones that actually set measured sidelobe level do not: ' + num(g.nTilesTotal, 0) +
      ' tiles at 2–3 W over ' + num(g.effApertureCm * g.effApertureCm, 0) + ' cm² gives thermal ' +
      'gradients, and supply droop, LO amplitude tilt along a ' + num(g.effApertureCm, 0) + ' cm feed ' +
      'and the periodic intra-tile feed taper are all deterministic and spatially smooth or periodic. ' +
      'A linear component steers the beam, a quadratic one broadens it, and neither appears in any ' +
      'σ²/N floor. This is why measured near-in SLL comes in at −9 to −12 dB against the −13.26 dB a ' +
      'uniform aperture predicts.');
    out.push('- **Scan-dependent active mismatch**, and the step-wise variation of true peak ' +
      'directivity of a few tenths of a dB as grating lobes cross into and out of visible space as the ' +
      'beam steers.');
    out.push('- **Correlated channel failures.** A single dead die removes 4 channels *inside one ' +
      'tile* — ' + num(10 * Math.log10(1 - 4 / g.nElem), 2) + ' dB of gain plus a localised aperture ' +
      'defect — which is a different pattern effect from 4 independent dead elements.');

    out.push('### In the model, but optimistic or approximate');
    out.push('- **One cos^n element cannot do two jobs.** The directivity-matched element (n = ' +
      num(g.elem.nDir, 2) + ', HPBW ' + num(2 * Math.acos(Math.pow(0.5, 1 / Math.max(g.elem.nDir, 1e-6))) * 180 / Math.PI, 0) +
      '°) is honest about grating-lobe suppression and optimistic about scan loss by roughly 7 dB at ' +
      '60°; the HPBW-matched patch (n = ' + num(g.elem.nHpbw, 2) + ') is the other way round. The ' +
      'element-pattern selector exposes the choice, and the right fix is one *embedded* pattern from ' +
      'EM simulation used for both. A real patch also needs separate E- and H-plane exponents: at ' +
      '20–25° the E/H difference is 0.2–0.8 dB, which matters when a lobe is being called ' +
      (worst ? num(-worst.relDb, 2) : '0.1') + ' dB down.');
    out.push('- **Directivity, not gain.** N·D_el is a lossless directivity. The realised-gain figure ' +
      'subtracts a single lumped ' + num(g.antLossDb, 1) + ' dB for the antenna-side chain; the real ' +
      'chain is itemised in that parameter and its package-feed term is *position dependent* by 1–3 dB ' +
      'within a tile, which is a taper, not an offset. RX has no G/T in this tool at all, and package ' +
      'loss sits in front of the LNA.');
    out.push('- **Two error-floor numbers, not one curve.** The grouped-error mean pattern is exact and ' +
      'power-conserving, but it is reported at two representative angles (' + num(b.floorNearDb, 1) +
      ' dB where the tile factor peaks, ' + num(b.floorFarDb, 1) + ' dB between) rather than as a ' +
      'continuous shaped floor. The plotted trace does carry the correct shape.');
    out.push('- **Which σ belongs to which grouping level is an assumption, not a derivation.** The ' +
      'phase-versus-amplitude headline flips on it: if the ' + num(b.sigTileDeg) + '° were per-element ' +
      'rather than tile-common, the near-beam floor would move to the far-out value. The partition is ' +
      'exposed as three separate parameters precisely so that it can be argued with.');
    out.push('- **Measurability.** 2D²/λ = **' + num(g.farFieldM, 1) + ' m**. A ' + num(b.m.hpbwDeg, 3) +
      '° beam and a −13 dB sidelobe cannot be verified in the far field of any lab. This needs planar ' +
      'near-field scanning — λ/2 = ' + num(g.lambdaM * 500, 2) + ' mm steps over more than ' +
      num(g.effApertureCm, 0) + ' × ' + num(g.effApertureCm, 0) + ' cm is about ' +
      num(Math.pow(g.effApertureCm * 10 / (g.lambdaM * 500), 2), 0) + ' points per frequency per beam ' +
      'state, at ~λ/50 = ' + num(g.lambdaM * 1e6 / 50, 0) + ' µm probe accuracy — or a CATR with a ' +
      num(g.effApertureCm, 0) + ' cm quiet zone at ' + num(g.fLoGHz, 0) + ' GHz. Calibrating ' +
      g.nElem + ' channels through that is a research problem of its own, not a step in a plan.');

    if (periodic) {
      out.push('### The architecture question this raises');
      out.push('With ' + g.nElem + ' channels hard-capped by the die inventory, the axis of choice is ' +
        'what each channel\'s *radiator* looks like — and peak directivity N·D_el does not distinguish ' +
        'the options. Four self-consistent answers:');
      out.push('1. **Periodic, small elements** (this configuration). ' + num(b.m.hpbwDeg, 3) +
        '° beam, ' + num(g.dArrayDbi, 1) + ' dBi, ' + g.lobeCount + ' grating lobes, worst ' +
        (worst ? num(worst.relDb, 2) : '?') + ' dB — and when scanned the strongest lobe in the ' +
        'pattern need not be the intended one. Angularly ambiguous ' + (g.lobeCount + 1) + ' ways. ' +
        'Defensible as an LO/baseband coherence testbed against a cooperative source at a known angle; ' +
        'not defensible as an array.');
      out.push('2. **Aperiodic / thinned over the same aperture.** Same beamwidth, same ' +
        num(g.dArrayDbi, 1) + ' dBi — aperiodicity costs no gain — no grating lobes, and a pedestal at ' +
        num(g.thinnedFloorDb, 1) + ' dB mean / ' + num(g.thinnedPeakDb, 1) + ' dB expected peak. ' +
        'Needs ' + num(g.thinNeedRmsMm, 1) + ' mm RMS position randomisation that does *not* repeat ' +
        'tile to tile, so tiles stop being identical and per-element calibration becomes mandatory. ' +
        'That raises the calibration bandwidth and stability requirement on exactly the distribution ' +
        'network this thesis is about.');
      out.push('3. **One passive cell-filling subarray per channel** (the *nulled* element option). ' +
        'Its nulls land on the reciprocal lattice, i.e. on every grating lobe, and it recovers the ' +
        'element/cell gap up to ' + num(g.dCellDbi, 1) + ' dBi per element. 2 GHz is only ' +
        num(g.rfBwGHz / g.fLoGHz * 100, 1) + '% fractional bandwidth, so a narrowband passive subarray ' +
        'is easy. But the nulls sit on the lobes only at broadside, and the element rolls off fastest ' +
        'along the *long* cell axis (about 3 dB at 5° for a ' + num(Math.max(g.elemDxCm, g.elemDyCm), 0) +
        ' cm side, against 0.8 dB along the short one), so this is a broadside-to-a-few-degrees ' +
        'instrument. Select it and steer away from broadside to watch a grating lobe overtake the beam ' +
        'by more than 10 dB. It is also what the *first* version of this model was accidentally ' +
        'describing — which is why its answer looked so good.');
      out.push('4. **Compact filled λ/2 array of the same ' + g.nElem + ' elements.** ' +
        num(Math.sqrt(g.nElem) * g.lambdaM * 50, 1) + ' × ' + num(Math.sqrt(g.nElem) * g.lambdaM * 50, 1) +
        ' cm aperture, a ' + num(0.886 * g.lambdaM / (Math.sqrt(g.nElem) * g.lambdaM / 2) * 180 / Math.PI, 1) +
        '° beam, the **same** ' + num(g.dArrayDbi, 1) + ' dBi, no grating lobes, full scan. That is the ' +
        'punchline worth stating plainly: spreading ' + g.nElem + ' channels over ' +
        num(g.effApertureCm, 0) + ' cm buys angular *resolution* and buys zero gain.');
      out.push('So the ' + num(g.effApertureCm, 0) + ' cm panel is not justified by array performance; ' +
        'it is justified by the research question, which is LO and baseband distribution over a ' +
        num(g.effApertureCm, 0) + ' cm baseline. The deliverable should be labelled a **sparse / ' +
        'thinned interferometric aperture** and scored with sparse-array metrics — grating-lobe or ' +
        'pedestal level, ambiguity count, PSF sidelobe statistics, G/T — rather than with ' +
        '"full-aperture beamwidth plus −13.26 dB uniform SLL", which is the one figure of merit it does ' +
        'not earn.');
    }

    if (off > 0) {
      out.push('!!! info ' + off + ' of the ' + g.lobeCount + ' grating lobes lie in neither principal ' +
        'plane and appear in neither cut on this page. The (u,v) map is the only place they are visible.');
    }
    return out.join('\n');
  }

  window.Content = { METHOD: METHOD, HONESTY: HONESTY, beamCaveats: beamCaveats };
})();
