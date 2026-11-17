// Dialog-Abschnitt "Ort und Bus": Suche nach Wetterort und Haltestelle, Linien, Richtungen, Fussweg.
// Alles aus Suchergebnissen und Einstellungen wird mit textContent angezeigt.
import { settings, parseLines, parseKeywords, clampWalk } from './settings.js';
import { searchPlaces, searchStops, searchErrorText } from './places.js';
import { askConfirm } from './confirm.js';
import { el, button } from './util.js';

const $ = (id) => document.getElementById(id);
const DEBOUNCE_MS = 400;

function debounce(fn, ms) {
  let t = null;
  return (...a) => { if (t !== null) clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
}

// Suchfeld mit Ergebnisliste. Antworten, die nach einer neueren Eingabe ankommen, werden verworfen.
function wireSearch({ input, results, msg, search, labelOf, onPick }) {
  let seq = 0;
  const run = async () => {
    const text = input.value.trim();
    const mine = ++seq;
    results.replaceChildren();
    if (text.length < 2) { msg.textContent = ''; return; }
    msg.textContent = 'Suche läuft ...';
    try {
      const list = await search(text, (url, init) => fetch(url, init));
      if (mine !== seq) return;
      if (!list.length) { msg.textContent = 'Keine Treffer.'; return; }
      msg.textContent = '';
      results.replaceChildren(...list.map((item) => button('set-result', labelOf(item), () => {
        onPick(item);
        input.value = '';
        results.replaceChildren();
        msg.textContent = '';
        renderSettingsUi(false);
      })));
    } catch (e) {
      if (mine !== seq) return;
      msg.textContent = searchErrorText(e && e.kind);
    }
  };
  input.addEventListener('input', debounce(run, DEBOUNCE_MS));
}

function renderDirs() {
  const t = settings.get().transit;
  const rows = t.lines.map((line, i) => {
    const label = el('label');
    label.append(el('span', null, 'Richtung für Linie ' + line + ' (Stichwörter, leer = alle)'));
    const input = el('input', 'set-input');
    input.type = 'text';
    input.value = (t.directions[line] || []).join(', ');
    input.maxLength = 120;
    input.dataset.line = line;
    input.id = 'cfg-dir-' + i;
    input.autocomplete = 'off';
    input.autocapitalize = 'none';
    input.spellcheck = false;
    label.append(input);
    return label;
  });
  $('cfg-dirs').replaceChildren(...rows);
}

// full = auch die Eingabefelder neu fuellen (beim Oeffnen und nach dem Loeschen)
export function renderSettingsUi(full = true) {
  const s = settings.get();
  $('cfg-weather-current').textContent = 'Aktuell: ' + (s.weather ? (s.weather.name || 'gewählt') : 'nicht gewählt');
  $('cfg-stop-current').textContent = 'Aktuell: ' + (s.transit.stopId ? (s.transit.stopName || 'gewählt') : 'nicht gewählt');
  $('cfg-walk-value').textContent = s.transit.walkMinutes + ' Min';
  if (full) {
    $('cfg-lines').value = s.transit.lines.join(', ');
    $('cfg-weather-q').value = '';
    $('cfg-stop-q').value = '';
    ['cfg-weather-results', 'cfg-stop-results'].forEach((id) => $(id).replaceChildren());
    ['cfg-weather-msg', 'cfg-stop-msg'].forEach((id) => { $(id).textContent = ''; });
    renderDirs();
  }
}

export function initSettingsUi() {
  wireSearch({
    input: $('cfg-weather-q'), results: $('cfg-weather-results'), msg: $('cfg-weather-msg'),
    search: searchPlaces, labelOf: (p) => p.label,
    onPick: (p) => settings.setWeather({ name: p.name, latitude: p.latitude, longitude: p.longitude })
  });
  wireSearch({
    input: $('cfg-stop-q'), results: $('cfg-stop-results'), msg: $('cfg-stop-msg'),
    search: searchStops, labelOf: (p) => p.name,
    onPick: (p) => settings.setTransit({ stopId: p.id, stopName: p.name })
  });
  // Linien: beim Verlassen des Feldes uebernehmen, dann die Richtungsfelder neu aufbauen
  $('cfg-lines').addEventListener('change', () => {
    settings.setTransit({ lines: parseLines($('cfg-lines').value) });
    renderSettingsUi(false);
    $('cfg-lines').value = settings.get().transit.lines.join(', ');
    renderDirs();
  });
  $('cfg-lines').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('cfg-lines').blur(); } });
  const saveDirs = debounce(() => {
    const directions = {};
    $('cfg-dirs').querySelectorAll('input').forEach((i) => { directions[i.dataset.line] = parseKeywords(i.value); });
    settings.setTransit({ directions });
  }, DEBOUNCE_MS);
  $('cfg-dirs').addEventListener('input', saveDirs);
  const walk = (d) => { settings.setTransit({ walkMinutes: clampWalk(settings.get().transit.walkMinutes + d) }); renderSettingsUi(false); };
  $('cfg-walk-less').addEventListener('click', () => walk(-1));
  $('cfg-walk-more').addEventListener('click', () => walk(1));
  $('cfg-clear').addEventListener('click', async () => {
    const ok = await askConfirm('Orts-Einstellungen löschen? Wetterort, Haltestelle, Linien und Fußweg werden auf diesem Gerät entfernt. Der Haushalt bleibt unverändert.', 'Löschen');
    if (!ok) return;
    settings.clear();
    renderSettingsUi(true);
  });
  $('weather-config').addEventListener('click', () => document.dispatchEvent(new CustomEvent('cockpit:settings')));
}
