# Spec: Nährwerte im Rezept

**Ziel:** Jedes Rezept zeigt kcal, Eiweiß, Fett und Kohlenhydrate pro Portion und pro 100 g, im Kochmodus und im Bearbeiten-Dialog.

**Erfolg:** Ein beliebiges Rezept (per Link, Screenshot oder eingetippt) zeigt beim Kochen ohne weiteres Zutun Nährwerte, auch offline.

## Muss
| # | Was | Abnahmetest |
|---|-----|-------------|
| 1 | Kochmodus: kleine Tabelle unter dem Bild in der Zutatenspalte, Spalten kcal, Eiweiß, Fett, KH, Zeilen "pro Portion" und "pro 100 g" | Rezept kochen: Tabelle steht zwischen Bild und Portionen, iPad quer scrollt die Seite nicht |
| 2 | Link-Import übernimmt die Werte der Rezeptseite (schema.org nutrition: calories, proteinContent, fatContent, carbohydrateContent, servingSize) | Chefkoch-Rezept mit Nährwerten importieren: Kochmodus zeigt dieselben kcal pro Portion wie die Seite, Hinweis "laut Rezeptseite" |
| 3 | Fehlt ein Wert, schätzt die App ihn aus den Zutaten mit einer eingebauten Tabelle häufiger Lebensmittel (pro 100 g) und Umrechnung von Stück, EL, TL, Prise, Dose, Becher, Zehe, ml, l in Gramm. Geschätzte Werte tragen "ca." | Eingetipptes Rezept "500 g Nudeln, 400 g passierte Tomaten, 1 EL Olivenöl", 4 Portionen: etwa 510 kcal pro Portion mit "ca." |
| 4 | Pro 100 g aus dem Portionsgewicht (servingSize der Seite, sonst geschätztes Gesamtgewicht der Zutaten geteilt durch Portionen) | Rezept aus #3: pro 100 g etwa 220 kcal (Nudeln roh gerechnet) |
| 5 | Zu wenig erkannt (unter etwa 70 % des Gewichts oder Mengen fehlen): statt Zahl "k. A." und ein Hinweis, welche Zutaten nicht erkannt wurden (im Dialog) | Rezept nur mit "etwas Öl, Salz, Gewürze": "k. A.", keine falsche Zahl |
| 6 | Bearbeiten-Dialog: vier Felder pro Portion zum Korrigieren, leeres Feld heißt "schätzen". Selbst eingetragene Werte gelten vor Seite und Schätzung | kcal auf 600 setzen, speichern: Kochmodus zeigt 600 ohne "ca." |
| 7 | Schätzung wird beim Anzeigen gerechnet, nicht gespeichert. Ändern der Zutaten ändert die Schätzung sofort. Alte Rezepte haben damit sofort Werte | Altes Rezept öffnen: Werte da. Zutat dazu, speichern: Werte ändern sich |
| 8 | Gespeichert wird nur `nutr: {kcal, p, f, c, g, src}` (src = page oder user), klein, mit abgeglichen | Rezept mit Seitenwerten auf dem zweiten Gerät öffnen: gleiche Werte |
| 9 | Dashboard, Essensplan und Sammlungsliste bleiben ohne Nährwerte | Sehen aus wie vorher |

## Nicht dabei
- Weitere Werte (Zucker, Ballaststoffe, Salz, Vitamine)
- Online-Nährwertdatenbanken oder Barcode-Scan
- Alte Linkrezepte nachträglich von der Seite holen (sie bekommen die Schätzung)
- Tagesbilanz oder Kalorienzählen über den Essensplan

## Rahmen
- Keine Gedankenstriche in Texten der App. Version 3.8, HANDOFF-Zeile, sw.js-Version hochzählen, neue Datei in die SHELL-Liste.
- Schätzlogik in eigenem, testbarem Modul mit Tests in `tests/`.

## Zurückweisen, wenn
- Das iPad im Kochmodus scrollen muss.
- Eine geschätzte Zahl ohne "ca." erscheint.
- Bei kaum erkannten Zutaten eine Zahl statt "k. A." erscheint.

## Annahmen (korrigiere mich, bevor ich baue)
- Die Tabelle deckt etwa 250 häufige Lebensmittel ab (Grundzutaten deutscher Küche). Seltenes wird nicht erkannt und im Dialog gelistet. Risiko: mittel.
- Verkochtes Wasser wird nicht berücksichtigt, pro 100 g ist bei Suppen und Eintöpfen nur grob. Risiko: niedrig.
- Die Partner-App behält das unbekannte Feld `nutr` wie `fav` und `cat`. Risiko: niedrig.
- Portionen ändern im Kochmodus ändert die Werte pro Portion nicht (sie gelten immer für eine Portion). Risiko: niedrig.
