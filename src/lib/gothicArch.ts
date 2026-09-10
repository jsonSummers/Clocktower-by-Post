/**
 * Shared pointed (Gothic lancet) arch outline used for every character
 * avatar, in 0-1 object-bounding-box units for a 2:3 (width:height) box.
 * One path, reused as both a CSS clip-path (via <clipPath> in GothicDefs)
 * and the stroked "leading" line drawn on top of the art in Avatar.svelte
 * -- so every avatar is guaranteed the same frame, painted or not.
 *
 * Source art should be a plain rectangular image at 1000x1500px (see
 * design/avatar-template.png) -- the app does the clipping, so nothing
 * needs to be painted with transparency.
 */
export const GOTHIC_ARCH_PATH =
	'M0.06,0.97 L0.06,0.46 ' +
	'C0.06,0.30 0.30,0.10 0.5,0.04 ' +
	'C0.70,0.10 0.94,0.30 0.94,0.46 ' +
	'L0.94,0.97 Z';

/** Design aspect ratio (width/height) the path above was drawn for. */
export const GOTHIC_ARCH_RATIO = 2 / 3;
