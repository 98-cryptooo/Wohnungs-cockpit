// Orts-Einstellungen: Wetterort, Haltestelle, Linien, Richtungen, Fussweg.
// Nur auf dem Geraet (localStorage 'wohnungs-cockpit.cfg'), nie im Repo und nicht beim Haushaltscode.
// Bleiben beim Trennen vom Haushalt erhalten. Alles wird beim Lesen geprueft (der Speicher ist unvertraut).
import { TRANSIT } from './config.js';

export const SETTINGS_KEY = 'wohnungs-cockpit.cfg';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cut = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

// Koordinaten nur grob: zwei Nachkommastellen (Raster etwa 1 km)
export const round2 = (n) => Math.round(Number(n) * 100) / 100 + 0; // + 0 vermeidet "-0"

export function clampWalk(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return TRANSIT.walkMinutes;
  return Math.min(30, Math.max(1, n));
}

// "136, M36" -> ['136', 'M36'] (hoechstens 10, je 10 Zeichen, ohne Duplikate)
export function parseList(text, maxItems, maxLen) {
  const out = [];
  String(text == null ? '' : text).split(',').forEach((x) => {
    const t = x.trim().slice(0, maxLen);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  });
  return out.slice(0, maxItems);
}
export const parseLines = (text) => parseList(text, 10, 10);
export const parseKeywords = (text) => parseList(text, 5, 40);

export const DEFAULTS = Object.freeze({ weather: null, transit: { stopId: '', stopName: '', lines: [], directions: {}, walkMinutes: TRANSIT.walkMinutes } });

// Beliebige Eingabe in eine gueltige Einstellung umwandeln. Nie ein Wurf.
export function validateSettings(raw) {
  const out = { weather: null, transit: { stopId: '', stopName: '', lines: [], directions: {}, walkMinutes: TRANSIT.walkMinutes } };
  if (!isObj(raw)) return out;
  const w = raw.weather;
  if (isObj(w)) {
    const lat = Number(w.latitude);
    const lon = Number(w.longitude);
    if (w.latitude !== null && w.longitude !== null && w.latitude !== '' && w.longitude !== '' &&
        Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      out.weather = { name: cut(w.name, 80), latitude: round2(lat), longitude: round2(lon) };
    }
  }
  const t = raw.transit;
  if (isObj(t)) {
    const id = String(t.stopId == null ? '' : t.stopId).trim();
    if (/^\d{1,20}$/.test(id)) { out.transit.stopId = id; out.transit.stopName = cut(t.stopName, 80); }
    const lines = Array.isArray(t.lines) ? t.lines.map((l) => cut(l, 10)).filter(Boolean) : [];
    out.transit.lines = lines.filter((l, i) => lines.findIndex((x) => x.toLowerCase() === l.toLowerCase()) === i).slice(0, 10);
    if (isObj(t.directions)) {
      out.transit.lines.forEach((l) => {
        const key = Object.keys(t.directions).find((k) => k.toLowerCase() === l.toLowerCase());
        const words = key && Array.isArray(t.directions[key]) ? t.directions[key].map((x) => cut(x, 40)).filter(Boolean).slice(0, 5) : [];
        if (words.length) out.transit.directions[l] = words;
      });
    }
    out.transit.walkMinutes = clampWalk(t.walkMinutes == null ? TRANSIT.walkMinutes : t.walkMinutes);
  }
  return out;
}

// Cache-Schluessel enthalten Ort bzw. Haltestelle, damit nach einer Aenderung keine alten Werte erscheinen.
export const weatherCacheKey = (loc) => 'wohnungs-cockpit.weather.' + loc.latitude + '_' + loc.longitude;
export const transitCacheKey = (stopId) => 'wohnungs-cockpit.transit.' + stopId;

function browserStorage() {
  return {
    load() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) { return null; } },
    save(x) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(x)); return true; } catch (e) { return false; } },
    clear() { try { localStorage.removeItem(SETTINGS_KEY); } catch (e) { /* ignorieren */ }
      // Alte Cache-Staende mit Ortsbezug ebenfalls entfernen
      try {
        const del = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && (k.indexOf('wohnungs-cockpit.weather') === 0 || k.indexOf('wohnungs-cockpit.transit') === 0)) del.push(k); }
        del.forEach((k) => localStorage.removeItem(k));
      } catch (e) { /* ignorieren */ } }
  };
}

// storage: {load(), save(x), clear()}. Liefert {get, setWeather, setTransit, clear, subscribe}.
export function createSettings(storage) {
  let cur = validateSettings(storage.load());
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => { try { fn(cur); } catch (e) { /* darf nichts blockieren */ } });
  const commit = (next) => { cur = validateSettings(next); storage.save(cur); notify(); };
  return {
    get: () => cur,
    setWeather: (loc) => commit({ weather: loc, transit: cur.transit }),
    setTransit: (patch) => commit({ weather: cur.weather, transit: Object.assign({}, cur.transit, patch) }),
    clear: () => { storage.clear(); cur = validateSettings(null); notify(); },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }
  };
}

export const settings = createSettings(browserStorage());
