/**
 * Steampunk avatar frame: a riveted, beveled brass panel with four
 * hex-bolted corners -- the steampunk counterpart to gothicArch.ts's
 * Gothic lancet arch, replacing an earlier circular-porthole version per
 * Mickey's steer ("nuts and bolts on the corners, and beveled panels").
 *
 * Confirmed safe to shape however we like: Trouble Brewing and Laissez un
 * Faire share zero character ids or names (checked directly against both
 * script files -- 22 Trouble Brewing roles, 11 Laissez un Faire roles, no
 * overlap either way). Every avatar file belongs to exactly one script and
 * therefore exactly one frame, permanently -- so this shape owes nothing
 * to the gothic arch and can diverge as far as it wants.
 *
 * Same deal as the gothic arch: one shape, used as both a CSS clip-path
 * (via <clipPath> in GothicDefs -- despite that component's name, it now
 * hosts every frame's defs) and a decorative overlay (the bevel highlight
 * + corner nuts) drawn on top in Avatar.svelte, in the same 2:3
 * (width:height) object-bounding-box unit box as every other avatar frame
 * -- source art is still a plain 1000x1500px rectangle, Mickey's existing
 * painting convention, no new template needed.
 */

/**
 * Outer clip / bevel-edge panel -- a chamfered rectangle (octagon). The x
 * and y chamfer sizes are deliberately different (0.10 vs. 0.10 * 2/3) so
 * each cut corner reads as a true 45-degree angle once stretched into the
 * non-square 2:3 box -- the same correction BRASS_PORTHOLE's rx/ry needed
 * in the previous version of this file.
 */
export const BEVEL_PANEL_PATH =
	'M0.18,0.06 L0.82,0.06 L0.92,0.1267 L0.92,0.8733 ' +
	'L0.82,0.94 L0.18,0.94 L0.08,0.8733 L0.08,0.1267 Z';

/** A smaller inset copy of the same panel, drawn as a light bevel-highlight
 * stroke on top of the art to suggest a raised/beveled metal edge catching
 * the light -- not a clip shape itself, just decoration. */
export const BEVEL_PANEL_INSET_PATH =
	'M0.20,0.0733 L0.80,0.0733 L0.90,0.14 L0.90,0.86 ' +
	'L0.80,0.9267 L0.20,0.9267 L0.10,0.86 L0.10,0.14 Z';

/** Design aspect ratio (width/height) the panel above was drawn for --
 * matches GOTHIC_ARCH_RATIO so every avatar frame shares one template. */
export const BEVEL_PANEL_RATIO = 2 / 3;

/** The four corner bolt centres, one at the midpoint of each chamfered
 * corner -- in the same 0-1 object-bounding-box units as the paths above. */
export const BEVEL_PANEL_NUTS: { cx: number; cy: number }[] = [
	{ cx: 0.13, cy: 0.0933 }, // top-left
	{ cx: 0.87, cy: 0.0933 }, // top-right
	{ cx: 0.87, cy: 0.9067 }, // bottom-right
	{ cx: 0.13, cy: 0.9067 } // bottom-left
];

/**
 * Six points of a hex-nut outline centred at (cx, cy), as an SVG
 * <polygon> "points" string. rx/ry are independently scaled (rx = ry *
 * 3/2) for the same reason as BRASS_PORTHOLE's old rx/ry -- a nut drawn as
 * a "regular" hexagon in this 0-1 unit space would render squashed once
 * stretched into the real (non-square) 2:3 avatar box otherwise. Deliberately
 * no `vector-effect="non-scaling-stroke"` on anything built from this (see
 * Avatar.svelte) -- that combined badly with this box's non-uniform scale
 * in testing (rendered as a distorted rosette, not a hexagon); plain
 * proportional stroke-widths in these same 0-1 units render correctly and
 * still look right at every avatar size.
 */
export function hexNutPoints(cx: number, cy: number, r = 0.05): string {
	const rx = r;
	const ry = (r * 2) / 3;
	return Array.from({ length: 6 }, (_, i) => {
		const a = (Math.PI / 3) * i - Math.PI / 2;
		return `${cx + Math.cos(a) * rx},${cy + Math.sin(a) * ry}`;
	}).join(' ');
}
