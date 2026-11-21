// Erinnerungen auf diesem Geraet: Banner oben und ein kurzer Ton, nachts (22 bis 6 Uhr) nur das Banner.
// Welche Erinnerung schon gezeigt wurde, merkt sich jedes Geraet selbst (localStorage), damit nach dem
// Neuladen nicht noch einmal geklingelt wird. Safari erlaubt Ton erst nach einer ersten Beruehrung.
import { data, write } from './state.js';
import { reminderKey, reminderText, isRecurring, toggleOnce } from './tasks.js';
import { berlinNow } from './calendar.js';
import { openOverlay } from './render.js';
import { isNight, peek } from './night.js';
import { leaveStandby } from './standby.js';

const SEEN_KEY = 'wohnungs-cockpit.reminded';
const SEEN_MAX = 100;
const $ = (id) => document.getElementById(id);
let seen = [];
try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); if (Array.isArray(v)) seen = v.filter((x) => typeof x === 'string').slice(-SEEN_MAX); } catch (e) { /* ignorieren */ }
let shown = null; // { key, id }
let audio = null;

function remember(key) {
  seen.push(key);
  seen = seen.slice(-SEEN_MAX);
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) { /* ignorieren */ }
}

// Ton: drei kurze, leise Glockentoene ueber Web Audio (keine Datei noetig)
function unlock() {
  if (audio) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try { audio = new Ctx(); if (audio.state === 'suspended') audio.resume(); } catch (e) { audio = null; }
}
function chime() {
  if (!audio) return;
  try {
    if (audio.state === 'suspended') audio.resume();
    const t0 = audio.currentTime + 0.05;
    [880, 1175, 880].forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = t0 + i * 0.35;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.32);
    });
  } catch (e) { /* ohne Ton weiter */ }
}

function hide() {
  shown = null;
  $('reminder').hidden = true;
}

function show(t, key, now) {
  shown = { key, id: t.id };
  remember(key);
  $('rem-text').textContent = reminderText(t, berlinNow(now));
  // Wiederkehrendes fragt erst, wer es erledigt hat
  $('rem-done').textContent = isRecurring(t) ? 'Wer hat es erledigt?' : 'Erledigt';
  $('reminder').hidden = false;
  if (!isNight(now)) chime();
}

// Einmal pro Minute und nach jeder Aenderung an tasks aufrufen.
export function checkReminders(now = new Date()) {
  const b = berlinNow(now);
  if (shown) {
    const t = data.tasks.find((x) => String(x.id) === String(shown.id));
    // Erledigt, geloescht oder Datum/Uhrzeit geaendert: Banner weg (eine neue Zeit meldet sich selbst)
    if (!t || reminderKey(t, b) !== shown.key) hide();
    else $('rem-text').textContent = reminderText(t, b);
    if (shown) return;
  }
  for (const t of data.tasks) {
    const key = reminderKey(t, b);
    if (key && !seen.includes(key)) { show(t, key, now); return; }
  }
}

export function initReminders() {
  document.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  document.addEventListener('keydown', unlock, { capture: true });
  $('rem-ok').addEventListener('click', hide);
  $('rem-done').addEventListener('click', () => {
    if (shown) {
      const id = shown.id;
      const t = data.tasks.find((z) => String(z.id) === String(id));
      // Dialog muss sichtbar sein: Standby beenden, nachts kurz den Tagmodus zeigen
      if (t && isRecurring(t)) { hide(); leaveStandby(); if (isNight(new Date())) peek(); openOverlay('who:' + id); return; }
      const d = berlinNow(new Date()).date;
      write('tasks', (l) => { const y = l.find((z) => String(z.id) === String(id)); if (y && !isRecurring(y) && !y.done) toggleOnce(y, d); });
    }
    hide();
  });
}
