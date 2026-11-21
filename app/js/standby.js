// Standby: nach 5 Minuten ohne Beruehrung ein grosser Kalender ueber fuenf Wochen (ab Montag dieser Woche).
// Ein Tipp schliesst ihn wieder, der Tipp loest darunter nichts aus.
// Nie im Kochmodus, nie nachts (dann gilt der Nachtmodus), nie bei der Ersteinrichtung, nicht auf dem Telefon.
// Per URL erzwingbar: ?standby=an (sofort) oder ?standby=aus (nie).
import { DEMO, calendarRaw } from './state.js';
import { getCalendarState, berlinNow } from './calendar.js';
import { calIndex, currentWeather } from './render.js';
import { el, pad } from './util.js';

const $ = (id) => document.getElementById(id);
const IDLE_MS = 5 * 60 * 1000;
const WEEKS = 5;
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MSHORT = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const param = new URLSearchParams(location.search).get('standby');
const WIDE = window.matchMedia('(min-width: 700px)');

let lastActivity = param === 'an' ? 0 : Date.now();
let active = false;

export const isStandby = () => active;
// Von aussen beenden (z. B. Erinnerungs-Banner oeffnet einen Dialog). Zeichnet nicht selbst neu.
export function leaveStandby() { if (active) { active = false; lastActivity = Date.now(); } }

// Prueft, ob der Standby an oder aus sein soll. blocked: Kochmodus, Nacht, Ersteinrichtung.
// Gibt true zurueck, wenn sich der Zustand geaendert hat.
export function standbyTick(blocked) {
  const was = active;
  if (param === 'aus' || blocked || !WIDE.matches) {
    active = false;
    if (blocked) lastActivity = Date.now(); // nach dem Kochen oder der Nacht wieder volle 5 Minuten
  } else if (!active && Date.now() - lastActivity >= IDLE_MS) {
    active = true;
  }
  return was !== active;
}

export function initStandby(onChange) {
  const touch = () => { if (!active) lastActivity = Date.now(); };
  ['pointerdown', 'keydown', 'wheel', 'input'].forEach((ev) => document.addEventListener(ev, touch, { capture: true, passive: true }));
  const wake = (e) => {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    active = false;
    lastActivity = Date.now();
    onChange();
  };
  $('standby').addEventListener('click', wake);
  // Tastatur (z. B. am Mac): jede Taste weckt, ohne dass sie im Cockpit etwas ausloest
  document.addEventListener('keydown', (e) => { if (active) wake(e); }, { capture: true });
}

const isoOf = (d) => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());

export function renderStandby(now) {
  const today = berlinNow(now).date;
  const [ty, tm, td] = today.split('-').map(Number);
  // Montag dieser Woche (Rechnung in UTC, damit Sommerzeit nichts verschiebt)
  const t = new Date(Date.UTC(ty, tm - 1, td));
  const start = new Date(t);
  start.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));

  const events = DEMO ? calendarRaw(now) : getCalendarState().events;
  const byDay = {};
  events.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });

  // Wie viele Zeilen passen in eine Zelle (Kopfzeile und Wochentage abgezogen)
  const cellH = (window.innerHeight - 120) / WEEKS;
  const maxRows = Math.max(2, Math.floor((cellH - 42) / 26));

  $('sb-month').textContent = MONTHS[tm - 1] + ' ' + ty;
  $('sb-time').textContent = pad(now.getHours()) + ':' + pad(now.getMinutes());
  const w = currentWeather(now);
  $('sb-temp').textContent = w ? w.temp : '';

  const cells = [];
  WD.forEach((d) => cells.push(el('div', 'sb-wd', d)));
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const iso = isoOf(d);
    const cell = el('div', 'sb-cell');
    if (iso < today) cell.classList.add('is-past');
    if (d.getUTCMonth() !== tm - 1) cell.classList.add('is-other');
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) cell.classList.add('is-weekend');
    const num = el('div', 'sb-num');
    const label = d.getUTCDate() === 1 ? '1. ' + MSHORT[d.getUTCMonth()] : String(d.getUTCDate());
    const n = el('span', iso === today ? 'sb-n is-today' : 'sb-n', label);
    num.append(n);
    cell.append(num);

    // Ganztaegige zuerst, dann nach Uhrzeit
    const evs = (byDay[iso] || []).slice().sort((a, b) => (a.time ? 1 : 0) - (b.time ? 1 : 0) || (a.time || '').localeCompare(b.time || ''));
    const shown = evs.length > maxRows ? evs.slice(0, maxRows - 1) : evs;
    shown.forEach((e) => {
      const c = 'c' + calIndex(e.cal);
      if (!e.time) {
        cell.append(el('div', 'sb-ev sb-all ' + c, e.title));
      } else {
        const row = el('div', 'sb-ev sb-timed');
        row.append(el('span', 'sb-bar ' + c), el('span', 'sb-title', e.title), el('span', 'sb-at', e.time));
        cell.append(row);
      }
    });
    if (evs.length > shown.length) cell.append(el('div', 'sb-more', '+' + (evs.length - shown.length) + ' weitere'));
    cells.push(cell);
  }
  $('sb-grid').replaceChildren(...cells);
}
