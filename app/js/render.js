// Darstellung der Kacheln und Overlays. Alles per DOM-Methoden und textContent.
import { data, ui, write, setUi, newId, calendarRaw, getVet, getDepartures, DEMO_STOP_NAME, DEMO_WALK_MINUTES, DEMO, catDone, catDay } from './state.js';
import { el, button, icon, pad } from './util.js';
import { cookRecipe, dropRecipe, rebuy, openTodayCook } from './cook.js';
import { askConfirm } from './confirm.js';
import { recipeForItem } from './core.js';
import { safeUrl } from './util.js';
import { buildCalendar, getCalendarState, calendarNote } from './calendar.js';
import { buildWeather, demoWeather, getWeatherState, usableWeather, weatherMessage } from './weather.js';
import { buildDepartures, getTransitState, usableDepartures, busMessage } from './transit.js';
import { standText } from './poll.js';
import { settings } from './settings.js';

const $ = (id) => document.getElementById(id);
const DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const DSHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Nach dem Neuaufbau einer Liste den Fokus auf das gleiche Element zuruecksetzen (Tastatur, Screenreader).
export function keepFocus(fn) {
  const a = document.activeElement;
  const fk = a && a.dataset ? a.dataset.fk : null;
  fn();
  if (fk) {
    const n = document.querySelector('[data-fk="' + CSS.escape(fk) + '"]');
    if (n && n !== document.activeElement) n.focus({ preventScroll: true });
  }
}

// ---- Kalender ------------------------------------------------------------------
// Termine: im Demo-Modus Beispieltermine relativ zu heute, sonst die letzte Antwort der Funktion "calendar" (oder ihr Cache).
export function computeCal(now) {
  if (DEMO) return buildCalendar(calendarRaw(now), [], now);
  const st = getCalendarState();
  return buildCalendar(st.events, st.calendars, now);
}

function chip(e) { return el('span', 'chip' + (e.soon ? ' soon' : ''), e.day); }

export function renderClock(now) {
  $('clock').textContent = pad(now.getHours()) + ':' + pad(now.getMinutes());
  $('date-label').textContent = DAYS[now.getDay()] + ', ' + now.getDate() + '. ' + MONTHS[now.getMonth()];
}

export function renderToday(now) {
  const { todayEv, next } = computeCal(now);
  $('next-title').textContent = todayEv.length ? todayEv[0].title : 'Heute nichts mehr';
  $('next-meta').textContent = todayEv.length ? todayEv[0].when : (next ? 'Als Nächstes: ' + next.title + ', ' + next.when : '');
  const open = data.tasks.filter((x) => !x.done).length;
  $('task-todo').textContent = open ? 'Diese Woche: ' + open + ' Aufgaben offen' : 'Diese Woche: alles erledigt';
  const todayRec = data.recipes.find((r) => r.status === 'today');
  $('today-cook').hidden = !todayRec;
  $('today-name').textContent = todayRec ? 'Heute kochen: ' + todayRec.name : '';
  const c = {}; data.cats.forEach((x) => { c[x.id] = catDone(x, now); });
  const openCats = [];
  if (!c.morgens) openCats.push('morgens füttern');
  if (!c.abends) openCats.push('abends füttern');
  if (!c.klo) openCats.push('Klo');
  $('cat-todo').textContent = openCats.length ? 'Katzen: ' + openCats.join(', ') : 'Katzen: alles erledigt';
}

export function renderCalTop(now) {
  const { cal } = computeCal(now);
  const rows = cal.slice(0, 3).map((e) => {
    const row = el('div', 'ev');
    const col = el('span', 'col');
    col.append(el('span', 'ev-title', e.title), el('span', 'ev-when', e.when));
    row.append(chip(e), col);
    return row;
  });
  const st = getCalendarState();
  if (!rows.length) rows.push(el('div', 'empty', !DEMO && !st.stamp ? 'Noch keine Termine.' : 'Keine Termine in Sicht.'));
  $('cal-top').replaceChildren(...rows);
  const note = DEMO ? '' : calendarNote(st);
  $('cal-note').hidden = !note;
  $('cal-note').textContent = note;
}

// ---- Wetter ------------------------------------------------------------------------------------
// Demo: Beispielwerte, sonst Open-Meteo (oder der Cache). Gibt null zurueck, wenn es keine Werte gibt.
export function currentWeather(now) {
  if (DEMO) return buildWeather(demoWeather(now), now);
  if (!settings.get().weather) return null;
  return buildWeather(usableWeather(getWeatherState(), now.getTime()), now);
}

export function renderWeather(now) {
  const w = currentWeather(now);
  const loc = DEMO ? true : !!settings.get().weather;
  $('weather-empty').textContent = weatherMessage(getWeatherState(), loc);
  $('weather-empty').hidden = !!w;
  $('weather-config').hidden = !!w || loc;
  $('weather-data').hidden = !w;
  const st = getWeatherState();
  const note = !DEMO && w && st.failures > 0 && st.stamp ? standText(st.stamp) : '';
  $('weather-note').hidden = !note;
  $('weather-note').textContent = note;
  if (!w) return;
  $('weather-icon').replaceChildren(icon(w.icon, 44, '#D4B37A', 1.5));
  $('weather-temp').textContent = w.temp;
  $('weather-cond').textContent = w.cond;
  $('weather-feels').textContent = w.feels;
  $('forecast').textContent = w.forecast;
}

// ---- Einkauf ------------------------------------------------------------------
const STORES = [['food', 'Lebensmittelmarkt'], ['drug', 'Drogerie'], ['other', 'Andere']];

function storeOf(x) {
  if (x.r || x.u) return 'food';
  const g = String(x.g || '').trim().toLowerCase();
  if (g === 'drogerie') return 'drug';
  return !g || g === 'allgemein' ? 'food' : 'other';
}

function checkRow(label, qty, done, onToggle, fk) {
  const b = el('button', 'check');
  b.type = 'button';
  b.setAttribute('role', 'checkbox');
  b.setAttribute('aria-checked', done ? 'true' : 'false');
  b.dataset.fk = fk;
  const box = el('span', 'box'); box.setAttribute('aria-hidden', 'true');
  b.append(box, el('span', 'label', label));
  if (qty) b.append(el('span', 'qty', qty));
  b.addEventListener('click', onToggle);
  return b;
}

function toggleShop(at) {
  write('shop', (list) => {
    const x = list.find((y) => y.at === at);
    if (!x) return;
    x.done = !x.done;
    if (x.done) x.doneAt = Date.now(); else delete x.doneAt;
  });
}

export function renderShop() {
  // Zuordnung Posten zu Rezept: ueber r (ID), u (Link) oder u mit g (Name), siehe core.js itemBelongsTo.
  // Ohne passendes Rezept (die Partner-App hat es noch nicht hochgeladen) gruppiert der Posten nach r oder g.
  const items = data.shop.map((x) => {
    const rec = recipeForItem(data.recipes, x);
    const key = rec ? 'rec:' + rec.id : (x.r ? 'r:' + x.r : (x.u ? 'g:' + x.g : null));
    return { x, rec, store: storeOf(x), recipe: key };
  });
  const byDone = (a, b) => (a.x.done ? 1 : 0) - (b.x.done ? 1 : 0);

  const groups = [];
  STORES.forEach(([k, name]) => {
    const inStore = items.filter((i) => i.store === k);
    if (!inStore.length) return;
    const g = el('div', 'group');
    const open = inStore.filter((i) => !i.x.done).length;
    const head = el('div', 'group-head');
    const dot = el('span', 'dot dot-' + k); dot.setAttribute('aria-hidden', 'true');
    head.append(dot, el('h3', null, name), el('span', 'group-count', open ? open + ' offen' : 'erledigt'));
    g.append(head);

    const plain = inStore.filter((i) => !i.recipe).sort(byDone);
    if (plain.length) {
      const sub = el('div', 'sub');
      plain.forEach((i) => sub.append(checkRow(i.x.t, i.x.q, i.x.done, () => toggleShop(i.x.at), 'shop-' + i.x.at)));
      g.append(sub);
    }
    [...new Set(inStore.filter((i) => i.recipe).map((i) => i.recipe))].forEach((key) => {
      const members = inStore.filter((i) => i.recipe === key);
      const rec = members[0].rec;
      const rid = rec ? rec.id : null;
      const title = rec ? rec.name : (members.map((i) => i.x.g).find(Boolean) || 'Rezept');
      const sub = el('div', 'sub recipe');
      const sh = el('div', 'sub-head');
      sh.append(icon('book', 14, '#D4B37A'), el('span', 'sub-title', title));
      if (rec) {
        sh.append(button('btn-gold-s', 'Heute kochen', () => cookRecipe(rid), 'Heute kochen: ' + title, 'cook-' + rid));
        sh.append(button('btn-ghost', 'Abwählen', () => dropRecipe(rid), 'Rezept abwählen: ' + title, 'drop-' + rid));
      } else {
        // Rezept noch nicht angekommen: Hinweis und, wenn ein Link bekannt ist, "Original oeffnen" (nur http und https)
        const href = members.map((i) => safeUrl(i.x.u)).find(Boolean);
        if (href) {
          const a = el('a', 'btn-ghost link-btn', 'Original öffnen');
          a.href = href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.setAttribute('aria-label', 'Original öffnen: ' + title);
          sh.append(a);
        }
      }
      sub.append(sh);
      if (!rec) sub.append(el('div', 'sub-hint', 'Anleitung noch nicht synchronisiert'));
      members.sort(byDone)
        .forEach((i) => sub.append(checkRow(i.x.t, i.x.q, i.x.done, () => toggleShop(i.x.at), 'shop-' + i.x.at)));
      g.append(sub);
    });
    groups.push(g);
  });
  if (!groups.length) groups.push(el('div', 'empty', 'Noch nichts auf der Liste.'));
  $('shop-list').replaceChildren(...groups);
  $('shop-title').textContent = 'Einkauf · ' + data.shop.filter((x) => !x.done).length + ' offen';
  $('btn-saved').textContent = 'Sammlung · ' + data.recipes.filter((r) => r.status === 'saved').length;
}

// ---- Aufgaben -------------------------------------------------------------------
const WHO = ['Rik', 'Melina', 'Beide'];
const WHO_CLASS = { Rik: 'who-rik', Melina: 'who-melina', Beide: 'who-beide' };

export function renderTasks() {
  const rows = data.tasks.map((x) => {
    const row = el('div', 'task');
    const chk = checkRow(x.text, '', x.done, () => write('tasks', (l) => { const y = l.find((z) => z.id === x.id); if (y) y.done = !y.done; }), 'task-' + x.id);
    chk.setAttribute('aria-label', x.text);
    const who = button('who ' + (WHO_CLASS[x.who] || 'who-beide'), x.who,
      () => write('tasks', (l) => { const y = l.find((z) => z.id === x.id); if (y) y.who = WHO[(WHO.indexOf(y.who) + 1) % WHO.length]; }),
      'Zuständig: ' + x.who + '. Tippen zum Wechseln', 'who-' + x.id);
    const del = button('del', null, () => write('tasks', (l) => l.filter((z) => z.id !== x.id)), 'Aufgabe löschen: ' + x.text, 'del-' + x.id);
    del.append(icon('close', 16));
    row.append(chk, who, del);
    return row;
  });
  $('task-list').replaceChildren(...rows);
  $('task-empty').hidden = rows.length > 0;
  $('tasks-title').textContent = 'Diese Woche · ' + data.tasks.filter((x) => x.done).length + '/' + data.tasks.length;
}

export function initTaskForm() {
  $('btn-week-reset').addEventListener('click', async () => {
    if (!data.tasks.some((x) => x.done)) return;
    if (await askConfirm('Alle Aufgaben wieder auf offen setzen und die Woche neu starten?', 'Woche neu starten')) {
      write('tasks', (l) => l.map((x) => { x.done = false; return x; }));
    }
  });
  const input = $('task-input');
  const add = $('task-add');
  input.addEventListener('input', () => add.classList.toggle('ready', input.value.trim().length > 0));
  $('task-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    write('tasks', (l) => { l.push({ id: newId(), text, who: 'Beide', done: false }); });
    input.value = '';
    add.classList.remove('ready');
  });
}

// ---- Katzen ---------------------------------------------------------------------
const CAT_DEF = { morgens: ['Morgens', 'Gefüttert', 'Füttern'], abends: ['Abends', 'Gefüttert', 'Füttern'], klo: ['Klo', 'Sauber', 'Reinigen'] };

export function renderCats(now = new Date()) {
  const btns = data.cats.filter((c) => CAT_DEF[c.id]).map((c) => {
    const [label, yes, no] = CAT_DEF[c.id];
    const b = el('button', 'cat-btn');
    b.type = 'button';
    b.setAttribute('role', 'checkbox');
    const done = catDone(c, now);
    b.setAttribute('aria-checked', done ? 'true' : 'false');
    b.dataset.fk = 'cat-' + c.id;
    b.append(el('span', 'cat-label', label), el('span', 'cat-state', done ? yes : no));
    b.addEventListener('click', () => write('cats', (l) => {
      const y = l.find((z) => z.id === c.id);
      if (!y) return;
      const t = new Date();
      y.done = !catDone(y, t);
      if (y.done) y.doneDay = catDay(t); else delete y.doneDay;
    }));
    return b;
  });
  $('cat-checks').replaceChildren(...btns);
}

export function renderVet(now) {
  const vet = getVet();
  if (!vet) { $('vet-text').textContent = 'Kein Termin eingetragen'; return; }
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + vet.offsetDays);
  $('vet-text').textContent = vet.title + ' · ' + DSHORT[d.getDay()] + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + '., ' + vet.time;
}

// ---- Bus -----------------------------------------------------------------------------------------
// Demo: statische Beispieldaten nach festem Takt. Sonst BVG-Abfahrten (oder der Cache).
function demoDepartures(now) {
  const m = now.getMinutes() + now.getSeconds() / 60;
  const raw = [];
  getDepartures().forEach((d) => {
    const first = d.offset + Math.ceil((m - d.offset) / d.every) * d.every;
    for (let j = 0; j < 4; j++) raw.push({ line: d.line, dir: d.dir, metro: d.metro, mins: Math.ceil(first + j * d.every - m) });
  });
  return raw.filter((d) => d.mins - DEMO_WALK_MINUTES >= 0).sort((a, b) => a.mins - b.mins).slice(0, 3)
    .map((d) => Object.assign(d, { left: d.mins - DEMO_WALK_MINUTES, delay: 0 }));
}

export function renderBus(now) {
  const cfg = settings.get().transit;
  const hasStop = DEMO || !!cfg.stopId;
  const stopName = DEMO ? DEMO_STOP_NAME : cfg.stopName;
  const title = stopName ? 'Bus ab ' + stopName : 'Bus';
  $('bus-title').textContent = title;
  $('tile-bus').setAttribute('aria-label', stopName ? 'Abfahrten ' + stopName : 'Abfahrten');
  $('walk-label').textContent = hasStop ? (DEMO ? DEMO_WALK_MINUTES : cfg.walkMinutes) + ' Min zu Fuß' : '';
  if (!hasStop) {
    const box = el('div', 'bus-setup');
    box.append(el('div', 'empty', 'Haltestelle in den Einstellungen wählen'),
      button('btn-gold-s', 'Einstellungen öffnen', () => document.dispatchEvent(new CustomEvent('cockpit:settings')), 'Einstellungen öffnen, Haltestelle wählen', 'bus-config'));
    $('bus-list').replaceChildren(box);
    $('bus-note').hidden = true;
    return;
  }
  const st = getTransitState();
  const usable = DEMO ? null : usableDepartures(st, now.getTime());
  const deps = DEMO ? demoDepartures(now) : buildDepartures(usable, now.getTime(), cfg);
  const rows = deps.map((d) => {
    const row = el('div', 'dep');
    const col = el('span', 'col grow');
    const go = el('span', 'dep-go' + (d.left <= 2 ? ' soon' : ''), d.left === 0 ? 'Jetzt los' : 'Los in ' + d.left + ' Min');
    const dir = el('span', 'dep-dir', d.dir + ' · ' + d.mins + ' Min');
    if (d.delay > 0) go.append(el('span', 'dep-delay', '+' + d.delay));
    col.append(go, dir);
    row.append(el('span', 'line' + (d.metro ? ' metro' : ''), d.line), col);
    return row;
  });
  if (!rows.length) rows.push(el('div', 'empty', DEMO ? 'Abfahrten folgen.' : busMessage(st, usable, false)));
  $('bus-list').replaceChildren(...rows);
  const note = !DEMO && rows.length && st.failures > 0 && st.stamp ? standText(st.stamp) : '';
  $('bus-note').hidden = !note;
  $('bus-note').textContent = note;
}

// ---- Overlay: Kalender oder Sammlung ------------------------------------------------
let opener = null;

export function openOverlay(kind) {
  opener = document.activeElement;
  setUi({ open: kind });
}
export function closeOverlay() {
  setUi({ open: null });
  if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  opener = null;
}

let overlayWasOpen = false;
export function renderOverlay(now) {
  const root = $('overlay');
  const kind = ui.open;
  root.hidden = !kind;
  if (!kind) { overlayWasOpen = false; return; }
  const body = $('ov-body');
  if (kind === 'cal') {
    $('ov-title').textContent = 'Kalender';
    const rows = computeCal(now).cal.map((e) => {
      const row = el('div', 'ov-row');
      row.append(chip(e), el('span', 'ev-title', e.title), el('span', 'ev-when', e.whenAll));
      return row;
    });
    if (!rows.length) rows.push(el('div', 'empty', !DEMO && !getCalendarState().stamp ? 'Noch keine Termine.' : 'Keine Termine in Sicht.'));
    body.replaceChildren(...rows);
  } else {
    $('ov-title').textContent = 'Rezeptsammlung';
    const saved = data.recipes.filter((r) => r.status === 'saved');
    const rows = saved.map((r) => {
      const row = el('div', 'ov-recipe');
      const col = el('span', 'col grow');
      const meta = r.servings + ' ' + (r.yieldText || 'Portionen') + (r.time ? ' · ' + r.time + ' Min' : '') + ' · ' + (r.steps.length ? r.steps.length + ' Schritte' : 'ohne Anleitung');
      col.append(el('span', 'name', r.name), el('span', 'ev-when', meta));
      row.append(col,
        button('btn-ghost', 'Wieder einkaufen', () => rebuy(r.id), 'Wieder einkaufen: ' + r.name, 'rebuy-' + r.id),
        button('btn-gold-s', 'Kochen', () => cookRecipe(r.id), 'Kochen: ' + r.name, 'cooks-' + r.id));
      return row;
    });
    if (!rows.length) rows.push(el('div', 'empty', 'Noch keine Rezepte in der Sammlung.'));
    body.replaceChildren(...rows);
  }
  if (!overlayWasOpen) { overlayWasOpen = true; $('ov-close').focus({ preventScroll: true }); }
}

export function initTiles() {
  $('btn-cal-all').addEventListener('click', () => openOverlay('cal'));
  $('btn-saved').addEventListener('click', () => openOverlay('saved'));
  $('ov-close').addEventListener('click', closeOverlay);
  $('ov-scrim').addEventListener('click', closeOverlay);
  $('btn-today-cook').addEventListener('click', openTodayCook);
  initTaskForm();
}
