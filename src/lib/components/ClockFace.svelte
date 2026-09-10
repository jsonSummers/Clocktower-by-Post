<script lang="ts">
	import type { GameSession } from '$lib/game.svelte';

	let { session, size = 'large' }: { session: GameSession; size?: 'large' | 'small' } = $props();

	const inLobby = $derived(session.label === 'Lobby');
	const openEnded = $derived(
		session.view != null && session.view.remainingMs === null && !inLobby
	);
</script>

<div class="face {size}">
	<p class="phase">{session.label}{session.paused ? ' · paused' : ''}</p>
	<div class="num" class:overrun={session.view?.overrun}>
		{inLobby ? '—' : session.display}
	</div>
	{#if session.view?.overrun && !inLobby}
		<p class="tag warn">over planned time</p>
	{:else if openEnded}
		<p class="tag">no set end</p>
	{/if}
</div>

<style>
	.face {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.15rem;
	}
	.phase {
		margin: 0;
		color: var(--text-dim);
		font-size: 0.85rem;
	}
	.num {
		font-variant-numeric: tabular-nums;
		line-height: 1;
		font-weight: 500;
	}
	.large .num {
		font-size: 3.25rem;
	}
	.small .num {
		font-size: 1.6rem;
	}
	.num.overrun {
		color: var(--danger);
	}
	.tag {
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-dim);
	}
	.tag.warn {
		color: var(--danger);
	}
</style>
