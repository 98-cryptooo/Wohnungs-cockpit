// Kochmodus: Aktionen auf Rezepten, Schritte, Portionen, Timer.
import { data, ui, setUi, write, newId } from './state.js';
import { el, icon, pad, scaleQ, stepMinutes, safeUrl } from './util.js';
import { isDataImage, ensureImage } from './recipeimage.js';
import { askConfirm } from './confirm.js';
import { itemBelongsTo } from './core.js';

const $ = (id) => document.getElementById(id);

// ---- Aktionen ---------------------------------------------------------------
export function cookRecipe(rid) {
  const r = data.recipes.find((x) => x.id === rid);
  if (!r) return;
  write('recipes', (list) => list.map((x) => {
    if (x.id === rid) x.status = 'today';
    else if (x.status === 'today') x.status = 'list';
    return x;
  }));
  setUi({ cook: { rid, step: 0, servings: r.servings || 1 }, open: null });
}

export function openTodayCook() {
  const r = data.recipes.find((x) => x.status === 'today');
  if (r) setUi({ cook: { rid: r.id, step: 0, servings: r.servings || 1 } });
}

export function dropRecipe(rid) {
  const rec = data.recipes.find((x) => x.id === rid);
  write('recipes', (list) => list.map((x) => { if (x.id === rid) x.status = 'saved'; return x; }));
  write('shop', (list) => list.filter((x) => !(rec ? itemBelongsTo(x, rec) : x.r === rid)));
}

export function rebuy(rid) {
  const r = data.recipes.find((x) => x.id === rid);
  if (!r) return;
  write('recipes', (list) => list.map((x) => { if (x.id === rid) x.status = 'list'; return x; }));
  write('shop', (list) => list.filter((x) => !itemBelongsTo(x, r)).concat(
    r.ingredients.map((z) => ({ t: z.t, q: z.q || undefined, g: r.name, r: rid, done: false, at: newId() }))
  ));
}

export function closeCook() {
  setUi({ cook: null, timer: null });
}

async function finishCook() {
  const ck = ui.cook;
  if (!ck) return;
  const rid = ck.rid;
  const rec = data.recipes.find((x) => x.id === rid);
  const missing = data.shop.filter((x) => (rec ? itemBelongsTo(x, rec) : x.r === rid) && !x.done).length;
  if (missing > 0) {
    const text = missing === 1 ? 'Noch 1 Zutat nicht gekauft. Trotzdem fertig?' : 'Noch ' + missing + ' Zutaten nicht gekauft. Trotzdem fertig?';
    if (!(await askConfirm(text, 'Trotzdem fertig'))) return;
    if (!ui.cook || ui.cook.rid !== rid) return;
  }
  write('recipes', (list) => list.map((x) => { if (x.id === rid) x.status = 'saved'; return x; }));
  write('shop', (list) => list.filter((x) => !(rec ? itemBelongsTo(x, rec) : x.r === rid)));
  setUi({ cook: null, timer: null });
}

function currentRecipe() {
  return ui.cook ? data.recipes.find((r) => r.id === ui.cook.rid) || null : null;
}
function stepIndex(cr) {
  return Math.min(ui.cook.step, Math.max(0, cr.steps.length - 1));
}

export function isCookOpen() { return !!currentRecipe(); }

function setServings(delta) {
  const ck = ui.cook;
  if (!ck) return;
  setUi({ cook: Object.assign({}, ck, { servings: Math.min(40, Math.max(1, ck.servings + delta)) }) });
}
function goStep(delta) {
  const cr = currentRecipe();
  if (!cr) return;
  const idx = stepIndex(cr);
  const last = !cr.steps.length || idx >= cr.steps.length - 1;
  if (delta > 0 && last) { finishCook(); return; }
  setUi({ cook: Object.assign({}, ui.cook, { step: Math.max(0, idx + delta) }) });
}
function timerTap() {
  const cr = currentRecipe();
  if (!cr) return;
  if (ui.timer) { setUi({ timer: null }); return; }
  const min = stepMinutes(cr.steps[stepIndex(cr)]);
  if (min > 0) setUi({ timer: { endsAt: Date.now() + min * 60000, total: min } });
}

// ---- Anzeige ------------------------------------------------------------------
let wasOpen = false;

function applyTimer() {
  const b = $('cook-timer');
  const cr = currentRecipe();
  if (!cr) { b.hidden = true; return; }
  const min = stepMinutes(cr.steps[stepIndex(cr)]);
  const tm = ui.timer;
  b.hidden = !(min > 0 || tm);
  if (b.hidden) return;
  const left = tm ? Math.max(0, Math.round((tm.endsAt - Date.now()) / 1000)) : 0;
  const running = !!tm && left > 0;
  const done = !!tm && left === 0;
  b.classList.toggle('running', running);
  b.classList.toggle('done', done);
  $('timer-main').textContent = running ? Math.floor(left / 60) + ':' + pad(left % 60) : done ? 'Zeit ist um' : 'Timer starten · ' + min + ':00';
  $('timer-sub').textContent = running ? 'Stopp' : done ? 'Timer aus' : '';
}
export const updateTimerView = applyTimer;

// Bild vom Gericht oben in der Zutatenspalte, ohne Bild ein ruhiger Platzhalter
function renderCookImage(cr) {
  const box = $('cook-img');
  const src = isDataImage(cr.image) ? cr.image : null;
  if (box.dataset.src === (src || '-')) { if (!src) ensureImage(cr); return; }
  box.dataset.src = src || '-';
  box.classList.toggle('is-empty', !src);
  if (src) {
    const img = el('img');
    img.alt = 'Bild vom Gericht: ' + cr.name;
    img.decoding = 'async';
    img.src = src;
    box.replaceChildren(img);
  } else {
    box.replaceChildren(icon('dish', 26), el('span', null, 'Kein Bild'));
    ensureImage(cr);
  }
}

export function renderCook() {
  const root = $('cook');
  const cr = currentRecipe();
  if (!cr) { root.hidden = true; wasOpen = false; return; }
  root.hidden = false;
  const ck = ui.cook;
  const n = cr.steps.length;
  const idx = stepIndex(cr);
  const last = !n || idx >= n - 1;
  const factor = ck.servings / (cr.servings || 1);

  $('cook-counter').textContent = 'Kochmodus · ' + (n ? 'Schritt ' + (idx + 1) + ' von ' + n : 'Zutaten');
  $('cook-name').textContent = cr.name;
  const href = safeUrl(cr.url);
  const link = $('cook-link');
  link.hidden = !href;
  if (href) { link.href = href; link.rel = 'noopener noreferrer'; link.target = '_blank'; }
  else link.removeAttribute('href');

  renderCookImage(cr);
  $('serv-label').textContent = ck.servings + ' ' + (cr.yieldText || 'Portionen');
  $('cook-ingr').replaceChildren(...cr.ingredients.map((z) => {
    const row = el('div', 'ingr');
    row.append(el('span', 'ingr-q', scaleQ(z.q, factor)), el('span', 'ingr-t', z.t));
    return row;
  }));

  const st = $('step-text');
  if (n) { st.className = 'step-text'; st.textContent = cr.steps[idx]; }
  else { st.className = 'step-text muted'; st.textContent = 'Zu diesem Rezept ist keine Anleitung gespeichert. Die Zutaten stehen links, die Anleitung findest du im Original.'; }

  $('step-prev').setAttribute('aria-disabled', idx > 0 ? 'false' : 'true');
  $('step-next').textContent = last ? 'Fertig, in die Sammlung' : 'Weiter';
  applyTimer();

  if (!wasOpen) { wasOpen = true; $('cook-close').focus({ preventScroll: true }); }
}

export function initCook() {
  $('cook-close').addEventListener('click', closeCook);
  $('serv-less').addEventListener('click', () => setServings(-1));
  $('serv-more').addEventListener('click', () => setServings(1));
  $('step-prev').addEventListener('click', () => { const cr = currentRecipe(); if (cr && stepIndex(cr) > 0) goStep(-1); });
  $('step-next').addEventListener('click', () => goStep(1));
  $('cook-timer').addEventListener('click', timerTap);
}
