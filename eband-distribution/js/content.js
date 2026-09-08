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

  window.Content = { METHOD: METHOD, HONESTY: HONESTY };
})();
