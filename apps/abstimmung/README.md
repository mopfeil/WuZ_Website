# ArUco Abstimmung - Web-App (PWA)

Läuft direkt auf dem iPhone in Safari. Erkennt hochgehaltene ArUco-Marker über
die Kamera, wertet die **Drehung** des Markers als Antwort aus (bis zu 8 Stufen
A–H, alle 45°), merkt sich pro Frage die gescannten Teilnehmer, zeigt fehlende
an und exportiert die Ergebnisse als CSV (für Excel).

Marker-Set: **ARUCO_MIP_36h12** (250 robuste Marker, IDs 0–249).

## Wichtig: einmal online laden, dann offline nutzbar

Eine Kamera-Web-App braucht eine **sichere Verbindung (HTTPS)**. Deshalb muss
die App **einmalig über das Internet** geladen werden. Danach ist sie als PWA
auf dem iPhone gespeichert und läuft beim Experiment **vollständig ohne
Internet**.

## 1. App ins Internet stellen (einmalig)

Den kompletten Ordner `webapp/` bei einem kostenlosen HTTPS-Hoster ablegen.
Empfohlen: **GitHub Pages**.

1. Kostenloses Konto auf github.com anlegen.
2. Neues Repository erstellen (z.B. `abstimmung`), als *public*.
3. Den Inhalt des Ordners `webapp/` ins Repository hochladen
   (Weboberfläche: „Add file" → „Upload files", alle Dateien inkl. Ordner
   `lib/` hineinziehen).
4. Im Repository: Settings → Pages → Source = „Deploy from a branch",
   Branch = `main`, Ordner `/ (root)` → Save.
5. Nach ein paar Minuten ist die App erreichbar unter
   `https://DEINNAME.github.io/abstimmung/`

Alternativen: Netlify, Cloudflare Pages, Vercel – jeder statische HTTPS-Hoster
funktioniert.

## 2. Auf dem iPhone installieren

1. Die HTTPS-Adresse in **Safari** öffnen (mit Internet).
2. Teilen-Symbol → **„Zum Home-Bildschirm"**.
3. Die App vom Home-Bildschirm starten und beim ersten Mal den
   **Kamerazugriff erlauben**.

Beim ersten Start (mit Internet) speichert die App alle Dateien auf dem Gerät.
Danach funktioniert sie offline – also auch beim Experiment ohne WLAN/Mobilfunk.

## 3. Marker drucken

Im Menü (☰) → „Marker drucken" oder direkt `markers.html` öffnen. Jede Karte
zeigt einen Marker mit den Buchstaben A–H rundherum. Der Buchstabe, der beim
Hochhalten **oben** ist, ist die Antwort. Karten ausdrucken (möglichst groß,
mind. 15 cm) und an die Teilnehmer verteilen.

## 4. Bedienung

- **Kamera starten** und das iPhone auf die Teilnehmer richten.
- Erkannte Marker werden farbig markiert: gelb = gesehen, grün = Antwort
  übernommen, orange = unbekannte Marker-Nr.
- Oben: Frage und Antwortoptionen mit Live-Zählung.
- Unten: „gescannt X / Y", Button **Fehlende** zeigt die noch fehlenden
  Marker-Nummern.
- **Speichern & weiter** schließt die Frage ab und speichert die Daten.
- **Zurücksetzen** verwirft die Antworten der aktuellen Frage,
  **Überspringen** geht ohne Speichern weiter.
- Nach der letzten Frage: **CSV exportieren**.

Die Daten werden laufend auf dem Gerät zwischengespeichert – bei einem Absturz
kann die Sitzung fortgesetzt werden.

## 5. Konfiguration

Fragen, Antwortoptionen und Teilnehmer stehen in `config.json`. Auf dem Gerät
lassen sie sich auch im Menü → „Konfiguration" bearbeiten (als JSON, wird
lokal gespeichert).

- `orientation_map` – welche Drehung welcher Antwort entspricht. Für weniger
  Stufen Einträge entfernen (z.B. nur `0/90/180/270` für 4 Antworten – das ist
  zuverlässiger als 8 Stufen mit nur ±22,5° Toleranz).
- `participants` – Liste der erlaubten Marker-Nummern (0–249).
- `questions` – die Fragen mit 2–8 Optionen.

Vor dem Experiment empfiehlt sich das Menü → **„Marker-Test"**: damit lässt
sich live prüfen, ob die Drehungen sauber erkannt werden.

## 6. Ergebnisse / Auswertung

Der CSV-Export erzeugt eine Datei `ergebnisse_<Zeit>.csv` (Semikolon-getrennt,
mit UTF-8-BOM – öffnet direkt in Excel). Eine Zeile je Frage und Teilnehmer
(Long-Format, ideal für Pivot-Auswertung). Die Datei landet über das iOS-Teilen-
Menü in „Dateien", per AirDrop oder E-Mail.

## App aktualisieren

Wenn du App-Dateien änderst und neu hochlädst: in `sw.js` die `CACHE_VERSION`
erhöhen (z.B. `-v2`), damit die iPhones die neue Version laden.
