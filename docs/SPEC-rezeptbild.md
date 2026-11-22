# Spec: Bild vom Gericht im Rezept

**Ziel:** Jedes Rezept zeigt im Kochmodus und im Bearbeiten-Dialog ein Bild vom Gericht, geholt aus dem Link oder aus einem Screenshot.

**Erfolg:** Ein neues Rezept per Link (z. B. Chefkoch) hat nach dem Speichern ohne weiteres Zutun ein Bild im Kochmodus, auch offline und auf dem Handy.

## Muss
| # | Was | Abnahmetest |
|---|-----|-------------|
| 1 | Bild im Kochmodus oben in der Zutatenspalte (Querformat), auf dem Handy oben | Rezept mit Bild kochen: Bild steht über den Portionen, iPad quer scrollt die Seite nicht |
| 2 | Vorschau im Bearbeiten-Dialog mit "Bild wählen" (Fotos/Kamera) und "Bild entfernen" | Eigenes Foto wählen, speichern: Kochmodus zeigt das neue Bild. Entfernen, speichern: Platzhalter |
| 3 | Link-Import holt das Bild (schema.org, sonst og:image), lädt es über wsrv.nl verkleinert und speichert es im Rezept | Import per Link, speichern, WLAN aus, Kochmodus: Bild ist da |
| 4 | Screenshot-Import: nach dem Lesen Auswahl, welcher Screenshot das Bild ist; ohne Auswahl der erste | 2 Screenshots importieren, den zweiten antippen, speichern: Kochmodus zeigt den zweiten |
| 5 | Bilder werden klein gespeichert (4:3, 360 × 270, höchstens ca. 22 KB als Text) und mit dem Rezept abgeglichen | Rezept mit Bild speichern: Abgleich ohne Fehler "item too large", Bild erscheint auf dem zweiten Gerät |
| 6 | Alte Rezepte mit Link, aber ohne Bild (oder mit alter Bildadresse) holen das Bild beim ersten Öffnen im Kochmodus oder Bearbeiten nach | Altes Linkrezept öffnen (online): Bild erscheint und bleibt danach |
| 7 | Ohne Bild: ruhiger Platzhalter mit Symbol, kein Fehler | Eingetipptes Rezept ohne Link kochen: Platzhalter, keine Konsolenfehler |
| 8 | Dashboard und Sammlungsliste bleiben ohne Bild | Dashboard und Sammlung sehen aus wie vorher |

## Nicht dabei
- Bilder in Dashboard, Essensplan oder Sammlungsliste
- Automatisches Ausschneiden des Essens aus einem Screenshot
- Massen-Nachladen aller alten Rezepte auf einmal

## Rahmen
- Keine Gedankenstriche in Texten der App. Versionsnummer, HANDOFF-Zeile, sw.js-Version hochzählen.
- CSP: `connect-src` bekommt `https://wsrv.nl`. `img-src` bleibt bei `'self' data: blob:` (keine Bilder direkt von fremden Seiten).
- Hinweistext im Import ergänzt: Bildadresse geht an wsrv.nl.

## Zurückweisen, wenn
- Das iPad im Kochmodus scrollen muss.
- Ein Rezept wegen des Bildes nicht mehr abgeglichen wird.

## Annahmen (korrigiere mich, bevor ich baue)
- Partner-App zeigt `image` als normales `<img src>` an, ein `data:`-Bild funktioniert dort auch. Risiko: mittel. Falls nicht, sieht das Handy nur kein Bild, Daten gehen nicht kaputt.
- Bildgröße 360 × 270 (4:3), JPEG, Qualität wird reduziert bis unter ca. 22 KB. Kleiner als zuerst geplant, weil die Rezepte im Speicher des Browsers liegen, den sich Cockpit und Partner-App teilen. Risiko: niedrig.
- Nachladen alter Bilder nur, wenn online; schlägt es fehl, bleibt der Platzhalter und es wird beim nächsten Öffnen erneut versucht. Risiko: niedrig.
- Ein im Bearbeiten-Dialog geändertes Bild überschreibt nur das Bild, andere Änderungen vom Handy bleiben erhalten. Risiko: niedrig.
