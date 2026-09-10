#!/usr/bin/env python3
"""
make_textures.py — procedurally generate the seamless/tileable background
textures the app's CSS already knows how to use (src/app.css: --stone-tex,
--parchment-tex, --wood-tex, and a bonus --redstone-tex), so there's no need
to source or hand-paint real photos. Every texture is built from the app's
own palette (app.css :root tokens), so they match the theme by construction
rather than by luck.

Tiling trick: generate low-res value noise, pad it by wrapping (mode='wrap'),
resize up with PIL, then crop the wrap margin back off. Because the padding
wraps, the crop's own edges line up with each other when the result is
tiled — no visible seam, no FFT/Perlin library needed.

Usage: python3 make_textures.py [outdir]
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else "textures_out"

# ---- app.css palette (:root, light/day theme — the default) ----
BG = (236, 226, 204)          # --bg
SURFACE = (248, 241, 224)     # --surface
SURFACE2 = (231, 217, 186)    # --surface-2
BORDER = (205, 185, 142)      # --border
ACCENT = (151, 103, 28)       # --accent
LEAD = (74, 61, 41)           # --lead
REDSTONE = (163, 68, 51)      # --redstone
REDSTONE_DIM = (201, 138, 120)  # --redstone-dim


def tileable_noise(size, cells, octaves=4, seed=0, persistence=0.55):
    """Value noise in 0..1, seamless when tiled at `size`."""
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
    return total  # 0..1


def anisotropic_noise(size, cells_x, cells_y, octaves=3, seed=0, persistence=0.55):
    """Same idea as tileable_noise but with independent x/y cell counts —
    stretched cells read as directional grain (wood) rather than blobs."""
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
    """t: HxW float array 0..1 -> HxWx3 uint8, blending two RGB tuples."""
    c1 = np.array(c1, dtype=np.float32)
    c2 = np.array(c2, dtype=np.float32)
    out = c1[None, None, :] * (1 - t[..., None]) + c2[None, None, :] * t[..., None]
    return out


def save(name, arr):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGB").save(
        f"{OUT}/{name}", quality=84, optimize=True
    )
    print("saved", name)


def limestone(size=768, seed=1):
    """Pale coursed-masonry limestone wall — mottled stone blocks with
    faint mortar joints, matching the page-background palette."""
    n = tileable_noise(size, 6, octaves=5, seed=seed, persistence=0.5)
    n = (n - n.min()) / (n.max() - n.min())
    base = lerp_color(BG, SURFACE, n * 0.7 + 0.15)
    fine = tileable_noise(size, 40, octaves=2, seed=seed + 1, persistence=0.5)
    base = base * (0.92 + 0.08 * fine[..., None])

    # coursed masonry joints: a brick-bond grid of faint darker lines
    mortar = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mortar)
    course_h = size // 6
    block_w = size // 4
    for row, y in enumerate(range(0, size + course_h, course_h)):
        d.line([(0, y), (size, y)], fill=140, width=2)
        offset = (block_w // 2) if row % 2 else 0
        for x in range(-offset, size + block_w, block_w):
            d.line([(x, max(0, y - course_h)), (x, y)], fill=110, width=2)
    mortar = mortar.filter(ImageFilter.GaussianBlur(1.2))
    mortar_arr = np.asarray(mortar, dtype=np.float32) / 255.0
    base = base * (1 - 0.16 * mortar_arr[..., None])

    # occasional weathering blotches
    blotch = tileable_noise(size, 5, octaves=3, seed=seed + 2, persistence=0.6)
    blotch = np.clip((blotch - 0.62) * 3.0, 0, 1)
    base = base * (1 - 0.12 * blotch[..., None]) + np.array(BORDER) * (0.12 * blotch[..., None])

    save("limestone.jpg", base)


def redstone(size=768, seed=11):
    """Warm red sandstone accent texture — for a header band, a card top
    rule, or anywhere the app's decorative --redstone tones could use real
    grain instead of a flat colour."""
    n = tileable_noise(size, 5, octaves=5, seed=seed, persistence=0.52)
    n = (n - n.min()) / (n.max() - n.min())
    base = lerp_color(REDSTONE, REDSTONE_DIM, n * 0.6 + 0.1)
    fine = tileable_noise(size, 60, octaves=2, seed=seed + 1, persistence=0.5)
    base = base * (0.9 + 0.1 * fine[..., None])
    # subtle horizontal sedimentary banding, real sandstone's signature look
    band = np.linspace(0, 1, size, dtype=np.float32)
    band = 0.5 + 0.5 * np.sin(band * np.pi * 10 + tileable_noise(size, 4, octaves=2, seed=seed + 2)[:, 0] * 3)
    band_img = np.tile(band[:, None], (1, size))
    base = base * (0.94 + 0.06 * band_img[..., None])
    save("redstone.jpg", base)


def parchment(size=640, seed=21):
    """Vellum/aged-paper card background — kept LOW contrast since real
    UI text sits on top of it."""
    n = tileable_noise(size, 8, octaves=5, seed=seed, persistence=0.5)
    n = (n - n.min()) / (n.max() - n.min())
    base = lerp_color(SURFACE, SURFACE2, n * 0.35)
    grain = tileable_noise(size, 90, octaves=2, seed=seed + 1, persistence=0.5)
    base = base * (0.96 + 0.04 * grain[..., None])
    # faint warm foxing blotches, very subtle
    blotch = tileable_noise(size, 4, octaves=3, seed=seed + 2, persistence=0.6)
    blotch = np.clip((blotch - 0.68) * 4.0, 0, 1)
    base = base * (1 - 0.06 * blotch[..., None]) + np.array(BORDER) * (0.06 * blotch[..., None])
    save("parchment.jpg", base)


def oak(size=640, seed=31):
    """Streaky oak plank grain — reserved for a header/footer wood band."""
    n = anisotropic_noise(size, cells_x=2, cells_y=18, octaves=4, seed=seed, persistence=0.55)
    n = (n - n.min()) / (n.max() - n.min())
    base = lerp_color(LEAD, ACCENT, np.clip(n * 0.85, 0, 1))
    fine = anisotropic_noise(size, cells_x=3, cells_y=50, octaves=2, seed=seed + 1, persistence=0.5)
    base = base * (0.85 + 0.15 * fine[..., None])
    # plank seams every ~1/3 width
    seam = np.zeros((size, size), dtype=np.float32)
    for x in (size // 3, 2 * size // 3):
        seam[:, max(0, x - 1):x + 1] = 1.0
    seam_img = Image.fromarray((seam * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))
    seam = np.asarray(seam_img, dtype=np.float32) / 255.0
    base = base * (1 - 0.35 * seam[..., None])
    save("oak.jpg", base)


if __name__ == "__main__":
    import os
    os.makedirs(OUT, exist_ok=True)
    limestone()
    redstone()
    parchment()
    oak()
