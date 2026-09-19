#!/usr/bin/env python3
"""
make_lovecraft_textures.py -- procedural seamless textures for the
Laissez un Faire "Victorian occult / Lovecraftian" script theme (see
src/app.css's [data-script-theme='lovecraft'] block and
src/lib/scriptTheme.ts). Same generation approach as make_textures.py /
make_steampunk_textures.py (tileable value noise, no external images or
licences), new palette and motifs: embossed leather book-binding and a
damask wallpaper stamped with a faint warding sigil, instead of
masonry/parchment or brass/gearwork.

Usage: python3 make_lovecraft_textures.py [outdir]
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else "textures_out"

# ---- palette (day -- "a study by daylight, heavy curtains") ----
LEATHER_BG = (90, 46, 40)        # --surface (book-cover leather)
LEATHER_DIM = (62, 30, 27)       # shadow within the leather grain
LEATHER_HI = (130, 74, 58)       # worn/rubbed highlight
INK = (26, 18, 16)               # tooled-line ink
WARD_BRASS = (150, 118, 68)      # small tarnished-brass sigil accent
DAMASK_BG = (58, 30, 28)         # --bg (wallpaper ground)
DAMASK_FIG = (78, 42, 38)        # damask figure, barely lighter than ground

# ---- palette (night -- candlelit / gaslit ritual room) ----
N_LEATHER_BG = (34, 16, 15)
N_LEATHER_DIM = (18, 8, 8)
N_LEATHER_HI = (70, 36, 30)
N_INK = (10, 6, 6)
N_WARD_BRASS = (168, 132, 76)
N_DAMASK_BG = (16, 10, 12)
N_DAMASK_FIG = (28, 16, 17)
ELDRITCH_GLOW = (108, 168, 132)  # faint sick-green -- used very sparingly


def tileable_noise(size, cells, octaves=4, seed=0, persistence=0.55):
    rng = np.random.default_rng(seed)
    total = np.zeros((size, size), dtype=np.float32)
    amp, amp_sum = 1.0, 0.0
    for o in range(octaves):
        c = max(2, cells * (2 ** o))
        grid = rng.uniform(0.0, 1.0, (c, c)).astype(np.float32)
        pad = 2
        padded = np.pad(grid, pad, mode="wrap")
        im = Image.fromarray((padded * 255).astype(np.uint8), mode="L")
        scale = size / c
        new_dim = max(1, int(round(padded.shape[0] * scale)))
        im_r = im.resize((new_dim, new_dim), Image.BICUBIC)
        arr = np.asarray(im_r, dtype=np.float32) / 255.0
        margin = int(round(pad * scale))
        arr = arr[margin:margin + size, margin:margin + size]
        if arr.shape != (size, size):
            arr = np.asarray(
                Image.fromarray((arr * 255).astype(np.uint8)).resize((size, size), Image.BICUBIC),
                dtype=np.float32,
            ) / 255.0
        total += arr * amp
        amp_sum += amp
        amp *= persistence
    total /= amp_sum
    return total


def anisotropic_noise(size, cells_x, cells_y, octaves=3, seed=0, persistence=0.55):
    rng = np.random.default_rng(seed)
    total = np.zeros((size, size), dtype=np.float32)
    amp, amp_sum = 1.0, 0.0
    for o in range(octaves):
        cx = max(2, cells_x * (2 ** o))
        cy = max(2, cells_y * (2 ** o))
        grid = rng.uniform(0.0, 1.0, (cy, cx)).astype(np.float32)
        pad = 2
        padded = np.pad(grid, pad, mode="wrap")
        im = Image.fromarray((padded * 255).astype(np.uint8), mode="L")
        im_r = im.resize((size + 2 * int(pad * size / cx), size + 2 * int(pad * size / cy)), Image.BICUBIC)
        arr = np.asarray(im_r, dtype=np.float32) / 255.0
        my = int(pad * size / cy)
        mx = int(pad * size / cx)
        arr = arr[my:my + size, mx:mx + size]
        if arr.shape != (size, size):
            arr = np.asarray(
                Image.fromarray((arr * 255).astype(np.uint8)).resize((size, size), Image.BICUBIC),
                dtype=np.float32,
            ) / 255.0
        total += arr * amp
        amp_sum += amp
        amp *= persistence
    total /= amp_sum
    return total


def lerp_color(c1, c2, t):
    c1 = np.array(c1, dtype=np.float32)
    c2 = np.array(c2, dtype=np.float32)
    return c1[None, None, :] * (1 - t[..., None]) + c2[None, None, :] * t[..., None]


def save(name, arr):
    import os
    os.makedirs(OUT, exist_ok=True)
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGB").save(
        f"{OUT}/{name}", quality=84, optimize=True
    )
    print("saved", name)


def old_leather(size=640, seed=61, night=False):
    """Card-panel texture: embossed leather book-cover grain with a thin
    tooled-line rectangle border a little way in from the edge (a classic
    Victorian binding detail) -- the lovecraft analogue of parchment.jpg /
    riveted-brass.jpg."""
    bg, dim, hi, ink = (
        (N_LEATHER_BG, N_LEATHER_DIM, N_LEATHER_HI, N_INK)
        if night
        else (LEATHER_BG, LEATHER_DIM, LEATHER_HI, INK)
    )
    # fine leather "pebble" grain -- small isotropic cells, several octaves
    grain = tileable_noise(size, 22, octaves=4, seed=seed, persistence=0.5)
    grain = (grain - grain.min()) / (grain.max() - grain.min())
    base = lerp_color(dim, bg, np.clip(grain * 0.8 + 0.15, 0, 1))
    # broader mottling / worn patches
    mottle = tileable_noise(size, 5, octaves=3, seed=seed + 1, persistence=0.55)
    mottle = (mottle - mottle.min()) / (mottle.max() - mottle.min())
    base = base * (1 - 0.3 * mottle[..., None]) + np.array(hi) * (0.3 * mottle[..., None])

    # tooled double-line border, inset from the edge, wrapping seamlessly
    border = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(border)
    m1, m2 = size // 14, size // 14 + max(2, size // 90)
    for m in (m1, m2):
        d.rectangle([m, m, size - 1 - m, size - 1 - m], outline=255, width=max(1, size // 400))
    border_arr = np.asarray(border, dtype=np.float32) / 255.0
    border_arr = np.asarray(
        Image.fromarray((border_arr * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)),
        dtype=np.float32,
    ) / 255.0
    base = base * (1 - 0.85 * border_arr[..., None]) + np.array(ink) * (0.85 * border_arr[..., None])

    save(f"old-leather{'-night' if night else ''}.jpg", base)


def _sigil_mask(size, tile):
    """One tileable warding sigil (a seven-point asterisk inside a thin
    circle, an original abstract mark -- not a reproduction of any
    specific published symbol) stamped on a periodic grid so it tiles
    exactly, same trick as gear_plate()'s medallions."""
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    centres = [0, tile, 2 * tile, size]
    r_outer = tile * 0.30
    r_inner = tile * 0.03
    for cy in centres:
        for cx in centres:
            d.ellipse(
                [cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer],
                outline=255,
                width=max(1, size // 500),
            )
            for k in range(7):
                a = (2 * np.pi / 7) * k - np.pi / 2
                x2 = cx + np.cos(a) * r_outer * 0.92
                y2 = cy + np.sin(a) * r_outer * 0.92
                d.line([cx, cy, x2, y2], fill=255, width=max(1, size // 640))
            d.ellipse(
                [cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner],
                fill=255,
            )
    mask = mask.filter(ImageFilter.GaussianBlur(0.7))
    return np.asarray(mask, dtype=np.float32) / 255.0


def warded_damask(size=768, seed=71, night=False):
    """Page-background texture: dark damask wallpaper ground with a very
    faint, barely-there repeating warding sigil worked into the weave --
    the lovecraft analogue of limestone.jpg / gear-plate.jpg. Kept
    low-contrast on purpose so it reads as "old wallpaper", not a poster."""
    bg, fig = (N_DAMASK_BG, N_DAMASK_FIG) if night else (DAMASK_BG, DAMASK_FIG)
    n = tileable_noise(size, 6, octaves=5, seed=seed, persistence=0.5)
    n = (n - n.min()) / (n.max() - n.min())
    base = lerp_color(bg, fig, n * 0.35 + 0.05)
    weave = anisotropic_noise(size, cells_x=50, cells_y=6, octaves=2, seed=seed + 1, persistence=0.5)
    base = base * (0.94 + 0.06 * weave[..., None])

    tile = size // 3
    sigil = _sigil_mask(size, tile)
    glow = ELDRITCH_GLOW if night else tuple(int(c * 0.55) for c in ELDRITCH_GLOW)
    sigil_opacity = 0.16 if night else 0.10
    base = base * (1 - sigil_opacity * sigil[..., None]) + np.array(glow) * (sigil_opacity * sigil[..., None])

    save(f"warded-damask{'-night' if night else ''}.jpg", base)


if __name__ == "__main__":
    old_leather(night=False)
    old_leather(night=True)
    warded_damask(night=False)
    warded_damask(night=True)
