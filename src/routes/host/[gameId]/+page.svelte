<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { supabase, ensureSignedIn } from '$lib/supabase';
	import { serverTimeSynced, currentOffset } from '$lib/server-time';
	import { GameSession } from '$lib/game.svelte';
	import { nextPhase, phaseLabel, formatClock } from '$lib/clock';
	import { getScript, getCharacter, findCharacterAnywhere, SCRIPTS } from '$lib/scripts';
	import { applyScriptTheme } from '$lib/scriptTheme';
	import { dealGame } from '$lib/scripts/deal';
	import { checkWinCondition, voteState } from '$lib/scripts/winCondition';
	import { checkVirgin } from '$lib/scripts/virgin';
	import { savantPrep, fishermanPrep, ARTIST_GUIDANCE } from '$lib/dayAsk';
	import {
		AMNESIAC_ABILITIES,
		encodeAmnesiacNote,
		parseAmnesiacNote,
		type AmnesiacAssignment
	} from '$lib/scripts/amnesiac-abilities';
	import {
		encodeCannibalNote,
		parseCannibalNote,
		type CannibalAssignment
	} from '$lib/scripts/cannibal';
	import { poisonStatus, addToken, removeToken } from '$lib/poison';
	import {
		phase as phaseRpc,
		applyDeal,
		assignRole,
		setSeatName,
		setSeatAlive,
		setGhostVoteAvailable,
		setDrunk,
		clearDrunk,
		setRedHerring,
		clearRedHerring,
		setGrimoireNote,
		resolveMeet,
		moveSeat,
		kickSeat,
		openNomination,
		startVoting,
		closeNomination,
		markExecuted,
		dismissNomination,
		resolveVirgin,
		setSeatTokens
	} from '$lib/actions';
	import type { Team } from '$lib/types';
	import Circle from '$lib/components/Circle.svelte';
	import ClockFace from '$lib/components/ClockFace.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import NightDispatch from '$lib/components/NightDispatch.svelte';

	const gameId = page.params.gameId!;
	const session = new GameSession();

	type Tab = 'clock' | 'seats' | 'night' | 'vote' | 'requests';
	let tab = $state<Tab>('clock');
	let minutes = $state(12);
	let gatherReason = $state('');
	let actionError = $state<string | null>(null);
	let codeCopied = $state(false);
	let confirmingKick = $state<string | null>(null);
	let dealing = $state(false);
	let dealMsg = $state<string | null>(null);
	/** Staged text for the Amnesiac's free-text ability box — see
	 * setAmnesiacCustomText() below. Keyed by seatId. */
	let amnesiacDraft = $state<Record<string, string>>({});
	/** Bumps savantPrep()/fishermanPrep()'s `variant` for a seat, so the
	 * "🔁 New options" button in the Requests tab actually reshuffles
	 * instead of showing the same worked pair every time. */
	let dayAskVariant = $state<Record<string, number>>({});
	/** How many of the Savant's two statements should be true today — see
	 * savantPrep()'s truthCount param. 1 = normal (one true, one false);
	 * 0 or 2 are for a poisoned/drunk Savant. Keyed by seatId, defaults to
	 * the normal case. */
	let savantTruthCount = $state<Record<string, 0 | 1 | 2>>({});
	/** null = the Night tab shows the real, live night; a number previews
	 * that night instead (read-only for sending, but "plan ahead" notes can
	 * still be written — see NightDispatch's prep-notes support). */
	let planNight = $state<number | null>(null);

	onMount(() => {
		ensureSignedIn().then(() => session.start(gameId));
		return () => session.stop();
	});

	const script = $derived(session.game ? getScript(session.game.script_id) : undefined);
	// Steampunk theme for Laissez un Faire, gothic for everything else --
	// see src/lib/scriptTheme.ts. Resets on unmount (leaving the game).
	$effect(() => applyScriptTheme(session.game?.script_id));
	const nextLabel = $derived(
		session.phase ? phaseLabel(nextPhase(session.phase, 0, 0)) : 'Night 1'
	);
	const waiting = $derived(session.meetRequests.filter((r) => r.status === 'waiting'));
	const openSeats = $derived(session.seats.filter((s) => !s.user_id).length);

	const winState = $derived(checkWinCondition(session.seats, session.roles, script));
	const votes = $derived(voteState(session.seats));

	// ---- nominations / voting ----
	let nomineeSeatId = $state('');
	let nominatorSeatId = $state('');
	let debateSeconds = $state(60);
	const livingClaimed = $derived(session.seats.filter((s) => s.user_id && s.alive));
	const openNom = $derived(session.openNomination);
	const latestNom = $derived(session.latestNomination);
	const latestVotes = $derived(session.votesForLatest);
	const todaysNominations = $derived(
		session.nominations.filter((n) => n.cycle === (session.phase?.cycle ?? -1))
	);
	function seatById(id: string | null): (typeof session.seats)[number] | undefined {
		return id ? session.seats.find((s) => s.id === id) : undefined;
	}
	function seatLabel(id: string | null): string {
		const s = seatById(id);
		return s ? s.name || `Seat ${s.seat_index + 1}` : '—';
	}
	function doOpenNomination() {
		if (!nomineeSeatId) return;
		run(
			openNomination(
				supabase,
				gameId,
				nomineeSeatId,
				nominatorSeatId || null,
				debateSeconds > 0 ? debateSeconds : null
			)
		).then(() => (nomineeSeatId = ''));
	}
	async function executeNominee() {
		if (!latestNom) return;
		await run(setSeatAlive(supabase, latestNom.nominee_seat_id, false));
		await run(markExecuted(supabase, latestNom.id));
	}
	const virginCheck = $derived(
		openNom ? checkVirgin(openNom, session.nominations, session.roles, script) : null
	);
	/** Mirrors NightDispatch's own `actualNight` derivation — needed here too,
	 * for the "plan ahead" night picker in the Night tab below. */
	const nightTabActualNight = $derived(
		session.phase?.kind === 'night' || session.phase?.kind === 'day' ? session.phase.cycle : null
	);
	/** "1:23" / "+0:07 over" — see GameSession.debateRemainingMs. Null hides
	 * the whole timer line (no debate timer set, or nothing's in debate). */
	const debateDisplay = $derived.by(() => {
		const ms = session.debateRemainingMs;
		if (ms == null) return null;
		return formatClock({ running: true, elapsedMs: 0, remainingMs: ms, overrun: ms < 0 });
	});
	const debateOverrun = $derived((session.debateRemainingMs ?? 0) < 0);
	async function fireVirgin() {
		if (!openNom) return;
		await run(resolveVirgin(supabase, openNom.id));
	}
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
	// 'drunk' is deliberately left out of the assignable dropdown: picking it
	// there would set seat_roles directly to 'drunk', which is exactly what
	// that seat's own screen reads to show its role — instantly telling the
	// player the truth. Use "Make Drunk" on the seat row instead, which
	// assigns a fake Townsfolk and records the real identity separately in
	// grimoire (Storyteller-only).
	const byTeam = $derived(
		TEAM_ORDER.map((t) => ({
			team: t,
			chars: (script?.characters ?? []).filter((c) => c.team === t && c.id !== 'drunk')
		})).filter((g) => g.chars.length)
	);

	function roleName(seatId: string): string | null {
		const id = session.roleFor(seatId);
		if (!id || !script) return null;
		return script.characters.find((c) => c.id === id)?.name ?? id;
	}

	function seatName(seatId: string): string {
		const seat = session.seats.find((s) => s.id === seatId);
		return seat?.name || `Seat ${(seat?.seat_index ?? 0) + 1}`;
	}

	function isDrunk(seatId: string): boolean {
		return session.grimoire.find((g) => g.seat_id === seatId)?.real_character_id === 'drunk';
	}

	function isRedHerring(seatId: string): boolean {
		return session.redHerringSeatId === seatId;
	}

	/** Drunk/red herring are Trouble Brewing-specific mechanics (there's no
	 * Drunk or Fortune Teller in Laissez un Faire) — hide the "Make Drunk" /
	 * "Make red herring" controls entirely on a script that doesn't have
	 * them, rather than showing dead buttons on every seat regardless of
	 * script ("they are redundant" on the new script). */
	const scriptHasDrunk = $derived(script?.characters.some((c) => c.id === 'drunk') ?? false);
	const scriptHasRedHerring = $derived(script?.characters.some((c) => c.redHerring) ?? false);

	/** Everyone this app knows about, for the Amnesiac's "secretly IS another
	 * character" picker — deliberately not limited to the current script
	 * (see findCharacterAnywhere's own doc comment), deduped by id, sorted
	 * for a sane dropdown. Excludes drunk/amnesiac themselves. */
	const mimicChoices = $derived(
		[
			...new Map(
				SCRIPTS.flatMap((s) => s.characters)
					// Evil-team characters excluded: mimicking one would surface
					// that character's REAL night-1 evil reveal on the Amnesiac's
					// dispatch card if the same character id is genuinely in play
					// (night1EvilReveals() keys off character id, not seat) — and a
					// Townsfolk secretly being handed an evil ability doesn't fit
					// the character anyway.
					.filter(
						(c) => c.id !== 'amnesiac' && c.id !== 'drunk' && c.team !== 'demon' && c.team !== 'minion'
					)
					.map((c) => [c.id, c] as const)
			).values()
		].sort((a, b) => a.name.localeCompare(b.name))
	);

	function amnesiacInfo(seatId: string): AmnesiacAssignment | null {
		return parseAmnesiacNote(session.grimoire.find((g) => g.seat_id === seatId)?.notes);
	}

	/** Plain ability text for wherever this app already shows it (the day-guess
	 * reminder in the Requests tab) — unaffected by whether it's mimicked or
	 * free-written, both always carry a human-readable `text`. */
	function amnesiacAbility(seatId: string): string | null {
		return amnesiacInfo(seatId)?.text ?? null;
	}

	function mimicName(characterId: string): string {
		return findCharacterAnywhere(characterId)?.name ?? characterId;
	}

	async function saveAmnesiacInfo(seatId: string, info: AmnesiacAssignment) {
		await run(setGrimoireNote(supabase, gameId, seatId, encodeAmnesiacNote(info)));
	}

	/** Picked from the prewritten list, or the "🎲 Random" button below — a
	 * flavour ability the Storyteller runs by hand, same as before this
	 * session's changes. Clears any mimic, since the two are alternatives. */
	async function setAmnesiacPrewritten(seatId: string, text: string) {
		if (!text) return;
		amnesiacDraft[seatId] = text;
		await saveAmnesiacInfo(seatId, { text, mimics: null });
	}

	async function randomAmnesiacAbility(seatId: string) {
		const pick = AMNESIAC_ABILITIES[Math.floor(Math.random() * AMNESIAC_ABILITIES.length)];
		if (pick) await setAmnesiacPrewritten(seatId, pick.text);
	}

	/** The Amnesiac secretly IS this character — NightDispatch.svelte then
	 * gives this seat a real nightly wake step using that character's own
	 * mechanics (automatic info candidates when it has any), instead of the
	 * Storyteller improvising free text. Passing null clears it back to a
	 * plain text-only ability. */
	async function setAmnesiacMimic(seatId: string, characterId: string | null) {
		if (!characterId) {
			await saveAmnesiacInfo(seatId, { text: amnesiacInfo(seatId)?.text ?? '', mimics: null });
			return;
		}
		const mimicked = findCharacterAnywhere(characterId);
		const text = mimicked
			? `Secretly the ${mimicked.name}: ${mimicked.summary}`
			: (amnesiacInfo(seatId)?.text ?? '');
		amnesiacDraft[seatId] = text;
		await saveAmnesiacInfo(seatId, { text, mimics: characterId });
	}

	/** The Storyteller's own hand-written ability text — clears any mimic,
	 * since a mimicked assignment's text is generated from the mimicked
	 * character and shouldn't be edited out from under it. */
	async function setAmnesiacCustomText(seatId: string, text: string) {
		const trimmed = text.trim();
		if (!trimmed) return;
		await saveAmnesiacInfo(seatId, { text: trimmed, mimics: null });
	}

	function cannibalInfo(seatId: string): CannibalAssignment | null {
		return parseCannibalNote(session.grimoire.find((g) => g.seat_id === seatId)?.notes);
	}

	/** The most recently executed player, and whether their true character
	 * was evil — evil characters are stored truly in seat_roles (there's no
	 * bluffing data structure; only the Drunk fakes a Townsfolk), so
	 * roleFor() already gives the Cannibal's honest default meal. Used to
	 * drive the "inherit ___" prompt on the Cannibal's own seat row. */
	const lastExecuted = $derived.by(() => {
		const executed = [...session.nominations]
			.filter((n) => n.executed)
			.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
		if (!executed) return null;
		const seatId = executed.nominee_seat_id;
		const charId = session.roleFor(seatId);
		const char = charId ? findCharacterAnywhere(charId) : null;
		const evil = char?.team === 'minion' || char?.team === 'demon';
		return { seatId, charId, char, evil };
	});

	async function saveCannibalInfo(seatId: string, info: CannibalAssignment) {
		await run(setGrimoireNote(supabase, gameId, seatId, encodeCannibalNote(info)));
	}

	async function poisonCannibal(seatId: string) {
		const existing = session.grimoire.find((g) => g.seat_id === seatId)?.tokens;
		await run(setSeatTokens(supabase, gameId, seatId, addToken(existing, { kind: 'poisoned', source: 'cannibal' })));
	}

	async function clearCannibalPoison(seatId: string) {
		const existing = session.grimoire.find((g) => g.seat_id === seatId)?.tokens;
		await run(setSeatTokens(supabase, gameId, seatId, removeToken(existing, 'poisoned', 'cannibal')));
	}

	/** Default: inherit the last executed player's true character and true
	 * ability, exactly as written ("other than that the cannibal should just
	 * inherit the role"). Poisons automatically when that true character was
	 * evil, since the Cannibal has then inherited an evil ability even
	 * though — per the override below — the group may only ever be told the
	 * bluffed cover story. */
	async function inheritExecuted(seatId: string) {
		const le = lastExecuted;
		if (!le?.charId) return;
		await saveCannibalInfo(seatId, { inherits: le.charId, poisoned: le.evil });
		if (le.evil) await poisonCannibal(seatId);
		else await clearCannibalPoison(seatId);
	}

	/** Override for "they were bluffing as ___": the executed player was
	 * secretly a minion (or demon) but the group only ever saw them play a
	 * good character — the Cannibal should inherit that bluffed identity
	 * instead of the real evil one, while still being poisoned, since the
	 * true inherited ability is evil. Restricted to mimicChoices (good,
	 * non-drunk, non-amnesiac) for the same reason it's used for the
	 * Amnesiac's mimic picker. */
	async function bluffOverride(seatId: string, characterId: string) {
		if (!characterId) return;
		await saveCannibalInfo(seatId, { inherits: characterId, poisoned: true });
		await poisonCannibal(seatId);
	}

	/** Assigns a random not-in-play Townsfolk as this seat's cover story and
	 * records the true identity via setDrunk — same "not otherwise in play"
	 * rule dealGame() uses for an auto-dealt Drunk. */
	async function makeDrunk(seatId: string) {
		if (!script) return;
		const inPlayIds = new Set(session.roles.map((r) => r.character_id));
		const townsfolk = script.characters.filter((c) => c.team === 'townsfolk');
		const notInPlay = townsfolk.filter((c) => !inPlayIds.has(c.id));
		const pool = notInPlay.length ? notInPlay : townsfolk;
		if (!pool.length) return;
		const fake = pool[Math.floor(Math.random() * pool.length)];
		await run(assignRole(supabase, gameId, seatId, fake.id));
		await run(setDrunk(supabase, gameId, seatId));
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
			const { comp, redHerringSeatId, drunk } = result;
			const drunkChar = drunk ? script.characters.find((c) => c.id === drunk.fakeCharacterId) : null;
			dealMsg =
				`Dealt ${result.assignments.size} roles — ${comp.townsfolk} Townsfolk / ${comp.outsider} Outsider / ${comp.minion} Minion / ${comp.demon} Demon` +
				(redHerringSeatId ? ' · Fortune Teller red herring set.' : '.') +
				(drunkChar ? ` · Drunk is shown as the ${drunkChar.name}.` : '');
		}
		dealing = false;
	}

	let highlightSeatId = $state<string | null>(null);
	let highlightTimer: ReturnType<typeof setTimeout> | null = null;
	/** The Storyteller's circle is click-to-jump: tapping a seat scrolls its
	 * row into view below and briefly highlights it, rather than doing
	 * nothing — several people found themselves trying to click the circle
	 * expecting *some* reaction to it. */
	function jumpToSeat(seatId: string) {
		tab = 'seats';
		highlightSeatId = seatId;
		if (highlightTimer) clearTimeout(highlightTimer);
		highlightTimer = setTimeout(() => (highlightSeatId = null), 2000);
		// Wait a tick for the Seats tab (and its seat rows) to actually render
		// before trying to scroll to one.
		setTimeout(() => {
			document.getElementById(`seat-row-${seatId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}, 30);
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
			<button class:active={tab === 'vote'} onclick={() => (tab = 'vote')}>
				Vote{#if openNom} <span class="badge">1</span>{/if}
			</button>
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
				<Circle
					seats={session.seats}
					labelFor={(s) => roleName(s.id)}
					markFor={(s) => (isDrunk(s.id) ? '🍺' : isRedHerring(s.id) ? '🐟' : null)}
					onselect={jumpToSeat}
				/>
				<p class="muted" style="text-align:center;margin:0.4rem 0 0">Tap a seat to jump to it below.</p>
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
					<div
						id="seat-row-{seat.id}"
						class="card seatrow"
						class:open={!seat.user_id}
						class:justclicked={highlightSeatId === seat.id}
					>
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
						{@const poison = poisonStatus(seat.id, session.grimoire, session.seats)}
						{#if poison.poisoned}
							<div class="row" style="align-items:center;gap:0.4rem">
								<span class="drunktag">🧪 Poisoned — {poison.reason}</span>
								<button
									class="ghostvote"
									onclick={() =>
										run(
											setSeatTokens(
												supabase,
												gameId,
												seat.id,
												removeToken(
													session.grimoire.find((g) => g.seat_id === seat.id)?.tokens,
													'poisoned',
													poison.source ?? 'cannibal'
												)
											)
										)}
									title="Manually clear this poison token"
								>
									Clear
								</button>
							</div>
						{/if}
						{#if scriptHasDrunk}
							{#if isDrunk(seat.id)}
								<div class="row" style="align-items:center;gap:0.4rem">
									<span class="drunktag">🍺 Drunk — thinks they're the {roleName(seat.id)}</span>
									<button
										class="ghostvote"
										onclick={() => run(clearDrunk(supabase, seat.id))}
										title="Undo — this seat is no longer marked as the Drunk"
									>
										Clear
									</button>
								</div>
							{:else}
								<button
									class="ghostvote"
									onclick={() => makeDrunk(seat.id)}
									title="Secretly assign the Drunk: gives them a random not-in-play Townsfolk to think they are"
								>
									🍺 Make Drunk
								</button>
							{/if}
						{/if}
						{#if scriptHasRedHerring}
							{#if isRedHerring(seat.id)}
								<div class="row" style="align-items:center;gap:0.4rem">
									<span class="drunktag">🐟 Fortune Teller's red herring</span>
									<button
										class="ghostvote"
										onclick={() => run(clearRedHerring(supabase, gameId))}
										title="Undo — no seat is marked as the red herring"
									>
										Clear
									</button>
								</div>
							{:else}
								<button
									class="ghostvote"
									onclick={() => run(setRedHerring(supabase, gameId, seat.id))}
									title="The Fortune Teller reads this seat as the Demon even though they aren't — only one seat can hold it"
								>
									🐟 Make red herring
								</button>
							{/if}
						{/if}
						{#if session.roleFor(seat.id) === 'amnesiac'}
							{@const info = amnesiacInfo(seat.id)}
							<div class="row" style="align-items:center;gap:0.4rem;flex-wrap:wrap">
								<span class="drunktag">
									🌀 Secret ability: {info?.text || '— not set yet —'}
									{#if info?.mimics}<em>(mimics {mimicName(info.mimics)} — auto info at night)</em>{/if}
								</span>
							</div>
							<div class="row" style="flex-wrap:wrap;gap:0.3rem">
								<select
									value=""
									onchange={(e) => {
										const v = e.currentTarget.value;
										if (v) setAmnesiacPrewritten(seat.id, v);
										e.currentTarget.value = '';
									}}
								>
									<option value="">— pick a prewritten ability —</option>
									{#each AMNESIAC_ABILITIES as a (a.id)}
										<option value={a.text}>{a.name}</option>
									{/each}
								</select>
								<button class="ghostvote" onclick={() => randomAmnesiacAbility(seat.id)}>
									🎲 Random
								</button>
							</div>
							<div class="row" style="flex-wrap:wrap;gap:0.3rem;align-items:center">
								<select
									value={info?.mimics ?? ''}
									onchange={(e) => setAmnesiacMimic(seat.id, e.currentTarget.value || null)}
									title="Wakes them at night in that character's own night-order slot and offers the same automatic info candidates, instead of you improvising by hand"
								>
									<option value="">— or: secretly IS another character (auto night info) —</option>
									{#each mimicChoices as c (c.id)}
										<option value={c.id}>{c.name}</option>
									{/each}
								</select>
							</div>
							<textarea
								rows="2"
								placeholder="…or write your own secret ability text"
								value={amnesiacDraft[seat.id] ?? info?.text ?? ''}
								oninput={(e) => (amnesiacDraft[seat.id] = e.currentTarget.value)}
							></textarea>
							<button
								class="ghostvote"
								onclick={() => setAmnesiacCustomText(seat.id, amnesiacDraft[seat.id] ?? '')}
							>
								Save custom text
							</button>
						{/if}
						{#if session.roleFor(seat.id) === 'cannibal'}
							{@const info = cannibalInfo(seat.id)}
							<div class="row" style="align-items:center;gap:0.4rem;flex-wrap:wrap">
								<span class="drunktag">
									🍖 Inherited ability:
									{info ? mimicName(info.inherits) : '— not set yet —'}
									{#if info?.poisoned}<em>(poisoned — evil inheritance)</em>{/if}
								</span>
							</div>
							{#if lastExecuted}
								<div class="row" style="flex-wrap:wrap;gap:0.3rem;align-items:center">
									<span class="muted">
										Last executed: {seatName(lastExecuted.seatId)} — {lastExecuted.char?.name ??
											lastExecuted.charId}
										{#if lastExecuted.evil}<em>(evil — bluffing?)</em>{/if}
									</span>
									<button class="ghostvote" onclick={() => inheritExecuted(seat.id)}>
										Inherit their role
									</button>
								</div>
								{#if lastExecuted.evil}
									<div class="row" style="flex-wrap:wrap;gap:0.3rem;align-items:center">
										<select
											value=""
											onchange={(e) => {
												const v = e.currentTarget.value;
												if (v) bluffOverride(seat.id, v);
												e.currentTarget.value = '';
											}}
											title="The group only ever saw the executed player play this character — the Cannibal inherits the bluffed identity instead of the real evil one, and is still poisoned"
										>
											<option value="">— or: they were bluffing as ___ (still poisoned) —</option>
											{#each mimicChoices as c (c.id)}
												<option value={c.id}>{c.name}</option>
											{/each}
										</select>
									</div>
								{/if}
							{:else}
								<p class="muted" style="margin:0">No one has been executed yet.</p>
							{/if}
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
				{#if nightTabActualNight != null}
					<div class="row" style="align-items:center;gap:0.4rem;flex-wrap:wrap">
						<label for="planNight" class="muted" style="font-size:0.82rem">Viewing</label>
						<select
							id="planNight"
							value={planNight ?? ''}
							onchange={(e) => {
								const v = e.currentTarget.value;
								planNight = v ? Number(v) : null;
							}}
						>
							<option value="">Night {nightTabActualNight} (live)</option>
							<option value={nightTabActualNight + 1}>Night {nightTabActualNight + 1} — plan ahead</option>
							<option value={nightTabActualNight + 2}>Night {nightTabActualNight + 2} — plan ahead</option>
						</select>
						{#if planNight != null}
							<span class="muted" style="font-size:0.78rem">
								Reference only — write "notes to self" for later, but nothing sends until it's
								really that night.
							</span>
						{/if}
					</div>
				{/if}
				<NightDispatch {session} {gameId} previewNight={planNight} />
			</section>
		{:else if tab === 'vote'}
			<section class="stack">
				{#if !openNom}
					<section class="card stack">
						<strong>Open a nomination</strong>
						<p class="muted" style="margin:0">
							Called out in person, entered here so everyone's phone can follow along. Only living
							players can be nominated or nominate; only one nomination is open at a time.
						</p>
						<div>
							<label for="nominee">Nominated</label>
							<select id="nominee" bind:value={nomineeSeatId}>
								<option value="">— pick a seat —</option>
								{#each livingClaimed as s (s.id)}
									<option value={s.id}>{s.name || `Seat ${s.seat_index + 1}`}</option>
								{/each}
							</select>
						</div>
						<div>
							<label for="nominator">Nominated by (optional)</label>
							<select id="nominator" bind:value={nominatorSeatId}>
								<option value="">— unspecified —</option>
								{#each livingClaimed as s (s.id)}
									<option value={s.id}>{s.name || `Seat ${s.seat_index + 1}`}</option>
								{/each}
							</select>
						</div>
						<div style="width:8rem">
							<label for="debate">Debate seconds</label>
							<input id="debate" type="number" min="0" max="900" bind:value={debateSeconds} />
						</div>
						<button class="primary" disabled={!nomineeSeatId} onclick={doOpenNomination}>
							Open nomination
						</button>
					</section>
				{:else if openNom.stage === 'debate'}
					<section class="card stack">
						<strong>Debate</strong>
						<p style="margin:0">
							<strong>{seatLabel(openNom.nominee_seat_id)}</strong> has been nominated
							{#if openNom.nominator_seat_id}
								by <strong>{seatLabel(openNom.nominator_seat_id)}</strong>
							{/if}.
						</p>
						{#if openNom.debate_seconds}
							<p class="debate-timer" class:overrun={debateOverrun} style="margin:0">
								⏱ <strong>{debateDisplay}</strong>
								{debateOverrun ? 'over' : 'left'} for the accuser's case and the defence, however you
								split it.
							</p>
						{/if}
						{#if virginCheck?.fires}
							<p style="margin:0">
								🔔 <strong>Virgin fires:</strong> the nominator,
								<strong>{seatLabel(virginCheck.nominatorSeatId)}</strong>, is a Townsfolk — this
								nomination ends with them executed instead of a debate/vote.
							</p>
							<div class="row">
								<button class="danger" onclick={fireVirgin}>
									Execute {seatLabel(virginCheck.nominatorSeatId)} instead (Virgin)
								</button>
								<button onclick={() => run(dismissNomination(supabase, openNom.id))}>
									Dismiss nomination
								</button>
							</div>
						{:else}
							{#if virginCheck?.reason}
								<p class="muted" style="margin:0">Virgin: {virginCheck.reason}</p>
							{/if}
							<div class="row">
								<button class="primary" onclick={() => run(startVoting(supabase, openNom.id))}>
									Start voting
								</button>
								<button onclick={() => run(dismissNomination(supabase, openNom.id))}>
									Dismiss nomination
								</button>
							</div>
						{/if}
					</section>
				{:else if openNom.stage === 'voting'}
					<section class="card stack">
						<strong>Voting — {seatLabel(openNom.nominee_seat_id)}</strong>
						<p style="margin:0">
							<strong>{latestVotes.length}</strong> hand{latestVotes.length === 1 ? '' : 's'} raised
							· needs <strong>{votes.votesToExecute}</strong> to execute
						</p>
						<div class="stack" style="gap:0.2rem">
							{#each latestVotes as v (v.seat_id)}
								<span style="font-size:0.85rem">
									{v.is_ghost ? '👻' : '✋'} {seatLabel(v.seat_id)}
								</span>
							{:else}
								<span class="muted" style="font-size:0.85rem">No hands raised yet.</span>
							{/each}
						</div>
						<button class="primary" onclick={() => run(closeNomination(supabase, openNom.id))}>
							Close vote
						</button>
					</section>
				{/if}

				{#if latestNom && latestNom.stage === 'closed' && (!openNom || openNom.id !== latestNom.id)}
					{@const reachedMajority = latestVotes.length >= votes.votesToExecute}
					<section class="card stack">
						<strong>Result — {seatLabel(latestNom.nominee_seat_id)}</strong>
						<p style="margin:0">
							{latestVotes.length} vote{latestVotes.length === 1 ? '' : 's'}
							{reachedMajority ? '— reached majority' : `— short of the ${votes.votesToExecute} needed`}
						</p>
						{#if latestNom.executed}
							<p class="muted" style="margin:0">Executed.</p>
						{:else if reachedMajority}
							<p class="muted" style="margin:0">
								Traditionally: count down 3, 2, 1 out loud, then tap Execute.
							</p>
							<button class="danger" onclick={executeNominee}>Execute {seatLabel(latestNom.nominee_seat_id)}</button>
						{:else}
							<p class="muted" style="margin:0">No execution today from this nomination.</p>
						{/if}
					</section>
				{/if}

				{#if todaysNominations.length}
					<section class="card stack">
						<strong>Today's nominations</strong>
						{#each todaysNominations as n (n.id)}
							<div class="row" style="justify-content:space-between;font-size:0.85rem">
								<span>{seatLabel(n.nominee_seat_id)}</span>
								<span class="muted">
									{n.stage === 'closed'
										? n.executed
											? 'executed'
											: 'not executed'
										: n.stage}
								</span>
							</div>
						{/each}
					</section>
				{/if}
			</section>
		{:else}
			<section class="stack">
				{#if waiting.length === 0}
					<p class="muted">No one is waiting.</p>
				{/if}
				{#each waiting as req, i (req.id)}
					{@const seat = session.seats.find((s) => s.id === req.seat_id)}
					{@const askerCharId = session.roleFor(req.seat_id)}
					{@const askerChar = script && askerCharId ? getCharacter(script, askerCharId) : undefined}
					<div class="card stack" style="gap:0.5rem">
						<div>
							<strong>#{i + 1} · {seat?.name ?? 'Unknown'}</strong>
							{#if req.reason}<div class="muted">{req.reason}</div>{/if}
						</div>
						{#if askerChar?.dayAsk}
							{@const dayAsk = askerChar.dayAsk}
							<div class="dayask-prep stack" style="gap:0.3rem">
								{#if dayAsk.kind === 'savant'}
									{@const savantPoison = poisonStatus(req.seat_id, session.grimoire, session.seats)}
									{#if savantPoison.poisoned}
										<p class="muted" style="margin:0;font-size:0.8rem">
											🧪 {savantPoison.reason} — pick how many statements are true below.
										</p>
									{/if}
									<div class="row" style="align-items:center;gap:0.3rem">
										<label class="muted" style="font-size:0.8rem" for="savant-truth-{req.seat_id}">
											True statements:
										</label>
										<select
											id="savant-truth-{req.seat_id}"
											value={savantTruthCount[req.seat_id] ?? 1}
											onchange={(e) =>
												(savantTruthCount[req.seat_id] = Number(
													e.currentTarget.value
												) as 0 | 1 | 2)}
										>
											<option value={1}>1 (normal)</option>
											<option value={0}>0 (poisoned/drunk)</option>
											<option value={2}>2 (poisoned/drunk)</option>
										</select>
									</div>
									{@const prep = savantPrep(
										{
											script: script!,
											seats: session.seats,
											roleOf: (id: string) => session.roleFor(id),
											night: 0,
											askingSeatId: req.seat_id
										},
										dayAskVariant[req.seat_id] ?? 0,
										savantTruthCount[req.seat_id] ?? 1
									)}
									<p class="muted" style="margin:0;font-size:0.8rem">{prep.guidance}</p>
									{#each prep.candidates as c (c.label)}
										<p style="margin:0;font-size:0.9rem"><strong>{c.label}:</strong> {c.text}</p>
									{/each}
									<button
										style="align-self:flex-start"
										onclick={() =>
											(dayAskVariant[req.seat_id] = (dayAskVariant[req.seat_id] ?? 0) + 1)}
									>
										&#x21bb; New options
									</button>
								{:else if dayAsk.kind === 'fisherman'}
									{@const prep = fishermanPrep(
										{
											script: script!,
											seats: session.seats,
											roleOf: (id: string) => session.roleFor(id),
											night: 0,
											askingSeatId: req.seat_id
										},
										dayAskVariant[req.seat_id] ?? 0
									)}
									<p class="muted" style="margin:0;font-size:0.8rem">{prep.guidance}</p>
									{#each prep.candidates as c (c.label)}
										<p style="margin:0;font-size:0.9rem"><strong>{c.label}:</strong> {c.text}</p>
									{/each}
									<button
										style="align-self:flex-start"
										onclick={() =>
											(dayAskVariant[req.seat_id] = (dayAskVariant[req.seat_id] ?? 0) + 1)}
									>
										&#x21bb; New options
									</button>
								{:else if dayAsk.kind === 'artist'}
									<p class="muted" style="margin:0;font-size:0.8rem">{ARTIST_GUIDANCE}</p>
								{:else if dayAsk.kind === 'amnesiac'}
									<p style="margin:0;font-size:0.9rem">
										<strong>Their secret ability:</strong>
										{amnesiacAbility(req.seat_id) ?? '— not set yet, set it on the Seats tab —'}
									</p>
									<p class="muted" style="margin:0;font-size:0.8rem">
										Their guess is above. Respond Cold / Warm / Hot / Bingo based on how close it is.
									</p>
								{/if}
							</div>
						{/if}
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
	.seatrow.justclicked {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent);
		transition: box-shadow 0.3s ease, border-color 0.3s ease;
	}
	.drunktag {
		font-size: 0.78rem;
		color: var(--text-dim);
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
	.debate-timer {
		font-variant-numeric: tabular-nums;
	}
	.debate-timer.overrun {
		color: var(--danger);
	}
</style>
