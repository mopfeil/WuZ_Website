# Wissenschaft und Zauberkunst – Website

Statische Website für das Label **Wissenschaft und Zauberkunst** (Prof. Dr. Markus Pfeil).
Kein Build-Schritt, keine Abhängigkeiten, keine externen Dienste: reines HTML, CSS und JavaScript.

## Struktur

```
index.html              Landing Page (Idee, Formate, Person, Werkzeuge, FAQ, Kontakt)
hintergrund/            Vertiefung: Blog-Reihe "Geschichten von der Natur der Dinge", Script, Studien
werkzeuge/              Übersicht der Web-Apps
blog/                   "Der Pfeil Blog": Archiv des alten Blogs derpfeil.me (13 Beiträge, deutsch);
                        englische Übersetzungen unter en/blog/ (andere Slugs, hreflang-verknüpft)
en/                     Englische Fassung (britisches Englisch): en/, en/background/, en/tools/,
                        en/shop/, en/imprint/, en/privacy/ – jede Seite verweist per hreflang und
                        Sprachumschalter (DE | EN im Kopf) auf ihr Gegenstück
apps/ideomotor/         Ideomotor-Pendel (PWA, Kopie aus Code/Ideomotor_Pendel)
apps/masken-tarot/      Die Masken des Tarot (Kopie aus Code/Kartenwahl, ohne Google Fonts)
apps/abstimmung/        ArUco-Abstimmung (PWA, Kopie aus Code/webapp; 250er-Markerset, Antworten A–H)
apps/abstimmung-75/     ArUco-Abstimmung 75 (PWA, Kopie aus Code/WebApp75; 7,5-cm-Karten, 7er-Skala,
                        Querformat = Ergebnisanzeige). Beide bisher nicht auf der Werkzeuge-Seite verlinkt.
apps/familienaufgaben/  Private Familien-App (PWA, Kopie aus Code/Familienaufgaben). Nirgends verlinkt,
                        noindex; api/sync.php (PHP) legt verschlüsselte Sync-Daten in api/data/ ab
                        (per .gitignore ausgenommen, entsteht nur auf dem Server)
shop/                   Shop-Stub (noch ohne Bestellfunktion)
impressum/              Impressum
datenschutz/            Datenschutzerklärung
assets/css/site.css     Stylesheet
assets/js/site.js       Menü, Jahr im Footer, Einblend-Animation
assets/img/sigil.svg    Sigille (Logo), aus der TikZ-Vignette des Scripts abgeleitet
404.html, .htaccess     Fehlerseite, HTTPS-Redirect, Caching
robots.txt, sitemap.xml SEO-Begleitdateien
```

Alle Links sind wurzelrelativ (`/hintergrund/`). Die Site muss deshalb im **Domain-Root**
(`public_html`) liegen, nicht in einem Unterordner.

## Vor dem Livegang anpassen

1. **Domain:** Die Site ist auf `https://www.wissenschaftundzauberkunst.de` eingestellt (Canonical-Links,
   Open Graph, `robots.txt`, `sitemap.xml`). Bei einem Domainwechsel alle Vorkommen per Suchen/Ersetzen anpassen.

2. **Impressum und Datenschutz:** Anschrift und USt-IdNr. sind eingetragen. Beide Texte vor
   Veröffentlichung juristisch prüfen lassen; den Server-Standort ggf. im Hostinger-Konto nachsehen
   und in Abschnitt 3 der Datenschutzerklärung konkretisieren.

3. **Shop:** Sobald ein Zahlungsanbieter angebunden wird, Datenschutzerklärung, AGB und
   Widerrufsbelehrung ergänzen.

## Zwei Sprachen, zwei Domains

- Deutsch liegt im Root (`/`), Englisch unter `/en/`. Der Umschalter DE | EN im Seitenkopf
  führt immer zur entsprechenden Seite der anderen Sprache; `hreflang`-Links und die
  Sitemap verknüpfen beide Fassungen für Suchmaschinen.
- **wissenschaftundzauberkunst.com → Englisch:** Je nachdem, wie die .com-Domain bei Hostinger
  eingerichtet ist:
  - *Weiterleitung (Domain-Forward / Redirect)*: Als Ziel `https://www.wissenschaftundzauberkunst.de/en/`
    eintragen (Typ 301). Dann landen .com-Besucher direkt in der englischen Fassung.
  - *Alias- oder Parked-Domain auf dasselbe Verzeichnis*: Nichts weiter nötig, die `.htaccess`
    erkennt den Host `.com` und leitet `/` nach `/en/` sowie deutsche Pfade auf ihre englischen
    Gegenstücke um. Alle Aufrufe enden auf der .de-Domain, damit es nur eine kanonische Adresse gibt.
- Die Sprachwahl bleibt jederzeit möglich; es wird keine Präferenz gespeichert.
- Die Pendel-App unter `apps/ideomotor/` hat derzeit nur eine deutsche Oberfläche; die Tarot-App ist
  zweisprachig.

## Deployment auf Hostinger (Git)

Hostinger holt die Dateien direkt aus diesem Repository.

1. hPanel öffnen → **Websites** → bei der Domain auf **Verwalten** (Manage).
2. Links im Menü **Erweitert → Git** (Advanced → Git).
3. Unter **Repository erstellen**:
   - Repository: `https://github.com/mopfeil/WuZ_Website.git` (öffentliches Repo, kein SSH-Key nötig)
   - Branch: `main`
   - Verzeichnis: leer lassen (= `public_html`). Der Zielordner muss leer sein; vorhandene
     Platzhalter-Dateien (z. B. `default.php`) vorher im Dateimanager löschen.
4. **Erstellen** klicken. Hostinger klont das Repository; die Seite ist danach erreichbar.
5. **Automatisches Deployment:** Im selben Git-Bereich zeigt Hostinger eine **Webhook-URL**.
   Diese in GitHub unter *Repository → Settings → Webhooks → Add webhook* eintragen
   (Payload URL = Hostinger-Webhook, Content type `application/json`, Event: *Just the push event*).
   Ab dann wird jeder Push auf `main` automatisch veröffentlicht. Ohne Webhook: im hPanel
   auf **Deploy** klicken.
6. SSL: Unter **Sicherheit → SSL** das kostenlose Zertifikat aktivieren; `.htaccess`
   leitet dann auf HTTPS um. Die Pendel-App braucht HTTPS für die Bewegungssensoren.

Bei privatem Repository stattdessen den von Hostinger angezeigten SSH-Key als *Deploy Key*
in GitHub hinterlegen und die SSH-URL verwenden.

## Lokal testen

```bash
python -m http.server 8137
```

Dann `http://localhost:8137/` öffnen. `localhost` gilt als sicherer Kontext, die
Pendel-App läuft dort im Mausmodus.

## Apps aktualisieren

Die Apps sind Kopien aus `Code/Ideomotor_Pendel`, `Code/Kartenwahl`, `Code/webapp` (→ `apps/abstimmung/`),
`Code/WebApp75` (→ `apps/abstimmung-75/`) und `Code/Familienaufgaben`. Nach Änderungen dort
die Dateien erneut nach `apps/` kopieren; in `apps/ideomotor/sw.js` die `CACHE_VERSION`
erhöhen, damit installierte PWAs die neue Fassung laden. In der Tarot-Kopie wurden die
Google-Fonts-Links entfernt (DSGVO); die App nutzt die im CSS hinterlegten Fallback-Schriften.
