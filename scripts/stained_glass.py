#!/usr/bin/env python3
"""
stained_glass.py — turn a flat "vector cutout" style avatar painting (flat
colour panes + black leading lines, like the ones the app's avatars are
painted as) into something that reads more like actual backlit glass, then
crop it to the app's gothic-arch window.

v2 fixed two real bugs found by testing on the actual paintings:

  - Dark SATURATED fill colours (a navy jacket, dark green, maroon) were
    being misread as leading (anything below a brightness threshold), so
    they got recoloured as "came" and the whole pane look shifted warm/
    brown. Fixed: leading is now brightness AND low-saturation (chroma) —
    a dark blue stays blue no matter how dark, only truly near-black/grey
    ink counts as a line.
  - Krita's bucket fill leaves thin (1-3px) unfilled hairline gaps in a few
    places — visible as pale, slightly warm-grey cracks, mostly along
    fiddly line junctions (checked: e.g. the bookshelf boards). These are
    now detected (colour close to neutral/light AND, crucially, THIN --
    a large inscribed-circle test tells a hairline crack apart from a
    legitimately pale design element like a white bonnet, which is thin
    nowhere) and filled in by growing the nearest real pane colour into
    them, before any of the glass effect is applied.

v3 fixes a third bug, found on the darker-palette (evil) characters: a big
DESATURATED-but-not-that-dark fill — a charcoal background wedge, grey
horns — could still be dark/flat enough to cross the same brightness+chroma
test used for leading, so a whole broad shape got flattened to uniform
near-black "came" colour and visually fused with the real ink lines and
with any other such fill next to it (reported as "dark clusters get mashed
together"). Brightness+chroma alone can't tell a dark grey FILL from dark
grey INK — a true stained-glass distinction is that leading is always a
thin stroke, never a broad area. So leading is now gated on THINNESS too,
the same inscribed-circle idea as the gap-fill above but applied pointwise
(a pixel's own distance-to-nearest-non-candidate value, not a whole
connected component's max — the real ink lines are almost always one big
connected mesh threading the whole image via their junctions, so a
per-component test would've thrown out every line the moment it touched
one thick junction blob). A broad dark/desaturated fill now keeps its own
colour and gets the normal per-pane glow/mottle treatment like any other
pane; only genuinely thin strokes get recoloured as leading. Also toned the
lead-came highlight down and made it a neutral pewter instead of warm gold,
per feedback that the outlines were reading brown instead of black.

v4 adds a stone window-surround: a mottled stone "reveal" carved just
inside the arch's own silhouette (no extra canvas needed). The first pass
thickened the border at the two base corners into a pier/buttress bulge;
on the actual paintings that read as lumpy rather than architectural, so it
was simplified to a plain UNIFORM thickness all the way round, including a
clean flat strip along the bottom edge — restrained reads as elegant here.
It's still a per-pixel mask (via the arch mask's own distance transform)
rather than a separate drawn shape, so it always follows this exact arch
outline exactly. On by default; pass `border=False` for the old
edge-to-edge glass look.

v5 adds a small depth+gloss pass (`_depth_and_gloss()`): a gentle vignette
for depth and a soft diagonal glass-glare streak for reflection, both
applied last over the whole window (glass and stone alike). Deliberately
subtle — these avatars render small (a seat-circle thumbnail, a role-card
portrait), so anything stronger than the default 0.10 strength just muddies
the linework without reading as more "glass" at that size. On by default;
`depth=False` (or `--no-depth`) turns it off, `depth_strength` tunes it.

v5.1 gives that pass more of an actual "light through glass" read, per
feedback ("more glass like reflection... light coming through"): a second,
softer catch-light streak on the opposite diagonal (real photographed glass
rarely shows just one reflection band), plus a broad soft backlight glow
centred a little above the window's middle, screen-blended in, as if
daylight is genuinely coming through rather than just glinting off the
surface. Controlled separately via `light_strength` (default 0.28) so it
can be tuned independently of the depth vignette.

Usage:
    python3 stained_glass.py IN.png OUT.png [--strength subtle|medium|strong]

Everything is pure functions — safe to import and tune from elsewhere.
Never modifies the input file.
"""
import argparse
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
from scipy import ndimage

# Same path as src/lib/gothicArch.ts, in 0-1 object-bounding-box units,
# designed for a 2:3 (width:height) canvas.
def _cubic(p0, p1, p2, p3, steps=100):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        mt = 1 - t
        x = (mt**3) * p0[0] + 3 * (mt**2) * t * p1[0] + 3 * mt * (t**2) * p2[0] + (t**3) * p3[0]
        y = (mt**3) * p0[1] + 3 * (mt**2) * t * p1[1] + 3 * mt * (t**2) * p2[1] + (t**3) * p3[1]
        pts.append((x, y))
    return pts


def gothic_arch_mask(w, h):
    """1-bit mask, True inside the app's pointed-arch window, for a W x H image."""
    outline = [(0.06, 0.97), (0.06, 0.46)]
    outline += _cubic((0.06, 0.46), (0.06, 0.30), (0.30, 0.10), (0.5, 0.04))[1:]
    outline += _cubic((0.5, 0.04), (0.70, 0.10), (0.94, 0.30), (0.94, 0.46))[1:]
    outline += [(0.94, 0.97), (0.06, 0.97)]
    poly = [(x * w, y * h) for x, y in outline]
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).polygon(poly, fill=255)
    return np.array(m) > 0


PRESETS = {
    # glow: inner brightening toward each pane's own centre
    # edge_darken: richening toward each pane's own edge
    # noise / noise_scale: smooth streaky glass mottle
    # bloom: soft overall backlit glow
    # highlight: how much pewter highlight the lead came gets (kept low --
    #            this is a thin catch-light, not a colour wash)
    "subtle": dict(glow=0.16, edge_darken=0.10, noise=0.05, noise_scale=60, bloom=0.10, highlight=0.12),
    "medium": dict(glow=0.26, edge_darken=0.16, noise=0.08, noise_scale=45, bloom=0.16, highlight=0.18),
    "strong": dict(glow=0.36, edge_darken=0.24, noise=0.13, noise_scale=35, bloom=0.24, highlight=0.24),
}


def _smooth_noise(h, w, scale, seed):
    rng = np.random.default_rng(seed)
    small = rng.uniform(-1, 1, size=(max(4, h // scale), max(4, w // scale))).astype(np.float32)
    field = np.array(
        Image.fromarray(((small + 1) * 127.5).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    ).astype(np.float32)
    return (field / 127.5) - 1.0  # back to -1..1


def find_leading(rgb, line_gray_max=80, line_chroma_max=26, line_max_halfwidth=5.0):
    """True leading: dark AND desaturated AND thin.

    Dark+desaturated alone isn't enough — a broad, flat, near-black or
    charcoal-grey FILL (a shadowed cave wall, grey horns, a dark cloak) can
    be every bit as dark and desaturated as real ink, especially on
    deliberately dark evil-character palettes. The extra test is thinness:
    real leading is always a thin stroke. `dist`, the distance transform of
    the dark+desaturated candidate mask, is each candidate pixel's distance
    to the nearest pixel that *isn't* dark+desaturated — small and roughly
    constant along the centre of a thin stroke, but large in the interior
    of any broad fill. This has to be a per-pixel (pointwise) test, not a
    per-connected-component one like the gap-fill below uses: essentially
    every line in one of these paintings touches every other line somewhere
    (a junction), so the whole ink network is typically one giant connected
    component — a component-level test would disqualify all of it the
    moment that component touched one thick junction blob or one broad dark
    fill. Pointwise, each thin segment still reads as thin no matter what
    it's connected to.
    """
    gray = rgb.mean(axis=2)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    candidate = (gray < line_gray_max) & (chroma < line_chroma_max)
    dist = ndimage.distance_transform_edt(candidate)
    return candidate & (dist <= line_max_halfwidth)


def find_and_fill_gaps(rgb, is_line, gray_min=110, chroma_max=28, max_halfwidth=3.0):
    """Krita bucket-fill hairline misses: pale/neutral AND thin (a large
    inscribed-circle radius rules out legitimately pale design elements,
    which are thin nowhere). Returns (fixed_rgb, gap_mask) for inspection."""
    gray = rgb.mean(axis=2)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    candidate = (~is_line) & (gray > gray_min) & (chroma < chroma_max)

    labels, n = ndimage.label(candidate, structure=np.ones((3, 3)))
    gap_mask = np.zeros_like(candidate)
    if n > 0:
        dist = ndimage.distance_transform_edt(candidate)
        maxd = ndimage.maximum(dist, labels, index=np.arange(0, n + 1))
        is_thin_label = maxd <= max_halfwidth
        gap_mask = is_thin_label[labels] & candidate

    if not gap_mask.any():
        return rgb, gap_mask

    # Grow the nearest confident (non-gap, non-line) pane colour into the gaps.
    confident = ~(is_line | gap_mask)
    _, (iy, ix) = ndimage.distance_transform_edt(~confident, return_indices=True)
    filled = rgb[iy, ix]
    fixed = np.where(gap_mask[..., None], filled, rgb)
    return fixed, gap_mask


def _stone_border(w, h, arch_mask, seed=0, thick_frac=0.032):
    """A modest, UNIFORM stone surround carved just inside the arch's own
    silhouette -- like a window's stone jambs/reveal, not a separate frame
    stuck on top, so it needs no extra canvas margin. Same thickness all
    the way round, including a clean flat strip along the arch's flat
    bottom edge -- an early version tried to bulge this into buttress-style
    piers at the base corners, but on the actual paintings that read as
    lumpy/odd rather than architectural, so it was dropped in favour of
    a plain, even reveal (still called a "stone border" -- the restrained,
    even version reads as the elegant one).

    Returns (is_border, stone_rgb) -- stone_rgb is meaningful only where
    is_border is True; the caller composites it over the glass render.
    """
    # Depth from the silhouette edge for every inside pixel -- 0 right at
    # the edge, growing toward the arch's interior. Pointwise, same trick
    # find_leading() uses for thinness.
    dist_in = ndimage.distance_transform_edt(arch_mask)

    thickness = thick_frac * w  # a single constant -- uniform all the way round
    is_border = arch_mask & (dist_in <= thickness)

    # -- mottled stone colour, two tones close to the app's own --border --
    noise = _smooth_noise(h, w, scale=22, seed=seed + 500)
    tone = (noise + 1) / 2
    stone_lo = np.array([190, 172, 133], dtype=np.float32)
    stone_hi = np.array([226, 211, 176], dtype=np.float32)
    stone = stone_lo[None, None, :] * (1 - tone[..., None]) + stone_hi[None, None, :] * tone[..., None]

    # Relief shading: a shallow shadow where the reveal meets the glass,
    # easing to a soft highlight toward the arch's outer silhouette --
    # reads as a carved stone reveal rather than a flat painted ring.
    depth = np.clip(dist_in / np.maximum(thickness, 1e-3), 0, 1)
    stone = stone * (0.80 + 0.32 * depth)[..., None]

    # A crisp dark line right at the outer silhouette so the window reads
    # clean against whatever card background it sits on...
    outer_line = is_border & (dist_in >= thickness - 1.4)
    stone = np.where(outer_line[..., None], stone * 0.68, stone)
    # ...and a fine seam exactly where stone meets glass.
    inner_seam = is_border & (dist_in <= 1.6)
    stone = np.where(inner_seam[..., None], stone * 0.82, stone)

    return is_border, np.clip(stone, 0, 255)


def _depth_and_gloss(rgb, w, h, strength=0.10, light_strength=0.28):
    """A very light, cheap depth+gloss pass over the whole window (glass AND
    stone), applied last. These avatars render small -- a seat-circle
    thumbnail, a role-card portrait -- so this is deliberately subtle:
    stronger than ~0.12 starts to muddy the linework at that size for no
    real gain.

    Two ingredients, both just a per-pixel multiply/screen against the
    already-finished image, no new geometry:
      - a gentle vignette, darkest toward the lower corners, clear near the
        top -- reads as the window sitting a little recessed / lit from
        above, i.e. "depth" -- and
      - a soft diagonal glass-glare streak from the upper-left, screen-
        blended -- "reflection" -- fading out before it reaches the bottom.
    """
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nx, ny = xx / w, yy / h  # 0..1 across the canvas

    vign = np.hypot((nx - 0.5) * 1.1, (ny - 0.62) * 1.0)
    vign = np.clip(vign - 0.32, 0, 1)
    shade = 1.0 - strength * vign

    # Primary glass-glare streak, upper-left light source.
    d1 = (nx - ny * 0.5) - 0.12
    gloss1 = np.exp(-(d1 ** 2) / (2 * 0.10 ** 2))
    gloss1 *= np.clip(1.2 - ny * 1.3, 0, 1)  # fades out before the bottom

    # Second, softer catch-light on the opposite diagonal -- real photographed
    # stained glass rarely shows just one reflection band, and a second one
    # (different angle, lower-right, weaker) reads as more convincingly
    # "glass" rather than a single stripe.
    d2 = (nx + ny * 0.4) - 1.0
    gloss2 = np.exp(-(d2 ** 2) / (2 * 0.13 ** 2))
    gloss2 *= np.clip(ny * 1.5 - 0.1, 0, 1)  # fades in before the top

    gloss = np.clip(gloss1 + 0.55 * gloss2, 0, 1)

    # A broad, soft backlight glow -- as if daylight is actually coming
    # through the window from behind, not just glinting off the surface.
    # Centred a little above middle (most panes' "sky"/background area).
    bx, by = 0.5, 0.4
    backlight = np.exp(-(((nx - bx) * 1.05) ** 2 + ((ny - by) * 1.2) ** 2) / (2 * 0.30 ** 2))

    out = rgb * shade[..., None]
    screen_amt = np.clip(gloss * strength * 1.05 + backlight * light_strength, 0, 0.85)
    out = out + (255.0 - out) * screen_amt[..., None]
    return np.clip(out, 0, 255)


def stained_glass(img: Image.Image, strength: str = "medium",
                   line_gray_max: int = 80, line_chroma_max: int = 26,
                   line_max_halfwidth: float = 5.0,
                   fill_gaps: bool = True, seed: int = 0,
                   border: bool = True, border_seed: int = None,
                   depth: bool = True, depth_strength: float = 0.10,
                   light_strength: float = 0.28,
                   return_debug: bool = False):
    p = PRESETS[strength]
    rgb = np.array(img.convert("RGB")).astype(np.float32)
    h, w, _ = rgb.shape

    is_line = find_leading(rgb, line_gray_max, line_chroma_max, line_max_halfwidth)

    gap_mask = np.zeros(is_line.shape, dtype=bool)
    if fill_gaps:
        rgb, gap_mask = find_and_fill_gaps(rgb, is_line)

    not_line = ~is_line

    # --- label each enclosed pane, distance-to-nearest-line per pixel ---
    labels, n = ndimage.label(not_line, structure=np.ones((3, 3)))
    dist = ndimage.distance_transform_edt(not_line)
    if n > 0:
        max_per_label = ndimage.maximum(dist, labels, index=np.arange(0, n + 1))
        max_per_label[max_per_label == 0] = 1
        maxd_map = max_per_label[labels]
    else:
        maxd_map = np.ones_like(dist)
    t = np.clip(dist / np.maximum(maxd_map, 1e-3), 0, 1) ** 0.6

    # --- per-pane inner glow: darker+richer near the lead, brighter at centre ---
    edge_factor = (1.0 - p["edge_darken"] * (1 - t))[..., None]
    glow_factor = (1.0 + p["glow"] * t)[..., None]
    panes = rgb * edge_factor * glow_factor

    # --- smooth streaky mottle inside the glass ---
    noise = _smooth_noise(h, w, p["noise_scale"], seed)[..., None]
    panes = panes * (1 + p["noise"] * noise)
    panes = np.clip(panes, 0, 255)

    # --- bloom: soft blurred, brightened glow screen-blended back on top ---
    pane_img = Image.fromarray(panes.astype(np.uint8))
    blurred = pane_img.filter(ImageFilter.GaussianBlur(radius=max(6, w // 60)))
    a = panes / 255.0
    b = (np.array(blurred).astype(np.float32) / 255.0) * 1.1
    screen = 1 - (1 - a) * (1 - np.clip(b, 0, 1))
    panes = np.clip(a * (1 - p["bloom"]) + screen * p["bloom"], 0, 1) * 255.0

    # --- re-draw the leading: mostly true near-black, with a NARROW neutral
    #     pewter catch-light only right at the came's own ridge, not smeared
    #     across its whole width ---
    line_dist = ndimage.distance_transform_edt(is_line)
    ridge = np.clip(line_dist / 4.0, 0, 1) ** 4  # steep power -> thin ridge only
    came_base = np.array([12, 11, 10], dtype=np.float32)       # true near-black, neutral
    came_highlight = np.array([120, 120, 118], dtype=np.float32)  # neutral pewter, not gold/brown
    came_color = came_base[None, None, :] * (1 - ridge[..., None] * p["highlight"]) \
        + came_highlight[None, None, :] * (ridge[..., None] * p["highlight"])

    out = np.where(is_line[..., None], came_color, panes)
    out = np.clip(out, 0, 255).astype(np.float32)

    mask = gothic_arch_mask(w, h)

    is_border = np.zeros(mask.shape, dtype=bool)
    if border:
        is_border, stone_rgb = _stone_border(
            w, h, mask, seed=seed if border_seed is None else border_seed
        )
        out = np.where(is_border[..., None], stone_rgb, out)

    if depth:
        out = _depth_and_gloss(out, w, h, strength=depth_strength, light_strength=light_strength)

    out = np.clip(out, 0, 255).astype(np.uint8)
    rgba = np.dstack([out, (mask * 255).astype(np.uint8)])
    final = Image.fromarray(rgba, mode="RGBA")

    if return_debug:
        return final, {"is_line": is_line, "gap_mask": gap_mask, "is_border": is_border}
    return final


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("infile")
    ap.add_argument("outfile")
    ap.add_argument("--strength", choices=list(PRESETS), default="medium")
    ap.add_argument("--no-gap-fill", action="store_true")
    ap.add_argument("--no-border", action="store_true")
    ap.add_argument("--no-depth", action="store_true")
    ap.add_argument("--light-strength", type=float, default=0.28)
    args = ap.parse_args()
    src = Image.open(args.infile)
    out = stained_glass(src, strength=args.strength, fill_gaps=not args.no_gap_fill,
                         border=not args.no_border, depth=not args.no_depth,
                         light_strength=args.light_strength)
    out.save(args.outfile)
    print(f"saved {args.outfile} ({out.size[0]}x{out.size[1]}, strength={args.strength})")


if __name__ == "__main__":
    main()
