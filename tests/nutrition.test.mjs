// Tests fuer die Naehrwerte (Schaetzung aus Zutaten, Werte der Rezeptseite). Fiktive Rezepte.
//   node tests/nutrition.test.mjs
import assert from 'node:assert/strict';
import { estimate, nutritionFor, fromLdNutrition, parseQty, matchFood } from '../app/js/nutrition.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const pasta = { servings: 4, ingredients: [{ q: '500 g', t: 'Nudeln' }, { q: '400 g', t: 'passierte Tomaten' }, { q: '1 EL', t: 'Olivenöl' }] };

test('Mengen lesen', () => {
  assert.deepEqual(parseQty('1 ½ EL'), { n: 1.5, unit: 'el' });
  assert.equal(parseQty('2 Zehen').unit, 'zehe');
  assert.equal(parseQty('2-3 Dosen').n, 2.5);
  assert.equal(parseQty(''), null);
});
test('Schaetzung pro Portion und pro 100 g', () => {
  const e = estimate(pasta);
  assert.ok(e.ok);
  assert.ok(Math.abs(e.kcal - 510) < 30, 'kcal ' + e.kcal);
  const n = nutritionFor(pasta);
  assert.equal(n.est.kcal, true);
  assert.ok(Math.abs(n.per100.kcal - 220) < 20, 'pro 100 g ' + n.per100.kcal);
});
test('Zu wenig erkannt: keine Zahl', () => {
  const n = nutritionFor({ servings: 2, ingredients: [{ q: '', t: 'etwas Öl' }, { q: '', t: 'Salz' }, { q: '', t: 'Gewürze' }] });
  assert.equal(n.portion.kcal, null);
  assert.equal(n.per100.kcal, null);
});
test('Werte der Rezeptseite gehen vor', () => {
  const ld = fromLdNutrition({ calories: '523 kcal', proteinContent: '20,96 g', fatContent: '12 g', carbohydrateContent: '80 g', servingSize: '1' });
  assert.deepEqual(ld, { kcal: 523, p: 21, f: 12, c: 80 });
  const n = nutritionFor({ ...pasta, nutr: { ...ld, src: 'page' } });
  assert.equal(n.portion.kcal, 523);
  assert.equal(n.est.kcal, false);
  assert.equal(n.src, 'page');
});

test('Zutaten richtig zuordnen', () => {
  const food = (t) => (matchFood(t) || [[null]])[0][0];
  assert.equal(food('Zuckerschoten'), 'zuckerschoten');
  assert.equal(food('Zuckererbsen'), 'zuckerschoten');
  assert.equal(food('Petersilie, gehackt'), null);
  assert.equal(food('Rinderhack'), 'hackfleisch');
  assert.equal(food('Eisbergsalat'), 'salat');
  assert.equal(food('Eiweiß'), 'eiweiß');
});
test('Mengen: Brueche, Tausender, Packungen, Gewuerze, Wasser', () => {
  assert.equal(parseQty('1 1/2 EL').n, 1.5);
  assert.equal(parseQty('0.250 kg').n, 0.25);
  assert.equal(parseQty('1.000 g').n, 1000);
  const one = (q, t) => estimate({ servings: 1, ingredients: [{ q, t }] });
  assert.ok(Math.abs(one('1 Pck.', 'Blätterteig').kcal - 1000) < 100);
  assert.ok(Math.abs(one('1 Pck.', 'Mozzarella').kcal - 313) < 10);
  assert.ok(one('1 1/2 EL', 'Olivenöl').ok);
  const e = estimate({ servings: 4, ingredients: [...pasta.ingredients, { q: '3 l', t: 'Wasser' }, { q: '1 TL', t: 'Meersalz' }, { q: '', t: 'Cayennepfeffer' }] });
  assert.deepEqual(e.unknown, []);
  assert.equal(e.g, estimate(pasta).g);
});
test('Seitenwerte: Tausender, kJ zuerst, Portionsgewicht', () => {
  assert.equal(fromLdNutrition({ calories: '1.050 kcal' }).kcal, 1050);
  assert.equal(fromLdNutrition({ calories: '2.190 kJ / 523 kcal' }).kcal, 523);
  assert.equal(fromLdNutrition({ calories: '2190 kJ' }), null);
  assert.deepEqual(fromLdNutrition({ calories: '500 kcal', servingSize: '1 Portion (350 g)' }), { kcal: 500, g: 350 });
});
test('Unsinnige Werte vom Abgleich werden nicht gezeigt', () => {
  const n = nutritionFor({ ...pasta, nutr: { kcal: -5, p: 1e21, g: 0.01, src: 'x' } });
  assert.equal(n.est.kcal, true);
  assert.equal(n.gEst, true);
  assert.equal(n.src, null);
});

let fail = 0;
for (const [name, fn] of tests) { try { fn(); console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, e.message); } }
console.log(fail ? fail + ' fehlgeschlagen' : 'alle ' + tests.length + ' bestanden');
process.exit(fail ? 1 : 0);
