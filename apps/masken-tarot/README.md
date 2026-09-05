# Die Masken des Tarot

Eine Webapp für das Arbeitsmodell **Wissenschaft und Zauberkunst**.

Der Teilnehmer wählt aus den 22 Großen Arkana zwei Karten — seine liebste und
seine meistverhasste. Daraus entsteht eine kurze Lesung. Auf der letzten Seite
kann der Vorführende ablesen, was gewählt wurde.

Eine einzelne, vollständig eigenständige `index.html`. Kein Build, keine
Abhängigkeiten, kein Netzzugriff zur Laufzeit — einfach im Browser öffnen oder
über GitHub Pages ausliefern.

## Ablauf

1. **Intro** — Sprache (Deutsch / English) und Anmutung wählen
2. **Schritt 1/2** — Lieblingskarte aus den 22 Großen Arkana
3. **Schritt 2/2** — meistverhasste Karte (die Lieblingskarte ist gesperrt)
4. **Deine Maske** — die Lieblingskarte als Maske, mit Deutungstext
5. **Die Lesung** — Maske, Widerstand, Lage der beiden Karten zueinander

## Die Hiding-Places-Sequenz

Die 22 Großen Arkana bilden zwei geschlossene Elferketten:

- **Kette A:** Magier → Welt → Rad → Hierophant → Teufel → Gericht → Kraft →
  Mond → Stern → Gerechtigkeit → Kaiser → *(zurück zum Magier)*
- **Kette B:** Hohepriesterin → Herrscherin → Mäßigkeit → Liebende → Sonne →
  Wagen → Tod → Narr → Gehängter → Turm → Eremit → *(zurück zur Hohepriesterin)*

Jede Position der einen Kette hat eine feste Spiegelposition („Sprosse") in der
anderen:

```
A[i]  ↔  B[(11 − i) mod 11]
```

Also Magier↕Hohepriesterin, Welt↕Eremit, Rad↕Turm, Hierophant↕Gehängter,
Teufel↕Narr, Gericht↕Tod, Kraft↕Wagen, Mond↕Sonne, Stern↕Liebende,
Gerechtigkeit↕Mäßigkeit, Kaiser↕Herrscherin.

Die App leitet daraus die „Lage" ab: ob beide Karten in derselben Kette liegen,
wie viele Schritte sie auseinander sind, und ob sie zueinander Spiegelpaar sind.

**Zuordnung der Maske:** die Lieblingskarte *ist* die Maske, die meistverhasste
Karte ist der Widerstand. Der ↕-Spiegelpartner wird als Zusatzinformation
gezeigt, nicht als Maske.

## Ablesen (für den Vorführenden)

Zwei Wege, beide auf der Lesungs-Seite:

**Verdeckt.** Die unscheinbare Zeile

> *„Du hast 32,**1921** Sekunden für die Wahl gebraucht."*

Der ganzzahlige Teil ist die tatsächlich vergangene Zeit. Die vier
Nachkommastellen sind die Nutzlast: die ersten beiden Ziffern sind die
Lieblingskarte, die letzten beiden die gehasste Karte — nach der Nummerierung
01–11 (Kette A) und 12–22 (Kette B). Im Beispiel also 19 = Der Narr,
21 = Der Turm.

**Im Klartext.** Ein **Dreifach-Klick auf die Überschrift „DIE LESUNG"** blendet
einen Schlüssel ein: beide gewählten Karten ausgeschrieben, die vollständige
Nummerierung beider Ketten und ein Sprossen-Diagramm, in dem die Maske
durchgezogen und die abgelehnte Karte gestrichelt umrandet ist. Ein erneuter
Dreifach-Klick blendet ihn wieder aus.

## Lokal ausprobieren

```bash
python -m http.server 8731 --directory Kartenwahl
```

Dann http://127.0.0.1:8731/ öffnen. Ein Dateiaufruf per `file://` funktioniert
ebenfalls.

## Herkunft

Die Hiding-Places-Sequenz stammt aus **„Bauta — Betraying the Face of Illusion"**
bzw. **„The Masks of Tarot"** von Scott Grossberg (© 2008–2011). Diese App ist
eine eigene Umsetzung der Struktur für den Einsatz im Arbeitsmodell Wissenschaft
und Zauberkunst; die Rechte am zugrundeliegenden System liegen beim Autor.
