// Tests fuer die Orts-Einstellungen (Validierung, Rundung, Speicher), die Suche und die Steuerung von Wetter und Bus.
//   node tests/settings.test.mjs
// Nur fiktive Orte, kein echter Netzwerkaufruf (Fake-fetch).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSettings, createSettings, round2, clampWalk, parseLines, parseKeywords, weatherCacheKey, transitCacheKey } from '../app/js/settings.js';
import { parsePlaces, parseStops, placeSearchUrl, stopSearchUrl, searchPlaces, searchStops, searchErrorText } from '../app/js/places.js';
import { createLive } from '../app/js/liveCore.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const memStorage = (initial) => { const m = { v: initial === undefined ? null : JSON.stringify(initial), clears: 0 }; return { m, load: () => (m.v ? JSON.parse(m.v) : null), save: (x) => { m.v = JSON.stringify(x); return true; }, clear: () => { m.v = null; m.clears++; } }; };
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('Validierung: Koordinaten werden auf 2 Nachkommastellen gerundet', () => {
  const s = validateSettings({ weather: { name: 'Beispielstadt', latitude: 10.12345, longitude: '20.9876' } });
  assert.deepEqual(s.weather, { name: 'Beispielstadt', latitude: 10.12, longitude: 20.99 });
  assert.equal(round2(-0.004), 0);
});

test('Validierung: ungueltiger Ort faellt weg', () => {
  assert.equal(validateSettings({ weather: { latitude: 'x', longitude: 1 } }).weather, null);
  assert.equal(validateSettings({ weather: { latitude: 95, longitude: 1 } }).weather, null);
  assert.equal(validateSettings({ weather: { latitude: null, longitude: null } }).weather, null);
  assert.equal(validateSettings({ weather: { latitude: 1 } }).weather, null);
});

test('Validierung: stopId nur Ziffern, Namen gekuerzt', () => {
  assert.equal(validateSettings({ transit: { stopId: '12ab' } }).transit.stopId, '');
  assert.equal(validateSettings({ transit: { stopId: '../x' } }).transit.stopId, '');
  const t = validateSettings({ transit: { stopId: ' 123456 ', stopName: 'N'.repeat(200) } }).transit;
  assert.equal(t.stopId, '123456');
  assert.equal(t.stopName.length, 80);
});

test('Validierung: Linien und Richtungen sind Strings, gekuerzt, ohne Duplikate', () => {
  const t = validateSettings({ transit: { stopId: '1', lines: ['A1', 'a1', ' M9 ', 5, '', 'L'.repeat(30)], directions: { A1: ['Zentrum', ' ', 'Z'.repeat(100), 7], M9: 'kaputt', Fremd: ['x'] } } }).transit;
  assert.deepEqual(t.lines.slice(0, 3), ['A1', 'M9', '5']);
  assert.equal(t.lines[3].length, 10);
  assert.equal(t.directions.A1.length, 3);
  assert.equal(t.directions.A1[1].length, 40);
  assert.equal(t.directions.M9, undefined);
  assert.equal(t.directions.Fremd, undefined, 'Richtungen nur fuer vorhandene Linien');
});

test('Validierung: Fussweg 1 bis 30', () => {
  assert.equal(clampWalk(0), 1);
  assert.equal(clampWalk(99), 30);
  assert.equal(clampWalk(7.4), 7);
  assert.equal(clampWalk('x'), 5);
  assert.equal(validateSettings({ transit: { walkMinutes: -3 } }).transit.walkMinutes, 1);
  assert.equal(validateSettings({}).transit.walkMinutes, 5);
});

test('Eingabe: Komma-Listen', () => {
  assert.deepEqual(parseLines('A1, M9 ,, a1'), ['A1', 'M9']);
  assert.deepEqual(parseKeywords('Zentrum, Endstation'), ['Zentrum', 'Endstation']);
  assert.deepEqual(parseLines(''), []);
});

test('Kaputter oder fremder Speicher ergibt neutrale Voreinstellung', () => {
  for (const bad of [null, 'text', 42, [], { weather: 'x', transit: 5 }]) {
    const s = validateSettings(bad);
    assert.equal(s.weather, null);
    assert.equal(s.transit.stopId, '');
    assert.deepEqual(s.transit.lines, []);
  }
});

test('Speichern, Neustart, Aenderungsmeldung, Loeschen', () => {
  const st = memStorage();
  const a = createSettings(st);
  let calls = 0;
  a.subscribe(() => { calls++; });
  a.setWeather({ name: 'Beispielstadt', latitude: 10.1234, longitude: 20.5678 });
  a.setTransit({ stopId: '123456', stopName: 'Beispielstr.', lines: ['A1'], walkMinutes: 8 });
  assert.equal(calls, 2);
  assert.equal(JSON.parse(st.m.v).weather.latitude, 10.12, 'gerundet gespeichert');
  const b = createSettings(st); // Neustart
  assert.equal(b.get().transit.stopName, 'Beispielstr.');
  assert.equal(b.get().transit.walkMinutes, 8);
  b.clear();
  assert.equal(b.get().weather, null);
  assert.equal(st.m.v, null);
});

test('Einstellungen gehoeren nicht zum Haushalt und bleiben beim Trennen erhalten', () => {
  const hh = readFileSync(new URL('../app/js/household.js', import.meta.url), 'utf8');
  assert.ok(!/cfg/.test(hh.slice(hh.indexOf('export function clearCreds'), hh.indexOf('export function isSkipped'))), 'clearCreds laesst wohnungs-cockpit.cfg in Ruhe');
  const set = readFileSync(new URL('../app/js/settings.js', import.meta.url), 'utf8');
  assert.ok(set.includes("'wohnungs-cockpit.cfg'"));
});

test('Suche: Adressen und Auswertung', async () => {
  const u = new URL(placeSearchUrl('Beispiel stadt'));
  assert.equal(u.origin + u.pathname, 'https://geocoding-api.open-meteo.com/v1/search');
  assert.equal(u.searchParams.get('name'), 'Beispiel stadt');
  assert.equal(u.searchParams.get('count'), '5');
  assert.equal(u.searchParams.get('language'), 'de');
  assert.equal(u.searchParams.get('format'), 'json');
  const s = new URL(stopSearchUrl('Beispiel'));
  assert.equal(s.origin + s.pathname, 'https://v6.bvg.transport.rest/locations');
  assert.equal(s.searchParams.get('results'), '6');
  assert.equal(s.searchParams.get('stops'), 'true');
  assert.equal(s.searchParams.get('addresses'), 'false');
  assert.equal(s.searchParams.get('poi'), 'false');
  const places = parsePlaces({ results: [{ name: 'Beispielstadt', admin1: 'Land', country: 'Staat', latitude: 10.1, longitude: 20.2 }, { name: 'ohne Lage' }, null] });
  assert.equal(places.length, 1);
  assert.equal(places[0].label, 'Beispielstadt, Land, Staat');
  const stops = parseStops([{ type: 'stop', id: '123456', name: 'Beispielstr.' }, { type: 'location', id: '9', name: 'Adresse' }, { type: 'stop', id: 'x<y', name: 'bad' }]);
  assert.deepEqual(stops, [{ id: '123456', name: 'Beispielstr.' }]);
  assert.equal((await searchPlaces('x', async () => response(200, { results: [{ name: 'A', latitude: 1, longitude: 2 }] }))).length, 1);
  assert.equal((await searchStops('x', async () => response(200, [{ type: 'stop', id: '1', name: 'S' }]))).length, 1);
  await assert.rejects(searchStops('x', async () => { throw new TypeError('network'); }), (e) => e.kind === 'offline');
  assert.equal(searchErrorText('offline'), 'Keine Verbindung zum Netz.');
});

// ---- Steuerung ----------------------------------------------------------------------------
function liveSetup(initial) {
  const st = memStorage(initial);
  const settings = createSettings(st);
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    if (url.includes('open-meteo')) return response(200, { current: { temperature_2m: 5, apparent_temperature: 3, weather_code: 3 }, daily: { time: [], weather_code: [], temperature_2m_max: [] } });
    return response(200, { departures: [] });
  };
  const notes = [];
  const live = createLive({ settings, fetchImpl, storageFor: () => ({ load: () => null, save() {} }), notify: (t) => notes.push(t), isVisible: () => true, isNight: () => false, timers: { repeat: () => 1, stopRepeat() {} } });
  return { settings, urls, live, notes };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test('Kaltstart ohne Konfiguration macht keinen Abruf', async () => {
  const { live, urls } = liveSetup();
  live.start(); await settle();
  assert.deepEqual(urls, []);
  assert.deepEqual(live.active(), { weather: false, transit: false });
  live.stop();
});

test('Kaltstart mit Konfiguration ruft Wetter und Bus ab', async () => {
  const { live, urls } = liveSetup({ weather: { name: 'Beispielstadt', latitude: 10.1234, longitude: 20.5678 }, transit: { stopId: '123456', stopName: 'Beispielstr.' } });
  live.start(); await settle();
  assert.ok(urls.some((u) => u.startsWith('https://api.open-meteo.com/') && u.includes('latitude=10.12') && u.includes('longitude=20.57')));
  assert.ok(urls.some((u) => u.startsWith('https://v6.bvg.transport.rest/stops/123456/departures')));
  live.stop();
});

test('Aenderung loest sofort einen Neuabruf aus, Fussweg und Linien nicht', async () => {
  const { live, urls, settings } = liveSetup();
  live.start(); await settle();
  settings.setWeather({ name: 'Beispielstadt', latitude: 10.12, longitude: 20.34 });
  await settle();
  assert.equal(urls.filter((u) => u.includes('open-meteo')).length, 1);
  settings.setTransit({ stopId: '111', stopName: 'Beispielstr.' });
  await settle();
  assert.equal(urls.filter((u) => u.includes('/stops/111/')).length, 1);
  const n = urls.length;
  settings.setTransit({ walkMinutes: 9, lines: ['A1'] });
  await settle();
  assert.equal(urls.length, n, 'Fussweg und Linien brauchen keinen neuen Abruf');
  settings.setTransit({ stopId: '222', stopName: 'Andere Str.' });
  await settle();
  assert.equal(urls.filter((u) => u.includes('/stops/222/')).length, 1, 'neue Haltestelle: neuer Abruf');
  settings.setWeather({ name: 'Andere Stadt', latitude: 30, longitude: 40 });
  await settle();
  assert.equal(urls.filter((u) => u.includes('open-meteo')).length, 2);
  live.stop();
});

test('Loeschen der Einstellungen stoppt die Abrufe', async () => {
  const { live, urls, settings } = liveSetup({ weather: { latitude: 10, longitude: 20 }, transit: { stopId: '1' } });
  live.start(); await settle();
  assert.deepEqual(live.active(), { weather: true, transit: true });
  settings.clear(); await settle();
  assert.deepEqual(live.active(), { weather: false, transit: false });
  assert.ok(urls.length >= 2);
});

test('Cache-Schluessel folgen Ort und Haltestelle', () => {
  assert.notEqual(transitCacheKey('1'), transitCacheKey('2'));
  assert.ok(weatherCacheKey({ latitude: 10.12, longitude: 20.34 }).endsWith('10.12_20.34'));
});

let passed = 0;
for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }
}
console.log(passed + '/' + tests.length + ' Tests bestanden');
