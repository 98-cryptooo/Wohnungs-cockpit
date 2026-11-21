// Aufgaben-Logik: Wiederholung, Faelligkeit, Verlauf, Erinnerung. Rein, ohne DOM, unter Node testbar.
// Datum immer als 'JJJJ-MM-TT' (Berliner Kalendertag), Uhrzeit als 'HH:MM', jetzt als {date, minutes}.
//
// Felder einer Aufgabe in der Liste tasks (alle neuen optional, ohne sie verhaelt sich alles wie vor 3.1):
//   every  Zahl der Tage oder 'm' (monatlich). Gesetzt = wiederkehrend.
//   due    naechste Faelligkeit (wiederkehrend) oder Faelligkeit (einmalig)
//   time   optionale Uhrzeit, remind  Minuten vorher (0 = zur Uhrzeit), nur mit time
//   log    Verlauf [{at, by, prev}], neueste zuerst, hoechstens LOG_MAX. prev = Faelligkeit davor (fuer Zuruecknehmen)
//   doneAt wann eine einmalige Aufgabe erledigt wurde

export const WHO = ['Rik', 'Melina', 'Beide'];
export const LOG_MAX = 20;
export const EVERY_OPTIONS = [[1, 'Täglich'], [2, 'Alle 2 Tage'], [3, 'Alle 3 Tage'], [7, 'Wöchentlich'], [14, 'Alle 2 Wochen'], [21, 'Alle 3 Wochen'], [28, 'Alle 4 Wochen'], ['m', 'Monatlich']];
export const REMIND_OPTIONS = [[null, 'Keine Erinnerung'], [0, 'Zur Uhrzeit'], [5, '5 Minuten vorher'], [15, '15 Minuten vorher'], [30, '30 Minuten vorher'], [60, '1 Stunde vorher']];
// Erinnerung bleibt so lange "aktiv", wie lange nach der Uhrzeit ein Banner noch Sinn ergibt
export const REMIND_WINDOW_MIN = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isDate = (v) => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v + 'T12:00:00Z'));
export const isTime = (v) => typeof v === 'string' && TIME_RE.test(v);

export function validEvery(v) {
  if (v === 'm') return 'm';
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null;
}
export const isRecurring = (t) => !!t && validEvery(t.every) !== null;
const validRemind = (v) => (v === null || v === undefined || v === '' ? null : (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 1440 ? Number(v) : null));

// ---- Datum ---------------------------------------------------------------------------------------
const dayNum = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const fromNum = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
export const addDays = (iso, n) => fromNum(dayNum(iso) + n);
export const dayDiff = (from, to) => dayNum(to) - dayNum(from);
// Monat dazu, Tag am Monatsende gekappt (31.01. -> 28./29.02.)
export function addMonth(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return ny + '-' + String(nm).padStart(2, '0') + '-' + String(Math.min(d, last)).padStart(2, '0');
}
const toMin = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);

// Naechste Faelligkeit ab dem Tag der Erledigung
export function nextDue(doneIso, every) {
  const e = validEvery(every);
  if (e === null) return null;
  return e === 'm' ? addMonth(doneIso) : addDays(doneIso, e);
}

// ---- Aenderungen (arbeiten auf der Kopie, die write() hereinreicht) -------------------------------
export function newTask(id, input, today) {
  const t = { id, text: String(input.text || '').trim().slice(0, 60), who: 'Beide', done: false };
  applyPlan(t, input, today);
  return t;
}

// Plan setzen oder aendern. Nur Felder, die in input vorkommen (nicht undefined), werden angefasst.
// So ueberschreibt ein Dialog keine Aenderung, die inzwischen von einem anderen Geraet kam.
// Leeres Datum: wiederkehrend = heute, einmalig = ohne Datum. Uhrzeit ohne Datum: Datum = heute.
export function applyPlan(t, input, today) {
  if (input.text !== undefined) { const s = String(input.text).trim().slice(0, 60); if (s) t.text = s; }
  if (input.every !== undefined) { const e = validEvery(input.every); if (e !== null) t.every = e; else delete t.every; }
  const rec = isRecurring(t);
  if (input.due !== undefined) { if (isDate(input.due)) t.due = input.due; else if (rec) t.due = today; else delete t.due; }
  if (input.time !== undefined) { if (isTime(input.time)) t.time = input.time; else delete t.time; }
  if (input.remind !== undefined) { const r = validRemind(input.remind); if (r !== null) t.remind = r; else delete t.remind; }
  if (rec && !isDate(t.due)) t.due = today;
  if (isTime(t.time) && !isDate(t.due)) t.due = today;
  if (!isDate(t.due)) delete t.time;
  if (!isTime(t.time)) delete t.remind;
  if (rec) { t.done = false; delete t.doneAt; delete t.today; }
  return t;
}

// Wiederkehrende Aufgabe erledigt: Verlauf vorne anfuegen, naechste Faelligkeit ab heute.
export function completeRecurring(t, by, today) {
  const who = WHO.includes(by) ? by : 'Beide';
  const log = Array.isArray(t.log) ? t.log.filter((x) => x && isDate(x.at)) : [];
  log.unshift({ at: today, by: who, prev: isDate(t.due) ? t.due : null });
  t.log = log.slice(0, LOG_MAX);
  t.due = nextDue(today, t.every);
  t.done = false;
  return t;
}

// Letzten Durchgang zuruecknehmen (falsch angetippt): alte Faelligkeit wiederherstellen.
export function undoLast(t) {
  if (!Array.isArray(t.log) || !t.log.length) return t;
  const last = t.log.shift();
  if (isDate(last.prev)) t.due = last.prev;
  if (!t.log.length) delete t.log;
  return t;
}

// Einmalige Aufgabe abhaken oder wieder oeffnen
export function toggleOnce(t, today) {
  t.done = !t.done;
  if (t.done) t.doneAt = today; else delete t.doneAt;
  return t;
}

// ---- Anzeige ------------------------------------------------------------------------------------
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
export function shortDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return WD[new Date(iso + 'T12:00:00Z').getUTCDay()] + ' ' + d + '.' + m + '.';
}
export function everyLabel(every) {
  const e = validEvery(every);
  if (e === null) return '';
  const hit = EVERY_OPTIONS.find(([v]) => v === e);
  return hit ? hit[1] : 'Alle ' + e + ' Tage';
}

// Zustand fuer jetzt: kind = overdue | today | soon | later | none | done, dazu ein kurzer Text.
export function taskState(t, now) {
  if (!isRecurring(t) && t.done) return { kind: 'done', label: t.doneAt && isDate(t.doneAt) ? 'erledigt ' + shortDate(t.doneAt) : 'erledigt' };
  if (!isDate(t.due)) return { kind: 'none', label: '' };
  const diff = dayDiff(now.date, t.due);
  const at = isTime(t.time) ? ' um ' + t.time : '';
  if (diff < 0) return { kind: 'overdue', label: 'überfällig seit ' + plural(-diff, 'Tag', 'Tagen') };
  if (diff === 0) {
    if (isTime(t.time) && now.minutes >= toMin(t.time)) return { kind: 'overdue', label: 'überfällig seit ' + t.time };
    return { kind: 'today', label: 'heute' + at };
  }
  if (diff === 1) return { kind: 'soon', label: 'morgen' + at };
  if (diff < 7) return { kind: 'soon', label: shortDate(t.due) + at };
  return { kind: 'later', label: 'ab ' + shortDate(t.due) };
}

// Gehoert die Aufgabe heute in "Heute zu tun"? Offene Eintraege mit today, dazu Faelliges und Ueberfaelliges.
export function isForToday(t, now) {
  if (t.note) return false;
  // Alte "Heute zu tun"-Eintraege: offen immer, erledigt nur am Tag der Erledigung (sonst waechst die Liste endlos)
  if (t.today && !isRecurring(t)) return !t.done || t.doneAt === now.date;
  const k = taskState(t, now).kind;
  return k === 'today' || k === 'overdue';
}

// Sortierung fuer Diese Woche: ueberfaellig, heute, nach Datum, ohne Datum zuletzt (Reihenfolge bleibt).
const RANK = { overdue: 0, today: 1, soon: 2, later: 2, none: 3, done: 4 };
export function sortTasks(list, now) {
  return list
    .map((t, i) => ({ t, i, s: taskState(t, now) }))
    .sort((a, b) => (RANK[a.s.kind] - RANK[b.s.kind])
      || (a.t.due && b.t.due ? (a.t.due + (a.t.time || '')).localeCompare(b.t.due + (b.t.time || '')) : 0)
      || a.i - b.i)
    .map((x) => x.t);
}

// Erledigte einmalige Aufgaben, neueste zuerst (fuer "Erledigt" in der grossen Ansicht)
export function doneOnce(list) {
  return list.filter((t) => !t.note && !isRecurring(t) && t.done)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => String(b.t.doneAt || '').localeCompare(String(a.t.doneAt || '')) || b.i - a.i)
    .map((x) => x.t);
}

// ---- Erinnerung ---------------------------------------------------------------------------------
// Liefert einen Schluessel, wenn die Erinnerung jetzt angezeigt werden soll, sonst null.
// Faellig ab (Uhrzeit minus Vorlauf) bis REMIND_WINDOW_MIN nach der Uhrzeit. Erledigtes erinnert nie.
export function reminderKey(t, now) {
  if (t.note || (!isRecurring(t) && t.done)) return null;
  if (!isDate(t.due) || !isTime(t.time)) return null;
  const r = validRemind(t.remind);
  if (r === null) return null;
  const at = dayNum(t.due) * 1440 + toMin(t.time);
  const cur = dayNum(now.date) * 1440 + now.minutes;
  if (cur < at - r || cur >= at + REMIND_WINDOW_MIN) return null;
  return String(t.id) + '|' + t.due + '|' + t.time;
}
export function reminderText(t, now) {
  const at = dayNum(t.due) * 1440 + toMin(t.time);
  const cur = dayNum(now.date) * 1440 + now.minutes;
  const left = at - cur;
  if (left > 0) return 'In ' + plural(left, 'Minute', 'Minuten') + ': ' + t.text;
  return 'Jetzt: ' + t.text;
}
