// Nachtmodus: 22 bis 6 Uhr dunkle Uhr mit Pixel-Shift gegen Einbrennen.
// Per URL erzwingbar: ?night=an oder ?night=aus, sonst automatisch.
// Tippen auf den Nachtbildschirm zeigt fuer 2 Minuten den Tagmodus.
import { computeCal, currentWeather } from './render.js';
import { pad } from './util.js';

const $ = (id) => document.getElementById(id);
const param = new URLSearchParams(location.search).get('night');
const PEEK_MS = 2 * 60 * 1000;
let peekUntil = 0;

export function peek() { peekUntil = Date.now() + PEEK_MS; }

export function isNight(now) {
  if (Date.now() < peekUntil) return false;
  if (param === 'an') return true;
  if (param === 'aus') return false;
  const h = now.getHours();
  return h >= 22 || h < 6;
}

export function renderNight(now) {
  const { next } = computeCal(now);
  $('night-time').textContent = pad(now.getHours()) + ':' + pad(now.getMinutes());
  const w = currentWeather(now);
  const parts = [];
  if (next) parts.push(next.when + ' ' + next.title);
  if (w) parts.push(w.temp);
  $('night-line').textContent = parts.join(' · ');
  // Pixel-Shift: jede Minute ein anderer Versatz (Minute modulo 5), bis 24 px waagerecht und 16 px senkrecht.
  const shift = (now.getMinutes() % 5) - 2;
  $('night-shift').style.setProperty('transform', 'translate(' + shift * 12 + 'px, ' + shift * -8 + 'px)');
}
