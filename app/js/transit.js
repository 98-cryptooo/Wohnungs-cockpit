// Abfahrten von der BVG (v6.bvg.transport.rest): Filter, Fussweg-Logik, Aufbereitung, Abruf.
import { TRANSIT, MAX_AGE } from './config.js';
import { createPoller, getJson, usableData, standText } from './poll.js';

export const TRANSIT_TIMEOUT_MS = 10000;
export const TRANSIT_INTERVAL_MS = 60 * 1000;
export const TRANSIT_MIN_GAP_MS = 20 * 1000;
export const BVG_BASE = 'https://v6.bvg.transport.rest';

const cut = (v, n) => String(v == null ? '' : v).slice(0, n);

// Antwort pruefen: Zeit aus when (Rueckfall plannedWhen), Verspaetung in Sekunden. Liefert null, wenn die Antwort
// unbrauchbar ist, sonst eine Liste [{line, dir, whenMs, delay, cancelled}]. Welche Linien und Richtungen gezeigt
// werden, entscheidet erst buildDepartures (so wirken geaenderte Einstellungen sofort, auch auf den Cache).
export function sanitizeDepartures(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.departures) ? raw.departures : null);
  if (!list) return null;
  const out = [];
  list.slice(0, 60).forEach((d) => {
    if (!d || typeof d !== 'object') return;
    const line = cut(d.line && d.line.name, 20).trim();
    if (!line) return;
    const whenMs = Date.parse(d.when || d.plannedWhen || '');
    if (!Number.isFinite(whenMs)) return;
    out.push({ line, dir: cut(d.direction, 80), whenMs, delay: Number.isFinite(d.delay) ? d.delay : null, cancelled: d.cancelled === true });
  });
  return out;
}

// Linie und Richtung gegen die Einstellungen: leere Linienliste = alle Linien, leere Stichwortliste = alle Richtungen.
export function matchesConfig(d, cfg) {
  const lines = (cfg.lines || []).map((l) => String(l).toLowerCase());
  if (lines.length && !lines.includes(d.line.toLowerCase())) return false;
  const dirs = cfg.directions || {};
  const key = Object.keys(dirs).find((k) => k.toLowerCase() === d.line.toLowerCase());
  const words = key ? (dirs[key] || []).map((w) => String(w).toLowerCase()) : [];
  return !words.length || words.some((w) => d.dir.toLowerCase().includes(w));
}

// Fuer die Anzeige. nowMs = jetzt. Man geht cfg.walkMinutes Minuten zu Fuss:
// leaveMs = Abfahrt minus Fussweg minus jetzt. Unter 0 schafft man den Bus nicht mehr (ausgeblendet).
// left = ganze Minuten bis zum Losgehen (0 heisst "Jetzt los"). mins = Minuten bis zur Abfahrt. delay = Minuten Verspaetung oder 0.
export function buildDepartures(list, nowMs, cfg) {
  if (!Array.isArray(list)) return [];
  const count = cfg.count || TRANSIT.count;
  return list
    .filter((d) => !d.cancelled && matchesConfig(d, cfg))
    .map((d) => {
      const leaveMs = d.whenMs - cfg.walkMinutes * 60000 - nowMs;
      return { line: d.line, dir: d.dir, metro: /^M\d/i.test(d.line), whenMs: d.whenMs, leaveMs, left: Math.floor(leaveMs / 60000), mins: Math.ceil((d.whenMs - nowMs) / 60000), delay: d.delay != null && d.delay >= 60 ? Math.round(d.delay / 60) : 0 };
    })
    .filter((d) => d.leaveMs >= 0)
    .sort((a, b) => a.whenMs - b.whenMs)
    .slice(0, count);
}

export function departuresUrl(cfg) {
  const p = new URLSearchParams({ duration: String(cfg.duration || TRANSIT.duration), results: String(cfg.results || TRANSIT.results) });
  return BVG_BASE + '/stops/' + encodeURIComponent(cfg.stopId) + '/departures?' + p.toString();
}

export async function fetchDepartures(fetchImpl, cfg, timeoutMs = TRANSIT_TIMEOUT_MS) {
  const raw = await getJson(departuresUrl(cfg), fetchImpl, timeoutMs);
  const list = sanitizeDepartures(raw);
  if (!list) throw { kind: 'error' };
  return list;
}

export function createTransit(opts) {
  return createPoller({
    fetchData: () => fetchDepartures(opts.fetchImpl, opts.cfg, opts.timeoutMs),
    sanitize: (d) => (Array.isArray(d) ? d.filter((x) => x && Number.isFinite(x.whenMs)).map((x) => ({ line: cut(x.line, 20), dir: cut(x.dir, 80), whenMs: x.whenMs, delay: Number.isFinite(x.delay) ? x.delay : null, cancelled: x.cancelled === true })) : null),
    storage: opts.storage, nowFn: opts.nowFn, onUpdate: opts.onUpdate, repeat: opts.repeat, stopRepeat: opts.stopRepeat,
    shouldPoll: opts.shouldPoll, intervalMs: TRANSIT_INTERVAL_MS, minGapMs: TRANSIT_MIN_GAP_MS, maxAgeMs: MAX_AGE.transitMs
  });
}

// Bus nur abfragen, solange der Bildschirm sichtbar ist und nicht Nacht ist.
export const shouldPollBus = (visible, night) => !!visible && !night;

// Abfahrten fuer die Anzeige (Daten hoechstens 10 Minuten alt) und Text, wenn keine zu zeigen sind.
export function usableDepartures(state, nowMs) { return usableData(state, nowMs, MAX_AGE.transitMs); }
export function busMessage(state, usable, hasRows) {
  if (hasRows) return null;
  if (!usable) return state.status === 'idle' || state.status === 'none' ? 'Lädt' : 'Abfahrten nicht verfügbar';
  if (state.status === 'ok') return 'Keine Abfahrten';
  return standText(state.stamp) + ', keine Abfahrt erreichbar';
}

// Gemeinsamer Zugriff fuer die Anzeige
let current = null;
export function setTransit(t) { current = t; }
export function getTransitState() { return current ? current.getState() : { data: null, stamp: null, status: 'none', failures: 0 }; }
