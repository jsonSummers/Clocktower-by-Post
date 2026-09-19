<script lang="ts">
	import { GOTHIC_ARCH_PATH } from '$lib/gothicArch';
</script>

<!--
	Mounted once (see +layout.svelte). Defines the shared avatar clip shape,
	#gothic-arch, referenced by every <Avatar> regardless of script -- both
	Trouble Brewing and Laissez un Faire clip through the same Gothic arch
	now (Mickey tried a distinct round-headed arch for Laissez un Faire,
	then asked to go back to the shared outline while keeping the warding
	sigil -- see eldritchFrame.ts/sideAltar.ts for what actually differs
	per script: the sigil + side-altar decoration drawn on top). An SVG def
	is inert until referenced, so this costs nothing either way.
-->
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
	<defs>
		<clipPath id="gothic-arch" clipPathUnits="objectBoundingBox">
			<path d={GOTHIC_ARCH_PATH} />
		</clipPath>
	</defs>
</svg>
