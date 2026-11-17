// Tests fuer den Kalender (Aufbereitung, Abruf, Cache, Fehlerverhalten). Ohne Abhaengigkeiten:
//   node tests/calendar.test.mjs
// Kein echter Netzwerkaufruf, kein echter Code, kein echter Schluessel (Fake-fetch).
import assert from 'node:assert/strict';
process.env.TZ = 'Pacific/Auckland'; // Geraet in anderer Zeitzone: "Heute" muss trotzdem nach Europe/Berlin gelten
import { readFileSync } from 'node:fs';
import { sanitizeEvents, sanitizeCalendars, berlinNow, buildCalendar, calendarNote, fetchCalendar, createCalendar, CAL_DAYS } from '../app/js/calendar.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const NOW = new Date('2026-11-17T13:30:00Z'); // Di 17.11.2026, 14:30 in Berlin (MEZ)

const memStorage = () => { const m = { v: null, saves: 0 }; return { m, load: () => (m.v ? JSON.parse(m.v) : null), save: (x) => { m.saves++; m.v = JSON.stringify(x); }, clear: () => { m.v = null; } }; };
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const CREDS = { code: 'GEHEIMER-CODE-123', key: 'KEY-OHNE-JWT' };
const goodBody = () => ({ today: '2026-11-17', calendars: [{ name: 'Erster', ok: true }, { name: 'Zweiter', ok: true }], events: [
  { date: '2026-11-17', time: '09:00', title: 'Frueh', cal: 'Erster' },
  { date: '2026-11-17', time: '19:00', title: 'Abend', cal: 'Zweiter' },
  { date: '2026-11-18', time: null, title: 'Ganztags', cal: 'Erster' }
] });

test('sanitize: ungueltige Termine und Zeiten werden verworfen', () => {
  const ev = sanitizeEvents([{ date: '2026-11-17', time: '25:00', title: 'x' }, { date: 'kaputt', title: 'y' }, null, { date: '2026-11-18', time: '08:15', title: 't'.repeat(500), cal: 'K' }]);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].time, null);
  assert.equal(ev[1].title.length, 200);
  assert.deepEqual(sanitizeEvents('nix'), []);
  assert.deepEqual(sanitizeCalendars([{ name: 'A', ok: false, error: 'https://geheim.example/x' }]), [{ name: 'A', ok: false }]);
});

test('Mapping: Labels, ganztaegig, vergangene Termine heute ausgeblendet', () => {
  const r = buildCalendar(sanitizeEvents(goodBody().events), sanitizeCalendars(goodBody().calendars), NOW);
  assert.deepEqual(r.cal.map((e) => e.title), ['Abend', 'Ganztags'], 'Frueh (09:00) ist vorbei');
  assert.equal(r.cal[0].day, 'Heute');
  assert.equal(r.cal[0].when, 'Heute · 19:00 Uhr · Zweiter', 'Name nur bei Termin aus weiterem Kalender');
  assert.equal(r.cal[1].when, 'Morgen · ganztägig', 'Termin aus dem ersten Kalender ohne Namen');
  assert.equal(r.cal[1].whenAll, 'Morgen · ganztägig · Erster', 'Overlay immer mit Namen');
  assert.equal(r.todayEv.length, 1);
  assert.equal(r.next.title, 'Abend');
  const far = buildCalendar([{ date: '2026-11-21', time: null, title: 'Spaeter', cal: '' }], [], NOW);
  assert.equal(far.cal[0].day, 'Sa');
  assert.equal(far.cal[0].when, 'Sa 21.11. · ganztägig');
});

test('Ein einziger Kalender: nie ein Name in der Kachel', () => {
  const r = buildCalendar([{ date: '2026-11-18', time: '10:00', title: 'A', cal: 'Nur' }], [{ name: 'Nur', ok: true }], NOW);
  assert.equal(r.cal[0].when, 'Morgen · 10:00 Uhr');
});

test('Uhrzeit im Titel wird mit : oder ; erkannt, mit . nicht', () => {
  const r = buildCalendar([
    { date: '2026-11-18', time: null, title: 'Keramik bemalen 15:00', cal: '' },
    { date: '2026-11-19', time: null, title: '17;00 Lauftreff', cal: '' },
    { date: '2026-11-20', time: null, title: 'Version 3.50 testen', cal: '' }
  ], [], NOW);
  assert.equal(r.cal[0].title, 'Keramik bemalen');
  assert.equal(r.cal[0].when, 'Morgen · 15:00 Uhr');
  assert.equal(r.cal[1].title, 'Lauftreff');
  assert.equal(r.cal[1].when.endsWith('17:00 Uhr'), true);
  assert.equal(r.cal[2].title, 'Version 3.50 testen');
  assert.ok(r.cal[2].when.endsWith('ganztägig'));
});

test('Abruf: Anfrage enthaelt code und days, Authorization nur bei JWT', async () => {
  let seen;
  const f = async (url, init) => { seen = { url, init }; return response(200, goodBody()); };
  await fetchCalendar(CREDS, f);
  assert.ok(seen.url.endsWith('/functions/v1/calendar'));
  assert.deepEqual(JSON.parse(seen.init.body), { code: CREDS.code, days: CAL_DAYS });
  assert.equal(seen.init.headers.apikey, CREDS.key);
  assert.equal(seen.init.headers.Authorization, undefined);
  await fetchCalendar({ code: 'c', key: 'eyJhbGci.eyJzdWIi.c2ln' }, f);
  assert.equal(seen.init.headers.Authorization, 'Bearer eyJhbGci.eyJzdWIi.c2ln');
});

test('Erfolg: Termine werden gecacht, nach Neustart sofort da', async () => {
  const st = memStorage();
  const c1 = createCalendar({ creds: CREDS, fetchImpl: async () => response(200, goodBody()), storage: st, nowFn: () => NOW.getTime(), repeat: () => 1, stopRepeat() {} });
  c1.start();
  await c1.refresh();
  assert.equal(c1.getState().status, 'ok');
  assert.equal(c1.getState().events.length, 3);
  assert.equal(st.m.saves, 1);
  // Kaltstart: noch vor dem ersten Abruf sind die Termine da
  const c2 = createCalendar({ creds: CREDS, fetchImpl: async () => { throw new TypeError('offline'); }, storage: st, nowFn: () => NOW.getTime(), repeat: () => 1, stopRepeat() {} });
  assert.equal(c2.getState().events.length, 3);
  assert.equal(c2.getState().stamp, NOW.getTime());
  assert.ok(!JSON.stringify(st.m.v).includes(CREDS.code), 'Cache enthaelt keinen Code');
  assert.ok(!JSON.stringify(st.m.v).includes(CREDS.key), 'Cache enthaelt keinen Schluessel');
});

test('Netzfehler: Cache bleibt, Hinweis "Stand HH:MM"', async () => {
  const st = memStorage();
  st.save({ events: goodBody().events, calendars: goodBody().calendars, stamp: Date.UTC(2026, 10, 17, 12, 5) });
  const c = createCalendar({ creds: CREDS, fetchImpl: async () => { throw new TypeError('network'); }, storage: st, repeat: () => 1, stopRepeat() {} });
  c.start();
  await c.refresh();
  const s = c.getState();
  assert.equal(s.status, 'offline');
  assert.equal(s.events.length, 3, 'Cache wird weiter gezeigt');
  assert.equal(calendarNote(s), 'Stand 13:05');
});

test('Kalender nicht erreichbar: Hinweis mit Name vom Server, ohne Fehlertext', () => {
  const note = calendarNote({ status: 'ok', stamp: 1, calendars: sanitizeCalendars([{ name: 'Studium', ok: false, error: 'https://geheim.example/abo.ics' }, { name: 'Haus', ok: true }]) });
  assert.equal(note, 'Kalender Studium nicht erreichbar');
  assert.ok(!note.includes('geheim'));
});

test('403: Zugang abgelehnt, kein Dauerfeuer, Neuversuch nur per retry', async () => {
  let calls = 0;
  let status = 403;
  const f = async () => { calls++; return status === 403 ? response(403, { error: 'forbidden' }) : response(200, goodBody()); };
  const c = createCalendar({ creds: CREDS, fetchImpl: f, storage: memStorage(), repeat: () => 1, stopRepeat() {} });
  c.start();
  await c.refresh();
  assert.equal(c.getState().status, 'denied');
  assert.equal(calendarNote(c.getState()), 'Zugang abgelehnt');
  const n = calls;
  await c.refresh(); await c.refresh();
  assert.equal(calls, n, 'keine weiteren Anfragen');
  status = 200;
  await c.retry();
  assert.equal(c.getState().status, 'ok');
});

test('stop() waehrend eines Abrufs: danach wird nichts mehr geschrieben und nichts gemeldet', async () => {
  const st = memStorage();
  let release; const gate = new Promise((r) => { release = r; });
  let updates = 0;
  const c = createCalendar({ creds: CREDS, fetchImpl: async () => { await gate; return response(200, goodBody()); }, storage: st, onUpdate: () => { updates++; }, repeat: () => 1, stopRepeat() {} });
  c.start();
  await new Promise((r) => setTimeout(r, 10));
  const before = updates;
  c.stop();
  release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(c.getState().events.length, 0);
  assert.equal(st.m.saves, 0);
  assert.equal(updates, before);
});

test('Ohne start() und im Demo-Modus gibt es keine Anfrage', async () => {
  let calls = 0;
  const c = createCalendar({ creds: CREDS, fetchImpl: async () => { calls++; return response(200, goodBody()); }, storage: memStorage(), repeat: () => 1, stopRepeat() {} });
  await c.refresh();
  assert.equal(calls, 0);
  // Demo: boot() kehrt vor jedem Start des Sync und des Kalenders zurueck
  const src = readFileSync(new URL('../app/js/setup.js', import.meta.url), 'utf8');
  const boot = src.slice(src.indexOf('export async function boot()'));
  assert.ok(boot.indexOf('if (DEMO)') !== -1 && boot.indexOf('if (DEMO)') < boot.indexOf('startEngine('));
});

test('Zeitueberschreitung endet als offline', async () => {
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('abort'))));
  await assert.rejects(fetchCalendar(CREDS, hang, 30), (e) => e.kind === 'offline');
});

test('Meldungen enthalten nie Code oder Schluessel', async () => {
  const c = createCalendar({ creds: CREDS, fetchImpl: async () => response(500, {}), storage: memStorage(), repeat: () => 1, stopRepeat() {} });
  c.start();
  await c.refresh();
  const s = c.getState();
  const text = calendarNote(s) + JSON.stringify(s);
  assert.ok(!text.includes(CREDS.code) && !text.includes(CREDS.key));
  assert.equal(s.status, 'error');
});

test('Cache liegt unter dem Hash, Trennen loescht ihn', async () => {
  const ls = new Map();
  globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k), key: (i) => [...ls.keys()][i], get length() { return ls.size; } };
  const hh = await import('../app/js/household.js');
  hh.calendarStorageFor('abcd1234abcd1234').save({ events: [], calendars: [], stamp: 1 });
  assert.ok([...ls.keys()].every((k) => k.startsWith('wohnungs-cockpit.cal.') && !k.includes('CODE')));
  assert.equal(hh.calendarStorageFor('ffff').load(), null, 'anderer Haushalt sieht den Cache nicht');
  hh.clearCreds();
  assert.equal(ls.size, 0);
  delete globalThis.localStorage;
});


test('Zeitzone: Heute und Uhrzeit gelten in Berlin, nicht in der Geraetezeit', () => {
  assert.equal(new Date().getTimezoneOffset() !== -60, true, 'Test laeuft in fremder Zeitzone');
  assert.deepEqual(berlinNow(NOW), { date: '2026-11-17', minutes: 14 * 60 + 30 });
  const ev = [{ date: '2026-11-17', time: '13:00', title: 'A', cal: '' }, { date: '2026-11-17', time: '18:00', title: 'B', cal: '' }, { date: '2026-11-18', time: '09:00', title: 'C', cal: '' }];
  const r = buildCalendar(sanitizeEvents(ev), [], NOW);
  assert.deepEqual(r.cal.map((e) => e.title), ['B', 'C']);
  assert.equal(r.cal[0].day, 'Heute');
  assert.equal(r.cal[1].day, 'Morgen');
  // Sommerzeit: 12:00 UTC im Juli ist 14:00 in Berlin
  assert.equal(berlinNow(new Date('2026-07-01T12:00:00Z')).minutes, 14 * 60);
});

test('Tageswechsel um Mitternacht Berlin', () => {
  const ev = sanitizeEvents([{ date: '2026-11-17', time: '23:59', title: 'Spaet', cal: '' }, { date: '2026-11-18', time: '07:00', title: 'Frueh', cal: '' }]);
  const vor = buildCalendar(ev, [], new Date('2026-11-17T22:59:00Z')); // 23:59 Berlin
  assert.equal(vor.cal[0].day, 'Heute');
  assert.equal(vor.cal[1].day, 'Morgen');
  const nach = buildCalendar(ev, [], new Date('2026-11-17T23:01:00Z')); // 00:01 Berlin am 18.
  assert.deepEqual(nach.cal.map((e) => e.title), ['Frueh']);
  assert.equal(nach.cal[0].day, 'Heute');
});

test('Laufende Termine: erst nach dem Ende vergangen, ohne Ende Beginn plus 1 Stunde', () => {
  const mk = (time, end) => ({ date: '2026-11-17', time, end, title: time + '-' + end, cal: '' });
  const titles = (events) => buildCalendar(sanitizeEvents(events), [], NOW).cal.map((e) => e.title); // jetzt 14:30
  assert.deepEqual(titles([mk('13:00', '15:00')]), ['13:00-15:00'], 'laeuft noch');
  assert.deepEqual(titles([mk('13:00', '14:30')]), [], 'Ende erreicht');
  assert.deepEqual(titles([mk('13:00', undefined)]), [], 'ohne Ende: 14:00 vorbei');
  assert.deepEqual(titles([mk('14:00', undefined)]), ['14:00-undefined'], 'ohne Ende: bis 15:00');
  assert.deepEqual(titles([mk('22:00', '02:00')]), ['22:00-02:00']);
  assert.deepEqual(titles([mk('13:00', '2026-11-18T09:00')]), ['13:00-2026-11-18T09:00'], 'endet am Folgetag');
  assert.deepEqual(titles([{ date: '2026-11-17', time: null, title: 'ganztags', cal: '' }]), ['ganztags'], 'Ganztags bleibt den ganzen Tag');
  assert.deepEqual(titles([{ date: '2026-11-17', time: '23:30', title: 'spaet', cal: '' }]), ['spaet']);
});

test('Uhrzeit im Titel nur bei gueltiger Stunde und Minute', () => {
  const r = buildCalendar([{ date: '2026-11-18', time: null, title: 'Spiel 45:10', cal: '' }, { date: '2026-11-19', time: null, title: 'Treffen 12:75', cal: '' }, { date: '2026-11-20', time: null, title: 'Kino 20:15', cal: '' }], [], NOW);
  assert.equal(r.cal[0].title, 'Spiel 45:10');
  assert.equal(r.cal[1].title, 'Treffen 12:75');
  assert.equal(r.cal[2].title, 'Kino');
});

test('Mindestabstand 60 s zwischen Abrufen, Nutzeraktion ausgenommen', async () => {
  let t = 1_000_000; let calls = 0;
  const c = createCalendar({ creds: CREDS, fetchImpl: async () => { calls++; return response(200, goodBody()); }, storage: memStorage(), nowFn: () => t, repeat: () => 1, stopRepeat() {} });
  c.start();
  await c.refresh();
  assert.equal(calls, 1);
  t += 30_000; await c.refresh();
  assert.equal(calls, 1, 'zu frueh');
  t += 31_000; await c.refresh();
  assert.equal(calls, 2);
  t += 1000; await c.retry();
  assert.equal(calls, 3, 'ausdrueckliche Nutzeraktion ohne Mindestabstand');
});

test('today wird gespeichert und im Cache abgelegt', async () => {
  const st = memStorage();
  const c = createCalendar({ creds: CREDS, fetchImpl: async () => response(200, goodBody()), storage: st, repeat: () => 1, stopRepeat() {} });
  c.start(); await c.refresh();
  assert.equal(c.getState().today, '2026-11-17');
  assert.equal(JSON.parse(st.m.v).today, '2026-11-17');
  const c2 = createCalendar({ creds: CREDS, fetchImpl: async () => response(500, {}), storage: st, repeat: () => 1, stopRepeat() {} });
  assert.equal(c2.getState().today, '2026-11-17');
});

test('Zweiter start() laesst kein Intervall liegen', () => {
  const stopped = []; let n = 0;
  const c = createCalendar({ creds: CREDS, fetchImpl: async () => response(200, goodBody()), storage: memStorage(), repeat: () => ++n, stopRepeat: (h) => stopped.push(h) });
  c.start(); c.start();
  assert.deepEqual(stopped, [1]);
});

test('Hinweis bei altem Cache im Status idle', () => {
  assert.equal(calendarNote({ status: 'idle', stamp: Date.UTC(2026, 10, 17, 12, 5), calendars: [] }), 'Stand 13:05');
  assert.equal(calendarNote({ status: 'ok', stamp: 1, calendars: [] }), '');
});

let passed = 0;
for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }
}
console.log(passed + '/' + tests.length + ' Tests bestanden');
