# ArUco Abstimmung 75 — Web-App (PWA)

Variante der Abstimmungs-Web-App für **7,5 × 7,5 cm-Marker** mit
orientierungsgesteuerter Bedienung — alles läuft direkt auf dem iPhone:

- **Hochkant (portrait) = Scannen**: Kamera erkennt die Marker und ihre
  Drehung als Antwort (7er-Skala „1"–„7", 45°-Schritte; 315° ist eine
  tote Zone und rastet nicht ein)
- **Quer (landscape) = Ergebnis-Anzeige**: große, plakative Balken-
  darstellung — während einer Frage **live**, nach Abschluss durch alle
  Fragen blätterbar. Während der Anzeige ist die Erkennung pausiert.
- **Am Beamer**: iPhone per AirPlay oder HDMI-Adapter spiegeln und einfach
  quer drehen — die Klasse sieht die Ergebnisse groß.

Marker-Set: **WUZ_16h5_20** — ein eigenes, kompaktes 16-Bit-Set
(4×4-Raster) mit **20 Markern** (IDs 0–19), generiert mit maximiertem
Hamming-Mindestabstand 5 über alle Rotationen (`lib/dict_wuz16.js`).
Gegenüber dem 250er-Standardset sind die Marker-Zellen dadurch ~⅓ größer,
und der Marker belegt 66 % statt 50 % der Karte — zusammen fast die
**doppelte Erkennungsreichweite** bei gleicher Kartengröße.
Basis: die App im Ordner `../webapp/` (dort steht die ausführliche
Anleitung zu Hosting, Installation und Bedienung — alles gilt hier genauso).

## Unterschiede zur Basis-App (`../webapp/`)

| | webapp | **WebApp75** |
|---|---|---|
| Marker-Set | ARUCO_MIP_36h12 (250 Marker, 6×6 Bit) | **WUZ_16h5_20 (20 Marker, 4×4 Bit)** |
| Marker auf der Karte | 50 % | **66 %** |
| Marker-Druckgröße (Standard) | 8 cm | **7,5 cm** |
| Verarbeitungsbreite | 960 px | **1280 px** |
| Beispiel-Skala | A–H | **7er-Likert („1"–„7") + tote Zone bei 315°** |
| Antwort außerhalb der Optionen | rastet ein | **rastet nicht ein** (tote Zone) |
| Querformat | wie Hochkant | **plakative Ergebnis-Anzeige** |

## Schnellstart

1. Ordner bei einem HTTPS-Hoster ablegen (GitHub Pages o. ä. — Anleitung
   in `../webapp/README.md`) und auf dem iPhone „Zum Home-Bildschirm".
2. Menü (☰) → „Marker drucken": 7,5-cm-Karten erzeugen und drucken
   (auf A4 passen 6 Stück, ausschneiden).
3. Fragen/Teilnehmer im Menü → „Konfiguration" anpassen
   (`orientation_map`: der Eintrag `"315": "E"` muss bleiben — er bildet
   die tote Zone; „E" darf nur in keiner Frage als Option vorkommen).
4. Scannen in Hochkant; zum Präsentieren quer drehen.

## Reichweiten-Hinweis

Durch das kompakte 20er-Set (größere Zellen) und den größeren Marker-Anteil
auf der Karte tragen die 7,5-cm-Karten etwa **5–7 m** (gute Beleuchtung
vorausgesetzt) — statt ~3–4 m mit dem 250er-Standardset. Für größere Räume
durchs Publikum gehen oder größere Karten drucken (Größe einstellbar).

Mehr als 20 Teilnehmer? In `config.json` das `marker_dictionary` auf
`ARUCO_MIP_36h12` zurückstellen (250 Marker, `max_hamming_distance: 5`) —
dann gilt wieder die kürzere Reichweite.

## Änderungen veröffentlichen

Nach Datei-Änderungen in `sw.js` die `CACHE_VERSION` erhöhen
(z. B. `-v2`), damit installierte iPhones die neue Version laden.
