<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import GothicDefs from '$lib/components/GothicDefs.svelte';
	import { onMount } from 'svelte';

	let { children } = $props();

	// Pale monastery-by-day is the default look everywhere; "night vigil" is
	// an explicit choice (the candle button below), remembered per device —
	// never inferred from the OS's light/dark setting.
	let night = $state(false);

	onMount(() => {
		try {
			night = localStorage.getItem('cbp-theme') === 'night';
		} catch {
			/* private browsing etc. — default to day */
		}
	});

	$effect(() => {
		document.documentElement.dataset.theme = night ? 'night' : 'day';
		try {
			localStorage.setItem('cbp-theme', night ? 'night' : 'day');
		} catch {
			/* ignore — nothing to persist to */
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Cormorant+Garamond:wght@500;600;700&display=swap"
	/>
	<title>Clocktower by Post</title>
</svelte:head>

<GothicDefs />

<button
	class="theme-toggle"
	onclick={() => (night = !night)}
	title={night ? 'Switch back to day' : 'Light a candle (night vigil theme)'}
	aria-label="Toggle day/night theme"
>
	{night ? '🕯️' : '☀️'}
</button>

<main>
	{@render children()}
</main>
