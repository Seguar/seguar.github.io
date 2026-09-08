/* ============================================================================
   ui.js — parameter panel, comparison tables, provenance ledger, formatting.
   Presentation only: every number it shows comes from Model.evaluate().
   Exposes window.UI.
   ========================================================================= */
(function () {
  'use strict';

  /* ------------------------------ formatting ------------------------------ */

  function sig(v, n) {
    if (!isFinite(v)) return '—';
    if (v === 0) return '0';
    var a = Math.abs(v);
    if (a >= 1e6 || a < 1e-4) return v.toExponential(Math.max(0, (n || 3) - 1)).replace('e+', 'e');
    var d = Math.max(0, (n || 3) - 1 - Math.floor(Math.log10(a)));
    return v.toFixed(Math.min(6, d));
  }

  /* fixed-decimal formatter with a sensible default per magnitude */
  function num(v, dec) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    if (dec !== undefined) return v.toFixed(dec);
    var a = Math.abs(v);
    if (a >= 1000) return v.toFixed(0);
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.01) return v.toFixed(3);
    return sig(v, 2);
  }

  var CONF_CLASS = {
    'measured/datasheet': 'c-datasheet', 'datasheet': 'c-datasheet', 'measured': 'c-datasheet',
    'published-literature': 'c-literature', 'literature': 'c-literature',
    'scaled-estimate': 'c-scaled', 'scaled': 'c-scaled',
    'engineering-guess': 'c-guess', 'guess': 'c-guess'
  };
  var CONF_SHORT = {
    'measured/datasheet': 'datasheet', 'datasheet': 'datasheet', 'measured': 'measured',
    'published-literature': 'literature', 'literature': 'literature',
    'scaled-estimate': 'scaled', 'scaled': 'scaled',
    'engineering-guess': 'guess', 'guess': 'guess'
  };
  function confClass(c) { return CONF_CLASS[String(c || '').toLowerCase()] || 'c-guess'; }
  function confShort(c) { return CONF_SHORT[String(c || '').toLowerCase()] || String(c || '?'); }

  function elt(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }

  /* --------------------------- parameter panel --------------------------- */
  /* params: [{key,label,value,units,group,min,max,step,choices,hint,
   *           justification,confidence}]
   * state:  {key: value}  (current, possibly overridden)
   * onChange(key, value)                                                   */
  function renderParams(mount, params, state, defaults, onChange) {
    mount.textContent = '';
    var groups = [];
    var byGroup = {};
    params.forEach(function (p) {
      if (!byGroup[p.group]) { byGroup[p.group] = []; groups.push(p.group); }
      byGroup[p.group].push(p);
    });

    groups.forEach(function (g, gi) {
      var det = elt('details', 'pgroup');
      if (gi < 2) det.open = true;
      var sum = elt('summary');
      sum.appendChild(document.createTextNode(g));
      var dirty = byGroup[g].filter(function (p) { return state[p.key] !== defaults[p.key]; }).length;
      var cnt = elt('span', 'cnt', dirty ? dirty + ' changed' : byGroup[g].length);
      sum.appendChild(cnt);
      det.appendChild(sum);

      var fields = elt('div', 'fields');
      byGroup[g].forEach(function (p) {
        var isDirty = state[p.key] !== defaults[p.key];
        var f = elt('div', 'field' + (isDirty ? ' dirty' : ''));
        var lab = elt('label');
        lab.setAttribute('for', 'p_' + p.key);
        lab.appendChild(document.createTextNode(p.label + ' '));
        if (p.units && p.units !== '-') lab.appendChild(elt('span', 'u', p.units));
        f.appendChild(lab);

        var input;
        if (p.choices && p.choices.length) {
          input = document.createElement('select');
          p.choices.forEach(function (c) {
            var o = document.createElement('option');
            o.value = String(c.value);
            o.textContent = c.label;
            if (Number(c.value) === Number(state[p.key])) o.selected = true;
            input.appendChild(o);
          });
          input.addEventListener('change', function () { onChange(p.key, Number(input.value)); });
        } else {
          input = document.createElement('input');
          input.type = 'number';
          if (p.min !== undefined) input.min = p.min;
          if (p.max !== undefined) input.max = p.max;
          input.step = p.step !== undefined ? p.step : 'any';
          input.value = String(state[p.key]);
          input.addEventListener('change', function () {
            var v = parseFloat(input.value);
            if (!isFinite(v)) { input.value = String(state[p.key]); return; }
            if (p.min !== undefined && v < p.min) v = p.min;
            if (p.max !== undefined && v > p.max) v = p.max;
            input.value = String(v);
            onChange(p.key, v);
          });
        }
        input.id = 'p_' + p.key;
        input.title = (p.justification || '') + (p.confidence ? '  [' + confShort(p.confidence) + ']' : '');
        f.appendChild(input);
        if (p.hint) f.appendChild(elt('div', 'hint', p.hint));
        fields.appendChild(f);
      });
      det.appendChild(fields);
      mount.appendChild(det);
    });
  }

  /* ----------------------------- budget banner ----------------------------- */
  function renderBudget(gridEl, noteEl, bindEl, budget) {
    gridEl.textContent = '';
    budget.cells.forEach(function (c) {
      var d = elt('div', 'cell' + (c.binding ? ' bind' : ''));
      d.appendChild(elt('div', 'k', c.k));
      var n = elt('div', 'n');
      n.appendChild(document.createTextNode(c.n));
      if (c.unit) { var s = elt('small'); s.textContent = ' ' + c.unit; n.appendChild(s); }
      d.appendChild(n);
      d.appendChild(elt('div', 'd', c.d));
      gridEl.appendChild(d);
    });
    if (noteEl) noteEl.innerHTML = budget.note;
    if (bindEl) bindEl.textContent = budget.bindingNote || '';
  }

  /* --------------------------- comparison table --------------------------- */
  /* rows: [{section:'...'} | {name, sub, field, units, dec, better, spec,
   *         fmt(value,res)->string}]                                        */
  function renderTable(tableEl, options, results, rows, recommendedId, cfg) {
    tableEl.textContent = '';
    cfg = cfg || {};

    var thead = document.createElement('thead');
    var htr = document.createElement('tr');
    htr.appendChild(elt('th', null, cfg.firstHeader || 'Metric'));
    options.forEach(function (o) {
      var th = elt('th', o.id === recommendedId ? 'rec' : null);
      th.appendChild(document.createTextNode(o.name));
      if (o.badge || o.id === recommendedId) {
        th.appendChild(document.createElement('br'));
        th.appendChild(elt('span', 'badge ' + (o.badgeClass || 'acc'),
          o.badge || cfg.recLabel || 'selected'));
      }
      th.title = o.topology || '';
      htr.appendChild(th);
    });
    htr.appendChild(elt('th', null, cfg.lastHeader || 'Requirement'));
    thead.appendChild(htr);
    tableEl.appendChild(thead);

    var tbody = document.createElement('tbody');
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      if (r.section) {
        tr.className = 'sect';
        var td = elt('td', null, r.section);
        td.colSpan = options.length + 2;
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      var nameTd = elt('td', 'mn');
      nameTd.appendChild(document.createTextNode(r.name));
      if (r.sub) nameTd.appendChild(elt('small', null, r.sub));
      tr.appendChild(nameTd);

      /* find best value among options for a discreet marker */
      var vals = options.map(function (o) {
        var res = results[o.id];
        return res && isFinite(res[r.field]) ? res[r.field] : NaN;
      });
      var finite = vals.filter(isFinite);
      var best = NaN;
      /* r.rank === false says "this quantity is ordered but the winner is
         not meaningful" — a raw uncalibrated figure, a per-cm loss measured
         at a different frequency in each column, or any row whose own
         threshold is not the same for every column. Marking a winner there
         is worse than marking none. */
      var rankable = r.rank !== false;
      if (rankable && r.specField !== undefined) {
        var sp = options.map(function (o) {
          var rr = results[o.id];
          return rr && isFinite(rr[r.specField]) ? rr[r.specField] : NaN;
        }).filter(isFinite);
        if (sp.length > 1 && Math.abs(Math.max.apply(null, sp) - Math.min.apply(null, sp)) > 1e-9) {
          rankable = false;
        }
      }
      if (rankable && r.better === 'low' && finite.length) best = Math.min.apply(null, finite);
      if (rankable && r.better === 'high' && finite.length) best = Math.max.apply(null, finite);

      options.forEach(function (o, i) {
        var res = results[o.id] || {};
        var v = vals[i];
        var cls = 'v';
        /* r.specField lets each COLUMN carry its own threshold, read from
           that column's own result. The Systems view needs this: a saved
           system's derived requirement moves with its own parameters, so a
           single row-wide spec would judge every system against whichever
           one happened to supply the number. */
        var rspec = r.specField !== undefined && isFinite(res[r.specField])
          ? res[r.specField] : r.spec;
        if (rspec !== undefined && rspec !== null && isFinite(rspec) && isFinite(v)) {
          var ok = r.better === 'high' ? v >= rspec : v <= rspec;
          var marg = r.better === 'high' ? v / rspec : rspec / v;
          cls += ok ? (marg > 1.5 ? ' pass' : ' warn') : ' fail';
        }
        var td = elt('td', cls + (o.id === recommendedId ? ' rec' : '') +
          (isFinite(best) && v === best && finite.length > 1 ? ' best' : ''));
        var txt = r.fmt ? r.fmt(v, res) : num(v, r.dec);
        td.appendChild(document.createTextNode(txt));
        if (r.noteField && res[r.noteField]) td.title = String(res[r.noteField]);
        tr.appendChild(td);
      });

      var specTd = elt('td', 'v');
      var specTxt;
      if (r.specLabel !== undefined) specTxt = r.specLabel;
      else if (r.specField !== undefined) {
        /* a per-column threshold has no single value to print — show the
           range, so a reader can see at a glance whether the systems are
           even being held to the same standard */
        var sv = options.map(function (o) {
          var rr = results[o.id];
          return rr && isFinite(rr[r.specField]) ? rr[r.specField] : NaN;
        }).filter(isFinite);
        if (!sv.length) specTxt = '—';
        else {
          var slo = Math.min.apply(null, sv), shi = Math.max.apply(null, sv);
          var pre = r.better === 'high' ? '≥ ' : '≤ ';
          specTxt = Math.abs(shi - slo) < 1e-9
            ? pre + num(slo, r.dec)
            : pre + num(slo, r.dec) + '…' + num(shi, r.dec) + ' *';
        }
      } else if (r.spec !== undefined && r.spec !== null) {
        specTxt = (r.better === 'high' ? '≥ ' : '≤ ') + num(r.spec, r.dec);
      } else specTxt = '—';
      specTd.appendChild(document.createTextNode(specTxt));
      if (r.specField !== undefined) specTd.title = 'Each column is judged against its own derived requirement';
      tr.appendChild(specTd);
      tbody.appendChild(tr);
    });
    tableEl.appendChild(tbody);
  }

  /* table -> array-of-arrays, for CSV / Markdown export */
  /* Cell text for an export. A cell can carry a status badge and a
     sub-label as well as its value, and reading textContent straight off it
     runs them together — "A4 mid+x4 4cmloaded in main window", "Tile pitch
     (cm)tileCm". Badges are display state and are dropped; sub-labels carry
     information (a parameter key, a caveat) and are kept, separated. */
  function cellExportText(c) {
    var clone = c.cloneNode(true);
    clone.querySelectorAll('.badge, .conf').forEach(function (b) { b.remove(); });
    clone.querySelectorAll('small').forEach(function (s) {
      s.textContent = ' — ' + s.textContent;
    });
    return clone.textContent.replace(/\s+/g, ' ').replace(/—/g, '-').trim();
  }

  function tableToRows(tableEl) {
    var out = [];
    tableEl.querySelectorAll('tr').forEach(function (tr) {
      var cells = [];
      tr.querySelectorAll('th,td').forEach(function (c) {
        cells.push(cellExportText(c));
      });
      if (tr.classList.contains('sect')) {
        // pad a section row so the CSV stays rectangular
        var width = out.length ? out[0].length : cells.length;
        while (cells.length < width) cells.push('');
      }
      out.push(cells);
    });
    return out;
  }

  /* --------------------------- provenance ledger --------------------------- */
  function renderAssumptions(tableEl, summaryEl, entries) {
    tableEl.textContent = '';
    var thead = document.createElement('thead');
    var htr = document.createElement('tr');
    ['Parameter', 'Value', 'Units', 'Confidence', 'Basis'].forEach(function (h, i) {
      var th = elt('th', null, h);
      if (i === 4) th.style.textAlign = 'left';
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    tableEl.appendChild(thead);

    var tbody = document.createElement('tbody');
    var counts = {};
    var lastGroup = null;
    entries.forEach(function (e) {
      if (e.group !== lastGroup) {
        lastGroup = e.group;
        var str = document.createElement('tr');
        str.className = 'sect';
        var std = elt('td', null, e.group);
        std.colSpan = 5;
        str.appendChild(std);
        tbody.appendChild(str);
      }
      var tr = document.createElement('tr');
      var n = elt('td', 'mn');
      n.appendChild(document.createTextNode(e.label));
      n.appendChild(elt('small', null, e.key));
      tr.appendChild(n);
      tr.appendChild(elt('td', 'v', num(e.value)));
      tr.appendChild(elt('td', 'v', e.units || ''));
      var c = elt('td');
      c.appendChild(elt('span', 'conf ' + confClass(e.confidence), confShort(e.confidence)));
      tr.appendChild(c);
      var b = elt('td');
      b.style.textAlign = 'left';
      b.style.whiteSpace = 'normal';
      b.style.minWidth = '320px';
      b.textContent = e.justification || '';
      tr.appendChild(b);
      tbody.appendChild(tr);
      var k = confShort(e.confidence);
      counts[k] = (counts[k] || 0) + 1;
    });
    tableEl.appendChild(tbody);

    if (summaryEl) {
      summaryEl.textContent = Object.keys(counts).map(function (k) {
        return counts[k] + ' ' + k;
      }).join(' · ');
    }
  }

  /* ----------------------------- prose helper ----------------------------- */
  /* Renders a light markdown subset (headings, bold, `code`, lists, callouts)
     so the decision text can live as plain strings in decision.js.          */
  function renderProse(mount, md) {
    var html = '';
    var lines = String(md).split('\n');
    var inList = null;
    function closeList() { if (inList) { html += '</' + inList + '>'; inList = null; } }
    lines.forEach(function (raw) {
      var line = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      line = line
        .replace(/`([^`]+)`/g, '<span class="kv">$1</span>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      var t = line.trim();
      if (!t) { closeList(); return; }
      var m;
      if ((m = t.match(/^!!!\s*(warn|fail|info)\s+(.*)$/))) {
        closeList();
        html += '<div class="callout' + (m[1] === 'warn' ? ' warnc' : m[1] === 'fail' ? ' failc' : '') + '">' + m[2] + '</div>';
      } else if ((m = t.match(/^####\s+(.*)$/))) { closeList(); html += '<h4>' + m[1] + '</h4>'; }
      else if ((m = t.match(/^###\s+(.*)$/))) { closeList(); html += '<h3>' + m[1] + '</h3>'; }
      else if ((m = t.match(/^\d+\.\s+(.*)$/))) {
        if (inList !== 'ol') { closeList(); html += '<ol>'; inList = 'ol'; }
        html += '<li>' + m[1] + '</li>';
      } else if ((m = t.match(/^[-*]\s+(.*)$/))) {
        if (inList !== 'ul') { closeList(); html += '<ul>'; inList = 'ul'; }
        html += '<li>' + m[1] + '</li>';
      } else if (t.indexOf('    ') === 0 || raw.indexOf('\t') === 0) {
        closeList(); html += '<div class="eqn">' + t + '</div>';
      } else { closeList(); html += '<p>' + t + '</p>'; }
    });
    closeList();
    mount.innerHTML = html;
  }

  window.UI = {
    sig: sig,
    num: num,
    confClass: confClass,
    confShort: confShort,
    renderParams: renderParams,
    renderBudget: renderBudget,
    renderTable: renderTable,
    tableToRows: tableToRows,
    renderAssumptions: renderAssumptions,
    renderProse: renderProse,
    elt: elt
  };
})();
