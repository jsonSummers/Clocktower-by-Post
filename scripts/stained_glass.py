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

v6 responds to two more requests together: (1) the stone border is thicker
(`thick_frac` 0.032 -> 0.050) and actually textured now -- finer grain, a
few weathering blotches, and (new) coursed seams crossing the border at
even intervals all the way round, keyed to the arch's own perimeter
position via `_arclen_map()` so they land evenly regardless of size/aspect
-- reads as built ashlar stone rather than a painted ring. (2) The
reflection is no longer one streak across the whole window: `_finish_glass`
(renamed from `_depth_and_gloss`) now finds each individual enclosed glass
pane (the same `labels` the inner glow/mottle already grouped panes by) and
gives it its own small diagonal catch-light at a randomised angle and
position, confined to real glass pixels only (never the lead, never the
stone). The whole-window backlight glow and depth vignette stay global --
those represent one light source and one recessed frame, which is
physically right -- only the specular reflection moved to per-pane, since
that's what real dozens-of-individually-set-facets leaded glass actually
does. New `reflection`/`pane_gloss_strength` params, `--no-reflection` /
`--pane-gloss-strength` on the CLI.

v7 responds to live-game feedback on the actual deployed avatars: (1) a
gothic colour-grade pass (`_gothic_grade`, `mood_strength`) -- richer
saturation, a touch more contrast, and a faint cool indigo tint worked into
just the darkest pane areas, paired with the existing warm backlight so the
light itself stays warm while the shadows go moodier; (2) `find_leading` now
closes small breaks in the line network itself (`close_gap_iterations`, a
`binary_closing` on the boolean mask) rather than relying only on
colour-based gap recolouring -- catches a wider range of real gaps since it
doesn't care what colour the missing pixels happen to be; (3) `_finish_glass`
now takes the `is_line` mask and heavily discounts (not zeroes -- the came's
own dedicated ridge highlight still shows) the backlight/reflection blend on
leading pixels, fixing a real bug where a reflection streak crossing the
ink washed a properly black line out to visibly grey.

v8 responds to three requests together, after testing turned up why some
outlines were still visibly merging: (1) the actual cause wasn't the
brightness/chroma thresholds at all -- a sweep confirmed `close_gap_iterations`
(2) simply wasn't bridging every real break in the ink network, letting a
whole background wedge leak into its neighbour through one small gap (visible
as a single oversized connected-component "pane" spanning what should be two
separate shapes). Raised to 4, plus a modest `line_gray_max` (80->88) and
`line_max_halfwidth` (5.0->5.5) bump so genuinely faint/antialiased ink is
still caught -- confirmed on the actual paintings that this doesn't reopen
the v2/v3 dark-fill bugs, since the thinness gate that protects against those
is untouched. (2) `_bevel_leading()`: the came now has an actual rounded
profile -- a highlight on the side facing a light source, a shadow on the
far side, via the standard emboss trick (gradient of `line_dist`, already a
height field peaked along each line's centre, dotted with a light direction)
-- layered on top of, not replacing, the existing central ridge catch-light.
The same technique gets reused as a gentle single-light-source relief pass
on the stone border, on top of its existing radial depth shading. (3)
`_glass_texture()`: a fine dimpled "orange-peel" bump (the same directional-
light shading trick again, at a much smaller noise scale) plus an optional
sub-pixel refractive warp via `map_coordinates`, both confined off the
leading so ink stays crisp -- an attempt at an actual glass SURFACE rather
than a flat-shaded fill. `light_strength`/`reflect_strength` also nudged up
slightly (0.28->0.32, 0.12->0.15) per feedback wanting "a little more"
light/reflection, not a redesign of that pass.

v9 tracks down what "the black line blur is still pretty constant" actually
was, after a first guess (broad dark FILLS reading as indistinguishable from
the leading -- see `_lift_dark_panes()` below, kept as a real but secondary
fix) turned out not to be it: measured directly, the real cause was v8's own
`close_gap_iterations` bump (2->4). `ndimage.binary_closing` is dilate-then-
erode, and dilation is what decides whether two nearby-but-separate strokes
touch and fuse -- erosion afterwards only cleans up the OUTER edge of
whatever already got fused, it can't un-fuse it. In a face crop (eyebrows,
nose, eyelids all a few px apart) that pushed line coverage from 28% to 42%
of the area -- a real, measurable thickening/blobbing, not a subjective
impression, and this project's own prior docstring claim that closing
"fills gaps... without thickening lines meant to stay separate" was simply
wrong. Replaced with `_bridge_line_gaps()`: skeletonize the raw mask
(scikit-image), find true endpoints (a stroke dangling rather than
continuing or meeting another at a junction), and bridge only endpoint
pairs from DIFFERENT strokes within `bridge_gap_px` -- so two strokes that
are each already a closed shape (no dangling ends) are never touched, no
matter how close together they sit; only an actual break grows new ink,
confined to the bridge itself. `close_gap_iterations` (now default 0, was 4)
is demoted to an optional, tiny single-pixel antialiasing touch-up on top of
that, not the main gap-filler -- and off by default, because it turns out
`binary_closing` is non-monotonic on these paintings: measured directly on
the same test image, 1-2 iterations merged panes MORE than 3-4 did (a
thin bridge the dilation step creates can survive a light erosion but get
fully eroded back off by a heavier one, which can leave a *different*,
thicker accidental connection as the one that survives instead -- there's
no small iteration count that's reliably the safe side of that). Alignment-
gated bridging turned out to be very conservative on its own test image too
(added close to zero net pixels there) -- real gap-closing robustness is
still a known weak spot, just no longer one that trades away crisp faces to
get. `_lift_dark_panes()` is kept alongside this as a
genuine, separate improvement found along the way: every pass that shapes a
pane's colour (glow, mottle, bloom, grade, the v8 texture bump) is
multiplicative, and multiplying a pixel already near (0,0,0) by anything is
still near (0,0,0) -- no brightness lever there could pull a dark FILL away
from black, so it blends each pane pixel toward a slightly cool `ambient`
floor as its own luminance approaches 0, fading to a no-op above
`dark_pane_floor` (40 by default) -- real stained glass is never fully
opaque even at its darkest, where the lead came holding it properly is.
Reflection pushed further too, per feedback wanting more of it on top of
the already-hand-edited review defaults: library defaults now match what
had drifted ahead of them in review_portraits.py's own CLI (`reflect_strength`
0.15->0.40, `light_strength` 0.32->0.38, `bevel_strength` 0.35->0.5,
`backlight_warmth` 0.35->0.5, `texture_strength` 0.35->0.15) -- the two
files had quietly diverged; they're back in lockstep.

v11 responds to "colours all look washed out... going for deep stained
windows": the `_gothic_grade` saturation/contrast boost (v7) runs early in
the pipeline, but `_finish_glass` -- the whole-window backlight glow and
diagonal reflection streaks -- runs LAST, after every other pass, and was
blending up to 85% of the way toward near-white/warm-gold over a broad
soft-edged area (the backlight) plus two more streaks (the reflection).
That's not a subtle glaze on top of the richer colour the grade pass just
added -- measured directly, it was diluting most of it back out, which
reads exactly as "washed out" even though the saturation boost is real and
still there underneath. Three changes together, not one: (1) `sat_boost`
0.22->0.42 and `contrast` 0.10->0.16 in `_gothic_grade`, so the jewel tones
read deeper and richer to begin with; (2) `light_strength` 0.38->0.24 and
`reflect_strength` 0.40->0.22 (library defaults, CLI defaults in both this
file and review_portraits.py, kept in lockstep per the v9 note above) --
still enough for a "light coming through glass" read, just not enough to
overpower it; (3) a firm ceiling on both blends in `_finish_glass` itself
(0.85->0.5), independent of the strength knobs, so pushing either back up
later can brighten the glow without ever again flattening a pane toward
plain white. `bloom` (the PRESETS screen-blend) trimmed similarly (subtle
0.10->0.07, medium 0.16->0.11, strong 0.24->0.15) for the same reason on a
smaller scale. The stone border, the came, and the per-pane sparkle are all
untouched -- this is specifically about the pane FILL colour reading as
deep saturated glass instead of pastel.

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


def _arch_outline(w, h, straight_steps=2, curve_steps=100):
    """The app's pointed-arch outline as a list of (x, y) pixel points, in
    perimeter order. `straight_steps`/`curve_steps` control how finely each
    segment is subdivided -- gothic_arch_mask only needs the polygon
    vertices (cheap, straight_steps=2), but the stone border's coursed
    seams need it dense and roughly evenly sampled along the curve too
    (see _arclen_map)."""
    def lerp_pts(p0, p1, n):
        return [(p0[0] + (p1[0] - p0[0]) * t / n, p0[1] + (p1[1] - p0[1]) * t / n) for t in range(n + 1)]

    pts = lerp_pts((0.06, 0.97), (0.06, 0.46), straight_steps)
    pts += _cubic((0.06, 0.46), (0.06, 0.30), (0.30, 0.10), (0.5, 0.04), steps=curve_steps)[1:]
    pts += _cubic((0.5, 0.04), (0.70, 0.10), (0.94, 0.30), (0.94, 0.46), steps=curve_steps)[1:]
    pts += lerp_pts((0.94, 0.46), (0.94, 0.97), straight_steps)[1:]
    pts += lerp_pts((0.94, 0.97), (0.06, 0.97), straight_steps)[1:]
    return [(x * w, y * h) for x, y in pts]


def gothic_arch_mask(w, h):
    """1-bit mask, True inside the app's pointed-arch window, for a W x H image."""
    poly = _arch_outline(w, h)
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).polygon(poly, fill=255)
    return np.array(m) > 0


def _arclen_map(w, h):
    """For every pixel, the fractional distance (0..1) along the arch's own
    outline to the NEAREST point of that outline -- lets the stone border's
    coursed seams follow this exact silhouette regardless of size/aspect,
    without hand-fitting arc-length math to the bezier curves."""
    pts = _arch_outline(w, h, straight_steps=180, curve_steps=180)
    pts_arr = np.array(pts, dtype=np.float64)
    seg = np.hypot(*(pts_arr[1:] - pts_arr[:-1]).T)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    total = cum[-1] if cum[-1] > 0 else 1.0
    arclen_norm = (cum / total).astype(np.float32)

    arclen_img = np.full((h, w), -1.0, dtype=np.float32)
    xs = np.clip(pts_arr[:, 0].round().astype(int), 0, w - 1)
    ys = np.clip(pts_arr[:, 1].round().astype(int), 0, h - 1)
    arclen_img[ys, xs] = arclen_norm

    known = arclen_img >= 0
    _, (iy, ix) = ndimage.distance_transform_edt(~known, return_indices=True)
    return arclen_img[iy, ix]


PRESETS = {
    # glow: inner brightening toward each pane's own centre
    # edge_darken: richening toward each pane's own edge
    # noise / noise_scale: smooth streaky glass mottle
    # bloom: soft overall backlit glow
    # highlight: how much pewter highlight the lead came gets (kept low --
    #            this is a thin catch-light, not a colour wash)
    "subtle": dict(glow=0.16, edge_darken=0.10, noise=0.05, noise_scale=60, bloom=0.07, highlight=0.12),
    "medium": dict(glow=0.26, edge_darken=0.16, noise=0.08, noise_scale=45, bloom=0.11, highlight=0.18),
    "strong": dict(glow=0.36, edge_darken=0.24, noise=0.13, noise_scale=35, bloom=0.15, highlight=0.24),
}


def _smooth_noise(h, w, scale, seed):
    rng = np.random.default_rng(seed)
    small = rng.uniform(-1, 1, size=(max(4, h // scale), max(4, w // scale))).astype(np.float32)
    field = np.array(
        Image.fromarray(((small + 1) * 127.5).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    ).astype(np.float32)
    return (field / 127.5) - 1.0  # back to -1..1


def _endpoint_direction(skel, y0, x0, steps=5):
    """Walk back up to `steps` pixels along the skeleton from an endpoint,
    and return the unit vector (dy, dx) pointing OUTWARD -- the direction
    the dangling stroke is heading, i.e. where it would continue if the
    break weren't there. None if the stroke is too short to get a direction
    from (its own single pixel, or a 1-2px stub)."""
    visited = {(y0, x0)}
    cy, cx = y0, x0
    far = (y0, x0)
    h, w = skel.shape
    for _ in range(steps):
        nxt = None
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                ny, nx = cy + dy, cx + dx
                if (ny, nx) in visited:
                    continue
                if 0 <= ny < h and 0 <= nx < w and skel[ny, nx]:
                    nxt = (ny, nx)
                    break
            if nxt:
                break
        if nxt is None:
            break
        visited.add(nxt)
        cy, cx = nxt
        far = nxt
    dy, dx = y0 - far[0], x0 - far[1]
    norm = (dy * dy + dx * dx) ** 0.5
    if norm < 1.5:  # too short a stub to trust a direction
        return None
    return dy / norm, dx / norm


def _bridge_line_gaps(is_line_raw, max_gap_px=8.0, touch_up_iterations=1, align_thresh=0.25):
    """Bridge genuine breaks in the ink NETWORK's topology -- a stroke that
    dangles instead of meeting another stroke -- without also fattening or
    fusing strokes that are simply close together but were never meant to
    join (two eyebrows either side of a nose bridge, say).

    v7/v8 did this with `ndimage.binary_closing`, and that function's own
    docstring used to claim closing does this "without thickening... lines
    that are genuinely meant to stay separate" -- measured on the actual
    paintings, that's not true: closing is dilate-then-erode, and dilation
    alone is what decides whether two nearby-but-separate strokes touch and
    permanently fuse into one blob; erosion afterwards only cleans up the
    outer edges of whatever the dilation already merged, it can't un-fuse
    them. On a face, where eyebrows/nose/eyelids sit a few px apart, that
    measurably fattened and blobbed the linework (close_iterations=4 pushed
    line coverage in one such crop from 28% to 42% of the area) -- reported
    back as "the black line blur is still pretty constant".

    This is the surgical alternative: skeletonize the raw (un-bridged) mask
    down to a 1px topological skeleton, find its ENDPOINTS (skeleton pixels
    with exactly one neighbour -- i.e. where a stroke dangles rather than
    continuing or forming a junction), and for each endpoint whose nearest
    endpoint belonging to a *different* stroke is within `max_gap_px`, draw
    a short segment directly between them. Two strokes that are already
    fully closed shapes running near each other (no dangling ends) have no
    endpoints to bridge, so they're never touched -- only real gaps grow new
    ink, and only exactly where the gap is.

    A nearest-endpoint match alone still over-bridges on a detail-dense
    painting (lots of small decorative strokes -- fingers, jewellery,
    highlights -- put lots of endpoints close together that were never
    supposed to meet): tested on the actual paintings, distance-only
    bridging fused MORE panes than the old closing approach did. So a
    candidate pair only gets bridged if BOTH endpoints' own local direction
    (`_endpoint_direction`, a short walk back along the skeleton) points
    roughly at each other, within `align_thresh` (a dot product, so 1.0 is
    dead-on and 0 is perpendicular) -- i.e. the gap reads as a plausible
    continuation of the same stroke, not two unrelated strokes that just
    happen to end up near each other.

    Falls back to a light `binary_closing` (`touch_up_iterations`, small on
    purpose -- this is just for single-pixel antialiasing nicks, not
    structural gaps) if scikit-image isn't installed to skeletonize with.
    """
    if not is_line_raw.any():
        return is_line_raw

    try:
        from skimage.morphology import skeletonize
        from scipy.spatial import cKDTree
    except ImportError:
        if touch_up_iterations <= 0:
            return is_line_raw
        return ndimage.binary_closing(
            is_line_raw, structure=np.ones((3, 3)), iterations=touch_up_iterations
        )

    skel = skeletonize(is_line_raw)
    neighbour_count = (
        ndimage.convolve(skel.astype(np.uint8), np.ones((3, 3), dtype=np.uint8), mode="constant")
        - skel.astype(np.uint8)
    )
    endpoints = skel & (neighbour_count == 1)
    ys, xs = np.nonzero(endpoints)

    bridged = is_line_raw
    if len(ys) >= 2:
        comp_labels, _ = ndimage.label(is_line_raw, structure=np.ones((3, 3)))
        endpoint_comp = comp_labels[ys, xs]
        directions = [_endpoint_direction(skel, int(y), int(x)) for y, x in zip(ys, xs)]
        pts = np.column_stack([xs, ys]).astype(np.float64)
        tree = cKDTree(pts)
        k = min(8, len(pts))
        dists, idxs = tree.query(pts, k=k)
        if k == 1:  # a single endpoint has no partner to query against
            dists, idxs = dists[:, None], idxs[:, None]

        new_pixels = np.zeros_like(is_line_raw)
        drawn_pairs = set()
        for i in range(len(pts)):
            di = directions[i]
            if di is None:
                continue  # too short a stub to trust which way it's heading
            for col in range(1, dists.shape[1]):
                j = int(idxs[i, col])
                d = dists[i, col]
                if d > max_gap_px:
                    break  # neighbours are distance-sorted; nothing closer remains
                if endpoint_comp[i] == endpoint_comp[j]:
                    continue  # same stroke, already connected -- not a gap
                dj = directions[j]
                if dj is None:
                    continue
                x0, y0 = pts[i]
                x1, y1 = pts[j]
                towards_j = ((y1 - y0) / d, (x1 - x0) / d)
                towards_i = (-towards_j[0], -towards_j[1])
                aligned_i = di[0] * towards_j[0] + di[1] * towards_j[1]
                aligned_j = dj[0] * towards_i[0] + dj[1] * towards_i[1]
                if aligned_i < align_thresh or aligned_j < align_thresh:
                    continue  # this endpoint isn't actually heading toward that one
                pair = (min(i, j), max(i, j))
                if pair in drawn_pairs:
                    continue
                drawn_pairs.add(pair)
                steps = max(2, int(d) + 1)
                for t in np.linspace(0, 1, steps):
                    yy, xx = int(round(y0 + (y1 - y0) * t)), int(round(x0 + (x1 - x0) * t))
                    if 0 <= yy < new_pixels.shape[0] and 0 <= xx < new_pixels.shape[1]:
                        new_pixels[yy, xx] = True
                break  # bridge only to the single nearest aligned cross-stroke endpoint

        if new_pixels.any():
            # Give just the new bridge segments the same ~2-3px weight as a
            # real stroke -- dilating only the new pixels, never the
            # pre-existing network, keeps this fix confined to actual gaps.
            new_pixels = ndimage.binary_dilation(new_pixels, structure=np.ones((3, 3)))
            bridged = is_line_raw | new_pixels

    if touch_up_iterations > 0:
        bridged = ndimage.binary_closing(
            bridged, structure=np.ones((3, 3)), iterations=touch_up_iterations
        )
    return bridged


def find_leading(rgb, line_max_halfwidth=11.0, line_contrast_min=16.0,
                  line_chroma_max=40, close_iterations=0, bridge_gap_px=8.0):
    """True leading, found by LOCAL CONTRAST rather than absolute darkness.

    v10: the old test (dark+desaturated AND thin, thinness measured as a
    pixel's own distance to the nearest pixel that *isn't* dark+desaturated)
    broke down whenever the PAINT AROUND a line was itself dark and
    desaturated -- the Librarian's bookshelf, the Monk's stone archway, the
    Imp's cave: all deliberately moody, dark backgrounds. There, ink and
    fill both passed the same absolute darkness test, so there was no local
    edge for that distance transform to find -- a line buried in a dark
    fill scored just as "thick" as the fill itself, got excluded as
    leading, and came back as a stray sliver pane of its own. That's the
    hollow/double-rail dashing and fused-together regions that were
    reported ("the black line bit is bad, regions merge"); confirmed
    directly by rendering the old `is_line` mask and seeing the ink network
    come out as parallel outlines with the middle of every line missing.

    Fix: judge ink by LOCAL contrast, not absolute brightness, via a
    grayscale morphological closing (`ndimage.grey_closing`, disk radius
    `line_max_halfwidth`) -- the standard black-hat move. A broad dark FILL
    is wider than the disk, so closing can't reach past it: contrast ~0,
    correctly left as a pane. A thin dark STROKE is narrower than the disk,
    so closing bridges clean across it to the lighter colour on either
    side: contrast spikes. Works the same regardless of whether the
    surrounding paint is pale or dark. `line_chroma_max` still guards
    against a saturated dark fill (navy, forest green) reading as ink.

    `line_max_halfwidth` still means the widest half-width of stroke still
    treated as leading -- just measured as a closing radius now instead of
    a distance-threshold. Real ink on these 1000x1500 paintings runs
    roughly 6-16px including thick junctions, so the default is well above
    the old 5.5px, which was simply too small and was carving the centre
    out of any normal-width line, even against a light background.
    """
    gray = rgb.mean(axis=2)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    radius = max(1, int(round(line_max_halfwidth)))
    yy, xx = np.ogrid[-radius:radius + 1, -radius:radius + 1]
    disk = (xx * xx + yy * yy) <= radius * radius
    closed = ndimage.grey_closing(gray, footprint=disk)
    contrast = closed - gray
    is_line = (contrast > line_contrast_min) & (chroma < line_chroma_max)
    is_line = _bridge_line_gaps(is_line, max_gap_px=bridge_gap_px, touch_up_iterations=close_iterations)
    return is_line



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


def _stone_border(w, h, arch_mask, seed=0, thick_frac=0.050, n_courses=34):
    """A UNIFORM stone surround carved just inside the arch's own silhouette
    -- like a window's stone jambs/reveal, not a separate frame stuck on
    top, so it needs no extra canvas margin. Same thickness all the way
    round, including a clean flat strip along the arch's flat bottom edge
    -- an early version tried to bulge this into buttress-style piers at
    the base corners, but on the actual paintings that read as lumpy/odd
    rather than architectural, so it was dropped in favour of a plain,
    even reveal.

    Thickened and given actual stone texture per feedback ("a bit thicker
    with a stone texture"): finer grain, a few weathering blotches (the
    same idea as static/textures/limestone.jpg's procedural texture, just
    inlined here rather than shared -- this runs on a painting, that runs
    standalone), and -- the part that makes it read as built rather than
    painted -- coursed seams: thin dark lines crossing the border at even
    intervals all the way round, like real ashlar voussoirs framing a
    window. The seams are keyed to `_arclen_map()`, the arch's own
    perimeter position, so they always land evenly regardless of size.

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

    # Finer grain on top of the mottling -- an actual stone surface, not a
    # smooth gradient.
    grain = _smooth_noise(h, w, scale=6, seed=seed + 501)
    stone = stone * (0.94 + 0.06 * grain[..., None])

    # Occasional weathering blotches.
    blotch = _smooth_noise(h, w, scale=70, seed=seed + 502)
    blotch = np.clip((blotch - 0.55) * 2.2, 0, 1)
    stone = stone * (1 - 0.14 * blotch[..., None]) + stone_lo[None, None, :] * (0.14 * blotch[..., None])

    # Relief shading: a shallow shadow where the reveal meets the glass,
    # easing to a soft highlight toward the arch's outer silhouette --
    # reads as a carved stone reveal rather than a flat painted ring.
    depth = np.clip(dist_in / np.maximum(thickness, 1e-3), 0, 1)
    stone = stone * (0.80 + 0.32 * depth)[..., None]

    # A single-light-source bevel across the whole reveal, same technique and
    # same light direction as the came bevel below -- the carved stone should
    # look lit by the one light the leading and glass are lit by, not by its
    # own separate radial glow. Kept gentle: this rides on top of the radial
    # relief shading above, it doesn't replace it.
    bevel = _directional_bevel(dist_in, is_border)
    stone = stone * (1.0 + 0.18 * bevel)[..., None]

    # Coursed-stone seams, evenly spaced along the arch's own perimeter.
    arclen = _arclen_map(w, h)
    phase = (arclen * n_courses) % 1.0
    seam_dist = np.minimum(phase, 1 - phase)
    seam = np.clip(1 - seam_dist / 0.05, 0, 1)
    stone = stone * (1 - 0.30 * seam[..., None])

    # A crisp dark line right at the outer silhouette so the window reads
    # clean against whatever card background it sits on...
    outer_line = is_border & (dist_in >= thickness - 1.6)
    stone = np.where(outer_line[..., None], stone * 0.66, stone)
    # ...and a fine seam exactly where stone meets glass.
    inner_seam = is_border & (dist_in <= 1.8)
    stone = np.where(inner_seam[..., None], stone * 0.80, stone)

    return is_border, np.clip(stone, 0, 255)


def _gothic_grade(rgb, sat_boost=0.42, contrast=0.16, shadow_tint_strength=0.16):
    """v7: 'moodier, gothic in colour', applied to the pane fills only (the
    leading gets its own dedicated near-black came colour, untouched here).

    Three small, additive moves rather than one big filter, so nothing
    clips or looks obviously processed:
      - a saturation boost around each pixel's own luminance, so the jewel
        tones (the whole point of stained glass) read richer instead of
        pastel;
      - a gentle S-curve contrast around mid-grey, so shadows read as
        genuinely dark/deep rather than flat -- moodier, less washed;
      - a faint cool indigo tint worked into ONLY the darkest areas (a
        `shadow_amt` term that fades to 0 above roughly 35% luminance), the
        classic warm-light/cool-shadow split that reads as atmospheric
        rather than uniformly lit -- paired with the existing warm backlight
        glow, which is left alone so the light source itself stays warm.
    """
    luma = (rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114)[..., None]
    rgb = luma + (rgb - luma) * (1 + sat_boost)

    x = np.clip(rgb / 255.0, 0, 1)
    x = x + contrast * (x - 0.5) * (1 - np.abs(x - 0.5) * 2) * 2
    rgb = np.clip(x, 0, 1) * 255.0

    luma2 = (rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114) / 255.0
    shadow_amt = (np.clip((0.35 - luma2) / 0.35, 0, 1) ** 1.4)[..., None] * shadow_tint_strength
    indigo = np.array([72.0, 58.0, 112.0], dtype=np.float32)
    rgb = rgb * (1 - shadow_amt) + indigo[None, None, :] * shadow_amt

    return np.clip(rgb, 0, 255)


def _lift_dark_panes(panes, floor=40.0, ambient=(30.0, 28.0, 34.0)):
    """v9: stop broad dark FILLS (a shadowed recess, a charcoal wedge) from
    rendering close enough to true black that they visually fuse with the
    leading around them -- reported as outlines reading as one constant
    smear of black rather than crisp ink on top of distinct, if dark, glass.

    The bug: every earlier pass on `panes` (glow, mottle, bloom, gothic
    grade, the texture bump) is MULTIPLICATIVE. Multiplying a pixel that's
    already near (0, 0, 0) by any of those factors is still near (0, 0, 0)
    -- there is no brightness lever left that can pull a truly dark fill
    away from the came's own near-black. Real stained glass doesn't have
    this problem: even the darkest glass a studio stocks still passes a
    little light and reads as a deep colour, never as opaque as the lead
    came holding it -- that's the distinction this restores, with an
    additive floor instead of another multiply. Blends toward a slightly
    cool `ambient` (never flat/pure grey -- a hint of colour still reads as
    glass, not paint) as a pixel's own luminance approaches 0, fading to a
    no-op by `floor` so mid-tones and highlights are untouched. Deliberately
    applied to every pane pixel, unconditionally -- the leading gets
    overwritten with its own dedicated (and now more clearly separated)
    near-black right after this, so there's no need to mask it out here.
    """
    luma = panes.mean(axis=2, keepdims=True)
    t = np.clip(1.0 - luma / floor, 0, 1) ** 1.2
    amb = np.array(ambient, dtype=np.float32)
    return panes * (1 - t) + (panes + amb) * t


_LIGHT_DIR = (-0.65, -0.75)  # upper-left, matching the existing gloss/backlight direction


def _directional_bevel(height, mask, light_dir=_LIGHT_DIR, blur_sigma=1.0):
    """Shade a mask by treating `height` as a bump/ridge and lighting it from
    `light_dir` (dx, dy; "from" direction, upper-left is negative/negative).
    Returns a -1..1 array (0 outside `mask`): positive where the local slope
    faces the light (a highlight), negative where it faces away (a shadow).

    This is the standard emboss trick -- gradient of a height field stands in
    for a surface normal's tilt, and its dot product with the light direction
    gives a Lambertian-style shade -- applied here to `line_dist` (leading)
    or `dist_in` (the stone border), both of which are already 0 at an edge
    and rising inward, i.e. already a usable "height". A field built from a
    boolean mask is blocky, so it's blurred first for a smooth bevel instead
    of a staircase of shading bands.
    """
    smooth = ndimage.gaussian_filter(height.astype(np.float32), blur_sigma)
    gy, gx = np.gradient(smooth)
    mag = np.hypot(gx, gy)
    lx, ly = light_dir
    lnorm = (lx * lx + ly * ly) ** 0.5
    lx, ly = lx / lnorm, ly / lnorm
    # Normalize the gradient direction but keep it 0 on dead-flat ground
    # (ridge tops, deep interiors) instead of amplifying near-zero noise.
    safe_mag = np.maximum(mag, 1e-6)
    shade = (gx / safe_mag * lx + gy / safe_mag * ly) * np.clip(mag * 3.0, 0, 1)
    return np.where(mask, shade, 0.0)


def _bevel_leading(came_color, is_line, line_dist, strength=0.35):
    """Give the came a rounded metal profile instead of a flat-shaded one: a
    highlight down the side facing the light, a shadow down the side facing
    away, either side of the existing central ridge highlight. `line_dist`
    (distance-to-nearest-non-line, already computed by the caller) is 0 at
    each edge of a line and peaks along its centre, so its gradient points
    "outward" from the centreline in a different direction on each side --
    exactly the two bevel faces of a rounded strip. Deliberately layered on
    top of, not instead of, the existing ridge catch-light: real leaded came
    has both a rounded profile AND a brighter strip right along its spine.
    """
    if strength <= 0:
        return came_color
    shade = _directional_bevel(line_dist, is_line)
    factor = 1.0 + strength * shade
    return np.clip(came_color * factor[..., None], 0, 255)


def _glass_texture(rgb, w, h, exclude_mask, seed=0, strength=0.35, warp_px=0.5):
    """Give the panes an actual glass SURFACE instead of a flat-shaded fill --
    real cast/rolled glass (the cathedral-glass look these avatars are going
    for) is never optically flat. Two ingredients, both confined away from
    `exclude_mask` (the leading, so ink stays crisp):

      - a fine 'orange-peel' bump: small-scale noise turned into a normal-map-
        style shade via the same directional-light trick `_bevel_leading`
        uses, so the surface reads as gently dimpled rather than airbrushed;
      - a very slight spatial warp (sub-pixel to ~1px), displacing pixels by
        a smooth noise field via `map_coordinates` -- real glass refracts
        what's behind it, so this is a distortion, not a filter. Kept tiny on
        purpose: these avatars render small (a seat-circle thumbnail), and
        anything bigger would blur the linework and misregister it against
        the leading rather than reading as glass.
    """
    bump = _smooth_noise(h, w, scale=5, seed=seed + 900)
    bump_smooth = ndimage.gaussian_filter(bump, 0.8)
    gy, gx = np.gradient(bump_smooth)
    mag = np.hypot(gx, gy)
    lx, ly = _LIGHT_DIR
    lnorm = (lx * lx + ly * ly) ** 0.5
    lx, ly = lx / lnorm, ly / lnorm
    safe_mag = np.maximum(mag, 1e-6)
    shade = (gx / safe_mag * lx + gy / safe_mag * ly) * np.clip(mag * 25.0, 0, 1)
    shade = np.where(exclude_mask, 0.0, shade)
    out = rgb * (1.0 + 0.16 * strength * shade[..., None])

    if warp_px > 0:
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        dx = _smooth_noise(h, w, scale=10, seed=seed + 901) * warp_px
        dy = _smooth_noise(h, w, scale=10, seed=seed + 902) * warp_px
        coords_y = np.clip(yy + dy, 0, h - 1)
        coords_x = np.clip(xx + dx, 0, w - 1)
        warped = np.stack(
            [ndimage.map_coordinates(out[..., c], [coords_y, coords_x], order=1, mode="nearest")
             for c in range(3)],
            axis=-1,
        )
        out = np.where(exclude_mask[..., None], out, warped)

    return np.clip(out, 0, 255)


def _pane_sparkle(rgb, w, h, labels, n, glass_mask, seed=0, strength=0.35,
                   light_dir=_LIGHT_DIR, min_pane_px=250):
    """v10: one small catch-light per individual glass pane, so adjoining
    panes -- including two similarly-coloured or equally grey ones -- read
    as distinct, separately set pieces of glass rather than one continuous
    wash. Restores the spirit of v6's per-pane reflection (reverted in v7
    as too busy at one-streak-per-window scale) but quieter: one small
    highlight each, not a shape-spanning streak. Only reachable now because
    `find_leading` actually separates panes correctly -- v6's version ran
    on a `labels` map already prone to fusing neighbours, likely why it
    read as messy enough to revert.

    Each highlight sits at its pane's own "widest interior point" (the
    peak of that pane's distance-to-edge map, restricted to `glass_mask` so
    a pane mostly hidden by the stone border is only sized by its visible
    sliver), nudged toward `light_dir` but scaled to the pane's own radius
    so it can't drift outside the shape. Panes under `min_pane_px` are
    skipped -- a highlight that small reads as a stray fleck, not glass.
    """
    if n == 0 or strength <= 0:
        return rgb
    labels = np.where(glass_mask, labels, 0)
    sizes = ndimage.sum(np.ones_like(labels, dtype=np.float32), labels, index=np.arange(1, n + 1))
    dist = ndimage.distance_transform_edt(glass_mask)
    maxval = ndimage.maximum(dist, labels, index=np.arange(1, n + 1))
    maxpos = ndimage.maximum_position(dist, labels, index=np.arange(1, n + 1))

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    lx, ly = light_dir
    lnorm = (lx * lx + ly * ly) ** 0.5
    lx, ly = lx / lnorm, ly / lnorm
    rng = np.random.RandomState(seed + 777)

    accum = np.zeros((h, w), dtype=np.float32)
    for i in range(n):
        if sizes[i] < min_pane_px:
            continue
        r = maxval[i]
        if not np.isfinite(r) or r < 4:
            continue
        py, px = maxpos[i]
        jitter = rng.uniform(0.7, 1.0)
        ox = px + lx * r * 0.35 * jitter
        oy = py + ly * r * 0.35 * jitter
        sigma = max(3.0, min(r * 0.55, 40.0))
        accum = np.maximum(
            accum,
            np.exp(-(((xx - ox) ** 2 + (yy - oy) ** 2) / (2 * sigma ** 2))),
        )

    amt = np.where(glass_mask, np.clip(accum * strength, 0, 0.9), 0.0)
    return rgb + (255.0 - rgb) * amt[..., None]


def _candle_glint(rgb, w, h, glass_mask, color=(255, 170, 90),
                   center=(0.14, 0.86), radius_frac=0.16, strength=0.16):
    """Mickey: "another very small reflection on the panels that reflects
    the candle light" -- a single small, soft highlight low on the
    window's own left side (roughly where the candle overlay sits just
    outside the frame in Avatar.svelte), tinted toward the candle-glow
    colour instead of neutral white like `_pane_sparkle` above, so it
    reads as the glass catching light FROM the candle rather than another
    generic sparkle. Deliberately smaller and much fainter than the
    whole-window reflection streaks in `_finish_glass` -- one soft glint,
    not another diagonal band. `color` defaults to a warm gold matching
    Trouble Brewing's flame; pass a cooler blue for a future Laissez un
    Faire portrait once that art exists.
    """
    if strength <= 0:
        return rgb
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nx, ny = xx / w, yy / h
    cx, cy = center
    r = radius_frac
    d2 = ((nx - cx) / r) ** 2 + ((ny - cy) / (r * 1.15)) ** 2
    glint = np.exp(-d2 * 1.6)
    amt = np.where(glass_mask, np.clip(glint * strength, 0, 0.5), 0.0)
    tint = np.array(color, dtype=np.float32)
    return rgb + (tint[None, None, :] - rgb) * amt[..., None]


def _finish_glass(rgb, w, h, labels, n, glass_mask, seed=0,
                   depth_strength=0.10, light_strength=0.28,
                   reflect_strength=0.12, backlight_warmth=0.35,
                   is_line=None, line_light_guard=0.88,
                   pane_sparkle_strength=0.35,
                   candle_glint_strength=0.0, candle_glint_color=(255, 170, 90)):
    """Applied last, over the whole finished window. Four ingredients: a
    DEPTH vignette (darkest toward the lower corners); a broad soft
    BACKLIGHT glow tinted by `backlight_warmth`; one restrained pair of
    whole-window diagonal REFLECTION streaks; and (v10) a per-pane SPARKLE
    (`_pane_sparkle`, above) -- one small catch-light per individual pane,
    brought back per a direct request ("each coloured region... should be
    distinct, shiny") now that `find_leading` separates panes correctly
    (the earlier per-pane attempt, v6, ran on a leading detector prone to
    fusing neighbours, likely why it read as messy enough to revert in v7).

    v7 fix, still in force: wherever the backlight/reflection crossed the
    black leading it washed a properly black line out to visible grey.
    `is_line` heavily discounts (not zeroes -- the came's own dedicated
    ridge highlight still shows) both blends on leading pixels, via
    `line_light_guard` (default 0.88 = leading gets ~12% of the lightening).
    """
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nx, ny = xx / w, yy / h  # 0..1 across the canvas

    vign = np.hypot((nx - 0.5) * 1.1, (ny - 0.62) * 1.0)
    vign = np.clip(vign - 0.32, 0, 1)
    shade = 1.0 - depth_strength * vign

    bx, by = 0.5, 0.4
    backlight = np.exp(-(((nx - bx) * 1.05) ** 2 + ((ny - by) * 1.2) ** 2) / (2 * 0.30 ** 2))

    d1 = (nx - ny * 0.5) - 0.12
    gloss1 = np.exp(-(d1 ** 2) / (2 * 0.10 ** 2))
    gloss1 *= np.clip(1.2 - ny * 1.3, 0, 1)
    d2 = (nx + ny * 0.4) - 1.0
    gloss2 = np.exp(-(d2 ** 2) / (2 * 0.13 ** 2))
    gloss2 *= np.clip(ny * 1.5 - 0.1, 0, 1)
    gloss = np.clip(gloss1 + 0.55 * gloss2, 0, 1)

    warm_gold = np.array([255.0, 238.0, 196.0], dtype=np.float32)
    white = np.array([255.0, 255.0, 255.0], dtype=np.float32)
    backlight_color = white * (1 - backlight_warmth) + warm_gold * backlight_warmth

    out = rgb * shade[..., None]
    backlight_amt = np.clip(backlight * light_strength, 0, 0.5)
    reflect_amt = np.clip(gloss * reflect_strength, 0, 0.5)
    if is_line is not None:
        guard = 1.0 - (is_line.astype(np.float32) * line_light_guard)
        backlight_amt = backlight_amt * guard
        reflect_amt = reflect_amt * guard
    out = out + (backlight_color[None, None, :] - out) * backlight_amt[..., None]
    out = out + (255.0 - out) * reflect_amt[..., None]

    if pane_sparkle_strength > 0:
        out = _pane_sparkle(out, w, h, labels, n, glass_mask, seed=seed,
                             strength=pane_sparkle_strength)

    if candle_glint_strength > 0:
        out = _candle_glint(out, w, h, glass_mask, color=candle_glint_color,
                             strength=candle_glint_strength)

    return np.clip(out, 0, 255)



def stained_glass(img: Image.Image, strength: str = "medium",
                   line_contrast_min: float = 16.0, line_chroma_max: int = 40,
                   line_max_halfwidth: float = 11.0, close_gap_iterations: int = 0,
                   bridge_gap_px: float = 8.0,
                   fill_gaps: bool = True, seed: int = 0,
                   border: bool = True, border_seed: int = None,
                   depth: bool = True, depth_strength: float = 0.10,
                   light_strength: float = 0.24, backlight_warmth: float = 0.5,
                   reflection: bool = True, reflect_strength: float = 0.22,
                   mood_strength: float = 1.0,
                   bevel_strength: float = 0.5,
                   texture_strength: float = 0.15, texture_warp_px: float = 0.5,
                   dark_pane_floor: float = 40.0,
                   pane_sparkle_strength: float = 0.35,
                   candle_glint_strength: float = 0.0,
                   candle_glint_color: tuple = (255, 170, 90),
                   return_debug: bool = False):
    p = PRESETS[strength]
    rgb = np.array(img.convert("RGB")).astype(np.float32)
    h, w, _ = rgb.shape

    is_line = find_leading(rgb, line_max_halfwidth=line_max_halfwidth,
                            line_contrast_min=line_contrast_min, line_chroma_max=line_chroma_max,
                            close_iterations=close_gap_iterations, bridge_gap_px=bridge_gap_px)

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

    # --- moodier, more gothic colour: richer saturation + deeper shadows +
    #     a faint cool tint worked into just the darkest areas ---
    if mood_strength > 0:
        panes = _gothic_grade(
            panes,
            sat_boost=0.22 * mood_strength,
            contrast=0.10 * mood_strength,
            shadow_tint_strength=0.12 * mood_strength,
        )

    # --- keep dark fills visibly separate from the came: an additive floor,
    #     since a multiplicative one can never lift a pixel that's already
    #     near (0,0,0) -- see _lift_dark_panes() ---
    if dark_pane_floor > 0:
        panes = _lift_dark_panes(panes, floor=dark_pane_floor)

    # --- actual glass surface: fine dimpled bump + a hair of refractive warp,
    #     kept off the leading so the ink stays crisp ---
    if texture_strength > 0:
        panes = _glass_texture(
            panes, w, h, exclude_mask=is_line, seed=seed,
            strength=texture_strength, warp_px=texture_warp_px,
        )

    # --- re-draw the leading: mostly true near-black, with a NARROW neutral
    #     pewter catch-light only right at the came's own ridge, not smeared
    #     across its whole width ---
    line_dist = ndimage.distance_transform_edt(is_line)
    ridge = np.clip(line_dist / 4.0, 0, 1) ** 4  # steep power -> thin ridge only
    came_base = np.array([12, 11, 10], dtype=np.float32)       # true near-black, neutral
    came_highlight = np.array([120, 120, 118], dtype=np.float32)  # neutral pewter, not gold/brown
    came_color = came_base[None, None, :] * (1 - ridge[..., None] * p["highlight"]) \
        + came_highlight[None, None, :] * (ridge[..., None] * p["highlight"])

    # --- bevel the came: a rounded metal profile (light-facing highlight,
    #     shadow on the far side) either side of the ridge above, not instead
    #     of it ---
    came_color = _bevel_leading(came_color, is_line, line_dist, strength=bevel_strength)

    out = np.where(is_line[..., None], came_color, panes)
    out = np.clip(out, 0, 255).astype(np.float32)

    mask = gothic_arch_mask(w, h)

    is_border = np.zeros(mask.shape, dtype=bool)
    if border:
        is_border, stone_rgb = _stone_border(
            w, h, mask, seed=seed if border_seed is None else border_seed
        )
        out = np.where(is_border[..., None], stone_rgb, out)

    # The actual visible glass pixels once the stone reveal has been carved
    # out of the arch's edge -- this is what the per-pane reflection below
    # is confined to (never the lead lines, never the stone).
    glass_mask = mask & (~is_border) & (~is_line)

    if depth or reflection or pane_sparkle_strength > 0 or candle_glint_strength > 0:
        out = _finish_glass(
            out, w, h, labels, n, glass_mask, seed=seed,
            depth_strength=depth_strength if depth else 0.0,
            light_strength=light_strength if depth else 0.0,
            backlight_warmth=backlight_warmth,
            reflect_strength=reflect_strength if reflection else 0.0,
            is_line=is_line,
            pane_sparkle_strength=pane_sparkle_strength,
            candle_glint_strength=candle_glint_strength,
            candle_glint_color=candle_glint_color,
        )

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
    ap.add_argument("--light-strength", type=float, default=0.24)
    ap.add_argument("--backlight-warmth", type=float, default=0.5)
    ap.add_argument("--no-reflection", action="store_true")
    ap.add_argument("--reflect-strength", type=float, default=0.22)
    ap.add_argument("--close-gap-iterations", type=int, default=0,
                     help="tiny single-pixel antialiasing touch-up only, off by default -- "
                          "ndimage.binary_closing turns out to be non-monotonic on these "
                          "paintings (1-2 iterations can merge MORE than 3-4 do), so there's no "
                          "small value that's reliably safe; only turn this on for a specific "
                          "image after checking it actually helps there")
    ap.add_argument("--bridge-gap-px", type=float, default=8.0,
                     help="max endpoint-to-endpoint distance (px) to bridge a real break in the "
                          "ink network; 0 disables")
    ap.add_argument("--line-contrast-min", type=float, default=16.0,
                     help="local-contrast threshold (v10 black-hat detector) that tells real ink from its surroundings")
    ap.add_argument("--line-max-halfwidth", type=float, default=11.0,
                     help="closing-disk radius (px) that tells real ink from a broad dark fill")
    ap.add_argument("--pane-sparkle-strength", type=float, default=0.35,
                     help="per-pane catch-light, 0 disables (see _pane_sparkle)")
    ap.add_argument("--mood-strength", type=float, default=1.0,
                     help="0 = off, 1 = full gothic colour grade (richer saturation, deeper "
                          "shadows, cool shadow tint); can go above 1 for more")
    ap.add_argument("--bevel-strength", type=float, default=0.5,
                     help="rounded light/shadow profile on the came, 0 disables")
    ap.add_argument("--texture-strength", type=float, default=0.15,
                     help="fine dimpled glass-surface bump, 0 disables")
    ap.add_argument("--texture-warp-px", type=float, default=0.5,
                     help="subtle refractive pixel warp inside the glass, 0 disables")
    ap.add_argument("--dark-pane-floor", type=float, default=40.0,
                     help="min effective luminance for a pane fill, so dark fills stay visibly "
                          "apart from the near-black leading instead of fusing with it; 0 disables")
    ap.add_argument("--candle-glint-strength", type=float, default=0.0,
                     help="a single small, faint highlight low on the window's left side, "
                          "tinted toward the candle-glow colour rather than neutral white -- "
                          "0 (default here) disables; see _candle_glint")
    args = ap.parse_args()
    src = Image.open(args.infile)
    out = stained_glass(src, strength=args.strength, fill_gaps=not args.no_gap_fill,
                         border=not args.no_border, depth=not args.no_depth,
                         light_strength=args.light_strength,
                         backlight_warmth=args.backlight_warmth,
                         reflection=not args.no_reflection,
                         reflect_strength=args.reflect_strength,
                         close_gap_iterations=args.close_gap_iterations,
                         bridge_gap_px=args.bridge_gap_px,
                         line_contrast_min=args.line_contrast_min,
                         line_max_halfwidth=args.line_max_halfwidth,
                         mood_strength=args.mood_strength,
                         bevel_strength=args.bevel_strength,
                         texture_strength=args.texture_strength,
                         dark_pane_floor=args.dark_pane_floor,
                         texture_warp_px=args.texture_warp_px,
                         pane_sparkle_strength=args.pane_sparkle_strength,
                         candle_glint_strength=args.candle_glint_strength)
    out.save(args.outfile)
    print(f"saved {args.outfile} ({out.size[0]}x{out.size[1]}, strength={args.strength})")


if __name__ == "__main__":
    main()
