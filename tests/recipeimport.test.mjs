// Tests fuer den Rezept-Import (Link, Screenshot-Text, eingefuegter Text). Fiktive Rezepte, kein Netz.
//   node tests/recipeimport.test.mjs
import assert from 'node:assert/strict';
import { splitAmt, ingredientsFromText, stepsFromText, fromLdJson, fromText, importFromUrl, findUrl, decodeEnt, yieldFromText, ogImage, absUrl, wsrvUrl, imageUrlFor } from '../app/js/recipeimport.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('Menge und Zutat trennen', () => {
  assert.deepEqual(splitAmt('500 g Mehl'), { q: '500 g', t: 'Mehl' });
  assert.deepEqual(splitAmt('2 EL Olivenöl'), { q: '2 EL', t: 'Olivenöl' });
  assert.deepEqual(splitAmt('½ Bund Petersilie'), { q: '½ Bund', t: 'Petersilie' });
  assert.deepEqual(splitAmt('Salz'), { q: '', t: 'Salz' });
});

const OCR = `Linsencurry
Zutaten für 4 Portionen
250 g rote Linsen
1 Zwiebel
400 ml Kokosmilch
2 TL Currypulver
Salz

Zubereitung
1. Zwiebel schälen und fein würfeln, dann in
etwas Öl glasig dünsten.
2. Linsen, Kokosmilch und Curry dazugeben und
15 Minuten köcheln lassen.
3. Mit Salz abschmecken und servieren.`;

test('Screenshot-Text: Zutaten nach "Zutaten", Portionen erkannt', () => {
  const r = fromText(OCR, 'Linsencurry');
  assert.deepEqual(r.ingredients.map((z) => (z.q ? z.q + ' ' : '') + z.t), ['250 g rote Linsen', '1 Zwiebel', '400 ml Kokosmilch', '2 TL Currypulver', 'Salz']);
  assert.equal(r.servings, 4);
});

test('Screenshot-Text: umgebrochene Zeilen werden zu ganzen Schritten', () => {
  assert.deepEqual(stepsFromText(OCR), [
    'Zwiebel schälen und fein würfeln, dann in etwas Öl glasig dünsten.',
    'Linsen, Kokosmilch und Curry dazugeben und 15 Minuten köcheln lassen.',
    'Mit Salz abschmecken und servieren.'
  ]);
});

test('Zwei Screenshots (erst Anleitung, dann Zutaten) ergeben ein Rezept', () => {
  const a = 'Zubereitung\nDen Ofen auf 200 Grad vorheizen und das Blech vorbereiten.\n\nAlles mischen und 20 Minuten backen.';
  const b = 'Zutaten\n300 g Kartoffeln\n1 EL Rosmarin\n2 EL Öl';
  const r = fromText(a + '\n\n' + b);
  assert.equal(r.ingredients.length, 3);
  assert.equal(r.steps.length, 2);
});

test('Texterkennung: Leerzeile mitten im Satz trennt den Schritt nicht', () => {
  const t = 'Zubereitung\n1. Zwiebel schälen und fein würfeln,\n\ndann in etwas Öl glasig dünsten.\n\nAlles 15 Minuten köcheln lassen und servieren.';
  assert.deepEqual(stepsFromText(t), ['Zwiebel schälen und fein würfeln, dann in etwas Öl glasig dünsten.', 'Alles 15 Minuten köcheln lassen und servieren.']);
});

test('JSON-LD einer Rezeptseite', () => {
  const html = '<html><script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, {
      '@type': 'Recipe', name: 'Ofengemüse &amp; Feta', recipeYield: ['2', '2 Portionen'], totalTime: 'PT45M', recipeCategory: 'Hauptgericht',
      recipeIngredient: ['400 g Kartoffeln', '1 Paprika', '200 g Feta'],
      recipeInstructions: [{ '@type': 'HowToStep', text: 'Gemüse schneiden.' }, { '@type': 'HowToStep', text: 'Im Ofen 40 Minuten backen.' }],
      image: { url: 'https://beispiel.example/bild.jpg' },
      nutrition: { '@type': 'NutritionInformation', calories: '480 kcal', proteinContent: '18,5 g', fatContent: '22 g', carbohydrateContent: '45 g', servingSize: '1 Portion' }
    }]
  }) + '</script></html>';
  const r = fromLdJson(html);
  assert.equal(r.name, 'Ofengemüse & Feta');
  assert.equal(r.servings, 2);
  assert.equal(r.time, 45);
  assert.equal(r.cat, 'Hauptgericht');
  assert.deepEqual(r.steps, ['Gemüse schneiden.', 'Im Ofen 40 Minuten backen.']);
  assert.equal(r.ingredients.length, 3);
  assert.deepEqual(r.nutr, { kcal: 480, p: 19, f: 22, c: 45 });
});

test('Link-Import ueber r.jina.ai: JSON-LD mit Schritten reicht, nur ein Abruf', async () => {
  const calls = [];
  const html = '<script type="application/ld+json">{"@type":"Recipe","name":"Suppe","recipeIngredient":["1 l Brühe","2 Möhren"],"recipeInstructions":"Alles kochen."}</script>';
  const fake = async (url, opts) => { calls.push([url, opts && opts.headers]); return { ok: true, text: async () => html }; };
  const r = await importFromUrl('https://beispiel.example/suppe', fake);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://r.jina.ai/https://beispiel.example/suppe');
  assert.equal(r.name, 'Suppe');
  assert.equal(r.url, 'https://beispiel.example/suppe');
});

test('Link-Import ohne JSON-LD: Markdown mit Titel', async () => {
  const md = 'Title: Pfannkuchen | Beispielseite\n\nMarkdown Content:\n## Zutaten\n- 250 g Mehl\n- 3 Eier\n- 500 ml Milch\n\n## Zubereitung\nAlles zu einem glatten Teig verrühren und ruhen lassen.\n\nIn der Pfanne dünne Pfannkuchen ausbacken.';
  const fake = async (url, opts) => ({ ok: true, text: async () => (opts && opts.headers ? '<html></html>' : md) });
  const r = await importFromUrl('https://beispiel.example/p', fake);
  assert.equal(r.name, 'Pfannkuchen');
  assert.equal(r.ingredients.length, 3);
  assert.equal(r.steps.length, 2);
});

test('Bild: og:image aus der Seite, relativ wird absolut, nur http(s)', () => {
  const html = '<head><meta name="twitter:image" content="https://x.example/tw.jpg"><meta property="og:image" content="/bilder/suppe.jpg?a=1&amp;b=2"></head>';
  assert.equal(ogImage(html, 'https://beispiel.example/rezept/suppe'), 'https://beispiel.example/bilder/suppe.jpg?a=1&b=2');
  assert.equal(ogImage('<meta name="twitter:image" content="https://x.example/tw.jpg">', 'https://b.example/'), 'https://x.example/tw.jpg');
  assert.equal(ogImage('<meta content="https://x.example/c.jpg" property="og:image">'), 'https://x.example/c.jpg');
  assert.equal(ogImage('<meta property="og:image" content="javascript:alert(1)">', 'https://b.example/'), null);
  assert.equal(absUrl('data:image/png;base64,AAA', 'https://b.example/'), null);
  assert.equal(ogImage('<meta data-content="https://x.example/falsch.jpg" property="og:image" content="https://x.example/it\'s.jpg">'), "https://x.example/it's.jpg");
});

test('Bild: wsrv.nl-Adresse kodiert die Bildadresse', () => {
  const u = wsrvUrl('https://b.example/a b.jpg?x=1&y=2');
  assert.ok(u.startsWith('https://wsrv.nl/?url=https%3A%2F%2Fb.example%2Fa%20b.jpg%3Fx%3D1%26y%3D2&'));
});

test('Link-Import: Bild aus JSON-LD (ImageObject, relativ), sonst og:image', async () => {
  const ld = '<meta property="og:image" content="https://b.example/og.jpg"><script type="application/ld+json">{"@type":"Recipe","name":"Suppe","image":[{"@type":"ImageObject","url":"/img/suppe.jpg"}],"recipeIngredient":["1 l Brühe","2 Möhren"],"recipeInstructions":"Alles kochen."}</script>';
  const r = await importFromUrl('https://b.example/suppe', async () => ({ ok: true, text: async () => ld }));
  assert.equal(r.image, 'https://b.example/img/suppe.jpg');
  const noImg = ld.replace(/"image":\[[^\]]*\],/, '');
  const r2 = await importFromUrl('https://b.example/suppe', async () => ({ ok: true, text: async () => noImg }));
  assert.equal(r2.image, 'https://b.example/og.jpg');
  const md = 'Title: Pfannkuchen\n\nMarkdown Content:\n## Zutaten\n- 250 g Mehl\n- 3 Eier\n';
  const r3 = await importFromUrl('https://b.example/p', async (u, o) => ({ ok: true, text: async () => (o && o.headers ? '<meta property="og:image" content="https://b.example/p.jpg">' : md) }));
  assert.equal(r3.image, 'https://b.example/p.jpg');
  const r4 = await importFromUrl('https://b.example/p', async (u, o) => ({ ok: true, text: async () => (o && o.headers ? '<html></html>' : md) }));
  assert.equal(r4.image, null);
});

test('Bild nachholen: nur die Bildadresse eines Links', async () => {
  const html = '<meta property="og:image" content="https://b.example/og.jpg">';
  assert.equal(await imageUrlFor('https://b.example/x', async () => ({ ok: true, text: async () => html })), 'https://b.example/og.jpg');
  assert.equal(await imageUrlFor('https://b.example/x', async () => ({ ok: true, text: async () => '' })), null);
});

test('Link-Import: Fehler vom Dienst wird gemeldet', async () => {
  const fake = async () => ({ ok: false, text: async () => '' });
  await assert.rejects(() => importFromUrl('https://beispiel.example/x', fake));
});

test('Link-Import: Fehlerseite (404) wird als Fehler gemeldet, nicht als Rezept', async () => {
  const md = 'Title: Fehler 404\nWarning: Target URL returned error 404: Not Found\n\nMarkdown Content:\nSeite nicht gefunden';
  const fake = async () => ({ ok: true, text: async () => md });
  await assert.rejects(() => importFromUrl('https://beispiel.example/weg', fake));
});

test('Fehlerseite nur am Titel erkennbar und Portionen-Zeile ist keine Zutat', async () => {
  const fake = async (u, o) => ({ ok: true, text: async () => (o && o.headers ? '' : 'Title: Fehler 404\n\nMarkdown Content:\nNichts') });
  await assert.rejects(() => importFromUrl('https://beispiel.example/weg', fake));
  assert.deepEqual(ingredientsFromText('Zutaten\n4 Portionen\n1 Zwiebel\n2 cm Ingwer').map((z) => z.t), ['Zwiebel', 'Ingwer']);
});

test('Lange Seite ohne Zutatenblock und ohne Mengen liefert keine Zutaten', () => {
  const t = Array.from({ length: 40 }, (_, i) => 'Menüpunkt Nummer ' + i).join('\n');
  assert.deepEqual(ingredientsFromText(t), []);
  assert.equal(ingredientsFromText('Milch\nBrot\nKäse').length, 3);
});

test('Link aus Text herausfinden, nur http und https', () => {
  assert.equal(findUrl('Schau mal: https://beispiel.example/rezept?id=1 lecker'), 'https://beispiel.example/rezept?id=1');
  assert.equal(findUrl('javascript:alert(1)'), null);
  assert.equal(findUrl('kein Link'), null);
});

test('HTML-Zeichen werden ohne DOM entschluesselt', () => {
  assert.equal(decodeEnt('Gr&uuml;&szlig;e &amp; &#228;&#x00F6;'), 'Grüße & äö');
  assert.equal(yieldFromText('Zutaten für 2 Personen').t, 'Portionen');
});

test('Menge hinten in Klammern wird abgetrennt, Beschreibungen in Klammern bleiben', () => {
  assert.deepEqual(splitAmt('Champignons (300 g)'), { q: '300 g', t: 'Champignons' });
  assert.deepEqual(splitAmt('Sesamöl (2 TL (14 ml))'), { q: '2 TL (14 ml)', t: 'Sesamöl' });
  assert.deepEqual(splitAmt('Zwiebel (rot)'), { q: '', t: 'Zwiebel (rot)' });
  assert.deepEqual(splitAmt('Chilipulver (nach Belieben)'), { q: '', t: 'Chilipulver (nach Belieben)' });
});

let ok = 0;
for (const [name, fn] of tests) {
  try { await fn(); ok++; } catch (e) { console.error('FEHLER: ' + name + '\n  ' + e.message); }
}
console.log(ok + '/' + tests.length + ' Tests bestanden');
if (ok !== tests.length) process.exit(1);
