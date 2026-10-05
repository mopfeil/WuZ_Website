# Ideomotor-Pendel online (Wettbewerb)

Mehrspieler-Fassung des [Ideomotor-Pendels](../ideomotor/). Alle spielen
gleichzeitig auf dem eigenen Telefon; in einem festen Zeitfenster gewinnt, wer
die Scheibe **mit möglichst wenig echter Bewegung möglichst weit** ausschlagen
lässt. Physik, Sensorik und Lock-in-Auswertung sind unverändert aus der
Einzelfassung übernommen (dort im README beschrieben).

## Ablauf

1. **Spielleitung** öffnet `/apps/ideomotor-online/`, klappt „Raum eröffnen“
   auf, wählt Rundendauer, Güte Q und Zielmarke → landet auf der
   **Anzeigetafel** (`?r=CODE&tafel=1`, für den Beamer) mit QR-Code zum
   Beitreten (antippen = bildschirmfüllend). Der Schlüssel der
   Spielleitung liegt nur im Browser, in dem der Raum eröffnet wurde.
2. **Mitspielende** öffnen dieselbe Adresse (oder direkt `?r=CODE`), geben
   Code und Namen ein, geben die Sensoren frei und kalibrieren. Bis zum Start
   üben sie frei.
3. **Runde starten** auf der Tafel: 5 s Countdown, dann läuft auf allen
   Telefonen dasselbe Zeitfenster (Serverzeit, Uhrabgleich bei jeder Abfrage).
   Das Pendel startet bei allen aus der Ruhe.
4. Rangliste live auf Tafel und Telefon; nach Rundenende melden die Telefone
   ihre Endwerte. „Nächste Runde starten“ beginnt die nächste Runde, Einstellungen
   lassen sich dazwischen ändern. **Ergebnisse als CSV** exportiert die Runde.

Die Tafel kann auch ohne Schlüssel geöffnet werden (nur Anzeige, keine Knöpfe).

## Wertung

```
Wirkungsgrad  W = ∫ Ausschlag dt  /  ∫ Bewegung dt        (über die ganze Runde)
Punkte        = 1000 · min(1, W/Q) · min(1, Spitzenausschlag / Zielmarke)
```

*Bewegung* ist der gesamte Antrieb als gleichwertiger Weg (Verschieben und
Kippen). Für die Hüllkurve des getriebenen Pendels gilt
`∫A dt ≤ Q·∫d dt − τ·A_Ende` (τ = 2Q/ω) – W kann Q also nicht überschreiten.
Ein Augenblicksverhältnis Ausschlag ÷ Bewegung wäre dagegen beim Ausschwingen
nach dem Stillhalten beliebig groß geworden. Die Zielmarke verhindert, dass
reines Stillhalten (Sensorrauschen) gewinnt. Gleichstand: weniger Bewegung vorn.

Kopflos geprüft (`physik.js`, 60-s-Runde, L = 0,5 m, Q = 30, Zielmarke 50 %):

| Spielweise | Punkte | W |
|---|---|---|
| 2 mm durchgehend im Takt | 782 | ×23,5 |
| 1 mm durchgehend im Takt (Ziel nicht erreicht) | 448 | ×23,5 |
| 3 mm im Takt für 15 s, dann still | 933 | ×28,0 |
| 10 mm im Takt (Scheibe schlägt am Rand an) | 333 | ×10,0 |
| 3 mm, aber 0,85 Hz statt 0,705 Hz | 48 | ×3,7 |
| nur Sensorrauschen | ≈ 10 | – |

Die beste Strategie – kurz und genau im Takt anschwingen, dann ruhig halten –
ist physikalisch ehrlich: Das Ausschwingen hat die Bewegung vorher „bezahlt“.

Die Auswertung läuft auf den Telefonen; der Server prüft nur Wertebereiche.
Für einen Hörsaalwettbewerb reicht das, fälschungssicher ist es nicht.
Teilnahme ohne Sensor (Finger/Maus) ist möglich und wird markiert.

## Dateien

```
index.html, style.css   Oberfläche (Telefon, Startseite, Anzeigetafel)
physik.js               Pendel, Lock-in, Wertung (ohne DOM, kopflos testbar)
app.js                  Sensorik, Ablauf, Serverabgleich, Tafel, CSV
lib/qrcode.js           QR-Code-Generator (Kazuhiko Arase, MIT, v1.4.4), lokal statt CDN
api/room.php            Raumverwaltung, eine JSON-Datei pro Raum unter api/data/
                        (per .htaccess gesperrt, nicht im Git, Räume verfallen nach 48 h)
```

Grenzen: 300 Räume, 200 Telefone pro Raum. Jedes Telefon fragt während einer
Runde einmal pro Sekunde, sonst alle 2 s – 100 Telefone ≈ 100 Anfragen/s.
Kein Service Worker: Die App braucht ohnehin eine Verbindung.
