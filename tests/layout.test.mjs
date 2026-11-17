// Tests fuer die Skalierung der Buehne (Berechnung, Mindestgroesse, Touch-Ziele).
//   node tests/layout.test.mjs
// Das Layout selbst (kein Ueberlauf bei MIN_W x MIN_H) wurde im Browser mit Probe-Skripten geprueft, siehe Bericht.
import assert from 'node:assert/strict';
import { MIN_W, MIN_H, computeFit } from '../app/js/layout.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const VIEWPORTS = [[1180, 820], [1366, 1024], [1194, 834], [1112, 834], [1024, 768], [2360, 1640], [820, 1180], [375, 812]];

test('Mindestgroesse der Buehne: 1160 x 840 Entwurfseinheiten', () => {
  assert.equal(MIN_W, 1160);
  assert.equal(MIN_H, 840);
});

test('Buehne hat immer mindestens MIN_W x MIN_H und fuellt die Flaeche genau', () => {
  for (const [w, h] of VIEWPORTS) {
    const f = computeFit(w, h);
    assert.ok(f.width >= MIN_W - 1e-6 && f.height >= MIN_H - 1e-6, w + 'x' + h);
    assert.ok(Math.abs(f.width * f.scale - w) < 1e-6 && Math.abs(f.height * f.scale - h) < 1e-6, 'fuellt ' + w + 'x' + h);
    assert.ok(Math.abs(f.width - MIN_W) < 1e-6 || Math.abs(f.height - MIN_H) < 1e-6, 'eine Seite liegt genau auf dem Minimum');
  }
});

test('Zielgeraet 1180 x 820: Skalierung nahe 1, Touch-Ziele (48 Einheiten) mindestens 44 px', () => {
  const f = computeFit(1180, 820);
  assert.ok(f.scale >= 0.95 && f.scale <= 1.05, String(f.scale));
  assert.ok(48 * f.scale >= 44);
});

test('Skalierung bleibt bei iPad-Querformaten ueber 0,85 und der Rand ist weg', () => {
  for (const [w, h] of [[1180, 820], [1194, 834], [1112, 834], [1366, 1024], [1024, 768], [2360, 1640]]) {
    assert.ok(computeFit(w, h).scale >= 0.85, w + 'x' + h);
  }
});

test('safe-area: kleinere sichtbare Flaeche gibt kleinere Skalierung, nie negativ', () => {
  const full = computeFit(1180, 820);
  const inset = computeFit(1180 - 40, 820 - 20);
  assert.ok(inset.scale < full.scale && inset.scale > 0);
});

test('Hochformat: skaliert ohne Absturz (Buehne wird hoeher)', () => {
  const f = computeFit(820, 1180);
  assert.ok(f.scale > 0 && f.height > f.width);
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }
}
console.log(passed + '/' + tests.length + ' Tests bestanden');
