// Tests fuer Merge, Tombstones, Warteschlange, Uhr und Sync-Motor. Ohne Abhaengigkeiten:
//   node tests/sync.test.mjs
// Es gibt keinen Netzwerkaufruf, keinen echten Code und keinen echten Schluessel (Fake-Supabase im Speicher).
import assert from 'node:assert/strict';
import { createClock, createStore, mergeList, pruneTombs, parseJoin, keyOf, normalizeEntry, enqueue, pending, ack, normalizeQueue, hashCode, checkLimits, TOMB_MAX_AGE } from '../app/js/core.js';
import { createRpc, createSync, SyncError, probe } from '../app/js/sync.js';

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---- Fake-Supabase --------------------------------------------------------------------
function fakeServer(opts = {}) {
  const s = { items: new Map(), now: opts.now || (() => Date.now()), code: opts.code || 'TESTCODE', key: 'TESTKEY', fail500: false, calls: 0,
    pullCalls: 0, pushBatches: [], gate: null, hang: false };
  s.fetch = (online) => async (url, init) => {
    s.calls++;
    if (!online.value) throw new TypeError('network');
    if (s.hang) await new Promise((_, rej) => { init.signal.addEventListener('abort', () => rej(new Error('abort'))); });
    const fn = String(url).split('/rpc/')[1];
    const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } });
    if (init.headers.apikey !== s.key) return res(401, { message: 'Invalid API key' });
    if (s.fail500) return res(500, { message: 'boom' });
    const a = JSON.parse(init.body);
    if (fn === 'hh_now') return res(200, s.now());
    if (a.p_code !== s.code) return res(400, { message: 'unknown household' });
    if (s.gate) await s.gate;
    if (fn === 'hh_pull') {
      s.pullCalls++;
      const since = Date.parse(a.p_since) - 10000;
      const rows = [];
      s.items.forEach((v, k) => {
        const [list, id] = k.split('|');
        if (list === a.p_list && v.server_at > since) rows.push({ id, data: v.data, ts: v.ts, deleted: v.deleted, server_at: new Date(v.server_at).toISOString() });
      });
      return res(200, rows);
    }
    if (fn === 'hh_push') {
      s.pushBatches.push({ list: a.p_list, n: a.p_items.length });
      // wie der echte Server: ein ungueltiger Eintrag lehnt die ganze Anfrage ab
      const max = a.p_list === 'recipes' ? 100000 : 20000;
      if (a.p_items.some((it) => String(it.id).length > 64 || (it.data && Buffer.byteLength(JSON.stringify(it.data)) > max))) return res(400, { message: 'item too large' });
      a.p_items.forEach((it) => {
        const k = a.p_list + '|' + it.id;
        const cur = s.items.get(k);
        if (!cur || cur.ts < it.ts) s.items.set(k, { data: it.data, ts: it.ts, deleted: !!it.deleted, server_at: s.now() });
      });
      return res(200, a.p_items.length);
    }
    return res(404, {});
  };
  return s;
}

function device(server, nowFn = Date.now, extra = {}) {
  const online = { value: true };
  const clock = createClock(nowFn);
  let n = 1;
  const mem = { saved: null, sync: { queue: {}, since: {}, quarantine: {} }, saves: 0, statuses: [] };
  const store = createStore({ initial: mem.saved || {}, persist: (snap) => { mem.saved = snap; }, clock, emit() {}, gen: () => 9000 + n++ });
  const make = (st) => {
    const rpc = createRpc({ code: server.code, key: server.key }, server.fetch(online), extra.rpcOpts || {});
    const eng = createSync({ store: st, rpc, clock, nowFn, schedule: () => { mem.scheduled = (mem.scheduled || 0) + 1; return 1; }, cancel() {}, repeat: () => 1, stopRepeat() {},
      onStatus: (x, info) => { mem.statuses.push([x, info.quarantined]); if (extra.throwInStatus) throw new Error('kaputt'); },
      storage: { load: () => normalizeMem(mem.sync), save: (x) => { mem.saves++; mem.sync = JSON.parse(JSON.stringify(x)); } } });
    eng.start(false); // ohne sofortigen Abgleich, ohne echte Timer
    return eng;
  };
  const normalizeMem = (m) => JSON.parse(JSON.stringify(m));
  const d = { online, clock, store, mem, sync: make(store), make };
  store.onWrite = d.sync.onWrite;
  return d;
}

// ---- Tests ----------------------------------------------------------------------------------
test('Rezept ohne id bekommt id = String(at), nichts wird verworfen', () => {
  const e = normalizeEntry('recipes', { name: 'Suppe', at: 1700000000123, ingredients: [], steps: [] }, () => 1);
  assert.equal(e.id, '1700000000123');
  assert.equal(keyOf('recipes', { at: 5 }), '5');
  assert.equal(keyOf('shop', { at: 77 }), '77');
  assert.equal(keyOf('tasks', { id: 3 }), '3');
  assert.equal(keyOf('cats', { id: 'klo' }), 'klo');
  const clock = createClock(() => 1000);
  const store = createStore({ initial: { recipes: [{ name: 'A', at: 11 }, { name: 'B', at: 12 }] }, persist() {}, clock, emit() {}, gen: () => 1 });
  assert.equal(store.data.recipes.length, 2);
});

test('mergeList: neueres ts gewinnt, bei Gleichstand der Server, lokal neuere bleiben', () => {
  const local = [{ at: 1, t: 'lokal', done: false, ts: 100 }, { at: 2, t: 'zwei', done: false, ts: 500 }];
  const rows = [
    { id: '1', data: { at: 1, t: 'server', done: true }, ts: 200, deleted: false },
    { id: '2', data: { at: 2, t: 'alt', done: true }, ts: 400, deleted: false },
    { id: '3', data: { at: 3, t: 'neu', done: false }, ts: 50, deleted: false }
  ];
  const r = mergeList('shop', local, {}, rows, () => 1);
  assert.equal(r.entries.find((e) => e.at === 1).t, 'server');
  assert.equal(r.entries.find((e) => e.at === 2).t, 'zwei');
  assert.equal(r.entries.find((e) => e.at === 3).ts, 50);
  assert.equal(r.entries.length, 3);
  const tie = mergeList('shop', [{ at: 1, t: 'lokal', done: false, ts: 200 }], {}, [{ id: '1', data: { at: 1, t: 'server', done: false }, ts: 200, deleted: false }], () => 1);
  assert.equal(tie.entries[0].t, 'server');
});

test('Tombstone: alter Pull belebt geloeschten Eintrag nicht, neuerer schon', () => {
  const clock = createClock(() => 10000);
  const store = createStore({ initial: { tasks: [{ id: 1, text: 'a', who: 'Rik', done: false, ts: 1 }] }, persist() {}, clock, emit() {}, gen: () => 1 });
  store.write('tasks', (l) => l.filter((x) => x.id !== 1));
  assert.equal(store.data.tasks.length, 0);
  const ts = store.tombs.tasks['1'];
  assert.ok(ts >= 10000);
  store.applyRemote('tasks', [{ id: '1', data: { id: 1, text: 'a', who: 'Rik', done: false }, ts: 5, deleted: false }]);
  assert.equal(store.data.tasks.length, 0, 'alter Stand darf nichts wiederbeleben');
  store.applyRemote('tasks', [{ id: '1', data: { id: 1, text: 'neu', who: 'Rik', done: false }, ts: ts + 10, deleted: false }]);
  assert.equal(store.data.tasks.length, 1);
  assert.equal(store.tombs.tasks['1'], undefined);
});

test('Tombstones aelter als 30 Tage werden entfernt', () => {
  const now = 100 * 24 * 3600 * 1000;
  const p = pruneTombs({ a: now - TOMB_MAX_AGE - 1, b: now - 1000 }, now);
  assert.deepEqual(Object.keys(p), ['b']);
});

test('Zwei Geraete: Konflikt, neueres ts gewinnt', async () => {
  let t = 1_000_000;
  const server = fakeServer({ now: () => t });
  const A = device(server, () => t);
  const B = device(server, () => t);
  A.store.write('shop', (l) => { l.push({ at: 1, t: 'Milch', done: false }); });
  await A.sync.syncNow(); await B.sync.syncNow();
  assert.equal(B.store.data.shop.length, 1);
  t += 1000;
  A.store.write('shop', (l) => { l[0].done = true; });   // A zuerst
  t += 1000;
  B.store.write('shop', (l) => { l[0].t = 'Hafermilch'; }); // B spaeter, gewinnt
  await A.sync.syncNow(); await B.sync.syncNow(); await A.sync.syncNow();
  assert.equal(A.store.data.shop[0].t, 'Hafermilch');
  assert.equal(B.store.data.shop[0].t, 'Hafermilch');
  assert.equal(A.sync.getStatus(), 'ok');
});

test('Loeschung auf Geraet A erreicht B, ein spaeter alter Pull belebt nichts', async () => {
  let t = 2_000_000;
  const server = fakeServer({ now: () => t });
  const A = device(server, () => t);
  const B = device(server, () => t);
  A.store.write('tasks', (l) => { l.push({ id: 5, text: 'Bad', who: 'Beide', done: false }); });
  await A.sync.syncNow(); await B.sync.syncNow();
  assert.equal(B.store.data.tasks.length, 1);
  t += 5000;
  A.store.write('tasks', (l) => l.filter((x) => x.id !== 5));
  await A.sync.syncNow();
  t += 5000;
  await B.sync.syncNow();
  assert.equal(B.store.data.tasks.length, 0);
  assert.ok(B.store.tombs.tasks['5']);
  // Alter Stand taucht nochmal auf (z. B. verspaetete Antwort)
  B.store.applyRemote('tasks', [{ id: '5', data: { id: 5, text: 'Bad', who: 'Beide', done: false }, ts: 1, deleted: false }]);
  assert.equal(B.store.data.tasks.length, 0);
});

test('Offline-Queue: bleibt erhalten, ueberlebt Neustart, wird nach Erfolg geleert', async () => {
  let t = 3_000_000;
  const server = fakeServer({ now: () => t });
  const A = device(server, () => t);
  A.online.value = false;
  A.store.write('shop', (l) => { l.push({ at: 42, t: 'Brot', done: false }); });
  await A.sync.syncNow();
  assert.equal(A.sync.getStatus(), 'offline');
  assert.equal(A.sync.queueSize(), 1);
  // "Neustart": neuer Sync-Motor mit demselben Speicher
  const again = A.make(A.store);
  assert.equal(again.queueSize(), 1);
  A.online.value = true;
  server.fail500 = true;
  await again.syncNow();
  assert.equal(again.getStatus(), 'error');
  assert.equal(again.queueSize(), 1, 'bei Serverfehler nicht leeren');
  server.fail500 = false;
  A.online.value = true;
  await again.syncNow();
  assert.equal(again.getStatus(), 'ok');
  assert.equal(again.queueSize(), 0);
  assert.equal(server.items.get('shop|42').data.t, 'Brot');
  assert.equal(server.items.get('shop|42').data.ts, undefined, 'ts steht nicht doppelt in data');
});

test('Eine Aenderung waehrend des Pushs bleibt in der Queue (ack nur bei gleichem ts)', () => {
  const q = {};
  enqueue(q, 'shop', '1', { at: 1, t: 'a', ts: 10 }, 10, false);
  const sent = pending(q, 'shop');
  enqueue(q, 'shop', '1', { at: 1, t: 'b', ts: 20 }, 20, false);
  ack(q, 'shop', sent);
  assert.equal(pending(q, 'shop').length, 1);
  assert.equal(pending(q, 'shop')[0].data.t, 'b');
});

test('Uhr eine Stunde vor: Offset aus Serverzeit, ts liegt nahe an der Serverzeit', async () => {
  let real = 5_000_000;
  const server = fakeServer({ now: () => real });
  const ahead = device(server, () => real + 3600000);
  assert.ok(ahead.clock.nowTs() > real + 3500000, 'vorher falsch');
  await ahead.sync.syncNow();
  assert.ok(Math.abs(ahead.clock.getOffset() + 3600000) < 1500, 'Offset ca. minus 1 Stunde: ' + ahead.clock.getOffset());
  const ts = ahead.clock.nowTs();
  assert.ok(Math.abs(ts - real) < 1500, 'ts nahe Serverzeit');
  // Ein Geraet mit richtiger Uhr, das spaeter schreibt, gewinnt gegen den Eintrag des vorlaufenden Geraets
  const right = device(server, () => real + 10000);
  ahead.store.write('tasks', (l) => { l.push({ id: 1, text: 'alt', who: 'Rik', done: false }); });
  await ahead.sync.syncNow(); await right.sync.syncNow();
  real += 3000; // Zeit vergeht, das richtige Geraet schreibt spaeter
  right.store.write('tasks', (l) => { l[0].text = 'neu'; });
  await right.sync.syncNow(); await ahead.sync.syncNow();
  assert.equal(ahead.store.data.tasks[0].text, 'neu');
});

test('nowTs ist streng monoton', () => {
  const c = createClock(() => 1000);
  const a = c.nowTs(); const b = c.nowTs();
  assert.ok(b === a + 1);
});

test('Fehlerarten: falscher Code, falscher Schluessel, kein Netz', async () => {
  const server = fakeServer();
  const online = { value: true };
  await assert.rejects(probe(createRpc({ code: 'FALSCH', key: server.key }, server.fetch(online))), (e) => e instanceof SyncError && e.kind === 'household');
  await assert.rejects(probe(createRpc({ code: server.code, key: 'FALSCH' }, server.fetch(online))), (e) => e.kind === 'auth');
  online.value = false;
  await assert.rejects(probe(createRpc({ code: server.code, key: server.key }, server.fetch(online))), (e) => e.kind === 'offline');
  online.value = true;
  await probe(createRpc({ code: server.code, key: server.key }, server.fetch(online)));
});

test('Fehlertexte enthalten nie Code oder Schluessel', async () => {
  const server = fakeServer();
  const online = { value: true };
  try { await probe(createRpc({ code: 'GEHEIM123', key: server.key }, server.fetch(online))); } catch (e) {
    assert.ok(!String(e.message).includes('GEHEIM123'));
    assert.ok(!String(e.stack).includes('GEHEIM123'));
  }
});

test('Rezept ohne id kommt vom Server und wird per Server-id gefuehrt', async () => {
  let t = 7_000_000;
  const server = fakeServer({ now: () => t });
  server.items.set('recipes|1700000000999', { data: { name: 'Melinas Rezept', at: 1700000000999, steps: ['a'], ingredients: [{ q: '1', t: 'x' }], status: 'saved' }, ts: 123, deleted: false, server_at: t });
  const A = device(server, () => t);
  await A.sync.syncNow();
  assert.equal(A.store.data.recipes.length, 1);
  assert.equal(A.store.data.recipes[0].id, '1700000000999');
  A.store.write('recipes', (l) => { l[0].status = 'list'; });
  await A.sync.syncNow();
  assert.equal(server.items.get('recipes|1700000000999').data.status, 'list');
});

test('parseJoin: #join=CODE&key=KEY', () => {
  assert.deepEqual(parseJoin('#join=ab%20c&key=eyJa.bb.cc'), { code: 'ab c', key: 'eyJa.bb.cc' });
  assert.deepEqual(parseJoin('#join=nur'), { code: 'nur', key: '' });
  assert.equal(parseJoin('#anderes=1'), null);
  assert.equal(parseJoin(''), null);
});


test('Giftpille: vom Server abgelehnter Eintrag kommt in die Quarantaene und blockiert die Queue nicht', async () => {
  let t = 8_000_000;
  const server = fakeServer({ now: () => t });
  const A = device(server, () => t);
  for (let i = 1; i <= 4; i++) A.store.write('shop', (l) => { l.push({ at: i, t: 'Artikel ' + i, done: false }); });
  const longId = 'x'.repeat(70);
  enqueue(A.sync.queue, 'shop', longId, { at: longId, t: 'boese', done: false }, 5, false); // am Client-Check vorbei
  await A.sync.syncNow();
  assert.equal(server.items.size, 4, 'die vier guten Eintraege sind angekommen');
  assert.equal(A.sync.queueSize(), 0);
  assert.equal(A.sync.quarantineCount(), 1);
  assert.equal(A.sync.getStatus(), 'ok');
  assert.equal(A.mem.statuses.at(-1)[1], 1, 'Status meldet 1 Eintrag');
  assert.equal(Object.keys(A.mem.sync.quarantine).length, 1, 'Quarantaene ist gespeichert');
  const before = server.pushBatches.length;
  A.store.write('shop', (l) => { l.push({ at: 9, t: 'noch einer', done: false }); });
  await A.sync.syncNow();
  assert.equal(server.pushBatches.length, before + 1, 'nur der neue Eintrag wird gesendet');
  assert.equal(server.items.size, 5);
});

test('Client prueft Groesse und id-Laenge vor dem Enqueue', async () => {
  assert.equal(checkLimits('tasks', '1', { id: 1, text: 'a'.repeat(21000) }), 'size');
  assert.equal(checkLimits('recipes', 'r', { id: 'r', name: 'a'.repeat(21000) }), null);
  assert.equal(checkLimits('shop', 'y'.repeat(65), { at: 1 }), 'id');
  assert.equal(checkLimits('shop', '1', { at: 1, t: 'ä'.repeat(11000) }), 'size', 'UTF-8 Bytes, nicht Zeichen');
  let t = 9_000_000;
  const server = fakeServer({ now: () => t });
  const A = device(server, () => t);
  A.store.write('tasks', (l) => { l.push({ id: 1, text: 'a'.repeat(30000), who: 'Beide', done: false }); });
  assert.equal(A.sync.queueSize(), 0);
  assert.equal(A.sync.quarantineCount(), 1);
  await A.sync.syncNow();
  assert.equal(server.pushBatches.length, 0);
});

test('Rezepte werden hoechstens 10 pro Anfrage gesendet, sonst 200', async () => {
  let t = 9_100_000;
  const server = fakeServer({ now: () => t });
  const A = device(server, () => t);
  A.store.write('recipes', (l) => { for (let i = 1; i <= 25; i++) l.push({ id: 'r' + i, name: 'R' + i, steps: [], ingredients: [], status: 'saved' }); });
  A.store.write('shop', (l) => { for (let i = 1; i <= 250; i++) l.push({ at: i, t: 'a' + i, done: false }); });
  await A.sync.syncNow();
  const rec = server.pushBatches.filter((b) => b.list === 'recipes');
  assert.ok(rec.every((b) => b.n <= 10) && rec.length === 3);
  const shop = server.pushBatches.filter((b) => b.list === 'shop');
  assert.ok(shop.every((b) => b.n <= 200) && shop.length === 2);
  assert.equal(server.items.size, 275);
});

test('stop() waehrend eines laufenden Jobs: danach wird nichts mehr geschrieben', async () => {
  let t = 9_200_000;
  const server = fakeServer({ now: () => t });
  server.items.set('shop|1', { data: { at: 1, t: 'vom Server', done: false }, ts: 50, deleted: false, server_at: t });
  const A = device(server, () => t);
  let release;
  server.gate = new Promise((r) => { release = r; });
  const run = A.sync.syncNow();
  await new Promise((r) => setTimeout(r, 20)); // Pull haengt am Gate
  A.sync.stop();
  const savesAfterStop = A.mem.saves;
  const statusCount = A.mem.statuses.length;
  release();
  await run;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(A.store.data.shop.length, 0, 'kein applyRemote nach stop');
  assert.equal(A.mem.saves, savesAfterStop, 'kein persist nach stop');
  assert.equal(A.mem.statuses.length, statusCount, 'kein Status nach stop');
  assert.equal(A.sync.getStatus(), 'off');
});

test('Haushaltswechsel: Queue und since liegen unter dem Hash, nichts Fremdes wird in den neuen Haushalt gepusht', async () => {
  const ls = new Map();
  globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k), key: (i) => [...ls.keys()][i], get length() { return ls.size; } };
  const hh = await import('../app/js/household.js');
  const hA = await hashCode('CODE-A');
  const hB = await hashCode('CODE-B');
  assert.notEqual(hA, hB);
  assert.equal(hA.length, 16);
  assert.ok(!hA.includes('CODE'));
  hh.syncStorageFor(hA).save({ queue: { 'shop|1': { list: 'shop', id: '1', data: { at: 1, t: 'fremd', done: false }, ts: 5, deleted: false } }, since: {}, quarantine: {} });
  assert.equal(Object.keys(hh.syncStorageFor(hB).load().queue).length, 0);
  let t = 9_300_000;
  const serverB = fakeServer({ now: () => t, code: 'CODE-B' });
  const clock = createClock(() => t);
  const store = createStore({ initial: {}, persist() {}, clock, emit() {}, gen: () => 1 });
  const eng = createSync({ store, rpc: createRpc({ code: 'CODE-B', key: serverB.key }, serverB.fetch({ value: true })), clock, nowFn: () => t, schedule: () => 1, cancel() {}, repeat: () => 1, stopRepeat() {}, storage: hh.syncStorageFor(hB) });
  eng.start(false);
  await eng.syncNow();
  assert.equal(serverB.items.size, 0, 'fremde Queue nicht gepusht');
  hh.saveCreds({ code: 'CODE-A', key: 'K' });
  hh.clearCreds();
  assert.equal(ls.size, 0, 'Trennen loescht Zugang und alle Sync-Staende');
  delete globalThis.localStorage;
});

test('Uhr: Zeit kommt aus hh_now, ts steigt nach der Korrektur weiter', async () => {
  let real = 9_400_000;
  const server = fakeServer({ now: () => real });
  const ahead = device(server, () => real + 3600000);
  ahead.store.write('tasks', (l) => { l.push({ id: 1, text: 'x', who: 'Rik', done: false }); });
  const ts1 = ahead.store.data.tasks[0].ts;
  assert.ok(ts1 > real + 3500000);
  await ahead.sync.syncNow(); // lernt den Offset, sendet X mit hohem ts
  assert.ok(Math.abs(ahead.clock.getOffset() + 3600000) < 50);
  real += 1000;
  ahead.store.write('tasks', (l) => { l[0].text = 'y'; });
  const ts2 = ahead.store.data.tasks[0].ts;
  assert.ok(ts2 > ts1, 'ts desselben Eintrags steigt immer');
  await ahead.sync.syncNow();
  assert.equal(server.items.get('tasks|1').data.text, 'y');
  ahead.store.write('tasks', (l) => { l.push({ id: 2, text: 'neu', who: 'Rik', done: false }); });
  assert.ok(Math.abs(ahead.store.data.tasks[1].ts - real) < 100, 'neue Eintraege liegen nahe der Serverzeit');
});

test('ts steigt auch bei eingefrorener Uhr streng pro Eintrag', () => {
  const clock = createClock(() => 1000);
  const store = createStore({ initial: {}, persist() {}, clock, emit() {}, gen: () => 1 });
  store.write('tasks', (l) => { l.push({ id: 1, text: 'a', who: 'Rik', done: false }); });
  const a = store.data.tasks[0].ts;
  store.write('tasks', (l) => { l[0].done = true; });
  assert.ok(store.data.tasks[0].ts > a);
});

test('fetch-Timeout: haengende Anfrage endet als offline', async () => {
  const server = fakeServer();
  server.hang = true;
  const rpc = createRpc({ code: server.code, key: server.key }, server.fetch({ value: true }), { timeoutMs: 30 });
  const t0 = Date.now();
  await assert.rejects(probe(rpc), (e) => e.kind === 'offline');
  assert.ok(Date.now() - t0 < 1000);
});

test('Doppelte syncNow-Aufrufe werden zusammengefasst', async () => {
  let t = 9_500_000;
  const server = fakeServer({ now: () => t });
  const A = device(server, () => t);
  let release;
  server.gate = new Promise((r) => { release = r; });
  const runs = [];
  for (let i = 0; i < 6; i++) runs.push(A.sync.syncNow());
  await new Promise((r) => setTimeout(r, 20));
  release();
  await Promise.all(runs);
  assert.ok(server.pullCalls <= 8, 'hoechstens zwei Durchlaeufe a 4 Listen, war ' + server.pullCalls);
});

test('Zugang abgelehnt: Status denied, kein Dauerfeuer, Neuversuch nur auf Nutzeraktion', async () => {
  let t = 9_600_000;
  const server = fakeServer({ now: () => t });
  const A = device(server, () => t);
  await A.sync.syncNow();
  assert.equal(A.sync.getStatus(), 'ok');
  server.key = 'GEDREHT';
  await A.sync.syncNow();
  assert.equal(A.sync.getStatus(), 'denied');
  assert.ok(A.sync.isDenied());
  const calls = server.calls;
  const scheduled = A.mem.scheduled || 0;
  A.store.write('tasks', (l) => { l.push({ id: 1, text: 'a', who: 'Rik', done: false }); });
  await A.sync.syncNow();
  assert.equal(server.calls, calls, 'keine Anfragen mehr');
  assert.equal(A.mem.scheduled || 0, scheduled, 'kein Push geplant');
  server.key = 'TESTKEY';
  await A.sync.retry();
  assert.equal(A.sync.getStatus(), 'ok');
  assert.ok(server.items.has('tasks|1'));
});

test('Ein Wurf in onStatus blockiert den Sync nicht', async () => {
  let t = 9_700_000;
  const server = fakeServer({ now: () => t });
  const A = device(server, () => t, { throwInStatus: true });
  A.store.write('shop', (l) => { l.push({ at: 1, t: 'Brot', done: false }); });
  await A.sync.syncNow();
  assert.ok(server.items.has('shop|1'));
});

test('normalizeQueue berechnet Schluessel aus list|id neu', () => {
  const q = normalizeQueue({ boese: { list: 'shop', id: 5, data: { at: 5 }, ts: 1, deleted: false }, kaputt: { list: 'unbekannt', id: 1, ts: 1 } });
  assert.deepEqual(Object.keys(q), ['shop|5']);
});

test('mergeList: gleicher Inhalt in anderer Schluesselreihenfolge ist keine Aenderung', () => {
  const r = mergeList('shop', [{ at: 1, t: 'a', done: false, ts: 5 }], {}, [{ id: '1', data: { done: false, t: 'a', at: 1 }, ts: 5, deleted: false }], () => 1);
  assert.equal(r.changed, false);
});

for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }
}
console.log(passed + '/' + tests.length + ' Tests bestanden');
