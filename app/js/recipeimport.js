// Rezept-Import: Link (ueber r.jina.ai, die App hat keinen eigenen Server), Screenshots (Texterkennung auf dem
// Geraet mit Tesseract) oder eingefuegter Text. Erkennungslogik uebernommen aus der Partner-App, hier ohne DOM,
// damit sie unter Node testbar ist (tests/recipeimport.test.mjs). Netzwerk und Tesseract werden hereingereicht.

import { fromLdNutrition } from './nutrition.js';

const UNITS = 'kg|kilo|gramm|g|gr|mg|ml|cl|dl|l|liter|cm|mm|el|tl|esslöffel|teelöffel|stängel|msp|prise[n]?|bund|bd|dose[n]?|pck|pkg|packung(?:en)?|päckchen|becher|glas|gläser|tasse[n]?|stück|stk|scheibe[n]?|zehe[n]?|handvoll|zweig[e]?|blatt|blätter|knolle[n]?|kopf|köpfe|stange[n]?|stiel[e]?|würfel|tüte[n]?|beutel|flasche[n]?|schuss|spritzer|cup[s]?|tbsp|tsp|oz|lb';
const AMT_RE = new RegExp('^((?:ca\\.?\\s*|etwa\\s*)?[\\d½¼¾⅓⅔⅛][\\d½¼¾⅓⅔⅛.,/\\s–-]*)\\s*(?:(' + UNITS + ')\\.?(?=\\s|$))?\\s*(.*)$', 'i');
const STOP_HEAD = /^(zubereitung|anleitung|so geht'?s|so wird'?s gemacht|instructions|method|schritt|nährwerte|notizen|tipps?|kommentare)\b/i;
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', frac12: '½', frac14: '¼', frac34: '¾', ndash: '-', mdash: '-', deg: '°' };

export function decodeEnt(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENT[e] !== undefined ? ENT[e] : m;
  });
}
export function cleanLine(s) {
  return decodeEnt(String(s || '')).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, ' ')
    .replace(/^\s*(?:[*+•·▢☐□◻○●-]|\d+\.(?=\s)|\[[ xX]?\])\s*/, '').replace(/^\s*(?:▢|☐|□)\s*/, '').replace(/[*_`#]+/g, '').replace(/\s+/g, ' ').trim();
}
// "500 g Mehl" -> {q: '500 g', t: 'Mehl'}
export function splitAmt(line) {
  const m = String(line).match(AMT_RE);
  if (!m || !m[3]) return { q: '', t: String(line).trim() };
  let q = m[1].trim().replace(/\s*[–-]\s*/g, '-');
  if (m[2]) q += ' ' + m[2];
  return { q: q.trim(), t: m[3].replace(/^(?:x\s+)/i, '').trim() || String(line).trim() };
}
function looksIngredient(s) {
  return s.length > 1 && s.length <= 70 && /[a-zäöüß]/i.test(s) && !/[.!?]$/.test(s.replace(/\b(ca|bzw|evtl|ggf|z\.b|stk|pck|el|tl)\.$/i, ''))
    && !/^(zutaten|für (das|den|die)\b.*:?$|portionen?\b)/i.test(s) && !/^\d+\s*(portionen?|personen?|stücke?)$/i.test(s);
}
const key = (q, t) => (q + ' ' + t).toLowerCase().replace(/\s+/g, ' ').trim();
function toItems(lines) {
  const out = [];
  const seen = new Set();
  lines.forEach((l) => {
    const c = cleanLine(l);
    if (!looksIngredient(c)) return;
    const it = splitAmt(c);
    const k = key(it.q, it.t);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(it);
  });
  return out.slice(0, 60);
}

// Zutaten aus freiem Text: bevorzugt der Block nach "Zutaten", sonst alle Zeilen mit Mengenangabe
export function ingredientsFromText(txt) {
  const lines = String(txt || '').split(/\r?\n/);
  let best = null;
  lines.forEach((l, idx) => {
    if (!/^\W*(?:#+\s*)?\**\s*zutaten\b/i.test(l.trim())) return;
    const got = [];
    for (let j = idx + 1; j < lines.length && j < idx + 90; j++) {
      const raw = lines[j].trim();
      if (!raw) continue;
      const c = cleanLine(raw);
      if (STOP_HEAD.test(c) && (/^#|^\*\*/.test(raw) || c.length < 40)) break;
      const isList = /^\s*(?:[*+•·▢☐□-]|\d+\.\s|\[[ xX]?\])/.test(raw);
      if (/^#/.test(raw) || (!isList && /:$/.test(c))) continue;
      got.push(raw);
    }
    const its = toItems(got);
    if (its.length >= 2 && (!best || its.length > best.length)) best = its;
  });
  if (best) return best;
  const amt = lines.filter((l) => AMT_RE.test(cleanLine(l)));
  if (amt.length >= 2) return toItems(amt);
  // Ohne Ueberschrift und Mengen: nur kurze Listen (eingefuegter Zettel) zeilenweise, lange Seiten nicht (sonst Unsinn)
  return lines.filter((l) => l.trim()).length <= 25 ? toItems(lines) : [];
}

// Arbeitsschritte aus freiem Text: Block nach "Zubereitung" o. ae.
export function stepsFromText(txt) {
  const lines = String(txt || '').split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const c = cleanLine(lines[i]);
    if (/^(zubereitung|anleitung|so geht'?s|so wird'?s gemacht|und so geht'?s)\b/i.test(c) && c.length < 40) { start = i; break; }
  }
  if (start < 0) return [];
  const out = [];
  let buf = '';
  const flush = () => { if (buf.length >= 20) out.push(buf.slice(0, 600)); buf = ''; };
  let gap = false; // Leerzeile gesehen: neuer Schritt, ausser der Satz geht offensichtlich weiter
  for (let j = start + 1; j < lines.length && out.length < 40; j++) {
    const raw = lines[j].trim();
    const c = cleanLine(raw);
    if (!raw) { gap = true; continue; }
    if (gap) {
      gap = false;
      const goesOn = buf && !/[.!?:)]$/.test(buf) && /^[a-zäöüß]/.test(c);
      if (!goesOn) flush();
    }
    if (/^#/.test(raw) && (out.length || buf)) break;
    if (/^(zutaten|nährwerte|tipps?|notizen|kommentare|das könnte|weitere rezepte|teilen|bewertung)\b/i.test(c) && (out.length || buf)) break;
    if (/^(zubereitung|schritt \d+)$/i.test(c)) { flush(); continue; }
    // Neue Nummer oder Aufzaehlung beginnt einen neuen Schritt, sonst haengt die Zeile am vorigen (Screenshots brechen um)
    if (/^\s*(?:\d+[.)]\s|[*•·-]\s)/.test(raw)) flush();
    buf = buf ? buf + ' ' + c : c;
  }
  flush();
  return out;
}

export function yieldFromText(txt) {
  const m = String(txt || '').match(/(?:zutaten\s+)?für\s+(\d{1,2})\s+(portionen?|personen?|gläser|glas|stück|stücke|muffins|kekse)/i);
  return m ? { n: +m[1], t: m[2].replace(/^personen?$/i, 'Portionen') } : null;
}

function isoMin(t) {
  const m = String(t || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return 0;
  return (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0);
}
function ldSteps(x) {
  const out = [];
  const add = (t) => { const c = cleanLine(t); if (c.length > 3) out.push(c.slice(0, 600)); };
  const walk = (o) => {
    if (!o) return;
    if (typeof o === 'string') { o.split(/\r?\n+/).forEach(add); return; }
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o.itemListElement) { walk(o.itemListElement); return; }
    if (o.text) add(o.text); else if (o.name) add(o.name);
  };
  walk(x);
  return out.slice(0, 40);
}
const yieldNum = (y) => { const m = [].concat(y || []).map(String).join(' ').match(/\d+/); return m ? Math.min(+m[0], 50) : null; };
function ldImage(i) { const v = [].concat(i || [])[0]; return typeof v === 'string' ? v : (v && (v.url || v.contentUrl)) || null; }
function ldCategory(r) { const c = [].concat(r.recipeCategory || [])[0]; return c ? cleanLine(c).slice(0, 30) : ''; }

// Strukturierte Rezeptdaten (schema.org/Recipe in JSON-LD) aus HTML
export function fromLdJson(html) {
  const blocks = [...String(html).matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const walk = (o) => {
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o)) { for (const x of o) { const r = walk(x); if (r) return r; } return null; }
    if ([].concat(o['@type']).some((t) => String(t).toLowerCase() === 'recipe') && Array.isArray(o.recipeIngredient)) return o;
    return walk(o['@graph']);
  };
  for (const b of blocks) {
    try {
      const r = walk(JSON.parse(b.trim()));
      if (r) {
        const items = toItems(r.recipeIngredient);
        if (items.length) {
          return {
            name: cleanLine(r.name || '').slice(0, 60), ingredients: items, steps: ldSteps(r.recipeInstructions),
            servings: yieldNum(r.recipeYield), time: isoMin(r.totalTime) || (isoMin(r.prepTime) + isoMin(r.cookTime)) || 0,
            image: ldImage(r.image), cat: ldCategory(r), nutr: fromLdNutrition([].concat(r.nutrition || [])[0])
          };
        }
      }
    } catch (e) { /* naechster Block */ }
  }
  return null;
}

// Adresse absolut machen (Bilder stehen oft relativ in der Seite), nur http und https
export function absUrl(u, base) {
  if (!u || typeof u !== 'string') return null;
  try {
    const x = new URL(decodeEnt(u.trim()), base || undefined);
    return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null;
  } catch (e) { return null; }
}
// Vorschaubild der Seite (og:image, sonst twitter:image), falls das Rezept selbst keins nennt
export function ogImage(html, base) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  let tw = null;
  for (const t of tags) {
    const attr = (a) => { const m = t.match(new RegExp('[\\s<]' + a + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i')); return m ? (m[1] != null ? m[1] : m[2]) : null; };
    const k = attr('property') || attr('name');
    const c = attr('content');
    if (!k || !c) continue;
    const name = k.toLowerCase();
    if (/^og:image(?::url|:secure_url)?$/.test(name)) { const u = absUrl(c, base); if (u) return u; }
    if (!tw && /^twitter:image(?::src)?$/.test(name)) tw = absUrl(c, base);
  }
  return tw;
}
// Bild ueber den Bilddienst wsrv.nl holen: verkleinert, als JPEG, mit CORS (die Rezeptseiten erlauben das meist nicht)
export function wsrvUrl(src) {
  return 'https://wsrv.nl/?url=' + encodeURIComponent(src) + '&w=640&h=640&fit=inside&we&output=jpg&q=80';
}

// Rezept aus freiem Text (Screenshot-Text oder eingefuegt)
export function fromText(txt, name = '') {
  const y = yieldFromText(txt);
  return { name, ingredients: ingredientsFromText(txt), steps: stepsFromText(txt), servings: y ? y.n : null, time: 0, image: null, cat: '' };
}

// Nur http und https, Link aus einem eingefuegten Text heraussuchen
export function findUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s"'<>]+/i);
  if (!m) return null;
  try { const u = new URL(m[0]); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; } catch (e) { return null; }
}

// ---- Netzwerk (hereingereichtes fetch, damit testbar) ----------------------------------------------
async function getText(fetchImpl, url, opts, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetchImpl(url, Object.assign({ signal: c.signal, referrerPolicy: 'no-referrer', credentials: 'omit' }, opts || {}));
    if (!r.ok) throw new Error('http');
    return await r.text();
  } finally { clearTimeout(t); }
}
export async function importFromUrl(url, fetchImpl = fetch) {
  const proxy = 'https://r.jina.ai/' + url;
  let ld = null;
  let html = '';
  try {
    html = await getText(fetchImpl, proxy, { headers: { 'X-Return-Format': 'html' } }, 15000);
    ld = fromLdJson(html);
    if (ld) ld.image = absUrl(ld.image, url) || ogImage(html, url);
    if (ld && ld.steps.length) return { ...ld, url };
  } catch (e) { /* weiter mit Markdown */ }
  const md = await getText(fetchImpl, proxy, null, 20000);
  // r.jina.ai antwortet auch bei Fehlerseiten mit 200 und schreibt den Fehler in eine Warnzeile
  if (/^Warning: Target URL returned error \d+/m.test(md)) throw new Error('target');
  const body = md.split(/^Markdown Content:\s*$/m).pop();
  if (ld) { ld.steps = stepsFromText(body); return { ...ld, url }; }
  const tm = md.match(/^Title:\s*(.+)$/m);
  if (tm && /\b(404|nicht gefunden|not found|seite existiert nicht)\b/i.test(tm[1])) throw new Error('target');
  const name = tm ? cleanLine(tm[1]).replace(/\s+[|–-]\s+[^|–-]*$/, '').slice(0, 60) : '';
  return { ...fromText(body, name), image: ogImage(html, url), url };
}

// Nur die Bildadresse eines Rezept-Links (fuer alte Rezepte ohne gespeichertes Bild)
export async function imageUrlFor(url, fetchImpl = fetch) {
  const html = await getText(fetchImpl, 'https://r.jina.ai/' + url, { headers: { 'X-Return-Format': 'html' } }, 15000);
  const ld = fromLdJson(html);
  return (ld && absUrl(ld.image, url)) || ogImage(html, url);
}

// ---- Texterkennung (Tesseract aus dem CDN, Pruefsumme wie in der Partner-App) ----------------------
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/';
const TESS_SRI = 'sha384-2BQ3U3OdKOb0Uczxqr41I9UvZkzr4V9Hv8uSzMMZAlmhsFClvdZX5wi5fDCzG+tM';
let tessLoad = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (tessLoad) return tessLoad;
  tessLoad = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = TESS + 'tesseract.min.js';
    s.integrity = TESS_SRI;
    s.crossOrigin = 'anonymous';
    s.onload = () => res();
    s.onerror = () => { tessLoad = null; rej(new Error('load')); };
    document.head.append(s);
  });
  return tessLoad;
}
// Mehrere Bilder nacheinander lesen, Text in Reihenfolge zusammensetzen. onProg(text) fuer die Anzeige.
export async function ocrImages(files, onProg) {
  await loadTesseract();
  let cur = 1;
  const w = await window.Tesseract.createWorker('deu', 1, {
    workerPath: TESS + 'worker.min.js',
    logger: (m) => { if (m && m.status === 'recognizing text' && typeof m.progress === 'number') onProg(cur, Math.round(m.progress * 100)); }
  });
  const texts = [];
  try {
    for (const f of files) {
      onProg(cur, 0);
      const r = await w.recognize(f);
      texts.push((r && r.data && r.data.text) || '');
      cur++;
    }
  } finally { try { await w.terminate(); } catch (e) { /* egal */ } }
  return texts.join('\n\n');
}
