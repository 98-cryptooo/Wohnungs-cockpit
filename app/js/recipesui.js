// Rezepte im Cockpit: Sammlung (alle Rezepte, Favoriten, Kategorien) und Dialog zum Anlegen und Bearbeiten,
// mit Import per Link (r.jina.ai) und per Screenshots (Texterkennung auf dem Geraet).
// Felder wie in der Partner-App, neu und optional: fav (Favorit), cat (Kategorie). Die Partner-App behaelt sie.
import { data, write, newId } from './state.js';
import { el, button, icon } from './util.js';
import { askConfirm } from './confirm.js';
import { cookRecipe, rebuy } from './cook.js';
import { openOverlay, closeOverlay } from './render.js';
import { splitAmt, importFromUrl, ocrImages, fromText, findUrl } from './recipeimport.js';
import { isMeal } from './meals.js';

const $ = (id) => document.getElementById(id);
export const DEFAULT_CATS = ['Hauptgericht', 'Pasta', 'Suppe', 'Salat', 'Frühstück', 'Backen', 'Dessert', 'Snack'];
const STATUS = { list: 'auf der Einkaufsliste', today: 'heute', saved: '' };
let filter = 'all'; // 'all' | 'fav' | Kategorie

export const categories = () => [...new Set(DEFAULT_CATS.concat(data.recipes.map((r) => r.cat).filter(Boolean)))];
const byName = (a, b) => (!!b.fav - !!a.fav) || String(a.name).localeCompare(String(b.name), 'de');

function toggleFav(id) {
  write('recipes', (l) => l.map((r) => { if (String(r.id) === String(id)) { if (r.fav) delete r.fav; else r.fav = true; } return r; }));
}

// ---- Sammlung ---------------------------------------------------------------------------------------
export function renderCollection(body) {
  $('ov-title').textContent = 'Rezeptsammlung';
  const head = el('div', 'rc-head');
  head.append(button('btn-gold-s', 'Neues Rezept', () => openOverlay('rec:new'), 'Neues Rezept anlegen oder importieren', 'rc-new'));
  const chips = el('div', 'rc-chips');
  const used = [...new Set(data.recipes.map((r) => r.cat).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  if (filter !== 'all' && filter !== 'fav' && !used.includes(filter)) filter = 'all';
  [['all', 'Alle'], ['fav', '★ Favoriten'], ...used.map((c) => [c, c])].forEach(([v, label]) => {
    const b = button('rc-chip', label, () => { filter = v; renderCollection(body); }, 'Filter: ' + label, 'rc-f-' + v);
    b.setAttribute('aria-pressed', filter === v ? 'true' : 'false');
    chips.append(b);
  });
  head.append(chips);
  const recs = data.recipes.filter((r) => filter === 'all' || (filter === 'fav' ? r.fav : r.cat === filter)).slice().sort(byName);
  const rows = recs.map((r) => {
    const row = el('div', 'ov-recipe');
    const star = button('rc-star' + (r.fav ? ' is-on' : ''), r.fav ? '★' : '☆', () => toggleFav(r.id), (r.fav ? 'Favorit entfernen: ' : 'Als Favorit merken: ') + r.name, 'rc-star-' + r.id);
    star.setAttribute('aria-pressed', r.fav ? 'true' : 'false');
    const col = el('span', 'col grow');
    const meta = [r.cat, r.servings + ' ' + (r.yieldText || 'Portionen'), r.time ? r.time + ' Min' : '', r.steps.length ? r.steps.length + ' Schritte' : 'ohne Anleitung', STATUS[r.status]].filter(Boolean).join(' · ');
    col.append(el('span', 'name', r.name), el('span', 'ev-when', meta));
    const edit = button('del', null, () => openOverlay('rec:' + r.id), 'Bearbeiten: ' + r.name, 'rc-edit-' + r.id);
    edit.append(icon('edit', 18));
    row.append(star, col, edit,
      button('btn-ghost', 'Einkaufen', () => rebuy(r.id), 'Zutaten einkaufen: ' + r.name, 'rebuy-' + r.id),
      button('btn-gold-s', 'Kochen', () => cookRecipe(r.id), 'Kochen: ' + r.name, 'cooks-' + r.id));
    return row;
  });
  if (!rows.length) rows.push(el('div', 'empty', data.recipes.length ? 'Kein Rezept in diesem Filter.' : 'Noch keine Rezepte. Oben eines anlegen oder per Link oder Screenshot holen.'));
  body.replaceChildren(head, ...rows);
}

// ---- Dialog: Rezept anlegen oder bearbeiten ------------------------------------------------------------
function field(labelText, control) {
  const f = el('label', 'set-field');
  f.append(el('span', 'set-label', labelText), control);
  return f;
}
function input(type, value, fk, extra) {
  const i = el(type === 'textarea' ? 'textarea' : 'input', 'set-input');
  if (type !== 'textarea') i.type = type;
  i.value = value == null ? '' : String(value);
  i.dataset.fk = fk;
  Object.assign(i, extra || {});
  return i;
}
const ingText = (list) => (list || []).map((z) => ((z.q ? z.q + ' ' : '') + z.t).trim()).join('\n');
const parseIngredients = (txt) => String(txt).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 80).map((l) => { const s = splitAmt(l); return { q: s.q, t: s.t.slice(0, 110) }; });
const parseSteps = (txt) => String(txt).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 60).map((l) => l.slice(0, 600));

export function renderRecipeEditor(body, id) {
  const isNew = id === 'new';
  const x = isNew ? null : data.recipes.find((r) => String(r.id) === String(id));
  $('ov-title').textContent = isNew ? 'Neues Rezept' : 'Rezept bearbeiten';
  if (!isNew && !x) { body.replaceChildren(el('div', 'empty', 'Dieses Rezept gibt es nicht mehr.')); return; }
  const f = {
    name: input('text', x ? x.name : '', 'rec-name', { maxLength: 60, placeholder: 'z. B. Linsencurry', autocomplete: 'off' }),
    cat: input('text', x ? x.cat : '', 'rec-cat', { maxLength: 30, placeholder: 'z. B. Hauptgericht', autocomplete: 'off' }),
    servings: input('number', x ? x.servings : 2, 'rec-servings', { min: 1, max: 50, inputMode: 'numeric' }),
    time: input('number', x && x.time ? x.time : '', 'rec-time', { min: 0, max: 1440, inputMode: 'numeric', placeholder: 'Minuten' }),
    ingredients: input('textarea', x ? ingText(x.ingredients) : '', 'rec-ing', { rows: 6, placeholder: 'Eine Zutat pro Zeile, z. B. 250 g rote Linsen' }),
    steps: input('textarea', x ? x.steps.join('\n') : '', 'rec-steps', { rows: 6, placeholder: 'Ein Schritt pro Zeile' }),
    url: input('url', x ? x.url : '', 'rec-url', { maxLength: 500, placeholder: 'https://', autocomplete: 'off' })
  };
  const listId = 'rec-cats';
  const dl = el('datalist');
  dl.id = listId;
  categories().forEach((c) => { const o = el('option'); o.value = c; dl.append(o); });
  f.cat.setAttribute('list', listId);
  const fav = el('input');
  fav.type = 'checkbox';
  fav.checked = !!(x && x.fav);
  fav.dataset.fk = 'rec-fav';
  const favLabel = el('label', 'rec-fav');
  favLabel.append(fav, el('span', null, 'Favorit'));
  let image = x ? x.image : null;
  const init = { name: f.name.value, cat: f.cat.value, servings: f.servings.value, time: f.time.value, ingredients: f.ingredients.value, steps: f.steps.value, url: f.url.value, fav: fav.checked };

  const msg = el('p', 'set-msg');
  msg.setAttribute('role', 'status');
  const parts = [];

  // Import (nur beim Anlegen): Link oder Screenshots fuellen die Felder, danach ist alles bearbeitbar
  if (isNew) {
    const imp = el('div', 'rec-import');
    const link = input('url', '', 'rec-import-url', { placeholder: 'Link zum Rezept einfügen', autocomplete: 'off' });
    const load = button('btn-ghost', 'Laden', async () => {
      const u = findUrl(link.value);
      if (!u) { msg.textContent = 'Das ist kein Link. Er fängt mit https:// an.'; link.focus(); return; }
      if (!navigator.onLine) { msg.textContent = 'Offline. Rezepte laden geht nur mit Internet.'; return; }
      msg.textContent = 'Rezept wird geladen …';
      load.disabled = true;
      try { fill(await importFromUrl(u)); } catch (e) { msg.textContent = 'Die Seite ließ sich nicht laden. Später noch einmal versuchen oder Zutaten von Hand eintragen.'; }
      finally { load.disabled = false; }
    }, 'Rezept vom Link laden', 'rec-import-load');
    const linkRow = el('div', 'rec-import-row');
    linkRow.append(link, load);
    const file = el('input', 'sr');
    file.type = 'file';
    file.accept = 'image/*';
    file.multiple = true;
    file.dataset.fk = 'rec-import-file';
    const pick = button('btn-ghost', 'Screenshots wählen', () => file.click(), 'Screenshots vom Rezept wählen, auch mehrere', 'rec-import-pick');
    file.addEventListener('change', async () => {
      const files = [...(file.files || [])].slice(0, 8);
      file.value = '';
      if (!files.length) return;
      if (!navigator.onLine && !window.Tesseract) { msg.textContent = 'Für die erste Texterkennung braucht das Cockpit Internet.'; return; }
      pick.disabled = true;
      try {
        const txt = await ocrImages(files, (n, p) => { msg.textContent = 'Bild ' + n + ' von ' + files.length + ' wird gelesen … ' + p + ' %'; });
        fill(fromText(txt, f.name.value.trim()));
      } catch (e) { msg.textContent = 'Die Bilder ließen sich nicht lesen. Schärfere Ausschnitte probieren oder von Hand eintragen.'; }
      finally { pick.disabled = false; }
    });
    imp.append(el('span', 'set-label', 'Importieren'), linkRow, pick, file,
      el('p', 'hint', 'Der Link geht zum Lesen an den Dienst r.jina.ai. Screenshots werden nur auf diesem Gerät gelesen.'));
    parts.push(imp);
  }

  function fill(r) {
    if (!r || !(r.ingredients || []).length) { msg.textContent = 'Keine Zutaten erkannt. Bitte prüfen und von Hand ergänzen.'; }
    else msg.textContent = (r.ingredients.length === 1 ? '1 Zutat' : r.ingredients.length + ' Zutaten') + ' und ' + (r.steps.length === 1 ? '1 Schritt' : r.steps.length + ' Schritte') + ' erkannt. Bitte kurz prüfen.';
    if (!r) return;
    if (r.name && !f.name.value.trim()) f.name.value = r.name;
    if (r.cat && !f.cat.value.trim()) f.cat.value = r.cat;
    if (r.servings) f.servings.value = r.servings;
    if (r.time) f.time.value = r.time;
    if (r.url) f.url.value = r.url;
    if (r.image) image = r.image;
    if ((r.ingredients || []).length) f.ingredients.value = ingText(r.ingredients);
    if ((r.steps || []).length) f.steps.value = r.steps.join('\n');
  }

  const row1 = el('div', 'plan-row');
  row1.append(field('Kategorie', f.cat), field('Portionen', f.servings), field('Zeit (Min)', f.time));
  parts.push(field('Name', f.name), row1, dl, field('Zutaten (eine pro Zeile)', f.ingredients), field('Schritte (einer pro Zeile)', f.steps), field('Link (optional)', f.url), favLabel);

  const foot = el('div', 'leave-foot');
  if (x) {
    foot.append(button('btn-link btn-danger', 'Löschen', async () => {
      if (!(await askConfirm('Rezept "' + x.name + '" wirklich löschen? Es verschwindet auch aus dem Essensplan und auf dem Handy.', 'Rezept löschen'))) return;
      write('recipes', (l) => l.filter((r) => String(r.id) !== String(x.id)));
      write('cats', (l) => l.filter((c) => !(isMeal(c) && String(c.rid) === String(x.id))));
      closeOverlay();
    }, 'Rezept löschen', 'rec-del'));
  }
  foot.append(button('btn-ghost', 'Abbrechen', closeOverlay, 'Abbrechen', 'rec-cancel'),
    button('btn-gold-s', 'Speichern', () => {
      const name = f.name.value.trim().slice(0, 60);
      if (!name) { msg.textContent = 'Bitte einen Namen eingeben.'; f.name.focus(); return; }
      const val = {
        name, cat: f.cat.value.trim().slice(0, 30), servings: Math.min(50, Math.max(1, Math.round(Number(f.servings.value) || 1))),
        time: Math.min(1440, Math.max(0, Math.round(Number(f.time.value) || 0))), ingredients: parseIngredients(f.ingredients.value),
        steps: parseSteps(f.steps.value), url: findUrl(f.url.value), fav: fav.checked
      };
      if (isNew) {
        const rec = { id: 'c' + newId(), name: val.name, url: val.url, steps: val.steps, servings: val.servings, yieldText: 'Portionen', time: val.time, image: image || null, ingredients: val.ingredients, status: 'saved', at: newId() };
        if (val.cat) rec.cat = val.cat;
        if (val.fav) rec.fav = true;
        write('recipes', (l) => { l.push(rec); });
      } else {
        // Nur Geaendertes schreiben, damit eine Aenderung von der Partner-App in der Zwischenzeit erhalten bleibt
        const now = { name: f.name.value, cat: f.cat.value, servings: f.servings.value, time: f.time.value, ingredients: f.ingredients.value, steps: f.steps.value, url: f.url.value, fav: fav.checked };
        write('recipes', (l) => l.map((r) => {
          if (String(r.id) !== String(x.id)) return r;
          Object.keys(now).forEach((k) => {
            if (now[k] === init[k]) return;
            if (k === 'cat' || k === 'fav') { if (val[k]) r[k] = val[k]; else delete r[k]; } else r[k] = val[k];
          });
          return r;
        }));
      }
      closeOverlay();
    }, 'Rezept speichern', 'rec-save'));
  body.replaceChildren(...parts, msg, foot);
}
