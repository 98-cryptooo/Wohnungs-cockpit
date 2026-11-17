// Startet Wetter und Bus (kein Zugang noetig, daher nicht an den Haushaltscode gebunden).
// Wird im Demo-Modus nie aufgerufen. Orte kommen aus den Einstellungen auf dem Geraet (settings.js).
import { notify } from './state.js';
import { settings } from './settings.js';
import { isNight } from './night.js';
import { createLive } from './liveCore.js';

// Alte Schluessel aus frueheren Staenden aufraeumen
try { localStorage.removeItem('wohnungs-cockpit.weather'); localStorage.removeItem('wohnungs-cockpit.transit'); } catch (e) { /* ignorieren */ }

function storageFor(key) {
  return {
    load() { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } },
    save(x) { try { localStorage.setItem(key, JSON.stringify(x)); } catch (e) { /* ignorieren */ } }
  };
}

const live = createLive({
  settings, storageFor, notify,
  fetchImpl: (url, init) => fetch(url, init),
  isVisible: () => document.visibilityState === 'visible',
  isNight: () => isNight(new Date())
});

export function startLive() { live.start(); }
export function refreshLive() { live.refresh(); }
