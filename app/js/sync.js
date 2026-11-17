// Sync-Motor: Pull und Push gegen die Supabase-Funktionen hh_pull, hh_push und hh_now.
// Frei von DOM und Browserspeicher (alles wird hereingereicht), damit er unter Node getestet werden kann.
// Der Haushaltscode und der Schluessel werden nie geloggt und nie in Fehlertexte oder URLs geschrieben.
import { LISTS, enqueue, pending, ack, keyOf, queueSize, quarantine, unquarantine, checkLimits, maxBatch } from './core.js';

export const BASE_URL = 'https://gzyhpjcyuyepkpapcnyu.supabase.co';
export const EPOCH = '1970-01-01T00:00:00Z';
export const PULL_INTERVAL_MS = 30000;
export const PUSH_DELAY_MS = 1000;
export const FETCH_TIMEOUT_MS = 15000;
const CLOCK_RESYNC_MS = 10 * 60 * 1000;

// Fehlerart statt Fehlertext:
// 'offline' (kein Netz oder Zeitueberschreitung), 'auth' (Schluessel), 'household' (Code),
// 'rejected' (Server lehnt genau diese Anfrage dauerhaft ab, 4xx), 'http' (sonst, vorlaeufig)
export class SyncError extends Error {
  constructor(kind) { super(kind); this.kind = kind; }
}

// Kopfzeilen fuer Supabase. Klassische anon Schluessel sind JWTs und gehen auch als Bearer mit.
// Neue "publishable" Schluessel gehen nur als apikey.
export function buildHeaders(key) {
  const headers = { 'Content-Type': 'application/json', apikey: key };
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) headers.Authorization = 'Bearer ' + key;
  return headers;
}

// Liefert eine Funktion rpc(fn, args), die den Code und den Schluessel nur intern kennt.
export function createRpc(creds, fetchImpl, opts = {}) {
  const { code, key } = creds;
  const timeoutMs = opts.timeoutMs || FETCH_TIMEOUT_MS;
  const headers = buildHeaders(key);
  return async function rpc(fn, args) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await fetchImpl(BASE_URL + '/rest/v1/rpc/' + fn, {
          method: 'POST', headers, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal,
          body: JSON.stringify(fn === 'hh_now' ? {} : { p_code: code, ...args })
        });
      } catch (e) {
        throw new SyncError('offline');
      }
      if (!res.ok) {
        let msg = '';
        try { msg = String((await res.json()).message || ''); } catch (e) { /* kein JSON */ }
        if (res.status === 401 || res.status === 403) throw new SyncError('auth');
        if (/unknown household/i.test(msg)) throw new SyncError('household');
        const transient = res.status === 404 || res.status === 408 || res.status === 429;
        throw new SyncError(res.status >= 400 && res.status < 500 && !transient ? 'rejected' : 'http');
      }
      try { return { data: await res.json() }; } catch (e) {
        if (ctl.signal.aborted) throw new SyncError('offline');
        return { data: null }; // leere Antwort
      }
    } finally {
      clearTimeout(timer);
    }
  };
}

// Probe-Pull beim Verbinden: wirft SyncError mit der Art des Fehlers.
export async function probe(rpc) {
  try {
    await rpc('hh_pull', { p_list: 'cats', p_since: EPOCH });
  } catch (e) {
    throw (e && e.kind === 'rejected') ? new SyncError('http') : e;
  }
}

export function errorMessage(kind) {
  if (kind === 'offline') return 'Keine Verbindung zum Netz. Bitte das Internet prüfen und noch einmal versuchen.';
  if (kind === 'household') return 'Der Haushaltscode ist falsch. Bitte genau so eingeben, wie er in der Übergabe steht.';
  if (kind === 'auth') return 'Der Schlüssel wird nicht akzeptiert. Bitte den "anon public key" noch einmal aus Supabase kopieren.';
  return 'Der Server hat einen Fehler gemeldet. Bitte später noch einmal versuchen.';
}

class Stopped extends Error {}

// opts: store, rpc, storage {load() -> {queue, since, quarantine}, save(...)}, clock, onStatus(status, info), nowFn,
//       schedule/cancel (setTimeout/clearTimeout), repeat/stopRepeat (setInterval/clearInterval)
// Status: 'ok', 'syncing', 'offline', 'error', 'denied' (Zugang abgelehnt), 'off'
export function createSync(opts) {
  const { store, rpc, storage, clock } = opts;
  const nowFn = opts.nowFn || Date.now;
  const schedule = opts.schedule || ((fn, ms) => setTimeout(fn, ms));
  const cancel = opts.cancel || ((t) => clearTimeout(t));
  const repeat = opts.repeat || ((fn, ms) => setInterval(fn, ms));
  const stopRepeat = opts.stopRepeat || ((t) => clearInterval(t));

  const saved = storage.load();
  const queue = saved.queue;
  const since = saved.since;
  const quarantined = saved.quarantine || {};
  let status = 'off';
  let generation = 0;     // wird bei stop() erhoeht: laufende Jobs duerfen danach nichts mehr schreiben
  let started = false;
  let denied = false;
  let pushTimer = null;
  let pullTimer = null;
  let active = null;      // laufende Schleife
  let needPush = false;
  let needPull = false;
  let lastClockSync = 0;

  const info = () => ({ quarantined: Object.keys(quarantined).length });
  const emitStatus = () => { try { if (opts.onStatus) opts.onStatus(status, info()); } catch (e) { /* darf nichts blockieren */ } };
  const setStatus = (s) => { status = s; emitStatus(); };
  const persist = () => storage.save({ queue, since, quarantine: quarantined });

  async function syncClock(alive) {
    if (nowFn() - lastClockSync < CLOCK_RESYNC_MS) return;
    const t0 = nowFn();
    let r;
    try { r = await rpc('hh_now', {}); } catch (e) {
      if (!alive()) throw new Stopped();
      if (e && (e.kind === 'auth' || e.kind === 'household')) throw e;
      return; // Uhrabgleich ist nur ein Zusatz, Fehler hier stoppen den Sync nicht
    }
    if (!alive()) throw new Stopped();
    const t1 = nowFn();
    lastClockSync = t1;
    const ms = typeof r.data === 'number' ? r.data : Number(r.data);
    clock.observeServerTime(ms, t0, t1);
    if (opts.onOffset) opts.onOffset(clock.getOffset());
  }

  // Ein Stapel senden. Lehnt der Server mit 4xx ab: halbieren, bis der einzelne Eintrag feststeht, dann Quarantaene.
  async function pushBatch(list, items, alive) {
    try {
      await rpc('hh_push', { p_list: list, p_items: items });
    } catch (e) {
      if (!alive()) throw new Stopped();
      if (e && e.kind === 'rejected') {
        if (items.length > 1) {
          const mid = Math.ceil(items.length / 2);
          await pushBatch(list, items.slice(0, mid), alive);
          await pushBatch(list, items.slice(mid), alive);
        } else {
          quarantine(queue, quarantined, list, items[0].id, items[0].ts);
          persist();
          emitStatus();
        }
        return;
      }
      throw e;
    }
    if (!alive()) throw new Stopped();
    ack(queue, list, items); // erst nach erfolgreicher Antwort leeren
    persist();
  }

  async function pushAll(alive) {
    for (const list of LISTS) {
      for (;;) {
        const items = pending(queue, list, maxBatch(list));
        if (!items.length) break;
        await pushBatch(list, items, alive);
      }
    }
  }

  async function pullAll(alive) {
    for (const list of LISTS) {
      let r;
      try { r = await rpc('hh_pull', { p_list: list, p_since: since[list] || EPOCH }); } catch (e) {
        throw (e && e.kind === 'rejected') ? new SyncError('http') : e;
      }
      if (!alive()) throw new Stopped();
      const rows = Array.isArray(r.data) ? r.data : [];
      store.applyRemote(list, rows);
      let max = since[list] ? Date.parse(since[list]) : -Infinity;
      rows.forEach((row) => {
        const t = row && row.server_at ? Date.parse(row.server_at) : NaN;
        if (Number.isFinite(t) && t > max) { max = t; since[list] = row.server_at; }
      });
      persist();
    }
  }

  function denyAccess() {
    denied = true;
    if (pullTimer !== null) { stopRepeat(pullTimer); pullTimer = null; }
    if (pushTimer !== null) { cancel(pushTimer); pushTimer = null; }
  }

  // Eine Schleife, die Anfragen zusammenfasst: wer waehrenddessen syncNow ruft, setzt nur ein Merkzeichen.
  async function loop(myGen) {
    const alive = () => myGen === generation;
    while ((needPush || needPull) && alive()) {
      const doPull = needPull;
      needPush = false;
      needPull = false;
      setStatus('syncing');
      try {
        await syncClock(alive);
        await pushAll(alive);
        if (doPull) await pullAll(alive);
        if (!alive()) return;
        setStatus('ok');
      } catch (e) {
        if (e instanceof Stopped || !alive()) return;
        if (e && (e.kind === 'auth' || e.kind === 'household')) { denyAccess(); setStatus('denied'); return; }
        setStatus(e && e.kind === 'offline' ? 'offline' : 'error');
        return;
      }
    }
  }

  function request(push, pull) {
    if (!started || denied) return Promise.resolve();
    if (push) needPush = true;
    if (pull) needPull = true;
    if (!active) {
      const myGen = generation;
      active = loop(myGen).catch(() => {}).then(() => {
        if (generation !== myGen) return;
        active = null;
        if (needPush || needPull) request(false, false); // Anfrage kam im letzten Moment, nichts liegen lassen
      });
    }
    return active;
  }

  const syncNow = () => request(true, true);
  const pushNow = () => request(true, false);

  // Nach "Zugang abgelehnt" nur auf eine Nutzeraktion hin wieder versuchen.
  function retry() {
    if (!started) return Promise.resolve();
    denied = false;
    if (pullTimer === null) pullTimer = repeat(() => { syncNow(); }, PULL_INTERVAL_MS);
    return syncNow();
  }

  function addToQueue(list, key, entry, ts, deleted) {
    const reason = checkLimits(list, key, deleted ? null : entry);
    if (reason) { quarantine(queue, quarantined, list, key, ts); return; }
    unquarantine(quarantined, list, key);
    enqueue(queue, list, key, entry, ts, deleted);
  }

  // Einen lokalen Stand aller bereits geaenderten Eintraege vormerken (beim ersten Verbinden). ts 0 = nie angefasst.
  function enqueueAllLocal() {
    LISTS.forEach((list) => {
      store.data[list].forEach((e) => { if ((e.ts || 0) > 0) addToQueue(list, keyOf(list, e), e, e.ts, false); });
      Object.keys(store.tombs[list]).forEach((k) => addToQueue(list, k, null, store.tombs[list][k], true));
    });
    persist();
    emitStatus();
  }

  function onWrite({ list, changed, removed }) {
    changed.forEach((c) => addToQueue(list, c.key, c.entry, c.entry.ts, false));
    removed.forEach((r) => addToQueue(list, r.key, null, r.ts, true));
    persist();
    emitStatus();
    if (denied || !started) return;
    if (pushTimer !== null) cancel(pushTimer);
    pushTimer = schedule(() => { pushTimer = null; pushNow(); }, PUSH_DELAY_MS);
  }

  function start(immediate = true) {
    started = true;
    denied = false;
    store.onWrite = onWrite;
    if (immediate) syncNow();
    pullTimer = repeat(() => { syncNow(); }, PULL_INTERVAL_MS);
  }
  function stop() {
    generation++;       // laufende Jobs merken es nach jedem await und schreiben nichts mehr
    started = false;
    active = null;
    needPush = false;
    needPull = false;
    if (store.onWrite === onWrite) store.onWrite = null;
    if (pushTimer !== null) cancel(pushTimer);
    if (pullTimer !== null) stopRepeat(pullTimer);
    pushTimer = null;
    pullTimer = null;
    status = 'off';
    emitStatus();
  }

  return {
    start, stop, syncNow, pushNow, retry, enqueueAllLocal, onWrite,
    getStatus: () => status, isDenied: () => denied, info,
    queueSize: () => queueSize(queue), quarantineCount: () => Object.keys(quarantined).length,
    queue, since, quarantined, whenIdle: () => active || Promise.resolve()
  };
}
