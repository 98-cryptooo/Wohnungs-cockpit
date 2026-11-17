// ICS-Parser fuer das Wohnungs-Cockpit. Liefert Termine in einem Zeitfenster, Wiederholungen eingerechnet.
export type Ev = { date: string; time: string | null; end: string | null; title: string; location: string | null; cal: string };

const TZ = "Europe/Berlin";
function unfold(s: string): string[] { return s.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n"); }
function unesc(v: string) { return v.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\;/g, ";").replace(/\\\\/g, "\\").trim(); }
function berlinParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const p: Record<string, string> = {}; f.formatToParts(d).forEach((x) => p[x.type] = x.value);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}
// Liefert {date, time|null} in Berliner Ortszeit
function parseDT(params: string, v: string): { date: string; time: string | null } {
  if (/VALUE=DATE(?!-)/.test(params) || /^\d{8}$/.test(v)) return { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, time: null };
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return { date: v.slice(0, 10), time: null };
  if (m[7] === "Z") return berlinParts(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])));
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` }; // TZID oder floating: als Ortszeit behandeln
}
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (iso: string, n: number) => { const [y, m, d] = iso.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); if (d > last) return null; return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function parseICS(text: string, cal: string, from: string, to: string): Ev[] {
  const lines = unfold(text); const out: Ev[] = [];
  let calName = cal; let cur: Record<string, { p: string; v: string }[]> | null = null;
  for (const raw of lines) {
    if (raw.startsWith("X-WR-CALNAME:") && !cur) calName = unesc(raw.slice(13)) || cal;
    if (raw === "BEGIN:VEVENT") { cur = {}; continue; }
    if (raw === "END:VEVENT" && cur) { expand(cur, calName, from, to, out); cur = null; continue; }
    if (!cur) continue;
    const i = raw.indexOf(":"); if (i < 0) continue;
    const head = raw.slice(0, i), v = raw.slice(i + 1); const [name, ...ps] = head.split(";");
    (cur[name] = cur[name] || []).push({ p: ps.join(";"), v });
  }
  // Ueberschriebene Einzeltermine (RECURRENCE-ID) ersetzen die Serie an dem Tag
  const seen = new Set<string>(); const res: Ev[] = [];
  for (const e of out.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")))) {
    const k = e.date + "|" + e.title + "|" + e.cal; if (seen.has(k)) continue; seen.add(k); res.push(e);
  }
  return res;
}

function expand(c: Record<string, { p: string; v: string }[]>, cal: string, from: string, to: string, out: Ev[]) {
  if (!c.DTSTART) return;
  if (c.STATUS && c.STATUS[0].v === "CANCELLED") return;
  const s = parseDT(c.DTSTART[0].p, c.DTSTART[0].v);
  const e = c.DTEND ? parseDT(c.DTEND[0].p, c.DTEND[0].v) : null;
  const title = unesc(c.SUMMARY ? c.SUMMARY[0].v : "Termin");
  const location = c.LOCATION ? unesc(c.LOCATION[0].v).split(/\s{2,}|, /)[0] : null;
  const ex = new Set<string>(); (c.EXDATE || []).forEach((x) => x.v.split(",").forEach((d) => ex.add(parseDT(x.p, d).date)));
  const push = (date: string) => { if (date >= from && date <= to && !ex.has(date)) out.push({ date, time: s.time, end: e && e.time ? e.time : null, title, location, cal }); };
  // Mehrtaegige Ganztagstermine: jeden Tag im Fenster zeigen
  const span = s.time === null && e ? Math.max(1, Math.round((Date.parse(e.date) - Date.parse(s.date)) / 864e5)) : 1;
  const pushSpan = (date: string) => { for (let i = 0; i < span; i++) push(addDays(date, i)); };
  if (!c.RRULE) { pushSpan(s.date); return; }
  const r: Record<string, string> = {}; c.RRULE[0].v.split(";").forEach((kv) => { const [k, v] = kv.split("="); r[k] = v; });
  const iv = Math.max(1, +(r.INTERVAL || 1)); const count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? parseDT("", r.UNTIL).date : "9999-12-31";
  const byday = r.BYDAY ? r.BYDAY.split(",").map((x) => x.slice(-2)) : null;
  let n = 0;
  for (let k = 0; k < 2000 && n < count; k++) {
    let dates: string[] = [];
    if (r.FREQ === "DAILY") dates = [addDays(s.date, k * iv)];
    else if (r.FREQ === "WEEKLY") {
      const base = addDays(s.date, k * 7 * iv);
      if (byday) { const wd = new Date(base + "T12:00:00Z").getUTCDay(); dates = byday.map((d) => addDays(base, (DOW.indexOf(d) - wd + 7) % 7)).sort(); }
      else dates = [base];
    } else if (r.FREQ === "MONTHLY") { const d = addMonths(s.date, k * iv); dates = d ? [d] : []; }
    else if (r.FREQ === "YEARLY") { const d = addMonths(s.date, k * 12 * iv); dates = d ? [d] : []; }
    else { pushSpan(s.date); return; }
    let stop = false;
    for (const d of dates) { if (d < s.date) continue; if (d > until || n >= count) { stop = true; break; } n++; pushSpan(d); }
    if (stop || (dates[0] && dates[0] > to)) break;
  }
}
