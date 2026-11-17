// Haushaltscode und Schluessel (anon public key): getrennt von den Daten gespeichert, nie geloggt.
// Wichtig: Dieses Modul wird als erstes geladen. Es liest #join=... und entfernt es SOFORT aus der Adresse,
// noch bevor irgendein Netzwerkaufruf passieren kann.
import { parseJoin, normalizeQueue, normalizeQuarantine } from './core.js';

const KEY = 'wohnungs-cockpit.hh';
const SKIP_KEY = 'wohnungs-cockpit.skip';
const SYNC_PREFIX = 'wohnungs-cockpit.sync'; // je Haushalt: wohnungs-cockpit.sync.<Hash des Codes>
const CAL_PREFIX = 'wohnungs-cockpit.cal'; // Kalender-Cache je Haushalt: wohnungs-cockpit.cal.<Hash des Codes>

function readJoin() {
  let join = null;
  try {
    const hash = location.hash || '';
    if (hash.indexOf('join=') !== -1) {
      join = parseJoin(hash);
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch (e) { /* ignorieren */ }
  return join;
}
export const JOIN = readJoin();

export function getCreds() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (o && typeof o.code === 'string' && typeof o.key === 'string' && o.code && o.key) return { code: o.code, key: o.key };
  } catch (e) { /* ignorieren */ }
  return null;
}
export function saveCreds(c) {
  try { localStorage.setItem(KEY, JSON.stringify({ code: c.code, key: c.key })); return true; } catch (e) { return false; }
}
// Entfernt Zugangsdaten, alle Sync-Staende (Queue, since, Quarantaene) und Kalender-Caches aller Haushalte.
export function clearCreds() {
  try {
    localStorage.removeItem(KEY);
    const del = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.indexOf(SYNC_PREFIX) === 0 || k.indexOf(CAL_PREFIX) === 0)) del.push(k);
    }
    del.forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* ignorieren */ }
}
export function isSkipped() {
  try { return localStorage.getItem(SKIP_KEY) === '1'; } catch (e) { return false; }
}
export function setSkipped(v) {
  try { if (v) localStorage.setItem(SKIP_KEY, '1'); else localStorage.removeItem(SKIP_KEY); } catch (e) { /* ignorieren */ }
}

// Warteschlange, "since" und Quarantaene des Sync, ueberleben Neustarts. Abgelegt unter dem Hash des Haushaltscodes,
// damit nie die Queue eines anderen Haushalts in einen neuen gepusht wird.
export function syncStorageFor(hash) {
  const k = SYNC_PREFIX + '.' + hash;
  return {
    load() {
      let queue = {};
      let since = {};
      let quarantine = {};
      try {
        const o = JSON.parse(localStorage.getItem(k) || 'null');
        if (o && typeof o === 'object') {
          queue = normalizeQueue(o.queue);
          quarantine = normalizeQuarantine(o.quarantine);
          since = o.since && typeof o.since === 'object' ? o.since : {};
        }
      } catch (e) { /* ignorieren */ }
      return { queue, since, quarantine };
    },
    save(s) {
      try { localStorage.setItem(k, JSON.stringify(s)); } catch (e) { /* ignorieren */ }
    },
    clear() { try { localStorage.removeItem(k); } catch (e) { /* ignorieren */ } }
  };
}

// Letzte erfolgreiche Kalenderantwort, damit offline und beim Kaltstart sofort Termine da sind.
export function calendarStorageFor(hash) {
  const k = CAL_PREFIX + '.' + hash;
  return {
    load() { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    save(x) { try { localStorage.setItem(k, JSON.stringify(x)); } catch (e) { /* ignorieren */ } },
    clear() { try { localStorage.removeItem(k); } catch (e) { /* ignorieren */ } }
  };
}
