#!/usr/bin/env python3
"""Erzeugt icon-180/192/512.png: dunkles Feld, drei goldene konzentrische Kreise mit Kernpunkt.
Aufruf: python3 _make_icons.py
"""
from PIL import Image, ImageDraw

BG = (11, 20, 36, 255)
GOLD = (232, 183, 58, 255)
CORE = (143, 211, 192, 255)


def make(size):
    scale = 4  # Supersampling für glatte Kreise
    s = size * scale
    img = Image.new('RGBA', (s, s), BG)
    d = ImageDraw.Draw(img)
    c = s / 2
    w = max(2, int(s * 0.03))
    for r in (0.36, 0.24, 0.12):
        R = s * r
        d.ellipse([c - R, c - R, c + R, c + R], outline=GOLD, width=w)
    R = s * 0.045
    d.ellipse([c - R, c - R, c + R, c + R], fill=CORE)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    for n in (512, 192, 180):
        make(n).save(f'icon-{n}.png')
    print('Icons erzeugt: icon-512.png, icon-192.png, icon-180.png')
