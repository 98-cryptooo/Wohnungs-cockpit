// Suche nach Wetterort (Open-Meteo Geocoding) und Haltestelle (BVG). Nur Abfragen von oeffentlichen Diensten,
// es werden nur die Suchbegriffe gesendet. Ergebnisse sind unvertraut und werden mit textContent angezeigt.
import { getJson } from './poll.js';

export const PLACES_TIMEOUT_MS = 10000;
const cut = (v, n) => String(v == null ? '' : v).slice(0, n);

export function placeSearchUrl(text) {
  const p = new URLSearchParams({ name: text, count: '5', language: 'de', format: 'json' });
  return 'https://geocoding-api.open-meteo.com/v1/search?' + p.toString();
}
export function stopSearchUrl(text) {
  const p = new URLSearchParams({ query: text, results: '6', stops: 'true', addresses: 'false', poi: 'false' });
  return 'https://v6.bvg.transport.rest/locations?' + p.toString();
}

// -> [{label, name, latitude, longitude}]
export function parsePlaces(raw) {
  const list = raw && Array.isArray(raw.results) ? raw.results : [];
  const out = [];
  list.slice(0, 5).forEach((r) => {
    if (!r || typeof r !== 'object') return;
    const lat = Number(r.latitude); const lon = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !r.name) return;
    const extra = [r.admin1, r.country].filter((x) => typeof x === 'string' && x).join(', ');
    out.push({ name: cut(r.name, 80), label: cut(r.name, 80) + (extra ? ', ' + cut(extra, 60) : ''), latitude: lat, longitude: lon });
  });
  return out;
}
// -> [{id, name}]
export function parseStops(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  list.slice(0, 6).forEach((r) => {
    if (r && typeof r === 'object' && r.type === 'stop' && /^\d{1,20}$/.test(String(r.id)) && r.name) out.push({ id: String(r.id), name: cut(r.name, 80) });
  });
  return out;
}

export async function searchPlaces(text, fetchImpl, timeoutMs = PLACES_TIMEOUT_MS) {
  return parsePlaces(await getJson(placeSearchUrl(text), fetchImpl, timeoutMs));
}
export async function searchStops(text, fetchImpl, timeoutMs = PLACES_TIMEOUT_MS) {
  return parseStops(await getJson(stopSearchUrl(text), fetchImpl, timeoutMs));
}

// Ruhiger Text fuer einen Suchfehler
export function searchErrorText(kind) {
  return kind === 'offline' ? 'Keine Verbindung zum Netz.' : 'Die Suche ist gerade nicht möglich.';
}
