// Tests fuer den Essensplan (fiktive Rezepte).
//   node tests/meals.test.mjs
import assert from 'node:assert/strict';
import { isStaleMeal, mealId, parseMealId, planDays, mealsOn, setMeal, plannedRecipes, missingIngredients, shoppingFor, isMeal, setMealServings, mealServings, plannedServings, scaledIngredients, rescaleShop } from '../app/js/meals.js';
import { normalizeEntry } from '../app/js/core.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const soup = { id: 'r1', name: 'Kürbissuppe', ingredients: [{ q: '1', t: 'Hokkaido' }, { q: '400 ml', t: 'Kokosmilch' }, { q: '', t: 'kokosmilch ' }] };
const pasta = { id: 'r2', name: 'Pasta', ingredients: [{ q: '500 g', t: 'Spaghetti' }] };

test('IDs hin und zurueck, fremde cats-Eintraege sind keine Mahlzeiten', () => {
  assert.equal(mealId('2026-11-24', 'abend'), 'meal-2026-11-24-abend');
  assert.deepEqual(parseMealId('meal-2026-11-24-mittag'), { date: '2026-11-24', slot: 'mittag' });
  assert.equal(parseMealId('leave-licht'), null);
  assert.equal(isMeal({ id: 'rec-123' }), false);
});

test('Sieben Tage ab heute, ueber Monats- und Jahresgrenze', () => {
  assert.deepEqual(planDays('2026-12-29', 7), ['2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04']);
});

test('Platz setzen, ersetzen und leeren laesst andere cats-Eintraege stehen', () => {
  let l = [{ id: 'leave-licht', done: true }];
  l = setMeal(l, '2026-11-24', 'abend', 'r1');
  l = setMeal(l, '2026-11-24', 'abend', 'r2');
  l = setMeal(l, '2026-11-24', 'mittag', 'r1');
  assert.equal(mealsOn(l, '2026-11-24').abend.rid, 'r2');
  assert.equal(mealsOn(l, '2026-11-24').mittag.rid, 'r1');
  l = setMeal(l, '2026-11-24', 'mittag', '');
  assert.equal(mealsOn(l, '2026-11-24').mittag, null);
  assert.ok(l.some((c) => c.id === 'leave-licht'));
  assert.equal(l.length, 2);
});

test('Geplante Rezepte: jedes nur einmal, geloeschte Rezepte fallen weg', () => {
  let l = [];
  l = setMeal(l, '2026-11-24', 'abend', 'r1');
  l = setMeal(l, '2026-11-25', 'abend', 'r1');
  l = setMeal(l, '2026-11-26', 'mittag', 'r2');
  l = setMeal(l, '2026-11-27', 'abend', 'weg');
  l = setMeal(l, '2026-12-24', 'abend', 'r2');
  const recs = plannedRecipes(l, [soup, pasta], planDays('2026-11-24', 7));
  assert.deepEqual(recs.map((r) => r.id), ['r1', 'r2']);
});

test('Zutaten: offen oder kuerzlich abgehakt kommt nicht doppelt, alt abgehakt schon', () => {
  const now = Date.parse('2026-11-22T12:00:00Z');
  const shop = [{ t: 'Kokosmilch', r: 'r1', done: false, at: 1 }, { t: 'Hokkaido', r: 'r1', done: true, doneAt: now - 864e5, at: 2 }, { t: 'Spaghetti', done: false, at: 3 }];
  assert.deepEqual(missingIngredients(shop, soup, now).map((z) => z.t), []);
  const old = [{ t: 'Hokkaido', r: 'r1', done: true, doneAt: '2026-11-10T10:00:00Z', at: 2 }, { t: 'Kokosmilch', r: 'r1', done: true, at: 4 }];
  assert.deepEqual(missingIngredients(old, soup, now).map((z) => z.t), ['Hokkaido', 'Kokosmilch']);
  assert.deepEqual(missingIngredients([], soup).map((z) => z.t), ['Hokkaido', 'Kokosmilch']);
  // Spaghetti ohne Rezeptbezug zaehlt nicht als "vom Rezept schon da"
  assert.deepEqual(missingIngredients(shop, pasta, now).map((z) => z.t), ['Spaghetti']);
});

test('Einkaufsposten mit Rezept-ID und Gruppe, eindeutige at', () => {
  let n = 100;
  const items = shoppingFor([], [soup, pasta], () => n++);
  assert.deepEqual(items.map((i) => [i.t, i.g, i.r, i.at]), [['Hokkaido', 'Kürbissuppe', 'r1', 100], ['Kokosmilch', 'Kürbissuppe', 'r1', 101], ['Spaghetti', 'Pasta', 'r2', 102]]);
  assert.equal(shoppingFor(items, [soup, pasta], () => n++).length, 0);
});

test('Mahlzeiten ueberstehen die Normalisierung im Sync (rid bleibt)', () => {
  const e = normalizeEntry('cats', { id: 'meal-2026-11-24-abend', rid: 'r1', done: false }, () => 0);
  assert.equal(e.rid, 'r1');
});

test('Alte Plan-Eintraege (ueber 30 Tage) werden als veraltet erkannt, andere cats nie', () => {
  assert.equal(isStaleMeal({ id: 'meal-2026-10-23-abend' }, '2026-11-22'), false);
  assert.equal(isStaleMeal({ id: 'meal-2026-10-22-abend' }, '2026-11-22'), true);
  assert.equal(isStaleMeal({ id: 'leave-licht' }, '2026-11-22'), false);
});

test('Portionen: Platz merkt sich n, ohne n gilt das Rezept, doppelt geplant wird zusammengezaehlt', () => {
  const rec = { id: 'r9', name: 'Pfanne', servings: 2, ingredients: [] };
  let l = setMeal([], '2026-11-24', 'abend', 'r9', 4);
  assert.equal(mealsOn(l, '2026-11-24').abend.n, 4);
  l = setMealServings(l, '2026-11-24', 'abend', 3);
  assert.equal(mealServings(mealsOn(l, '2026-11-24').abend, rec), 3);
  assert.equal(mealServings({ id: 'x', rid: 'r9' }, rec), 2);
  l = setMeal(l, '2026-11-25', 'mittag', 'r9');
  assert.deepEqual(plannedServings(l, [rec], planDays('2026-11-24', 7)), { r9: 5 });
});

test('Einkauf rechnet Mengen auf die gewuenschten Portionen um, auch Menge im Namen', () => {
  const rec = { id: 'r8', name: 'Hähnchenpfanne', servings: 2, ingredients: [{ q: '', t: 'Champignons (300 g)' }, { q: '', t: 'Sesamöl (2 TL (14 ml))' }, { q: '1', t: 'Zwiebel' }, { q: '', t: 'Salz' }] };
  let n = 0;
  const items = shoppingFor([], [Object.assign({}, rec, { want: 4 })], () => n++);
  assert.deepEqual(items.map((i) => [i.q, i.t]), [['600 g', 'Champignons'], ['4 TL (28 ml)', 'Sesamöl'], ['2', 'Zwiebel'], [undefined, 'Salz']]);
  // ohne want: Originalmengen, aber sauber getrennt
  assert.equal(shoppingFor([], [rec], () => n++)[0].q, '300 g');
  assert.deepEqual(scaledIngredients(rec, 1)[2], { q: '0,5', t: 'Zwiebel' });
});

test('Offene Posten werden umgerechnet, abgehakte und fremde bleiben', () => {
  const rec = { id: 'r7', name: 'Suppe', servings: 2, ingredients: [{ q: '400 ml', t: 'Kokosmilch' }, { q: '1', t: 'Kürbis' }] };
  const shop = [
    { t: 'Kokosmilch', q: '400 ml', r: 'r7', g: 'Suppe', done: false, at: 1 },
    { t: 'Kürbis', q: '1', r: 'r7', g: 'Suppe', done: true, at: 2 },
    { t: 'Milch', done: false, at: 3 }
  ];
  const out = rescaleShop(shop, rec, 4);
  assert.equal(out[0].q, '800 ml');
  assert.equal(out[1].q, '1');
  assert.equal(out[2], shop[2]);
});

let ok = 0;
for (const [name, fn] of tests) {
  try { fn(); ok++; } catch (e) { console.error('FEHLER: ' + name + '\n  ' + e.message); }
}
console.log(ok + '/' + tests.length + ' Tests bestanden');
if (ok !== tests.length) process.exit(1);
