# Analyse: Bestandsaufnahme, Benchmark, Plan

Stand: 22.11.2026, App-Version 2.13, Service Worker v25. Diese Analyse ändert keinen Code.
Grundlage: alle Dateien in `app/`, `supabase/`, `tests/`, dazu der Sync-Teil der Partner-App und die öffentlichen Seiten von familycockpit.com (Startseite, Hub, Ratgeber).

## 1. Bestandsaufnahme

### 1.1 Architektur in einem Satz
Statische PWA ohne Build (HTML, CSS, ES-Module), Daten lokal im Browser (localStorage), Abgleich pro Eintrag mit Supabase über drei RPC-Funktionen, Kalender über eine Edge Function, Wetter und Bus direkt von öffentlichen Diensten.

### 1.2 Module (`app/`)
| Datei | Aufgabe | Hängt ab von |
| --- | --- | --- |
| `app.js` | Einstieg, verdrahtet alles, Sekundentakt, Moduswechsel (Tag, Nacht, Standby, Kochen) | fast alle |
| `js/core.js` | Reiner Kern: Schlüssel, Normalisierung, Merge, Löschmarken, Warteschlange, Grenzen, Uhr, Store | nichts (unter Node testbar) |
| `js/state.js` | Browser-Anbindung des Stores, Demo-Daten, `write()`, Abonnenten, Kochmodus-Sitzung | core |
| `js/sync.js` | Sync-Motor: Push, Pull, Uhrabgleich, Quarantäne, Fehlerarten | core |
| `js/household.js` | Haushaltscode und Schlüssel, `#join`-Link, Speicherorte pro Haushalt | core |
| `js/setup.js` | Ersteinrichtung, Statusanzeige, Trennen, Start von Sync und Kalender | state, household, calendar, sync |
| `js/calendar.js` | Abruf der Edge Function alle 5 Minuten, Cache, Berliner Zeit, Aufbereitung | sync (Adresse, Kopfzeilen) |
| `js/render.js` | Alle Kacheln, Fokusansicht, Overlays, Einkauf, Aufgaben, Notizen, Monatskalender, Platzverteilung | state, cook, confirm, core |
| `js/cook.js` | Kochmodus: Schritte, Portionen, Timer, Rezept abschließen, wieder einkaufen | state, util, confirm, core |
| `js/standby.js` | Großer Kalender über fünf Wochen nach 5 Minuten ohne Berührung | state, calendar |
| `js/night.js` | Nachtmodus 22 bis 6 Uhr mit Pixel-Shift, 2 Minuten Blick per Tipp | render |
| `js/weather.js`, `transit.js`, `poll.js`, `live.js`, `liveCore.js` | Wetter (Open-Meteo) und Bus (BVG v6) mit Cache, Backoff, kein Bus nachts | config, settings |
| `js/settings.js`, `settingsui.js`, `places.js` | Ortseinstellungen nur auf dem Gerät, Suche nach Ort und Haltestelle | config, poll |
| `js/confirm.js` | Eigene Rückfrage statt `window.confirm` | nichts |
| `js/wake.js` | Wake Lock, Bildschirm bleibt an | nichts |
| `js/util.js` | DOM-Helfer, Mengen skalieren, Minuten aus Schritten lesen | nichts |
| `js/config.js` | Neutrale Voreinstellungen, Höchstalter der Caches | nichts |
| `sw.js` | Service Worker, App-Shell zuerst aus dem Cache, eigener Präfix | nichts |

### 1.3 Datenstrukturen
**Supabase** (`001_haushalt_sync.sql`, `002_hh_calendars.sql`, `003_haertung.sql` in `supabase/migrations/`)
- `hh_households(code)`: ein Haushalt, Code mindestens 32 Zeichen.
- `hh_items(household, list, id, data jsonb, ts, deleted, server_at)`: alle Einträge aller Listen. Schlüssel ist Haushalt, Liste, id.
- `hh_calendars(household, url, label)`: Abo-Links, nur für die Edge Function lesbar.
- `hh_rate`: Begrenzung auf 60 Pushes pro Minute.
- Alle Tabellen für den öffentlichen Schlüssel gesperrt. Zugriff nur über `hh_pull`, `hh_push`, `hh_now`.
- Grenzen: 20 000 Byte pro Eintrag (Rezepte 100 000), 200 Einträge pro Push, 2000 aktive Einträge pro Liste, Zeitstempel höchstens 5 Minuten in der Zukunft, Löschmarken werden nach 60 Tagen aufgeräumt.

**Listen in `hh_items.list`**
| Liste | Inhalt | Wer schreibt |
| --- | --- | --- |
| `shop` | Einkaufsposten `{t, done, at, doneAt?, q?, g?, u?, r?}` | Cockpit und Partner-App |
| `recipes` | Rezepte mit Zutaten, Schritten, Status | Cockpit und Partner-App |
| `tasks` | Aufgaben `{id, text, who, done}`, dazu `today: true` (Heute zu tun) und `note: true` (Notizen) | nur Cockpit |
| `cats` | Zustände: `leave-*` (Wohnung verlassen), `rec-*` (eingeklappte Rezepte), dazu `morgens`, `abends`, `klo` aus der alten Katzen-Kachel | nur Cockpit |
| `inbox-*` (zwei persönliche Briefkästen) | erlaubt, aber nirgends benutzt | niemand |

**Wichtig für den Putzplan:** Die Partner-App gleicht nur `shop` und `recipes` ab (`LISTS=["shop","recipes"]` in ihrer `app.js`). Die Liste `tasks` gehört allein dem Cockpit. Neue Felder dort betreffen die Partner-App nicht.

**Auf dem Gerät (localStorage)**: Daten und Löschmarken (`wohnungs-cockpit.v1`), Zugang (`.hh`), Warteschlange, Quarantäne und Stand pro Haushalt, Uhrabweichung, Ortseinstellungen (`.cfg`), Caches für Wetter, Bus, Kalender, eingeklappte Kacheln.

### 1.4 Sync
- Jede Änderung läuft über `write()`. Geänderte Einträge bekommen einen frischen Zeitstempel, gelöschte eine Löschmarke.
- Push 1 Sekunde nach einer Änderung, Pull alle 30 Sekunden, beim Aufwachen sofort.
- Die neuere Änderung gewinnt pro Eintrag, nicht pro Feld. Ändern zwei Geräte gleichzeitig verschiedene Felder desselben Eintrags, gewinnt einer komplett.
- Uhrabweichung wird alle 10 Minuten über `hh_now` geschätzt.
- Abgelehnte Einträge landen in Quarantäne statt die Warteschlange zu blockieren.
- Offline: alles funktioniert lokal, die Warteschlange wird später gesendet.

### 1.5 Zeitsteuerung (alles im Browser, keine Cronjobs auf dem Server)
Sekundentakt (Uhr, Timer, Moduswechsel), Sync 30 s, Kalender 5 min, Bus 60 s (nicht nachts, nur sichtbar), Wetter 30 min, Standby nach 5 min ohne Berührung, Nachtmodus 22 bis 6 Uhr, Katzentag wechselt um 6 Uhr.

### 1.6 Benutzer und Berechtigungen
Kein Login. Wer den Haushaltscode und den öffentlichen Schlüssel hat, darf alles lesen und schreiben. Personen sind feste Werte im Code (zwei Namen und "Beide"), nicht verwaltbar.

### 1.7 Fehlerbehandlung
Sync, Kalender, Wetter und Bus zeigen ruhige Hinweise und arbeiten mit dem Cache weiter. Backoff 30 s bis 5 min. Fehlertexte enthalten nie Code oder Schlüssel. Kein Fehlerprotokoll auf dem Gerät oder Server.

### 1.8 Tests
105 Tests in 6 Dateien, alle grün (`calendar` 22, `recipes` 8, `settings` 15, `sync` 27, `transit` 17, `weather` 16). Nicht getestet: Aufgaben, Notizen, Einkauf-Anzeige, Layout, Kochmodus, Edge Function.

### 1.9 Fehler und Schwachstellen
Nach Gewicht sortiert.

| # | Befund | Wo | Folge | Gewicht |
| --- | --- | --- | --- | --- |
| S1 | Aufgaben und Notizen werden ohne Rückfrage gelöscht, ein Tipp auf das Kreuz reicht | `render.js` fillTasks, renderNotes | Versehentlich gelöschte offene Aufgaben | hoch |
| S2 | "Woche neu starten" setzt alle Aufgaben zurück, auch die in "Heute zu tun" | `render.js` initTaskForm | Erledigtes von heute taucht wieder auf | mittel |
| S3 | Erledigte "Heute zu tun"-Einträge bleiben für immer stehen, nichts räumt sie ab | `render.js` | Liste wächst, Zähler wird unklar | mittel |
| S4 | Kalender: verschobene Einzeltermine einer Serie (RECURRENCE-ID) erscheinen doppelt, wenn sie auf einen anderen Tag verschoben wurden | `ics.ts` | Falscher Termin im Cockpit | mittel |
| S5 | Kalender: monatliche Serien mit Wochentag (z. B. jeden 2. Montag) und `BYMONTHDAY` werden falsch berechnet, es zählt nur das Startdatum | `ics.ts` | Falsche Tage | mittel |
| S6 | Kalender: Zeiten mit fremder Zeitzone (TZID nicht Berlin) werden als Berliner Zeit gelesen | `ics.ts` parseDT | Termine um Stunden verschoben, selten | niedrig |
| S7 | Kalender: mehrtägige Termine mit Uhrzeit nur am ersten Tag, `\;` im Titel wird nicht entschärft | `ics.ts` | Kleinigkeiten | niedrig |
| S8 | Doku sagt, mehrtägige Ganztagstermine stehen nur am ersten Tag. Der Code im Repo zeigt sie an jedem Tag. Unklar, welche Version live ist | `ics.ts`, HANDOFF 2.13 | Repo und Server evtl. nicht gleich | prüfen |
| S9 | Personennamen fest im Code (`core.js`, `render.js`, Demo-Daten), obwohl das Repo öffentlich ist und CLAUDE.md das verbietet | mehrere | Datenschutzregel verletzt, Personen nicht änderbar | mittel |
| S10 | Sync gewinnt pro Eintrag, nicht pro Feld | `core.js` mergeList | Beim Putzplan: zwei Geräte haken gleichzeitig ab, ein Verlaufseintrag kann verloren gehen | niedrig |
| S11 | Gerät länger als 30 Tage offline: lokale Löschmarken verfallen, ein gelöschter Eintrag kann von dort zurückkommen | `core.js` TOMB_MAX_AGE | Selten, aber möglich | niedrig |
| S12 | Tote Reste: `cats` morgens/abends/klo ohne Kachel, `getVet`, Listen `inbox-*`, Hinweis auf Smart Home in CLAUDE.md | mehrere | Verwirrung, kein Fehler | niedrig |

### 1.10 Angefangen, aber nicht fertig
- Rezept-Import per Link gibt es nur in der Partner-App. Im Cockpit kann man Rezepte weder importieren noch selbst anlegen, nur kochen und wieder einkaufen.
- Kategorien für Rezepte und Favoriten fehlen (Status `saved` ist die einzige Sammlung).
- Kalender: Monatsansicht und 5-Wochen-Standby vorhanden, eine Wochenansicht fehlt.
- Offene Punkte aus der Übergabe: Rezept-Import mit echter Seite testen, Kalender-Abo-Links neu erzeugen, Siri-Kurzbefehle entscheiden.

## 2. Benchmark gegen Family Cockpit

Family Cockpit ist eine Familien-App (iPhone, Android, iPad) mit geplantem Wandbildschirm "Hub". Angaben stammen aus Marketing-Text und Bildern der Webseite und sind nicht überprüfbar. Spalte "Stand": vorhanden, teilweise, fehlt.

| Bereich | Family Cockpit | Unser Cockpit | Stand | Verbesserungspotenzial | Technische Voraussetzung |
| --- | --- | --- | --- | --- | --- |
| Kalender und Termine | Termine anlegen, Farbe pro Person, Erinnerung vorher, Geburtstage, private Termine | iCloud-Abos live, nur lesen (bewusst so entschieden) | teilweise | Fehler S4 bis S8 beheben, Farbe pro Kalender | Änderung in `ics.ts`, Funktion neu bereitstellen |
| Tag, Woche, Monat | Woche und Monat, Tagesübersicht auf dem Startbildschirm | Liste, Monat in Fokusansicht, 5 Wochen im Standby | teilweise | Wochenansicht mit Zeitraster in der Fokusansicht | nur Frontend |
| Personen und Zuständigkeit | Avatar und Farbe pro Person auf jedem Eintrag | Chip mit Name und Farbe bei Aufgaben und Notizen | vorhanden | Beim Putzplan: wer hat erledigt | Feld im Eintrag |
| Aufgaben | Aufgaben mit Person, abhaken | Diese Woche, Heute zu tun, Notizen | teilweise | Datum, Uhrzeit, überfällig, Löschen mit Rückfrage | Neue Felder in `tasks` |
| Wiederkehrende Aufgaben | fester Rhythmus, setzt sich selbst zurück | nur "Woche neu starten" von Hand | fehlt | Intervall ab Erledigung (Phase 1) | Neue Felder in `tasks`, Berechnung im Browser |
| Routinen und Putzplan | Putzplan pro Person und Wochentag, Rückblick "5 von 6" | fehlt | fehlt | Verlauf, wer wann erledigt hat | wie oben |
| Einkaufslisten | Kategorien, sofort bei allen, Fortschritt, offline | synchron mit Partner-App, nach Laden und Rezept, Mengen, offline | vorhanden | Fortschritt "4 von 7", Posten bearbeiten | nur Frontend |
| Rezepte und Import | URL-Import, selbst anlegen, Favoriten, Kategorien | Kochmodus, Portionen, Timer, Sammlung. Import nur in Partner-App | teilweise | Rezept selbst anlegen, Favorit, Kategorie | Felder in `recipes`, Partner-App muss sie behalten |
| Essensplanung | in der App nicht beschrieben, nur Druckvorlage | fehlt, nur Status "heute kochen" | fehlt | Woche mit Rezept pro Tag, Zutaten in Einkauf (eigener Vorteil) | neues Feld in `recipes` oder Einträge in `cats` |
| Familie und Personen | Einladen per Link, Avatar, Farbe, Sichtbarkeit pro Eintrag | `#join`-Link, zwei feste Personen | teilweise | Namen aus dem Code in Geräte-Einstellungen (S9) | lokale Einstellung, kein Server nötig |
| Erinnerungen | Push an alle, Erinnerung vor Terminen, Routinen erinnern | fehlt | fehlt | Banner und Ton im Cockpit (Phase 1), Push später | Phase 1 nur Browser. Push: Server-Zeitsteuerung, Web Push, Homescreen-App auf dem Handy |
| Synchronisierung | Echtzeit, Google, Apple, iCal-Link | 30 s Abgleich, iCloud-Abos | vorhanden | Supabase Realtime statt 30 s (optional) | Realtime-Kanal, RLS-Konzept |
| Offline | Eintragen und abhaken offline | Service Worker, lokale Daten, Warteschlange | vorhanden | keins dringend | nichts |
| Dashboard und Widgets | Startbildschirm, Hub für die Wand angekündigt (nicht verfügbar) | Wandbildschirm ist der Kern: Kacheln, Standby, Nachtmodus, Wetter, Bus, Wake Lock | vorhanden, stärker als Referenz | AirPlay-Spiegelung prüfen, Lesbarkeit aus Abstand | nur Frontend |

**Fazit:** Beim Wandbildschirm, Kochmodus, Bus, Wetter und Datenschutz ist das Cockpit weiter als die Referenz. Es fehlen Wiederholung, Fälligkeit und Erinnerung bei Aufgaben. Das ist genau Phase 1.

## 3. Plan (Version 3.0 ist diese Analyse)

Reihenfolge nach Nutzen im Alltag, Integration, Aufwand, Stabilität, Bedienbarkeit. Jeder Schritt bekommt eine eigene Versionsnummer, Tests und einen Eintrag in HANDOFF.md.

| Schritt | Inhalt | Dateien | Datenänderung | Aufwand |
| --- | --- | --- | --- | --- |
| 3.1 | Sicherheitsnetz: Löschen von Aufgaben und Notizen nur mit Rückfrage (S1). Reine Aufgaben-Logik in neues Modul `app/js/tasks.js` mit Tests | `render.js`, neu `tasks.js`, neu `tests/tasks.test.mjs` | keine | klein |
| 3.2 | Putzplan: Intervall, nächste Fälligkeit ab Erledigung, wer hat erledigt, Verlauf (20), überfällig, Anzeige in Diese Woche und Heute zu tun, "Woche neu starten" weg, erledigte einmalige Aufgaben in "Erledigt" | `tasks.js`, `render.js`, `index.html`, `styles.css` | neue optionale Felder in `tasks` (siehe unten), keine Serveränderung | mittel |
| 3.3 | Einmalige Aufgaben mit Datum, Uhrzeit und Erinnerung: Banner und Ton im Cockpit, nachts still, auch im Standby | `tasks.js`, neu `reminders.js`, `app.js`, `standby.js` | Felder `due`, `time`, `remind` | mittel |
| 3.4 | Kalender-Fehler S4 bis S8 in der Edge Function, mit Tests für den Parser | `supabase/functions/calendar/ics.ts`, neu `tests/ics.test.mjs` | keine, Funktion neu bereitstellen | mittel |
| 3.5 | Essensplan: Woche mit Rezept pro Tag, "Zutaten der Woche einkaufen" | `render.js`, `cook.js` | Feld `plan` an Rezepten oder Einträge in `cats` (vorher prüfen, ob die Partner-App fremde Rezeptfelder behält) | mittel |
| 3.6 | Rezepte im Cockpit anlegen, Favorit, Kategorie | `render.js`, `cook.js` | Felder `fav`, `cat` in `recipes` | mittel |
| 3.7 | Aufräumen: Namen aus dem Code in Geräte-Einstellungen (S9), tote Reste (S12), Doku angleichen | mehrere | keine | klein |
| später | Wochenansicht Kalender, Push aufs Handy, Echtzeit-Sync | | | groß |

### Datenformat für Phase 1 (Vorschlag)
Alle Felder optional. Ein Eintrag ohne diese Felder verhält sich genau wie heute.

```
tasks: {
  id, text, who, done,          // wie bisher
  today?, note?,                // wie bisher
  every?: Zahl der Tage,        // gesetzt = wiederkehrend (1, 7, 14, 30 ...), "monatlich" als 'm'
  due?: 'JJJJ-MM-TT',           // nächste Fälligkeit (wiederkehrend) oder Fälligkeit (einmalig)
  time?: 'HH:MM',               // optionale Uhrzeit
  remind?: Minuten vorher,      // optionale Erinnerung
  log?: [{at: 'JJJJ-MM-TT', by: Person}],  // Verlauf, neueste zuerst, höchstens 20
  doneAt?: 'JJJJ-MM-TT'         // wann eine einmalige Aufgabe erledigt wurde
}
```
Größe: 20 Verlaufseinträge sind etwa 1 KB, die Grenze liegt bei 20 KB pro Eintrag.
