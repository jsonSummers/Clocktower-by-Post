<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { supabase, ensureSignedIn } from '$lib/supabase';
	import { serverTimeSynced } from '$lib/server-time';
	import { GameSession } from '$lib/game.svelte';
	import { nextPhase, phaseLabel } from '$lib/clock';
	import { getScript } from '$lib/scripts';
	import { dealGame } from '$lib/scripts/deal';
	import { checkWinCondition, voteState } from '$lib/scripts/winCondition';
	import {
		phase as phaseRpc,
		applyDeal,
		assignRole,
		setSeatName,
		setSeatAlive,
		setGhostVoteAvailable,
		resolveMeet,
		moveSeat,
		kickSeat
	} from '$lib/actions';
	import type { Team } from '$lib/types';
	import Circle from '$lib/components/Circle.svelte';
	import ClockFace from '$lib/components/ClockFace.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import NightDispatch from '$lib/components/NightDispatch.svelte';

	const gameId = page.params.gameId!;
	const session = new GameSession();

	type Tab = 'clock' | 'seats' | 'night' | 'requests';
	let tab = $state<Tab>('clock');
	let minutes = $state(12);
	let gatherReason = $state('');
	let actionError = $state<string | null>(null);
	let codeCopied = $state(false);
	let confirmingKick = $state<string | null>(null);
	let dealing = $state(false);
	let dealMsg = $state<string | null>(null);

	onMount(() => {
		ensureSignedIn().then(() => session.start(gameId));
		return () => session.stop();
	});

	const script = $derived(session.game ? getScript(session.game.script_id) : undefined);
	const nextLabel = $derived(
		session.phase ? phaseLabel(nextPhase(session.phase, 0, 0)) : 'Night 1'
	);
	const waiting = $derived(session.meetRequests.filter((r) => r.status === 'waiting'));
	const openSeats = $derived(session.seats.filter((s) => !s.user_id).length);

	const winState = $derived(checkWinCondition(session.seats, session.roles, script));
	const votes = $derived(voteState(session.seats));
	// Only surface the win check once the game is actually being played — not
	// during lobby setup (before roles/seats have settled) or after the
	// Storyteller has already ended it.
	const showWinBanner = $derived(
		winState.winner !== null &&
			session.game?.phase_kind !== 'lobby' &&
			session.game?.phase_kind !== 'ended'
	);

	function endGame() {
		return run(
			phaseRpc.set(supabase, gameId, 'ended', session.phase?.cycle ?? 1, 0)
		);
	}

	const TEAM_ORDER: Team[] = ['townsfolk', 'outsider', 'minion', 'demon', 'traveller', 'fabled'];
	const byTeam = $derived(
		TEAM_ORDER.map((t) => ({
			team: t,
			chars: (script?.characters ?? []).filter((c) => c.team === t)
		})).filter((g) => g.chars.length)
	);

	function roleName(seatId: string): string | null {
		const id = session.roleFor(seatId);
		if (!id || !script) return null;
		return script.characters.find((c) => c.id === id)?.name ?? id;
	}

	async function run(p: PromiseLike<{ error: unknown }>) {
		actionError = null;
		const { error } = await p;
		if (error) actionError = error instanceof Error ? error.message : String(error);
	}

	function advance() {
		const target = session.phase
			? nextPhase(session.phase, 0, 0)
			: { kind: 'night' as const, cycle: 1 };
		return run(phaseRpc.set(supabase, gameId, target.kind, target.cycle, minutes * 60_000));
	}
	const togglePause = () =>
		run(session.paused ? phaseRpc.resume(supabase, gameId) : phaseRpc.pause(supabase, gameId));
	const nudge = (m: number) => run(phaseRpc.adjust(supabase, gameId, m * 60_000));
	const toggleGather = () =>
		run(phaseRpc.gather(supabase, gameId, !session.game?.gather, gatherReason.trim() || null));

	async function copyCode() {
		if (!session.game) return;
		try {
			await navigator.clipboard.writeText(session.game.join_code);
			codeCopied = true;
			setTimeout(() => (codeCopied = false), 1500);
		} catch {
			/* clipboard blocked — the code is right there on screen to read out */
		}
	}

	async function dealRoles() {
		if (!script) return;
		dealing = true;
		dealMsg = null;
		const result = dealGame(script, session.seats);
		const { error } = await applyDeal(supabase, gameId, result);
		if (error) {
			dealMsg = 'Deal failed: ' + (error instanceof Error ? error.message : String(error));
		} else {
			const { comp, redHerringSeatId } = result;
			dealMsg =
				`Dealt ${result.assignments.size} roles — ${comp.townsfolk} Townsfolk / ${comp.outsider} Outsider / ${comp.minion} Minion / ${comp.demon} Demon` +
				(redHerringSeatId ? ' · Fortune Teller red herring set.' : '.');
		}
		dealing = false;
	}

	function clickKick(seatId: string) {
		if (confirmingKick !== seatId) {
			confirmingKick = seatId;
			setTimeout(() => {
				if (confirmingKick === seatId) confirmingKick = null;
			}, 4000);
			return;
		}
		confirmingKick = null;
		run(kickSeat(supabase, seatId));
	}
</script>

<div class="stack">
	{#if session.error}
		<div class="card error">{session.error}</div>
	{:else if !session.game}
		<p class="muted">Loading…</p>
	{:else}
		<header class="stack" style="gap:0.35rem">
			<p class="muted">Storyteller · {script?.name ?? session.game.script_id}</p>
			<div class="row" style="align-items:baseline;justify-content:space-between">
				<h1 style="margin:0">
					Code
					<span style="color:var(--accent);letter-spacing:0.15em">{session.game.join_code}</span>
				</h1>
				<button onclick={copyCode}>{codeCopied ? 'Copied!' : 'Copy code'}</button>
			</div>
			<p class="muted">
				{session.claimedSeats} / {session.seats.length} seats claimed
				{#if openSeats}· {openSeats} open{/if}
				{#if !serverTimeSynced()}
					· <span class="error">clock not synced</span>
				{/if}
			</p>
		</header>

		{#if showWinBanner}
			<section class="card win-banner {winState.winner}">
				<strong>{winState.winner === 'good' ? 'Good wins' : 'Evil wins'}</strong>
				<p style="margin:0.2rem 0 0">{winState.reason}</p>
				{#if winState.winner === 'evil' && winState.aliveDemons.length}
					<p class="muted" style="margin:0.2rem 0 0">
						Still alive: {winState.aliveDemons.map((d) => d.seatName).join(', ')}
					</p>
				{/if}
				<button class="primary" style="margin-top:0.5rem" onclick={endGame}>
					Announce &amp; end game
				</button>
			</section>
		{/if}

		<nav class="tabs">
			<button class:active={tab === 'clock'} onclick={() => (tab = 'clock')}>Clock</button>
			<button class:active={tab === 'seats'} onclick={() => (tab = 'seats')}>Seats</button>
			<button class:active={tab === 'night'} onclick={() => (tab = 'night')}>Night</button>
			<button class:active={tab === 'requests'} onclick={() => (tab = 'requests')}>
				Requests{#if waiting.length} <span class="badge">{waiting.length}</span>{/if}
			</button>
		</nav>

		{#if tab === 'clock'}
			<section class="card"><ClockFace {session} /></section>
			<section class="card stack">
				<div>
					<label for="mins">Next phase length (minutes)</label>
					<input id="mins" type="number" min="0" max="120" bind:value={minutes} />
				</div>
				<button class="primary" onclick={advance}>Advance to {nextLabel}</button>
				<div class="row">
					<button onclick={togglePause} style="flex:1">
						{session.paused ? 'Resume' : 'Pause'}
					</button>
					<button onclick={() => nudge(-1)}>&minus;1 min</button>
					<button onclick={() => nudge(1)}>+1 min</button>
				</div>
			</section>
			<section class="card stack">
				<label for="reason">Gather signal</label>
				<input id="reason" bind:value={gatherReason} placeholder="reason (optional)" />
				<button
					onclick={toggleGather}
					class:primary={!session.game.gather}
					style={session.game.gather ? 'border-color:var(--danger);color:var(--danger)' : ''}
				>
					{session.game.gather ? 'Clear gather signal' : 'Call everyone to gather'}
				</button>
			</section>
		{:else if tab === 'seats'}
			<section class="card">
				<Circle seats={session.seats} labelFor={(s) => roleName(s.id)} />
			</section>
			<section class="card stack">
				<div class="row" style="justify-content:space-between;align-items:center">
					<strong>Deal roles</strong>
					<button class="primary" onclick={dealRoles} disabled={dealing}>
						{dealing ? 'Dealing…' : 'Deal random roles'}
					</button>
				</div>
				<p class="muted" style="margin:0">
					Randomly assigns every seated character for {session.seats.length} players, applies
					Baron's setup swing when it's drawn, and sets the Fortune Teller's red herring.
					Re-dealing replaces the current assignment and clears tonight's dispatch.
				</p>
				{#if dealMsg}<p class="muted" style="margin:0">{dealMsg}</p>{/if}
			</section>
			<section class="card stack">
				<strong>Voting</strong>
				<p class="muted" style="margin:0">
					{votes.aliveCount} alive · needs <strong>{votes.votesToExecute}</strong> votes to execute
					{#if votes.ghostVoteSeats.length}
						· {votes.ghostVoteSeats.length} ghost
						{votes.ghostVoteSeats.length === 1 ? 'vote' : 'votes'} still available ({votes.ghostVoteSeats
							.map((g) => g.seatName)
							.join(', ')})
					{/if}
				</p>
			</section>
			<section class="stack">
				{#each session.seats as seat, i (seat.id)}
					<div class="card seatrow" class:open={!seat.user_id}>
						<div class="row" style="align-items:center;flex-wrap:nowrap">
							<span class="ix">{seat.seat_index + 1}</span>
							<Avatar characterId={session.roleFor(seat.id)} size="sm" />
							<input
								value={seat.name}
								placeholder={seat.user_id ? 'name' : '— open seat —'}
								onchange={(e) => run(setSeatName(supabase, seat.id, e.currentTarget.value))}
							/>
							<button
								onclick={() => run(setSeatAlive(supabase, seat.id, !seat.alive))}
								title={seat.alive ? 'mark dead' : 'revive'}
							>
								{seat.alive ? 'Alive' : 'Dead'}
							</button>
						</div>
						{#if !seat.alive}
							<button
								class="ghostvote"
								onclick={() =>
									run(setGhostVoteAvailable(supabase, seat.id, !seat.ghost_vote_available))}
								title="Toggle whether this seat's ghost vote has been used"
							>
								Ghost vote: {seat.ghost_vote_available ? 'available' : 'used'}
							</button>
						{/if}
						<select
							value={session.roleFor(seat.id) ?? ''}
							onchange={(e) =>
								run(assignRole(supabase, gameId, seat.id, e.currentTarget.value || null))}
						>
							<option value="">— no character —</option>
							{#each byTeam as g (g.team)}
								<optgroup label={g.team}>
									{#each g.chars as c (c.id)}
										<option value={c.id}>{c.name}</option>
									{/each}
								</optgroup>
							{/each}
						</select>
						<div class="row" style="justify-content:space-between">
							<div class="row" style="gap:0.35rem">
								<button
									onclick={() => run(moveSeat(supabase, seat.id, 'up'))}
									disabled={session.seats.length < 2}
									title="Swap with the previous seat"
								>
									&uarr; move
								</button>
								<button
									onclick={() => run(moveSeat(supabase, seat.id, 'down'))}
									disabled={session.seats.length < 2}
									title="Swap with the next seat"
								>
									&darr; move
								</button>
							</div>
							{#if seat.user_id}
								<button class="danger" onclick={() => clickKick(seat.id)}>
									{confirmingKick === seat.id ? 'Tap again to remove' : 'Remove from seat'}
								</button>
							{:else}
								<span class="muted" style="font-size:0.78rem">open — waiting for a join</span>
							{/if}
						</div>
					</div>
				{/each}
			</section>
		{:else if tab === 'night'}
			<section class="stack">
				<NightDispatch {session} {gameId} />
			</section>
		{:else}
			<section class="stack">
				{#if waiting.length === 0}
					<p class="muted">No one is waiting.</p>
				{/if}
				{#each waiting as req, i (req.id)}
					{@const seat = session.seats.find((s) => s.id === req.seat_id)}
					<div class="card stack" style="gap:0.5rem">
						<div>
							<strong>#{i + 1} · {seat?.name ?? 'Unknown'}</strong>
							{#if req.reason}<div class="muted">{req.reason}</div>{/if}
						</div>
						<div class="row">
							<button class="primary" onclick={() => run(resolveMeet(supabase, req.id, 'met'))}>
								Met
							</button>
							<button onclick={() => run(resolveMeet(supabase, req.id, 'dismissed'))}>
								Dismiss
							</button>
						</div>
					</div>
				{/each}
			</section>
		{/if}

		{#if actionError}<p class="error">{actionError}</p>{/if}
	{/if}
</div>

<style>
	.tabs {
		display: flex;
		gap: 0.4rem;
	}
	.tabs button {
		flex: 1;
		padding: 0.5rem;
		font-size: 0.9rem;
	}
	.tabs button.active {
		border-color: var(--accent);
		color: var(--accent);
	}
	.badge {
		display: inline-block;
		min-width: 1.2rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: var(--danger);
		color: #fff;
		font-size: 0.75rem;
	}
	.seatrow {
		gap: 0.5rem;
		display: flex;
		flex-direction: column;
	}
	.seatrow.open {
		opacity: 0.75;
		border-style: dashed;
	}
	.seatrow .ix {
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
		width: 1.4rem;
		text-align: right;
	}
	.seatrow input {
		flex: 1;
	}
	.win-banner {
		text-align: center;
		border-width: 2px;
	}
	.win-banner.good {
		border-color: var(--night);
		color: var(--night);
	}
	.win-banner.evil {
		border-color: var(--danger);
		color: var(--danger);
	}
	.win-banner p {
		color: var(--text);
	}
	.ghostvote {
		align-self: flex-start;
		font-size: 0.78rem;
		padding: 0.2rem 0.5rem;
	}
</style>
