// Kalender: Abruf der Edge Function "calendar" und Aufbereitung der Termine.
// Der Kern (sanitize, buildCalendar) ist rein und laeuft unter Node. Die Netzwerkschicht bekommt fetch,
// Zugang und Speicher hereingereicht. Haushaltscode und Schluessel erscheinen nie in Meldungen oder Logs.
import { BASE_URL, buildHeaders } from './sync.js';

export const CAL_DAYS = 21;
export const CAL_INTERVAL_MS = 5 * 60 * 1000;
export const CAL_TIMEOUT_MS = 15000;
export const CAL_MIN_GAP_MS = 60 * 1000;
const DSHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const pad = (n) => String(n).padStart(2, '0');
const cut = (v, n) => String(v == null ? '' : v).slice(0, n);

// ---- Antwort pruefen (kommt vom Netz, also unvertraut) ---------------------------------
export function sanitizeEvents(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach((e) => {
    if (!e || typeof e !== 'object' || out.length >= 500) return;
    if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return;
    const time = typeof e.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(e.time) ? e.time : null;
    // Ende: "HH:MM" am selben Tag oder "YYYY-MM-DDTHH:MM" (Zeitzone wird ignoriert)
    let endDate = null;
    let endTime = null;
    const en = typeof e.end === 'string' ? e.end : '';
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(en)) endTime = en;
    else {
      const x = en.match(/^(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):([0-5]\d)/);
      if (x) { endDate = x[1]; endTime = x[2] + ':' + x[3]; }
    }
    out.push({ date: e.date, time, endDate, endTime, title: cut(e.title, 200), cal: cut(e.cal, 80) });
  });
  return out;
}
export function sanitizeToday(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
export function sanitizeCalendars(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c) => c && typeof c === 'object').slice(0, 20).map((c) => ({ name: cut(c.name, 80), ok: c.ok !== false }));
}

// ---- Zeit in Europe/Berlin (nicht die Geraetezeit) -------------------------------------------
// Liefert {date: 'YYYY-MM-DD', minutes: Minuten seit Mitternacht}.
export function berlinNow(now) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const g = (t) => parts.find((p) => p.type === t).value;
    return { date: g('year') + '-' + g('month') + '-' + g('day'), minutes: (+g('hour') % 24) * 60 + +g('minute') };
  } catch (e) { // Ausweichloesung: Geraetezeit
    return { date: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()), minutes: now.getHours() * 60 + now.getMinutes() };
  }
}
const dayNum = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const toMin = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);

// Ein Termin mit Beginn heute gilt erst nach seinem Ende als vergangen (ohne Ende: Beginn plus 1 Stunde).
function endMinutes(e) {
  const start = toMin(e.time);
  if (e.endTime) {
    if (e.endDate && e.endDate > e.date) return Infinity; // endet an einem spaeteren Tag
    const end = toMin(e.endTime);
    if (end > start) return end;
    if (end < start) return Infinity; // ueber Mitternacht
  }
  return start + 60;
}

// ---- Termine fuer die Anzeige aufbereiten ------------------------------------------------
// events: [{date, time, endDate, endTime, title, cal}], calendars: [{name, ok}]. Liefert {cal, todayEv, next}.
// Jeder Termin: day (Chip), title, diff, soon, when (Kachel, Kalendername nur bei Termin aus einem weiteren Kalender),
// whenAll (Overlay, Kalendername immer). "Heute" und die Uhrzeit gelten in Europe/Berlin.
export function buildCalendar(events, calendars, now) {
  const bn = berlinNow(now);
  const todayN = dayNum(bn.date);
  const names = (calendars || []).map((c) => c.name);
  // Uhrzeit, die nur im Titel steht (z. B. "Keramik bemalen 15:00" oder "17;00 Lauftreff"), herausziehen
  const tidy = (e) => {
    if (e.time) return e;
    const m = e.title.match(/(^|\s)(\d{1,2})[:;](\d{2})(\s|$)/);
    if (!m || +m[2] > 23 || +m[3] > 59) return e;
    return Object.assign({}, e, { time: m[2].padStart(2, '0') + ':' + m[3], title: e.title.replace(m[0], ' ').replace(/\s+/g, ' ').trim() });
  };
  const cal = events.map(tidy)
    .sort((a, b) => (a.date + (a.time || '00:00')).localeCompare(b.date + (b.time || '00:00')))
    .map((e) => {
      const diff = dayNum(e.date) - todayN;
      const [y, mo, da] = e.date.split('-').map(Number);
      const wd = DSHORT[new Date(Date.UTC(y, mo - 1, da)).getUTCDay()];
      const rel = diff === 0 ? 'Heute' : diff === 1 ? 'Morgen' : wd + ' ' + da + '.' + mo + '.';
      const base = rel + ' · ' + (e.time ? e.time + ' Uhr' : 'ganztägig');
      const showCal = names.length > 1 && !!e.cal && e.cal !== names[0];
      return {
        day: diff === 0 ? 'Heute' : diff === 1 ? 'Morgen' : wd,
        title: e.title, diff, soon: diff <= 1,
        past: diff === 0 && !!e.time && bn.minutes >= endMinutes(e),
        when: base + (showCal ? ' · ' + e.cal : ''),
        whenAll: base + (e.cal ? ' · ' + e.cal : '')
      };
    })
    .filter((e) => Number.isFinite(e.diff) && e.diff >= 0 && !e.past);
  return { cal, todayEv: cal.filter((e) => e.diff === 0), next: cal[0] };
}

// Hinweiszeile fuer die Kachel. state: {status, stamp, calendars}. Leer, wenn alles in Ordnung ist.
export function calendarNote(state) {
  const parts = [];
  if (state.status === 'denied') parts.push('Zugang abgelehnt');
  else if ((state.status === 'offline' || state.status === 'error' || state.status === 'idle') && state.stamp) {
    const m = berlinNow(new Date(state.stamp)).minutes;
    parts.push('Stand ' + pad(Math.floor(m / 60)) + ':' + pad(m % 60));
  }
  const bad = (state.calendars || []).filter((c) => !c.ok).map((c) => c.name || 'ohne Namen');
  if (bad.length === 1) parts.push('Kalender ' + bad[0] + ' nicht erreichbar');
  else if (bad.length > 1) parts.push('Kalender ' + bad.join(', ') + ' nicht erreichbar');
  return parts.join(' · ');
}

// ---- Netzwerk ------------------------------------------------------------------------------
// Fehlerart: 'offline' (kein Netz, Zeitueberschreitung), 'denied' (401/403), 'error' (sonst)
export class CalError extends Error {
  constructor(kind) { super(kind); this.kind = kind; }
}

export async function fetchCalendar(creds, fetchImpl, timeoutMs = CAL_TIMEOUT_MS) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetchImpl(BASE_URL + '/functions/v1/calendar', {
        method: 'POST', headers: buildHeaders(creds.key), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
        signal: ctl.signal, body: JSON.stringify({ code: creds.code, days: CAL_DAYS })
      });
    } catch (e) { throw new CalError('offline'); }
    if (res.status === 401 || res.status === 403) throw new CalError('denied');
    if (!res.ok) throw new CalError('error');
    let body;
    try { body = await res.json(); } catch (e) { throw new CalError(ctl.signal.aborted ? 'offline' : 'error'); }
    if (!body || typeof body !== 'object' || !Array.isArray(body.events)) throw new CalError('error');
    return { today: sanitizeToday(body.today), events: sanitizeEvents(body.events), calendars: sanitizeCalendars(body.calendars) };
  } finally {
    clearTimeout(timer);
  }
}

// opts: creds {code, key}, fetchImpl, storage {load(), save(x), clear()}, nowFn, onUpdate(), timeoutMs,
//       repeat/stopRepeat (setInterval/clearInterval)
export function createCalendar(opts) {
  const nowFn = opts.nowFn || Date.now;
  const repeat = opts.repeat || ((fn, ms) => setInterval(fn, ms));
  const stopRepeat = opts.stopRepeat || ((t) => clearInterval(t));
  const state = { today: null, events: [], calendars: [], stamp: null, status: 'idle' };
  const cached = opts.storage.load();
  if (cached && typeof cached === 'object') {
    state.today = sanitizeToday(cached.today);
    state.events = sanitizeEvents(cached.events);
    state.calendars = sanitizeCalendars(cached.calendars);
    state.stamp = Number.isFinite(Number(cached.stamp)) ? Number(cached.stamp) : null;
  }
  let generation = 0; // wird bei stop() erhoeht: laufende Abrufe schreiben danach nichts mehr
  let started = false;
  let denied = false;
  let active = null;
  let timer = null;
  let lastAttempt = -Infinity;
  const notify = () => { try { if (opts.onUpdate) opts.onUpdate(); } catch (e) { /* darf nichts blockieren */ } };

  // user = ausdrueckliche Nutzeraktion ("Jetzt abgleichen"): ohne Mindestabstand. Sonst hoechstens ein Versuch pro 60 s.
  function refresh(user) {
    if (!started || denied) return Promise.resolve();
    if (active) return active; // doppelte Aufrufe zusammenfassen
    if (user !== true && nowFn() - lastAttempt < CAL_MIN_GAP_MS) return Promise.resolve();
    lastAttempt = nowFn();
    const myGen = generation;
    active = (async () => {
      try {
        const r = await fetchCalendar(opts.creds, opts.fetchImpl, opts.timeoutMs);
        if (myGen !== generation) return;
        state.today = r.today;
        state.events = r.events;
        state.calendars = r.calendars;
        state.stamp = nowFn();
        state.status = 'ok';
        opts.storage.save({ today: state.today, events: state.events, calendars: state.calendars, stamp: state.stamp });
      } catch (e) {
        if (myGen !== generation) return;
        if (e && e.kind === 'denied') {
          denied = true; // kein Dauerfeuer: erst nach einer Nutzeraktion (retry) wieder
          if (timer !== null) { stopRepeat(timer); timer = null; }
          state.status = 'denied';
        } else {
          state.status = e && e.kind === 'offline' ? 'offline' : 'error';
        }
      } finally {
        if (myGen === generation) { active = null; notify(); }
      }
    })();
    return active;
  }

  function start() {
    started = true;
    denied = false;
    if (timer !== null) stopRepeat(timer); // ein zweiter start() darf kein Intervall liegen lassen
    refresh();
    timer = repeat(() => { refresh(); }, CAL_INTERVAL_MS);
  }
  function stop() {
    generation++;
    started = false;
    active = null;
    if (timer !== null) stopRepeat(timer);
    timer = null;
  }
  function retry() {
    if (!started) return Promise.resolve();
    denied = false;
    if (timer === null) timer = repeat(() => { refresh(); }, CAL_INTERVAL_MS);
    return refresh(true);
  }
  return { start, stop, refresh, retry, getState: () => state, isDenied: () => denied };
}

// ---- Gemeinsamer Zugriff fuer die Anzeige --------------------------------------------------------
let current = null;
const EMPTY = { events: [], calendars: [], stamp: null, status: 'none' };
export function setCalendar(c) { current = c; }
export function getCalendarState() { return current ? current.getState() : EMPTY; }
