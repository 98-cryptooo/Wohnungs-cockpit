// Wetter von Open-Meteo: WMO-Code auf Text und Symbol, Aufbereitung, Abruf. Reine Logik plus duenne Netzwerkschicht.
import { WEATHER, MAX_AGE } from './config.js';
import { berlinNow } from './calendar.js';
import { createPoller, getJson, usableData } from './poll.js';

export const WEATHER_TIMEOUT_MS = 10000;
export const WEATHER_INTERVAL_MS = 30 * 60 * 1000;
export const WEATHER_MIN_GAP_MS = 5 * 60 * 1000;
const DSHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

// WMO-Wettercode: Text, kurzes Wort fuer die Vorschau und Symbol (sun, cloud, fog, rain, snow, thunder)
const CODES = [
  [[0], 'Klar', 'sonnig', 'sun'], [[1], 'Überwiegend klar', 'sonnig', 'sun'], [[2], 'Teils bewölkt', 'wolkig', 'cloud'],
  [[3], 'Bewölkt', 'wolkig', 'cloud'], [[45, 48], 'Nebel', 'Nebel', 'fog'],
  [[51, 53, 55, 56, 57], 'Nieselregen', 'Regen', 'rain'], [[61], 'Leichter Regen', 'Regen', 'rain'], [[63], 'Regen', 'Regen', 'rain'],
  [[65], 'Starker Regen', 'Regen', 'rain'], [[66, 67], 'Gefrierender Regen', 'Regen', 'rain'],
  [[71], 'Leichter Schneefall', 'Schnee', 'snow'], [[73], 'Schneefall', 'Schnee', 'snow'], [[75], 'Starker Schneefall', 'Schnee', 'snow'],
  [[77], 'Schneegriesel', 'Schnee', 'snow'], [[80, 81, 82], 'Regenschauer', 'Regen', 'rain'], [[85, 86], 'Schneeschauer', 'Schnee', 'snow'],
  [[95], 'Gewitter', 'Gewitter', 'thunder'], [[96, 99], 'Gewitter mit Hagel', 'Gewitter', 'thunder']
];
export function describeCode(code) {
  const c = CODES.find((x) => x[0].includes(Number(code)));
  return c ? { text: c[1], short: c[2], icon: c[3] } : { text: 'Wetter', short: 'Wetter', icon: 'cloud' };
}

const rnd = (n) => { const r = Math.round(n); return r === 0 ? 0 : r; }; // kein "-0"
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Antwort von Open-Meteo pruefen und verschlanken. Liefert null, wenn sie unbrauchbar ist.
export function sanitizeWeather(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cur = raw.current;
  if (!cur || !isNum(cur.temperature_2m) || !isNum(cur.weather_code)) return null;
  const daily = [];
  const d = raw.daily;
  if (d && Array.isArray(d.time) && Array.isArray(d.weather_code) && Array.isArray(d.temperature_2m_max)) {
    d.time.slice(0, 8).forEach((date, i) => {
      if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && isNum(d.weather_code[i]) && isNum(d.temperature_2m_max[i])) {
        daily.push({ date, code: d.weather_code[i], max: d.temperature_2m_max[i] });
      }
    });
  }
  return { temp: cur.temperature_2m, feels: isNum(cur.apparent_temperature) ? cur.apparent_temperature : null, code: cur.weather_code, daily };
}

// Cache: die schon bereinigte, schlanke Form noch einmal pruefen.
export function sanitizeCachedWeather(d) {
  if (!d || typeof d !== 'object' || !isNum(d.temp) || !isNum(d.code)) return null;
  const daily = Array.isArray(d.daily) ? d.daily.filter((x) => x && typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && isNum(x.code) && isNum(x.max)).slice(0, 8).map((x) => ({ date: x.date, code: x.code, max: x.max })) : [];
  return { temp: d.temp, feels: isNum(d.feels) ? d.feels : null, code: d.code, daily };
}

// Fuer die Anzeige: {temp: '6°', cond: 'Bewölkt', feels: 'gefühlt 3°', icon, forecast: 'Mi 7° Regen · ...'}
export function buildWeather(w, now) {
  if (!w) return null;
  const info = describeCode(w.code);
  const today = berlinNow(now).date;
  const next = w.daily.filter((x) => x.date > today).slice(0, 3);
  const forecast = next.map((x) => {
    const [y, m, dd] = x.date.split('-').map(Number);
    return DSHORT[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()] + ' ' + rnd(x.max) + '° ' + describeCode(x.code).short;
  }).join(' · ');
  return { temp: rnd(w.temp) + '°', cond: info.text, feels: w.feels == null ? '' : 'gefühlt ' + rnd(w.feels) + '°', icon: info.icon, forecast };
}

export function weatherUrl(loc) {
  const p = new URLSearchParams({
    latitude: String(loc.latitude), longitude: String(loc.longitude),
    current: 'temperature_2m,apparent_temperature,weather_code', daily: 'weather_code,temperature_2m_max',
    timezone: WEATHER.timezone, forecast_days: '4'
  });
  return 'https://api.open-meteo.com/v1/forecast?' + p.toString();
}

export async function fetchWeather(fetchImpl, loc, timeoutMs = WEATHER_TIMEOUT_MS) {
  const raw = await getJson(weatherUrl(loc), fetchImpl, timeoutMs);
  const w = sanitizeWeather(raw);
  if (!w) throw { kind: 'error' };
  return w;
}

export function createWeather(opts) {
  return createPoller({
    fetchData: () => fetchWeather(opts.fetchImpl, opts.loc, opts.timeoutMs),
    sanitize: sanitizeCachedWeather,
    storage: opts.storage, nowFn: opts.nowFn, onUpdate: opts.onUpdate, repeat: opts.repeat, stopRepeat: opts.stopRepeat,
    intervalMs: WEATHER_INTERVAL_MS, minGapMs: WEATHER_MIN_GAP_MS, maxAgeMs: MAX_AGE.weatherMs
  });
}

// Beispieldaten fuer den Demo-Modus (gleiche Form wie die bereinigte Antwort), Vorschau relativ zu heute
export function demoWeather(now) {
  const b = berlinNow(now).date.split('-').map(Number);
  const day = (n) => { const d = new Date(Date.UTC(b[0], b[1] - 1, b[2] + n)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };
  return { temp: 6, feels: 3, code: 3, daily: [{ date: day(0), code: 3, max: 7 }, { date: day(1), code: 63, max: 7 }, { date: day(2), code: 3, max: 5 }, { date: day(3), code: 0, max: 4 }] };
}

// Werte fuer die Anzeige (hoechstens 3 Stunden alt) und Text, wenn es keine gibt.
export function usableWeather(state, nowMs) { return usableData(state, nowMs, MAX_AGE.weatherMs); }
export function weatherMessage(state, hasLocation = true) {
  if (!hasLocation) return 'Ort in den Einstellungen wählen';
  return state.status === 'idle' || state.status === 'none' ? 'Wetter lädt' : 'Wetter nicht verfügbar';
}

// Gemeinsamer Zugriff fuer die Anzeige
let current = null;
export function setWeather(w) { current = w; }
export function getWeatherState() { return current ? current.getState() : { data: null, stamp: null, status: 'none', failures: 0 }; }
