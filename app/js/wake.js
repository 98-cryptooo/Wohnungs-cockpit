// Wake Lock: Bildschirm bleibt an. Nach Wechsel der App oder des Tabs neu anfordern.
let lock = null;
let pending = false;

async function acquire() {
  if (!('wakeLock' in navigator)) return;
  if (document.visibilityState !== 'visible') return;
  if (pending || (lock && !lock.released)) return;
  pending = true;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch (e) {
    lock = null; // z. B. Energiesparmodus oder fehlende Berechtigung: still weitermachen
  } finally {
    pending = false;
  }
}

export function initWakeLock() {
  acquire();
  document.addEventListener('visibilitychange', acquire);
  // Manche Browser erlauben die Anforderung erst nach einer Beruehrung.
  document.addEventListener('pointerdown', acquire, { passive: true });
}
