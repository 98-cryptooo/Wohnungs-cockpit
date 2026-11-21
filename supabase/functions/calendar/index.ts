// Edge Function "calendar" fuer das Wohnungs-Cockpit.
// POST {code, days?} -> {events:[{date,time,end,title,location,cal}], calendars:[...]}
// Zugriff nur mit gueltigem Haushaltscode. Die Abo-Links liegen gesperrt in hh_calendars.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseICS } from "./ics.js";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const cache = new Map<string, { at: number; text: string }>();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: { code?: string; days?: number } = {};
  try { body = await req.json(); } catch (_) { return json({ error: "bad json" }, 400); }
  const code = String(body.code || "");
  const days = Math.min(Math.max(Number(body.days) || 14, 1), 60);
  if (code.length < 32) return json({ error: "unknown household" }, 403);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: cals, error } = await db.from("hh_calendars").select("url,label").eq("household", code);
  if (error) return json({ error: "db" }, 500);
  if (!cals || !cals.length) return json({ error: "unknown household" }, 403);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  const end = new Date(today + "T12:00:00Z"); end.setUTCDate(end.getUTCDate() + days);
  const to = end.toISOString().slice(0, 10);
  const events = []; const calendars = []; 
  for (const c of cals) {
    const url = c.url.replace(/^webcal:/i, "https:");
    try {
      let hit = cache.get(url);
      if (!hit || Date.now() - hit.at > 5 * 60 * 1000) {
        const r = await fetch(url, { headers: { "User-Agent": "Wohnungs-Cockpit" }, signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error("http " + r.status);
        const text = await r.text();
        if (text.length > 3_000_000) throw new Error("size");
        hit = { at: Date.now(), text }; cache.set(url, hit);
      }
      const evs = parseICS(hit.text, c.label || "Kalender", today, to);
      const name = evs[0]?.cal || (hit.text.match(/X-WR-CALNAME:(.*)/)?.[1] || c.label || "Kalender").trim();
      calendars.push({ name, ok: true });
      events.push(...evs.map((e) => ({ ...e, cal: name })));
    } catch (e) { calendars.push({ name: c.label || "Kalender", ok: false, error: /^Error: (http \d+|size)$/.test(String(e)) ? String(e).slice(7) : "fetch" }); }
  }
  events.sort((a, b) => (a.date + (a.time || "00:00")).localeCompare(b.date + (b.time || "00:00")));
  return json({ today, events, calendars });
});
