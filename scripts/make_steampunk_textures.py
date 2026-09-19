#!/usr/bin/env python3
"""
make_steampunk_textures.py -- procedural seamless textures for the
Laissez un Faire "steampunk workshop" script theme (see src/app.css's
[data-script-theme='steampunk'] block and src/lib/scriptTheme.ts, which
switches to these the same way the existing night-vigil toggle switches
--stone-tex/--parchment-tex). Same generation approach as
make_textures.py (tileable value noise, no external images/licences), just
a different palette and different motifs -- riveted brass panelling and
an etched gear-plate -- instead of masonry/parchment.

Usage: python3 make_steampunk_textures.py [outdir]
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else "textures_out"

# ---- steampunk palette (day) -- see app.css [data-script-theme='steampunk'] ----
BRASS_BG = (168, 138, 84)       # --bg
BRASS_SURFACE = (214, 186, 128)  # --surface
BRASS_SURFACE2 = (150, 118, 62)  # --surface-2
BRASS_BORDER = (108, 82, 40)     # --border
COPPER = (168, 90, 42)           # --accent
RIVET = (74, 66, 50)             # dark steel rivet body
VERDIGRIS = (94, 130, 106)       # aged-copper patina streaks

# ---- steampunk palette (night -- gaslit workshop) ----
N_BG = (26, 22, 16)
N_SURFACE = (38, 32, 22)
N_SURFACE2 = (50, 41, 27)
N_BORDER = (70, 56, 34)
N_COPPER = (214, 140, 74)
N_RIVET = (18, 16, 12)


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
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGB").save(
        f"{OUT}/{name}", quality=84, optimize=True
    )
    print("saved", name)


def _rivet_grid_mask(size, spacing, radius, jitter_seed):
    """Perfectly tileable ring of raised rivets on an even grid -- a
    regular lattice tiles exactly by construction, no wrap-noise needed.
    Returns two 0..1 float masks: (disc, ring-highlight)."""
    disc = Image.new("L", (size, size), 0)
    d = disc.load()
    highlight = Image.new("L", (size, size), 0)
    h = highlight.load()
    draw_d = ImageDraw.Draw(disc)
    draw_h = ImageDraw.Draw(highlight)
    rng = np.random.default_rng(jitter_seed)
    for cy in range(-spacing, size + spacing, spacing):
        for cx in range(-spacing, size + spacing, spacing):
            jx = int(rng.uniform(-2, 2))
            jy = int(rng.uniform(-2, 2))
            x, y = cx + jx, cy + jy
            draw_d.ellipse([x - radius, y - radius, x + radius, y + radius], fill=255)
            draw_h.ellipse(
                [x - radius * 0.45, y - radius * 0.9, x + radius * 0.45, y - radius * 0.15],
                fill=255,
            )
    disc = disc.filter(ImageFilter.GaussianBlur(1.1))
    highlight = highlight.filter(ImageFilter.GaussianBlur(1.6))
    return (
        np.asarray(disc, dtype=np.float32) / 255.0,
        np.asarray(highlight, dtype=np.float32) / 255.0,
    )


def riveted_brass(size=640, seed=41, night=False):
    """Card-panel texture: brushed brass sheet with a border-following
    rivet lattice and faint verdigris streaking -- the steampunk analogue
    of parchment.jpg."""
    bg, s2, border, patina = (
        (N_SURFACE, N_SURFACE2, N_BORDER, VERDIGRIS) if night else (BRASS_SURFACE, BRASS_SURFACE2, BRASS_BORDER, VERDIGRIS)
    )
    grain = anisotropic_noise(size, cells_x=3, cells_y=60, octaves=3, seed=seed, persistence=0.55)
    grain = (grain - grain.min()) / (grain.max() - grain.min())
    base = lerp_color(s2, bg, grain * 0.55 + 0.25)

    disc, hl = _rivet_grid_mask(size, spacing=size // 8, radius=max(3, size // 90), jitter_seed=seed + 1)
    rivet_col = N_RIVET if night else RIVET
    base = base * (1 - 0.55 * disc[..., None]) + np.array(rivet_col) * (0.55 * disc[..., None])
    base = base + np.array((255, 240, 210)) * (0.35 * hl[..., None] * disc[..., None])

    streak = tileable_noise(size, 4, octaves=3, seed=seed + 2, persistence=0.6)
    streak = np.clip((streak - 0.66) * 3.2, 0, 1)
    base = base * (1 - 0.18 * streak[..., None]) + np.array(patina) * (0.18 * streak[..., None])

    save(f"riveted-brass{'-night' if night else ''}.jpg", base)


def gear_plate(size=768, seed=51, night=False):
    """Page-background texture: an oxidised copper/gunmetal plate stamped
    with a repeating grid of engraved gear medallions -- the steampunk
    analogue of limestone.jpg. Medallions sit on a periodic tile grid
    (centres at 0/tile/2*tile/size on each axis) so a ring split by the
    canvas edge is reconstructed by its mirror at the wrapped edge --
    same trick as limestone()'s mortar coursing, just circular."""
    bg, s2, border = (N_BG, N_SURFACE, N_BORDER) if night else (BRASS_BG, BRASS_SURFACE2, BRASS_BORDER)
    n = tileable_noise(size, 6, octaves=5, seed=seed, persistence=0.5)
    n = (n - n.min()) / (n.max() - n.min())
    base = lerp_color(bg, s2, n * 0.55 + 0.1)
    fine = anisotropic_noise(size, cells_x=40, cells_y=5, octaves=2, seed=seed + 1, persistence=0.5)
    base = base * (0.95 + 0.05 * fine[..., None])

    rings = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(rings)
    tile = size // 3
    centres_x = [0, tile, 2 * tile, size]
    centres_y = [0, tile, 2 * tile, size]
    teeth = 16
    for cy in centres_y:
        for cx in centres_x:
            rmax = int(tile * 0.42)
            for ring_i, r in enumerate(range(int(tile * 0.16), rmax, int(tile * 0.13))):
                width = 3 if ring_i % 2 == 0 else 2
                fill = 150 if ring_i % 2 == 0 else 100
                for t in range(teeth):
                    a0 = 360 * t / teeth
                    a1 = a0 + 360 / teeth * 0.55
                    d.arc([cx - r, cy - r, cx + r, cy + r], a0, a1, fill=fill, width=width)
            # small centre hub bolt
            d.ellipse(
                [cx - tile * 0.05, cy - tile * 0.05, cx + tile * 0.05, cy + tile * 0.05],
                outline=140,
                width=2,
            )
    rings = rings.filter(ImageFilter.GaussianBlur(0.6))
    rings_arr = np.asarray(rings, dtype=np.float32) / 255.0
    base = base * (1 - 0.26 * rings_arr[..., None]) + np.array(border) * (0.26 * rings_arr[..., None])

    blotch = tileable_noise(size, 5, octaves=3, seed=seed + 3, persistence=0.6)
    blotch = np.clip((blotch - 0.66) * 3.0, 0, 1)
    patina = VERDIGRIS
    base = base * (1 - 0.13 * blotch[..., None]) + np.array(patina) * (0.13 * blotch[..., None])

    save(f"gear-plate{'-night' if night else ''}.jpg", base)


if __name__ == "__main__":
    import os
    os.makedirs(OUT, exist_ok=True)
    riveted_brass(night=False)
    riveted_brass(night=True)
    gear_plate(night=False)
    gear_plate(night=True)
