<script lang="ts">
	import { serverTimeSynced } from '$lib/server-time';
	import { GameSession } from '$lib/game.svelte';
	import { getScript, getCharacter } from '$lib/scripts';
	import { voteState } from '$lib/scripts/winCondition';
	import { requestMeet, leaveSeat, submitNightChoice, castVote, retractVote } from '$lib/actions';
	import Circle from './Circle.svelte';
	import ClockFace from './ClockFace.svelte';
	import InfoDrawer from './InfoDrawer.svelte';
	import Avatar from './Avatar.svelte';

	interface Props {
		session: GameSession;
		gameId: string;
	}
	let { session, gameId }: Props = $props();

	let infoOpen = $state(false);
	let meetReason = $state('');
	let lastGather = $state(false);
	let actionError = $state<string | null>(null);
	let confirmingLeave = $state(false);
	let leaveTimer: ReturnType<typeof setTimeout> | null = null;
	let selectedSeatIds = $state<string[]>([]);
	let newNightInfo = $state(false);
	let newNightInfoTimer: ReturnType<typeof setTimeout> | null = null;

	const script = $derived(session.game ? getScript(session.game.script_id) : undefined);
	const roleChar = $derived(
		script && session.myRole ? getCharacter(script, session.myRole) : undefined
	);
	// ---- tonight's info / choice, if this character has something to do ----
	const nightRow = $derived(session.myNightAction);
	const actsTonight = $derived.by(() => {
		if (!roleChar || session.phase?.kind !== 'night') return false;
		const isFirst = session.phase.cycle <= 1;
		return (isFirst ? roleChar.firstNight : roleChar.otherNight) != null;
	});
	const maxChoice = $derived(roleChar?.prompt.kind === 'choose' ? roleChar.prompt.count : 1);
	const choiceSeatIds = $derived((nightRow?.choices as string[] | null) ?? []);
	const chosenSeatIds = $derived.by(() => {
		if (!nightRow?.result) return null;
		try {
			const v = JSON.parse(nightRow.result);
			return Array.isArray(v) ? (v as string[]) : null;
		} catch {
			return null;
		}
	});

	$effect(() => {
		void nightRow?.id;
		selectedSeatIds = [];
	});

	function toggleChoice(seatId: string) {
		if (selectedSeatIds.includes(seatId)) {
			selectedSeatIds = selectedSeatIds.filter((id) => id !== seatId);
		} else if (selectedSeatIds.length < maxChoice) {
			selectedSeatIds = [...selectedSeatIds, seatId];
		}
	}

	async function submitChoice() {
		if (!nightRow) return;
		actionError = null;
		const { error } = await submitNightChoice(session.client, nightRow.id, selectedSeatIds);
		if (error) actionError = error.message;
	}
	// ---- nomination / voting ----
	const nom = $derived(session.latestNomination);
	const nomVotes = $derived(session.votesForLatest);
	const nomThreshold = $derived(voteState(session.seats).votesToExecute);
	const nomineeName = $derived(
		nom ? (session.seats.find((s) => s.id === nom.nominee_seat_id)?.name ?? '?') : ''
	);
	const nominatorName = $derived(
		nom?.nominator_seat_id
			? (session.seats.find((s) => s.id === nom.nominator_seat_id)?.name ?? null)
			: null
	);
	const canVote = $derived(
		session.mySeat && (session.mySeat.alive || session.mySeat.ghost_vote_available)
	);
	let voting = $state(false);
	async function toggleVote() {
		if (!nom) return;
		voting = true;
		actionError = null;
		const { error } = session.myVoteCast
			? await retractVote(session.client, nom.id)
			: await castVote(session.client, nom.id);
		if (error) actionError = error instanceof Error ? error.message : String(error);
		voting = false;
	}

	// Buzz once when a nomination newly opens or moves into voting — the
	// point of doing this on the phone at all, for a party spread out beyond
	// earshot of "I nominate...".
	let sawNomination = false;
	let lastNomSig = '';
	$effect(() => {
		const sig = nom ? `${nom.id}:${nom.stage}` : '';
		if (!sawNomination) {
			sawNomination = true;
			lastNomSig = sig;
			return;
		}
		if (sig !== lastNomSig && sig !== '') buzz();
		lastNomSig = sig;
	});

	const neighbourIds = $derived(
		[session.myNeighbours.ccw?.id, session.myNeighbours.cw?.id].filter(Boolean) as string[]
	);
	const neighbourNames = $derived(
		neighbourIds
			.map((id) => session.seats.find((s) => s.id === id)?.name)
			.filter(Boolean)
			.join(' and ')
	);
	const myOpenRequest = $derived(
		session.mySeat
			? session.meetRequests.find(
					(r) => r.seat_id === session.mySeat!.id && r.status === 'waiting'
				)
			: undefined
	);
	const queuePosition = $derived(
		myOpenRequest
			? session.meetRequests
					.filter((r) => r.status === 'waiting')
					.findIndex((r) => r.id === myOpenRequest!.id) + 1
			: 0
	);

	$effect(() => {
		const on = session.game?.gather ?? false;
		if (on && !lastGather) buzz();
		lastGather = on;
	});

	// Let a player know the Storyteller released (or updated) their night
	// info without them having to keep checking the screen — skip the
	// baseline captured on first load/mount so a reconnect doesn't re-buzz
	// for information they've already seen.
	let sawNightInfo = false;
	let lastNightSig = '';
	$effect(() => {
		const sig = nightRow ? `${nightRow.id}:${nightRow.result ?? ''}:${nightRow.prompt ?? ''}` : '';
		if (!sawNightInfo) {
			sawNightInfo = true;
			lastNightSig = sig;
			return;
		}
		if (sig !== lastNightSig && sig !== '') {
			buzz();
			newNightInfo = true;
			if (newNightInfoTimer) clearTimeout(newNightInfoTimer);
			newNightInfoTimer = setTimeout(() => (newNightInfo = false), 5000);
		}
		lastNightSig = sig;
	});

	function buzz() {
		navigator.vibrate?.([200, 100, 200, 100, 200]);
		try {
			const ctx = new AudioContext();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.frequency.value = 660;
			gain.gain.value = 0.06;
			osc.connect(gain).connect(ctx.destination);
			osc.start();
			osc.stop(ctx.currentTime + 0.5);
		} catch {
			/* audio may be blocked until first interaction */
		}
	}

	async function askToMeet() {
		if (!session.mySeat) return;
		actionError = null;
		const { error } = await requestMeet(
			session.client,
			gameId,
			session.mySeat.id,
			meetReason.trim() || null
		);
		if (error) actionError = error.message;
		else meetReason = '';
	}

	function clickLeave() {
		if (!confirmingLeave) {
			confirmingLeave = true;
			leaveTimer = setTimeout(() => (confirmingLeave = false), 4000);
			return;
		}
		if (leaveTimer) clearTimeout(leaveTimer);
		confirmingLeave = false;
		doLeave();
	}

	async function doLeave() {
		if (!session.mySeat) return;
		actionError = null;
		const { error } = await leaveSeat(session.client, session.mySeat.id);
		if (error) actionError = error instanceof Error ? error.message : String(error);
	}
</script>

<div class="stack">
	{#if session.error}
		<div class="card error">{session.error}</div>
	{:else if !session.game}
		<p class="muted">Loading…</p>
	{:else}
		{#if session.game.gather}
			<div class="card gather">
				<h2>Gather</h2>
				{#if session.game.gather_reason}<p style="margin:0">{session.game.gather_reason}</p>{/if}
			</div>
		{/if}

		<header class="row" style="justify-content:space-between;align-items:baseline">
			<span class="muted">{script?.name ?? session.game.script_id}</span>
			<button onclick={() => (infoOpen = true)}>Info</button>
		</header>

		<section class="card">
			<ClockFace {session} />
		</section>

		{#if !session.mySeat}
			<div class="card muted">You're not seated in this game. Go back and join with the code.</div>
		{:else}
			<section class="card stack">
				{#if roleChar}
					<div class="row" style="align-items:center">
						<Avatar characterId={roleChar.id} size="lg" label={roleChar.name} />
						<div>
							<span class="muted">You are the</span>
							<h2 style="margin:0.1rem 0">{roleChar.name}</h2>
							<span class="team-tag {roleChar.team}">{roleChar.team}</span>
						</div>
					</div>
					<p style="margin:0">{roleChar.summary}</p>
				{:else}
					<p class="muted" style="margin:0">The Storyteller hasn't dealt roles yet.</p>
				{/if}
			</section>

			{#if nom}
				<section class="card stack nom-card">
					<strong>Nomination</strong>
					<p style="margin:0">
						<strong>{nomineeName}</strong> has been nominated{#if nominatorName}
							by <strong>{nominatorName}</strong>{/if}.
					</p>
					{#if nom.stage === 'debate'}
						<p class="muted" style="margin:0">Debate — listen up.</p>
					{:else if nom.stage === 'voting'}
						<p class="muted" style="margin:0">
							{nomVotes.length} of {nomThreshold} needed
						</p>
						{#if session.mySeat}
							<button
								class="primary"
								disabled={!canVote || voting}
								onclick={toggleVote}
							>
								{session.myVoteCast ? 'Lower hand' : '✋ Raise hand to vote'}
							</button>
							{#if !canVote}
								<p class="muted" style="margin:0;font-size:0.8rem">
									You've used your ghost vote for the rest of the game.
								</p>
							{/if}
						{/if}
					{:else}
						<p class="muted" style="margin:0">
							{nomVotes.length} of {nomThreshold} needed
							{nom.executed ? `— ${nomineeName} was executed.` : '— no execution.'}
						</p>
					{/if}
				</section>
			{/if}

			{#if actsTonight}
				<section class="card stack night-card" class:pulsing={newNightInfo}>
					<div class="row" style="justify-content:space-between;align-items:center">
						<strong>Tonight</strong>
						{#if newNightInfo}<span class="new-badge">New</span>{/if}
					</div>
					{#if roleChar?.prompt.kind === 'grimoire'}
						{#if nightRow?.result}
							<p class="grimoire-snapshot">{nightRow.result}</p>
						{:else}
							<p class="muted" style="margin:0">
								The Storyteller will show you the grimoire tonight — nothing to do here, just wait
								for it.
							</p>
						{/if}
					{:else if !nightRow}
						<p class="muted" style="margin:0">Waiting for the Storyteller…</p>
					{:else if roleChar?.prompt.kind === 'choose'}
						{#if chosenSeatIds}
							<p style="margin:0">
								You chose: <strong
									>{chosenSeatIds
										.map((id) => session.seats.find((s) => s.id === id)?.name ?? '?')
										.join(' and ')}</strong
								>
							</p>
						{:else}
							<p style="margin:0">{nightRow.prompt}</p>
							<div class="choice-grid">
								{#each choiceSeatIds as id (id)}
									{@const s = session.seats.find((x) => x.id === id)}
									<button
										class="choice-seat"
										class:selected={selectedSeatIds.includes(id)}
										onclick={() => toggleChoice(id)}
									>
										{s?.name ?? '?'}
									</button>
								{/each}
							</div>
							<button class="primary" disabled={selectedSeatIds.length === 0} onclick={submitChoice}>
								Confirm choice
							</button>
						{/if}
					{:else if nightRow.result}
						<p style="margin:0"><strong>{nightRow.result}</strong></p>
					{:else}
						<p class="muted" style="margin:0">Waiting for the Storyteller…</p>
					{/if}
				</section>
			{/if}

			<section class="card stack">
				<Circle seats={session.seats} meSeatId={session.mySeat.id} highlightIds={neighbourIds} />
				<p class="muted" style="text-align:center;margin:0">
					{#if neighbourNames}
						Your living neighbours: <strong>{neighbourNames}</strong>
					{:else}
						No living neighbours.
					{/if}
				</p>
			</section>

			<section class="card stack">
				{#if myOpenRequest}
					<p style="margin:0">
						Waiting to see the Storyteller — you're <strong>#{queuePosition}</strong> in line.
					</p>
				{:else}
					<label for="meet">Ask to see the Storyteller</label>
					<input id="meet" bind:value={meetReason} placeholder="reason (optional)" />
					<button onclick={askToMeet}>Ask to see the Storyteller</button>
				{/if}
			</section>

			<div class="fleuron"></div>

			<section class="row" style="justify-content:flex-end">
				<button class="danger" onclick={clickLeave}>
					{confirmingLeave ? 'Tap again to confirm leaving' : 'Leave my seat'}
				</button>
			</section>

			{#if actionError}<p class="error">{actionError}</p>{/if}
		{/if}

		{#if !serverTimeSynced()}
			<p class="error">Clock not synced with the server — countdown may be off.</p>
		{/if}
	{/if}
</div>

<InfoDrawer {script} open={infoOpen} onclose={() => (infoOpen = false)} />

<style>
	.night-card {
		border-left: 3px solid var(--accent);
		transition: box-shadow 0.4s ease;
	}
	.night-card.pulsing {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent);
	}
	.new-badge {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--bg);
		background: var(--accent);
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		animation: fade-in 0.2s ease;
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.choice-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.choice-seat {
		flex: 1 1 auto;
		min-width: 6rem;
	}
	.choice-seat.selected {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 18%, var(--surface-2));
	}
	.gather {
		border-color: var(--danger);
		text-align: center;
	}
	.gather h2 {
		margin: 0.2rem 0;
		color: var(--danger);
	}
	.team-tag {
		display: inline-block;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		border: 1px solid currentColor;
	}
	.team-tag.townsfolk {
		color: var(--night);
	}
	.team-tag.outsider {
		color: var(--accent);
	}
	.team-tag.minion,
	.team-tag.demon {
		color: var(--danger);
	}
	.grimoire-snapshot {
		margin: 0;
		white-space: pre-wrap;
		font-size: 0.9rem;
	}
	.nom-card {
		border-left: 3px solid var(--danger);
	}
</style>
