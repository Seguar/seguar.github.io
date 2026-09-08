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
    var txt = null;
    try { txt = localStorage.getItem(KEY); } catch (e) { txt = null; }
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

  /* ids are derived from a counter plus the name, never from a clock —
     Date.now() is unavailable in some of the contexts this file runs in and
     a monotonic counter is enough to keep keys distinct within a session */
  var seq = 0;
  function makeId(name) {
    seq++;
    var slug = String(name || 'system').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return (slug || 'system') + '-' + seq + '-' + readRaw().length;
  }

  /* Drop the in-memory mirror so the next read comes from storage. Called
     before every mutation, because two tabs of the tool each hold their own
     mirror: without this, the second tab writes its whole stale list back
     and silently discards everything the first tab saved. Re-reading first
     narrows that to a per-operation race instead of a per-session one. */
  function refresh() { mem = null; return readRaw(); }

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
      id: makeId(name),
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
  function encodeSet(records, defaults) {
    var parts = (records || []).map(function (r) {
      var o = overrides(r, defaults);
      var kv = Object.keys(o).sort().map(function (k) { return k + '~' + o[k]; }).join(',');
      return encodeURIComponent(r.name) + '!' + kv;
    });
    return parts.join('|');
  }

  function decodeSet(str, defaults) {
    var out = [];
    if (!str) return out;
    String(str).split('|').forEach(function (chunk, idx) {
      if (!chunk) return;
      var bang = chunk.indexOf('!');
      if (bang < 0) return;
      var name = decodeURIComponent(chunk.slice(0, bang)) || ('System ' + (idx + 1));
      var state = {};
      Object.keys(defaults).forEach(function (k) { state[k] = defaults[k]; });
      chunk.slice(bang + 1).split(',').forEach(function (kv) {
        if (!kv) return;
        var i = kv.indexOf('~');
        if (i < 0) return;
        var k = kv.slice(0, i), v = parseFloat(kv.slice(i + 1));
        if (Object.prototype.hasOwnProperty.call(defaults, k) && isFinite(v)) state[k] = v;
      });
      seq++;
      out.push({ id: 'shared-' + seq + '-' + idx, name: name, note: '', state: state, shared: true });
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
