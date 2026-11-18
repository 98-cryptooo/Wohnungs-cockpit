// Darstellung der Kacheln und Overlays. Alles per DOM-Methoden und textContent.
import { data, ui, write, setUi, newId, calendarRaw, getDepartures, DEMO_STOP_NAME, DEMO_WALK_MINUTES, DEMO } from './state.js';
import { el, button, icon, pad } from './util.js';
import { cookRecipe, dropRecipe, rebuy } from './cook.js';
import { askConfirm } from './confirm.js';
import { recipeForItem } from './core.js';
import { safeUrl } from './util.js';
import { buildCalendar, getCalendarState, calendarNote, berlinNow } from './calendar.js';
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
  const open = openTile === 'tile-cal';
  $('cal-top').hidden = open;
  $('btn-cal-all').hidden = open;
  renderCalMonth(now);
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

// Eingeklappte Rezepte: Eintraege in der Liste cats mit id "rec-<Schluessel>" (done = eingeklappt).
// So gleicht der Sync den Zustand zwischen Handy und iPad ab.
const recKey = (key) => 'rec-' + key;
function isCollapsed(key) {
  return data.cats.some((c) => c.id === recKey(key) && c.done);
}
function toggleCollapsed(key) {
  write('cats', (l) => {
    const y = l.find((z) => z.id === recKey(key));
    if (y) y.done = !y.done; else l.push({ id: recKey(key), done: true });
  });
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
      const ckey = rec ? 'rec:' + rec.id : 'key:' + key;
      const collapsed = isCollapsed(ckey);
      const openCount = members.filter((i) => !i.x.done).length;
      const tog = el('button', 'sub-toggle');
      tog.type = 'button';
      tog.dataset.fk = 'toggle-' + ckey;
      tog.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      tog.setAttribute('aria-label', 'Rezept ' + title + (collapsed ? ' aufklappen' : ' einklappen') + (collapsed && openCount ? ', ' + openCount + ' offen' : ''));
      const chev = el('span', 'chev', collapsed ? '▸' : '▾');
      chev.setAttribute('aria-hidden', 'true');
      tog.append(chev, icon('book', 14, '#D4B37A'), el('span', 'sub-title', title));
      if (collapsed && openCount) tog.append(el('span', 'sub-count', openCount + ' offen'));
      tog.addEventListener('click', () => toggleCollapsed(ckey));
      sh.append(tog);
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
      if (!collapsed) {
        if (!rec) sub.append(el('div', 'sub-hint', 'Anleitung noch nicht synchronisiert'));
        members.sort(byDone)
          .forEach((i) => sub.append(checkRow(i.x.t, i.x.q, i.x.done, () => toggleShop(i.x.at), 'shop-' + i.x.at)));
      }
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

// Zeichnet eine Aufgabenliste (Woche oder Heute). items sind Teilmengen von data.tasks.
function fillTasks(items, ids) {
  const rows = items.map((x) => {
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
  $(ids.list).replaceChildren(...rows);
  $(ids.empty).hidden = rows.length > 0;
  if (ids.hideDone) {
    // Erledigte Aufgaben stehen nicht in der Liste. Der Zaehler zeigt nur, was noch offen ist.
    $(ids.title).textContent = ids.label + ' · ' + items.length + ' offen';
    $(ids.empty).textContent = ids.all.length ? 'Alles erledigt.' : 'Noch keine Aufgaben. Unten eine hinzufügen.';
  } else {
    $(ids.title).textContent = ids.label + ' · ' + items.filter((x) => x.done).length + '/' + items.length;
  }
}

export function renderTasks() {
  const week = data.tasks.filter((x) => !x.today);
  fillTasks(week.filter((x) => !x.done), { list: 'task-list', empty: 'task-empty', title: 'tasks-title', label: 'Diese Woche', hideDone: true, all: week });
  fillTasks(data.tasks.filter((x) => x.today), { list: 'hd-list', empty: 'hd-empty', title: 'hd-title', label: 'Heute zu tun' });
}

// Eingabe fuer "Heute zu tun": gleiche Liste tasks, Eintrag bekommt today: true.
export function initTodayForm() {
  const input = $('hd-input');
  const add = $('hd-add');
  input.addEventListener('input', () => add.classList.toggle('ready', input.value.trim().length > 0));
  $('hd-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    write('tasks', (l) => { l.push({ id: newId(), text, who: 'Beide', done: false, today: true }); });
    input.value = '';
    add.classList.remove('ready');
  });
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
  } else if (kind === 'leave') {
    renderLeave(body);
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

// Artikel aus dem Cockpit in die Einkaufsliste. write('shop') stoesst den Sync an, Partner-App und Cockpit gleichen ab.
export function initShopForm() {
  const input = $('shop-input');
  const add = $('shop-add');
  input.addEventListener('input', () => add.classList.toggle('ready', input.value.trim().length > 0));
  $('shop-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t) return;
    const g = $('shop-group').value;
    write('shop', (l) => { l.push({ t, done: false, at: newId(), g }); });
    input.value = '';
    add.classList.remove('ready');
  });
}

// ---- Wohnung verlassen: Checkliste ----------------------------------------------------
// Haken: Eintraege in der Liste cats mit id "leave-<Punkt>" (done = erledigt). Der Sync gleicht sie ab.
const LEAVE_ITEMS = [
  ['katzenklo', 'Katzenklo gemacht'],
  ['katzenessen', 'Katzen Essen gegeben'],
  ['licht', 'Licht aus'],
  ['ofen', 'Ofen aus'],
  ['foehn', 'Föhn aus'],
  ['fenster', 'Fenster alle zu']
];

const leaveRows = () => data.cats.filter((c) => c.id.startsWith('leave-'));
function leaveChecked() {
  return new Set(leaveRows().filter((c) => c.done).map((c) => c.id.slice('leave-'.length)));
}
function toggleLeave(id) {
  write('cats', (l) => {
    const y = l.find((z) => z.id === 'leave-' + id);
    if (y) y.done = !y.done; else l.push({ id: 'leave-' + id, done: true });
  });
}
function resetLeave() {
  write('cats', (l) => { l.forEach((z) => { if (z.id.startsWith('leave-')) z.done = false; }); });
}

// Knopf "Wohnung verlassen" wird gruen, wenn alle Punkte der Checkliste erledigt sind.
export function renderLeaveButton() {
  const checked = leaveChecked();
  const all = LEAVE_ITEMS.every(([id]) => checked.has(id));
  const b = $('btn-leave');
  b.classList.toggle('done', all);
  b.setAttribute('aria-label', all ? 'Wohnung verlassen, alles erledigt' : 'Wohnung verlassen');
}

function renderLeave(body) {
  $('ov-title').textContent = 'Wohnung verlassen';
  const checked = leaveChecked();
  const list = el('div', 'leave-list');
  LEAVE_ITEMS.forEach(([id, label]) => {
    list.append(checkRow(label, '', checked.has(id), () => toggleLeave(id), 'leave-' + id));
  });
  const foot = el('div', 'leave-foot');
  foot.append(
    button('btn-ghost', 'Alle zurücksetzen', resetLeave, 'Alle Häkchen zurücksetzen', 'leave-reset'),
    button('btn-gold-s', 'Fertig & Schließen', closeOverlay, 'Fertig und schließen', 'leave-close'));
  body.replaceChildren(list, foot);
}

// ---- Kalender-Monat (aufgeklappt): Monat wechseln, Tag waehlen, Heute ----------------------------
// Nur Ansicht. Monat und gewaehlter Tag gelten fuer diese Sitzung.
let monthView = null; // { y, m } (m = 0 bis 11)
let selDay = null;    // 'YYYY-MM-DD'
const isoOf = (y, m, d) => y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
const calIndex = (name) => { let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 4; };
const allEvents = (now) => (DEMO ? calendarRaw(now) : getCalendarState().events);

function shiftMonth(delta) {
  let { y, m } = monthView;
  m += delta;
  while (m < 0) { m += 12; y--; }
  while (m > 11) { m -= 12; y++; }
  monthView = { y, m };
  selDay = isoOf(y, m, 1);
  keepFocus(() => renderCalMonth(new Date()));
}
function goToday(now) {
  const t = berlinNow(now).date;
  const [y, m] = t.split('-').map(Number);
  monthView = { y, m: m - 1 };
  selDay = t;
  keepFocus(() => renderCalMonth(now));
}

export function renderCalMonth(now = new Date()) {
  const root = $('cal-month');
  if (!root) return;
  root.hidden = openTile !== 'tile-cal';
  if (root.hidden) return;
  const today = berlinNow(now).date;
  if (!monthView) { const [y, m] = today.split('-').map(Number); monthView = { y, m: m - 1 }; }
  if (!selDay) selDay = today;
  const { y, m } = monthView;
  const byDay = {};
  allEvents(now).forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });

  const head = el('div', 'cal-mhead');
  head.append(el('h3', 'cal-mtitle', MONTHS[m] + ' ' + y),
    button('btn-ghost cal-navbtn', '‹', () => shiftMonth(-1), 'Vorheriger Monat', 'cal-prev'),
    button('btn-ghost cal-navbtn', '›', () => shiftMonth(1), 'Nächster Monat', 'cal-next'),
    button('btn-gold-s', 'Heute', () => goToday(now), 'Heute anzeigen', 'cal-today'));

  const grid = el('div', 'cal-grid');
  ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].forEach((w) => grid.append(el('span', 'cal-wd', w)));
  const offset = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // Montag ist die erste Spalte
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  for (let i = 0; i < offset; i++) grid.append(el('span', 'cal-empty'));
  for (let d = 1; d <= days; d++) {
    const iso = isoOf(y, m, d);
    const evs = byDay[iso] || [];
    const b = el('button', 'cal-day');
    b.type = 'button';
    b.dataset.fk = 'cal-' + iso;
    if (iso === today) b.classList.add('is-today');
    if (iso === selDay) b.classList.add('is-sel');
    b.setAttribute('aria-pressed', iso === selDay ? 'true' : 'false');
    b.setAttribute('aria-label', d + '. ' + MONTHS[m] + (evs.length ? ', ' + evs.length + ' Termine' : ''));
    const dots = el('span', 'cal-dots');
    evs.slice(0, 3).forEach((e) => dots.append(el('span', 'cal-dot c' + calIndex(e.cal))));
    b.append(el('span', 'cal-num', String(d)), dots);
    b.addEventListener('click', () => { selDay = iso; keepFocus(() => renderCalMonth(new Date())); });
    grid.append(b);
  }

  const [sy, sm, sd] = selDay.split('-').map(Number);
  const wd = DAYS[new Date(Date.UTC(sy, sm - 1, sd)).getUTCDay()];
  const list = el('div', 'cal-dayev');
  list.append(el('h4', 'cal-dayh', wd + ', ' + sd + '. ' + MONTHS[sm - 1]));
  const dayEvs = (byDay[selDay] || []).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  if (!dayEvs.length) list.append(el('div', 'empty', 'Keine Termine.'));
  dayEvs.forEach((e) => {
    const row = el('div', 'cal-ev');
    row.append(el('span', 'cal-bar c' + calIndex(e.cal)));
    const col = el('span', 'col grow');
    col.append(el('span', 'ev-title', e.title), el('span', 'ev-when', e.cal || ''));
    row.append(col, el('span', 'ev-when cal-time', e.time ? e.time + ' Uhr' : 'Ganztägig'));
    list.append(row);
  });
  root.replaceChildren(head, grid, list);
}

// ---- Aufklappen: eine Kachel wird gross, die anderen rutschen zur Seite (verdraengen) -----------------
// Nur Ansicht, pro Geraet gespeichert, nie synchronisiert. Die Kachel steht im Attribut data-open von #day.
const EXPANDABLE = ['tile-cal', 'tile-shop', 'tile-today', 'tile-tasks'];
const OPEN_KEY = 'wohnungs-cockpit.open';
let openTile = null;
try { const v = localStorage.getItem(OPEN_KEY); if (EXPANDABLE.includes(v)) openTile = v; } catch (e) { /* ignorieren */ }

const SVG_NS = 'http://www.w3.org/2000/svg';
function expandIcon(on) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('width', '18');
  s.setAttribute('height', '18');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', on ? 'M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7' : 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7');
  s.append(p);
  return s;
}

function applyOpenTile() {
  $('day').dataset.open = openTile || '';
  const calOpen = openTile === 'tile-cal';
  $('cal-top').hidden = calOpen;
  $('btn-cal-all').hidden = calOpen;
  renderCalMonth(new Date());
  EXPANDABLE.forEach((id) => {
    const on = id === openTile;
    const tile = $(id);
    tile.classList.toggle('is-open', on);
    const b = tile.querySelector('.expand');
    if (!b) return;
    b.setAttribute('aria-expanded', on ? 'true' : 'false');
    b.setAttribute('aria-label', on ? 'Kachel wieder verkleinern' : 'Kachel vergrößern');
    b.replaceChildren(expandIcon(on));
  });
}

export function initExpand() {
  EXPANDABLE.forEach((id) => {
    const tile = $(id);
    const head = tile.querySelector(':scope > .tile-head, :scope > .tile-head-base');
    if (!head) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'expand';
    b.dataset.fk = 'expand-' + id;
    b.addEventListener('click', () => {
      openTile = openTile === id ? null : id;
      try { if (openTile) localStorage.setItem(OPEN_KEY, openTile); else localStorage.removeItem(OPEN_KEY); } catch (e) { /* ignorieren */ }
      applyOpenTile();
    });
    head.append(b);
  });
  applyOpenTile();
}

export function initTiles() {
  $('btn-cal-all').addEventListener('click', () => openOverlay('cal'));
  $('btn-leave').addEventListener('click', () => openOverlay('leave'));
  initTodayForm();
  initShopForm();
  $('btn-saved').addEventListener('click', () => openOverlay('saved'));
  $('ov-close').addEventListener('click', closeOverlay);
  $('ov-scrim').addEventListener('click', closeOverlay);
  initTaskForm();
}
