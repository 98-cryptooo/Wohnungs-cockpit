// Einstieg: verdrahtet Zustand, Anzeige, Uhr, Skalierung, Wake Lock und Service Worker.
import './js/household.js'; // zuerst: entfernt #join aus der Adresse, bevor irgendetwas anderes laeuft
import { subscribe, ui, DEMO } from './js/state.js';
import { keepFocus, renderClock, renderCalTop, renderWeather, renderShop, renderTasks, renderBus, renderLeaveButton, renderOverlay, closeOverlay, initTiles, initExpand, isFocusOpen, closeFocus } from './js/render.js';
import { renderCook, initCook, updateTimerView, isCookOpen, closeCook } from './js/cook.js';
import { isNight, renderNight, peek } from './js/night.js';
import { initConfirm, isConfirmOpen } from './js/confirm.js';
import { initWakeLock } from './js/wake.js';
import { initStandby, standbyTick, isStandby, renderStandby } from './js/standby.js';
import { initSetup, boot, syncSoon } from './js/setup.js';
import { settings } from './js/settings.js';
import { startLive, refreshLive } from './js/live.js';
import { initReminders, checkReminders } from './js/reminders.js';

const $ = (id) => document.getElementById(id);

function applyMode(now) {
  const night = isNight(now);
  $('night').hidden = !night;
  $('day').hidden = night;
  if (night) {
    closeFocus(true);
    $('overlay').hidden = true;
    $('cook').hidden = true;
    $('standby').hidden = true;
    renderNight(now);
    return;
  }
  // Standby liegt ueber allem (ausser Ersteinrichtung), das Cockpit darunter bleibt wie es war
  $('standby').hidden = !isStandby();
  if (isStandby()) renderStandby(now);
  renderOverlay(now);
  renderCook();
  // Hintergrund nicht bedienbar, solange ein Dialog offen ist (die Fokusansicht zaehlt fuer das Raster mit)
  const dialog = !!ui.open || isCookOpen() || !$('setup').hidden || !$('settings').hidden || isStandby();
  $('day').inert = dialog || isFocusOpen();
  $('focus').inert = dialog;
}

function renderEverything(now) {
  renderClock(now);
  renderCalTop(now);
  renderWeather(now);
  renderShop();
  renderTasks();
  renderLeaveButton();
  renderBus(now);
  applyMode(now);
}

let lastMinute = -1;
let lastNight = null;
let lastBus = 0;
function onTick(force) {
  const now = new Date();
  const night = isNight(now);
  if (ui.timer && !night) updateTimerView();
  // Abfahrten, die man nicht mehr schafft, spaetestens nach 15 s ausblenden (nur solange sichtbar)
  if (!night && document.visibilityState === 'visible' && Date.now() - lastBus >= 15000) { lastBus = Date.now(); renderBus(now); }
  const standbyChanged = standbyTick(night || isCookOpen() || !$('setup').hidden);
  const key = now.getHours() * 60 + now.getMinutes();
  if (!force && !standbyChanged && key === lastMinute && night === lastNight) return;
  lastMinute = key;
  lastNight = night;
  keepFocus(() => {
    renderClock(now);
    renderCalTop(now);
    renderWeather(now);
    renderBus(now);
    renderTasks(now); // Faelligkeit und Ueberfaelliges wechseln mit der Uhrzeit
    applyMode(now);
  });
  checkReminders(now);
}

subscribe((topic) => {
  const now = new Date();
  keepFocus(() => {
    switch (topic) {
      case 'shop': renderShop(); break;
      case 'recipes': renderShop(); applyMode(now); break;
      case 'tasks': renderTasks(); checkReminders(now); break;
      case 'weather': renderWeather(now); applyMode(now); break;
      case 'transit': renderBus(now); break;
      case 'cal': renderCalTop(now); applyMode(now); break;
      case 'ui': applyMode(now); break;
      default: renderEverything(now);
    }
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || isConfirmOpen()) return;
  if (ui.open) closeOverlay();
  else if (isCookOpen()) closeCook();
  else if (isFocusOpen() && $('settings').hidden && $('setup').hidden) closeFocus();
});
document.addEventListener('cockpit:focus', () => applyMode(new Date()));

settings.subscribe(() => { // Wetterort, Haltestelle oder Fussweg geaendert: sofort neu zeichnen
  const now = new Date();
  keepFocus(() => { renderWeather(now); renderBus(now); applyMode(now); });
});

initTiles();
initExpand();
initCook();
initConfirm();
initSetup();
initStandby(() => applyMode(new Date()));
initReminders();
$('night').addEventListener('click', () => { peek(); onTick(true); });
renderEverything(new Date());
onTick(true);
setInterval(() => onTick(false), 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { onTick(true); syncSoon(); refreshLive(); } });
initWakeLock();
boot();
if (!DEMO) startLive(); // im Demo-Modus nie Wetter- oder Bus-Abruf

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  // Neue Version aktiv: einmal neu laden, aber nie mitten im Kochen.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded || isCookOpen()) return;
    reloaded = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      const check = () => { reg.update().catch(() => { /* offline: egal */ }); };
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      setInterval(check, 6 * 60 * 60 * 1000);
    }).catch(() => { /* ohne Service Worker laeuft die App weiter, nur nicht offline */ });
  });
}
