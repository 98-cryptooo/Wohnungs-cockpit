// Essensplan: Logik ohne DOM, unter Node testbar (tests/meals.test.mjs).
// Gespeichert in der Liste cats (nur Cockpit, die Partner-App gleicht sie nicht ab), ein Eintrag pro Platz:
//   {id: 'meal-JJJJ-MM-TT-abend' | 'meal-JJJJ-MM-TT-mittag', rid: Rezept-ID, done: false}
// Platz leeren = Eintrag entfernen (Loeschmarke im Sync).
import { itemBelongsTo } from './core.js';

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
export function setMeal(list, date, slot, rid) {
  const id = mealId(date, slot);
  const rest = list.filter((c) => c.id !== id);
  if (!rid) return rest;
  rest.push({ id, rid: String(rid), done: false });
  return rest;
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

// Zutaten eines Rezepts, die noch nicht auf der Einkaufsliste stehen (gleicher Name, gleiches Rezept).
// Abgehakte zaehlen als vorhanden: sie sind fuer dieses Rezept schon gekauft.
export function missingIngredients(shop, rec) {
  const open = new Set(shop.filter((i) => itemBelongsTo(i, rec)).map((i) => norm(i.t)));
  const seen = new Set();
  return (rec.ingredients || []).filter((z) => {
    const k = norm(z.t);
    if (!k || open.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Neue Einkaufsposten fuer alle geplanten Rezepte. gen() liefert eindeutige at-Werte.
export function shoppingFor(shop, recs, gen) {
  const items = [];
  recs.forEach((r) => missingIngredients(shop, r).forEach((z) => {
    items.push({ t: z.t, q: z.q || undefined, g: r.name, r: String(r.id), done: false, at: gen() });
  }));
  return items;
}
