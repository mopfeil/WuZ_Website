# Würfel

Offline-fähige Web-App (PWA) für ein Handy: digitaler Sechserwürfel, bei dem sich vor dem
Wurf einzelne Augenzahlen abschalten lassen. Gedacht als Ersatz für einen echten Würfel bei
Kunststücken/Experimenten (z. B. NIM, Schere-Stein-Papier), bei denen nur bestimmte Augenzahlen
gültig sind – statt bei jedem unpassenden Wurf neu zu würfeln, fällt das Ergebnis von vornherein
nur unter den erlaubten Zahlen.

## Bedienung

1. Die sechs Würfelsymbole antippen, um sie einzeln ein- oder auszuschalten (aktiv = golden).
   Schnellauswahl-Chips darunter setzen gängige Teilmengen: Alle, Keine, 1–3, 4–6, Gerade, Ungerade.
2. **Würfeln** ist gesperrt, solange keine Augenzahl aktiv ist.
3. Das Ergebnis erscheint groß in der Mitte (kurze Rüttel-Animation, auf iPhones zusätzlich ein
   kurzer Vibrationsimpuls); die letzten zehn Würfe stehen als Verlauf darunter.
4. Auswahl und Verlauf bleiben im Browser gespeichert (`localStorage`) und sind beim nächsten
   Öffnen wieder da – rein lokal auf dem jeweiligen Gerät, kein Server beteiligt.

## Dateien

```
index.html            Aufbau der Oberfläche
style.css              Darstellung (dunkles Theme, große Tap-Flächen)
app.js                 Auswahl, Zufallszug, Verlauf, lokale Speicherung
sw.js                  Service-Worker (Offline-Cache; CACHE_VERSION erhöhen bei Änderungen!)
manifest.webmanifest   PWA-Manifest
icon-180/192/512.png   App-Icons
_make_icons.py         erzeugt die Icons neu (benötigt Pillow)
```

## Installation auf dem Handy (offline)

1. Ordnerinhalt liegt bereits unter `apps/wuerfel/` im Website-Repo und wird mit
   veröffentlicht (siehe Haupt-README, Abschnitt „Deployment auf Hostinger“).
2. Adresse auf dem Handy öffnen; auf dem iPhone in **Safari** über
   Teilen → **Zum Home-Bildschirm** hinzufügen (nur Safari kann das).
3. Ab dann läuft die App dank Service-Worker offline weiter.

### Ohne Server ausprobieren (Desktop)

```bash
python -m http.server 8137
```

Dann `http://localhost:8137/apps/wuerfel/` öffnen.

## Hinweis

Die App ist bislang nicht auf der Werkzeuge-Seite (`/werkzeuge/`) verlinkt, analog zu
`apps/abstimmung/`, `apps/abstimmung-75/` und `apps/familienaufgaben/` – Aufruf direkt über
`/apps/wuerfel/`.
