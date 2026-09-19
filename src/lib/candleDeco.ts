/**
 * Geometry for the altar strip + candle/skull overlay painted on top of
 * every avatar -- Mickey's own hand-drawn art (design/candles.png,
 * design/skull.png), processed by scripts/process_altar_art.py into
 * transparent PNGs under static/textures/ (candle-church.png,
 * candle-lovecraft.png -- a recolour of the same art, black wax/blue
 * flame -- and skull.png), standing on a short brick-textured strip
 * (static/textures/altar-brick{,-night,-lovecraft,-lovecraft-night}.jpg,
 * scripts/make_altar_brick.py) spanning the window's own width.
 *
 * These are ordinary photographic-aspect-ratio images laid out with plain
 * CSS in Avatar.svelte, so -- unlike gothicArch.ts/eldritchFrame.ts, which
 * live in the arch's 0-1 non-uniformly-stretched viewBox and need the
 * rx=1.5*ry correction -- there's no distortion to correct for here.
 */

/** static/textures/candle-{church,lovecraft}.png pixel dimensions. */
export const CANDLE_ASPECT = 94 / 187;

/** static/textures/skull.png pixel dimensions. */
export const SKULL_ASPECT = 179 / 168;

/**
 * Centre of the candle flames within the candle image's own box (0-1
 * fractions of the candle image's width/height) -- where the ambient
 * "translucent glow between the candle and the portrait" is centred.
 * Found by locating the three brightest/most-saturated blobs in the
 * source painting and averaging their centroids.
 */
export const CANDLE_GLOW_CENTER = { x: 0.474, y: 0.318 };

/**
 * The altar strip -- "a window-wide but short alter, just a thin
 * trapezoid with the relevant brick texture" -- as a fraction of the
 * avatar box's own height. Candles/skull stand with their own bottom
 * edge at this height, so they read as resting on the strip's surface
 * rather than sinking into/floating above it.
 */
export const ALTAR_STRIP_HEIGHT = 8; // percent of avatar height

/** How far the trapezoid's top edge is inset from each side, relative to
 * the strip's own width -- the "thin trapezoid" taper/shelf look. */
export const ALTAR_STRIP_TOP_INSET = 6; // percent of the strip's own width

/**
 * How far up the candle/skull overlays' own bottom edge sits, as a
 * fraction of the avatar box's own height -- Mickey: "lower the items a
 * little". Deliberately a bit less than ALTAR_STRIP_HEIGHT so the items'
 * base sinks slightly into the brick rather than balancing exactly on its
 * top edge, which reads as more physically grounded.
 */
export const ITEM_BOTTOM = 5; // percent of avatar height
