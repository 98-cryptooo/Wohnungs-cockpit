// Gemeinsamer Abruf mit Cache, Mindestabstand und Backoff (Wetter und Bus). Kein DOM, testbar unter Node.
// Bei Fehlern wird der Cache weiter gezeigt. Nach jedem Fehler waechst die Wartezeit: 30 s, 60 s, 120 s, maximal 300 s.
import { berlinNow } from './calendar.js';

export const BACKOFF_MS = [30000, 60000, 120000, 300000];
// Daten nur nutzen, wenn sie nicht aelter als maxAgeMs sind. Sonst null (= "nicht verfuegbar").
export function usableData(state, nowMs, maxAgeMs) {
  if (!state || !state.data || !Number.isFinite(state.stamp)) return null;
  return nowMs - state.stamp <= maxAgeMs ? state.data : null;
}

export const pad = (n) => String(n).padStart(2, '0');

// "Stand HH:MM" in Europe/Berlin
export function standText(stamp) {
  const m = berlinNow(new Date(stamp)).minutes;
  return 'Stand ' + pad(Math.floor(m / 60)) + ':' + pad(m % 60);
}

// opts: fetchData() -> bereinigte Daten (wirft bei Fehler), sanitize(raw) fuer den Cache, storage {load(), save(x)},
//       nowFn, intervalMs, minGapMs, shouldPoll(), onUpdate(), repeat/stopRepeat
export function createPoller(opts) {
  const nowFn = opts.nowFn || Date.now;
  const repeat = opts.repeat || ((fn, ms) => setInterval(fn, ms));
  const stopRepeat = opts.stopRepeat || ((t) => clearInterval(t));
  const state = { data: null, stamp: null, status: 'idle', failures: 0 };
  const cached = opts.storage.load();
  if (cached && typeof cached === 'object') {
    const d = opts.sanitize(cached.data);
    const age = nowFn() - Number(cached.stamp);
    const tooOld = opts.maxAgeMs && !(age <= opts.maxAgeMs); // zu alt oder ohne Zeitstempel: verwerfen
    if (d && !tooOld) { state.data = d; state.stamp = Number.isFinite(Number(cached.stamp)) ? Number(cached.stamp) : null; }
  }
  let generation = 0;
  let started = false;
  let active = null;
  let timer = null;
  let lastAttempt = -Infinity;
  let nextAllowed = -Infinity; // Backoff nach Fehlern
  const notify = () => { try { if (opts.onUpdate) opts.onUpdate(); } catch (e) { /* darf nichts blockieren */ } };

  // force = ausdrueckliche Nutzeraktion, ohne Mindestabstand und Backoff
  function refresh(force) {
    if (!started) return Promise.resolve();
    if (active) return active;
    if (force !== true) {
      if (nowFn() < nextAllowed) return Promise.resolve();
      if (state.failures === 0 && nowFn() - lastAttempt < (opts.minGapMs || 0)) return Promise.resolve();
    }
    lastAttempt = nowFn();
    const myGen = generation;
    active = (async () => {
      try {
        const d = await opts.fetchData();
        if (myGen !== generation) return;
        state.data = d;
        state.stamp = nowFn();
        state.status = 'ok';
        state.failures = 0;
        nextAllowed = -Infinity;
        opts.storage.save({ data: d, stamp: state.stamp });
      } catch (e) {
        if (myGen !== generation) return;
        state.failures++;
        // 429: sofort 300 s (oder Retry-After, hoechstens 300 s). Sonst 30 s, 60 s, 120 s, 300 s.
        const wait = e && e.rateLimited ? Math.min(Number.isFinite(e.retryAfterMs) ? e.retryAfterMs : BACKOFF_MS[3], BACKOFF_MS[3]) : BACKOFF_MS[Math.min(state.failures - 1, BACKOFF_MS.length - 1)];
        nextAllowed = lastAttempt + wait;
        state.status = e && e.kind === 'offline' ? 'offline' : 'error';
      } finally {
        if (myGen === generation) { active = null; notify(); }
      }
    })();
    return active;
  }

  function start() {
    started = true;
    if (timer !== null) stopRepeat(timer);
    refresh(true);
    timer = repeat(() => { if (!opts.shouldPoll || opts.shouldPoll()) refresh(false); }, opts.intervalMs);
  }
  function stop() {
    generation++;
    started = false;
    active = null;
    if (timer !== null) stopRepeat(timer);
    timer = null;
  }
  return { start, stop, refresh, getState: () => state };
}

// Abruf mit Zeitueberschreitung. Wirft {kind: 'offline' | 'error'}, ohne die Adresse in der Meldung.
export async function getJson(url, fetchImpl, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let res;
    try { res = await fetchImpl(url, { method: 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal }); } catch (e) { throw { kind: 'offline' }; }
    if (res.status === 429) {
      let ms = NaN;
      try { const h = res.headers && res.headers.get && res.headers.get('Retry-After'); if (h) ms = /^\d+$/.test(h.trim()) ? Number(h) * 1000 : Date.parse(h) - Date.now(); } catch (e) { /* Header evtl. nicht lesbar */ }
      throw { kind: 'error', rateLimited: true, retryAfterMs: Number.isFinite(ms) && ms >= 0 ? ms : undefined };
    }
    if (!res.ok) throw { kind: 'error' };
    try { return await res.json(); } catch (e) { throw { kind: ctl.signal.aborted ? 'offline' : 'error' }; }
  } finally {
    clearTimeout(timer);
  }
}
