// Tests fuer den Bus (Filter, Fussweg-Logik, Verspaetung, Cache, Backoff). Ohne Abhaengigkeiten:
//   node tests/transit.test.mjs
// Kein echter Netzwerkaufruf (Fake-fetch).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeDepartures, buildDepartures, departuresUrl, fetchDepartures, createTransit, shouldPollBus, usableDepartures, busMessage } from '../app/js/transit.js';
import { standText } from '../app/js/poll.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const NOW = Date.parse('2026-11-17T17:00:00Z'); // 18:00 Berlin
const iso = (minutes, extraSeconds = 0) => new Date(NOW + minutes * 60000 + extraSeconds * 1000).toISOString();
// Nur fiktive Orte und Linien
const CFG = { stopId: '123456', stopName: 'Beispielstr.', lines: ['A1', 'M9'], directions: { A1: ['Richtung Zentrum'], M9: ['Endstation'] }, walkMinutes: 4, duration: 45, results: 15, count: 3 };
const dep = (line, minutes, extra = {}) => ({ line: { name: line }, direction: line === 'A1' ? 'Richtung Zentrum' : line === 'M9' ? 'Endstation' : 'Ziel ' + line, when: iso(minutes), plannedWhen: iso(minutes), delay: 0, ...extra });
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const memStorage = () => { const m = { v: null, saves: 0 }; return { m, load: () => (m.v ? JSON.parse(m.v) : null), save: (x) => { m.saves++; m.v = JSON.stringify(x); } }; };
const noTimers = { repeat: () => 1, stopRepeat() {} };

test('Konfiguration im Repo ist neutral: kein Ort, keine Haltestelle, keine Linien', async () => {
  const { TRANSIT } = await import('../app/js/config.js');
  assert.equal(TRANSIT.stopId, '');
  assert.equal(TRANSIT.stopName, '');
  assert.deepEqual(TRANSIT.lines, []);
  assert.deepEqual(TRANSIT.directions, {});
  assert.equal(TRANSIT.walkMinutes, 5);
  assert.equal(TRANSIT.duration, 45);
  assert.equal(TRANSIT.results, 15);
  assert.equal(TRANSIT.count, 3);
});

test('Antwort pruefen: unbrauchbare Eintraege fliegen raus', () => {
  const list = sanitizeDepartures({ departures: [dep('A1', 10), dep('M9', 11), { line: { name: 'A1' }, when: 'nie' }, null] });
  assert.deepEqual(list.map((d) => d.line), ['A1', 'M9']);
  assert.equal(sanitizeDepartures('kaputt'), null);
});

test('Linienfilter: nur die gewaehlten Linien, leere Liste zeigt alle', () => {
  const list = sanitizeDepartures({ departures: [dep('A1', 10), dep('M9', 11), dep('A2', 12), dep('X9', 13)] });
  const rows = (cfg) => buildDepartures(list, NOW, { ...CFG, directions: {}, count: 10, ...cfg }).map((r) => r.line);
  assert.deepEqual(rows({}), ['A1', 'M9']);
  assert.deepEqual(rows({ lines: [] }), ['A1', 'M9', 'A2', 'X9']);
  assert.deepEqual(rows({ lines: ['a2'] }), ['A2'], 'ohne Gross/Kleinschreibung');
});

test('Richtungsfilter: Stichwort greift (ohne Gross/Kleinschreibung), leere Liste zeigt alles', () => {
  const raw = { departures: [dep('A1', 9, { direction: 'Richtung Zentrum' }), dep('A1', 10, { direction: 'Ringbahn Nord' }), dep('M9', 11, { direction: 'Endstation' }), dep('M9', 12, { direction: 'Depot Sued' })] };
  const list = sanitizeDepartures(raw);
  const dirs = (cfg) => buildDepartures(list, NOW, { ...CFG, count: 10, ...cfg }).map((r) => r.dir);
  assert.deepEqual(dirs({}), ['Richtung Zentrum', 'Endstation']);
  assert.equal(dirs({ directions: { A1: ['richtung ZENTRUM'], M9: [] } }).length, 3, 'M9 leer: alle Richtungen');
  assert.equal(dirs({ directions: {} }).length, 4);
  assert.equal(dirs({ lines: ['A1'], directions: { A1: ['Ringbahn', 'Zentrum'] } }).length, 2, 'mehrere Stichwoerter');
});

test('Zeit aus when, Rueckfall auf plannedWhen', () => {
  const a = sanitizeDepartures({ departures: [{ line: { name: 'A1' }, direction: 'Richtung Zentrum', when: null, plannedWhen: iso(9), delay: null }] });
  assert.equal(a[0].whenMs, NOW + 9 * 60000);
  const b = sanitizeDepartures({ departures: [{ line: { name: 'M9' }, direction: 'Endstation', when: iso(8), plannedWhen: iso(5), delay: 180 }] });
  assert.equal(b[0].whenMs, NOW + 8 * 60000);
});

test('Fussweg: Los in X Min, Jetzt los bei 0, nicht mehr erreichbare ausgeblendet, erste drei', () => {
  const list = sanitizeDepartures({ departures: [dep('A1', 3), dep('M9', 4), dep('A1', 5), dep('M9', 6), dep('A1', 12), dep('M9', 20), dep('A1', 30)] });
  const rows = buildDepartures(list, NOW, CFG);
  assert.deepEqual(rows.map((r) => r.mins), [4, 5, 6], '3 Min ist nicht mehr zu schaffen');
  assert.deepEqual(rows.map((r) => r.left), [0, 1, 2]);
  assert.equal(rows[0].metro, true);
  assert.equal(rows[1].metro, false);
  assert.equal(buildDepartures(list, NOW, CFG).length, 3);
  const spaeter = buildDepartures(list, NOW + 90 * 1000, CFG); // 90 s spaeter: die 4-Minuten-Abfahrt ist weg
  assert.equal(spaeter[0].left, 0, 'die 6-Minuten-Abfahrt: jetzt los');
  assert.equal(spaeter[0].mins, 5);
  assert.ok(spaeter.every((r) => r.leaveMs >= 0));
  assert.ok(!spaeter.some((r) => r.whenMs === NOW + 4 * 60000));
});

test('Verspaetung: "+3" ab einer Minute, Verfruehung wird nicht gezeigt', () => {
  const list = sanitizeDepartures({ departures: [dep('A1', 10, { delay: 180 }), dep('M9', 11, { delay: -60 }), dep('A1', 12, { delay: 30 }), dep('M9', 13, { delay: null })] });
  const rows = buildDepartures(list, NOW, { ...CFG, count: 10 });
  assert.deepEqual(rows.map((r) => r.delay), [3, 0, 0, 0]);
});

test('cancelled wird ausgeblendet', () => {
  const list = sanitizeDepartures({ departures: [dep('A1', 8, { cancelled: true }), dep('M9', 9)] });
  const rows = buildDepartures(list, NOW, CFG);
  assert.deepEqual(rows.map((r) => r.line), ['M9']);
});

test('Abruf: Haltestellen-ID, duration=45, results=15, ohne Header und Body', async () => {
  let seen;
  await fetchDepartures(async (url, init) => { seen = { url, init }; return response(200, { departures: [dep('A1', 9)] }); }, CFG);
  const u = new URL(seen.url);
  assert.equal(u.origin, 'https://v6.bvg.transport.rest');
  assert.equal(u.pathname, '/stops/' + CFG.stopId + '/departures');
  assert.equal(u.searchParams.get('duration'), '45');
  assert.equal(u.searchParams.get('results'), '15');
  assert.equal(seen.init.method, 'GET');
  assert.equal(seen.init.body, undefined);
  assert.equal(departuresUrl(CFG), seen.url);
});

test('Zeitueberschreitung endet als offline, Fehlerstatus als error', async () => {
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('abort'))));
  const { getJson } = await import('../app/js/poll.js');
  await assert.rejects(getJson('https://x.invalid/', hang, 30), (e) => e.kind === 'offline');
  await assert.rejects(getJson('https://x.invalid/', async () => response(500, {}), 30), (e) => e.kind === 'error');
});

test('Cache: Kaltstart zeigt sofort Abfahrten, offline "Stand HH:MM"', async () => {
  const st = memStorage();
  let t = Date.UTC(2026, 10, 17, 16, 59);
  const a = createTransit({ cfg: CFG, fetchImpl: async () => response(200, { departures: [dep('A1', 9), dep('M9', 12)] }), storage: st, nowFn: () => t, ...noTimers });
  a.start(); await a.refresh();
  assert.equal(a.getState().status, 'ok');
  const b = createTransit({ cfg: CFG, fetchImpl: async () => { throw new TypeError('network'); }, storage: st, nowFn: () => t, ...noTimers });
  assert.equal(buildDepartures(b.getState().data, NOW, CFG).length, 2, 'vor dem ersten Abruf da');
  b.start(); await b.refresh();
  assert.equal(b.getState().status, 'offline');
  assert.equal(standText(b.getState().stamp), 'Stand 17:59');
  assert.equal(buildDepartures(b.getState().data, NOW + 20 * 60000, CFG).length, 0, 'veralteter Cache zeigt irgendwann nichts mehr');
});

test('Backoff 30 s, 60 s, 120 s, 300 s und shouldPoll haelt den Abruf im Hintergrund an', async () => {
  let t = 1_000_000; let calls = 0; let visible = true;
  let tickFn;
  const tr = createTransit({ cfg: CFG, fetchImpl: async () => { calls++; throw new TypeError('x'); }, storage: memStorage(), nowFn: () => t, shouldPoll: () => visible, repeat: (fn) => { tickFn = fn; return 1; }, stopRepeat() {} });
  tr.start(); await tr.refresh();
  assert.equal(calls, 1);
  t += 29_000; await tr.refresh(); assert.equal(calls, 1);
  t += 2_000; await tr.refresh(); assert.equal(calls, 2);
  t += 59_000; await tr.refresh(); assert.equal(calls, 2);
  t += 2_000; await tr.refresh(); assert.equal(calls, 3);
  visible = false; t += 400_000; tickFn(); await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 3, 'unsichtbar: kein Abruf');
  visible = true; tickFn(); await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 4);
});

test('Mindestabstand 20 s ohne Fehler', async () => {
  let t = 1_000_000; let calls = 0;
  const tr = createTransit({ cfg: CFG, fetchImpl: async () => { calls++; return response(200, { departures: [] }); }, storage: memStorage(), nowFn: () => t, ...noTimers });
  tr.start(); await tr.refresh();
  t += 10_000; await tr.refresh(); assert.equal(calls, 1);
  t += 11_000; await tr.refresh(); assert.equal(calls, 2);
});

test('Demo-Modus: kein Abruf (startLive nur ohne Demo)', () => {
  const app = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
  assert.ok(/if \(!DEMO\) startLive\(\)/.test(app));
  const render = readFileSync(new URL('../app/js/render.js', import.meta.url), 'utf8');
  assert.ok(/DEMO \? demoDepartures\(now\)/.test(render));
});

test('Nachts und im Hintergrund kein Bus-Abruf', async () => {
  assert.equal(shouldPollBus(true, false), true);
  assert.equal(shouldPollBus(true, true), false, 'Nacht');
  assert.equal(shouldPollBus(false, false), false, 'Hintergrund');
  const live = readFileSync(new URL('../app/js/liveCore.js', import.meta.url), 'utf8');
  assert.ok(/shouldPollBus\(.*isNight/.test(live), 'liveCore.js nutzt shouldPollBus mit isNight');
  let t = 1_000_000; let calls = 0; let night = true; let tick;
  const tr = createTransit({ cfg: CFG, fetchImpl: async () => { calls++; return response(200, { departures: [] }); }, storage: memStorage(), nowFn: () => t, shouldPoll: () => shouldPollBus(true, night), repeat: (fn) => { tick = fn; return 1; }, stopRepeat() {} });
  tr.start(); await tr.refresh();
  const n = calls;
  t += 100_000; tick(); await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, n, 'Nacht: Intervall fragt nicht ab');
  night = false; tick(); await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, n + 1);
});

test('Cache-Hoechstalter Bus: 10 Minuten', async () => {
  const st = memStorage();
  let t = 20_000_000;
  const a = createTransit({ cfg: CFG, fetchImpl: async () => response(200, { departures: [dep('A1', 9)] }), storage: st, nowFn: () => t, ...noTimers });
  a.start(); await a.refresh();
  t += 9 * 60000;
  assert.ok(createTransit({ cfg: CFG, fetchImpl: async () => { throw new TypeError('x'); }, storage: st, nowFn: () => t, ...noTimers }).getState().data);
  t += 2 * 60000; // 11 Minuten
  assert.equal(createTransit({ cfg: CFG, fetchImpl: async () => { throw new TypeError('x'); }, storage: st, nowFn: () => t, ...noTimers }).getState().data, null);
  assert.equal(usableDepartures({ data: [1], stamp: t - 11 * 60000 }, t), null);
});

test('Meldungen: Laedt, nicht verfuegbar, Stand mit keiner erreichbaren Abfahrt, Keine Abfahrten nur bei frischen Daten', () => {
  const stamp = Date.UTC(2026, 10, 17, 16, 55); // 17:55 Berlin
  assert.equal(busMessage({ status: 'idle', stamp: null }, null, false), 'Lädt');
  assert.equal(busMessage({ status: 'offline', stamp: null }, null, false), 'Abfahrten nicht verfügbar');
  assert.equal(busMessage({ status: 'error', stamp }, null, false), 'Abfahrten nicht verfügbar', 'zu alt verworfen');
  assert.equal(busMessage({ status: 'offline', stamp }, [], false), 'Stand 17:55, keine Abfahrt erreichbar');
  assert.equal(busMessage({ status: 'ok', stamp }, [], false), 'Keine Abfahrten');
  assert.equal(busMessage({ status: 'ok', stamp }, [], true), null);
});

let passed = 0;
for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }
}
console.log(passed + '/' + tests.length + ' Tests bestanden');
