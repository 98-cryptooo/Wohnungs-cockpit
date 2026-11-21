// Essensplan: Kachel, Rezeptauswahl und "Zutaten einkaufen". Logik in meals.js.
// Im Raster 7 Tage ab heute, in der grossen Ansicht 14 (per CSS ausgeblendet, siehe styles.css).
import { data, write, newId } from './state.js';
import { el, button, icon } from './util.js';
import { berlinNow } from './calendar.js';
import { askConfirm } from './confirm.js';
import { cookRecipe } from './cook.js';
import { SLOTS, SLOT_LABEL, planDays, mealsOn, setMeal, plannedRecipes, shoppingFor } from './meals.js';
import { openOverlay, closeOverlay, scheduleFit, setPreview } from './render.js';

const $ = (id) => document.getElementById(id);
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const DAYS_GRID = 7;
const DAYS_FOCUS = 14;
const recipeOf = (rid) => data.recipes.find((r) => String(r.id) === String(rid)) || null;

function dayLabel(iso, today) {
  const [, m, d] = iso.split('-').map(Number);
  const wd = WD[new Date(iso + 'T12:00:00Z').getUTCDay()];
  return wd + ' ' + d + '.' + (iso === today ? '' : m + '.');
}
const longLabel = (iso, today) => (iso === today ? 'heute' : dayLabel(iso, today));

function slotButton(date, slot, entry, today) {
  const rec = entry ? recipeOf(entry.rid) : null;
  const name = rec ? rec.name : (entry ? 'Rezept fehlt' : 'Planen');
  const b = button('meal-slot' + (rec ? '' : ' is-empty'), null, () => openOverlay('meal:' + date + ':' + slot),
    SLOT_LABEL[slot] + ' ' + longLabel(date, today) + ': ' + (rec ? rec.name : 'nichts geplant') + '. Antippen zum Wählen', 'meal-' + date + '-' + slot);
  if (slot === 'mittag') b.append(el('span', 'ms-tag', 'Mittag'));
  b.append(el('span', 'ms-name', name));
  return b;
}

export function renderMeals(nowDate) {
  const today = berlinNow(nowDate || new Date()).date;
  const days = planDays(today, DAYS_FOCUS);
  const rows = days.map((d) => {
    const m = mealsOn(data.cats, d);
    const row = el('div', 'meal-day' + (d === today ? ' is-today' : ''));
    row.append(el('span', 'meal-date', d === today ? 'Heute' : dayLabel(d, today)));
    const slots = el('div', 'meal-slots');
    if (m.mittag) slots.append(slotButton(d, 'mittag', m.mittag, today));
    slots.append(slotButton(d, 'abend', m.abend, today));
    const sun = button('meal-sun' + (m.mittag ? ' is-on' : ''), null, () => openOverlay('meal:' + d + ':mittag'),
      m.mittag ? 'Mittagessen ' + longLabel(d, today) + ' ändern' : 'Mittagessen ' + longLabel(d, today) + ' dazu planen', 'meal-sun-' + d);
    sun.append(icon('sun', 20));
    row.append(slots, sun);
    return row;
  });
  $('meal-list').replaceChildren(...rows);
  const week = planDays(today, DAYS_GRID);
  const planned = week.filter((d) => { const m = mealsOn(data.cats, d); return m.abend || m.mittag; }).length;
  $('meals-title').textContent = 'Essen' + (planned ? ' · ' + planned + '/' + DAYS_GRID + ' Tage' : '');
  const t = mealsOn(data.cats, today);
  const tr = t.abend ? recipeOf(t.abend.rid) : (t.mittag ? recipeOf(t.mittag.rid) : null);
  setPreview('pv-meals', tr ? 'Heute: ' + tr.name : (planned ? planned + ' Tage geplant' : 'Noch nichts geplant'));
  scheduleFit();
}

// ---- Rezeptauswahl (Overlay "meal:DATUM:PLATZ") -----------------------------------------------------
export function renderMealPicker(body, key) {
  const [date, slot] = key.split(':');
  const today = berlinNow(new Date()).date;
  $('ov-title').textContent = SLOT_LABEL[slot] + ', ' + longLabel(date, today);
  const cur = mealsOn(data.cats, date)[slot];
  const curRec = cur ? recipeOf(cur.rid) : null;
  const parts = [];
  if (cur) {
    const box = el('div', 'pick-cur');
    box.append(el('p', 'set-text', 'Geplant: ' + (curRec ? curRec.name : 'Rezept nicht mehr da')));
    if (curRec) box.append(button('btn-gold-s', 'Jetzt kochen', () => { closeOverlay(); cookRecipe(curRec.id); }, 'Jetzt kochen: ' + curRec.name, 'pick-cook'));
    box.append(button('btn-link btn-danger', 'Entfernen', () => {
      write('cats', (l) => setMeal(l, date, slot, ''));
      closeOverlay();
    }, 'Aus dem Plan entfernen', 'pick-clear'));
    parts.push(box);
  }
  const search = el('input', 'set-input pick-search');
  search.type = 'search';
  search.placeholder = 'Rezept suchen';
  search.dataset.fk = 'pick-search';
  search.setAttribute('aria-label', 'Rezept suchen');
  search.autocomplete = 'off';
  const list = el('div', 'pick-list');
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const recs = data.recipes
      .filter((r) => !q || String(r.name).toLowerCase().includes(q) || String(r.cat || '').toLowerCase().includes(q))
      .slice().sort((a, b) => (!!b.fav - !!a.fav) || String(a.name).localeCompare(String(b.name), 'de'));
    const rows = recs.map((r) => {
      const b = button('pick-row' + (cur && String(cur.rid) === String(r.id) ? ' is-cur' : ''), null, () => {
        write('cats', (l) => setMeal(l, date, slot, r.id));
        closeOverlay();
      }, r.name + ' wählen', 'pick-' + r.id);
      b.append(el('span', null, (r.fav ? '★ ' : '') + r.name));
      const meta = [r.cat, r.time ? r.time + ' Min' : ''].filter(Boolean).join(' · ');
      if (meta) b.append(el('span', 'ev-when', meta));
      return b;
    });
    if (!rows.length) rows.push(el('div', 'empty', data.recipes.length ? 'Kein Rezept passt zur Suche.' : 'Noch keine Rezepte. In der Sammlung eines anlegen oder per Link holen.'));
    list.replaceChildren(...rows);
  };
  search.addEventListener('input', draw);
  draw();
  parts.push(search, list);
  body.replaceChildren(...parts);
}

// ---- Zutaten der geplanten Tage in den Einkauf ---------------------------------------------------
async function shopPlanned() {
  const today = berlinNow(new Date()).date;
  const focus = !!$('tile-meals').closest('#focus-card');
  const recs = plannedRecipes(data.cats, data.recipes, planDays(today, focus ? DAYS_FOCUS : DAYS_GRID));
  if (!recs.length) { await askConfirm('Für die nächsten Tage ist noch kein Rezept geplant.', 'OK'); return; }
  let n = 0;
  const items = shoppingFor(data.shop, recs, () => newId() + n++);
  if (!items.length) { await askConfirm('Alle Zutaten der geplanten Rezepte stehen schon auf der Einkaufsliste.', 'OK'); return; }
  const used = new Set(items.map((i) => i.r));
  const msg = (items.length === 1 ? '1 Zutat' : items.length + ' Zutaten') + ' aus ' + (used.size === 1 ? '1 Rezept' : used.size + ' Rezepten') + ' in den Einkauf legen?';
  if (!(await askConfirm(msg, 'Einkaufen'))) return;
  write('shop', (l) => l.concat(items));
  // Rezepte aus der Sammlung erscheinen damit auch als Gruppe im Einkauf
  write('recipes', (l) => l.map((r) => { if (used.has(String(r.id)) && r.status === 'saved') r.status = 'list'; return r; }));
}

export function initMeals() {
  $('btn-meals-shop').addEventListener('click', shopPlanned);
}
