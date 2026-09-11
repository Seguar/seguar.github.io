/* ============================================================================
   glossary.js — the tool's own vocabulary, defined once and reachable from
   wherever a term appears.

   The tool never defined its terms. L(f) appears in a panel title, a
   parameter label and six row names and was never once expanded to
   "single-sideband phase noise"; "wraps" and "foldback" are house terms
   nobody can guess; TTD, BIST, Ruze, squint, IIP3, ENOB, Dk, GCPW, HPBW and
   "null-depth floor" appeared with no definition anywhere on the page. The
   only definition of A1-A6 and B1-B5 was a title attribute on a table header,
   reachable by hovering and waiting.

   One definition table, one affordance. G.mark(el) walks a text node and
   wraps the first occurrence of any known term in a <button class="gterm">;
   clicking it opens a popover with the definition. Marking is done ONCE per
   element, first occurrence only, so a table does not turn into a field of
   dotted underlines.

   Exposes window.Glossary.
   ========================================================================= */
(function () {
  'use strict';

  /* term -> { short, long }. `short` is what a reader needs mid-sentence;
     `long` is the sentence that makes it usable. Keys are matched
     case-sensitively for the ones that are symbols (L(f), sigma) and
     case-insensitively for words. */
  var TERMS = {
    'L(f)': {
      short: 'single-sideband phase noise, dBc/Hz',
      long: 'Power in a 1 Hz bandwidth at an offset f from the carrier, relative to the carrier power. The whole M1/M2 chain is an integral of this curve, so every phase-noise number in the tool traces back to it.'
    },
    'M1': { short: 'phase noise L(f) at the carrier', long: 'The first of the six required metrics: the L(f) curve at 78 GHz plus its value at named offsets from 1 kHz to 100 MHz.' },
    'M2': { short: 'integrated RMS phase error and jitter', long: 'L(f) integrated over a stated band, in degrees RMS and in femtoseconds. The band is a parameter, not a constant: carrier-recovery bandwidth for an EVM number, calibration rate for a beam number.' },
    'M3': { short: 'inter-tile phase error', long: 'The differential phase error between tiles at 78 GHz, reported raw (open loop) and residual (what survives calibration). This is the metric the architecture choice turns on.' },
    'M4': { short: 'inter-tile skew', long: 'Path delay mismatch between tiles, in picoseconds RMS and peak, split into the geometric part designed out in layout, the static part one calibration removes, and the thermal drift that survives.' },
    'M5': { short: 'distribution loss', long: 'Total loss along the worst path, in dB, plus dB/cm at the distribution frequency and the gain the network must contain to make it up.' },
    'M6': { short: 'distribution power', long: 'Total milliwatts, per tile, and as a fraction of the array power budget.' },
    'BIST': {
      short: 'built-in self test',
      long: 'The on-chip measurement loop that estimates each tile\'s phase error so it can be corrected. Its update rate, its own measurement noise and its loop gain are all parameters here, because they trade against each other: too slow leaves drift, too fast injects the estimator\'s own noise.'
    },
    'TTD': {
      short: 'true time delay',
      long: 'A delay element, as opposed to a phase shifter. A phase shifter aligns one frequency; a delay aligns the whole band, which is what a wide-band array steered off boresight needs. The per-tile coarse TTD is what compensates inter-tile routing length.'
    },
    'wraps': {
      short: 'whole cycles of 360 degrees at the LO',
      long: 'A static offset of many wraps is not a large error, it is an unknown integer: a narrowband phase measurement resolves phase modulo one LO period (12.8 ps at 78 GHz), so the calibration has to resolve the integer as well as the fraction. The tool reports the correction RANGE in wraps rather than quoting thousands of degrees.'
    },
    'foldback': {
      short: 'distributing at the LO frequency itself',
      long: 'Option A2: the board carries 78 GHz to every tile rather than a sub-harmonic. No multiplier at the tile, but E-band loss, E-band amplifiers and E-band transitions everywhere.'
    },
    'squint': {
      short: 'beam pointing that moves with frequency',
      long: 'A phase-steered array is aligned at one frequency only, so the beam walks across the signal band. Only true time delay removes it. Reported here as the steer across the 2 GHz RF band against the beamwidth.'
    },
    'Ruze': {
      short: 'gain loss from random phase error',
      long: 'The classical result that random aperture phase error of sigma radians costs exp(-sigma^2) in gain. Negligible at the error levels here — the sidelobe and null-depth floor is what random error actually costs, not gain.'
    },
    'null-depth floor': {
      short: 'the sidelobe level random error sets, 10log10(sigma^2/N)',
      long: 'Random per-element phase error scatters power into a noise floor across the whole pattern. That floor, not gain loss, is what limits how deep a null can be steered — and therefore how many users the array can separate. It is the decisive metric for this comparison.'
    },
    'EVM': { short: 'error vector magnitude', long: 'How far the received constellation points sit from where they should, as a percentage or in dB. Sets the highest QAM order the link can carry.' },
    'IIP3': { short: 'input third-order intercept', long: 'The linearity of a stage, referred to its input. Cascading n unity-gain stages costs 10log10(n), not 20log10(n).' },
    'ENOB': { short: 'effective number of bits', long: 'A converter\'s real resolution after its own noise and distortion, always below its nominal bit count.' },
    'Dk': { short: 'dielectric constant of the laminate', long: 'Sets propagation velocity, so its tolerance is a delay tolerance. Its variation over a path is the largest static term in the skew budget here.' },
    'GCPW': { short: 'grounded coplanar waveguide', long: 'A planar transmission line with side ground and a ground plane beneath. One of the media the tool costs the distribution network in.' },
    'HPBW': { short: 'half-power beamwidth', long: 'The angular width of the main beam between its -3 dB points.' },
    'Adler': { short: 'the injection-locking relation', long: 'Adler\'s equation gives the locked phase offset of an oscillator pulled by an injected tone: arcsin(delta_f / f_lock). It is why option A6\'s tile-to-tile frequency spread becomes a deterministic phase error.' },
    'sub-harmonic': { short: 'an integer fraction of the LO frequency', long: 'Distributing at 78/M GHz and multiplying by M at the tile. Buys loss, power and packaging tolerance — but not skew, because an ideal multiplier preserves time delay.' },
    'corporate': { short: 'a balanced branching feed', long: 'The tree topology where each split feeds two nominally equal halves, so every leaf sees nominally the same path length.' },
    'H-tree': { short: 'a corporate feed laid out as nested H shapes', long: 'The planar layout that makes a corporate feed\'s equal path lengths physically realisable on a board.' },
    'reciprocity': { short: 'a path having the same electrical length both ways', long: 'What round-trip phase stabilisation depends on: the master can only cancel the drift it can measure, and it measures the round trip. Non-reciprocity is the floor option A5 cannot go below.' },
    'mean-referred': { short: 'measured against the array mean, not against a neighbour', long: 'The differential of two independent identical sources is 3.01 dB above one of them; referred to the mean of N tiles it is (N-1)/N of the per-tile variance instead. Beamforming sees the mean-referred number, so that is the one reported.' }
  };

  var pop = null;

  function closePop() {
    if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
    pop = null;
  }

  function openPop(btn, term, def) {
    closePop();
    pop = document.createElement('div');
    pop.className = 'gpop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', term + ' — definition');
    var h = document.createElement('div');
    h.className = 'gpop-h';
    h.textContent = term;
    var s = document.createElement('div');
    s.className = 'gpop-s';
    s.textContent = def.short;
    var l = document.createElement('div');
    l.className = 'gpop-l';
    l.textContent = def.long;
    pop.appendChild(h);
    pop.appendChild(s);
    pop.appendChild(l);
    document.body.appendChild(pop);

    var r = btn.getBoundingClientRect();
    var w = pop.offsetWidth, hh = pop.offsetHeight;
    var x = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    /* above if there is no room below */
    var y = (r.bottom + hh + 10 > window.innerHeight && r.top - hh - 8 > 0)
      ? r.top - hh - 8 : r.bottom + 6;
    pop.style.left = Math.round(x + window.scrollX) + 'px';
    pop.style.top = Math.round(y + window.scrollY) + 'px';
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var b = t && t.closest ? t.closest('.gterm') : null;
    if (b) {
      e.preventDefault();
      e.stopPropagation();
      var term = b.getAttribute('data-term');
      if (pop && pop.dataset.term === term) { closePop(); return; }
      var def = TERMS[term];
      if (def) { openPop(b, term, def); pop.dataset.term = term; }
      return;
    }
    if (pop && !(t.closest && t.closest('.gpop'))) closePop();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePop(); });
  window.addEventListener('resize', closePop);

  /* Longest first, so "null-depth floor" is not eaten by a shorter key, and
     symbol terms keep their exact case. */
  var KEYS = Object.keys(TERMS).sort(function (a, b) { return b.length - a.length; });

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* Wrap the FIRST occurrence of each known term inside `root`. Skips any
     text already inside a .gterm, a script, an input or an existing popover.
     Idempotent: an element carrying data-gmarked is left alone. */
  function mark(root, only) {
    if (!root) return;
    /* "Already marked" has to be a question about the CONTENT, not a flag on
       the container. A data-gmarked attribute survives the container being
       emptied and rebuilt — which is exactly what renderTable does to the
       same <table> element on every render — so the flag said "done" for a
       table whose marks had just been thrown away. */
    if (root.querySelector('.gterm')) return;
    var wanted = only && only.length ? KEYS.filter(function (k) { return only.indexOf(k) >= 0; }) : KEYS;
    var seen = {};
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        while (p && p !== root) {
          var tn = p.nodeName;
          if (tn === 'SCRIPT' || tn === 'STYLE' || tn === 'INPUT' || tn === 'TEXTAREA' ||
              tn === 'BUTTON' || tn === 'SELECT' ||
              (p.classList && (p.classList.contains('gterm') || p.classList.contains('gpop')))) {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    var n2;
    while ((n2 = walker.nextNode())) nodes.push(n2);

    nodes.forEach(function (node) {
      for (var i = 0; i < wanted.length; i++) {
        var key = wanted[i];
        if (seen[key]) continue;
        var symbol = /[^A-Za-z]/.test(key.charAt(key.length - 1)) || /\(/.test(key);
        var re = symbol
          ? new RegExp(escapeRe(key))
          : new RegExp('\\b' + escapeRe(key) + '\\b', key === key.toLowerCase() ? 'i' : '');
        var m = re.exec(node.nodeValue);
        if (!m) continue;
        var before = node.nodeValue.slice(0, m.index);
        var after = node.nodeValue.slice(m.index + m[0].length);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gterm';
        btn.setAttribute('data-term', key);
        btn.setAttribute('aria-label', m[0] + ' — what this means');
        btn.title = TERMS[key].short;
        btn.textContent = m[0];
        var parent = node.parentNode;
        parent.insertBefore(document.createTextNode(before), node);
        parent.insertBefore(btn, node);
        node.nodeValue = after;
        seen[key] = 1;
        /* the tail is a fresh node for the remaining terms to match in */
        break;
      }
    });
  }

  window.Glossary = { TERMS: TERMS, mark: mark, close: closePop };
})();
