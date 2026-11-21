// Tests fuer den ICS-Parser der Edge Function calendar (fiktive Termine).
//   node tests/ics.test.mjs
import assert from 'node:assert/strict';
import { parseICS, parseDT, occurrences, unesc } from '../supabase/functions/calendar/ics.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const cal = (...events) => ['BEGIN:VCALENDAR', 'X-WR-CALNAME:Haushalt', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const dates = (evs) => evs.map((e) => e.date + (e.time ? ' ' + e.time : ''));

test('Einzeltermin mit Berliner Zeit', () => {
  const evs = parseICS(cal(['UID:a', 'DTSTART;TZID=Europe/Berlin:20261124T190000', 'DTEND;TZID=Europe/Berlin:20261124T210000', 'SUMMARY:Treffen']), 'X', '2026-11-22', '2026-12-31');
  assert.deepEqual(evs, [{ date: '2026-11-24', time: '19:00', end: '21:00', title: 'Treffen', location: null, cal: 'Haushalt' }]);
});

test('UTC-Zeit wird Berliner Zeit (Winter +1, Sommer +2)', () => {
  assert.deepEqual(parseDT('', '20261124T180000Z'), { date: '2026-11-24', time: '19:00' });
  assert.deepEqual(parseDT('', '20260701T180000Z'), { date: '2026-07-01', time: '20:00' });
  assert.deepEqual(parseDT('', '20261124T233000Z'), { date: '2026-11-25', time: '00:30' });
});

test('S6: fremde Zeitzone wird umgerechnet, unbekannte bleibt Ortszeit', () => {
  assert.deepEqual(parseDT('TZID=America/New_York', '20261124T130000'), { date: '2026-11-24', time: '19:00' });
  assert.deepEqual(parseDT('TZID="Europe/London"', '20260701T090000'), { date: '2026-07-01', time: '10:00' });
  assert.deepEqual(parseDT('TZID=W. Europe Standard Time', '20261124T130000'), { date: '2026-11-24', time: '13:00' });
});

test('S4: verschobener Einzeltermin ersetzt den Serientermin, auch an anderem Tag', () => {
  const evs = parseICS(cal(
    ['UID:s1', 'DTSTART;TZID=Europe/Berlin:20261102T180000', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Sport'],
    ['UID:s1', 'RECURRENCE-ID;TZID=Europe/Berlin:20261123T180000', 'DTSTART;TZID=Europe/Berlin:20261125T170000', 'SUMMARY:Sport']
  ), 'X', '2026-11-16', '2026-12-01');
  assert.deepEqual(dates(evs), ['2026-11-16 18:00', '2026-11-25 17:00', '2026-11-30 18:00']);
});

test('S4: verschobene Uhrzeit am selben Tag ersetzt den Termin statt ihn zu verdoppeln', () => {
  const evs = parseICS(cal(
    ['UID:s2', 'DTSTART;TZID=Europe/Berlin:20261102T180000', 'RRULE:FREQ=WEEKLY;COUNT=5', 'SUMMARY:Kurs'],
    ['UID:s2', 'RECURRENCE-ID;TZID=Europe/Berlin:20261116T180000', 'DTSTART;TZID=Europe/Berlin:20261116T200000', 'SUMMARY:Kurs']
  ), 'X', '2026-11-16', '2026-11-16');
  assert.deepEqual(dates(evs), ['2026-11-16 20:00']);
});

test('S5: jeden 2. Montag im Monat', () => {
  assert.deepEqual(occurrences('2026-11-09', 'FREQ=MONTHLY;BYDAY=2MO', '2027-02-28'), ['2026-11-09', '2026-12-14', '2027-01-11', '2027-02-08']);
});

test('S5: letzter Freitag im Monat', () => {
  assert.deepEqual(occurrences('2026-11-27', 'FREQ=MONTHLY;BYDAY=-1FR;COUNT=3', '2027-12-31'), ['2026-11-27', '2026-12-25', '2027-01-29']);
});

test('S5: BYMONTHDAY mit 15. und letztem Tag', () => {
  assert.deepEqual(occurrences('2026-11-15', 'FREQ=MONTHLY;BYMONTHDAY=15,-1', '2027-01-31'), ['2026-11-15', '2026-11-30', '2026-12-15', '2026-12-31', '2027-01-15', '2027-01-31']);
});

test('Monatlich am 31. faellt in kurzen Monaten aus', () => {
  assert.deepEqual(occurrences('2026-10-31', 'FREQ=MONTHLY', '2027-01-31'), ['2026-10-31', '2026-12-31', '2027-01-31']);
});

test('Woechentlich mit BYDAY und INTERVAL=2 bleibt in der richtigen Woche', () => {
  // Start Mittwoch, Montag und Mittwoch alle zwei Wochen. Der Montag vor dem Start zaehlt nicht.
  assert.deepEqual(occurrences('2026-11-04', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', '2026-11-30'), ['2026-11-04', '2026-11-16', '2026-11-18', '2026-11-30']);
});

test('UNTIL und EXDATE werden beachtet', () => {
  const evs = parseICS(cal(['UID:t', 'DTSTART;VALUE=DATE:20261101', 'RRULE:FREQ=DAILY;UNTIL=20261105', 'EXDATE;VALUE=DATE:20261103', 'SUMMARY:Urlaub']), 'X', '2026-11-01', '2026-11-30');
  assert.deepEqual(dates(evs), ['2026-11-01', '2026-11-02', '2026-11-04', '2026-11-05']);
});

test('Jaehrlich (Geburtstag) und Geburtstag am 29.02.', () => {
  assert.deepEqual(occurrences('2000-03-12', 'FREQ=YEARLY', '2027-12-31').slice(-2), ['2026-03-12', '2027-03-12']);
  assert.deepEqual(occurrences('2024-02-29', 'FREQ=YEARLY', '2029-12-31'), ['2024-02-29', '2028-02-29']);
});

test('Jaehrlich mit BYMONTH und BYDAY (letzter Sonntag im Oktober)', () => {
  assert.deepEqual(occurrences('2026-10-25', 'FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', '2027-12-31'), ['2026-10-25', '2027-10-31']);
});

test('Mehrtaegiger Ganztagstermin an jedem Tag, Ende exklusiv', () => {
  const evs = parseICS(cal(['UID:u', 'DTSTART;VALUE=DATE:20261123', 'DTEND;VALUE=DATE:20261126', 'SUMMARY:Reise']), 'X', '2026-11-22', '2026-11-30');
  assert.deepEqual(dates(evs), ['2026-11-23', '2026-11-24', '2026-11-25']);
});

test('S7: mehrtaegiger Termin mit Uhrzeit liefert Ende mit Datum', () => {
  const evs = parseICS(cal(['UID:v', 'DTSTART;TZID=Europe/Berlin:20261127T180000', 'DTEND;TZID=Europe/Berlin:20261129T120000', 'SUMMARY:Wochenende']), 'X', '2026-11-22', '2026-11-30');
  assert.equal(evs.length, 1);
  assert.equal(evs[0].end, '2026-11-29T12:00');
});

test('S7: maskierte Zeichen im Titel', () => {
  assert.equal(unesc('Kaffee\\, Kuchen\\; Sekt'), 'Kaffee, Kuchen; Sekt');
});

test('Abgesagte Termine fehlen, Zeitfenster wird eingehalten', () => {
  const evs = parseICS(cal(
    ['UID:w', 'DTSTART;VALUE=DATE:20261124', 'STATUS:CANCELLED', 'SUMMARY:Abgesagt'],
    ['UID:x', 'DTSTART;VALUE=DATE:20270124', 'SUMMARY:Zu weit']
  ), 'X', '2026-11-22', '2026-12-31');
  assert.deepEqual(evs, []);
});

test('Taegliche Serie ueber Jahre endet nicht vorzeitig', () => {
  const evs = parseICS(cal(['UID:y', 'DTSTART;VALUE=DATE:20200101', 'RRULE:FREQ=DAILY', 'SUMMARY:Tabletten']), 'X', '2026-11-22', '2026-11-23');
  assert.deepEqual(dates(evs), ['2026-11-22', '2026-11-23']);
});

test('Review 2: Serie in fremder Zone springt auf den richtigen Berliner Wochentag', () => {
  const evs = parseICS(cal(['UID:z1', 'DTSTART;TZID=America/New_York:20261102T190000', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'SUMMARY:Call']), 'X', '2026-11-09', '2026-11-15');
  assert.deepEqual(dates(evs), ['2026-11-10 01:00']);
});

test('Review 2: UTC-Serie aus dem Sommer steht im Winter eine Stunde frueher', () => {
  const evs = parseICS(cal(['UID:z2', 'DTSTART:20260706T080000Z', 'DTEND:20260706T090000Z', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Standup']), 'X', '2026-11-23', '2026-11-29');
  assert.deepEqual(evs.map((e) => [e.date, e.time, e.end]), [['2026-11-23', '09:00', '10:00']]);
});

test('Review 3: taeglich nur werktags (BYDAY bei DAILY)', () => {
  assert.deepEqual(occurrences('2026-11-20', 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', '2026-11-24'), ['2026-11-20', '2026-11-23', '2026-11-24']);
});

test('Review 3: letzter Werktag im Monat (BYSETPOS=-1)', () => {
  assert.deepEqual(occurrences('2026-11-30', 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', '2027-01-31'), ['2026-11-30', '2026-12-31', '2027-01-29']);
});

test('Review 3: Freitag, der 13. ist eine Schnittmenge', () => {
  assert.deepEqual(occurrences('2026-02-13', 'FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13', '2026-12-31'), ['2026-02-13', '2026-03-13', '2026-11-13']);
});

test('Review 3: unbekannte Regelteile zeigen nur den ersten Termin', () => {
  assert.deepEqual(occurrences('2026-11-02', 'FREQ=YEARLY;BYWEEKNO=20', '2030-12-31'), ['2026-11-02']);
});

test('Review 4: mehrtaegiger Termin, der vor dem Fenster beginnt, erscheint', () => {
  const evs = parseICS(cal(['UID:m1', 'DTSTART;TZID=Europe/Berlin:20261122T100000', 'DTEND;TZID=Europe/Berlin:20261125T100000', 'SUMMARY:Messe']), 'X', '2026-11-23', '2026-11-30');
  assert.deepEqual(evs.map((e) => [e.date, e.end]), [['2026-11-22', '2026-11-25T10:00']]);
});

test('Review 5: UNTIL mit Uhrzeit schliesst einen spaeteren Termin am selben Tag aus', () => {
  const evs = parseICS(cal(['UID:u1', 'DTSTART;TZID=Europe/Berlin:20261117T100000', 'RRULE:FREQ=WEEKLY;UNTIL=20261124T080000Z', 'SUMMARY:Kurs']), 'X', '2026-11-16', '2026-11-30');
  assert.deepEqual(dates(evs), ['2026-11-17 10:00']);
});

let ok = 0;
for (const [name, fn] of tests) {
  try { fn(); ok++; } catch (e) { console.error('FEHLER: ' + name + '\n  ' + e.message); }
}
console.log(ok + '/' + tests.length + ' Tests bestanden');
if (ok !== tests.length) process.exit(1);
