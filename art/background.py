#!/usr/bin/env python3
"""Arcade layout background: an original 8-bit night scene.

Run:  python3 art/background.py
It designs the picture on a 480x270 pixel grid and then runs exactly:

    rsvg-convert -w 480 -h 270 art/arcade-bg.svg -o <tmp>/bg-480.png
    magick <tmp>/bg-480.png -filter point -resize 400% -colors 16 -strip \
        -define png:exclude-chunks=date,time PNG8:mods/arcade/arcade-bg.png

art/arcade-bg.svg is the 480x270 source (one crispEdges rect per colour run);
mods/arcade/arcade-bg.png is the 1920x1080 result (every grid pixel = 4x4 px,
nearest-neighbour, palette PNG). Deterministic: a fixed random seed.

Composition (grid rows; x4 for screen px):
  rows 0-21    night sky, stepped bands toward the horizon, stars and twinkles,
               the striped sun (centre x 325, top row 2) and a city skyline
  row  22      magenta horizon line
  rows 23-49   haze: solid deep fading out in stepped stripes
  rows 50-269  perspective grid floor; lines are faint (#1a0b3d on #0d0221)
               down to row 219 so text over the panels stays readable, then
               brighten in steps toward the bottom (purple, violet, magenta)
"""
import random
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SVG = ROOT / "art" / "arcade-bg.svg"
PNG = ROOT / "mods" / "arcade" / "arcade-bg.png"

W, H = 480, 270
HORIZON = 22
NIGHT, DEEP, PURPLE, VIOLET = "#0d0221", "#1a0b3d", "#3b1a78", "#7b2cbf"
MAGENTA, PINK, ORANGE, YELLOW = "#ff2a6d", "#ff6ec7", "#ff8c42", "#ffd319"
CYAN, LIME, WHITE = "#05d9e8", "#9cff57", "#f6f1ff"

rng = random.Random(1982)
px = [[NIGHT] * W for _ in range(H)]


def put(x, y, c):
    if 0 <= x < W and 0 <= y < H:
        px[y][x] = c


# --- sky: night on top, stepped bands toward the horizon -----------------------
SKY = {10: DEEP, 12: DEEP, 13: PURPLE, 14: DEEP, 15: PURPLE,
       16: PURPLE, 17: VIOLET, 18: PURPLE, 19: VIOLET, 20: VIOLET, 21: VIOLET}
for y, c in SKY.items():
    for x in range(W):
        px[y][x] = c

# --- stars (only in the dark part of the sky) ------------------------------------
SUN_X, SUN_Y, SUN_R = 325, 30, 28


def near_sun(x, y, pad=4):
    return (x + 0.5 - SUN_X) ** 2 + (y + 0.5 - SUN_Y) ** 2 < (SUN_R + pad) ** 2


stars = []
while len(stars) < 70:
    x, y = rng.randrange(3, W - 3), rng.randrange(1, 12)
    if near_sun(x, y, 6) or any(abs(x - a) < 5 and abs(y - b) < 3 for a, b, _ in stars):
        continue
    stars.append((x, y, rng.random()))
for x, y, r in stars:
    if r < 0.45:
        put(x, y, PURPLE if y < 9 else VIOLET)       # faint
    elif r < 0.8:
        put(x, y, WHITE)
    elif r < 0.9:
        put(x, y, CYAN)
    else:
        put(x, y, PINK)

# 4-point twinkles: white core, coloured arms
for x, y, arm in [(28, 5, CYAN), (118, 3, PINK), (214, 7, CYAN), (262, 2, WHITE),
                  (402, 4, PINK), (452, 9, CYAN), (166, 11, VIOLET)]:
    put(x, y, WHITE)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        put(x + dx, y + dy, arm)
    for dx, dy in ((2, 0), (-2, 0), (0, 2), (0, -2)):
        put(x + dx, y + dy, VIOLET if arm != VIOLET else PURPLE)

# --- the sun: yellow / orange / magenta bands, gaps cut through the lower half ---
SUN_BAND = [(9, YELLOW), (14, ORANGE), (HORIZON, MAGENTA)]   # (last row, colour)
SUN_GAPS = {11, 14, 17, 19, 20}
for y in range(0, HORIZON):
    if y in SUN_GAPS:
        continue
    c = next(col for last, col in SUN_BAND if y <= last)
    for x in range(W):
        if (x + 0.5 - SUN_X) ** 2 + (y + 0.5 - SUN_Y) ** 2 <= SUN_R ** 2:
            px[y][x] = c

# --- city skyline (deep purple) with lit windows --------------------------------
buildings = []          # (x0, width, top_row)
# clusters (x from, x to, highest top row, lowest top row); open sky between them
CLUSTERS = [(2, 128, 7, 15), (150, 262, 9, 17), (276, 300, 15, 18),
            (352, 372, 15, 18), (384, 478, 7, 15)]
for a, b, hi, lo in CLUSTERS:
    x = a
    while x < b:
        w = min(rng.randrange(5, 13), b - x)
        if w >= 3:
            buildings.append((x, w, rng.randrange(hi, lo + 1)))
        x += w + rng.choice((0, 0, 1, 2))
# a few landmark towers
buildings += [(54, 6, 4), (196, 5, 5), (418, 6, 3)]

for x0, w, top in buildings:
    for y in range(top, HORIZON):
        for x in range(x0, min(x0 + w, W)):
            px[y][x] = DEEP
    # stepped crown on wide blocks
    if w >= 9 and top > 6:
        for x in range(x0 + 2, x0 + w - 2):
            put(x, top - 1, DEEP)
for x0, w, top in buildings:
    # antenna with a red light on tall ones
    if top <= 8:
        ax = x0 + w // 2
        for y in range(top - 3, top):
            put(ax, y, DEEP)
        put(ax, top - 4, MAGENTA)
    # windows: 1x1 lights on a 2x2 lattice
    for y in range(top + 1, HORIZON - 1, 2):
        for x in range(x0 + 1, x0 + w - 1, 2):
            if rng.random() < 0.16:
                put(x, y, rng.choice((YELLOW, YELLOW, YELLOW, PINK, CYAN, ORANGE)))

# --- horizon line ----------------------------------------------------------------
for x in range(W):
    px[HORIZON][x] = MAGENTA


# --- perspective grid floor ------------------------------------------------------
FOG = 50                # rows above this are flat haze; grid lines start here


def line_colour(y):
    if y < 220:
        return DEEP            # calm middle: barely visible
    if y < 245:
        return PURPLE
    if y < 257:
        return VIOLET
    return MAGENTA             # bottom band (status bar)


# haze under the horizon: solid deep, then thinning stepped stripes
HAZE = set(range(HORIZON + 1, 34)) | {35, 37, 39, 42, 45, 49}
for y in range(HORIZON + 1, H):
    for x in range(W):
        px[y][x] = DEEP if y in HAZE else NIGHT
for x in range(W):
    px[HORIZON + 1][x] = PURPLE

DEPTH = H - HORIZON
VX, SPACING = SUN_X, 40         # vanishing point under the sun; spacing at the bottom row
for i in range(-120, 121):
    prev = None
    # level of detail: far from the viewer only every 2nd / 4th line is drawn
    start = FOG if i % 4 == 0 else FOG + 14 if i % 2 == 0 else FOG + 40
    for y in range(start, H):
        x = round(VX + i * SPACING * (y - HORIZON) / DEPTH)
        c = line_colour(y)
        if prev is None or x == prev:
            span = (x,)
        elif x > prev:
            span = range(prev + 1, x + 1)      # keep the staircase connected
        else:
            span = range(x, prev)
        for xx in span:
            put(xx, y, c)
        prev = x

z, last = 1.03, H
while True:
    y = round(HORIZON + DEPTH / z)
    if y < FOG or last - y < 4:
        break
    for x in range(W):
        px[y][x] = line_colour(y)
    last = y
    z += 0.2


# --- write SVG (colour runs) and rasterize ---------------------------------------
def write_svg():
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
             f'viewBox="0 0 {W} {H}" shape-rendering="crispEdges">',
             f'<rect width="{W}" height="{H}" fill="{NIGHT}"/>']
    by_colour = {}
    for y in range(H):
        x = 0
        while x < W:
            c = px[y][x]
            s = x
            while x < W and px[y][x] == c:
                x += 1
            if c != NIGHT:
                by_colour.setdefault(c, []).append(f"M{s} {y}h{x - s}v1h-{x - s}z")
    for c, d in by_colour.items():
        parts.append(f'<path fill="{c}" d="{"".join(d)}"/>')
    parts.append("</svg>\n")
    SVG.write_text("".join(parts))


def main():
    write_svg()
    with tempfile.TemporaryDirectory() as tmp:
        small = Path(tmp) / "bg-480.png"
        subprocess.run(["rsvg-convert", "-w", str(W), "-h", str(H), str(SVG), "-o", str(small)], check=True)
        subprocess.run(["magick", str(small), "-filter", "point", "-resize", "400%",
                        "-colors", "16", "-strip", "-define", "png:exclude-chunks=date,time", f"PNG8:{PNG}"], check=True)
    print(f"wrote {SVG} and {PNG}")


if __name__ == "__main__":
    main()
