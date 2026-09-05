# Ideomotor-Pendel

Offline-fähige Web-App (PWA) für das iPhone. Auf dem waagerecht gehaltenen
Display schwingt eine Scheibe wie der Körper eines **mathematischen Pendels**
in x- und y-Richtung. Aufhängepunkt des Pendels ist das Telefon selbst.

Die Versuchsperson soll die Scheibe „mit Gedanken“ in Schwingung versetzen
(links–rechts = JA, vor–zurück = NEIN) und dabei so wenig wie möglich
tatsächlich bewegen. Die App misst, **wie viel reale Bewegung dafür nötig war** –
getrennt nach Verschieben (in Millimetern) und Kippen (in Grad).

---

## 1  Physikalisches Modell

Mit `r` = Auslenkung der Scheibe relativ zum Aufhängepunkt (in der
Bildschirmebene) gilt für kleine Winkel

```
r'' = -(g/L)·r  -  2γ·r'  -  f_h            ω = √(g/L),  γ = ω/(2Q)
```

`f_h` ist der waagerechte Anteil der **spezifischen Kraft** – also genau das,
was der Beschleunigungssensor liefert (`a − g`). Dadurch sind beide möglichen
Antriebe physikalisch korrekt und in einer einzigen Größe erfasst:

| Handlung | Beitrag zu `f_h` |
|---|---|
| Telefon verschieben | `a_translation` |
| Telefon kippen | `g · sin(Neigung)` |

Statisches Kippen verschiebt die Ruhelage um `L·sin(Neigung)` – die Scheibe
läuft zur tiefer liegenden Seite, wie eine Kugel in einer Schale.
Beide Vorzeichenkonventionen des Sensors (W3C und die davon abweichende von
iOS Safari) werden bei der Kalibrierung automatisch erkannt.

## 2  Auswertung

* Über den Lagesensor (`deviceorientation`) wird `f_h` in **Kipp-** und
  **Translationsanteil** zerlegt.
* Beide werden per **Lock-in-Demodulation** bei der Pendelfrequenz ω
  ausgewertet (Zeitkonstante 1,2 s). Die Amplitude der Telefonverschiebung
  folgt aus `x = A_a / ω_Hand²`.
* Der Vergleich mit dem erreichten Pendelausschlag ergibt die **effektive
  Verstärkung**; ihr Maximum ist die Güte `Q`.

Zwei Feinheiten, die sonst systematische Fehler erzeugen:

* Umgerechnet wird mit dem **tatsächlichen Takt der Hand**, nicht mit ω₀.
  Dieser Takt ergibt sich aus der Drehrate des Lock-in-Zeigers: die Phase des
  Antriebs dreht mit `ω_Hand − ω₀`. Mit fest ω₀ wäre eine 4-mm-Bewegung bei
  0,86 Hz als 5,9 mm ausgewiesen worden.
* Liegt der Takt neben ω₀, dämpft der Lock-in-Tiefpass den mitdrehenden Zeiger
  um `1/√(1+(Δω·τ)²)`. Da Δω gemessen wird, nimmt die App das exakt zurück.

### Güte der Resonanz

Die Scheibenauslenkung wird mit derselben Referenz demoduliert wie der Antrieb.
Aus beiden komplexen Amplituden folgt die Phasenlage ψ; im exakten Resonanzfall
beträgt sie 90°. Für den getriebenen Oszillator gilt

```
|Ausschlag| / |Ausschlag bei Resonanz| = |sin ψ|
```

Die Phase sagt also unmittelbar, wie gut der Takt saß – und zwar unabhängig
davon, wie groß die Bewegung war. Angezeigt werden zwei Größen:

| Größe | Bedeutung |
|---|---|
| **Resonanzausbeute** | erreichte Verstärkung ÷ Q — wie viel des Möglichen herausgeholt wurde |
| **Takttreue** | `\|sin ψ\|` aus der Phasenlage — wie genau der Rhythmus saß |

Beim Aufschwingen bleibt die Ausbeute zurück, die Takttreue steht schon früh
richtig. Auseinanderfallen beide, wird noch aufgebaut; sind beide klein, war
der Rhythmus falsch.

Beispiel mit den Voreinstellungen (L = 0,50 m, T = 1,42 s, Q = 30):
Eine Handbewegung von **2,2 mm** im Takt der Resonanz erzeugt einen
Scheibenausschlag von etwa **60 mm** – Faktor 28.

Verifiziert (kopfloser Test des ausgelieferten `app.js`):

| Vorgabe | gemessen |
|---|---|
| nur Kippen, 0,25° | 0,25° Kippen, 0,14 mm Translation (94 % Kippanteil) |
| nur Verschieben, 2,20 mm | 2,19 mm Translation, 0,02° Kippen |
| gemischt 0,15° + 1,20 mm | 0,15° + 1,17 mm (53 % Kippanteil) |

Frequenzgang, jeweils 4,00 mm Antrieb, eingeschwungen (L = 0,50 m, Q = 30,
f₀ = 0,705 Hz):

| Takt | gemessener Weg | Verstärkung | Theorie | Takttreue | Theorie |
|---|---|---|---|---|---|
| 0,560 Hz | 3,92 mm | ×1,5 | ×1,7 | 9 % | 7 % |
| 0,620 Hz | 3,91 mm | ×3,2 | ×3,4 | 16 % | 13 % |
| 0,680 Hz | 3,92 mm | ×11,9 | ×12,2 | 44 % | 42 % |
| 0,705 Hz | 3,97 mm | ×26,6\* | ×30,0 | 92 % | 100 % |
| 0,730 Hz | 3,92 mm | ×13,6 | ×13,3 | 40 % | 43 % |
| 0,790 Hz | 3,94 mm | ×5,1 | ×4,9 | 11 % | 14 % |
| 0,860 Hz | 3,94 mm | ×3,3 | ×3,0 | 4 % | 8 % |

\* Bei 4 mm im Takt läuft die Scheibe in die Randbegrenzung; mit 1,80 mm
Antrieb ergibt sich ×29,5 gegenüber ×30,0 aus der Theorie (Ausbeute 98 %).
Der gemessene Takt stimmte in allen Fällen auf 0,002 Hz.

## 3  Bedienung

1. **Sensoren freigeben** – iOS fragt einmal pro Seite nach.
2. **Kalibrieren** (2 s flach und ruhig halten). Die aktuelle Handhaltung wird
   zur Nulllage; eine leichte Dauerschräge stört also nicht.
3. Aufgabe wählen: **JA** (links–rechts), **NEIN** (vor–zurück) oder **Frei**
   (Dauermessung ohne Ziel).
4. Nach 3 s Countdown läuft der Versuch. Er endet, sobald der Ausschlag
   in der richtigen Achse die gestrichelte Zielmarke erreicht und dort
   1,5 s bleibt (Achsentreue ≥ 70 %) – oder nach Ablauf der Zeit.

Der gelbe Fadenkreuz-Marker zeigt die tatsächliche Telefonbewegung,
25-fach überhöht.

### Balken über den Kennzahlen

Der Balken unter dem Spielfeld ist die Antwort auf die Frage „wie stark war der
Ausschlag im Verhältnis zur echten Bewegung“:

```
AUSSCHLAG ÷ HANDBEWEGUNG                    ×27
[███████████████████████░░░░░░░]
0            Ausbeute 89 % · im Takt   max. ×30
```

Die Füllung ist die **Resonanzausbeute** (Verstärkung ÷ Q). Der Zusatz nennt
den Grund, wenn sie niedrig bleibt: *im Takt*, *zu schnell*, *zu langsam*.
Der Balken färbt sich gelb, sobald die Takttreue unter 75 % fällt – dann liegt
es am Rhythmus, nicht an der Bewegungsgröße.

### Kennwerte im Ergebnis

| Größe | Bedeutung |
|---|---|
| Ausschlag der Scheibe | Pendelwinkel in Grad bzw. Weg in mm |
| Bewegung des Telefons | Amplitude der reinen Verschiebung [mm] |
| Kippen des Telefons | Amplitude der Neigung [Grad] |
| entspricht … mm | Kippen umgerechnet in gleichwertigen Antriebsweg |
| Anteil Kippen | Wie viel des Antriebs aus Kippen statt Verschieben kam |
| **Ausschlag ÷ Handbewegung** | die eigentliche Verstärkung; Maximum = `Q` |
| **Resonanzausbeute** | Verstärkung ÷ Q |
| Takttreue | `\|sin ψ\|` aus der Phasenlage |
| Phasenlage | ψ in Grad, ideal 90° |
| Ihr Takt | gemessene Frequenz der Hand gegen die Pendelfrequenz |
| Achsentreue | Energieanteil in der geforderten Achse |

Alle Werte sind Mediane über die letzten 2 s vor dem Ziel – robust gegen
einzelne Ausreißer.

## 4  Einstellungen (Menü ☰)

| Parameter | Standard | Wirkung |
|---|---|---|
| Pendellänge L | 0,50 m | bestimmt Periode `T = 2π√(L/g)` = 1,42 s |
| Güte Q | 30 | maximale Verstärkung; Aufbauzeit `2Q/ω` ≈ 14 s |
| Vollausschlag | 12° | Pendelwinkel am Bildschirmrand |
| Zielmarke | 50 % | Anteil des Vollausschlags |
| Max. Dauer | 90 s | Abbruch ohne Erfolg |
| Antriebsfaktor | 1,00 | **1,00 = physikalisch exakt.** Andere Werte nur für Vorführungen; die Messwerte sind dann nicht mehr direkt vergleichbar (wird im Ergebnis vermerkt). |

Kleines Q (z. B. 8) macht das Pendel träge und verlangt viel Bewegung,
großes Q (60–80) macht selbst 0,5 mm sichtbar, braucht aber lange zum Aufbau.

## 5  Datenexport

Im Menü:

* **Versuche als CSV** – eine Zeile pro Versuch (Semikolon-getrennt),
  inklusive aller Parameter, für die Auswertung in der Arbeit.
* **Rohdaten** – Zeitreihe des letzten Versuchs mit 60 Hz:
  `t_s; a_trans_x; a_trans_y; neigung_x_grad; neigung_y_grad; antrieb_x;
  antrieb_y; scheibe_x_mm; scheibe_y_mm; amp_translation_mm;
  amp_neigung_grad; amp_antrieb_mm; amp_scheibe_mm; verstaerkung;
  resonanzausbeute; takttreue; phasenlage_grad; takt_hz`

Klappt der Download in der Home-Screen-App nicht, lässt sich der Text im
Fenster markieren und kopieren.

## 6  Installation auf dem iPhone (offline)

Bewegungssensoren geben in Safari **nur in einem sicheren Kontext** Daten aus.
Eine reine Datei-URL oder `http://` im WLAN reicht nicht – die App muss
**einmal über HTTPS** geladen werden. Danach läuft sie dank Service-Worker
vollständig offline, auch im Flugmodus.

1. Ordnerinhalt auf einen HTTPS-Webspace legen (z. B. GitHub Pages,
   Netlify, eigener Server).
2. Adresse in **Safari** öffnen (nicht Chrome – nur Safari kann zum
   Home-Bildschirm hinzufügen).
3. Teilen → **Zum Home-Bildschirm**.
4. App vom Home-Bildschirm starten, Sensorfreigabe erteilen.
5. Ab jetzt offline benutzbar. Flugmodus zum Prüfen einschalten.

Falls die Sensorabfrage nichts liefert: in *Einstellungen → Apps → Safari →
Erweitert* prüfen, ob der Zugriff auf Bewegung und Ausrichtung erlaubt ist.

### Ohne Server ausprobieren (Desktop)

```bash
python -m http.server 8137
```

Dann `http://localhost:8137/` öffnen. `localhost` gilt als sicherer Kontext.
Ohne Sensoren startet die App über den Knopf **„Ohne Sensor testen“** in einen
Zeigermodus: Ziehen mit der Maus verschiebt den Aufhängepunkt
(100 px = 5 mm) und die komplette Messkette läuft identisch weiter.

## 7  Dateien

```
index.html            Aufbau der Oberfläche
style.css             Darstellung
app.js                Physik, Sensorik, Auswertung, Export
sw.js                 Service-Worker (Offline-Cache; CACHE_VERSION erhöhen bei Änderungen!)
manifest.webmanifest  PWA-Manifest
icon-180/192/512.png  App-Icons
_make_icons.py        erzeugt die Icons neu (nur Standardbibliothek)
```

## 8  Grenzen der Messung

* Getrennt wird **Kippen** und **Verschieben** – eine Drehung um die
  Hochachse (Alpha) ist für das Pendel wirkungslos und wird ignoriert.
* Die Translationsschätzung stammt aus dem Beschleunigungssensor. Sein
  Rauschen liegt bei etwa 0,01 m/s²; bei ω ≈ 4,4 s⁻¹ entspricht das rund
  **0,5 mm Auflösung**. Werte darunter sind als „unterhalb der Messschwelle“
  zu lesen.
* Sehr langsame Änderungen der Handhaltung werden mit einer Zeitkonstante
  von 8 s als Drift abgezogen (abschaltbar).
* Die Auswertung folgt dem Takt der Hand, solange er nicht weiter als etwa
  ±0,15 Hz neben der Pendelfrequenz liegt. Weiter entfernte Bewegung treibt
  das Pendel ohnehin kaum an und wird nicht mitgezählt.
* Verstärkung, Ausbeute und Takttreue bleiben leer, solange der Antrieb unter
  0,12 mm liegt – darunter ist das Verhältnis reines Rauschen.
