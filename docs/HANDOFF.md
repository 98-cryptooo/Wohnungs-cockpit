# Übergabe aus Claude (Chat) an Claude Code

Stand: 17.11.2026. Die ausführliche Projektdoku mit allen Revisionen und Entscheidungen: https://claude.ai/artifact/SmfpLv2nMkUW5ivbwNt6YK

## Was fertig ist
- Design-Entwurf des Cockpits (Version 1.2), siehe `design/cockpit-entwurf.dc.html` und https://claude.ai/artifact/NLUYpWWzUV2xYTNvT64Dsb
- Supabase-Projekt Haushalt mit Sync-Tabellen und Funktionen (`supabase/migrations`), live
- Edge Function `calendar`, live und mit echten Kalenderdaten getestet
- Partner-App teilt die Einkaufsliste (Pull Request #1, gemergt)
- Partner-App teilt Rezepte mit Schritten (Pull Request #2, offen)

## Offene Punkte
1. Pull Request #2 in der Partner-App reviewen lassen und mergen.
2. Das Handy der Partnerperson verbinden (Link mit `#join=` aus dem Chat, siehe `.env`), danach prüfen, ob Anfragen in Supabase ankommen.
3. Echten Rezept-Link in Partner-App testen. Der Import über r.jina.ai konnte in der Chat-Umgebung nicht live getestet werden, nur mit nachgebautem Seiteninhalt.
4. Das Cockpit als echte PWA bauen (Vorschlag unten).
5. Wetter (Open-Meteo) und BVG-Abfahrten (v6.bvg.transport.rest) live anbinden.
6. Entscheiden: Siri-Kurzbefehle für Einkauf, Putzplan, Katzen? Alexa nur, falls ein Echo da ist.
7. Gewünscht: Abo-Links der Kalender in iCloud neu erzeugen (die alten standen im Chat) und in `hh_calendars` ersetzen.

## Vorschlag für die echte App
- Statische Web-App wie Partner-App (HTML, CSS, ein JS-Modul), GitHub Pages, Service Worker für Offline, `manifest.webmanifest` mit `display: standalone`.
- Layout fest auf 1366 × 1024 (iPad Air 13 Zoll quer), safe-area beachten, Wake Lock gegen Abschalten.
- Sync-Modul aus Partner-App übernehmen (Listen shop, recipes, tasks, cats).
- Kalender über die Edge Function `calendar`, alle 5 Minuten.
- Verhalten wie im Entwurf: siehe Logik im Script-Teil von `design/cockpit-entwurf.dc.html` (Gruppierung, Kochmodus, Timer, Portionen, Nachtmodus).

## Revisionen
| Version | Datum | Änderung |
| --- | --- | --- |
| 2.11 | 18.11.2026 | Kachel Notizen links unter der Uhr: gemeinsamer Zettel, Chip für Rik, Melina oder Beide, Löschen. Gespeichert als Einträge in tasks mit note: true, damit der Sync sie ohne Serveränderung abgleicht. Diese Woche und Heute zu tun zeigen keine Notizen. Service Worker v23. |
| 2.10 | 18.11.2026 | Diese Woche in die Mitte unter den Kalender, Einkauf rechts über die ganze Höhe. Bus ohne Vergrößern. Kalender aufgeklappt als Monatsansicht: Monat wechseln, Tag wählen, Heute-Knopf, Termine des Tages darunter. Service Worker v22. |
| 2.9 | 18.11.2026 | Versionsnummer in den Einstellungen sichtbar. Jede Änderung bekommt jetzt eine Nummer und einen Git-Tag (vX.Y), alte Stände lassen sich damit anspringen. Frühere Commits sind nachträglich getaggt (v2.0 bis v2.8, v2.6.1 für den Fix). Service Worker v21. |
| 2.8 | 18.11.2026 | Aufklappen: jede Kachel hat einen Knopf zum Vergrößern. Die offene Kachel wird größer, die anderen rutschen zur Seite (Querformat), im Hochformat über die ganze Breite. Auswahl pro Gerät gespeichert. Service Worker v20. |
| 2.7 | 18.11.2026 | Bus-Kachel links unter der Uhr, Abfahrten wieder untereinander. Kalender im Querformat über die ganze Mitte. Heute zu tun unten links. Service Worker v19. |
| 2.6 | 18.11.2026 | Layout repariert: Uhr-Zeile und Schriftgröße im Querformat griffen nicht (Basisregeln standen danach), Heute zu tun überschrieb die Platzierung der Woche-Kachel. Button Wohnung verlassen kleiner. Tablet hochkant: Kacheln behalten eigene Höhe, Einkaufsliste maximal 60 % der Höhe. Heute zu tun steht im Telefon-Layout vor dem Kalender. Service Worker v17. |
| 2.5 | 18.11.2026 | Layout aufgeräumt: Heute-Abschnitt in der Uhr-Kachel entfernt (Sync-Knopf wandert in den Kopf von Heute zu tun), Smart-Home-Hinweis entfernt. Heute zu tun links neben der Mitte, Kalender Mitte oben, Bus Mitte unten mit Abfahrten nebeneinander, Einkauf rechts oben, Diese Woche rechts unten. Erledigte Aufgaben in Diese Woche ausgeblendet (Woche neu starten holt sie zurück). Button Wohnung verlassen neben der Uhr. Service Worker v16. |
| 2.4 | 18.11.2026 | UI-Feinschliff (nur Darstellung): Hinweis bei Heute zu tun und Diese Woche korrigiert (Text abhaken, Chip wechselt Zuständigkeit), leerer Zierrand in der Uhr-Kachel entfernt, Einkauf-Eingabe in eigene Zeile (Laden und Knopf darunter, sonst auf dem iPad kaum Platz), Aufgabentexte umbrechen statt abschneiden, Nachtmodus-Uhr auf dem Telefon passend skaliert, doppelte Regel fuer Einstellungs-Knoepfe entfernt. Service Worker v15. |
| 2.3 | 18.11.2026 | Wohnung-verlassen-Haken und eingeklappte Rezepte werden jetzt synchronisiert (Liste cats mit ids leave-* und rec-*, done = Zustand). Vorher nur pro Gerät. Service Worker v14. Die Liste cats muss auf dem Server Einträge mit diesen ids annehmen (Test nötig). |
| 2.2 | 18.11.2026 | Button "Wohnung verlassen" im Uhr-Bereich mit Checkliste (Katzenklo, Katzen Essen, Licht, Ofen, Föhn, Fenster), Haken nur pro Gerät, "Alle zurücksetzen" und "Fertig & Schließen". Neue Kachel "Heute zu tun" (Aufgaben der Liste tasks mit today: true, sonst wie Diese Woche). Rezept-Kopf: Name oben, Buttons darunter. Einkauf: Zuteilung Andere und Katzen. Service Worker v13. |
| 2.1 | 18.11.2026 | Katzen-Kachel entfernt. Einkauf: Artikel direkt im Cockpit hinzufügen (Laden Lebensmittel oder Drogerie), wird wie bisher synchronisiert. Rezepte in der Einkaufsliste einklappbar (pro Gerät gespeichert). Responsive: Telefon eine Spalte mit Scrollen, Tablet hochkant zwei Spalten, iPad quer drei Spalten wie bisher. Feste Skalierung (layout.js und Test) entfernt, Service Worker v12. Noch nicht auf Gerät geprüft. |
| 2.0 | 17.11.2026 | Layout füllt den ganzen Bildschirm (iPad Air 5, 1180 x 820, Mindestfläche 1160 x 840, `app/js/layout.js`). Einkaufsposten mit Rezept-Link ohne Rezeptdatensatz zeigen "Anleitung noch nicht synchronisiert" und "Original öffnen". Ursache des fehlenden Kochmodus: Pull Request #2 der Partner-App war nicht gemergt. 14 neue Tests (layout, recipes). GitHub Pages Workflow in `.github/workflows/pages.yml`. |
| 1.9 | 17.11.2026 | Datenschutz: Ortsangaben (Wetterort, Haltestelle, Linien, Richtungen, Fußweg) nur noch in Geräte-Einstellungen, nicht im Repo. Echte Termine und persönliche Angaben aus Entwurf, Doku und Tests entfernt, persönliche Notizen in `CLAUDE.local.md` und `docs/HANDOFF.local.md` (nicht im Repo). Historie neu aufgesetzt, weil der erste Upload persönliche Termine enthielt. 97 Tests. |
| 1.8 | 17.11.2026 | Wetter (Open-Meteo, Koordinaten grob gerundet) und Bus (BVG REST v6, Haltestelle, Linien und Richtungen, Fußweg) live in der App. Orts-Einstellungen nur auf dem Gerät. Cache mit Höchstalter, Backoff, kein Bus-Abruf nachts, 42 neue Tests (weather 15, transit 16 plus Rest), Code-Review eingearbeitet. Ortsangaben (Haltestelle, Ort, Linien) stehen nicht im Repo, sondern in Geräte-Einstellungen.|
| 1.7 | 17.11.2026 | Kalender in der App (`app/js/calendar.js`): Abruf alle 5 Minuten und beim Aufwachen, Cache für offline, ruhige Fehlerhinweise, 14 Tests in `tests/calendar.test.mjs`. Code-Review eingearbeitet (Berliner Zeit statt Gerätezeit, laufende Termine, Mindestabstand 60 s), 22 Tests. Noch nicht gegen die echte Funktion getestet. |
| 1.6 | 17.11.2026 | Migration 003 (`haertung`) live eingespielt und per Testlauf geprüft (Grenzen, Rate-Limit, ts-Deckel, `hh_now`). Edge Function `calendar` als Version 2 bereitgestellt (Codelänge 32, Timeout, keine Abo-Link-Reste in Fehlern). Branch `feature/cockpit-app` auf GitHub. |
| 1.5 | 17.11.2026 | Schritt 2 (Sync) in `app/`: Merge pro Eintrag mit Löschmarken, Dirty-Queue mit Quarantäne, Uhr-Korrektur über `hh_now`, Code-Maske und `#join=CODE&key=ANONKEY`, 27 Tests in `tests/sync.test.mjs`. Neue Migration `003_haertung.sql` (NOCH NICHT ausgeführt) und Edge Function `calendar` mit Codelänge 32 (NOCH NICHT neu bereitgestellt). Nicht gegen echtes Supabase getestet. |
| 1.4 | 17.11.2026 | Schritt 1 der PWA in `app/` (Layout, Kochmodus, Nachtmodus, Service Worker, Beispieldaten nur mit `?demo=1`), Code- und Design-Review eingearbeitet. Git-Repo, Branch `feature/cockpit-app`, Pre-Commit-Schutz gegen Geheimnisse in `.githooks/`. Noch nicht committet. |
| 1.3 | 17.11.2026 | Übergabe an Claude Code: Repo-Paket mit CLAUDE.md, Design, Supabase-Code |
| 1.2 | 17.11.2026 | Rezepte vom Link bis zum Kochen: Kochmodus, Timer, Portionen, Sammlung |
| 1.1 | 17.11.2026 | Format iPad Air 13 Zoll, 1366 × 1024 |
| 1.0 | 17.11.2026 | Einkauf nach Laden und Rezept gruppiert, Smart Home verkleinert |
| 0.9 | 17.11.2026 | Briefkasten für persönliche Dashboards verworfen |
| 0.8 | 17.11.2026 | Kalender live über Edge Function |
| 0.7 | 17.11.2026 | Müllabfuhr raus, Diese Woche bearbeitbar |
| 0.6 | 17.11.2026 | Supabase-Projekt Haushalt, Sync in der Partner-App |
| 0.1 bis 0.5 | 17.11.2026 | Interview, Spec, erster Entwurf, Reviews, Sync-Plan |
