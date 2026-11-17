// Tests fuer Wetter (Code-Mapping, Aufbereitung, Abruf, Cache, Backoff). Ohne Abhaengigkeiten:
//   node tests/weather.test.mjs
// Kein echter Netzwerkaufruf (Fake-fetch).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeCode, sanitizeWeather, buildWeather, weatherUrl, fetchWeather, createWeather, demoWeather } from '../app/js/weather.js';
import { BACKOFF_MS, standText, usableData } from '../app/js/poll.js';
import { MAX_AGE } from '../app/js/config.js';
import { weatherCacheKey, transitCacheKey } from '../app/js/settings.js';
import { usableWeather, weatherMessage } from '../app/js/weather.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const NOW = new Date('2026-11-17T13:30:00Z'); // Di 17.11.2026, 14:30 Berlin
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const body = () => ({
  current: { temperature_2m: 5.6, apparent_temperature: 2.5, weather_code: 3 },
  daily: { time: ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'], weather_code: [3, 63, 3, 0], temperature_2m_max: [7.2, 6.6, 4.5, -0.4] }
});
const memStorage = () => { const m = { v: null, saves: 0 }; return { m, load: () => (m.v ? JSON.parse(m.v) : null), save: (x) => { m.saves++; m.v = JSON.stringify(x); } }; };
const noTimers = { repeat: () => 1, stopRepeat() {} };
const LOC = { name: 'Beispielstadt', latitude: 10.12, longitude: 20.34 }; // fiktiv

test('WMO-Code auf deutschen Text und Symbol', () => {
  assert.deepEqual(describeCode(0), { text: 'Klar', short: 'sonnig', icon: 'sun' });
  assert.equal(describeCode(3).text, 'Bewölkt');
  assert.equal(describeCode(2).icon, 'cloud');
  assert.equal(describeCode(45).icon, 'fog');
  assert.equal(describeCode(61).icon, 'rain');
  assert.equal(describeCode(80).text, 'Regenschauer');
  assert.equal(describeCode(73).icon, 'snow');
  assert.equal(describeCode(95).icon, 'thunder');
  assert.equal(describeCode(99).text, 'Gewitter mit Hagel');
  assert.equal(describeCode(1234).icon, 'cloud', 'unbekannter Code ist ruhig');
});

test('Aufbereitung: Temperatur, gefuehlt, Vorschau der naechsten drei Tage', () => {
  const w = buildWeather(sanitizeWeather(body()), NOW);
  assert.equal(w.temp, '6°');
  assert.equal(w.cond, 'Bewölkt');
  assert.equal(w.feels, 'gefühlt 3°');
  assert.equal(w.forecast, 'Mi 7° Regen · Do 5° wolkig · Fr 0° sonnig', 'kein "-0"');
  assert.equal(w.icon, 'cloud');
});

test('Vorschau beginnt nach heute in Berlin, auch wenn das Geraet woanders steht', () => {
  const late = new Date('2026-11-17T23:30:00Z'); // 00:30 Berlin am 18.
  const w = buildWeather(sanitizeWeather(body()), late);
  assert.ok(w.forecast.startsWith('Do 5°'), w.forecast);
});

test('Unbrauchbare Antworten werden verworfen', () => {
  assert.equal(sanitizeWeather(null), null);
  assert.equal(sanitizeWeather({ current: { temperature_2m: 'heiss' } }), null);
  const w = sanitizeWeather({ current: { temperature_2m: 1, weather_code: 0 } });
  assert.deepEqual(w.daily, []);
  assert.equal(buildWeather(w, NOW).feels, '');
});

test('Abruf: Adresse mit Ort, Zeitzone und vier Tagen, ohne Header und Body', async () => {
  let seen;
  await fetchWeather(async (url, init) => { seen = { url, init }; return response(200, body()); }, LOC);
  const u = new URL(seen.url);
  assert.equal(u.origin + u.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(u.searchParams.get('latitude'), '10.12');
  assert.equal(u.searchParams.get('longitude'), '20.34');
  assert.equal(u.searchParams.get('current'), 'temperature_2m,apparent_temperature,weather_code');
  assert.equal(u.searchParams.get('daily'), 'weather_code,temperature_2m_max');
  assert.equal(u.searchParams.get('timezone'), 'Europe/Berlin');
  assert.equal(u.searchParams.get('forecast_days'), '4');
  assert.equal(seen.init.method, 'GET');
  assert.equal(seen.init.headers, undefined);
  assert.equal(seen.init.body, undefined);
  assert.equal(weatherUrl(LOC), seen.url);
});

test('Zeitueberschreitung endet als offline', async () => {
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('abort'))));
  await assert.rejects(fetchWeather(hang, 30), (e) => e.kind === 'offline');
});

test('Cache: nach Neustart sofort Werte, bei Fehler Cache plus "Stand HH:MM"', async () => {
  const st = memStorage();
  let t = Date.UTC(2026, 10, 17, 12, 5);
  const w1 = createWeather({ loc: LOC, fetchImpl: async () => response(200, body()), storage: st, nowFn: () => t, ...noTimers });
  w1.start(); await w1.refresh();
  assert.equal(w1.getState().status, 'ok');
  const w2 = createWeather({ loc: LOC, fetchImpl: async () => { throw new TypeError('network'); }, storage: st, nowFn: () => t, ...noTimers });
  assert.equal(buildWeather(w2.getState().data, NOW).temp, '6°', 'vor dem ersten Abruf da');
  w2.start(); await w2.refresh();
  assert.equal(w2.getState().status, 'offline');
  assert.ok(w2.getState().data, 'Cache bleibt');
  assert.equal(standText(w2.getState().stamp), 'Stand 13:05');
});

test('Backoff: 30 s, 60 s, 120 s, dann 300 s, kein Dauerfeuer', async () => {
  assert.deepEqual(BACKOFF_MS, [30000, 60000, 120000, 300000]);
  let t = 1_000_000; let calls = 0;
  const w = createWeather({ loc: LOC, fetchImpl: async () => { calls++; throw new TypeError('network'); }, storage: memStorage(), nowFn: () => t, ...noTimers });
  w.start(); await w.refresh();
  assert.equal(calls, 1);
  const wait = [30000, 60000, 120000, 300000, 300000];
  for (let i = 0; i < wait.length; i++) {
    t += wait[i] - 1; await w.refresh(); assert.equal(calls, 1 + i, 'zu frueh bei Stufe ' + i);
    t += 1; await w.refresh(); assert.equal(calls, 2 + i, 'nach Ablauf wieder');
  }
});

test('Erfolg setzt den Backoff zurueck, force umgeht ihn', async () => {
  let t = 5_000_000; let fail = true; let calls = 0;
  const w = createWeather({ loc: LOC, fetchImpl: async () => { calls++; if (fail) throw new TypeError('x'); return response(200, body()); }, storage: memStorage(), nowFn: () => t, ...noTimers });
  w.start(); await w.refresh();
  fail = false;
  await w.refresh(true);
  assert.equal(w.getState().status, 'ok');
  assert.equal(w.getState().failures, 0);
  assert.equal(calls, 2);
});

test('stop(): nach dem Stopp wird nichts mehr geschrieben', async () => {
  const st = memStorage(); let release; const gate = new Promise((r) => { release = r; });
  const w = createWeather({ loc: LOC, fetchImpl: async () => { await gate; return response(200, body()); }, storage: st, ...noTimers });
  w.start();
  await new Promise((r) => setTimeout(r, 10));
  w.stop(); release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(st.m.saves, 0);
  assert.equal(w.getState().data, null);
});

test('Demo-Modus: Beispielwerte, kein Abruf', () => {
  assert.equal(buildWeather(demoWeather(NOW), NOW).temp, '6°');
  const app = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
  assert.ok(/if \(!DEMO\) startLive\(\)/.test(app), 'startLive nur ohne Demo');
});

test('Unbekannter Wettercode zeigt "Wetter", nicht "wolkig"', () => {
  assert.equal(describeCode(1234).text, 'Wetter');
  assert.equal(describeCode(1234).short, 'Wetter');
});

test('Cache-Schluessel enthalten Ort bzw. Haltestelle', () => {
  assert.ok(weatherCacheKey(LOC).includes('10.12') && weatherCacheKey(LOC).includes('20.34'));
  assert.ok(transitCacheKey('123456').includes('123456'));
  assert.notEqual(weatherCacheKey(LOC), weatherCacheKey({ latitude: 11, longitude: 20.34 }));
});

test('Ohne Wetterort Meldung "Ort in den Einstellungen waehlen"', () => {
  assert.equal(weatherMessage({ status: 'none' }, false), 'Ort in den Einstellungen wählen');
});

test('Cache-Hoechstalter Wetter: 3 Stunden, aelteres wird verworfen', async () => {
  assert.equal(MAX_AGE.weatherMs, 3 * 3600000);
  const st = memStorage();
  let t = 10_000_000;
  const a = createWeather({ loc: LOC, fetchImpl: async () => response(200, body()), storage: st, nowFn: () => t, ...noTimers });
  a.start(); await a.refresh();
  t += 2 * 3600000; // 2 Stunden spaeter: noch da
  assert.ok(createWeather({ loc: LOC, fetchImpl: async () => { throw new TypeError('x'); }, storage: st, nowFn: () => t, ...noTimers }).getState().data);
  t += 2 * 3600000; // 4 Stunden: verworfen
  const old = createWeather({ loc: LOC, fetchImpl: async () => { throw new TypeError('x'); }, storage: st, nowFn: () => t, ...noTimers });
  assert.equal(old.getState().data, null);
  // Auch laufende Anzeige: veraltete Daten gelten als nicht verfuegbar
  assert.equal(usableWeather({ data: {}, stamp: t - 4 * 3600000 }, t), null);
  assert.ok(usableWeather({ data: { a: 1 }, stamp: t - 1000 }, t));
  assert.equal(usableData({ data: {}, stamp: null }, t, 1000), null);
  assert.equal(weatherMessage({ status: 'idle' }), 'Wetter lädt');
  assert.equal(weatherMessage({ status: 'offline' }), 'Wetter nicht verfügbar');
});

test('429: sofort 300 s Backoff, Retry-After wird beachtet (hoechstens 300 s)', async () => {
  const mk = (headers) => {
    let t = 1_000_000; let calls = 0;
    const w = createWeather({ loc: LOC, fetchImpl: async () => { calls++; return { ok: false, status: 429, json: async () => ({}), headers: { get: (n) => (n === 'Retry-After' ? headers : null) } }; }, storage: memStorage(), nowFn: () => t, ...noTimers });
    return { w, calls: () => calls, adv: (ms) => { t += ms; } };
  };
  const a = mk(null);
  a.w.start(); await a.w.refresh();
  a.adv(299_000); await a.w.refresh(); assert.equal(a.calls(), 1, 'ohne Header: 300 s');
  a.adv(2_000); await a.w.refresh(); assert.equal(a.calls(), 2);
  const b = mk('45');
  b.w.start(); await b.w.refresh();
  b.adv(44_000); await b.w.refresh(); assert.equal(b.calls(), 1);
  b.adv(2_000); await b.w.refresh(); assert.equal(b.calls(), 2, 'Retry-After 45 s');
  const c = mk('9999');
  c.w.start(); await c.w.refresh();
  c.adv(301_000); await c.w.refresh(); assert.equal(c.calls(), 2, 'hoechstens 300 s');
});

let passed = 0;
for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }
}
console.log(passed + '/' + tests.length + ' Tests bestanden');
