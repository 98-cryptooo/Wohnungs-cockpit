// Eigene Rueckfrage (statt window.confirm): Text, zwei Knopfe, Fokus und Tastatur sauber.
const $ = (id) => document.getElementById(id);
let resolver = null;
let previous = null;
let inertBefore = {};
const BEHIND = ['day', 'focus', 'overlay', 'cook', 'settings', 'setup'];

export function isConfirmOpen() { return resolver !== null; }

export function askConfirm(message, yesLabel) {
  if (resolver) finish(false);
  return new Promise((resolve) => {
    resolver = resolve;
    previous = document.activeElement;
    $('confirm-msg').textContent = message;
    $('confirm-yes').textContent = yesLabel || 'Ja';
    inertBefore = {};
    BEHIND.forEach((id) => { inertBefore[id] = $(id).inert; $(id).inert = true; });
    $('confirm').hidden = false;
    $('confirm-no').focus({ preventScroll: true });
  });
}

function finish(value) {
  const r = resolver;
  resolver = null;
  $('confirm').hidden = true;
  BEHIND.forEach((id) => { $(id).inert = !!inertBefore[id]; });
  if (previous && previous.isConnected) previous.focus({ preventScroll: true });
  previous = null;
  if (r) r(value);
}

export function initConfirm() {
  $('confirm-yes').addEventListener('click', () => finish(true));
  $('confirm-no').addEventListener('click', () => finish(false));
  $('confirm-scrim').addEventListener('click', () => finish(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && resolver) { e.stopImmediatePropagation(); finish(false); }
  }, true);
}
