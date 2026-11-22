// Naehrwerte: Werte der Rezeptseite (schema.org) oder Schaetzung aus den Zutaten mit einer kleinen Tabelle.
// Ohne DOM, testbar unter Node (tests/nutrition.test.mjs). Werte pro 100 g: kcal, Eiweiss, Fett, Kohlenhydrate.
// Stueck = Gramm fuer ein Stueck, falls sinnvoll. Reihenfolge egal, der laengste Treffer gewinnt.
const FOODS = [
  // [Suchwoerter, kcal, Eiweiss, Fett, KH, Stueck-g]. "=" vorn: nur als ganzes Wort (z. B. "=ei" nicht in "Reis").
  // Getreide, Teigwaren, Backzutaten
  [['nudeln', 'pasta', 'spaghetti', 'penne', 'fusilli', 'tagliatelle', 'makkaroni', 'farfalle', 'rigatoni', 'linguine', 'lasagneplatten', 'bandnudeln', 'spätzle'], 355, 12, 1.5, 71],
  [['gnocchi'], 150, 4, 0.5, 33],
  [['tortellini', 'ravioli'], 300, 12, 8, 45],
  [['reisnudeln', 'glasnudeln'], 360, 6, 0.6, 82],
  [['=reis', 'basmati', 'jasminreis', 'risottoreis', 'milchreis', 'langkornreis', 'vollkornreis', 'wildreis'], 350, 7, 0.6, 78],
  [['couscous', 'bulgur'], 355, 12, 1.5, 72],
  [['quinoa'], 365, 14, 6, 64],
  [['hirse'], 355, 10, 4, 69],
  [['polenta', 'maisgrieß', 'maismehl'], 350, 8, 1, 75],
  [['grieß'], 330, 11, 0.8, 69],
  [['haferflocken'], 370, 13, 7, 59],
  [['müsli'], 370, 9, 7, 64],
  [['mehl', 'weizenmehl', 'dinkelmehl'], 345, 10, 1, 72],
  [['vollkornmehl'], 330, 12, 2, 60],
  [['speisestärke', 'stärke', 'maisstärke', 'kartoffelstärke'], 350, 0.4, 0.1, 86],
  [['paniermehl', 'semmelbrösel'], 360, 11, 2, 73],
  [['brot', 'toastbrot', 'toast', 'baguette', 'ciabatta'], 255, 8.5, 2, 48, 50],
  [['vollkornbrot'], 220, 7, 1.5, 40, 50],
  [['brötchen', 'semmel'], 270, 9, 1.5, 54, 55],
  [['tortilla', 'wrap', 'fladenbrot'], 300, 8, 7, 50, 60],
  [['blätterteig'], 400, 6, 25, 37],
  [['pizzateig', 'hefeteig'], 260, 7, 4, 48],
  [['hefe', 'trockenhefe'], 100, 12, 1, 8],
  [['zucker', 'rohrzucker', 'puderzucker', 'gelierzucker', 'brauner zucker', 'vanillezucker'], 400, 0, 0, 100],
  [['honig'], 305, 0.4, 0, 82],
  [['ahornsirup', 'agavendicksaft', 'sirup'], 260, 0, 0, 67],
  [['marmelade', 'konfitüre'], 250, 0.4, 0.1, 60],
  [['schokolade', 'zartbitterschokolade', 'kuvertüre', 'schokotropfen'], 540, 7, 31, 55],
  [['kakao', 'kakaopulver'], 350, 20, 21, 11],
  [['nutella', 'nussnougatcreme'], 540, 6, 31, 57],
  [['kekse', 'butterkekse', 'löffelbiskuit'], 440, 7, 12, 75],
  // Gemuese
  [['kartoffel', 'kartoffeln', 'drillinge'], 75, 2, 0.1, 15, 120],
  [['süßkartoffel'], 86, 1.6, 0.1, 20, 250],
  [['tomate', 'tomaten', 'cocktailtomaten', 'kirschtomaten', 'cherrytomaten', 'rispentomaten'], 18, 1, 0.2, 3, 100],
  [['passierte tomaten', 'gehackte tomaten', 'stückige tomaten', 'tomaten aus der dose', 'dosentomaten', 'pizzatomaten', 'polpa'], 30, 1.4, 0.2, 5],
  [['tomatenmark'], 80, 4.5, 0.5, 13],
  [['getrocknete tomaten'], 210, 5, 14, 15],
  [['zwiebel', 'zwiebeln', 'rote zwiebel', 'schalotte', 'schalotten'], 40, 1.2, 0.1, 8, 80],
  [['frühlingszwiebel', 'lauchzwiebel'], 30, 1.8, 0.2, 5, 15],
  [['lauch', 'porree'], 30, 2, 0.3, 4, 250],
  [['knoblauch', 'knoblauchzehe'], 140, 6, 0.5, 28, 4],
  [['karotte', 'karotten', 'möhre', 'möhren'], 36, 0.9, 0.2, 7, 80],
  [['paprika', 'paprikaschote', 'spitzpaprika'], 30, 1, 0.3, 5, 150],
  [['zucchini'], 20, 1.6, 0.4, 2, 250],
  [['aubergine'], 24, 1.2, 0.2, 3, 300],
  [['gurke', 'salatgurke'], 13, 0.6, 0.2, 2, 400],
  [['brokkoli'], 34, 3.5, 0.3, 3, 400],
  [['blumenkohl'], 25, 2.5, 0.3, 2.5, 800],
  [['rosenkohl'], 40, 4.5, 0.3, 3],
  [['grünkohl'], 45, 4.3, 0.9, 2.5],
  [['weißkohl', 'rotkohl', 'spitzkohl', 'wirsing', 'kohl'], 28, 1.4, 0.2, 4.5, 1000],
  [['sauerkraut'], 20, 1.5, 0.3, 1],
  [['chinakohl', 'pak choi'], 14, 1.2, 0.2, 1.5, 500],
  [['spinat', 'babyspinat', 'blattspinat'], 20, 2.5, 0.4, 1],
  [['salat', 'kopfsalat', 'eisbergsalat', 'rucola', 'feldsalat', 'römersalat', 'blattsalat'], 15, 1.3, 0.2, 1.5, 300],
  [['champignon', 'champignons', 'pilze', 'steinpilze', 'pfifferlinge', 'kräuterseitlinge', 'shiitake'], 22, 3, 0.3, 0.5],
  [['kürbis', 'hokkaido', 'butternut'], 30, 1, 0.2, 6, 1000],
  [['sellerie', 'staudensellerie', 'knollensellerie'], 18, 1.2, 0.2, 2.5, 50],
  [['fenchel'], 20, 2.4, 0.3, 3, 250],
  [['spargel'], 18, 1.9, 0.1, 2],
  [['rote bete', 'rote beete'], 42, 1.5, 0.1, 8, 150],
  [['radieschen', 'rettich'], 16, 1, 0.1, 2.5],
  [['kohlrabi'], 25, 2, 0.1, 4, 300],
  [['pastinake', 'petersilienwurzel'], 60, 1.5, 0.4, 12, 150],
  [['grüne bohnen', 'brechbohnen', 'buschbohnen'], 30, 2, 0.2, 5],
  [['erbsen', 'tk-erbsen'], 80, 5.5, 0.4, 12],
  [['mais', 'maiskörner'], 90, 3, 1.2, 16],
  [['zuckerschoten', 'zuckererbsen', 'kaiserschoten'], 40, 3, 0.2, 6],
  [['ingwer'], 80, 1.8, 0.8, 15, 20],
  [['chilischote', 'peperoni', 'jalapeño'], 40, 2, 0.4, 7, 15],
  [['oliven'], 150, 1.2, 15, 2],
  [['kapern'], 25, 2.4, 0.9, 2],
  [['avocado'], 200, 2, 20, 2, 200],
  // Huelsenfruechte
  [['rote linsen', 'linsen', 'berglinsen', 'belugalinsen'], 340, 24, 1.5, 52],
  [['kichererbsen'], 125, 7, 2.5, 17],
  [['getrocknete kichererbsen'], 360, 19, 6, 50],
  [['bohnen', 'kidneybohnen', 'weiße bohnen', 'schwarze bohnen', 'cannellini'], 100, 7, 0.5, 15],
  [['edamame', 'sojabohnen'], 120, 11, 5, 9],
  // Obst
  [['apfel', 'äpfel'], 52, 0.3, 0.2, 12, 150],
  [['birne', 'birnen'], 55, 0.5, 0.3, 12, 170],
  [['banane', 'bananen'], 90, 1.1, 0.3, 21, 120],
  [['orange', 'orangen', 'mandarine', 'clementine', 'orangensaft'], 45, 1, 0.2, 9, 150],
  [['zitrone', 'zitronen', 'zitronensaft', 'limette', 'limetten', 'limettensaft'], 30, 0.7, 0.3, 7, 60],
  [['kirschen', 'sauerkirschen'], 55, 1, 0.3, 12],
  [['beeren', 'erdbeeren', 'himbeeren', 'heidelbeeren', 'blaubeeren', 'brombeeren', 'johannisbeeren'], 40, 1, 0.4, 7],
  [['pfirsich', 'nektarine', 'aprikose', 'aprikosen', 'pflaumen', 'zwetschgen'], 45, 0.9, 0.1, 10, 120],
  [['mango'], 60, 0.8, 0.4, 13, 300],
  [['ananas'], 50, 0.5, 0.1, 12],
  [['trauben', 'weintrauben'], 70, 0.7, 0.2, 16],
  [['rosinen', 'datteln', 'getrocknete aprikosen', 'trockenobst', 'cranberries'], 300, 2.5, 0.5, 70],
  [['kokosraspeln'], 650, 6, 62, 6],
  // Nuesse, Saaten
  [['nüsse', 'mandeln', 'walnüsse', 'walnusskerne', 'haselnüsse', 'cashew', 'cashewkerne', 'pekannüsse', 'pistazien', 'gemahlene mandeln'], 620, 18, 55, 12],
  [['erdnüsse', 'erdnussbutter', 'erdnussmus'], 590, 25, 49, 12],
  [['sesam', 'tahin', 'tahini'], 590, 18, 50, 12],
  [['pinienkerne'], 670, 14, 68, 4],
  [['sonnenblumenkerne', 'kürbiskerne', 'leinsamen', 'chiasamen'], 560, 22, 45, 12],
  // Fette, Oele
  [['olivenöl', '=öl', 'rapsöl', 'sonnenblumenöl', 'sesamöl', 'kokosöl', 'pflanzenöl', 'bratöl', 'speiseöl'], 884, 0, 100, 0],
  [['butter', 'margarine', 'butterschmalz', 'ghee'], 740, 0.7, 83, 0.6],
  [['mayonnaise', 'mayo'], 680, 1, 75, 1],
  // Milchprodukte, Eier
  [['milch', 'vollmilch', 'fettarme milch', 'buttermilch'], 64, 3.3, 3.5, 4.8],
  [['hafermilch', 'sojamilch', 'mandelmilch', 'pflanzendrink', 'haferdrink'], 45, 1, 1.5, 6],
  [['sahne', 'schlagsahne', 'kochsahne', 'süße sahne'], 300, 2.4, 30, 3],
  [['saure sahne', 'schmand', 'crème fraîche', 'creme fraiche', 'sauerrahm'], 240, 2.5, 24, 3],
  [['kokosmilch'], 180, 2, 18, 3],
  [['joghurt', 'naturjoghurt', 'griechischer joghurt'], 70, 4, 3.5, 4.5],
  [['quark', 'magerquark', 'skyr'], 70, 12, 0.3, 4],
  [['frischkäse', 'mascarpone'], 280, 6, 27, 3],
  [['ricotta', 'hüttenkäse', 'körniger frischkäse'], 120, 11, 6, 3],
  [['parmesan', 'grana padano', 'pecorino'], 400, 33, 29, 0],
  [['mozzarella'], 250, 18, 19, 1, 125],
  [['feta', 'hirtenkäse', 'schafskäse', 'halloumi'], 270, 17, 22, 1],
  [['käse', 'gouda', 'emmentaler', 'cheddar', 'bergkäse', 'reibekäse', 'geriebener käse', 'raclettekäse'], 360, 26, 28, 0.5],
  [['=ei', '=eier'], 155, 13, 11, 1, 60],
  [['eiweiß', 'eiklar'], 48, 11, 0.2, 0.7, 33],
  [['eigelb'], 350, 16, 32, 0.3, 18],
  // Fleisch, Fisch, Ersatz
  [['hackfleisch', '=hack', 'gemischtes hack', 'rinderhack'], 250, 18, 20, 0],
  [['hähnchen', 'hähnchenbrust', 'hähnchenbrustfilet', 'hühnchen', 'hühnerbrust', 'putenbrust', 'pute', 'hähnchenschenkel'], 115, 23, 2, 0],
  [['rind', 'rindfleisch', 'steak', 'gulasch', 'rinderhüfte', 'roastbeef'], 150, 21, 7, 0],
  [['schwein', 'schweinefleisch', 'schnitzel', 'schweinefilet', 'kotelett', 'nacken'], 160, 20, 9, 0],
  [['lamm', 'lammfleisch'], 200, 19, 14, 0],
  [['speck', 'bacon', 'pancetta', 'schinkenwürfel'], 330, 14, 30, 0],
  [['schinken', 'kochschinken', 'serrano', 'parmaschinken'], 140, 20, 6, 1],
  [['salami', 'chorizo'], 400, 22, 34, 1],
  [['würstchen', 'wurst', 'bratwurst', 'wiener'], 290, 13, 26, 1, 80],
  [['lachs', 'lachsfilet', 'räucherlachs'], 200, 20, 13, 0],
  [['fisch', 'fischfilet', 'kabeljau', 'seelachs', 'dorsch', 'forelle', 'zander'], 85, 18, 1, 0],
  [['thunfisch'], 115, 26, 1, 0],
  [['garnelen', 'shrimps', 'scampi'], 90, 19, 1.5, 0],
  [['tofu', 'räuchertofu'], 120, 13, 7, 2],
  [['tempeh'], 190, 19, 11, 9],
  [['seitan'], 140, 25, 2, 4],
  // Saucen, Fluessiges
  [['brühe', 'gemüsebrühe', 'hühnerbrühe', 'rinderbrühe', 'hähnchenbrühe', 'geflügelbrühe', 'gemüsefond', 'kalbsfond', 'hühnerfond', 'fond'], 5, 0.5, 0.2, 0.5],
  [['=wasser'], 0, 0, 0, 0],
  [['weißwein', 'rotwein', 'wein'], 80, 0.1, 0, 2],
  [['ketchup'], 110, 1.5, 0.2, 25],
  [['pesto'], 450, 5, 45, 6],
  [['hummus'], 250, 7, 18, 14],
  [['ajvar'], 70, 1.5, 4, 7],
  [['currypaste'], 120, 2, 8, 10],
  [['erdnusssauce', 'teriyaki', 'hoisin', 'sweet chili'], 200, 3, 3, 40]
];
// Zaehlt nicht mit (kleine Mengen ohne Gewicht). Ohne \b vorn, damit auch "Meersalz" oder "Cayennepfeffer" passt.
const MINOR = /(salz|pfeffer|gewürz|curry|paprikapulver|zimt|muskat|oregano|basilikum|petersilie|schnittlauch|koriander|thymian|rosmarin|dill|minze|kräuter|chili|kreuzkümmel|kurkuma|lorbeer|backpulver|natron|vanille|essig|sojasauce|sojasoße|senf)/;
const UNIT_G = { g: 1, gr: 1, gramm: 1, kg: 1000, kilo: 1000, mg: 0.001, ml: 1, l: 1000, liter: 1000, dl: 100, cl: 10, el: 12, esslöffel: 12, tl: 4, teelöffel: 4, prise: 0.5, msp: 0.5, dose: 400, becher: 200, tasse: 150, glas: 350, gläser: 350, zehe: 4, scheibe: 25, handvoll: 30, bund: 30, bd: 30, schuss: 20, spritzer: 5, knolle: 50, packung: 250 };
// Einheiten, deren Gewicht vom Lebensmittel abhaengt
const PACK = /^(pck|pkg|päckchen|packung|würfel)$/;
const FR = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
const WORD = /[a-zäöüß]/;

const norm = (s) => String(s || '').toLowerCase();
// Laengster Treffer gewinnt. Gleich lang: der am Wortende (im Deutschen steht das Grundwort hinten, "Zuckererbsen").
export function matchFood(name) {
  const n = norm(name);
  let best = null;
  let score = 0;
  FOODS.forEach((f) => f[0].forEach((k) => {
    const whole = k[0] === '=';
    const w = whole ? k.slice(1) : k;
    if (w.length * 2 + 1 <= score) return;
    let i = n.indexOf(w);
    while (i >= 0) {
      const endOk = !WORD.test(n[i + w.length] || '');
      const startOk = !WORD.test(n[i - 1] || '');
      if (!whole || (startOk && endOk)) {
        const sc = w.length * 2 + (endOk ? 1 : 0);
        if (sc > score) { best = f; score = sc; }
      }
      i = n.indexOf(w, i + 1);
    }
  }));
  return best;
}
// "1 ½ EL" -> {n: 1.5, unit: 'el'}; "1 1/2", Bereiche "2-3" nehmen den Mittelwert, "1.000 g" mit Tausenderpunkt
export function parseQty(q) {
  let s = norm(q).replace(/^(ca\.?|etwa)\s*/, '');
  s = s.replace(/^([1-9]\d{0,2})\.(\d{3})(?!\d)(?=\s*(?:g|gr|gramm|ml)?\b)/, '$1$2');
  const m = s.match(/^(\d+(?:[.,]\d+)?)?(?:\s+(\d+)\s*\/\s*(\d+)|\s*\/\s*(\d+))?\s*([½¼¾⅓⅔])?(?:\s*-\s*(\d+(?:[.,]\d+)?))?\s*([a-zäöüß]+)?/);
  if (!m || (!m[1] && !m[5])) return null;
  let n = m[1] ? parseFloat(m[1].replace(',', '.')) : 0;
  if (m[2]) n += +m[2] / +m[3];
  if (m[4] && m[1]) n = n / +m[4];
  if (m[5]) n += FR[m[5]];
  if (m[6]) n = (n + parseFloat(m[6].replace(',', '.'))) / 2;
  const w = m[7] || '';
  const unit = [w, w.replace(/n$/, ''), w.replace(/en$/, ''), w.replace(/e$/, '')].find((x) => UNIT_G[x] || PACK.test(x)) || w;
  return { n, unit };
}
function grams(q, food, name) {
  const p = parseQty(q);
  if (!p || !(p.n > 0)) return null;
  let g = null;
  if (UNIT_G[p.unit]) g = p.n * UNIT_G[p.unit];
  else if (PACK.test(p.unit)) {
    // Paeckchen Zucker oder Backpulver, Wuerfel Hefe oder Bruehe, sonst Stueckgewicht oder eine Packung
    const nm = norm(name);
    if (p.unit === 'würfel') g = p.n * (/hefe/.test(nm) ? 42 : 10);
    else g = p.n * (/zucker|hefe|backpulver|natron|vanille|gelatine/.test(nm) ? 10 : (food && food[5]) || 250);
  } else if (food && food[5]) g = p.n * food[5]; // ohne Einheit, "Stück" oder Beiwort ("1 kleine Zwiebel")
  return g != null && g <= 10000 ? g : null;
}

// Schaetzung pro Portion aus den Zutaten. ok=false heisst: zu wenig erkannt.
export function estimate(rec) {
  const sum = { kcal: 0, p: 0, f: 0, c: 0 };
  let known = 0;
  let missing = 0;
  const unknown = [];
  (rec.ingredients || []).forEach((z) => {
    const food = matchFood(z.t);
    const minor = MINOR.test(norm(z.t));
    if (!food && minor) return;
    // Wasser zaehlt nicht mit: Nudelwasser wuerde pro 100 g stark verduennen
    if (food && food[1] === 0 && food[0][0] === '=wasser') return;
    const g = grams(z.q, food, z.t);
    if (food && g != null) {
      known += g;
      sum.kcal += food[1] * g / 100; sum.p += food[2] * g / 100; sum.f += food[3] * g / 100; sum.c += food[4] * g / 100;
    } else if (food && minor) { /* Gewuerz ohne Menge */ } else {
      unknown.push(z.t);
      // Unbekannte Menge: ohne Angabe wenig Gewicht annehmen ("Öl zum Braten"), sonst ein Stueck von 100 g
      missing += g != null ? g : (parseQty(z.q) ? 100 : 30);
    }
  });
  const sv = Math.max(1, Number(rec.servings) || 1);
  const ok = known > 0 && known / (known + missing) >= 0.7;
  const r = (v) => Math.round(v / sv);
  return { ok, kcal: r(sum.kcal), p: r(sum.p), f: r(sum.f), c: r(sum.c), g: Math.round(known / sv), unknown };
}

// Zahl aus Text, "1.050" und "1,050" mit genau drei Ziffern danach gelten als Tausender
function readNum(t) {
  if (!t) return null;
  const v = /^\d{1,3}(?:[.,]\d{3})+$/.test(t) ? parseFloat(t.replace(/[.,]/g, '')) : parseFloat(t.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}
const NUM = '(\\d{1,3}(?:[.,]\\d{3})+|\\d+(?:[.,]\\d+)?)';
// schema.org NutritionInformation -> {kcal, p, f, c, g?} (pro Portion)
export function fromLdNutrition(n) {
  if (!n || typeof n !== 'object') return null;
  const str = (v) => String(v == null ? '' : v);
  const out = {};
  const set = (k, v) => { if (v != null && v >= 0 && v < 10000) out[k] = Math.round(v); };
  // kcal: bevorzugt die Zahl vor "kcal", Angaben in kJ nie nehmen
  const cal = str(n.calories);
  const mk = cal.match(new RegExp(NUM + '\\s*kcal', 'i'));
  if (mk) set('kcal', readNum(mk[1]));
  else if (!/kj/i.test(cal)) { const m = cal.match(new RegExp(NUM)); if (m) set('kcal', readNum(m[1])); }
  [['p', n.proteinContent], ['f', n.fatContent], ['c', n.carbohydrateContent]].forEach(([k, v]) => {
    const m = str(v).match(new RegExp(NUM)); if (m) set(k, readNum(m[1]));
  });
  const ms = str(n.servingSize).match(new RegExp(NUM + '\\s*g\\b', 'i'));
  if (ms) { const g = readNum(ms[1]); if (g >= 20 && g <= 3000) out.g = Math.round(g); }
  return Object.keys(out).length ? out : null;
}

// Gespeicherte Werte pruefen (koennen vom Abgleich kommen)
const okVal = (v) => Number.isFinite(v) && v >= 0 && v < 10000;
export const okGrams = (v) => Number.isFinite(v) && v >= 20 && v <= 3000;

// Anzeige: gespeicherte Werte (Seite oder eigene) vor Schaetzung. est[k] = true heisst "ca.".
export function nutritionFor(rec) {
  const e = estimate(rec);
  const s = rec.nutr && typeof rec.nutr === 'object' ? rec.nutr : {};
  const stored = ['kcal', 'p', 'f', 'c'].some((k) => okVal(s[k]));
  const out = { portion: {}, per100: {}, est: {}, src: stored ? (s.src === 'page' ? 'page' : 'user') : null, unknown: e.unknown };
  ['kcal', 'p', 'f', 'c'].forEach((k) => {
    if (okVal(s[k])) { out.portion[k] = Math.round(s[k]); out.est[k] = false; } else if (e.ok) { out.portion[k] = e[k]; out.est[k] = true; } else out.portion[k] = null;
  });
  const g = okGrams(s.g) ? s.g : (e.ok && e.g > 0 ? e.g : null);
  ['kcal', 'p', 'f', 'c'].forEach((k) => { out.per100[k] = g && out.portion[k] != null ? Math.round(out.portion[k] * 100 / g) : null; });
  out.gEst = !okGrams(s.g);
  return out;
}
