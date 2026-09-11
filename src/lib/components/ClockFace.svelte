<script lang="ts">
	import type { GameSession } from '$lib/game.svelte';

	let { session, size = 'large' }: { session: GameSession; size?: 'large' | 'small' } = $props();

	const inLobby = $derived(session.label === 'Lobby');
	const openEnded = $derived(
		session.view != null && session.view.remainingMs === null && !inLobby
	);

	// Briefly pulse the face whenever fresh data arrives, so it's obvious
	// something changed even if you weren't staring at the screen. Skip the
	// very first value (initial load isn't a "change").
	let pulsing = $state(false);
	let seenFirst = false;
	let pulseTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		void session.lastChangeAt;
		if (!seenFirst) {
			seenFirst = true;
			return;
		}
		pulsing = true;
		if (pulseTimer) clearTimeout(pulseTimer);
		pulseTimer = setTimeout(() => (pulsing = false), 1600);
	});

	const statusLabel: Record<string, string> = {
		connecting: 'Connecting…',
		live: 'Live',
		reconnecting: 'Reconnecting…',
		polling: 'Updating every few seconds'
	};
</script>

<div class="face {size}" class:pulsing>
	<div class="statusrow">
		<p class="phase">{session.label}{session.paused ? ' · paused' : ''}</p>
		<span
			class="dot {session.realtimeStatus}"
			title={statusLabel[session.realtimeStatus]}
			aria-label={statusLabel[session.realtimeStatus]}
		></span>
	</div>
	<div class="num" class:overrun={session.view?.overrun}>
		{inLobby ? '—' : session.display}
	</div>
	{#if session.view?.overrun && !inLobby}
		<p class="tag warn">over planned time</p>
	{:else if openEnded}
		<p class="tag">no set end</p>
	{/if}
	{#if pulsing}
		<p class="tag updated">Updated</p>
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
	.statusrow {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
	}
	.phase {
		margin: 0;
		color: var(--text-dim);
		font-size: 0.85rem;
	}
	.dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 999px;
		background: var(--text-dim);
		opacity: 0.6;
		transition: background-color 0.3s ease;
	}
	.dot.live {
		background: #3fa66a;
		opacity: 0.9;
	}
	.dot.connecting {
		background: var(--text-dim);
		opacity: 0.6;
	}
	.dot.reconnecting,
	.dot.polling {
		background: #d6a23a;
		opacity: 0.9;
	}
	.num {
		font-variant-numeric: tabular-nums;
		line-height: 1;
		font-weight: 500;
		transition: color 0.4s ease;
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
	.tag.updated {
		color: var(--accent);
		font-weight: 600;
		animation: fade-in 0.2s ease;
	}
	.face.pulsing .num {
		color: var(--accent);
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
