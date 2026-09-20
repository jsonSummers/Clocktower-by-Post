#!/usr/bin/env python3
"""
process_altar_art.py -- turns Mickey's own hand-painted candle/skull art
(design/candles.png, design/skull.png) into the transparent overlay
textures Avatar.svelte layers on top of every portrait:

    static/textures/candle-church.png     -- as painted (warm gold flame)
    static/textures/candle-lovecraft.png  -- same art, recoloured: black
                                              wax, blue flame
    static/textures/skull.png             -- tightly cropped

Three things it does, in order:
  1. Tight-crops each source to its actual painted content (with a small
     margin, but flush with the canvas edge wherever the art already
     touches it -- the candles are meant to sit flush with the bottom of
     the overlay, so their crop keeps that edge exact).
  2. Recolours the candle art for Laissez un Faire -- flame only. Mickey:
     "the candles are black for the lovecraft theme, make them default but
     with blue flames" -- so the wax now stays exactly as painted (no hue/
     sat/value change at all) and only the flame shifts to blue-cyan. The
     flame region itself is still found the same way as the earlier black-
     wax version: the wax and the flame in the source painting share
     almost the same warm hue (~44 degrees) -- candlelight reflecting off
     cream wax paints it the same colour as the flame itself -- so a hue-
     based split doesn't work, but saturation/value do (the flame is the
     small, highly-saturated/bright region). Blended by that "flameness"
     factor, not a hard mask, so the transition stays soft.
  3. Locates the flame tips in the (cropped, un-recoloured) candle art, for
     Avatar.svelte's CANDLE_GLOW_CENTER constant in candleDeco.ts -- the
     centre of the animated ambient glow "between the candle and the
     portrait".
  4. Adds a little subtle grain to each output -- Mickey: "apply subtle
     noise to the items to make them less 'microsoft paint'" -- per-pixel
     luminance noise confined to the painted (alpha>0) content, at an
     amplitude too small to fight the linework, just enough to break up
     the flat painted-vector fills.

Usage:
    python3 scripts/process_altar_art.py
    python3 scripts/process_altar_art.py --design-dir design --out-dir static/textures
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def rgb_to_hsv_arr(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    maxc = np.max(rgb, axis=-1)
    minc = np.min(rgb, axis=-1)
    v = maxc
    delta = maxc - minc
    s = np.where(maxc == 0, 0, delta / np.where(maxc == 0, 1, maxc))
    rc = np.where(delta == 0, 0, (maxc - r) / np.where(delta == 0, 1, delta))
    gc = np.where(delta == 0, 0, (maxc - g) / np.where(delta == 0, 1, delta))
    bc = np.where(delta == 0, 0, (maxc - b) / np.where(delta == 0, 1, delta))
    h = np.zeros_like(maxc)
    h = np.where(maxc == r, bc - gc, h)
    h = np.where(maxc == g, 2.0 + rc - bc, h)
    h = np.where(maxc == b, 4.0 + gc - rc, h)
    h = (h / 6.0) % 1.0
    h = np.where(delta == 0, 0, h)
    return np.stack([h, s, v], axis=-1)


def hsv_to_rgb_arr(hsv):
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    i = np.floor(h * 6.0)
    f = h * 6.0 - i
    p = v * (1.0 - s)
    q = v * (1.0 - f * s)
    t = v * (1.0 - (1.0 - f) * s)
    i = i.astype(int) % 6
    conditions = [i == k for k in range(6)]
    r = np.select(conditions, [v, q, p, p, t, v], default=v)
    g = np.select(conditions, [t, v, v, q, p, p], default=v)
    b = np.select(conditions, [p, p, t, v, v, q], default=v)
    return np.stack([r, g, b], axis=-1)


def smoothstep(x, lo, hi):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def tight_crop(im: Image.Image, pad=6, bottom_flush=True) -> Image.Image:
    bbox = im.getbbox()
    x0, y0, x1, y1 = bbox
    w, h = im.size
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(w, x1 + pad)
    y1 = min(h, y1 + (0 if bottom_flush and y1 >= h - 1 else pad))
    return im.crop((x0, y0, x1, y1))


def recolor_to_lovecraft(im: Image.Image) -> Image.Image:
    """Wax stays exactly as painted; only the flame shifts to blue-cyan --
    see the module docstring for why the flame region is found via
    saturation/value, not hue."""
    arr = np.asarray(im).astype(np.float64) / 255.0
    rgb = arr[..., :3]
    alpha = arr[..., 3:4]
    hsv = rgb_to_hsv_arr(rgb)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]

    flameness = smoothstep(s, 0.40, 0.60) * smoothstep(v, 0.55, 0.75)

    flame_v = np.clip(v * 1.05, 0, 1)
    flame_s = np.clip(s * 1.05 + 0.05, 0, 1)
    flame_h = np.full_like(h, 205.0 / 360.0)

    # At flameness == 0 this is exactly (h, s, v) -- the original wax,
    # untouched. Only pixels the flame mask actually pulls toward the blue
    # target move at all.
    out_h = h * (1 - flameness) + flame_h * flameness
    out_s = s * (1 - flameness) + flame_s * flameness
    out_v = v * (1 - flameness) + flame_v * flameness

    out_rgb = hsv_to_rgb_arr(np.stack([out_h, out_s, out_v], axis=-1))
    out = np.concatenate([out_rgb, alpha], axis=-1)
    out = np.clip(out * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(out, mode="RGBA")


def find_flame_blobs(im: Image.Image, n=3):
    """The n brightest/most-saturated blobs (the flames), centroids as
    fractions of the image's own width/height, sorted left to right."""
    arr = np.asarray(im).astype(np.float64) / 255.0
    rgb = arr[..., :3]
    alpha = arr[..., 3]
    hsv = rgb_to_hsv_arr(rgb)
    s, v = hsv[..., 1], hsv[..., 2]
    mask = (s > 0.45) & (v > 0.6) & (alpha > 0.3)
    labels, count = ndimage.label(mask)
    if count == 0:
        return []
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    order = np.argsort(sizes)[::-1][:n]
    H, W = mask.shape
    blobs = []
    for idx in order:
        ys, xs = np.where(labels == idx + 1)
        blobs.append({"cx": xs.mean() / W, "cy": ys.mean() / H})
    blobs.sort(key=lambda b: b["cx"])
    return blobs


def add_grain(im: Image.Image, strength: float = 6.0, seed: int = 0) -> Image.Image:
    """A little photographic grain so the flat painted-vector fills read
    less like flat digital colour blocks ("less Microsoft Paint") --
    per-pixel luminance noise, confined to the painted (alpha>0) content,
    at an amplitude subtle enough not to fight the linework."""
    arr = np.asarray(im).astype(np.float64)
    rgb = arr[..., :3]
    alpha = arr[..., 3:4]
    rng = np.random.default_rng(seed)
    noise = rng.normal(0.0, strength, size=rgb.shape[:2])[..., None]
    rgb = np.clip(rgb + noise, 0, 255)
    out = np.concatenate([rgb, alpha], axis=-1).astype(np.uint8)
    return Image.fromarray(out, mode="RGBA")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--design-dir", default="design")
    ap.add_argument("--out-dir", default="static/textures")
    args = ap.parse_args()

    design = Path(args.design_dir)
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    candles_raw = Image.open(design / "candles.png").convert("RGBA")
    candles_church = tight_crop(candles_raw, pad=6)
    candles_church_out = add_grain(candles_church, strength=6.0, seed=1)
    candles_church_out.save(out / "candle-church.png")
    print(f"saved {out / 'candle-church.png'} {candles_church_out.size}")

    # recolour from the clean (pre-grain) crop so the flameness mask isn't
    # thrown off by noise, then grain the recoloured result on its own.
    candles_lovecraft = recolor_to_lovecraft(candles_church)
    candles_lovecraft_out = add_grain(candles_lovecraft, strength=6.0, seed=2)
    candles_lovecraft_out.save(out / "candle-lovecraft.png")
    print(f"saved {out / 'candle-lovecraft.png'} {candles_lovecraft_out.size}")

    blobs = find_flame_blobs(candles_church, n=3)
    if blobs:
        avg_cx = sum(b["cx"] for b in blobs) / len(blobs)
        avg_cy = sum(b["cy"] for b in blobs) / len(blobs)
        print(
            "flame centroid (fraction of the cropped candle image) -- "
            "feed this into candleDeco.ts's CANDLE_GLOW_CENTER if the "
            f"art changes: {{ x: {avg_cx:.3f}, y: {avg_cy:.3f} }}"
        )
        print("individual flame blobs:", json.dumps(blobs, indent=2))
    else:
        print("no flame blobs found -- CANDLE_GLOW_CENTER in candleDeco.ts may need a manual update")

    skull_raw = Image.open(design / "skull.png").convert("RGBA")
    skull = tight_crop(skull_raw, pad=8, bottom_flush=False)
    skull_out = add_grain(skull, strength=6.0, seed=3)
    skull_out.save(out / "skull.png")
    print(f"saved {out / 'skull.png'} {skull_out.size}")


if __name__ == "__main__":
    main()
