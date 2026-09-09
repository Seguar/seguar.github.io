/* ============================================================================
   systems.js — saved systems: storage, serialisation, and evaluation cache.

   A "system" is a whole parameter set, snapshotted from the main window, so
   that several candidate builds can be put side by side. Three decisions in
   here are worth stating, because each one closes off a way this feature
   could quietly lie:

   1. A SAVED SYSTEM STORES ITS FULL STATE, not the sparse diff against the
      defaults. Permalinks store the sparse diff, which is right for a link
      (short, and a later change of default is picked up). It is wrong for a
      saved system: the whole point is "this is the build I costed", and a
      sparse record silently re-costs itself whenever a default moves. Sixty
      numbers is under a kilobyte, so there is no reason to be clever. What
      the sparse diff is still good for is DISPLAY — "here is what you had
      changed" — and that is recomputed live against today's defaults rather
      than frozen at save time.

   2. PARAMETERS ADDED AFTER A SAVE ARE FILLED FROM TODAY'S DEFAULTS AND
      REPORTED. A system saved before a parameter existed expressed no
      opinion about it; pretending otherwise is the same error as (1) in the
      other direction. resolveState() returns the filled keys so the view can
      say so.

   3. EVALUATION IS CACHED PER SYSTEM, keyed on the state itself. A saved
      system's numbers are immutable, and one full evaluation costs 33 ms at
      the default geometry and over a second at a 0.5 cm tile pitch, so
      re-evaluating eight of them on every re-render would make the view
      unusable. The cache key is the serialised state, so a system that is
      edited gets a fresh entry rather than a stale hit.

   Storage is localStorage, with an in-memory fallback: in a private window,
   or in an embedding context that blocks site data, every accessor throws.
   The feature still works for the session; available() says whether it will
   survive a reload, and the view tells the user.

   Exposes window.Systems.
   ========================================================================= */
(function () {
  'use strict';

  var KEY = 'ebdt-systems-v1';
  var MAX = 12;                    /* columns stop being readable long before */

  var mem = null;                  /* in-memory mirror / fallback store */
  var persistent = null;           /* null = not yet probed */

  function probe() {
    if (persistent !== null) return persistent;
    try {
      localStorage.setItem(KEY + '-probe', '1');
      localStorage.removeItem(KEY + '-probe');
      persistent = true;
    } catch (e) {
      persistent = false;
    }
    return persistent;
  }

  function readRaw() {
    if (mem) return mem;
    var txt = null, threw = false;
    try { txt = localStorage.getItem(KEY); } catch (e) { threw = true; }
    /* a read that THREW is not the same as a store that is empty: it says
       nothing about what was saved, so it must never be allowed to stand in
       for an empty list */
    if (threw) { mem = mem || []; return mem; }
    var list = [];
    if (txt) {
      try {
        var parsed = JSON.parse(txt);
        if (parsed && Array.isArray(parsed.systems)) list = parsed.systems;
      } catch (e) { list = []; }
    }
    /* drop anything that does not look like a record, rather than letting a
       corrupt entry take the whole view down */
    list = list.filter(function (r) {
      return r && typeof r === 'object' && r.id && r.state && typeof r.state === 'object';
    });
    mem = list;
    return mem;
  }

  function writeRaw() {
    if (!mem) return { ok: true };
    var payload = JSON.stringify({ v: 1, systems: mem });
    if (!probe()) return { ok: false, reason: 'no-storage' };
    try {
      localStorage.setItem(KEY, payload);
      return { ok: true, bytes: payload.length };
    } catch (e) {
      /* quota, or storage disabled between probe and write */
      return { ok: false, reason: 'quota', bytes: payload.length };
    }
  }

  /* Ids are derived from a counter plus the name, never from a clock —
     Date.now() is unavailable in some of the contexts this file runs in.

     A session-local counter alone is NOT enough. It resets to zero on every
     reload, so a second session that starts with the same number of saved
     systems and saves the same name at the same ordinal produces a
     byte-identical id — and a duplicate id is not a cosmetic problem here:
     the comparison keys its results by id, so two differently-parameterised
     systems would render two columns of the SAME numbers under different
     names. The id is therefore checked against the list it is joining and
     extended until it is unique. */
  var seq = 0;
  function makeId(name, list) {
    var slug = String(name || 'system').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    var base = (slug || 'system') + '-' + (++seq) + '-' + (list ? list.length : 0);
    var id = base, n = 0;
    function taken(cand) {
      for (var i = 0; i < (list || []).length; i++) if (list[i].id === cand) return true;
      return false;
    }
    while (taken(id)) { n++; id = base + '-' + n; }
    return id;
  }

  /* Drop the in-memory mirror so the next read comes from storage. Called
     before every mutation, because two tabs of the tool each hold their own
     mirror: without this, the second tab writes its whole stale list back
     and silently discards everything the first tab saved. Re-reading first
     narrows that to a per-operation race instead of a per-session one.

     It must NOT run when there is no storage to re-read from. With site
     data blocked, getItem throws, readRaw() treats that as an empty store,
     and the mirror — which is then the only copy — is destroyed. Dropping
     it before every mutation turned the documented "works for this
     session" fallback into "loses everything on the next save". */
  function refresh() {
    if (!probe()) return readRaw();
    mem = null;
    return readRaw();
  }

  function list() { return readRaw().slice(); }
  function count() { return readRaw().length; }
  function available() { return probe(); }
  function limit() { return MAX; }

  /* ------------------------------------------------------------------ *
   * save / edit / delete
   * ------------------------------------------------------------------ */
  function save(name, state, meta) {
    var l = refresh();
    if (l.length >= MAX) return { ok: false, reason: 'full', max: MAX };
    var copy = {};
    Object.keys(state).forEach(function (k) {
      var v = state[k];
      if (typeof v === 'number' && isFinite(v)) copy[k] = v;
    });
    var rec = {
      id: makeId(name, l),
      name: String(name || 'Untitled').slice(0, 48),
      note: meta && meta.note ? String(meta.note).slice(0, 240) : '',
      lo: meta && meta.lo ? meta.lo : '',
      bb: meta && meta.bb ? meta.bb : '',
      stamp: meta && meta.stamp ? String(meta.stamp) : '',
      state: copy
    };
    l.push(rec);
    var w = writeRaw();
    return { ok: true, record: rec, persisted: w.ok, reason: w.reason };
  }

  function update(id, patch) {
    var l = refresh(), hit = null;
    l.forEach(function (r) { if (r.id === id) hit = r; });
    if (!hit) return { ok: false, reason: 'missing' };
    if (patch.name !== undefined) hit.name = String(patch.name).slice(0, 48);
    if (patch.note !== undefined) hit.note = String(patch.note).slice(0, 240);
    if (patch.state !== undefined) {
      var copy = {};
      Object.keys(patch.state).forEach(function (k) {
        var v = patch.state[k];
        if (typeof v === 'number' && isFinite(v)) copy[k] = v;
      });
      hit.state = copy;
    }
    var w = writeRaw();
    return { ok: true, record: hit, persisted: w.ok };
  }

  function remove(id) {
    var l = refresh();
    for (var i = 0; i < l.length; i++) {
      if (l[i].id === id) { l.splice(i, 1); writeRaw(); return { ok: true }; }
    }
    return { ok: false, reason: 'missing' };
  }

  function move(id, delta) {
    var l = refresh();
    var i = -1;
    l.forEach(function (r, k) { if (r.id === id) i = k; });
    if (i < 0) return { ok: false };
    var j = i + delta;
    if (j < 0 || j >= l.length) return { ok: false };
    var tmp = l[i]; l[i] = l[j]; l[j] = tmp;
    writeRaw();
    return { ok: true };
  }

  function clear() { mem = []; writeRaw(); return { ok: true }; }

  function replaceAll(records) {
    var clean = (records || []).filter(function (r) {
      return r && r.id && r.state && typeof r.state === 'object';
    }).slice(0, MAX);
    mem = clean;
    var w = writeRaw();
    return { ok: true, n: clean.length, persisted: w.ok };
  }

  /* ------------------------------------------------------------------ *
   * resolving a stored record against the CURRENT parameter set
   * ------------------------------------------------------------------ */
  function resolveState(rec, defaults) {
    var state = {}, filled = [], unknown = [];
    Object.keys(defaults).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(rec.state, k)) state[k] = rec.state[k];
      else { state[k] = defaults[k]; filled.push(k); }
    });
    Object.keys(rec.state).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(defaults, k)) unknown.push(k);
    });
    return { state: state, filled: filled, unknown: unknown };
  }

  /* which parameters this system sets away from TODAY's defaults */
  function overrides(rec, defaults) {
    var o = {};
    Object.keys(defaults).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(rec.state, k) && rec.state[k] !== defaults[k]) {
        o[k] = rec.state[k];
      }
    });
    return o;
  }

  /* keys on which any two of the given states disagree — the row filter for
     "differences only" */
  function differingKeys(states) {
    var keys = {}, out = [];
    states.forEach(function (s) { Object.keys(s).forEach(function (k) { keys[k] = 1; }); });
    Object.keys(keys).forEach(function (k) {
      var first, seen = false, diff = false;
      states.forEach(function (s) {
        var v = s[k];
        if (!seen) { first = v; seen = true; return; }
        if (v !== first) diff = true;
      });
      if (diff) out.push(k);
    });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * evaluation cache. Key = the serialised state, so an edited system
   * misses rather than returning its predecessor's numbers.
   * ------------------------------------------------------------------ */
  var evalCache = {};
  var evalOrder = [];
  var EVAL_MAX = 24;

  function stateKey(state) {
    var ks = Object.keys(state).sort(), out = '';
    for (var i = 0; i < ks.length; i++) out += ks[i] + '=' + state[ks[i]] + ';';
    return out;
  }

  /* tag distinguishes what was computed from the same state — a light
     evaluation and a full one are different values and must not collide */
  function evaluated(state, compute, tag) {
    var k = (tag || 'default') + '|' + stateKey(state);
    if (evalCache[k]) return evalCache[k];
    var v = compute(state);
    evalCache[k] = v;
    evalOrder.push(k);
    while (evalOrder.length > EVAL_MAX) {
      var old = evalOrder.shift();
      if (old !== k) delete evalCache[old];
    }
    return v;
  }

  function dropCache() { evalCache = {}; evalOrder = []; }

  /* ------------------------------------------------------------------ *
   * sharing a whole comparison set by URL. Each system contributes its
   * name and its sparse diff against the defaults, which is what keeps the
   * link short enough to paste; a decoded system is therefore pinned to the
   * defaults of whoever opens it, and the view says so.
   * ------------------------------------------------------------------ */
  /* encodeURIComponent leaves ! ~ * ' ( ) unescaped, and this format uses
     '!' as the name/parameters separator and '~' inside each pair. A system
     called "Winner!" therefore split at the wrong '!', shifted the whole
     key list by one character, and every key then failed the
     hasOwnProperty(defaults) test — so the shared column silently rendered
     a system entirely at the recipient's defaults, under the right name,
     with "none" under 'Changed from defaults'. Exactly the confidently
     wrong comparison this file exists to prevent. The separators are now
     escaped out of the name explicitly. */
  function encName(s) {
    return encodeURIComponent(String(s))
      .replace(/!/g, '%21').replace(/~/g, '%7E')
      .replace(/\*/g, '%2A').replace(/'/g, '%27')
      .replace(/\(/g, '%28').replace(/\)/g, '%29');
  }

  function encodeSet(records, defaults) {
    var parts = (records || []).map(function (r) {
      var o = overrides(r, defaults);
      var kv = Object.keys(o).sort().map(function (k) { return k + '~' + o[k]; }).join(',');
      return encName(r.name) + '!' + kv;
    });
    return parts.join('|');
  }

  /* clamp is supplied by the caller (which owns the parameter metadata this
     file deliberately does not know about). Without it a link could carry
     an out-of-range option index or a tile pitch of 999 cm straight into a
     shared system's state — the model falls back rather than throwing, but
     the column would then report numbers for a configuration that cannot
     exist, which is worse than refusing the value. */
  function decodeSet(str, defaults, clamp) {
    var out = [];
    if (!str) return out;
    var fix = typeof clamp === 'function' ? clamp : function (k, v) { return v; };
    String(str).split('|').forEach(function (chunk, idx) {
      if (!chunk) return;
      var bang = chunk.indexOf('!');
      if (bang < 0) return;
      var name;
      try { name = decodeURIComponent(chunk.slice(0, bang)); } catch (e) { name = chunk.slice(0, bang); }
      if (!name) name = 'System ' + (idx + 1);
      var state = {};
      Object.keys(defaults).forEach(function (k) { state[k] = defaults[k]; });
      var pairs = 0, taken = 0, clamped = 0;
      chunk.slice(bang + 1).split(',').forEach(function (kv) {
        if (!kv) return;
        var i = kv.indexOf('~');
        if (i < 0) return;
        pairs++;
        var k = kv.slice(0, i), v = parseFloat(kv.slice(i + 1));
        if (Object.prototype.hasOwnProperty.call(defaults, k) && isFinite(v)) {
          var fixed = fix(k, v);
          if (isFinite(fixed) && fixed !== v) clamped++;
          state[k] = isFinite(fixed) ? fixed : v;
          taken++;
        }
      });
      seq++;
      out.push({
        id: 'shared-' + seq + '-' + idx, name: name, note: '', state: state, shared: true,
        /* a chunk that carried parameters but yielded none is a decode
           failure, not a system that happens to be at the defaults — the
           roster says so rather than showing a plausible blank */
        decodeLost: pairs > 0 && taken === 0 ? pairs : 0,
        decodePartial: taken > 0 && taken < pairs ? pairs - taken : 0,
        decodeClamped: clamped
      });
    });
    return out.slice(0, MAX);
  }

  window.Systems = {
    KEY: KEY, list: list, count: count, available: available, limit: limit, refresh: refresh,
    save: save, update: update, remove: remove, move: move, clear: clear,
    replaceAll: replaceAll,
    resolveState: resolveState, overrides: overrides, differingKeys: differingKeys,
    evaluated: evaluated, dropCache: dropCache, stateKey: stateKey,
    encodeSet: encodeSet, decodeSet: decodeSet
  };
})();
