# Wohnungs-Cockpit

Haushalts-Cockpit für zwei Personen auf einem iPad Air 13 Zoll (2024), quer, 1366 × 1024 Punkte, mal an der Wand, mal in der Hand. Dunkel und edel. Alles auf einer Seite, kein Scrollen der Seite.

Persönliche Angaben (Namen, Ort, Konten, Absprachen) stehen in `CLAUDE.local.md`. Diese Datei ist nicht im Repo.

## Arbeitsweise
- Antworten und Texte auf Deutsch. Keine Gedankenstriche (– oder —) in Texten, die der Nutzer liest, auch nicht in der App.
- Der Nutzer kennt sich mit Backend und Datenbanken wenig aus: jeden Schritt, den er selbst machen muss, genau und einfach erklären.
- Vor größeren Features kurz nachfragen (grill-me), Spec mit Abnahmetests schreiben, Ja abholen, bauen, dann gegen die Spec prüfen.
- Nach jeder Änderung eine Zeile in `docs/HANDOFF.md` unter Revisionen ergänzen (neueste oben).
- Vor dem Merge: Code-Review-Agent und Frontend-/Design-Agent drüberschauen lassen.
- Commit und Push nur auf einen Branch, Merge macht der Nutzer über einen Pull Request.
- Das Repo ist öffentlich. Nie Haushaltscode, Schlüssel, Kalender-Links, Orte, Namen oder echte Termine committen. Der Pre-Commit-Schutz in `.githooks/` fängt Geheimnisse ab (`git config core.hooksPath .githooks`).

## Stand
- `design/cockpit-entwurf.dc.html` ist der freigegebene Design-Entwurf (Format Design Component) mit erfundenen Beispieldaten. Er ist die Vorlage, nicht die App.
- Die App liegt in `app/` (PWA, statisch, ohne Build). Tests: `node tests/<name>.test.mjs`.

## Backend: Supabase-Projekt "Haushalt"
- Tabellen `hh_households`, `hh_items`, `hh_calendars`, `hh_rate` sind für anon gesperrt (RLS ohne Policies, revoke).
- Zugriff nur über RPC `hh_pull`, `hh_push` und `hh_now` mit dem Haushaltscode. Erlaubte Listen: shop, recipes, tasks, cats, inbox-rik, inbox-melina.
- Abgleich pro Eintrag, Zeitstempel `ts`, die neuere Änderung gewinnt, Löschmarken statt Löschen.
- Edge Function `calendar` (verify_jwt aus, prüft selbst den Haushaltscode): POST `{code, days}` liefert die Termine der abonnierten Kalender mit Wiederholungen. Quelle in `supabase/functions/calendar`.
- Haushaltscode und Kalender-Links nie ins Repo schreiben. Der Code wird einmal auf dem Gerät eingegeben (Maske oder `#join`-Link) und liegt nur in dessen localStorage. Vorlage für lokale Werte: `.env.example`.

## Ortsangaben
Wetterort, Haltestelle, Linien, Richtungen und Fußweg stehen nie im Repo, sondern in den Geräte-Einstellungen der App (localStorage).

## Datenformat
- `shop`: `{t, done, at, doneAt?, q?, g?, u?, r?}`. t = Name, q = Menge, g = Gruppe, u = Rezept-Link, r = Rezept-ID.
- `recipes`: `{name, url, steps[], servings, yieldText, time, image, ingredients[{q,t}], status: list|today|saved, at}`.
- Gruppierung im Cockpit: Allgemein und Rezepte zu Lebensmittelmarkt (Rezepte als Untergruppe), Drogerie zu Drogerie, alles andere zu Andere.

## Kacheln
Uhr mit Heute-Bereich und Wetter, Kalender (live), Diese Woche (Aufgaben hinzufügen, löschen, Zuständigkeit), Einkauf (synchron, nach Laden und Rezept), Katzen (Füttern morgens/abends, Klo, Tierarzt), Bus (Linien und Fußweg aus den Einstellungen), Smart Home nur als Hinweis. Kochmodus mit Schritten, Timer und Portionen, Rezeptsammlung. Nachtmodus 22 bis 6 Uhr mit Pixel-Shift.
