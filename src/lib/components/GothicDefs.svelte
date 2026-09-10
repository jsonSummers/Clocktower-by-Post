<script lang="ts">
	import { GOTHIC_ARCH_PATH } from '$lib/gothicArch';
</script>

<!--
	Mounted once (see +layout.svelte). Defines the #gothic-arch clip shape
	that every Avatar instance references by id -- an SVG def is inert until
	referenced, so this costs nothing sitting hidden in the layout.
-->
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
	<defs>
		<clipPath id="gothic-arch" clipPathUnits="objectBoundingBox">
			<path d={GOTHIC_ARCH_PATH} />
		</clipPath>
	</defs>
</svg>
