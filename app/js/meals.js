// Essensplan: Logik ohne DOM, unter Node testbar (tests/meals.test.mjs).
// Gespeichert in der Liste cats (nur Cockpit, die Partner-App gleicht sie nicht ab), ein Eintrag pro Platz:
//   {id: 'meal-JJJJ-MM-TT-abend' | 'meal-JJJJ-MM-TT-mittag', rid: Rezept-ID, done: false, n?: Portionen}
// Ohne n gilt die Portionenzahl des Rezepts.
// Platz leeren = Eintrag entfernen (Loeschmarke im Sync).
import { itemBelongsTo } from './core.js';
import { scaleQ } from './util.js';
import { normIngr } from './recipeimport.js';

export const SLOTS = ['mittag', 'abend'];
export const SLOT_LABEL = { mittag: 'Mittag', abend: 'Abend' };
const ID_RE = /^meal-(\d{4}-\d{2}-\d{2})-(mittag|abend)$/;

const dayNum = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
export const addDays = (iso, n) => new Date((dayNum(iso) + n) * 864e5).toISOString().slice(0, 10);

export const mealId = (date, slot) => 'meal-' + date + '-' + slot;
export function parseMealId(id) {
  const m = ID_RE.exec(String(id || ''));
  return m ? { date: m[1], slot: m[2] } : null;
}
export const isMeal = (c) => !!c && !!parseMealId(c.id);

// Tage ab heute (rollierend, nicht Montag bis Sonntag), damit man am Wochenende schon weiterplanen kann
export function planDays(today, n = 7) {
  return Array.from({ length: n }, (_, i) => addDays(today, i));
}

// Plan eines Tages: {mittag: Eintrag|null, abend: Eintrag|null}
export function mealsOn(cats, date) {
  const out = { mittag: null, abend: null };
  cats.forEach((c) => { const p = parseMealId(c.id); if (p && p.date === date && c.rid) out[p.slot] = c; });
  return out;
}

// Platz setzen oder leeren (rid leer = leeren). Arbeitet auf der Kopie aus write('cats').
export function setMeal(list, date, slot, rid, n) {
  const id = mealId(date, slot);
  const rest = list.filter((c) => c.id !== id);
  if (!rid) return rest;
  const e = { id, rid: String(rid), done: false };
  if (Number(n) > 0) e.n = clampServ(n);
  rest.push(e);
  return rest;
}

export const clampServ = (n) => Math.min(40, Math.max(1, Math.round(Number(n) || 1)));
// Portionen eines Platzes: eigene Angabe, sonst die des Rezepts
export const mealServings = (entry, rec) => clampServ(entry && Number(entry.n) > 0 ? entry.n : (rec && rec.servings) || 1);

// Portionen eines Platzes aendern (Eintrag bleibt sonst gleich)
export function setMealServings(list, date, slot, n) {
  const id = mealId(date, slot);
  return list.map((c) => (c.id === id ? Object.assign({}, c, { n: clampServ(n) }) : c));
}

// Gewuenschte Portionen je Rezept in den gegebenen Tagen (mehrfach geplant = zusammengezaehlt)
export function plannedServings(cats, recipes, days) {
  const out = {};
  days.forEach((d) => {
    const m = mealsOn(cats, d);
    SLOTS.forEach((s) => {
      const e = m[s];
      if (!e) return;
      const rec = recipes.find((r) => String(r.id) === String(e.rid));
      if (rec) out[String(rec.id)] = (out[String(rec.id)] || 0) + mealServings(e, rec);
    });
  });
  return out;
}

// Zutaten eines Rezepts fuer want Portionen (Menge im Namen wird vorher abgetrennt)
export function scaledIngredients(rec, want) {
  const f = want > 0 ? want / (Number(rec.servings) || 1) : 1;
  return (rec.ingredients || []).map((z) => { const n = normIngr(z); return { q: scaleQ(n.q, f), t: n.t }; });
}

// Offene Einkaufsposten eines Rezepts auf want Portionen umrechnen. Abgehakte bleiben, wie sie gekauft wurden.
export function rescaleShop(shop, rec, want) {
  const byName = new Map();
  scaledIngredients(rec, want).forEach((z) => { const k = norm(z.t); if (k && !byName.has(k)) byName.set(k, z.q); });
  return shop.map((i) => {
    if (i.done || !itemBelongsTo(i, rec)) return i;
    const k = norm(normIngr({ q: i.q, t: i.t }).t);
    if (!byName.has(k)) return i;
    const q = byName.get(k) || undefined;
    if (q === i.q || (q === undefined && !i.q)) return i;
    const out = Object.assign({}, i, { t: normIngr({ q: i.q, t: i.t }).t });
    if (q) out.q = q; else delete out.q;
    return out;
  });
}

// Rezepte, die ab heute in den gegebenen Tagen geplant sind (jedes nur einmal, in Plan-Reihenfolge)
export function plannedRecipes(cats, recipes, days) {
  const ids = [];
  days.forEach((d) => {
    const m = mealsOn(cats, d);
    SLOTS.forEach((s) => { if (m[s] && !ids.includes(m[s].rid)) ids.push(m[s].rid); });
  });
  return ids.map((id) => recipes.find((r) => String(r.id) === String(id))).filter(Boolean);
}

const norm = (t) => String(t || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Abgehakt vor hoechstens so vielen Tagen zaehlt als "schon gekauft" (aelteres ist vermutlich aufgebraucht)
export const BOUGHT_DAYS = 3;
const doneMs = (v) => (typeof v === 'number' ? v : Date.parse(v));
// Zutaten eines Rezepts, die noch nicht auf der Einkaufsliste stehen (gleicher Name, gleiches Rezept).
// Offene zaehlen immer als vorhanden, abgehakte nur, wenn sie kuerzlich gekauft wurden.
export function missingIngredients(shop, rec, nowMs = Date.now()) {
  const fresh = (i) => !i.done || (Number.isFinite(doneMs(i.doneAt)) && nowMs - doneMs(i.doneAt) <= BOUGHT_DAYS * 864e5);
  const open = new Set(shop.filter((i) => itemBelongsTo(i, rec) && fresh(i)).map((i) => norm(normIngr({ q: i.q, t: i.t }).t)));
  const seen = new Set();
  return scaledIngredients(rec, rec.want).filter((z) => {
    const k = norm(z.t);
    if (!k || open.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Neue Einkaufsposten fuer alle geplanten Rezepte. gen() liefert eindeutige at-Werte.
// Hat ein Rezept want (gewuenschte Portionen), werden die Mengen darauf umgerechnet.
export function shoppingFor(shop, recs, gen, nowMs = Date.now()) {
  const items = [];
  recs.forEach((r) => missingIngredients(shop, r, nowMs).forEach((z) => {
    items.push({ t: z.t, q: z.q || undefined, g: r.name, r: String(r.id), done: false, at: gen() });
  }));
  return items;
}

// Eintraege, deren Tag laenger als keepDays vorbei ist (zum Aufraeumen per Loeschmarke)
export function isStaleMeal(c, today, keepDays = 30) {
  const p = parseMealId(c && c.id);
  return !!p && p.date < addDays(today, -keepDays);
}
