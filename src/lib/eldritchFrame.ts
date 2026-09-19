/**
 * Lovecraftian decoration for Laissez un Faire avatars -- Mickey tried a
 * distinct round-headed arch first, then changed his mind back to the
 * shared Gothic outline ("the gothic outline border will work") while
 * keeping the warding sigil. So both scripts now clip through the same
 * #gothic-arch (see GothicDefs.svelte, gothicArch.ts) -- this file only
 * holds the Lovecraftian decoration drawn on top of that shared shape:
 * the warding sigil at the arch's keystone, plus the side-altar geometry
 * in sideAltar.ts is decorated per-theme from there.
 *
 * Confirmed safe to decorate however we like, independent of Trouble
 * Brewing: Trouble Brewing and Laissez un Faire share zero character ids
 * or names (checked directly against every script file in
 * src/lib/scripts -- 22 Trouble Brewing roles, 11 Laissez un Faire roles,
 * no overlap either way; amnesiac-abilities.ts is a private
 * Storyteller-only text file with no avatars of its own).
 */

/** Sigil position: just below the Gothic arch's own pointed keystone
 * (0.5, 0.04), where the arch is still comfortably wide (roughly 0.32-0.68
 * at y=0.13) so a ring this size clears both edges. */
export const ELDRITCH_SIGIL_CENTER = { cx: 0.5, cy: 0.13 };

/**
 * Points for a small n-pointed "warding sigil" star (an original abstract
 * mark, not a reproduction of any specific published symbol) centred at
 * (cx, cy) -- echoes the sigil stamped into warded-damask.jpg's page
 * background so the avatar frame and the page texture feel like one
 * vocabulary. rx/ry independently scaled (rx = ry * 1.5) to compensate for
 * the avatar box's non-uniform 2:3 stretch, same correction hexNutPoints()
 * used in the old brass frame.
 */
export function sigilRayPoints(cx: number, cy: number, r = 0.04, points = 7): [number, number][] {
	const ry = r;
	const rx = r * 1.5;
	return Array.from({ length: points }, (_, i) => {
		const a = ((2 * Math.PI) / points) * i - Math.PI / 2;
		return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as [number, number];
	});
}

/** The sigil's thin outer ring, as an SVG ellipse rx/ry (same 1.5x rule). */
export function sigilRing(cx: number, cy: number, r = 0.04) {
	return { cx, cy, rx: r * 1.5, ry: r };
}
