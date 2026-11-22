// Bild vom Gericht: verkleinern, als data-URL im Rezept speichern (wird mit abgeglichen und klappt offline),
// Bilder von Rezeptseiten ueber wsrv.nl holen, alte Rezepte beim Oeffnen nachruesten.
// Klein halten: die Rezepte liegen im localStorage, den sich das Cockpit mit der Partner-App teilt.
import { write } from './state.js';
import { safeUrl } from './util.js';
import { wsrvUrl, imageUrlFor } from './recipeimport.js';

const W = 360;
const H = 270; // 4:3
const MAX_CHARS = 22000;
const RETRY_MS = 10 * 60000;

// Eigene Bilder: kleine JPEG/PNG/WebP/GIF als base64. Fremde data-Werte (z. B. von der Partner-App) nie ueberschreiben.
export const isDataImage = (s) => typeof s === 'string' && s.length <= 40000 && /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(s);
const hasForeignData = (s) => typeof s === 'string' && /^data:/i.test(s);

// Speicher schonen: localStorage teilt sich das Cockpit mit der Partner-App (Safari etwa 5 MB, als UTF-16 gezaehlt)
const BUDGET_CHARS = 1500000;
export function storageRoom() {
  try {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += k.length + (localStorage.getItem(k) || '').length; }
    return n < BUDGET_CHARS;
  } catch (e) { return false; }
}

async function decode(blob) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(blob); } catch (e) { /* weiter mit <img> */ }
  }
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(blob);
    const i = new Image();
    i.onload = () => { URL.revokeObjectURL(u); res(i); };
    i.onerror = () => { URL.revokeObjectURL(u); rej(new Error('decode')); };
    i.src = u;
  });
}

// Auf 4:3 zuschneiden und verkleinern. top: oben ausschneiden (Screenshots, dort ist meist das Foto), sonst mittig.
export async function shrinkImage(blob, top = false) {
  const img = await decode(blob);
  const w0 = img.width;
  const h0 = img.height;
  if (!w0 || !h0) throw new Error('empty');
  let sw = w0;
  let sh = Math.round(w0 * H / W);
  if (sh > h0) { sh = h0; sw = Math.round(h0 * W / H); }
  const sx = Math.round((w0 - sw) / 2);
  const sy = top ? 0 : Math.round((h0 - sh) / 2);
  let scale = 1;
  for (let round = 0; round < 3; round++) {
    const c = document.createElement('canvas');
    c.width = Math.round(W * scale);
    c.height = Math.round(H * scale);
    const g = c.getContext('2d');
    g.fillStyle = '#16181B';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    for (const q of [0.72, 0.6, 0.5, 0.4]) {
      const d = c.toDataURL('image/jpeg', q);
      if (d.length <= MAX_CHARS && d.startsWith('data:image/jpeg')) { if (img.close) img.close(); return d; }
    }
    scale *= 0.8;
  }
  if (img.close) img.close();
  throw new Error('too large');
}

// Bild von einer fremden Seite ueber wsrv.nl laden und verkleinern
export async function fetchRemoteImage(src) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 15000);
  try {
    const r = await fetch(wsrvUrl(src), { signal: c.signal, referrerPolicy: 'no-referrer', credentials: 'omit' });
    if (!r.ok) throw new Error('http');
    const b = await r.blob();
    if (!/^image\//.test(b.type)) throw new Error('type');
    return await shrinkImage(b);
  } finally { clearTimeout(t); }
}

// Alte Rezepte: Bild beim Oeffnen nachholen (gespeicherte Bildadresse, sonst aus dem Link).
// Hoechstens alle 10 Minuten je Rezept und Adresse versuchen. Liefert die data-URL oder null.
const tried = new Map();
const running = new Map();
export function ensureImage(rec) {
  if (!rec || isDataImage(rec.image) || hasForeignData(rec.image) || rec.imgOff) return Promise.resolve(null);
  const id = String(rec.id);
  if (running.has(id)) return running.get(id);
  const src = safeUrl(rec.image);
  const page = safeUrl(rec.url);
  if ((!src && !page) || (typeof navigator !== 'undefined' && !navigator.onLine) || !storageRoom()) return Promise.resolve(null);
  // Gesperrt wird je Rezept und Adresse: ein geaenderter Link wird sofort neu versucht
  const tk = id + '|' + (page || '') + '|' + (src || '');
  if (Date.now() - (tried.get(tk) || 0) < RETRY_MS) return Promise.resolve(null);
  tried.set(tk, Date.now());
  const job = (async () => {
    let img = null;
    if (src) { try { img = await fetchRemoteImage(src); } catch (e) { /* Adresse tot, ueber die Seite versuchen */ } }
    if (!img && page) {
      const found = await imageUrlFor(page);
      if (found && found !== src) img = await fetchRemoteImage(found);
    }
    if (!img) return null;
    write('recipes', (l) => l.map((r) => {
      // Nur ersetzen, was noch leer ist oder eine Adresse ist (in der Zwischenzeit gewaehlte Bilder bleiben)
      if (String(r.id) === id && !r.imgOff && (!r.image || safeUrl(r.image))) r.image = img;
      return r;
    }));
    return img;
  })().catch(() => null).finally(() => running.delete(id));
  running.set(id, job);
  return job;
}
