// Steuerung von Wetter und Bus anhand der Einstellungen (ohne Browserglobals, damit testbar).
// Ohne Wetterort wird nichts fuer das Wetter abgefragt, ohne Haltestelle nichts fuer den Bus.
// Aendern sich Ort oder Haltestelle, wird der alte Abruf gestoppt und sofort neu abgerufen.
import { TRANSIT } from './config.js';
import { createWeather, setWeather } from './weather.js';
import { createTransit, setTransit, shouldPollBus } from './transit.js';
import { weatherCacheKey, transitCacheKey } from './settings.js';

// deps: settings, fetchImpl, storageFor(key), notify(topic), isVisible(), isNight(), timers {repeat, stopRepeat, nowFn}
export function createLive(deps) {
  const timers = deps.timers || {};
  let weather = null;
  let transit = null;
  let wKey = null;
  let tKey = null;
  let unsub = null;

  function apply() {
    const s = deps.settings.get();
    const wk = s.weather ? weatherCacheKey(s.weather) : null;
    if (wk !== wKey) {
      if (weather) weather.stop();
      weather = null;
      wKey = wk;
      setWeather(null);
      if (s.weather) {
        weather = createWeather({ fetchImpl: deps.fetchImpl, loc: s.weather, storage: deps.storageFor(wk), onUpdate: () => deps.notify('weather'), ...timers });
        setWeather(weather);
        weather.start();
      }
      deps.notify('weather');
    }
    const tk = s.transit.stopId ? transitCacheKey(s.transit.stopId) : null;
    if (tk !== tKey) {
      if (transit) transit.stop();
      transit = null;
      tKey = tk;
      setTransit(null);
      if (s.transit.stopId) {
        transit = createTransit({
          fetchImpl: deps.fetchImpl, cfg: { stopId: s.transit.stopId, duration: TRANSIT.duration, results: TRANSIT.results },
          storage: deps.storageFor(tk), onUpdate: () => deps.notify('transit'),
          shouldPoll: () => shouldPollBus(deps.isVisible(), deps.isNight()), // nachts und im Hintergrund kein Bus-Abruf
          ...timers
        });
        setTransit(transit);
        transit.start();
      }
      deps.notify('transit');
    }
  }

  return {
    start() { if (unsub) return; apply(); unsub = deps.settings.subscribe(() => { apply(); deps.notify('transit'); deps.notify('weather'); }); },
    stop() { if (unsub) unsub(); unsub = null; if (weather) weather.stop(); if (transit) transit.stop(); weather = null; transit = null; wKey = null; tKey = null; setWeather(null); setTransit(null); },
    // Beim Wiedersichtbarwerden: frische Werte (Mindestabstand und Backoff gelten weiter).
    refresh() { if (weather) weather.refresh(); if (transit) transit.refresh(); },
    active: () => ({ weather: !!weather, transit: !!transit })
  };
}
