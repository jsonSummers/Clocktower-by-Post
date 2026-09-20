<script lang="ts">
	import { GOTHIC_ARCH_PATH } from '$lib/gothicArch';
	import { ELDRITCH_SIGIL_CENTER, sigilRayPoints, sigilRing } from '$lib/eldritchFrame';
	import {
		CANDLE_ASPECT,
		SKULL_ASPECT,
		CANDLE_GLOW_CENTER,
		ALTAR_STRIP_HEIGHT,
		ALTAR_STRIP_TOP_INSET,
		ITEM_BOTTOM
	} from '$lib/candleDeco';
	import { frameForCharacter } from '$lib/scriptTheme';

	interface Props {
		/** Character id, matching a file at /avatars/<id>.png -- or null/unset for the placeholder. */
		characterId?: string | null;
		size?: 'sm' | 'md' | 'lg';
		/** Accessible label; leave empty to keep the avatar decorative (aria-hidden). */
		label?: string;
	}
	let { characterId = null, size = 'md', label = '' }: Props = $props();

	// A file that doesn't exist yet (most characters, until painted) falls
	// back to a placeholder glyph rather than a broken image icon.
	let broken = $state(false);
	const src = $derived(characterId ? `/avatars/${characterId}.png` : null);
	// Which decoration this particular character gets -- looked up from the
	// script it belongs to (Trouble Brewing = candle altar, Laissez un
	// Faire = sigil + skull altar), not from the page's current theme, so a
	// Storyteller reference view mixing both scripts (e.g. the /dev
	// "Roles in play" card) never mis-decorates a character. Both scripts
	// share the same Gothic arch clip shape -- only the overlay decoration
	// differs.
	const frame = $derived(frameForCharacter(characterId));
	// Which of the two always-both-defined --altar-tex-{gothic,lovecraft}
	// custom properties (src/app.css, src/lib/textureVars.ts) this
	// character's own altar strip uses -- picked from `frame`, same as the
	// candle/skull art below, NOT from the page's global [data-script-theme]
	// (a page mixing characters from both scripts, e.g. a Storyteller
	// reference view, needs each avatar's brick to follow its own
	// character, exactly like the candle/skull overlay already does).
	const altarTexVar = $derived(frame === 'lovecraft' ? '--altar-tex-lovecraft' : '--altar-tex-gothic');
	const sigilRay = sigilRayPoints(ELDRITCH_SIGIL_CENTER.cx, ELDRITCH_SIGIL_CENTER.cy);
	const ring = sigilRing(ELDRITCH_SIGIL_CENTER.cx, ELDRITCH_SIGIL_CENTER.cy);
	$effect(() => {
		void characterId;
		broken = false;
	});
</script>

<span class="portrait {size}">
	<span
		class="avatar"
		role={label ? 'img' : undefined}
		aria-label={label || undefined}
		aria-hidden={label ? undefined : true}
	>
		{#if src && !broken}
			<img {src} alt="" onerror={() => (broken = true)} />
		{:else if frame === 'lovecraft'}
			<span class="placeholder"><span class="glyph">&#128065;</span></span>
		{:else}
			<span class="placeholder"><span class="glyph">&#128367;&#65039;</span></span>
		{/if}

		<svg class="frame-deco" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
			<path d={GOTHIC_ARCH_PATH} class="lead" vector-effect="non-scaling-stroke" />
			{#if frame === 'lovecraft'}
				<!--
					Sigil sits right at the arch's own keystone, on top of the
					painted art -- Mickey's "keep your segmented circle icon at
					the top" -- drawn on this same 0-1 fractional scale as
					everything else in this layer, plain proportional
					stroke-widths (see the CSS below for why).
				-->
				<ellipse cx={ring.cx} cy={ring.cy} rx={ring.rx} ry={ring.ry} class="sigil-ring" />
				{#each sigilRay as [x, y], i (i)}
					<line
						x1={ELDRITCH_SIGIL_CENTER.cx}
						y1={ELDRITCH_SIGIL_CENTER.cy}
						x2={x}
						y2={y}
						class="sigil-ray"
					/>
				{/each}
			{/if}
		</svg>

		<!--
			Altar strip -- "a window-wide but short alter, just a thin
			trapezoid with the relevant brick texture" -- a short brick-
			textured shelf spanning the window's width, sitting just inside
			the arch's own near-vertical lower sides. The candle/skull
			overlays below stand on its surface, base slightly sunk into it
			(their own "bottom" is ITEM_BOTTOM, a touch less than
			ALTAR_STRIP_HEIGHT, not 0).
		-->
		<span
			class="altar-strip"
			style="height: {ALTAR_STRIP_HEIGHT}%; clip-path: polygon({ALTAR_STRIP_TOP_INSET}% 0%, {100 -
				ALTAR_STRIP_TOP_INSET}% 0%, 100% 100%, 0% 100%); --altar-tex: var({altarTexVar});"
		></span>

		<!--
			Candle overlay -- Mickey's own painting (design/candles.png),
			"a blank altar will be on each portrait, much lower, basically at
			the bottom... in the church script, there will be candles on the
			left". A real photographic-aspect <img>, not part of the arch's
			0-1 stretched viewBox, so plain CSS positioning is enough -- no
			rx=1.5*ry correction needed here. Shown at every size (the old
			side altar was 'lg'-only because it was a separate companion
			element that needed spare room; this one sits inside the avatar's
			own box, so it scales down cleanly with it). Sits at ITEM_BOTTOM,
			not ALTAR_STRIP_HEIGHT, so its base settles slightly into the
			brick rather than balancing exactly on the strip's top edge
			("lower the items a little").
		-->
		<span
			class="candle-slot"
			style="aspect-ratio: {CANDLE_ASPECT}; bottom: {ITEM_BOTTOM}%;"
		>
			<span
				class="candle-glow"
				style="left: {CANDLE_GLOW_CENTER.x * 100}%; top: {CANDLE_GLOW_CENTER.y * 100}%;"
			></span>
			<img
				class="candle-img"
				src={frame === 'lovecraft' ? '/textures/candle-lovecraft.png' : '/textures/candle-church.png'}
				alt=""
			/>
		</span>

		{#if frame === 'lovecraft'}
			<!-- "the scull on the right" -->
			<span
				class="skull-slot"
				style="aspect-ratio: {SKULL_ASPECT}; bottom: {ITEM_BOTTOM}%;"
			>
				<img class="skull-img" src="/textures/skull.png" alt="" />
			</span>
		{/if}
	</span>
</span>

<style>
	.portrait {
		--w: 2.6rem;
		display: inline-flex;
	}
	.portrait.sm {
		--w: 1.9rem;
	}
	.portrait.md {
		--w: 2.6rem;
	}
	.portrait.lg {
		--w: 8rem;
	}
	.avatar {
		position: relative;
		display: inline-block;
		width: var(--w);
		aspect-ratio: 2 / 3;
		flex-shrink: 0;
	}
	.avatar img,
	.avatar .placeholder {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		clip-path: url(#gothic-arch);
	}
	.avatar > img,
	.avatar > .placeholder {
		object-fit: cover;
		display: block;
		background: var(--surface-2);
	}
	.avatar .placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(160deg, var(--surface-2), var(--surface));
	}
	.avatar .glyph {
		font-size: calc(var(--w) * 0.4);
	}
	.frame-deco {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	.lead {
		fill: none;
		stroke: var(--lead, #4a4034);
		stroke-width: 2.5;
	}
	/*
	 * NOT vector-effect: non-scaling-stroke on anything below -- unlike
	 * .lead above, these sit in a viewBox stretched non-uniformly (2:3, via
	 * preserveAspectRatio="none"), and non-scaling-stroke under a
	 * non-uniform transform rendered as a distorted mess in testing, not
	 * a clean line. Plain proportional stroke-widths (in the same 0-1
	 * object-bounding-box units as the path/point data itself, NOT css
	 * pixels) avoid that entirely and still read fine at every avatar size.
	 */
	.sigil-ring {
		fill: none;
		stroke: var(--ward-accent, #9a7a44);
		stroke-width: 0.008;
	}
	.sigil-ray {
		stroke: var(--ward-glow, #6ca87f);
		stroke-width: 0.006;
		opacity: 0.85;
	}

	/*
	 * Altar strip -- a short brick-textured shelf spanning the window's
	 * width (see candleDeco.ts's ALTAR_STRIP_HEIGHT/ALTAR_STRIP_TOP_INSET
	 * for the trapezoid taper). --altar-tex here is set inline per
	 * instance from altarTexVar above (picking --altar-tex-gothic or
	 * --altar-tex-lovecraft, both always defined in src/app.css /
	 * src/lib/textureVars.ts) rather than read as a page-global token --
	 * this element's own character decides its brick, same as the
	 * candle/skull art below, not the page's current [data-script-theme].
	 * A soft top-edge highlight plus a bottom shadow gives the thin strip
	 * a little shelf-like depth rather than reading as a flat decal.
	 */
	.altar-strip {
		position: absolute;
		left: 5%;
		right: 5%;
		bottom: 0;
		background-image:
			linear-gradient(180deg, rgba(255, 255, 255, 0.22) 0%, rgba(255, 255, 255, 0) 18%, rgba(0, 0, 0, 0.28) 100%),
			var(--altar-tex);
		background-size:
			100% 100%,
			50% auto;
		background-repeat: no-repeat, repeat;
		/* Trapezoid taper only -- CSS allows one clip-path per element, and
		 * the inline style attribute above sets the actual polygon() clip
		 * (see candleDeco.ts's ALTAR_STRIP_TOP_INSET). No arch clip here:
		 * the strip already sits within the arch's near-vertical lower
		 * sides at this height, so it doesn't need one. */
		pointer-events: none;
	}
	/*
	 * Candle / skull overlays -- ordinary <img>s at their own real aspect
	 * ratio (see candleDeco.ts), standing on the altar strip's surface and
	 * clipped by the same arch shape as the portrait so nothing pokes past
	 * the frame's own silhouette.
	 */
	.candle-slot {
		position: absolute;
		left: 8%;
		width: 20%;
		/* aspect-ratio, bottom set inline from candleDeco.ts's constants */
		clip-path: url(#gothic-arch);
		pointer-events: none;
	}
	.skull-slot {
		position: absolute;
		right: 8%;
		width: 24%;
		/* aspect-ratio, bottom set inline from candleDeco.ts's constants */
		clip-path: url(#gothic-arch);
		pointer-events: none;
	}
	.candle-img,
	.skull-img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		object-position: bottom;
	}
	/*
	 * "a translucent orange glow circle between the candle and the
	 * portrait, animate it to be flickering every so slightly" -- sits
	 * behind the candle image (painted first, below it in the DOM) but
	 * above the portrait, centred on the painted flames themselves
	 * (candleDeco.ts's CANDLE_GLOW_CENTER). screen-blended so it reads as
	 * light spilling onto the art rather than a flat coloured disc; a
	 * dedicated --candle-glow token (not --gilt-glow, which is a separate,
	 * unrelated UI-highlight colour and stays green under the lovecraft
	 * theme) swaps it to blue for Laissez un Faire's black candles.
	 */
	.candle-glow {
		position: absolute;
		width: 92%;
		aspect-ratio: 1;
		transform: translate(-50%, -50%);
		border-radius: 50%;
		background: radial-gradient(
			circle,
			rgba(var(--candle-glow, 255, 150, 50), 0.6) 0%,
			rgba(var(--candle-glow, 255, 150, 50), 0.3) 42%,
			rgba(var(--candle-glow, 255, 150, 50), 0) 72%
		);
		filter: blur(3px);
		mix-blend-mode: screen;
		animation: candle-flicker 2.6s ease-in-out infinite;
	}
	@keyframes candle-flicker {
		0%,
		100% {
			opacity: 0.85;
			transform: translate(-50%, -50%) scale(1);
		}
		35% {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1.06);
		}
		55% {
			opacity: 0.7;
			transform: translate(-50%, -50%) scale(0.95);
		}
		80% {
			opacity: 0.95;
			transform: translate(-50%, -50%) scale(1.02);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.candle-glow {
			animation: none;
		}
	}

	@media (max-width: 380px) {
		.portrait.lg {
			--w: 6rem;
		}
	}
</style>
