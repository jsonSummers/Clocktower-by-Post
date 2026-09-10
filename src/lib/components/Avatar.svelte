<script lang="ts">
	import { GOTHIC_ARCH_PATH } from '$lib/gothicArch';

	interface Props {
		/** Character id, matching a file at /avatars/<id>.png -- or null/unset for the placeholder. */
		characterId?: string | null;
		size?: 'sm' | 'md' | 'lg';
		/** Accessible label; leave empty to keep the avatar decorative (aria-hidden). */
		label?: string;
	}
	let { characterId = null, size = 'md', label = '' }: Props = $props();

	// A file that doesn't exist yet (most characters, until painted) falls
	// back to the candle glyph rather than a broken image icon.
	let broken = $state(false);
	const src = $derived(characterId ? `/avatars/${characterId}.png` : null);
	$effect(() => {
		void characterId;
		broken = false;
	});
</script>

<span class="avatar {size}" role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true}>
	{#if src && !broken}
		<img {src} alt="" onerror={() => (broken = true)} />
	{:else}
		<span class="candle">🕯️</span>
	{/if}
	<svg class="lead" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
		<path d={GOTHIC_ARCH_PATH} vector-effect="non-scaling-stroke" />
	</svg>
</span>

<style>
	.avatar {
		--w: 2.6rem;
		position: relative;
		display: inline-block;
		width: var(--w);
		aspect-ratio: 2 / 3;
		flex-shrink: 0;
	}
	.avatar.sm {
		--w: 1.9rem;
	}
	.avatar.md {
		--w: 2.6rem;
	}
	.avatar.lg {
		--w: 8rem;
	}
	.avatar img,
	.avatar .candle {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		clip-path: url(#gothic-arch);
	}
	.avatar img {
		object-fit: cover;
		display: block;
		background: var(--surface-2);
	}
	.avatar .candle {
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(160deg, var(--surface-2), var(--surface));
		font-size: calc(var(--w) * 0.4);
	}
	.lead {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	.lead path {
		fill: none;
		stroke: var(--lead, #4a4034);
		stroke-width: 2.5;
	}

	@media (max-width: 380px) {
		.avatar.lg {
			--w: 6rem;
		}
	}
</style>
