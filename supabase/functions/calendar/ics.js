// ICS-Parser fuer das Wohnungs-Cockpit. Liefert Termine in einem Zeitfenster, Wiederholungen eingerechnet.
// Reines JavaScript ohne Deno- oder Browser-APIs (nur Intl), damit er unter Node getestet werden kann
// (tests/ics.test.mjs). Die Edge Function (index.ts) importiert ihn unveraendert.
//
// Ergebnis: [{date, time|null, end|null, title, location|null, cal}]
//   end = "HH:MM" (gleicher Tag) oder "JJJJ-MM-TTTHH:MM" (Termin mit Uhrzeit ueber mehrere Tage)
//
// Seit 3.2:
//  - Verschobene Einzeltermine einer Serie (RECURRENCE-ID) ersetzen den urspruenglichen Termin, auch an anderem Tag.
//  - MONTHLY mit BYDAY (z. B. 2MO, -1FR) und BYMONTHDAY, YEARLY mit BYMONTH.
//  - WEEKLY mit BYDAY rechnet in Kalenderwochen ab Montag (WKST), auch mit INTERVAL > 1.
//  - Zeiten mit TZID einer anderen Zone werden in Berliner Zeit umgerechnet.

const TZ = 'Europe/Berlin';
const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MAX_STEPS = 20000; // mit COUNT wird ab Beginn gezaehlt, das reicht taeglich fuer ueber 50 Jahre

function unfold(s) { return String(s).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n'); }
export function unesc(v) {
  return String(v).replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

const fmtCache = new Map();
function fmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
  }
  return fmtCache.get(tz);
}
function partsIn(ms, tz) {
  const p = {};
  fmt(tz).formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return p;
}
function berlinOf(ms) {
  const p = partsIn(ms, TZ);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}
// Wandzeit in einer Zone -> UTC-Millisekunden (zwei Naeherungsschritte reichen auch an Umstellungstagen)
function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const want = Date.UTC(y, mo - 1, d, h, mi, s);
  let ms = want;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(ms, tz);
    const got = Date.UTC(+p.year, +p.month - 1, +p.day, p.hour === '24' ? 0 : +p.hour, +p.minute, +p.second);
    ms += want - got;
  }
  return ms;
}
function validZone(tz) {
  try { fmt(tz); return true; } catch (e) { return false; }
}

// Liefert {date, time|null} in Berliner Ortszeit
export function parseDT(params, v) {
  v = String(v || '').trim();
  if (/VALUE=DATE(?!-)/.test(params || '') || /^\d{8}$/.test(v)) return { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, time: null };
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return { date: v.slice(0, 10), time: null };
  const [y, mo, d, h, mi, s] = [+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]];
  if (m[7] === 'Z') return berlinOf(Date.UTC(y, mo - 1, d, h, mi, s));
  const tzm = String(params || '').match(/TZID=("?)([^";:]+)\1/);
  const tz = tzm ? tzm[2].trim() : '';
  if (tz && tz !== TZ && validZone(tz)) return berlinOf(zonedToUtc(y, mo, d, h, mi, s, tz));
  // Berlin, ohne Zone (floating) oder unbekannte Zone (z. B. Windows-Namen): als Ortszeit behandeln
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}

const dayNum = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const isoOf = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
export const addDays = (iso, n) => isoOf(dayNum(iso) + n);
const weekday = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1 bis 12
function monthOf(iso, k) { // Monat k Monate nach iso: {y, m}
  const [y, m] = iso.split('-').map(Number);
  const t = (y * 12 + (m - 1)) + k;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
}

// Tage eines Monats nach BYDAY (mit Ordnungszahl) und BYMONTHDAY. Ohne beides: Tag des Starts (fehlt er, kein Termin).
function monthDates(y, m, startDay, byday, bymonthday) {
  const n = daysIn(y, m);
  const out = new Set();
  if (bymonthday) {
    bymonthday.forEach((v) => { const d = v > 0 ? v : n + v + 1; if (d >= 1 && d <= n) out.add(ymd(y, m, d)); });
  }
  if (byday) {
    byday.forEach(({ ord, wd }) => {
      const all = [];
      for (let d = 1; d <= n; d++) if (weekday(ymd(y, m, d)) === wd) all.push(d);
      if (!ord) all.forEach((d) => out.add(ymd(y, m, d)));
      else { const d = ord > 0 ? all[ord - 1] : all[all.length + ord]; if (d) out.add(ymd(y, m, d)); }
    });
  }
  if (!bymonthday && !byday && startDay <= n) out.add(ymd(y, m, startDay));
  return [...out].sort();
}

function parseRule(v) {
  const r = {};
  String(v).split(';').forEach((kv) => { const i = kv.indexOf('='); if (i > 0) r[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1); });
  const byday = r.BYDAY ? r.BYDAY.split(',').map((x) => {
    const mm = x.trim().match(/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i);
    return mm ? { ord: mm[1] ? +mm[1] : 0, wd: DOW.indexOf(mm[2].toUpperCase()) } : null;
  }).filter(Boolean) : null;
  const nums = (s) => (s ? s.split(',').map(Number).filter((x) => Number.isInteger(x) && x !== 0) : null);
  return {
    freq: String(r.FREQ || '').toUpperCase(),
    interval: Math.max(1, +(r.INTERVAL || 1) || 1),
    count: r.COUNT ? Math.max(0, +r.COUNT) : Infinity,
    until: r.UNTIL ? parseDT('', r.UNTIL).date : '9999-12-31',
    byday: byday && byday.length ? byday : null,
    bymonthday: nums(r.BYMONTHDAY),
    bymonth: nums(r.BYMONTH)
  };
}

// Alle Starttage einer Serie bis "to" (in Reihenfolge), COUNT und UNTIL beachtet.
export function occurrences(startDate, rule, to, from) {
  const r = typeof rule === 'string' ? parseRule(rule) : rule;
  const out = [];
  let n = 0;
  const take = (d) => {
    if (d < startDate) return true;
    if (d > r.until || n >= r.count || d > to) return false; // Termine einer Periode sind sortiert, danach kommt nichts Frueheres
    n++;
    out.push(d);
    return true;
  };
  const [sy, sm, sd] = startDate.split('-').map(Number);
  // Ohne COUNT muss nicht ab Serienbeginn gezaehlt werden: direkt kurz vor das Zeitfenster springen
  let k0 = 0;
  if (from && from > startDate && r.count === Infinity) {
    const days = dayNum(from) - dayNum(startDate);
    const [fy, fm] = from.split('-').map(Number);
    const months = (fy * 12 + fm) - (sy * 12 + sm);
    const per = { DAILY: days / r.interval, WEEKLY: days / (7 * r.interval), MONTHLY: months / r.interval, YEARLY: (fy - sy) / r.interval }[r.freq];
    if (per !== undefined) k0 = Math.max(0, Math.floor(per) - 1);
  }
  for (let k = k0; k < k0 + MAX_STEPS; k++) {
    let dates = [];
    let first = null;
    if (r.freq === 'DAILY') {
      dates = [addDays(startDate, k * r.interval)];
    } else if (r.freq === 'WEEKLY') {
      const monday = addDays(startDate, -((weekday(startDate) + 6) % 7)); // WKST=MO
      const week = addDays(monday, k * 7 * r.interval);
      dates = r.byday ? r.byday.map(({ wd }) => addDays(week, (wd + 6) % 7)).sort() : [addDays(startDate, k * 7 * r.interval)];
      first = week;
    } else if (r.freq === 'MONTHLY') {
      const { y, m } = monthOf(startDate, k * r.interval);
      dates = monthDates(y, m, sd, r.byday, r.bymonthday);
      first = ymd(y, m, 1);
    } else if (r.freq === 'YEARLY') {
      const y = sy + k * r.interval;
      const months = r.bymonth || [sm];
      months.forEach((m) => { dates.push(...monthDates(y, m, sd, r.byday, r.bymonthday)); });
      dates.sort();
      first = ymd(y, 1, 1);
    } else {
      take(startDate);
      return out;
    }
    for (const d of dates) { if (!take(d)) return out; }
    if ((first || dates[0] || '') > to) break;
  }
  return out;
}

export function parseICS(text, cal, from, to) {
  const lines = unfold(text);
  const items = [];
  let calName = cal;
  let cur = null;
  for (const raw of lines) {
    if (raw.startsWith('X-WR-CALNAME:') && !cur) calName = unesc(raw.slice(13)) || cal;
    if (raw === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (raw === 'END:VEVENT' && cur) { items.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = raw.indexOf(':');
    if (i < 0) continue;
    const head = raw.slice(0, i);
    const v = raw.slice(i + 1);
    const [name, ...ps] = head.split(';');
    (cur[name.toUpperCase()] = cur[name.toUpperCase()] || []).push({ p: ps.join(';'), v });
  }
  // Verschobene Einzeltermine: Tag des urspruenglichen Termins pro UID merken, die Serie laesst ihn aus
  const moved = new Map();
  items.forEach((c) => {
    if (!c['RECURRENCE-ID'] || !c.UID) return;
    const uid = c.UID[0].v;
    if (!moved.has(uid)) moved.set(uid, new Set());
    moved.get(uid).add(parseDT(c['RECURRENCE-ID'][0].p, c['RECURRENCE-ID'][0].v).date);
  });
  const out = [];
  items.forEach((c) => {
    const skip = !c['RECURRENCE-ID'] && c.UID ? moved.get(c.UID[0].v) : null;
    expand(c, calName, from, to, out, skip);
  });
  const seen = new Set();
  const res = [];
  for (const e of out.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))) {
    const k = e.date + '|' + (e.time || '') + '|' + e.title + '|' + e.cal;
    if (seen.has(k)) continue;
    seen.add(k);
    res.push(e);
  }
  return res;
}

function expand(c, cal, from, to, out, skip) {
  if (!c.DTSTART) return;
  if (c.STATUS && String(c.STATUS[0].v).toUpperCase() === 'CANCELLED') return;
  const s = parseDT(c.DTSTART[0].p, c.DTSTART[0].v);
  const e = c.DTEND ? parseDT(c.DTEND[0].p, c.DTEND[0].v) : null;
  const title = unesc(c.SUMMARY ? c.SUMMARY[0].v : 'Termin');
  const location = c.LOCATION ? unesc(c.LOCATION[0].v).split(/\s{2,}|, /)[0] : null;
  const ex = new Set(skip || []);
  (c.EXDATE || []).forEach((x) => x.v.split(',').forEach((d) => ex.add(parseDT(x.p, d).date)));
  // Mehrtaegig mit Uhrzeit: Ende als Datum und Uhrzeit, Abstand in Tagen wird pro Wiederholung mitgerechnet
  const endGap = s.time !== null && e && e.time && e.date > s.date ? dayNum(e.date) - dayNum(s.date) : 0;
  const push = (date) => {
    if (date < from || date > to || ex.has(date)) return;
    const end = !e || !e.time ? null : (endGap ? addDays(date, endGap) + 'T' + e.time : e.time);
    out.push({ date, time: s.time, end, title, location, cal });
  };
  // Mehrtaegige Ganztagstermine: jeden Tag im Fenster zeigen (Ende ist exklusiv)
  const span = s.time === null && e ? Math.max(1, Math.round(dayNum(e.date) - dayNum(s.date))) : 1;
  const pushSpan = (date) => { for (let i = 0; i < span; i++) push(addDays(date, i)); };
  if (!c.RRULE) { pushSpan(s.date); return; }
  // Damit lange Serien (z. B. Ganztagestermine ueber Jahre) frueh genug beginnen: bis "to" rechnen
  occurrences(s.date, c.RRULE[0].v, to, addDays(from, -(span - 1))).forEach((d) => {
    if (ex.has(d)) return; // ausgelassener Serientermin gilt auch fuer mehrtaegige Termine als Ganzes
    pushSpan(d);
  });
}
