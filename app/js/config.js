// Neutrale Voreinstellungen ohne Ortsangaben. Wetterort, Haltestelle, Linien und Fussweg stehen NICHT im Repo,
// sondern in den Einstellungen auf dem Geraet (localStorage, siehe settings.js).
export const WEATHER = {
  timezone: 'Europe/Berlin'
};

export const TRANSIT = {
  stopName: '',
  stopId: '',
  lines: [],       // leer = alle Linien
  directions: {},  // je Linie Stichwoerter, leer = alle Richtungen
  walkMinutes: 5,
  duration: 45,
  results: 15,
  count: 3 // so viele Abfahrten zeigen
};

// Aeltere Daten werden verworfen (Zustand "nicht verfuegbar")
export const MAX_AGE = { weatherMs: 3 * 60 * 60 * 1000, transitMs: 10 * 60 * 1000 };
