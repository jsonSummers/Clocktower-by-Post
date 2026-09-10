<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { SeatRow } from '$lib/types';
	import { seatLayout } from '$lib/circle';

	interface Props {
		seats: SeatRow[];
		meSeatId?: string | null;
		/** seats to ring-highlight, e.g. the viewer's living neighbours */
		highlightIds?: string[];
		/** optional secondary line under the name, e.g. an assigned character */
		labelFor?: (seat: SeatRow) => string | null;
		onselect?: (seatId: string) => void;
		center?: Snippet;
	}

	let {
		seats,
		meSeatId = null,
		highlightIds = [],
		labelFor,
		onselect,
		center
	}: Props = $props();

	const ordered = $derived([...seats].sort((a, b) => a.seat_index - b.seat_index));
	const points = $derived(seatLayout(ordered.length, 0.42));
</script>

<div class="ring" role={onselect ? 'group' : undefined}>
	{#if center}
		<div class="center">{@render center()}</div>
	{/if}
	{#each ordered as seat, i (seat.id)}
		{@const label = labelFor?.(seat) ?? null}
		{@const cls = [
			'seat',
			seat.id === meSeatId && 'me',
			!seat.alive && 'dead',
			highlightIds.includes(seat.id) && 'highlight',
			!seat.name && 'empty',
			onselect && 'clickable'
		]
			.filter(Boolean)
			.join(' ')}
		{@const pos = `left:${points[i].x * 100}%; top:${points[i].y * 100}%`}
		{#if onselect}
			<button class={cls} style={pos} onclick={() => onselect(seat.id)}>
				<span class="name">{seat.name || `Seat ${seat.seat_index + 1}`}</span>
				{#if label}<span class="role">{label}</span>{/if}
			</button>
		{:else}
			<div class={cls} style={pos}>
				<span class="name">{seat.name || `Seat ${seat.seat_index + 1}`}</span>
				{#if label}<span class="role">{label}</span>{/if}
			</div>
		{/if}
	{/each}
</div>

<style>
	.ring {
		position: relative;
		width: 100%;
		max-width: 22rem;
		margin: 0 auto;
		aspect-ratio: 1;
	}
	.center {
		position: absolute;
		inset: 28% 22%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 0.15rem;
	}
	.seat {
		position: absolute;
		transform: translate(-50%, -50%);
		font: inherit;
		color: var(--text);
		appearance: none;
		min-width: 3.4rem;
		max-width: 5.5rem;
		padding: 0.3rem 0.4rem;
		border-radius: 8px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		text-align: center;
		font-size: 0.72rem;
		line-height: 1.2;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.seat .name {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.seat .role {
		color: var(--text-dim);
		font-size: 0.66rem;
	}
	.seat.empty .name {
		color: var(--text-dim);
		font-weight: 400;
		font-style: italic;
	}
	.seat.me {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 18%, var(--surface-2));
	}
	.seat.highlight {
		box-shadow: 0 0 0 2px var(--night);
	}
	.seat.dead .name {
		text-decoration: line-through;
		color: var(--text-dim);
	}
	.seat.dead {
		opacity: 0.55;
	}
	.seat.clickable {
		cursor: pointer;
	}
	.seat.clickable:hover {
		border-color: var(--accent);
	}
	.seat.clickable:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	@media (max-width: 400px) {
		.seat {
			min-width: 2.5rem;
			max-width: 4.1rem;
			padding: 0.22rem 0.3rem;
			font-size: 0.62rem;
		}
		.seat .role {
			font-size: 0.55rem;
		}
	}
</style>
