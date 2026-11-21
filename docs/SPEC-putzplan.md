# Spec: Analyse und Putzplan (Version 3.0 bis 3.x)

Stand: 22.11.2026, nach Interview (12 Fragen). Wartet auf Freigabe.

## Ziel
Das Cockpit bekommt eine ehrliche Bestandsaufnahme mit Vergleich zu Family Cockpit und einen Plan. Danach wird "Diese Woche" zu einem echten Putzplan mit wiederkehrenden Aufgaben, Fälligkeiten und Erinnerungen auf dem iPad.

## Erfolg
Ihr legt "Bad putzen, alle 7 Tage" einmal an. Ab dann taucht die Aufgabe von selbst wieder auf, wird rot, wenn sie liegen bleibt, und im Verlauf steht, wer sie wann erledigt hat. Niemand muss mehr "Woche neu starten" drücken.

## Nutzer und Geräte
- Zwei Personen, ein gemeinsames iPad Air 13 Zoll quer (Hauptgerät), dazu Handys.
- Fernseher: iPad per AirPlay gespiegelt. Kein eigenes TV-Layout, nur Lesbarkeit beim Spiegeln prüfen.

## Muss (mit Abnahmetest)

### Phase 0: Analyse (ändert keinen Code)
1. **Bestandsaufnahme** in `docs/ANALYSE.md`: Module, Datenstrukturen, Supabase (Tabellen, RPCs, Edge Function), Sync, Zeitsteuerung, Fehlerbehandlung, Schwachstellen, halb fertige Funktionen.
   Test: Jede Datei in `app/js/` und jede Migration kommt in der Datei vor. `git diff app/ supabase/` ist leer.
2. **Benchmark** gegen Family Cockpit (öffentliche Seite) als Tabelle mit den Spalten vorhanden, teilweise, fehlt, Verbesserungspotenzial, technische Voraussetzung, für alle 14 Bereiche aus deinem Auftrag.
   Test: Tabelle hat 14 Zeilen, jede Zeile hat eine Spalte ausgefüllt und eine Begründung.
3. **Plan** mit Reihenfolge: Putzplan, Aufgaben mit Datum und Erinnerung, Essensplan, danach Rest nach Nutzen.
   Test: Jeder Schritt nennt Dateien, Datenänderungen und Aufwand (klein, mittel, groß).

### Phase 1: Putzplan in "Diese Woche"
4. **Wiederkehrende Aufgabe anlegen** mit Intervall (täglich, alle X Tage, wöchentlich, alle 2 Wochen, monatlich).
   Test: "Bad putzen, alle 7 Tage" anlegen, erscheint sofort in Diese Woche mit Fälligkeit.
5. **Nächster Durchgang ab Erledigung.**
   Test: Aufgabe am 10. abhaken, nächste Fälligkeit ist der 17. Am 12. abhaken ergibt den 19.
6. **Wer erledigt wird gespeichert**, keine feste Zuständigkeit.
   Test: Beim Abhaken eine der beiden Personen oder Beide wählen. Der Verlauf zeigt Name und Datum.
7. **Verlauf** pro Aufgabe (die letzten 20 Durchgänge).
   Test: Dreimal abhaken, Verlauf zeigt drei Einträge, neueste oben, auch auf dem zweiten Gerät nach Sync.
8. **Überfällig**: Aufgaben nach ihrer Fälligkeit rot und oben einsortiert.
   Test: Fälligkeit gestern, Aufgabe steht ganz oben, rot, mit "seit 1 Tag".
9. **Heute fällig erscheint in "Heute zu tun".**
   Test: Fälligkeit heute, Aufgabe steht in beiden Kacheln, Abhaken in einer erledigt sie in beiden.
10. **Einmalige Aufgabe mit Datum, optional Uhrzeit und Erinnerung** (X Minuten vorher Banner und Ton auf dem iPad).
    Test: Aufgabe für in 6 Minuten mit Erinnerung 5 Minuten anlegen, nach 1 Minute erscheint das Banner mit Ton. Bleibt sie liegen, wird sie danach rot und bleibt bis erledigt.
11. **"Woche neu starten" entfällt.** Erledigte einmalige Aufgaben wandern in einen Verlauf statt gelöscht zu werden.
    Test: Knopf ist weg. Erledigte einmalige Aufgabe ist in der Fokusansicht unter "Erledigt" noch zu finden.
12. **Nichts geht verloren.** Löschen einer offenen Aufgabe nur nach Rückfrage. Bestehende Aufgaben ohne Intervall bleiben unverändert einmalige Aufgaben.
    Test: Nach dem Update sind alle bisherigen Aufgaben, Notizen und Heute-Einträge noch da, mit gleichem Text, Zuständigkeit und Status.
13. **Partner-App geht nicht kaputt.** Neue Felder sind optional, alte Felder behalten ihre Bedeutung.
    Test: Eine wiederkehrende Aufgabe in Partner-App ansehen und dort abhaken, danach sind Intervall und Verlauf im Cockpit noch vorhanden.
14. **Layout bleibt ohne Seiten-Scrollen** auf 1366 × 1024 und 1180 × 820, auch mit 20 Aufgaben. Telefon eine Spalte.
    Test: Messung wie in Version 2.12, leer und mit 20 Einträgen.

## Später (nicht in dieser Runde)
- Essensplan (Woche mit Rezepten, Zutaten in den Einkauf)
- Erinnerungen per Push aufs Handy
- Kalender-Verbesserungen (Wochenansicht, Kategorien, Konflikte), weiter nur lesend

## Nicht dabei
- Termine anlegen oder ändern (Kalender bleibt nur lesend, iCloud ist die Quelle)
- Eigenes Layout oder Fernbedienung für den Fernseher
- Neue Funktionen in Partner-App
- Abwechselnde oder feste Zuständigkeit bei wiederkehrenden Aufgaben
- Punkte, Statistiken, Belohnungen

## Rahmen
- Statische PWA ohne Build, Supabase "Haushalt", Sync pro Eintrag, Löschmarken statt Löschen.
- Keine Serveränderung, wenn es ohne geht. Alles in der Liste `tasks` mit neuen optionalen Feldern.
- Kein Haushaltscode, keine Namen, Orte oder echten Termine im Repo.
- Jede Änderung: Versionsnummer, Eintrag in HANDOFF.md, Service-Worker-Version, Tests, Code- und Design-Review, Branch und Pull Request.

## Zurückweisen, wenn
- eine bestehende Aufgabe, Notiz oder ein Einkaufsposten nach dem Update fehlt oder verändert ist
- Partner-App nach dem Update Fehler zeigt oder Aufgaben-Felder überschreibt
- die Seite auf dem iPad quer scrollt
- eine Erinnerung nachts (22 bis 6 Uhr) Ton macht

## Offene Risiken
- Wie Partner-App mit unbekannten Feldern in `tasks` umgeht (behält sie die beim Schreiben?), prüfe ich im Code der Partner-App vor dem Bau.
- Ton im Safari auf dem iPad braucht eine Berührung nach dem Laden, bevor Töne erlaubt sind. Ohne die kommt nur das Banner.

## Korrigier mich, bevor ich baue
| Annahme | Risiko |
| --- | --- |
| Beim Abhaken erscheint eine kleine Auswahl mit beiden Personen und Beide (das iPad weiß nicht, wer davor steht). | mittel |
| Verlauf liegt im Aufgaben-Eintrag selbst, gekürzt auf 20 Durchgänge. Keine neue Tabelle, keine Serveränderung. | mittel |
| Die Zuständigkeits-Chips bei bestehenden einmaligen Aufgaben bleiben wie heute. | niedrig |
| Erinnerung erscheint auch im Standby-Kalender als Banner, nachts nur still. | niedrig |
| Analyse und Benchmark stehen als Datei `docs/ANALYSE.md` im Repo, ohne persönliche Angaben. | niedrig |
| Nach der Analyse baue ich direkt Phase 1, ohne nochmal auf Freigabe zu warten, außer der Plan weicht von dieser Spec ab. | hoch |
