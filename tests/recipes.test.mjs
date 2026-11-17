// Tests fuer die Zuordnung Einkaufsposten zu Rezept und fuer Rezepte aus der Partner-App.
//   node tests/recipes.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normUrl, itemBelongsTo, recipeForItem, itemsOfRecipe, normalizeEntry, keyOf, createStore, createClock } from '../app/js/core.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const gen = () => 777;

// Rezept im Format der Partner-App: kein id, at als Schluessel, Zeit als Zahl oder Text, status evtl. ohne
const partner = () => ({ name: 'Linsensuppe', url: 'https://beispiel.example/rezepte/linsensuppe/', steps: ['Zwiebel schneiden.', 'Alles 20 Minuten kochen.'], servings: 4, yieldText: 'Portionen', time: 35, image: null, ingredients: [{ q: '250 g', t: 'Linsen' }, { q: '1', t: 'Zwiebel' }], status: 'list', at: 1700000123456 });

test('Partner-Rezept ohne id: Schluessel ist String(at), alle Felder bleiben', () => {
  const e = normalizeEntry('recipes', partner(), gen);
  assert.equal(e.id, '1700000123456');
  assert.equal(keyOf('recipes', partner()), '1700000123456');
  assert.equal(e.name, 'Linsensuppe');
  assert.deepEqual(e.steps, ['Zwiebel schneiden.', 'Alles 20 Minuten kochen.']);
  assert.equal(e.servings, 4);
  assert.equal(e.yieldText, 'Portionen');
  assert.equal(e.time, 35);
  assert.deepEqual(e.ingredients, [{ q: '250 g', t: 'Linsen' }, { q: '1', t: 'Zwiebel' }]);
  assert.equal(e.status, 'list');
  assert.equal(e.at, 1700000123456);
});

test('Partner-Rezept mit ungewoehnlichen Feldern wird nicht verworfen', () => {
  const e = normalizeEntry('recipes', { name: 'Brot', at: 5, time: '45 Min', servings: '2', steps: 'kaputt', ingredients: [null, { q: 1, t: 'Mehl' }], status: 'irgendwas' }, gen);
  assert.equal(e.id, '5');
  assert.equal(e.time, 0);
  assert.equal(e.servings, 2);
  assert.deepEqual(e.steps, []);
  assert.deepEqual(e.ingredients, [{ q: '1', t: 'Mehl' }]);
  assert.equal(e.status, 'saved');
  assert.equal(normalizeEntry('recipes', { name: 'ohne alles' }, () => 42).id, '42', 'ohne id und at: erzeugte id');
});

test('Partner-Rezept kommt per Sync an und bekommt die Server-id als Schluessel', () => {
  const store = createStore({ initial: {}, persist() {}, clock: createClock(() => 1000), emit() {}, gen });
  store.applyRemote('recipes', [{ id: '1700000123456', data: partner(), ts: 50, deleted: false }]);
  assert.equal(store.data.recipes.length, 1);
  assert.equal(store.data.recipes[0].id, '1700000123456');
  assert.equal(store.data.recipes[0].ts, 50);
});

test('Adressen werden zum Vergleich geglaettet', () => {
  assert.equal(normUrl('HTTPS://Beispiel.Example/rezepte/x/#kommentare'), 'https://beispiel.example/rezepte/x');
  assert.equal(normUrl('https://beispiel.example/a?b=1'), 'https://beispiel.example/a?b=1');
  assert.equal(normUrl('javascript:alert(1)'), '');
  assert.equal(normUrl('kein link'), '');
});

test('Zuordnung ueber r (ID, at oder Name)', () => {
  const rec = normalizeEntry('recipes', partner(), gen);
  assert.ok(itemBelongsTo({ t: 'Linsen', r: '1700000123456' }, rec));
  assert.ok(itemBelongsTo({ t: 'Linsen', r: 1700000123456 }, rec), 'Zahl statt Text');
  assert.ok(itemBelongsTo({ t: 'Linsen', r: 'linsensuppe' }, rec), 'r als Rezeptname');
  assert.ok(!itemBelongsTo({ t: 'Linsen', r: 'andere' }, rec));
});

test('Zuordnung ueber u (Link) oder u mit g (Gruppenname)', () => {
  const rec = normalizeEntry('recipes', partner(), gen);
  assert.ok(itemBelongsTo({ t: 'Linsen', u: 'https://BEISPIEL.example/rezepte/linsensuppe' }, rec), 'Link ohne Schraegstrich, anderer Rechnername');
  assert.ok(itemBelongsTo({ t: 'Linsen', u: 'https://woanders.example/x', g: ' linsensuppe ' }, rec), 'Gruppe heisst wie das Rezept');
  assert.ok(!itemBelongsTo({ t: 'Linsen', g: 'Linsensuppe' }, rec), 'ohne Link kein Treffer ueber den Gruppennamen');
  assert.ok(!itemBelongsTo({ t: 'Milch', g: 'Allgemein' }, rec));
  assert.ok(!itemBelongsTo({ t: 'Linsen', u: 'https://woanders.example/x', g: 'Anderes' }, rec));
});

test('Posten ohne Rezeptdatensatz findet kein Rezept, mit Rezept schon', () => {
  const shop = [{ t: 'Linsen', u: 'https://beispiel.example/rezepte/linsensuppe', g: 'Linsensuppe', at: 1 }, { t: 'Milch', g: 'Allgemein', at: 2 }];
  assert.equal(recipeForItem([], shop[0]), null);
  const rec = normalizeEntry('recipes', partner(), gen);
  assert.equal(recipeForItem([rec], shop[0]).id, rec.id);
  assert.equal(recipeForItem([rec], shop[1]), null);
  assert.deepEqual(itemsOfRecipe(shop, rec).map((i) => i.t), ['Linsen']);
});

test('Anzeige: Hinweis und Link nur ohne Rezept, Link mit sicherem Schutz', () => {
  const src = readFileSync(new URL('../app/js/render.js', import.meta.url), 'utf8');
  assert.ok(src.includes('Anleitung noch nicht synchronisiert'));
  assert.ok(src.includes("'Original öffnen'"));
  assert.ok(src.includes("a.rel = 'noopener noreferrer'") && src.includes("a.target = '_blank'"));
  assert.ok(/safeUrl\(i\.x\.u\)/.test(src), 'Link geht durch safeUrl (nur http und https)');
  assert.ok(/if \(!rec\) sub\.append\(el\('div', 'sub-hint'/.test(src));
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }
}
console.log(passed + '/' + tests.length + ' Tests bestanden');
