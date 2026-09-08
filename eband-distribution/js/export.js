/* ============================================================================
   export.js — reproducibility plumbing.
   URL-hash state (so a computed comparison is citable), CSV / Markdown / JSON
   export, clipboard, toast. Clipboard is the primary path because a page
   embedded in a sandboxed viewer cannot start a download.
   Exposes window.Xport.
   ========================================================================= */
(function () {
  'use strict';

  function flash(msg) {
    var old = document.querySelector('.flash');
    if (old) old.remove();
    var d = document.createElement('div');
    d.className = 'flash';
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.remove(); }, 2100);
  }

  function copy(text, what) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      flash(ok ? (what || 'Copied') + ' copied to clipboard' : 'Copy blocked — select the text manually');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        flash((what || 'Copied') + ' copied to clipboard');
      }, fallback);
    } else fallback();
  }

  /* ---------------- saving a file ----------------
     Two hosts, two mechanisms. Served as a normal page (GitHub Pages, or
     straight off disk) an anchor download works. Inside the Artifact viewer
     it does not — the frame never downloads directly — so the page asks the
     host through the `downloads` capability, which prompts the viewer.
     `window.claude` is absent on a normal page, which is exactly how we tell
     the two apart.                                                          */
  var HOSTED = !!(window.claude && typeof window.claude.use === 'function');
  var dlNs;                                   /* undefined = not yet resolved */

  function getDownloads() {
    if (dlNs !== undefined) return Promise.resolve(dlNs);
    if (!HOSTED) { dlNs = null; return Promise.resolve(null); }
    return window.claude.use('downloads').then(
      function (d) { dlNs = d || null; return dlNs; },
      function () { dlNs = null; return null; }
    );
  }

  function browserDownload(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 400);
      flash('Saved ' + filename);
    } catch (e) {
      copy(text, filename);
    }
  }

  function download(filename, text, mime) {
    getDownloads().then(function (d) {
      if (!d) { browserDownload(filename, text, mime); return; }
      d.save({ filename: filename, data: text }).then(
        function (r) { if (r && r.status === 'saved') flash('Saved ' + filename); },
        function (err) {
          var code = err && err.code;
          /* the viewer said no, or a prompt is already open — never retry */
          if (code === 'declined' || code === 'rate_limited') return;
          copy(text, filename);
        }
      );
    });
  }

  /* In the Artifact viewer with no downloads grant, a save button is a lie:
     hide it and leave the clipboard buttons, which always work. */
  function hideDeadSaveButtons() {
    if (!HOSTED) return;
    getDownloads().then(function (d) {
      if (d) return;
      var els = document.querySelectorAll('button[data-dl]');
      for (var i = 0; i < els.length; i++) els[i].classList.add('hidden');
    });
  }

  /* ---------------- URL hash state ---------------- *
   * Only non-default values are stored, so permalinks stay short and a later
   * change to a default does not silently freeze an old value.               */
  function encodeState(overrides) {
    var parts = [];
    Object.keys(overrides).sort().forEach(function (k) {
      var v = overrides[k];
      if (v === null || v === undefined || v === '') return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
    });
    return parts.join('&');
  }

  function decodeState(hash) {
    var out = {};
    var h = (hash || '').replace(/^#/, '');
    if (!h) return out;
    h.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      if (i < 0) return;
      var k = decodeURIComponent(kv.slice(0, i));
      var v = decodeURIComponent(kv.slice(i + 1));
      out[k] = v;
    });
    return out;
  }

  function permalink(overrides) {
    var base = location.href.split('#')[0];
    var s = encodeState(overrides);
    return s ? base + '#' + s : base;
  }

  /* ---------------- CSV ---------------- */
  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  /* ---------------- Markdown (for pasting into the thesis) ---------------- */
  function toMarkdown(rows, opts) {
    if (!rows.length) return '';
    var o = opts || {};
    var head = rows[0];
    var body = rows.slice(1);
    var lines = [];
    if (o.title) { lines.push('### ' + o.title, ''); }
    lines.push('| ' + head.join(' | ') + ' |');
    lines.push('|' + head.map(function (_, i) { return i === 0 ? ' :--- ' : ' ---: '; }).join('|') + '|');
    body.forEach(function (r) {
      // a section divider row (single populated cell) becomes a bold label row
      var filled = r.filter(function (c) { return c !== '' && c !== null && c !== undefined; });
      if (filled.length === 1) {
        lines.push('| **' + filled[0] + '** |' + head.slice(1).map(function () { return '  |'; }).join(''));
      } else {
        lines.push('| ' + r.join(' | ') + ' |');
      }
    });
    if (o.footnotes && o.footnotes.length) {
      lines.push('');
      o.footnotes.forEach(function (f) { lines.push('- ' + f); });
    }
    return lines.join('\n');
  }

  window.Xport = {
    flash: flash,
    copy: copy,
    download: download,
    hideDeadSaveButtons: hideDeadSaveButtons,
    encodeState: encodeState,
    decodeState: decodeState,
    permalink: permalink,
    toCsv: toCsv,
    toMarkdown: toMarkdown
  };
})();
