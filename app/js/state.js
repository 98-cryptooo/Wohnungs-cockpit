// Datenmodul: Beispieldaten, Speicherung im Browser und zentrale Schreibfunktion.
// Die Logik (Schluessel, Merge, Tombstones, Schreiben) steckt testbar in core.js, hier nur die Browseranbindung.
// Alle Aenderungen an den Listen laufen ueber write(). Der Sync (sync.js) haengt sich per setWriteHook() dran.
// Alles hier ist Beispiel oder Nutzereingabe. Keine echten Personendaten, keine Schluessel.

import { LISTS, createClock, createStore, normalizeList } from './core.js';
export { LISTS };

const STORAGE_KEY = 'wohnungs-cockpit.v1';
const CLOCK_KEY = 'wohnungs-cockpit.clock';
const SESSION_KEY = 'wohnungs-cockpit.session';
// Demo-Modus (?demo=1): Beispieldaten nur im Arbeitsspeicher. Es wird nichts gespeichert und nie etwas synchronisiert.
// Ohne Demo startet die App mit leeren Listen.
export const DEMO = new URLSearchParams(location.search).get('demo') === '1';

let seq = 0;
export function newId() {
  return Date.now() * 1000 + (seq++ % 1000);
}

// Katzen: Der Haken gilt nur fuer den "Katzentag". Er wechselt um 6 Uhr morgens.
const pad2 = (n) => String(n).padStart(2, '0');
export function catDay(now) {
  const d = new Date((now || new Date()).getTime() - 6 * 3600000);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
export function catDone(c, now) { return !!c.done && c.doneDay === catDay(now); }
const CAT_IDS = ['morgens', 'abends', 'klo'];
const defaultCats = () => CAT_IDS.map((id) => ({ id, done: false, ts: 0 }));
const makeEmpty = () => ({ shop: [], recipes: [], tasks: [], cats: defaultCats() });

// ---------------------------------------------------------------------------
// Beispieldaten, nur im Demo-Modus (Format wie in CLAUDE.md)
// shop:    {t, done, at, doneAt?, q?, g?, u?, r?}
// recipes: {id, name, url, steps[], servings, yieldText, time, image, ingredients[{q,t}], status, at}
// tasks:   {id, text, who, done}
// cats:    {id, done}
// ---------------------------------------------------------------------------
function makeSample() {
  const BASE = 1700000000000;
  const jam = 'Weihnachtsmarmelade Apfel-Kirsch mit Zimt';
  const shopRaw = [
    { t: 'Hafermilch', g: 'Allgemein' },
    { t: 'Bananen', g: 'Allgemein' },
    { t: 'Kaffeebohnen', g: 'Allgemein', done: true },
    { t: 'Katzenfutter Nassfutter', g: 'Allgemein', q: '12 Dosen' },
    { t: 'Sauerkirschen (TK)', g: jam, r: 'r1', q: '750 g' },
    { t: 'Äpfel', g: jam, r: 'r1', q: '250 g' },
    { t: 'Gelierzucker 2:1', g: jam, r: 'r1', q: '500 g' },
    { t: 'Zimt', g: jam, r: 'r1', q: '1 TL', done: true },
    { t: 'Hokkaido-Kürbis', g: 'Kürbissuppe', r: 'r2', q: '1' },
    { t: 'Kokosmilch', g: 'Kürbissuppe', r: 'r2', q: '400 ml' },
    { t: 'Ingwer', g: 'Kürbissuppe', r: 'r2' },
    { t: 'Spülmaschinentabs', g: 'Drogerie' },
    { t: 'Zahnpasta', g: 'Drogerie' },
    { t: 'Katzenstreu', g: 'Haushalt' },
    { t: 'Glühbirne E27', g: 'Haushalt' }
  ];
  const shop = shopRaw.map((x, i) => Object.assign({ done: false, at: BASE + i, ts: 0 }, x));

  const recipes = [
    {
      id: 'r1', name: jam, url: 'https://example.org/rezepte/weihnachtsmarmelade', servings: 6, yieldText: 'Gläser', time: 19,
      image: null, status: 'list', at: BASE, ts: 0,
      ingredients: [
        { q: '750 g', t: 'Sauerkirschen (TK)' }, { q: '250 g', t: 'Äpfel' }, { q: '500 g', t: 'Gelierzucker 2:1' },
        { q: '1 TL', t: 'Zimt' }, { q: '2 TL', t: 'Zitronensaft' }
      ],
      steps: [
        'Die gefrorenen Sauerkirschen in eine große Schüssel geben und gleich mit dem Gelierzucker mischen.',
        'Den Apfel schälen, entkernen und fein würfeln. Mit Zitronensaft und Zimt unter die Kirschen rühren.',
        'Alles auftauen lassen und ab und zu umrühren. In der Zeit die Gläser auskochen und abtropfen lassen.',
        'Die aufgetaute Masse unter Rühren aufkochen und etwa 4 Minuten sprudelnd kochen lassen. Wer mag, püriert sie danach.',
        'Die heiße Marmelade in die Gläser füllen, fest verschließen und vollständig abkühlen lassen.'
      ]
    },
    {
      id: 'r2', name: 'Kürbissuppe', url: null, servings: 4, yieldText: 'Portionen', time: 40,
      image: null, status: 'list', at: BASE + 1, ts: 0,
      ingredients: [{ q: '1', t: 'Hokkaido-Kürbis' }, { q: '400 ml', t: 'Kokosmilch' }, { q: '1 Stück', t: 'Ingwer' }, { q: '1', t: 'Zwiebel' }],
      steps: [
        'Kürbis waschen, entkernen und mit Schale würfeln. Zwiebel und Ingwer fein hacken.',
        'Zwiebel und Ingwer in etwas Öl 3 Minuten andünsten, dann den Kürbis dazugeben.',
        'Mit 600 ml Wasser auffüllen und 20 Minuten köcheln lassen.',
        'Kokosmilch dazugeben, fein pürieren und abschmecken.'
      ]
    },
    {
      id: 'r3', name: 'Lasagne', url: null, servings: 4, yieldText: 'Portionen', time: 75,
      image: null, status: 'saved', at: BASE + 2, ts: 0,
      ingredients: [{ q: '250 g', t: 'Lasagneplatten' }, { q: '2', t: 'Passierte Tomaten' }, { q: '500 g', t: 'Hackfleisch' }],
      steps: ['Soße kochen.', 'Schichten.', '45 Minuten backen.']
    }
  ];

  const tasks = [
    { id: 1, text: 'Bad putzen', who: 'Rik', done: true },
    { id: 2, text: 'Staubsaugen', who: 'Melina', done: false },
    { id: 3, text: 'Katzenklo komplett', who: 'Rik', done: false },
    { id: 4, text: 'Bettwäsche wechseln', who: 'Melina', done: false },
    { id: 5, text: 'Kühlschrank aufräumen', who: 'Beide', done: false }
  ].map((x) => Object.assign({ ts: 0 }, x));

  const cats = defaultCats();
  cats[0].done = true;
  cats[0].doneDay = catDay(new Date());

  return { shop, recipes, tasks, cats };
}

// Beispieltermine (fiktiv und neutral), relativ zu heute (Tage ab heute). Nur im Demo-Modus.
const SAMPLE_CAL = [
  [0, '19:00', 'Treffen mit Freunden'],
  [1, '11:00', 'Einkaufen'],
  [2, null, 'Geburtstag Max'],
  [3, null, 'Besuch'],
  [4, null, 'Sport 15:00'],
  [7, null, '17;00 Lauftreff'],
  [9, '08:00', 'Betriebsfeier'],
  [11, '19:00', 'Konzert'],
  [12, null, 'Familienessen'],
  [14, null, 'Treffen 15:45'],
  [14, '09:00', 'Abgabe']
];

export function calendarRaw(now) {
  if (!DEMO) return [];
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return SAMPLE_CAL.map(([off, time, title]) => {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + off);
    const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return { date: iso, time, title, cal: 'Haushalt' };
  });
}

// Naechster Termin der Katzenkachel als Beispiel (neutral), Tage ab heute und Uhrzeit.
const SAMPLE_VET = { title: 'Nächster Termin: Besuch', offsetDays: 1, time: '10:30' };
export const getVet = () => (DEMO ? SAMPLE_VET : null);

// Haltestelle als Beispiel (fiktiv): Linie, Richtung, Takt in Minuten, Versatz, Metro-Optik ja/nein.
export const DEMO_STOP_NAME = 'Beispielstr.';
export const DEMO_WALK_MINUTES = 4;
const SAMPLE_DEPARTURES = [
  { line: 'A1', dir: 'Richtung Zentrum', every: 10, offset: 3, metro: false },
  { line: 'B2', dir: 'Endstation', every: 10, offset: 7, metro: true }
];
export const getDepartures = () => (DEMO ? SAMPLE_DEPARTURES : []);

// ---------------------------------------------------------------------------
// Laden, Speichern, Uhr, Store
// ---------------------------------------------------------------------------
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function load() {
  if (DEMO) return makeSample();
  const empty = makeEmpty();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const o = JSON.parse(raw);
    if (!isObj(o)) return empty;
    const out = { tombs: isObj(o.tombs) ? o.tombs : {} };
    LISTS.forEach((l) => { out[l] = Array.isArray(o[l]) ? o[l] : empty[l]; });
    return out;
  } catch (e) {
    return empty;
  }
}

function persist(snapshot) {
  if (DEMO) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (e) { /* Speicher voll oder gesperrt: App laeuft trotzdem weiter */ }
}

export const clock = createClock();
try { clock.setOffset(Number(localStorage.getItem(CLOCK_KEY)) || 0); } catch (e) { /* ignorieren */ }
export function saveClockOffset(ms) {
  try { localStorage.setItem(CLOCK_KEY, String(Math.round(ms))); } catch (e) { /* ignorieren */ }
}
export const nowTs = () => clock.nowTs();

// Abonnenten
const subscribers = new Set();
export function subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }
function emit(topic) { subscribers.forEach((fn) => fn(topic)); }

const initial = load();
CAT_IDS.forEach((id) => { if (!(initial.cats || []).some((c) => c && c.id === id)) (initial.cats = initial.cats || []).push({ id, done: false, ts: 0 }); });
export const store = createStore({ initial, persist, clock, emit, gen: () => newId() });
export const data = store.data;

// Fluechtiger Zustand der Oberflaeche, wird nicht gespeichert und nicht synchronisiert.
export const ui = { open: null, cook: null, timer: null };

// Kochmodus (Rezept, Schritt, Portionen) und Timer ueberleben ein Neuladen (nur sessionStorage).
function loadSession() {
  try {
    const o = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (!isObj(o)) return;
    if (isObj(o.cook) && data.recipes.some((r) => r.id === o.cook.rid)) {
      ui.cook = { rid: String(o.cook.rid), step: Number(o.cook.step) || 0, servings: Number(o.cook.servings) || 1 };
      if (isObj(o.timer) && Number(o.timer.endsAt) > 0) ui.timer = { endsAt: Number(o.timer.endsAt), total: Number(o.timer.total) || 0 };
    }
  } catch (e) { /* ignorieren */ }
}
function saveSession() {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ cook: ui.cook, timer: ui.timer })); } catch (e) { /* ignorieren */ }
}
loadSession();

// Einzige Stelle fuer Schreibzugriffe (siehe core.js, createStore). Geaenderte Eintraege bekommen ts, geloeschte Tombstones.
export const write = store.write;
// Der Sync meldet sich hier an: setWriteHook(({list, changed, removed}) => ...). Im Demo-Modus nie.
export function setWriteHook(fn) { if (!DEMO) store.onWrite = fn; }
export const applyRemote = store.applyRemote;
export function resetAll() { if (!DEMO) store.reset(makeEmpty()); }

export function setUi(patch) {
  Object.assign(ui, patch);
  if ('cook' in patch || 'timer' in patch) saveSession();
  emit('ui');
}

export function tick() { emit('tick'); }
export function notify(topic) { emit(topic); }
