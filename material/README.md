# material/

Unverlinkte Downloads, per QR-Code aus gedruckten Unterlagen erreichbar. Header `X-Robots-Tag: noindex` über `.htaccess`.

- `werkzeugkasten-staunen.pdf`: PH-Fortbildung Teil 2 „Werkzeugkasten Staunen“, Web-Fassung (ohne die ThinkFun-Drachenseiten).
  Quelle: `/home/shared/wuz/overleaf/WuZ_PH_Fortbildung_Teil2/`, gebaut mit
  `latexmk -pdf -jobname=werkzeugkasten-staunen -usepretex='\def\WEBFASSUNG{}' main.tex`.
- `3d/`: 3D-Druck-Dateien der Grundausstattung und der Ergänzungsbox (ZIP pro Teil mit SCAD/STL/3MF, dazu die beiden Set-3MFs aus `3D_Druck/Box_Sets/`) und `3d/index.html` als Download-Seite. Erzeugt mit `python3 /home/shared/wuz/bin/wuz_3d_downloads.py` aus `Wissenschaft_und_Zauberkunst/3D_Druck/`. Im Heft unter „Material und Bezugsquellen“ verlinkt.
