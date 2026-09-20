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