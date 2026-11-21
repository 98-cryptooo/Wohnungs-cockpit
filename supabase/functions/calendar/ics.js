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
// Seit 3.6:
//  - Serien werden in der Zone des Kalenders berechnet und jeder Termin einzeln umgerechnet (Sommerzeit, Wochentag).
//  - BYDAY bei taeglich, BYSETPOS, BYMONTHDAY und BYDAY als Schnittmenge, unbekannte Regelteile nur erster Termin.
//  - UNTIL mit Uhrzeit, mehrtaegige Termine mit Uhrzeit, die vor dem Fenster beginnen.

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

// Wandzeit wie im Kalender: {date, time|null, tz}. tz = 'UTC' (Endung Z), gueltige fremde Zone oder null (Berlin/ohne Zone)
export function rawDT(params, v) {
  v = String(v || '').trim();
  if (/VALUE=DATE(?!-)/.test(params || '') || /^\d{8}$/.test(v)) return { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, time: null, tz: null };
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return { date: v.slice(0, 10), time: null, tz: null };
  const tzm = String(params || '').match(/TZID=("?)([^";:]+)\1/);
  const zone = tzm ? tzm[2].trim() : '';
  const tz = m[7] === 'Z' ? 'UTC' : (zone && zone !== TZ && validZone(zone) ? zone : null);
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}`, tz };
}
// Zeitpunkt (UTC-Millisekunden) einer Wandzeit in der Zone des Kalenders
function instant(date, time, tz) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  if (tz === 'UTC') return Date.UTC(y, mo - 1, d, h, mi, 0);
  return zonedToUtc(y, mo, d, h, mi, 0, tz || TZ);
}
// Wandzeit in der Zone des Kalenders -> Berliner Datum und Uhrzeit
function toBerlin(date, time, tz) {
  if (!time || !tz) return { date, time };
  return berlinOf(instant(date, time, tz));
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

// Tage eines Monats nach BYDAY (mit Ordnungszahl) und BYMONTHDAY. Beide zusammen: Schnittmenge (z. B. Freitag, der 13.).
// Ohne beides: Tag des Starts (fehlt er im Monat, kein Termin).
function monthDates(y, m, startDay, byday, bymonthday) {
  const n = daysIn(y, m);
  let md = null;
  if (bymonthday) {
    md = new Set();
    bymonthday.forEach((v) => { const d = v > 0 ? v : n + v + 1; if (d >= 1 && d <= n) md.add(ymd(y, m, d)); });
  }
  let bd = null;
  if (byday) {
    bd = new Set();
    byday.forEach(({ ord, wd }) => {
      const all = [];
      for (let d = 1; d <= n; d++) if (weekday(ymd(y, m, d)) === wd) all.push(d);
      if (!ord) all.forEach((d) => bd.add(ymd(y, m, d)));
      else { const d = ord > 0 ? all[ord - 1] : all[all.length + ord]; if (d) bd.add(ymd(y, m, d)); }
    });
  }
  let out;
  if (md && bd) out = [...md].filter((d) => bd.has(d));
  else if (md || bd) out = [...(md || bd)];
  else out = startDay <= n ? [ymd(y, m, startDay)] : [];
  return out.sort();
}
// BYSETPOS: aus den Terminen einer Periode nur bestimmte Positionen (1 = erster, -1 = letzter)
function setpos(dates, pos) {
  if (!pos) return dates;
  const out = new Set();
  pos.forEach((p) => { const d = p > 0 ? dates[p - 1] : dates[dates.length + p]; if (d) out.add(d); });
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
  // Regelteile, die hier nicht berechnet werden: lieber nur den ersten Termin zeigen als zu viele
  const unknown = ['BYWEEKNO', 'BYYEARDAY', 'BYHOUR', 'BYMINUTE', 'BYSECOND'].some((k) => r[k]);
  return {
    unknown,
    bysetpos: nums(r.BYSETPOS),
    freq: String(r.FREQ || '').toUpperCase(),
    interval: Math.max(1, +(r.INTERVAL || 1) || 1),
    count: r.COUNT ? Math.max(0, +r.COUNT) : Infinity,
    // Grob als Datum (mit einem Tag Puffer fuer Zeitzonen), genau prueft expand() mit Uhrzeit
    until: r.UNTIL ? addDays(rawDT('', r.UNTIL).date, 1) : '9999-12-31',
    untilRaw: r.UNTIL || null,
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
    if (r.unknown) { take(startDate); return out; }
    if (r.freq === 'DAILY') {
      const d = addDays(startDate, k * r.interval);
      dates = r.byday && !r.byday.some(({ wd }) => wd === weekday(d)) ? [] : [d];
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
    // BYMONTH als Filter bei taeglich und woechentlich, BYSETPOS pro Periode
    if (r.bymonth && (r.freq === 'DAILY' || r.freq === 'WEEKLY')) dates = dates.filter((d) => r.bymonth.includes(+d.slice(5, 7)));
    if (r.freq !== 'DAILY') dates = setpos(dates, r.bysetpos);
    for (const d of dates) { if (!take(d)) return out; }
    if ((first || addDays(startDate, k * r.interval)) > to) break;
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
  const sr = rawDT(c.DTSTART[0].p, c.DTSTART[0].v);
  const er = c.DTEND ? rawDT(c.DTEND[0].p, c.DTEND[0].v) : null;
  const title = unesc(c.SUMMARY ? c.SUMMARY[0].v : 'Termin');
  const location = c.LOCATION ? unesc(c.LOCATION[0].v).split(/\s{2,}|, /)[0] : null;
  const ex = new Set(skip || []);
  (c.EXDATE || []).forEach((x) => x.v.split(',').forEach((d) => ex.add(parseDT(x.p, d).date)));
  const timed = sr.time !== null;
  // Dauer in Millisekunden (mit Uhrzeit) bzw. Tage (ganztaegig, Ende exklusiv)
  const durMs = timed && er && er.time ? instant(er.date, er.time, er.tz) - instant(sr.date, sr.time, sr.tz) : 0;
  const span = !timed && er ? Math.max(1, Math.round(dayNum(er.date) - dayNum(sr.date))) : 1;
  const rule = c.RRULE ? parseRule(c.RRULE[0].v) : null;
  const untilMs = rule && rule.untilRaw ? (() => {
    const u = rawDT('', rule.untilRaw);
    return u.time ? instant(u.date, u.time, u.tz || sr.tz) : instant(addDays(u.date, 1), '00:00', sr.tz) - 1;
  })() : Infinity;
  const untilDate = rule && rule.untilRaw ? rawDT('', rule.untilRaw).date : '9999-12-31';
  const pushOne = (localDate) => {
    if (!timed) {
      if (localDate > untilDate) return;
      for (let i = 0; i < span; i++) {
        const d = addDays(localDate, i);
        if (d >= from && d <= to && !ex.has(d)) out.push({ date: d, time: null, end: null, title, location, cal });
      }
      return;
    }
    const startMs = instant(localDate, sr.time, sr.tz);
    if (startMs > untilMs) return;
    const b = berlinOf(startMs);
    if (ex.has(b.date)) return;
    let end = null;
    let last = b.date;
    if (durMs > 0) {
      const e = berlinOf(startMs + durMs);
      end = e.date === b.date ? e.time : e.date + 'T' + e.time;
      last = e.date;
    } else if (er && er.time) end = toBerlin(er.date, er.time, er.tz).time;
    // Mehrtaegige Termine, die vor dem Fenster beginnen und hineinreichen, gehoeren dazu
    if (b.date > to || last < from) return;
    out.push({ date: b.date, time: b.time, end, title, location, cal });
  };
  if (!rule) { pushOne(sr.date); return; }
  // Puffer: Zeitzonen verschieben um hoechstens einen Tag, mehrtaegige Termine reichen um ihre Dauer zurueck
  const back = Math.max(span - 1, Math.ceil(durMs / 864e5)) + 1;
  occurrences(sr.date, rule, addDays(to, 1), addDays(from, -back)).forEach((d) => {
    if (!timed && ex.has(d)) return; // ausgelassener Serientermin gilt fuer mehrtaegige Ganztagstermine als Ganzes
    pushOne(d);
  });
}
