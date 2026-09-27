#!/usr/bin/env python3
"""Erzeugt icon-180/192/512.png: dunkles Feld, goldene Fuenferwuerfel-Punkte.
Aufruf: python3 _make_icons.py
"""
from PIL import Image, ImageDraw

BG = (11, 15, 20, 255)
GOLD = (232, 183, 58, 255)


def make(size):
    img = Image.new('RGBA', (size, size), BG)
    d = ImageDraw.Draw(img)

    corner = int(size * 0.22)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=corner, fill=BG)

    r = size * 0.085
    positions = [
        (0.27, 0.27), (0.73, 0.27),
        (0.5, 0.5),
        (0.27, 0.73), (0.73, 0.73),
    ]
    for px, py in positions:
        cx, cy = px * size, py * size
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GOLD)

    return img


if __name__ == '__main__':
    for s in (512, 192, 180):
        make(s).save(f'icon-{s}.png')
    print('Icons erzeugt: icon-512.png, icon-192.png, icon-180.png')
