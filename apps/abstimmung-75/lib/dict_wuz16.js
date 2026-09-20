'use strict';

/* Eigenes kompaktes Marker-Set fuer die 7,5-cm-Karten:
   16 Bit (4x4-Raster) statt 36 Bit (6x6) -> 6x6 statt 8x8 Zellen
   inkl. Rand -> jede Zelle ist ~1/3 groesser -> deutlich mehr
   Erkennungsreichweite bei gleicher Kartengroesse.

   20 Marker (IDs 0-19), generiert mit maximiertem Mindest-Hamming-
   Abstand von 5 ueber ALLE Rotationen (auch Selbst-Rotationen, damit
   die Drehungs-Erkennung eindeutig bleibt). Bis zu 2 Bitfehler sicher
   korrigierbar (max_hamming_distance: 2 in config.json). */

AR.DICTIONARIES.WUZ_16h5_20 = {
  nBits: 16,
  tau: 5,
  codeList: [
    '0x5378', '0x3366', '0x4ff5', '0x3da1', '0xc4d6',
    '0x4dda', '0xcd41', '0x6c42', '0xbb53', '0xd1e1',
    '0x905a', '0xb802', '0xdc99', '0x1554', '0x6513',
    '0x5e3f', '0x78d7', '0xf7e8', '0x7461', '0xd51e'
  ]
};
