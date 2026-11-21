// Tests fuer Putzplan und Aufgaben (Wiederholung, Faelligkeit, Verlauf, Erinnerung).
//   node tests/tasks.test.mjs
import assert from 'node:assert/strict';
import {
  nextDue, addMonth, addDays, newTask, applyPlan, completeRecurring, undoLast, toggleOnce,
  taskState, isForToday, sortTasks, doneOnce, reminderKey, reminderText, isRecurring, LOG_MAX, everyLabel
} from '../app/js/tasks.js';
import { normalizeEntry, createStore, createClock } from '../app/js/core.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const at = (date, hm = '12:00') => ({ date, minutes: +hm.slice(0, 2) * 60 + +hm.slice(3, 5) });

test('Ab Erledigung: am 10. abhaken ergibt den 17., am 12. den 19.', () => {
  const t = newTask(1, { text: 'Bad putzen', every: 7 }, '2026-11-03');
  assert.equal(t.due, '2026-11-03');
  completeRecurring(t, 'Rik', '2026-11-10');
  assert.equal(t.due, '2026-11-17');
  const u = newTask(2, { text: 'Bad putzen', every: 7 }, '2026-11-03');
  completeRecurring(u, 'Rik', '2026-11-12');
  assert.equal(u.due, '2026-11-19');
});

test('Monatlich kappt am Monatsende, Jahreswechsel stimmt', () => {
  assert.equal(addMonth('2026-01-31'), '2026-02-28');
  assert.equal(addMonth('2028-01-31'), '2028-02-29');
  assert.equal(addMonth('2026-12-15'), '2027-01-15');
  assert.equal(nextDue('2026-03-31', 'm'), '2026-04-30');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});

test('Zeitumstellung verschiebt kein Datum', () => {
  assert.equal(addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(nextDue('2026-10-20', 7), '2026-10-27');
});

test('Verlauf: neueste oben, wer erledigt hat, hoechstens 20', () => {
  const t = newTask(1, { text: 'Staubsaugen', every: 2 }, '2026-11-01');
  completeRecurring(t, 'Rik', '2026-11-01');
  completeRecurring(t, 'Melina', '2026-11-03');
  completeRecurring(t, 'Beide', '2026-11-05');
  assert.deepEqual(t.log.map((x) => [x.at, x.by]), [['2026-11-05', 'Beide'], ['2026-11-03', 'Melina'], ['2026-11-01', 'Rik']]);
  for (let i = 0; i < 30; i++) completeRecurring(t, 'Rik', addDays('2026-11-06', i));
  assert.equal(t.log.length, LOG_MAX);
  assert.equal(t.done, false);
});

test('Unbekannte Person wird zu Beide', () => {
  const t = newTask(1, { text: 'X', every: 7 }, '2026-11-01');
  completeRecurring(t, 'Jemand', '2026-11-01');
  assert.equal(t.log[0].by, 'Beide');
});

test('Zuruecknehmen stellt die alte Faelligkeit wieder her', () => {
  const t = newTask(1, { text: 'Bad', every: 7 }, '2026-11-01');
  completeRecurring(t, 'Rik', '2026-11-04');
  assert.equal(t.due, '2026-11-11');
  undoLast(t);
  assert.equal(t.due, '2026-11-01');
  assert.equal(t.log, undefined);
});

test('Ueberfaellig: gestern faellig steht oben und sagt seit 1 Tag', () => {
  const now = at('2026-11-22');
  const list = [
    newTask(1, { text: 'Ohne Datum' }, now.date),
    newTask(2, { text: 'Spaeter', every: 7, due: '2026-11-25' }, now.date),
    newTask(3, { text: 'Gestern', every: 7, due: '2026-11-21' }, now.date),
    newTask(4, { text: 'Heute', every: 7, due: '2026-11-22' }, now.date)
  ];
  const s = sortTasks(list, now);
  assert.deepEqual(s.map((t) => t.id), [3, 4, 2, 1]);
  assert.deepEqual(taskState(list[2], now), { kind: 'overdue', label: 'überfällig seit 1 Tag' });
  assert.equal(taskState(list[0], now).kind, 'none');
});

test('Heute faellig erscheint in Heute zu tun, erledigt wieder nicht', () => {
  const now = at('2026-11-22');
  const t = newTask(1, { text: 'Bad', every: 7, due: '2026-11-22' }, now.date);
  assert.equal(isForToday(t, now), true);
  completeRecurring(t, 'Rik', now.date);
  assert.equal(isForToday(t, now), false);
  assert.equal(isForToday({ id: 9, text: 'Notiz', note: true, due: '2026-11-22' }, now), false);
  assert.equal(isForToday({ id: 8, text: 'Alt', today: true, done: false }, now), true);
});

test('Einmalige Aufgabe mit Uhrzeit wird nach der Uhrzeit rot', () => {
  const t = newTask(1, { text: 'Paket', due: '2026-11-22', time: '14:00' }, '2026-11-22');
  assert.equal(taskState(t, at('2026-11-22', '13:59')).kind, 'today');
  assert.deepEqual(taskState(t, at('2026-11-22', '14:00')), { kind: 'overdue', label: 'überfällig seit 14:00' });
  toggleOnce(t, '2026-11-22');
  assert.equal(taskState(t, at('2026-11-23')).kind, 'done');
  assert.equal(t.doneAt, '2026-11-22');
});

test('Erinnerung: 5 Minuten vorher bis 60 Minuten danach, nie erledigt', () => {
  const t = newTask(7, { text: 'Paket', due: '2026-11-22', time: '14:00', remind: 5 }, '2026-11-22');
  assert.equal(reminderKey(t, at('2026-11-22', '13:54')), null);
  assert.equal(reminderKey(t, at('2026-11-22', '13:55')), '7|2026-11-22|14:00');
  assert.equal(reminderText(t, at('2026-11-22', '13:55')), 'In 5 Minuten: Paket');
  assert.equal(reminderText(t, at('2026-11-22', '14:00')), 'Jetzt: Paket');
  assert.equal(reminderKey(t, at('2026-11-22', '15:00')), null);
  toggleOnce(t, '2026-11-22');
  assert.equal(reminderKey(t, at('2026-11-22', '13:58')), null);
});

test('Erinnerung ohne Uhrzeit wird nicht gespeichert', () => {
  const t = newTask(1, { text: 'X', due: '2026-11-22', remind: 5 }, '2026-11-22');
  assert.equal(t.remind, undefined);
  assert.equal(reminderKey(t, at('2026-11-22', '00:00')), null);
});

test('Erinnerung zur Uhrzeit (0 Minuten) funktioniert', () => {
  const t = newTask(1, { text: 'X', due: '2026-11-22', time: '08:00', remind: 0 }, '2026-11-22');
  assert.equal(t.remind, 0);
  assert.equal(reminderKey(t, at('2026-11-22', '07:59')), null);
  assert.ok(reminderKey(t, at('2026-11-22', '08:00')));
});

test('Plan aendern: wiederkehrend zu einmalig und zurueck', () => {
  const t = newTask(1, { text: 'Fenster', every: 14 }, '2026-11-01');
  applyPlan(t, { every: '', due: '' }, '2026-11-05');
  assert.equal(isRecurring(t), false);
  assert.equal(t.due, undefined);
  applyPlan(t, { every: 'm' }, '2026-11-05');
  assert.equal(t.every, 'm');
  assert.equal(t.due, '2026-11-05');
  assert.equal(everyLabel('m'), 'Monatlich');
  assert.equal(everyLabel(5), 'Alle 5 Tage');
});

test('Wiederkehrend machen oeffnet eine erledigte Aufgabe wieder', () => {
  const t = { id: 1, text: 'Alt', who: 'Rik', done: true, doneAt: '2026-11-01' };
  applyPlan(t, { every: 7 }, '2026-11-22');
  assert.equal(t.done, false);
  assert.equal(t.doneAt, undefined);
  assert.equal(t.who, 'Rik');
});

test('Ungueltige Eingaben werden verworfen', () => {
  const t = newTask(1, { text: '  ', every: 0, due: '2026-13-40', time: '25:00' }, '2026-11-22');
  assert.equal(isRecurring(t), false);
  assert.equal(t.due, undefined);
  assert.equal(t.time, undefined);
  assert.equal(newTask(2, { text: 'x'.repeat(80) }, '2026-11-22').text.length, 60);
});

test('Alte Aufgaben ohne neue Felder bleiben unveraendert', () => {
  const old = [
    { id: 1, text: 'Bad putzen', who: 'Rik', done: true },
    { id: 2, text: 'Notiz', who: 'Beide', done: false, note: true },
    { id: 3, text: 'Post', who: 'Melina', done: false, today: true }
  ];
  const clock = createClock(() => 1000);
  const store = createStore({ initial: { tasks: old }, persist: () => {}, clock, gen: () => 5 });
  assert.deepEqual(store.data.tasks, old);
  const now = at('2026-11-22');
  assert.deepEqual(old.map((t) => taskState(t, now).kind), ['done', 'none', 'none']);
  assert.deepEqual(doneOnce(old).map((t) => t.id), [1]);
});

test('Neue Felder ueberstehen den Sync (Normalisierung behaelt sie)', () => {
  const t = newTask(1, { text: 'Bad', every: 7, due: '2026-11-22', time: '09:00', remind: 15 }, '2026-11-22');
  completeRecurring(t, 'Melina', '2026-11-22');
  const n = normalizeEntry('tasks', JSON.parse(JSON.stringify(t)), () => 0);
  assert.equal(n.every, 7);
  assert.equal(n.due, '2026-11-29');
  assert.equal(n.time, '09:00');
  assert.equal(n.remind, 15);
  assert.deepEqual(n.log, t.log);
});

test('Verlauf mit 20 Eintraegen bleibt weit unter der Servergrenze (20 000 Byte)', () => {
  const t = newTask(1, { text: 'x'.repeat(60), every: 1 }, '2026-01-01');
  for (let i = 0; i < 50; i++) completeRecurring(t, 'Melina', addDays('2026-01-01', i));
  assert.ok(new TextEncoder().encode(JSON.stringify(t)).length < 2000);
});

test('Erledigt-Liste: neueste zuerst, ohne Notizen und Wiederkehrende', () => {
  const list = [
    { id: 1, text: 'A', done: true, doneAt: '2026-11-01' },
    { id: 2, text: 'B', done: true, doneAt: '2026-11-20' },
    { id: 3, text: 'C', done: false, every: 7, due: '2026-11-01' },
    { id: 4, text: 'N', done: true, note: true }
  ];
  assert.deepEqual(doneOnce(list).map((t) => t.id), [2, 1]);
});

test('Review 1: Heute-Eintrag wird wiederkehrend und landet in Diese Woche statt dauerhaft in Heute', () => {
  const now = at('2026-11-22');
  const t = { id: 1, text: 'Post', who: 'Beide', done: false, today: true };
  applyPlan(t, { every: 7, due: '2026-11-25' }, now.date);
  assert.equal(t.today, undefined);
  assert.equal(isForToday(t, now), false);
});

test('Review 2: Speichern ohne geaendertes Datum ueberschreibt keine Erledigung vom anderen Geraet', () => {
  const t = newTask(1, { text: 'Bad', every: 7, due: '2026-11-20' }, '2026-11-20');
  completeRecurring(t, 'Melina', '2026-11-22'); // kam per Sync, waehrend der Dialog offen war
  applyPlan(t, { text: 'Bad putzen' }, '2026-11-22'); // Dialog schickt nur das geaenderte Feld
  assert.equal(t.text, 'Bad putzen');
  assert.equal(t.due, '2026-11-29');
  assert.equal(t.log.length, 1);
});

test('Review 5: Uhrzeit ohne Datum setzt das Datum auf heute, Erinnerung bleibt', () => {
  const t = newTask(1, { text: 'Anruf', time: '18:00', remind: 15 }, '2026-11-22');
  assert.equal(t.due, '2026-11-22');
  assert.equal(t.time, '18:00');
  assert.equal(t.remind, 15);
});

test('Review 6: Datum leeren bei wiederkehrender Aufgabe heisst heute', () => {
  const t = newTask(1, { text: 'Bad', every: 7, due: '2026-12-01' }, '2026-11-22');
  applyPlan(t, { due: null }, '2026-11-22');
  assert.equal(t.due, '2026-11-22');
});

test('Review 4: Erledigte Heute-Eintraege nur am Tag der Erledigung', () => {
  const t = { id: 1, text: 'Post', who: 'Beide', done: false, today: true };
  toggleOnce(t, '2026-11-22');
  assert.equal(isForToday(t, at('2026-11-22')), true);
  assert.equal(isForToday(t, at('2026-11-23')), false);
  assert.equal(isForToday({ id: 2, text: 'Alt', today: true, done: true }, at('2026-11-23')), false);
});

let ok = 0;
for (const [name, fn] of tests) {
  try { fn(); ok++; } catch (e) { console.error('FEHLER: ' + name + '\n  ' + e.message); }
}
console.log(ok + '/' + tests.length + ' Tests bestanden');
if (ok !== tests.length) process.exit(1);
