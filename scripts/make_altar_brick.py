#!/usr/bin/env python3
"""
make_altar_brick.py -- the "relevant brick texture" for the window-wide
altar strip in Avatar.svelte (a short trapezoid the candle/skull overlay
now stands on, per Mickey: "on a window-wide but short alter, just a thin
trapezoid with the relevant brick texture"). Four variants, one per
script-theme x day/night combination, same tiling trick as make_textures.py
(pad value noise, wrap, resize, crop) plus an actual fine brick-bond
coursing grid (mortar joints), since the strip is short enough that real
brick units should read at that scale rather than just a mottled colour.

Usage: python3 scripts/make_altar_brick.py [outdir]
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else "altar_brick_out"


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


def lerp_color(c1, c2, t):
    c1 = np.array(c1, dtype=np.float32)
    c2 = np.array(c2, dtype=np.float32)
    return c1[None, None, :] * (1 - t[..., None]) + c2[None, None, :] * t[..., None]


def save(name, arr):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGB").save(
        f"{OUT}/{name}", quality=86, optimize=True
    )
    print("saved", name)


def brick(name, size, seed, base, dim, mortar, mortar_strength=0.55, blotch_color=None,
          blotch_strength=0.16, mirror=False):
    n = tileable_noise(size, 6, octaves=5, seed=seed, persistence=0.5)
    n = (n - n.min()) / (n.max() - n.min())
    out = lerp_color(base, dim, n * 0.65 + 0.1)
    fine = tileable_noise(size, 70, octaves=2, seed=seed + 1, persistence=0.5)
    out = out * (0.9 + 0.1 * fine[..., None])

    # fine brick-bond coursing -- smaller courses than limestone.jpg's,
    # since this strip is short and needs real brick units to read at
    # that scale, not just mottled colour.
    mortar_mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mortar_mask)
    course_h = size // 9
    block_w = size // 5
    for row, y in enumerate(range(0, size + course_h, course_h)):
        d.line([(0, y), (size, y)], fill=200, width=3)
        offset = (block_w // 2) if row % 2 else 0
        for x in range(-offset, size + block_w, block_w):
            d.line([(x, max(0, y - course_h)), (x, y)], fill=170, width=3)
    mortar_mask = mortar_mask.filter(ImageFilter.GaussianBlur(0.8))
    mortar_arr = np.asarray(mortar_mask, dtype=np.float32) / 255.0
    out = out * (1 - mortar_strength * mortar_arr[..., None]) + np.array(mortar) * (mortar_strength * mortar_arr[..., None])

    if blotch_color is not None:
        blotch = tileable_noise(size, 5, octaves=3, seed=seed + 2, persistence=0.6)
        blotch = np.clip((blotch - 0.62) * 3.0, 0, 1)
        out = out * (1 - blotch_strength * blotch[..., None]) + np.array(blotch_color) * (blotch_strength * blotch[..., None])

    if mirror:
        # Mickey: "the brick texture should mirror the script theme" --
        # Laissez un Faire's brick isn't just recoloured, its coursing is
        # flipped left-right from Trouble Brewing's, so the two altar
        # strips read as distinct masonry, not the same tile re-tinted.
        out = out[:, ::-1, :]

    save(name, out)


def main():
    import os
    os.makedirs(OUT, exist_ok=True)

    # Trouble Brewing (gothic) -- warm red sandstone/brick, matches the
    # existing --redstone/--redstone-dim decorative tones.
    brick("altar-brick.jpg", 512, seed=31,
          base=(163, 68, 51), dim=(201, 138, 120), mortar=(214, 198, 168),
          mortar_strength=0.5, blotch_color=(120, 60, 46), blotch_strength=0.14)
    brick("altar-brick-night.jpg", 512, seed=131,
          base=(84, 40, 32), dim=(58, 30, 26), mortar=(150, 116, 82),
          mortar_strength=0.45, blotch_color=(40, 20, 18), blotch_strength=0.20)

    # Laissez un Faire (lovecraft) -- cold, worn grave-stone brick rather
    # than warm sandstone, to match the Victorian-occult palette. Mirrored
    # (see brick()'s mirror=) so it isn't just a recolour of the same tile.
    brick("altar-brick-lovecraft.jpg", 512, seed=231,
          base=(76, 62, 64), dim=(102, 88, 90), mortar=(58, 48, 48),
          mortar_strength=0.55, blotch_color=(40, 60, 52), blotch_strength=0.12,
          mirror=True)
    brick("altar-brick-lovecraft-night.jpg", 512, seed=331,
          base=(34, 26, 28), dim=(48, 38, 40), mortar=(20, 15, 15),
          mortar_strength=0.5, blotch_color=(18, 28, 24), blotch_strength=0.16,
          mirror=True)


if __name__ == "__main__":
    main()
