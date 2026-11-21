// Kleine Helfer. Aller sichtbare Text geht ueber textContent, nie ueber innerHTML.

export const pad = (n) => String(n).padStart(2, '0');

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function button(cls, text, onClick, label, fk) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  if (fk) b.dataset.fk = fk;
  b.addEventListener('click', onClick);
  return b;
}

const NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z',
  close: 'M6 6l12 12M18 6 6 18',
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  // Wetter (einfache Linien-Symbole)
  sun: ['M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0', 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
  cloud: ['M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'],
  fog: ['M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2', 'M16 17H7M17 21H9'],
  rain: ['M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2', 'M16 14v6M8 14v6M12 16v6'],
  snow: ['M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2', 'M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01'],
  thunder: ['M6 16.3A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 .5 9', 'M13 12l-3 5h4l-3 5']
};
export function icon(name, size, color, stroke) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', color || 'currentColor');
  s.setAttribute('stroke-width', String(stroke || 2));
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  [].concat(ICONS[name]).forEach((d) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    s.appendChild(p);
  });
  return s;
}

// Nur http und https sind als Link erlaubt (Rezepte sind Nutzereingaben).
export function safeUrl(u) {
  if (!u) return null;
  try {
    const x = new URL(String(u));
    return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null;
  } catch (e) {
    return null;
  }
}

// Menge umrechnen: "750 g" mal 0,5 ergibt "375 g". Erkannt werden Dezimalkomma, Tausenderpunkt ("1.000 g"),
// Bruchzeichen, "1/2" und gemischte Zahlen ("1 ½", "1 1/2").
export function scaleQ(q, f) {
  if (!q || f === 1) return q || '';
  const FR = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
  const fmt = (n) => {
    if (n >= 1000) return Math.round(n).toLocaleString('de-DE');
    const r = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
    return String(r).replace('.', ',');
  };
  const re = /(\d+)\s+(\d+)\/(\d+)|(\d+)\s*([½¼¾⅓⅔])|(\d+)\/(\d+)|([½¼¾⅓⅔])|(\d{1,3}(?:\.\d{3})+)(?!\d)|(\d+(?:[.,]\d+)?)/g;
  return q.replace(re, (m, w1, n1, d1, w2, fr2, n3, d3, fr4, th, plain) => {
    let v;
    if (w1 != null) v = +w1 + +n1 / +d1;
    else if (w2 != null) v = +w2 + FR[fr2];
    else if (n3 != null) v = +n3 / +d3;
    else if (fr4 != null) v = FR[fr4];
    else if (th != null) v = parseFloat(th.replace(/\./g, ''));
    else v = parseFloat(plain.replace(',', '.'));
    return fmt(v * f);
  });
}

// Minuten aus einem Schritt lesen, z. B. "etwa 4 Minuten", "1 Stunde" oder "1,5 Stunden". 0 heisst kein Timer.
export function stepMinutes(t) {
  const m = String(t || '').match(/(\d+(?:[.,]\d+)?)\s*(?:[\u2013-]\s*\d+(?:[.,]\d+)?\s*)?(Minuten|Minute|Min\.?|Stunden|Stunde|Std\.?)/i);
  if (!m) return 0;
  const v = parseFloat(m[1].replace(',', '.'));
  return Math.round(/^St/i.test(m[2]) ? v * 60 : v);
}
