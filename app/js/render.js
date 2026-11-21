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
import { WHO, EVERY_OPTIONS, REMIND_OPTIONS, isRecurring, newTask, applyPlan, completeRecurring, undoLast, toggleOnce, taskState, isForToday, sortTasks, doneOnce, everyLabel, shortDate, nextDue } from './tasks.js';

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
  const n = cal[0];
  setPreview('pv-cal', n ? 'Nächster: ' + n.day + ' · ' + n.title + (n.when ? ' · ' + n.when : '') : 'Keine Termine in Sicht');
  renderCalMonth(now);
  scheduleFit();
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
  const openItems = items.filter((i) => !i.x.done);
  const perStore = STORES.map(([k, name]) => [name, openItems.filter((i) => i.store === k).length]).filter(([, c]) => c > 0);
  setPreview('pv-shop', openItems.length
    ? openItems.length + ' offen · ' + perStore.map(([name, c]) => (name === 'Lebensmittelmarkt' ? 'Lebensmittel' : name) + ' ' + c).join(' · ')
    : (items.length ? 'Alles erledigt' : 'Liste leer'));
  scheduleFit();
}

// ---- Aufgaben -------------------------------------------------------------------
// Logik (Wiederholung, Faelligkeit, Verlauf) in tasks.js. Hier nur Anzeige und Bedienung.
const WHO_CLASS = { Rik: 'who-rik', Melina: 'who-melina', Beide: 'who-beide' };
const todayNow = () => berlinNow(new Date());
const findTask = (l, id) => l.find((z) => String(z.id) === String(id));

// Abhaken: wiederkehrend fragt nach der Person, einmalig wechselt nur den Haken
function tapTask(x) {
  if (isRecurring(x)) { openOverlay('who:' + x.id); return; }
  write('tasks', (l) => { const y = findTask(l, x.id); if (y) toggleOnce(y, todayNow().date); });
}

// Loeschen: Offenes und Wiederkehrendes nur nach Rueckfrage (versehentliches Loeschen vermeiden)
async function deleteTask(x, what = 'Aufgabe') {
  const open = isRecurring(x) || !x.done;
  if (open && !(await askConfirm('"' + x.text + '" wirklich löschen?' + (isRecurring(x) ? ' Der Verlauf geht mit verloren.' : ''), what + ' löschen'))) return false;
  write('tasks', (l) => l.filter((z) => String(z.id) !== String(x.id)));
  return true;
}

function taskCheck(x, st, fk) {
  const b = el('button', 'check');
  b.type = 'button';
  if (isRecurring(x)) b.setAttribute('aria-haspopup', 'dialog');
  else { b.setAttribute('role', 'checkbox'); b.setAttribute('aria-checked', x.done ? 'true' : 'false'); }
  b.dataset.fk = fk;
  const box = el('span', 'box' + (isRecurring(x) ? ' box-round' : '')); box.setAttribute('aria-hidden', 'true');
  const col = el('span', 'tcol');
  col.append(el('span', 'label', x.text));
  const meta = [st.label, isRecurring(x) ? everyLabel(x.every) : ''].filter(Boolean).join(' · ');
  if (meta) col.append(el('span', 'tmeta k-' + st.kind, meta));
  b.append(box, col);
  b.setAttribute('aria-label', x.text + (meta ? ', ' + meta : '') + (isRecurring(x) ? ', antippen und Person wählen' : ''));
  b.addEventListener('click', () => tapTask(x));
  return b;
}

// Zeichnet eine Aufgabenliste (Woche oder Heute). items sind Teilmengen von data.tasks.
function fillTasks(items, ids, now) {
  const rows = items.map((x) => {
    const st = taskState(x, now);
    const row = el('div', 'task' + (st.kind === 'overdue' ? ' is-overdue' : ''));
    row.append(taskCheck(x, st, ids.fk + x.id));
    if (!isRecurring(x)) {
      row.append(button('who ' + (WHO_CLASS[x.who] || 'who-beide'), x.who,
        () => write('tasks', (l) => { const y = findTask(l, x.id); if (y) y.who = WHO[(WHO.indexOf(y.who) + 1) % WHO.length]; }),
        'Zuständig: ' + x.who + '. Tippen zum Wechseln', ids.fk + 'who-' + x.id));
    }
    const edit = button('del', null, () => openOverlay('task:' + x.id), 'Planen und Verlauf: ' + x.text, ids.fk + 'edit-' + x.id);
    edit.append(icon('edit', 18));
    const del = button('del del-x', null, () => deleteTask(x), 'Aufgabe löschen: ' + x.text, ids.fk + 'del-' + x.id);
    del.append(icon('close', 16));
    row.append(edit, del);
    return row;
  });
  $(ids.list).replaceChildren(...rows);
  $(ids.empty).hidden = rows.length > 0;
}

export function renderTasks(nowDate) {
  const now = berlinNow(nowDate || new Date());
  const tasks = data.tasks.filter((x) => !x.note);
  // Diese Woche: alles ohne today-Markierung, Erledigtes (einmalig) ausgeblendet, Ueberfaelliges oben
  const week = tasks.filter((x) => !x.today || isRecurring(x));
  const weekOpen = sortTasks(week.filter((x) => isRecurring(x) || !x.done), now);
  fillTasks(weekOpen, { list: 'task-list', empty: 'task-empty', fk: 'task-' }, now);
  const over = weekOpen.filter((x) => taskState(x, now).kind === 'overdue').length;
  const dueNow = weekOpen.filter((x) => ['overdue', 'today', 'none'].includes(taskState(x, now).kind)).length;
  $('tasks-count').textContent = over ? over + ' überfällig' : dueNow + ' offen';
  $('tasks-count').classList.toggle('is-over', over > 0);
  $('task-empty').textContent = week.length ? 'Alles erledigt.' : 'Noch keine Aufgaben. Unten eine hinzufügen oder planen.';
  setPreview('pv-tasks', weekOpen.length ? (over ? over + ' überfällig · ' : '') + dueNow + ' offen' + (weekOpen[0] ? ' · ' + weekOpen[0].text : '') : (week.length ? 'Alles erledigt' : 'Keine Aufgaben'));
  // Erledigt (nur in der grossen Ansicht sichtbar): einmalige Aufgaben, neueste zuerst
  const done = doneOnce(tasks).slice(0, 30);
  const doneRows = done.map((x) => {
    const row = el('div', 'task');
    row.append(taskCheck(x, taskState(x, now), 'done-' + x.id));
    const del = button('del', null, () => deleteTask(x), 'Aufgabe löschen: ' + x.text, 'done-del-' + x.id);
    del.append(icon('close', 16));
    row.append(del);
    return row;
  });
  $('task-done-list').replaceChildren(...doneRows);
  $('task-done').hidden = !doneRows.length;
  // Heute zu tun: today-Eintraege wie bisher, dazu alles, was heute faellig oder ueberfaellig ist
  const today = sortTasks(tasks.filter((x) => isForToday(x, now)), now);
  fillTasks(today, { list: 'hd-list', empty: 'hd-empty', fk: 'hd-' }, now);
  const todayOpen = today.filter((x) => isRecurring(x) || !x.done);
  $('hd-title').textContent = 'Heute zu tun · ' + (today.length - todayOpen.length) + '/' + today.length;
  setPreview('pv-today', todayOpen.length ? todayOpen.length + ' offen · ' + todayOpen[0].text : (today.length ? 'Alles erledigt' : 'Nichts für heute'));
  scheduleFit();
}

// Notizen (note: true) gibt es seit 3.1 nicht mehr in der Oberflaeche. Alte Eintraege bleiben in den Daten,
// werden aber nirgends angezeigt (alle Aufgabenlisten filtern note heraus).

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

let planDraft = '';
export function initTaskForm() {
  const input = $('task-input');
  const add = $('task-add');
  // Planen: oeffnet den Dialog fuer Wiederholung, Datum, Uhrzeit, Erinnerung. Schon getippter Text wird uebernommen.
  $('btn-plan').addEventListener('click', () => {
    planDraft = input.value.trim();
    input.value = '';
    add.classList.remove('ready');
    openOverlay('task:new');
  });
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

// ---- Dialog: Wer hat erledigt? -------------------------------------------------------------------
function renderWho(body, id) {
  const x = findTask(data.tasks, id);
  $('ov-title').textContent = 'Wer hat es erledigt?';
  if (!x) { body.replaceChildren(el('div', 'empty', 'Diese Aufgabe gibt es nicht mehr.')); return; }
  const btns = el('div', 'who-pick');
  WHO.forEach((w) => btns.append(button('who who-big ' + WHO_CLASS[w], w, () => {
    write('tasks', (l) => { const y = findTask(l, id); if (y && isRecurring(y)) completeRecurring(y, w, todayNow().date); });
    closeOverlay();
  }, w + ' hat es erledigt', 'who-pick-' + w)));
  const next = nextDue(todayNow().date, x.every);
  body.replaceChildren(el('p', 'set-text', x.text), btns,
    el('p', 'hint', 'Nächstes Mal fällig: ' + (next ? shortDate(next) : '') + ' (' + everyLabel(x.every) + ' ab heute)'));
}

// ---- Dialog: Aufgabe planen oder bearbeiten ------------------------------------------------------
function field(labelText, control) {
  const f = el('label', 'set-field');
  f.append(el('span', 'set-label', labelText), control);
  return f;
}
function selectOf(options, value, fk) {
  const s = el('select', 'set-input');
  s.dataset.fk = fk;
  options.forEach(([v, label]) => {
    const o = el('option', null, label);
    o.value = v === null ? '' : String(v);
    if (String(v === null ? '' : v) === String(value === undefined || value === null ? '' : value)) o.selected = true;
    s.append(o);
  });
  return s;
}
function inputOf(type, value, fk, extra) {
  const i = el('input', 'set-input');
  i.type = type;
  i.value = value || '';
  i.dataset.fk = fk;
  Object.assign(i, extra || {});
  return i;
}

function renderPlan(body, id) {
  const isNew = id === 'new';
  const x = isNew ? null : findTask(data.tasks, id);
  $('ov-title').textContent = isNew ? 'Aufgabe planen' : 'Aufgabe bearbeiten';
  if (!isNew && !x) { body.replaceChildren(el('div', 'empty', 'Diese Aufgabe gibt es nicht mehr.')); return; }
  const text = inputOf('text', isNew ? planDraft : x.text, 'plan-text', { maxLength: 60, placeholder: 'z. B. Bad putzen', autocomplete: 'off' });
  const every = selectOf([[null, 'Nicht wiederholen'], ...EVERY_OPTIONS], x ? x.every : null, 'plan-every');
  const due = inputOf('date', x ? x.due : '', 'plan-due');
  const time = inputOf('time', x ? x.time : '', 'plan-time');
  const remind = selectOf(REMIND_OPTIONS, x ? x.remind : null, 'plan-remind');
  const dueField = field('', due);
  const remindField = field('', remind);
  // Startwerte merken: gespeichert wird nur, was hier geaendert wurde (sonst ueberschreibt der Dialog den Sync)
  const init = { text: text.value, every: every.value, due: due.value, time: time.value, remind: remind.value };
  const msg = el('p', 'set-msg');
  msg.setAttribute('role', 'status');
  const sync = () => {
    const rec = every.value !== '';
    dueField.firstChild.textContent = rec ? 'Nächstes Mal fällig (leer = heute)' : 'Fällig am (optional)';
    remind.disabled = !time.value;
    remindField.firstChild.textContent = time.value ? 'Erinnerung im Cockpit' : 'Erinnerung (braucht Uhrzeit)';
  };
  every.addEventListener('change', sync);
  time.addEventListener('input', sync);
  time.addEventListener('change', sync);
  sync();

  const parts = [field('Aufgabe', text), field('Wiederholen', every), dueField];
  const row = el('div', 'plan-row');
  row.append(field('Uhrzeit (optional)', time), remindField);
  parts.push(row);

  if (x && isRecurring(x)) {
    // Verlauf: die letzten 5 Durchgaenge. Zuruecknehmen baut nur diesen Block neu, Eingaben oben bleiben stehen.
    const hist = el('div', 'plan-hist');
    const drawHist = () => {
      const cur = findTask(data.tasks, id);
      const log = cur && Array.isArray(cur.log) ? cur.log : [];
      const rows = [el('span', 'set-label', 'Verlauf' + (log.length > 5 ? ' (letzte 5 von ' + log.length + ')' : ''))];
      if (!log.length) rows.push(el('p', 'hint', 'Noch nie erledigt.'));
      log.slice(0, 5).forEach((e, i) => {
        const r = el('div', 'hist-row');
        r.append(el('span', 'hist-date', shortDate(e.at)), el('span', 'who ' + (WHO_CLASS[e.by] || 'who-beide'), e.by));
        if (i === 0) r.append(button('btn-link', 'Zurücknehmen', () => {
          write('tasks', (l) => { const y = findTask(l, id); if (y) undoLast(y); });
          const y = findTask(data.tasks, id);
          if (y && y.due && due.value === init.due) { due.value = y.due; init.due = y.due; }
          drawHist();
          const f = hist.querySelector('[data-fk="plan-undo"]') || due;
          f.focus({ preventScroll: true });
        }, 'Letzten Durchgang zurücknehmen', 'plan-undo'));
        rows.push(r);
      });
      hist.replaceChildren(...rows);
    };
    drawHist();
    parts.push(hist);
  }

  const foot = el('div', 'leave-foot');
  if (x) foot.append(button('btn-link btn-danger', 'Löschen', async () => { if (await deleteTask(x)) closeOverlay(); }, 'Aufgabe löschen', 'plan-del'));
  foot.append(button('btn-ghost', 'Abbrechen', closeOverlay, 'Abbrechen', 'plan-cancel'),
    button('btn-gold-s', 'Speichern', () => {
      const val = { text: text.value, every: every.value, due: due.value, time: time.value, remind: remind.value };
      const input = {};
      Object.keys(val).forEach((k) => { if (isNew || val[k] !== init[k]) input[k] = val[k] === '' ? null : val[k]; });
      if (isNew && input.text == null) input.text = '';
      if (!String(text.value).trim()) { msg.textContent = 'Bitte einen Namen für die Aufgabe eingeben.'; text.focus(); return; }
      const d = todayNow().date;
      if (isNew) write('tasks', (l) => { l.push(newTask(newId(), input, d)); });
      else write('tasks', (l) => { const y = findTask(l, id); if (y) applyPlan(y, input, d); });
      planDraft = '';
      closeOverlay();
    }, 'Speichern', 'plan-save'));
  body.replaceChildren(...parts, msg, foot);
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
    setPreview('pv-bus', 'Haltestelle wählen');
    scheduleFit();
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
  const d0 = deps[0];
  setPreview('pv-bus', d0 ? d0.line + ' · ' + (d0.left === 0 ? 'Jetzt los' : 'Los in ' + d0.left + ' Min') + ' · ' + d0.dir : 'Keine Abfahrten');
  scheduleFit();
}

// ---- Overlay: Kalender oder Sammlung ------------------------------------------------
let opener = null;
let openerFk = null; // Zeilen werden nach write() neu gebaut: dann den Knopf ueber data-fk wiederfinden

export function openOverlay(kind) {
  builtKind = null;
  opener = document.activeElement;
  openerFk = opener && opener.dataset ? opener.dataset.fk || null : null;
  setUi({ open: kind });
}
export function closeOverlay() {
  builtKind = null;
  setUi({ open: null });
  const back = opener && opener.isConnected ? opener
    : (openerFk ? document.querySelector('[data-fk="' + CSS.escape(openerFk) + '"]') : null);
  if (back) back.focus({ preventScroll: true });
  opener = null;
  openerFk = null;
}

let overlayWasOpen = false;
let builtKind = null;
export function renderOverlay(now) {
  const root = $('overlay');
  const kind = ui.open;
  root.hidden = !kind;
  if (!kind) { overlayWasOpen = false; builtKind = null; return; }
  const body = $('ov-body');
  // Aufgaben-Dialoge nur beim Oeffnen bauen, sonst verliert der Minutentakt die Eingaben
  if (kind.startsWith('task:') || kind.startsWith('who:')) {
    if (builtKind !== kind) {
      builtKind = kind;
      if (kind.startsWith('who:')) renderWho(body, kind.slice(4)); else renderPlan(body, kind.slice(5));
    }
  } else if (kind === 'cal') {
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
  if (!overlayWasOpen) {
    overlayWasOpen = true;
    const first = kind === 'task:new' ? body.querySelector('[data-fk="plan-text"]') : null;
    (first || $('ov-close')).focus({ preventScroll: true });
  }
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
export const calIndex = (name) => { let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 4; };
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

// ---- Kachel-Zustaende: normal, eingeklappt (Vorschau), gross (Fokusansicht) ---------------------------
// Nur Ansicht, nie synchronisiert. Das Raster aendert sich nie, dadurch kann sich nichts ueberlappen:
// - Eingeklappt (is-min, per Tipp auf den Titel, pro Geraet gespeichert): nur Kopf und Vorschau-Zeile.
// - Kompakt (is-auto, nur Querformat): reicht der Platz in einer Spalte nicht, zeigt die Kachel mit dem
//   wenigsten Inhalt von selbst ihre Vorschau. Wird bei jeder Aenderung neu berechnet.
// - Gross (is-open): die Kachel wandert in die Fokusansicht ueber dem Raster, an ihrem Platz bleibt ein Platzhalter.
const EXPANDABLE = ['tile-cal', 'tile-shop', 'tile-today', 'tile-tasks'];
const MINIMIZABLE = ['tile-bus', 'tile-today', 'tile-cal', 'tile-tasks', 'tile-shop'];
const MIN_KEY = 'wohnungs-cockpit.min';
const LANDSCAPE = window.matchMedia('(min-width: 1100px) and (min-height: 700px)');
let openTile = null;
let placeholder = null;
let focusOpener = null;
let lastTouched = null;
let minimized = new Set();
try { const v = JSON.parse(localStorage.getItem(MIN_KEY) || '[]'); if (Array.isArray(v)) minimized = new Set(v.filter((x) => MINIMIZABLE.includes(x))); } catch (e) { /* ignorieren */ }
try { localStorage.removeItem('wohnungs-cockpit.open'); } catch (e) { /* alter Zustand aus 2.8 bis 2.11 */ }

export const isFocusOpen = () => !!openTile;

function setPreview(id, text) {
  const n = $(id);
  if (n) n.textContent = text;
}

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

const tileName = (tile) => tile.getAttribute('aria-label') || 'Kachel';

function applyTileState() {
  MINIMIZABLE.forEach((id) => {
    const tile = $(id);
    const min = minimized.has(id) && id !== openTile;
    tile.classList.toggle('is-min', min);
    const b = tile.querySelector('.min-btn');
    if (!b) return;
    const shut = min || tile.classList.contains('is-auto');
    b.setAttribute('aria-expanded', shut ? 'false' : 'true');
    b.setAttribute('aria-label', tileName(tile) + (shut ? ' aufklappen' : ' einklappen'));
  });
  EXPANDABLE.forEach((id) => {
    const on = id === openTile;
    const tile = $(id);
    tile.classList.toggle('is-open', on);
    const b = tile.querySelector('.expand');
    if (!b) return;
    b.setAttribute('aria-expanded', on ? 'true' : 'false');
    b.setAttribute('aria-label', on ? tileName(tile) + ' wieder klein' : tileName(tile) + ' groß öffnen');
    b.replaceChildren(expandIcon(on));
  });
  const calOpen = openTile === 'tile-cal';
  $('cal-top').hidden = calOpen;
  $('btn-cal-all').hidden = calOpen;
  // Monat nur neu bauen, wenn der Kalender gerade auf- oder zugeht (sonst verliert die Monatsansicht den Fokus)
  if (calOpen !== calWasOpen) { calWasOpen = calOpen; renderCalMonth(new Date()); }
}
let calWasOpen = false;

// Querformat: pro Spalte pruefen, ob jede Kachel genug Platz hat. Wenn nicht, wird nacheinander die Kachel
// mit dem wenigsten Inhalt kompakt (die zuletzt angetippte nie zuerst, dann leere, dann der Bus,
// dessen Vorschau die naechste Abfahrt zeigt), bis alles passt.
const LIST_SEL = '.scroll, .bus-list, .cal-top';
const ROOM = 96; // Mindestplatz fuer die Liste (knapp zwei Zeilen)
function listOf(tile) { return tile.querySelector(':scope > ' + LIST_SEL.split(', ').join(', :scope > ')); }
function contentSize(tile) { const l = listOf(tile); return l ? l.scrollHeight : 0; }
function isEmptyTile(tile) { const e = tile.querySelector(':scope > .empty'); return !!e && !e.hidden; }
// Platz, den eine Kachel mindestens braucht: Kopf, Eingabe usw. plus bis zu zwei Zeilen ihrer Liste
function needOf(tile) {
  const l = listOf(tile);
  if (!l) return tile.offsetHeight;
  return tile.scrollHeight + (tile.offsetHeight - tile.clientHeight) - l.clientHeight + Math.min(l.scrollHeight, ROOM);
}

function fitStacks() {
  document.querySelectorAll('.tile.is-auto').forEach((t) => t.classList.remove('is-auto'));
  document.querySelectorAll('#day .stack > .tile').forEach((t) => { t.style.minHeight = ''; });
  if (LANDSCAPE.matches && !$('day').hidden) {
    document.querySelectorAll('#day > .stack').forEach((stack) => {
      const kids = [...stack.children].filter((t) => t.offsetParent);
      const cands = kids.filter((t) => MINIMIZABLE.includes(t.id) && !t.classList.contains('is-min'));
      const gap = parseFloat(getComputedStyle(stack).rowGap) || 0;
      const live = (t) => cands.includes(t) && !t.classList.contains('is-auto');
      for (let i = 0; i <= cands.length; i++) {
        const total = kids.reduce((sum, t) => sum + (live(t) ? needOf(t) : t.offsetHeight), 0) + gap * (kids.length - 1);
        if (total <= stack.clientHeight + 1) break;
        const rest = cands.filter(live);
        if (!rest.length) break;
        rest.sort((a, b) => ((a.id === lastTouched) - (b.id === lastTouched)) || (isEmptyTile(b) - isEmptyTile(a)) || ((b.id === 'tile-bus') - (a.id === 'tile-bus')) || (contentSize(a) - contentSize(b)));
        rest[0].classList.add('is-auto');
      }
      // Was offen bleibt, schrumpft nie unter seinen Mindestplatz. Den Rest bekommt die Kachel mit der laengsten Liste.
      const needs = cands.filter(live).map((t) => [t, needOf(t)]);
      needs.forEach(([t, n]) => { t.style.minHeight = n + 'px'; });
    });
  }
  applyTileState();
}

let fitQueued = false;
export function scheduleFit() {
  if (fitQueued) return;
  fitQueued = true;
  // Nach dem laufenden Neuzeichnen, aber vor dem Malen (Mikrotask): kein Flackern, auch im Hintergrund zuverlaessig
  queueMicrotask(() => { fitQueued = false; fitStacks(); });
}

function toggleMin(id) {
  lastTouched = id;
  const tile = $(id);
  // Kompakte Kachel antippen: sie bekommt Vorrang und klappt auf, eine andere wird kompakt. Passt sie gar nicht, gross oeffnen.
  if (tile.classList.contains('is-auto') && !minimized.has(id)) {
    fitStacks();
    if ($(id).classList.contains('is-auto')) openFocus(id);
    return;
  }
  if (minimized.has(id)) minimized.delete(id); else minimized.add(id);
  try { localStorage.setItem(MIN_KEY, JSON.stringify([...minimized])); } catch (e) { /* ignorieren */ }
  fitStacks();
}

export function openFocus(id) {
  if (!EXPANDABLE.includes(id)) { if (minimized.has(id)) toggleMin(id); return; }
  if (openTile === id) return;
  if (openTile) closeFocus(true);
  const tile = $(id);
  focusOpener = document.activeElement;
  // Platzhalter mit gleicher Hoehe und Reihenfolge: das Raster dahinter bleibt genau so stehen
  placeholder = el('div', 'tile tile-ph');
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.style.order = getComputedStyle(tile).order;
  placeholder.style.flex = '0 0 ' + tile.getBoundingClientRect().height + 'px';
  tile.style.minHeight = '';
  placeholder.append(el('span', 'h', tileName(tile)), el('span', 'hint', 'Groß geöffnet'));
  tile.replaceWith(placeholder);
  $('focus-card').replaceChildren(tile);
  $('focus-card').setAttribute('aria-label', tileName(tile));
  openTile = id;
  $('focus').hidden = false;
  $('day').inert = true;
  tile.classList.remove('is-auto');
  applyTileState();
  scheduleFit();
  document.dispatchEvent(new CustomEvent('cockpit:focus'));
  const b = tile.querySelector('.expand');
  if (b) b.focus({ preventScroll: true });
}

export function closeFocus(silent) {
  if (!openTile) return;
  const tile = $(openTile);
  if (placeholder && placeholder.isConnected) placeholder.replaceWith(tile);
  placeholder = null;
  openTile = null;
  $('focus').hidden = true;
  $('day').inert = false;
  if (!silent) document.dispatchEvent(new CustomEvent('cockpit:focus'));
  fitStacks();
  if (!silent) {
    const back = focusOpener && focusOpener.isConnected ? focusOpener : tile.querySelector('.expand');
    if (back) back.focus({ preventScroll: true });
  }
  focusOpener = null;
}

export function initExpand() {
  EXPANDABLE.forEach((id) => {
    const tile = $(id);
    const head = tile.querySelector(':scope > .tile-head');
    if (!head) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'expand';
    b.dataset.fk = 'expand-' + id;
    b.addEventListener('click', () => { lastTouched = id; if (openTile === id) closeFocus(); else openFocus(id); });
    head.append(b);
  });
  MINIMIZABLE.forEach((id) => {
    const tile = $(id);
    const b = tile.querySelector('.min-btn');
    if (b) { b.dataset.fk = 'min-' + id; b.addEventListener('click', () => { if (openTile !== id) toggleMin(id); }); }
    const pv = tile.querySelector('.preview');
    if (pv) {
      pv.dataset.fk = 'pv-' + id;
      pv.addEventListener('click', () => {
        if (minimized.has(id) || tile.classList.contains('is-auto')) {
          toggleMin(id);
          // Die Vorschau verschwindet, der Fokus geht auf den Titel-Knopf statt ins Leere
          if (!openTile && b) b.focus({ preventScroll: true });
        } else openFocus(id);
      });
    }
  });
  $('focus-scrim').addEventListener('click', () => closeFocus());
  LANDSCAPE.addEventListener('change', scheduleFit);
  window.addEventListener('resize', scheduleFit);
  if (window.ResizeObserver) new ResizeObserver(scheduleFit).observe($('day'));
  applyTileState();
  scheduleFit();
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
