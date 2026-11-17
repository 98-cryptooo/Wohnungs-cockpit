// Reiner Kern des Datenmodells und des Abgleichs. Kein DOM, kein localStorage, keine Netzwerkaufrufe.
// Dadurch laeuft er auch unter Node (tests/sync.test.mjs). Alles Browserspezifische steckt in state.js und sync.js.

export const LISTS = ['shop', 'recipes', 'tasks', 'cats'];
export const TOMB_MAX_AGE = 30 * 24 * 3600 * 1000;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));

// Gleichheit feldweise, unabhaengig von der Reihenfolge der Schluessel (undefined zaehlt wie "fehlt").
export function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

// ---- Schluessel pro Eintrag -------------------------------------------------------
// shop = String(at), tasks = String(id), cats = id, recipes = id oder String(at) (Melinas Rezepte haben evtl. keine id).
export function keyOf(list, e) {
  if (!isObj(e)) return '';
  if (list === 'shop') return e.at != null ? String(e.at) : '';
  if (list === 'recipes') {
    if (e.id != null && e.id !== '') return String(e.id);
    return e.at != null ? String(e.at) : '';
  }
  return e.id != null ? String(e.id) : '';
}

const NORMALIZE = {
  shop: (x, gen) => ({ ...x, t: str(x.t), done: !!x.done, at: x.at != null ? x.at : gen(), q: x.q ? str(x.q) : undefined, g: x.g ? str(x.g) : undefined, u: x.u ? str(x.u) : undefined, r: x.r ? str(x.r) : undefined }),
  recipes: (x, gen) => ({
    ...x,
    id: x.id != null && x.id !== '' ? String(x.id) : (x.at != null ? String(x.at) : String(gen())),
    name: str(x.name, 'Rezept'), url: x.url ? str(x.url) : null,
    steps: Array.isArray(x.steps) ? x.steps.map((s) => str(s)) : [],
    servings: Number(x.servings) > 0 ? Number(x.servings) : 1,
    yieldText: str(x.yieldText, 'Portionen'), time: Number(x.time) || 0,
    image: x.image ? str(x.image) : null,
    ingredients: Array.isArray(x.ingredients) ? x.ingredients.filter(isObj).map((z) => ({ q: str(z.q), t: str(z.t) })) : [],
    status: ['list', 'today', 'saved'].includes(x.status) ? x.status : 'saved'
  }),
  tasks: (x, gen) => ({ ...x, id: x.id != null && x.id !== '' ? x.id : gen(), text: str(x.text), who: ['Rik', 'Melina', 'Beide'].includes(x.who) ? x.who : 'Beide', done: !!x.done }),
  cats: (x) => ({ ...x, id: str(x.id), done: !!x.done, doneDay: x.doneDay ? str(x.doneDay) : undefined })
};

// Prueft und glaettet einen Eintrag. Verwirft nur Nicht-Objekte und Eintraege ohne jeden moeglichen Schluessel.
export function normalizeEntry(list, x, gen) {
  if (!isObj(x)) return null;
  const e = NORMALIZE[list](x, gen);
  if (e.ts !== undefined) e.ts = Number.isFinite(Number(e.ts)) ? Number(e.ts) : 0;
  return keyOf(list, e) === '' ? null : e;
}

// Liste normalisieren, doppelte Schluessel zusammenfuehren (groesseres ts gewinnt).
export function normalizeList(list, arr, gen) {
  const byKey = new Map();
  arr.forEach((x) => {
    const e = normalizeEntry(list, x, gen);
    if (!e) return;
    const k = keyOf(list, e);
    const old = byKey.get(k);
    if (!old || (e.ts || 0) >= (old.ts || 0)) byKey.set(k, e);
  });
  return [...byKey.values()];
}

// ---- Uhr ----------------------------------------------------------------------------
// nowTs() = max(Date.now() + Offset, letztes vergebenes ts + 1). Der Offset wird aus der Serverzeit geschaetzt.
export function createClock(nowFn = Date.now) {
  let offset = 0;
  let last = 0;
  return {
    now() { return nowFn() + offset; },
    nowTs() { const t = Math.max(nowFn() + offset, last + 1); last = t; return t; },
    setOffset(ms) { offset = Number.isFinite(ms) ? Math.round(ms) : 0; },
    getOffset() { return offset; },
    // serverMs aus hh_now(), t0 und t1 sind Anfang und Ende der Anfrage (lokale Zeit). Messzeit = Mitte der Anfrage.
    // Kleine Abweichungen (unter 1 s) werden ignoriert.
    observeServerTime(serverMs, t0, t1) {
      if (!Number.isFinite(serverMs)) return offset;
      const est = serverMs - (t0 + t1) / 2;
      const prev = offset;
      offset = Math.abs(est) < 1000 ? 0 : Math.round(est);
      // Wurde die Uhr korrigiert, darf ein zuvor zu hoch vergebenes ts die neuen nicht mehr nach oben ziehen.
      if (offset !== prev) last = Math.min(last, nowFn() + offset);
      return offset;
    }
  };
}

// ---- Tombstones ---------------------------------------------------------------------
export function pruneTombs(tombs, nowMs) {
  const out = {};
  Object.keys(tombs || {}).forEach((k) => {
    const ts = Number(tombs[k]);
    if (Number.isFinite(ts) && ts > nowMs - TOMB_MAX_AGE) out[k] = ts;
  });
  return out;
}

// ---- Merge pro Eintrag ----------------------------------------------------------------
// rows: Zeilen von hh_pull {id, data, ts, deleted}. Das groessere ts gewinnt, bei Gleichstand der Server.
// Ersetzt nie die ganze Liste. Liefert {entries, tombs, changed}.
function forceKey(list, e, key) {
  if (keyOf(list, e) === key) return e;
  if (list === 'shop') e.at = /^\d+$/.test(key) ? Number(key) : key;
  else e.id = key;
  return e;
}

export function mergeList(list, entries, tombs, rows, gen) {
  const byKey = new Map();
  entries.forEach((e) => byKey.set(keyOf(list, e), e));
  const t = { ...tombs };
  let changed = false;
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!isObj(row) || row.id == null) return;
    const key = String(row.id);
    const rts = Number(row.ts);
    if (!Number.isFinite(rts)) return;
    const le = byKey.get(key);
    const lt = t[key];
    const localTs = Math.max(le ? (le.ts || 0) : -1, lt != null ? lt : -1);
    if (rts < localTs) return; // lokale Aenderung ist neuer, sie wird noch hochgeladen
    if (row.deleted) {
      if (le) { byKey.delete(key); changed = true; }
      if (t[key] !== rts) { t[key] = rts; changed = true; }
      return;
    }
    if (!isObj(row.data)) return;
    const ne = normalizeEntry(list, row.data, gen);
    if (!ne) return;
    forceKey(list, ne, key);
    ne.ts = rts;
    if (!le || !deepEqual(le, ne)) { byKey.set(key, ne); changed = true; }
    if (t[key] !== undefined) { delete t[key]; changed = true; }
  });
  const out = [];
  const seen = new Set();
  entries.forEach((e) => { const k = keyOf(list, e); if (byKey.has(k) && !seen.has(k)) { out.push(byKey.get(k)); seen.add(k); } });
  byKey.forEach((e, k) => { if (!seen.has(k)) out.push(e); });
  return { entries: out, tombs: t, changed };
}

// ---- Warteschlange (Dirty-Queue) --------------------------------------------------------
const qKey = (list, id) => list + '|' + id;
const stripTs = (e) => { const c = JSON.parse(JSON.stringify(e)); delete c.ts; return c; };

export function enqueue(q, list, key, entry, ts, deleted) {
  const k = qKey(list, key);
  if (q[k] && q[k].ts > ts) return;
  q[k] = { list, id: String(key), data: deleted ? null : stripTs(entry), ts, deleted: !!deleted };
}
export function pending(q, list, max = 200) {
  return Object.values(q).filter((x) => x.list === list).slice(0, max).map((x) => ({ id: x.id, data: x.data, ts: x.ts, deleted: x.deleted }));
}
export function ack(q, list, sent) {
  sent.forEach((it) => {
    const k = qKey(list, it.id);
    if (q[k] && q[k].ts === it.ts) delete q[k]; // zwischenzeitlich neu geaenderte Eintraege bleiben stehen
  });
}
export function queueSize(q) { return Object.keys(q).length; }
export function normalizeQueue(raw) {
  const q = {};
  if (!isObj(raw)) return q;
  Object.values(raw).forEach((x) => {
    if (isObj(x) && LISTS.includes(x.list) && x.id != null && String(x.id) !== '' && Number.isFinite(Number(x.ts))) {
      const id = String(x.id);
      q[qKey(x.list, id)] = { list: x.list, id, data: x.deleted ? null : (isObj(x.data) ? x.data : null), ts: Number(x.ts), deleted: !!x.deleted };
    }
  });
  return q;
}

// Quarantaene: Eintraege, die der Server dauerhaft ablehnt. Sie werden nicht mehr gepusht.
export function normalizeQuarantine(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  Object.values(raw).forEach((x) => {
    if (isObj(x) && LISTS.includes(x.list) && x.id != null && Number.isFinite(Number(x.ts))) {
      out[qKey(x.list, String(x.id))] = { list: x.list, id: String(x.id), ts: Number(x.ts) };
    }
  });
  return out;
}
export function quarantine(q, qa, list, id, ts) {
  delete q[qKey(list, id)];
  qa[qKey(list, id)] = { list, id: String(id), ts };
}
export function unquarantine(qa, list, id) { delete qa[qKey(list, id)]; }

// Grenzen des Servers: Daten je Eintrag hoechstens 20000 Byte (Rezepte 100000), id hoechstens 64 Zeichen.
export const LIMITS = { id: 64, data: 20000, recipesData: 100000 };
export const maxBatch = (list) => (list === 'recipes' ? 10 : 200);
export function utf8Length(text) { return new TextEncoder().encode(text).length; }
// Liefert null, wenn der Eintrag gesendet werden darf, sonst einen kurzen Grund.
export function checkLimits(list, id, entry) {
  if (String(id).length > LIMITS.id) return 'id';
  if (entry) {
    const max = list === 'recipes' ? LIMITS.recipesData : LIMITS.data;
    if (utf8Length(JSON.stringify(stripTs(entry))) > max) return 'size';
  }
  return null;
}

// Erste 16 Hex-Zeichen von SHA-256 des Haushaltscodes. Dient nur als Ablageschluessel fuer Queue und since.
export async function hashCode(code) {
  const bytes = new TextEncoder().encode(String(code));
  try {
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  } catch (e) {
    let h = 0xcbf29ce484222325n; // Ausweichloesung ohne crypto.subtle (z. B. unsicherer Kontext)
    bytes.forEach((b) => { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; });
    return h.toString(16).padStart(16, '0').slice(0, 16);
  }
}

// ---- Store ----------------------------------------------------------------------------------
// Haelt Listen und Tombstones, kapselt die zentrale Schreibfunktion.
// persist(snapshot) speichert, emit(topic) meldet Aenderungen, store.onWrite ist der Haken fuer den Sync.
export function createStore({ initial, persist, clock, emit, gen }) {
  const data = {};
  const tombs = {};
  const nowMs = clock.now();
  LISTS.forEach((l) => {
    data[l] = normalizeList(l, (initial && Array.isArray(initial[l])) ? initial[l] : [], gen);
    tombs[l] = pruneTombs(initial && initial.tombs && initial.tombs[l], nowMs);
  });
  const store = { data, tombs, onWrite: null };
  const save = () => { persist({ shop: data.shop, recipes: data.recipes, tasks: data.tasks, cats: data.cats, tombs }); };
  store.save = save;

  // Einzige Stelle fuer lokale Schreibzugriffe. fn bekommt eine Kopie und liefert die neue Liste.
  // Geaenderte Eintraege bekommen ein frisches ts, geloeschte einen Tombstone mit ts.
  store.write = (list, fn) => {
    const before = data[list];
    const draft = JSON.parse(JSON.stringify(before));
    const next = fn(draft) || draft;
    const old = new Map(before.map((e) => [keyOf(list, e), e]));
    const changed = [];
    const kept = new Set();
    next.forEach((e) => {
      const k = keyOf(list, e);
      kept.add(k);
      const prev = old.get(k);
      if (!prev || !deepEqual(prev, e)) {
        // ts nie kleiner oder gleich dem vorherigen ts desselben Eintrags (auch nach einer Uhrkorrektur)
        e.ts = Math.max(clock.nowTs(), ((prev && prev.ts) || 0) + 1);
        changed.push({ key: k, entry: e });
        delete tombs[list][k];
      }
    });
    const removed = [];
    before.forEach((e) => {
      const k = keyOf(list, e);
      if (!kept.has(k)) {
        const ts = Math.max(clock.nowTs(), (e.ts || 0) + 1);
        tombs[list][k] = ts;
        removed.push({ key: k, ts });
      }
    });
    data[list] = next;
    save();
    if (store.onWrite) {
      try { store.onWrite({ list, changed, removed }); } catch (e) { /* Sync darf die Oberflaeche nie blockieren */ }
    }
    if (emit) emit(list);
  };

  // Daten vom Server uebernehmen: Merge pro Eintrag, keine neuen Zeitstempel, kein onWrite.
  store.applyRemote = (list, rows) => {
    const r = mergeList(list, data[list], tombs[list], rows, gen);
    tombs[list] = pruneTombs(r.tombs, clock.now());
    if (r.changed) {
      data[list] = r.entries;
      save();
      if (emit) emit(list);
    }
    return r.changed;
  };

  // Alles auf einen Ausgangszustand zuruecksetzen (Trennen).
  store.reset = (empty) => {
    LISTS.forEach((l) => { data[l] = normalizeList(l, empty[l] || [], gen); tombs[l] = {}; });
    save();
    if (emit) emit('reset');
  };
  return store;
}

// ---- #join lesen ------------------------------------------------------------------------------
// Format: #join=HAUSHALTSCODE&key=ANON_KEY (beide URL-kodiert). Zwei Parameter, weil der Schluessel selbst Punkte enthaelt.
export function parseJoin(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const code = (p.get('join') || '').trim();
  const key = (p.get('key') || '').replace(/\s+/g, '');
  return code ? { code, key } : null;
}
