// Verbindung zum Haushalt: Start-Maske, Statusanzeige, Einstellungen (Trennen) und Start des Sync-Motors.
// Haushaltscode und Schluessel werden hier nie geloggt und nie in Meldungen gezeigt.
import { DEMO, store, clock, saveClockOffset, resetAll, notify } from './state.js';
import { JOIN, getCreds, saveCreds, clearCreds, isSkipped, setSkipped, syncStorageFor, calendarStorageFor } from './household.js';
import { createCalendar, setCalendar } from './calendar.js';
import { hashCode } from './core.js';
import { createRpc, createSync, probe, errorMessage } from './sync.js';
import { askConfirm, isConfirmOpen } from './confirm.js';
import { initSettingsUi, renderSettingsUi } from './settingsui.js';

const $ = (id) => document.getElementById(id);
const LABEL = { ok: 'Verbunden', syncing: 'Gleicht ab', offline: 'Offline', error: 'Fehler', denied: 'Zugang abgelehnt', local: 'Nur lokal', demo: 'Demo' };
let engine = null;
let calendar = null;

function stopCalendar() {
  if (calendar) calendar.stop();
  calendar = null;
  setCalendar(null);
}
let currentStatus = 'local';

let lastInfo = { quarantined: 0 };

function showStatus(s, info) {
  if (info) lastInfo = info;
  const state = s === 'off' ? 'local' : s;
  currentStatus = state;
  const q = lastInfo.quarantined || 0;
  let text = LABEL[state] || '';
  let visual = state;
  if (q > 0 && (state === 'ok' || state === 'syncing' || state === 'offline' || state === 'error')) {
    text = q === 1 ? '1 Eintrag konnte nicht gesendet werden' : q + ' Einträge konnten nicht gesendet werden';
    visual = 'error';
  }
  $('btn-sync').dataset.state = visual;
  $('sync-label').textContent = text;
  $('btn-sync').setAttribute('aria-label', 'Verbindung: ' + text + '. Einstellungen öffnen');
}

async function startEngine(creds, first) {
  if (engine) { engine.stop(); engine = null; }
  stopCalendar();
  const hash = await hashCode(creds.code);
  const rpc = createRpc(creds, (url, init) => fetch(url, init));
  const e = createSync({ store, rpc, storage: syncStorageFor(hash), clock, onStatus: showStatus, onOffset: saveClockOffset });
  engine = e;
  lastInfo = e.info();
  if (first) e.enqueueAllLocal();
  e.start();
  const cal = createCalendar({ creds, fetchImpl: (url, init) => fetch(url, init), storage: calendarStorageFor(hash), onUpdate: () => notify('cal') });
  calendar = cal;
  setCalendar(cal);
  notify('cal'); // Cache sofort zeigen
  cal.start();
}

// Probe-Pull, dann speichern und starten. Liefert {error} mit deutscher Meldung, {cancelled} oder {} bei Erfolg.
async function tryConnect(code, key) {
  const creds = { code, key };
  try {
    await probe(createRpc(creds, (url, init) => fetch(url, init)));
  } catch (e) {
    return { error: errorMessage(e && e.kind) };
  }
  const old = getCreds();
  if (old && old.code !== code) { // anderer Haushalt: lokale Daten und nicht gesendete Aenderungen gehen verloren
    const unsent = engine ? engine.queueSize() : 0;
    const text = 'Das Cockpit ist schon mit einem anderen Haushalt verbunden. Beim Wechsel werden die Daten auf diesem Gerät gelöscht' +
      (unsent > 0 ? ' und ' + unsent + ' noch nicht gesendete Änderungen gehen verloren' : '') + '. Wechseln?';
    if (!(await askConfirm(text, 'Wechseln'))) return { cancelled: true };
    if (engine) { engine.stop(); engine = null; }
    stopCalendar();
    clearCreds();
    resetAll();
  }
  if (!saveCreds(creds)) return { error: 'Das Speichern im Browser ist nicht möglich. Bitte private Browserfenster und gesperrte Website-Daten prüfen.' };
  setSkipped(false);
  await startEngine(creds, true);
  return {};
}

// ---- Start-Maske --------------------------------------------------------------------
function openSetup(message, code, key) {
  $('setup-code').value = code || '';
  $('setup-key').value = key || '';
  const err = $('setup-error');
  err.hidden = !message;
  err.textContent = message || '';
  $('setup').hidden = false;
  $('day').inert = true;
  $('setup-code').focus({ preventScroll: true });
}
function closeSetup() {
  $('setup').hidden = true;
  $('setup-code').value = '';
  $('setup-key').value = '';
  $('day').inert = false;
}

async function onSetupSubmit(e) {
  e.preventDefault();
  const code = $('setup-code').value.trim();
  const key = $('setup-key').value.replace(/\s+/g, '');
  const err = $('setup-error');
  if (!code || !key) { err.textContent = 'Bitte beide Felder ausfüllen.'; err.hidden = false; return; }
  const go = $('setup-go');
  go.disabled = true;
  go.textContent = 'Verbinde ...';
  err.hidden = true;
  const res = await tryConnect(code, key);
  go.disabled = false;
  go.textContent = 'Verbinden';
  if (res.cancelled) { err.textContent = 'Der Wechsel wurde abgebrochen.'; err.hidden = false; return; }
  if (res.error) { err.textContent = res.error; err.hidden = false; return; }
  closeSetup();
}

// ---- Einstellungen --------------------------------------------------------------------
function openSettings() {
  if (DEMO) return;
  const connected = !!engine;
  let text = 'Das Cockpit arbeitet nur auf diesem Gerät und gleicht nichts ab.';
  if (connected) {
    text = 'Das Cockpit ist mit dem Haushalt verbunden. Status: ' + (LABEL[currentStatus] || '') + '. Noch nicht gesendete Änderungen: ' + engine.queueSize() + '.';
    if (currentStatus === 'denied') text = 'Der Server hat den Haushaltscode oder den Schlüssel abgelehnt. Bitte trennen und neu verbinden und beide Angaben prüfen. Mit "Jetzt abgleichen" kannst du es noch einmal versuchen.';
    if (engine.quarantineCount() > 0) text += ' ' + engine.quarantineCount() + ' Eintrag ist zu groß oder ungültig und wird nicht gesendet.';
  }
  $('settings-text').textContent = text;
  renderSettingsUi(true);
  $('settings-sync').hidden = !connected;
  $('settings-off').hidden = !connected;
  $('settings-connect').hidden = connected;
  ['day', 'overlay', 'cook'].forEach((id) => { $(id).inert = true; });
  $('settings').hidden = false;
  $('settings-close').focus({ preventScroll: true });
}
function closeSettings() {
  $('settings').hidden = true;
  ['overlay', 'cook'].forEach((id) => { $(id).inert = false; });
  $('day').inert = !$('overlay').hidden || !$('cook').hidden;
  $('btn-sync').focus({ preventScroll: true });
}

async function disconnect() {
  const unsent = engine ? engine.queueSize() : 0;
  const ok = await askConfirm('Verbindung trennen? Die Daten auf diesem Gerät werden gelöscht' +
    (unsent > 0 ? ' und ' + unsent + ' noch nicht gesendete Änderungen gehen verloren' : '') + '. Der Haushalt selbst bleibt unverändert.', 'Trennen');
  if (!ok) return;
  if (engine) { engine.stop(); engine = null; }
  stopCalendar();
  clearCreds();
  resetAll();
  notify('cal');
  setSkipped(false);
  showStatus('local');
  closeSettings();
  openSetup();
}

// ---- Verdrahtung ------------------------------------------------------------------------
export function initSetup() {
  initSettingsUi();
  document.addEventListener('cockpit:settings', openSettings);
  $('setup-form').addEventListener('submit', onSetupSubmit);
  $('setup-skip').addEventListener('click', () => { setSkipped(true); closeSetup(); showStatus('local'); });
  $('btn-sync').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', closeSettings);
  $('settings-scrim').addEventListener('click', closeSettings);
  $('settings-sync').addEventListener('click', () => { if (engine) engine.retry(); if (calendar) calendar.retry(); closeSettings(); });
  $('settings-connect').addEventListener('click', () => { closeSettings(); openSetup(); });
  $('settings-off').addEventListener('click', disconnect);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('settings').hidden && !isConfirmOpen()) { e.stopPropagation(); closeSettings(); }
  }, true);
}

export async function boot() {
  if (DEMO) { showStatus('demo'); return; } // Demo: nie ein Netzwerkaufruf
  if (JOIN) {
    if (JOIN.key) {
      const res = await tryConnect(JOIN.code, JOIN.key);
      if (res.cancelled) return; // bisherige Verbindung bleibt unveraendert
      if (!res.error) return;
      if (!engine) showStatus('local');
      openSetup(res.error, JOIN.code, JOIN.key);
    } else {
      showStatus('local');
      openSetup('', JOIN.code, '');
    }
    return;
  }
  const creds = getCreds();
  if (creds) { showStatus('syncing'); await startEngine(creds, false); return; }
  showStatus('local');
  if (!isSkipped()) openSetup();
}

export function syncSoon() {
  if (engine) engine.syncNow();
  if (calendar) calendar.refresh();
}
