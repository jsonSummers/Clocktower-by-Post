<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { ensureSignedIn } from '$lib/supabase';
	import { GameSession } from '$lib/game.svelte';
	import PlayerView from '$lib/components/PlayerView.svelte';

	const gameId = page.params.gameId!;
	const session = new GameSession();

	onMount(() => {
		ensureSignedIn().then(() => session.start(gameId));
		return () => session.stop();
	});
</script>

<PlayerView {session} {gameId} />
