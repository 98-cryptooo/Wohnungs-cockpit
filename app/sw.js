// Service Worker: Cache-first fuer die App-Shell, alle Pfade relativ (GitHub Pages Unterpfad).
// Bei jeder Aenderung an der App die Version hochzaehlen, damit der Cache erneuert wird.
// Der Origin wird mit anderen Apps geteilt: nur eigene Caches (Praefix cockpit-shell-) anfassen.
const PREFIX = 'cockpit-shell-';
const VERSION = PREFIX + 'v31';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './js/state.js',
  './js/util.js',
  './js/render.js',
  './js/calendar.js',
  './js/config.js',
  './js/live.js',
  './js/poll.js',
  './js/places.js',
  './js/liveCore.js',
  './js/settings.js',
  './js/settingsui.js',
  './js/transit.js',
  './js/weather.js',
  './js/cook.js',
  './js/core.js',
  './js/household.js',
  './js/setup.js',
  './js/sync.js',
  './js/confirm.js',
  './js/night.js',
  './js/standby.js',
  './js/wake.js',
  './js/tasks.js',
  './js/reminders.js',
  './js/meals.js',
  './js/mealsui.js',
  './js/recipeimport.js',
  './js/recipesui.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Netzwerkabfragen (Sync, Wetter, Bus) nie abfangen
  event.respondWith(
    caches.open(VERSION).then((c) => c.match(req, { ignoreSearch: true })).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => (req.mode === 'navigate'
        ? caches.open(VERSION).then((c) => c.match('./index.html'))
        : Response.error()));
    })
  );
});
