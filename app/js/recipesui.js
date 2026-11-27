// Rezepte im Cockpit: Sammlung (alle Rezepte, Favoriten, Kategorien) und Dialog zum Anlegen und Bearbeiten,
// mit Import per Link (r.jina.ai) und per Screenshots (Texterkennung auf dem Geraet).
// Felder wie in der Partner-App, neu und optional: fav (Favorit), cat (Kategorie). Die Partner-App behaelt sie.
import { data, write, newId } from './state.js';
import { el, button, icon, scaleQ } from './util.js';
import { askConfirm } from './confirm.js';
import { cookRecipe } from './cook.js';
import { openOverlay, closeOverlay } from './render.js';
import { splitAmt, importFromUrl, ocrImages, fromText, findUrl } from './recipeimport.js';
import { isDataImage, shrinkImage, fetchRemoteImage, ensureImage, storageRoom } from './recipeimage.js';
import { isMeal } from './meals.js';
import { estimate, okGrams } from './nutrition.js';
import { shopRecipes } from './mealsui.js';

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
      button('btn-ghost', 'Einkaufen', () => shopRecipes([r]), 'Fehlende Zutaten einkaufen: ' + r.name, 'rebuy-' + r.id),
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
  // Bild: image ist der aktuelle Stand im Dialog, imgSrc eine noch nicht geladene Bildadresse vom Link
  let image = x && isDataImage(x.image) ? x.image : null;
  let initImage = image;
  let imgSrc = x && !image && !x.imgOff ? x.image : null;
  let imgRemoved = false;
  let imgUser = false; // selbst gewaehlt (Foto oder Screenshot): Link-Import ersetzt es nicht
  let imgToken = 0; // spaetere Auswahl gewinnt gegen ein langsam ladendes Bild
  const init = { name: f.name.value, cat: f.cat.value, servings: f.servings.value, time: f.time.value, ingredients: f.ingredients.value, steps: f.steps.value, url: f.url.value, fav: fav.checked };

  // Naehrwerte pro Portion: gespeichert (Seite oder eigene Angabe), leeres Feld heisst schaetzen
  const NK = [['kcal', 'kcal'], ['p', 'Eiweiß (g)'], ['f', 'Fett (g)'], ['c', 'KH (g)']];
  let nutrBase = x && x.nutr && typeof x.nutr === 'object' ? { ...x.nutr } : null;
  const nf = {};
  NK.forEach(([k]) => { nf[k] = input('number', nutrBase && Number.isFinite(nutrBase[k]) && nutrBase[k] >= 0 && nutrBase[k] < 10000 ? Math.round(nutrBase[k]) : '', 'rec-nutr-' + k, { min: 0, max: 9999, inputMode: 'numeric' }); });
  let nInit = {};
  const markNutrInit = () => { NK.forEach(([k]) => { nInit[k] = nf[k].value; }); };
  markNutrInit();
  const nutrHint = el('p', 'hint');
  function updateNutrHint() {
    const e = estimate({ servings: f.servings.value, ingredients: parseIngredients(f.ingredients.value) });
    NK.forEach(([k]) => { nf[k].placeholder = e.ok ? 'ca. ' + e[k] : 'k. A.'; });
    const t = (nutrBase && nutrBase.src === 'page' ? 'Werte von der Rezeptseite. ' : '') + 'Leere Felder schätzt die App aus den Zutaten.';
    nutrHint.replaceChildren(t);
    if (e.unknown.length) nutrHint.append(el('br'), 'Nicht erkannt: ' + e.unknown.slice(0, 6).join(', ') + (e.unknown.length > 6 ? ' und weitere' : '') + '.');
  }
  const msg = el('p', 'set-msg');
  msg.setAttribute('role', 'status');

  // Portionen umrechnen: Aendert man die Portionen, rechnen die Mengen der Zutaten mit. Grundlage ist der Stand
  // vor der ersten Aenderung (scaleBase), damit 2 -> 3 -> 2 wieder genau die Ausgangsmengen ergibt.
  // "Nur Zahl ändern" stellt die Zutaten zurueck, falls nur eine falsch erkannte Portionenzahl korrigiert wird.
  let scaleBase = null;
  const servHint = el('p', 'hint rec-serv-hint');
  servHint.hidden = true;
  const servNum = () => Math.min(50, Math.max(1, Math.round(Number(f.servings.value) || 0)));
  const scaleText = (txt, fac) => String(txt).split(/\r?\n/).map((l) => {
    if (!l.trim()) return l;
    const s = splitAmt(l.trim());
    return s.q ? (scaleQ(s.q, fac) + ' ' + s.t).trim() : l;
  }).join('\n');
  function onServings() {
    const n = Number(f.servings.value);
    if (!(n >= 1 && n <= 50)) return;
    if (!scaleBase) {
      const from = Number(lastServ);
      if (!(from >= 1)) { lastServ = f.servings.value; return; }
      scaleBase = { n: from, txt: f.ingredients.value };
    }
    lastServ = f.servings.value;
    if (servNum() === scaleBase.n) { f.ingredients.value = scaleBase.txt; servHint.hidden = true; scaleBase = null; updateNutrHint(); return; }
    f.ingredients.value = scaleText(scaleBase.txt, servNum() / scaleBase.n);
    servHint.replaceChildren('Mengen von ' + scaleBase.n + ' auf ' + servNum() + ' Portionen umgerechnet. ',
      button('btn-link', 'Nur Zahl ändern', () => {
        f.ingredients.value = scaleBase.txt;
        scaleBase = null;
        servHint.hidden = true;
        updateNutrHint();
      }, 'Mengen zurücksetzen und nur die Portionenzahl ändern', 'rec-serv-keep'));
    servHint.hidden = false;
    updateNutrHint();
  }
  let lastServ = f.servings.value;
  f.ingredients.addEventListener('input', () => { scaleBase = null; servHint.hidden = true; updateNutrHint(); });
  f.servings.addEventListener('input', onServings);
  const parts = [];

  const imgPrev = el('div', 'rec-img-prev');
  const shots = el('div', 'rec-shots');
  shots.hidden = true;
  const imgFile = el('input', 'sr');
  imgFile.type = 'file';
  imgFile.accept = 'image/*';
  imgFile.dataset.fk = 'rec-img-file';
  imgFile.tabIndex = -1;
  imgFile.setAttribute('aria-hidden', 'true');
  const imgPick = button('btn-ghost', 'Bild wählen', () => imgFile.click(), 'Eigenes Bild vom Gericht wählen', 'rec-img-pick');
  const imgDel = button('btn-link btn-danger', 'Bild entfernen', () => { setImage(null); imgRemoved = true; imgUser = false; }, 'Bild entfernen', 'rec-img-del');
  let loadingImg = false;
  function showImage() {
    imgPrev.classList.toggle('is-empty', !image);
    if (image) {
      const im = el('img');
      im.alt = 'Bild vom Gericht';
      im.src = image;
      imgPrev.replaceChildren(im);
    } else imgPrev.replaceChildren(el('span', null, loadingImg ? 'Bild wird geladen …' : 'Kein Bild'));
    imgDel.hidden = !image;
    [...shots.querySelectorAll('.rec-shot')].forEach((b) => b.setAttribute('aria-pressed', b.dataset.img === image ? 'true' : 'false'));
  }
  function setImage(d) { imgToken++; if (d) imgRemoved = false; loadingImg = false; image = d; imgSrc = null; showImage(); }
  // Bild von einer Adresse laden, ohne eine spaetere Auswahl zu ueberschreiben
  function loadRemote(src) {
    const tok = ++imgToken;
    imgSrc = src;
    loadingImg = true;
    showImage();
    fetchRemoteImage(src).then((d) => { if (tok === imgToken) { image = d; imgSrc = null; } })
      .catch(() => { /* Adresse bleibt gemerkt, beim Oeffnen im Kochmodus wird es erneut versucht */ })
      .finally(() => { if (tok === imgToken) { loadingImg = false; showImage(); } });
  }
  imgFile.addEventListener('change', async () => {
    const fl = imgFile.files && imgFile.files[0];
    imgFile.value = '';
    if (!fl) return;
    try { setImage(await shrinkImage(fl)); imgUser = true; } catch (e) { msg.textContent = 'Das Bild ließ sich nicht öffnen. Bitte ein anderes wählen.'; }
  });
  const imgActions = el('div', 'rec-img-actions');
  imgActions.append(imgPick, imgDel, imgFile);
  const imgRow = el('div', 'rec-img');
  imgRow.append(imgPrev, imgActions);
  // Altes Rezept ohne gespeichertes Bild: im Hintergrund nachholen
  if (x && !image && !x.imgOff) {
    loadingImg = navigator.onLine;
    const tok = imgToken;
    ensureImage(x).then((d) => {
      if (tok !== imgToken) return;
      loadingImg = false;
      if (d) { image = d; initImage = d; imgSrc = null; }
      showImage();
    });
  }
  showImage();

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
        await offerShots(files);
      } catch (e) { msg.textContent = 'Die Bilder ließen sich nicht lesen. Schärfere Ausschnitte probieren oder von Hand eintragen.'; }
      finally { pick.disabled = false; }
    });
    imp.append(el('span', 'set-label', 'Importieren'), linkRow, pick, file,
      el('p', 'hint', 'Der Link geht zum Lesen an den Dienst r.jina.ai, die Bildadresse zum Verkleinern an wsrv.nl. Screenshots werden nur auf diesem Gerät gelesen.'));
    parts.push(imp);
  }

  // Nach dem Screenshot-Import: welcher Screenshot zeigt das Gericht? Ohne Auswahl der erste.
  async function offerShots(files) {
    const thumbs = [];
    for (const fl of files) { try { thumbs.push(await shrinkImage(fl, true)); } catch (e) { /* Bild ueberspringen */ } }
    if (!thumbs.length) return;
    if (!image && !loadingImg) setImage(thumbs[0]);
    if (thumbs.length < 2) { showImage(); return; }
    shots.replaceChildren(el('span', 'set-label', 'Welches Bild zeigt das Gericht?'), ...thumbs.map((d, i) => {
      const b = button('rec-shot', null, () => { setImage(d); imgUser = true; }, 'Screenshot ' + (i + 1) + ' als Bild nehmen', 'rec-shot-' + i);
      b.dataset.img = d;
      const im = el('img');
      im.alt = '';
      im.src = d;
      b.append(im);
      return b;
    }));
    shots.hidden = false;
    showImage();
  }

  function fill(r) {
    if (!r || !(r.ingredients || []).length) { msg.textContent = 'Keine Zutaten erkannt. Bitte prüfen und von Hand ergänzen.'; }
    else msg.textContent = (r.ingredients.length === 1 ? '1 Zutat' : r.ingredients.length + ' Zutaten') + ' und ' + (r.steps.length === 1 ? '1 Schritt' : r.steps.length + ' Schritte') + ' erkannt. Bitte kurz prüfen.';
    if (!r) return;
    if (r.name && !f.name.value.trim()) f.name.value = r.name;
    if (r.cat && !f.cat.value.trim()) f.cat.value = r.cat;
    if (r.servings) f.servings.value = r.servings;
    lastServ = f.servings.value;
    scaleBase = null;
    servHint.hidden = true;
    if (r.time) f.time.value = r.time;
    if (r.url) f.url.value = r.url;
    if (r.image && !imgUser) loadRemote(r.image);
    // Werte der Seite uebernehmen. Ein zweiter Import ohne Werte loescht die des ersten Links.
    if (r.nutr || (nutrBase && nutrBase.src === 'page')) {
      nutrBase = r.nutr ? { ...r.nutr, src: 'page' } : null;
      NK.forEach(([k]) => { nf[k].value = r.nutr && Number.isFinite(r.nutr[k]) ? r.nutr[k] : ''; });
      markNutrInit();
    }
    if ((r.ingredients || []).length) f.ingredients.value = ingText(r.ingredients);
    if ((r.steps || []).length) f.steps.value = r.steps.join('\n');
    updateNutrHint();
  }

  const row1 = el('div', 'plan-row');
  row1.append(field('Kategorie', f.cat), field('Portionen', f.servings), field('Zeit (Min)', f.time));
  const imgField = el('div', 'set-field');
  imgField.append(el('span', 'set-label', 'Bild vom Gericht'), imgRow, shots);
  const nutrRow = el('div', 'rec-nutr');
  nutrRow.append(...NK.map(([k, label]) => field(label, nf[k])));
  const nutrField = el('div', 'set-field');
  nutrField.append(el('span', 'set-label', 'Nährwerte pro Portion'), nutrRow, nutrHint);
  updateNutrHint();
  parts.push(field('Name', f.name), row1, servHint, dl, field('Zutaten (eine pro Zeile)', f.ingredients), field('Schritte (einer pro Zeile)', f.steps), field('Link (optional)', f.url), imgField, nutrField, favLabel);

  const foot = el('div', 'leave-foot');
  if (x) {
    foot.append(button('btn-link btn-danger', 'Löschen', async () => {
      if (!(await askConfirm('Rezept "' + x.name + '" wirklich löschen? Es verschwindet auch aus dem Essensplan und auf dem Handy.', 'Rezept löschen'))) return;
      write('recipes', (l) => l.filter((r) => String(r.id) !== String(x.id)));
      write('cats', (l) => l.filter((c) => !(isMeal(c) && String(c.rid) === String(x.id)) && c.id !== 'rec-' + x.id));
      closeOverlay();
    }, 'Rezept löschen', 'rec-del'));
  }
  foot.append(button('btn-ghost', 'Abbrechen', closeOverlay, 'Abbrechen', 'rec-cancel'),
    button('btn-gold-s', 'Speichern', () => {
      const name = f.name.value.trim().slice(0, 60);
      if (!name) { msg.textContent = 'Bitte einen Namen eingeben.'; f.name.focus(); return; }
      const rawUrl = f.url.value.trim();
      if (rawUrl && !/^https?:\/\//i.test(rawUrl) && /^[\w-]+(\.[\w-]+)+/.test(rawUrl)) f.url.value = 'https://' + rawUrl;
      if (f.url.value.trim() && !findUrl(f.url.value)) { msg.textContent = 'Der Link sieht nicht richtig aus. Bitte prüfen oder leer lassen.'; f.url.focus(); return; }
      if (image && image !== initImage && !storageRoom()) { msg.textContent = 'Der Speicher auf diesem Gerät ist fast voll. Bitte das Bild entfernen oder ein paar alte Rezepte löschen.'; return; }
      const val = {
        name, cat: f.cat.value.trim().slice(0, 30), servings: Math.min(50, Math.max(1, Math.round(Number(f.servings.value) || 1))),
        time: Math.min(1440, Math.max(0, Math.round(Number(f.time.value) || 0))), ingredients: parseIngredients(f.ingredients.value),
        steps: parseSteps(f.steps.value), url: findUrl(f.url.value), fav: fav.checked
      };
      // Naehrwerte: nur bei Aenderung als eigene Angabe speichern, alle Felder leer heisst wieder schaetzen
      const nv = {};
      NK.forEach(([k]) => { const v = Number(String(nf[k].value).replace(',', '.')); if (nf[k].value.trim() !== '' && Number.isFinite(v) && v >= 0) nv[k] = Math.min(9999, Math.round(v)); });
      const nChanged = NK.some(([k]) => nf[k].value !== nInit[k]);
      let nutr = nutrBase;
      if (nChanged) nutr = Object.keys(nv).length ? Object.assign(nv, nutrBase && okGrams(nutrBase.g) ? { g: nutrBase.g } : {}, { src: 'user' }) : null;
      if (isNew) {
        const rec = { id: 'c' + newId(), name: val.name, url: val.url, steps: val.steps, servings: val.servings, yieldText: 'Portionen', time: val.time, image: image || imgSrc || null, ingredients: val.ingredients, status: 'saved', at: newId() };
        if (val.cat) rec.cat = val.cat;
        if (val.fav) rec.fav = true;
        if (imgRemoved && !rec.image) rec.imgOff = true;
        if (nutr) rec.nutr = nutr;
        write('recipes', (l) => { l.push(rec); });
        // Bild lud beim Speichern noch: im Hintergrund fertig holen und ins Rezept schreiben
        if (!isDataImage(rec.image) && rec.image) ensureImage(rec);
      } else {
        // Nur Geaendertes schreiben, damit eine Aenderung von der Partner-App in der Zwischenzeit erhalten bleibt
        const now = { name: f.name.value, cat: f.cat.value, servings: f.servings.value, time: f.time.value, ingredients: f.ingredients.value, steps: f.steps.value, url: f.url.value, fav: fav.checked };
        const imgChanged = image !== initImage || (imgRemoved && !image);
        write('recipes', (l) => l.map((r) => {
          if (String(r.id) !== String(x.id)) return r;
          if (imgChanged) {
            // Entfernen merkt sich imgOff, damit das Bild nicht vom Link nachgeholt wird
            if (image) { r.image = image; delete r.imgOff; } else { r.image = null; r.imgOff = true; }
          }
          if (nChanged) { if (nutr) r.nutr = nutr; else delete r.nutr; }
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
