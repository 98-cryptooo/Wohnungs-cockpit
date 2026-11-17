// Flaeche und Skalierung. Die Buehne ist keine feste Groesse mehr: Sie hat immer das Seitenverhaeltnis des sichtbaren
// Bildschirms (abzueglich safe-area) und mindestens MIN_W x MIN_H Entwurfseinheiten. Das Raster streckt sich.
export const MIN_W = 1160;
export const MIN_H = 840;

// avail: sichtbare Flaeche in CSS-Pixeln (ohne safe-area). Liefert Skalierung und Groesse der Buehne in Entwurfseinheiten.
export function computeFit(availW, availH, minW = MIN_W, minH = MIN_H) {
  const s = Math.min(availW / minW, availH / minH);
  return { scale: s, width: availW / s, height: availH / s };
}
