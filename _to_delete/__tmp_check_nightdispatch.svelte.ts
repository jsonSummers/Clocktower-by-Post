	/**
	 * NightDispatch — the Storyteller's per-night queue. Walks tonight's wake
	 * order (from nightInfo.ts) and, for each seat whose character acts, shows
	 * exactly what needs deciding: ready-worded info candidates to click in or
	 * edit for info roles, or a "let them choose" trigger + the player's
	 * submitted answer for choose roles.
	 *
	 * Used both on the real Storyteller page (host/[gameId]) and inline in the
	 * /dev simulator, so solo-testing shows the same thing a live game would.
	 *
	 * ---- preview mode ----
	 * The host page never passes `previewNight`, so it behaves exactly as
	 * before: the queue only appears once the game clock is actually in a
	 * night phase, and every button really sends/asks. The /dev simulator
	 * passes a chosen night number instead, so the whole queue — every
	 * character's ability, the wake order, and worked example candidates for
	 * every info role — can be read at any time, without first walking the
	 * clock there. If the previewed night isn't the game's *actual* current
	 * night, sending/asking is disabled (a duplicate dispatch for a night
	 * that hasn't arrived yet would just be confusing) and the panel reads
	 * as reference only.
	 */
	import type { GameSession } from '$lib/game.svelte';
	import { getScript, getCharacter, findCharacterAnywhere } from '$lib/scripts';
	import type { Character } from '$lib/types';
	import {
		wakeOrder,
		infoCandidatesFor,
		night1EvilReveals,
		parseChoiceResult,
		choicePromptFor,
		mimicWakeStep,
		type InfoCandidate,
		type WakeStep
	} from '$lib/nightInfo';
	import { parseAmnesiacNote } from '$lib/scripts/amnesiac-abilities';
	import { parseCannibalNote } from '$lib/scripts/cannibal';
	import { poisonStatus, addToken } from '$lib/poison';
	import {
		sendNightInfo,
		askNightChoice,
		sendChoiceReading,
		reopenNightChoice,
		clearNightAction,
		savePrepNote,
		markPrepNoteReleased,
		setSeatTokens
	} from '$lib/actions';
	import Avatar from './Avatar.svelte';

	interface Props {
		session: GameSession;
		gameId: string;
		/** Show this night instead of the game's actual current night — for
		 * previewing without moving the clock. Omit for the real ST page. */
		previewNight?: number | null;
	}
	let { session, gameId, previewNight = null }: Props = $props();

	let actionError = $state<string | null>(null);
	async function run(p: PromiseLike<{ error: unknown }>) {
		const { error } = await p;
		if (error) actionError = error instanceof Error ? error.message : String(error);
	}

	const script = $derived(session.game ? getScript(session.game.script_id) : undefined);
	/** The night this panel dispatches for. Stays on last night's number
	 * through the FOLLOWING day too (same phase_cycle — see clock.ts'
	 * night N -> day N), not just while phase_kind is literally 'night' —
	 * otherwise anything not yet sent (a Ravenkeeper prompt surfaced by a
	 * kill the Storyteller only marked dead a moment before advancing, say)
	 * became permanently unreachable the instant the clock moved to day.
	 * Once the NEXT night starts, this rolls forward and that window closes. */
	const actualNight = $derived(
		session.phase?.kind === 'night' || session.phase?.kind === 'day'
			? session.phase.cycle
			: null
	);
	const night = $derived(previewNight ?? actualNight);
	/** False when previewing a night other than the one the game clock is
	 * really on — the panel becomes read-only reference in that case. */
	const live = $derived(previewNight == null || previewNight === actualNight);
	/**
	 * The Amnesiac's own wake step(s) — not a real seat_roles assignment, so
	 * wakeOrder() can't find them the normal way. Built from grimoire.notes
	 * (see amnesiac-abilities.ts): a `mimics` assignment reuses the mimicked
	 * character's real mechanics wholesale (its night-order slot, its info
	 * candidates if it has any) so the Storyteller runs it exactly like
	 * anyone else who's really that character; a plain `text` assignment
	 * (prewritten or free-written) instead gets a generic nightly reminder
	 * slot near the end of the queue, with that text shown as a prompt for
	 * the Storyteller to improvise from — same spirit as Cannibal/Lunatic's
	 * "wake manually and dispatch as free text" in laissez-un-faire.ts.
	 */
	const amnesiacWakes = $derived.by(() => {
		if (night == null) return [];
		const out: WakeStep[] = [];
		for (const seat of session.seats) {
			if (session.roleFor(seat.id) !== 'amnesiac') continue;
			const note = session.grimoire.find((g) => g.seat_id === seat.id)?.notes;
			const info = parseAmnesiacNote(note);
			if (!info) continue;
			if (info.mimics) {
				const mimicked = findCharacterAnywhere(info.mimics);
				const step = mimicked ? mimicWakeStep(seat, mimicked, night, 'Amnesiac') : null;
				if (step) out.push(step);
			} else if (info.text) {
				out.push({
					seat,
					character: {
						id: 'amnesiac',
						name: 'Amnesiac',
						team: 'townsfolk',
						summary: info.text,
						firstNight: 900,
						otherNight: 900,
						prompt: { kind: 'none' }
					}
				});
			}
		}
		return out;
	});
	/** The Cannibal's inherited wake step — see cannibal.ts. Unlike the
	 * Amnesiac, there's no "custom text" fallback: the Cannibal only ever
	 * has something to inherit once an execution has actually happened, and
	 * the assignment is always a real character id (the executed player's
	 * own, or the bluff character the Storyteller substituted for it). */
	const cannibalWakes = $derived.by(() => {
		if (night == null) return [];
		const out: WakeStep[] = [];
		for (const seat of session.seats) {
			if (session.roleFor(seat.id) !== 'cannibal') continue;
			const info = parseCannibalNote(session.grimoire.find((g) => g.seat_id === seat.id)?.notes);
			if (!info) continue;
			const mimicked = findCharacterAnywhere(info.inherits);
			const step = mimicked ? mimicWakeStep(seat, mimicked, night, 'Cannibal') : null;
			if (step) out.push(step);
		}
		return out;
	});
	const steps = $derived.by(() => {
		if (!script || night == null) return [];
		const raw = wakeOrder(script, session.seats, (id) => session.roleFor(id), night, [
			...amnesiacWakes,
			...cannibalWakes
		]);
		// A wakeIfDead character (Ravenkeeper) is otherwise eligible on every
		// night once dead — cut it off after the first night it actually got
		// a chance to act, so it doesn't keep re-asking on every later night.
		return raw.filter((step) => {
			if (!step.character.wakeIfDead) return true;
			return !session.nightActions.some(
				(a) => a.seat_id === step.seat.id && a.character_id === step.character.id && a.night < night
			);
		});
	});

	/** Night 1 only: characterId -> the ready-worded evil-team-recognition text
	 * (Demon learns Minions + bluffs; Minions learn the Demon and each other). */
	const evilRevealMap = $derived.by(() => {
		if (!script || night !== 1) return new Map<string, string>();
		const ctx = {
			script,
			seats: session.seats,
			roleOf: (id: string) => session.roleFor(id),
			night: 1,
			askingSeatId: '',
			variant: 0
		};
		return new Map(night1EvilReveals(ctx).map((s) => [s.character.id, s.text]));
	});
	function evilRevealText(characterId: string): string | null {
		return evilRevealMap.get(characterId) ?? null;
	}
	/** True when the Night 1 reveal IS the whole message for this character
	 * (Imp/demon — no kill tonight; Scarlet Woman & Baron/none) — as opposed to
	 * a role that also has its own action that night (Poisoner's choose; the
	 * Spy's grimoire, which happens every night including the first), where
	 * the reveal is folded into that action instead, since night_actions
	 * allows only one row per seat per night. */
	function isRevealOnly(character: Character): boolean {
		if (character.team === 'demon') return character.prompt.kind === 'choose';
		if (character.team === 'minion') return character.prompt.kind === 'none';
		return false;
	}
	function isDemonSeat(seatId: string): boolean {
		const cid = session.roleFor(seatId);
		const c = script && cid ? getCharacter(script, cid) : undefined;
		return c?.team === 'demon';
	}
	/** True when this seat's displayed character is a cover story for the
	 * Drunk — the seat itself has no idea, but the Storyteller needs the
	 * reminder that anything "learned" here doesn't have to be true. */
	function isDrunkSeat(seatId: string): boolean {
		return session.grimoire.find((g) => g.seat_id === seatId)?.real_character_id === 'drunk';
	}

	function actionFor(seatId: string) {
		// Preview mode never reflects real dispatch state — it's a reference
		// view of what *would* be asked/sent, not a record of what was.
		if (night == null || !live) return undefined;
		return session.nightActions.find((a) => a.seat_id === seatId && a.night === night);
	}

	// Per-seat scratch state: the text currently staged in the box, a shuffle
	// counter for regenerating candidates, and (Undertaker only) who was
	// executed yesterday.
	let draftText = $state<Record<string, string>>({});
	let variant = $state<Record<string, number>>({});
	let executedFor = $state<Record<string, string>>({});
	let editing = $state<Record<string, boolean>>({});
	/** Staged text for the per-seat "plan ahead" note — see prepNoteFor() and
	 * the Amnesiac's wake step above. Keyed by seatId; only diverges from
	 * the saved session.prepNotes row while the Storyteller is mid-edit. */
	let prepDraft = $state<Record<string, string>>({});

	function candidatesFor(seatId: string, characterId: string): InfoCandidate[] {
		if (!script || night == null) return [];
		const character = script.characters.find((c) => c.id === characterId);
		if (!character) return [];
		// Night 1 reveal-only characters (Imp, Spy, ...) get their own dedicated
		// send button in the template and never reach this function via an
		// info-preplan/info-auto branch — nothing to special-case here anymore.
		const ctx = {
			script,
			seats: session.seats,
			roleOf: (id: string) => session.roleFor(id),
			night,
			askingSeatId: seatId,
			variant: variant[seatId] ?? 0
		};
		const opts =
			character.prompt.kind === 'info-auto' && character.prompt.compute === 'undertaker'
				? { executedCharacterId: executedFor[seatId] || null }
				: undefined;
		return infoCandidatesFor(ctx, character, opts) ?? [];
	}

	function shuffle(seatId: string) {
		variant[seatId] = (variant[seatId] ?? 0) + 1;
	}

	async function send(seatId: string, characterId: string) {
		const text = (draftText[seatId] ?? '').trim();
		if (!text || night == null) return;
		actionError = null;
		await run(sendNightInfo(session.client, gameId, night, seatId, characterId, '', text));
		editing[seatId] = false;
		const note = prepNoteFor(seatId);
		if (note && !note.released) run(markPrepNoteReleased(session.client, note.id));
	}

	/** This seat's saved "plan ahead" draft for the night being shown, if any. */
	function prepNoteFor(seatId: string) {
		if (night == null) return undefined;
		return session.prepNotes.find((p) => p.seat_id === seatId && p.night === night);
	}

	function savePrep(seatId: string) {
		if (night == null) return;
		const body = (prepDraft[seatId] ?? prepNoteFor(seatId)?.body ?? '').trim();
		run(savePrepNote(session.client, gameId, night, seatId, body));
	}

	/** Marks the Widow's chosen victim poisoned — see poison.ts. Re-derived
	 * live from whether the Widow's own seat is still alive, so there's
	 * nothing to "clear" when the Widow eventually dies. */
	async function poisonWidowVictim(victimSeatId: string, widowSeatId: string) {
		const existing = session.grimoire.find((g) => g.seat_id === victimSeatId)?.tokens;
		const tokens = addToken(existing, { kind: 'poisoned', source: 'widow', sourceSeatId: widowSeatId });
		await run(setSeatTokens(session.client, gameId, victimSeatId, tokens));
	}

	async function ask(
		seatId: string,
		characterId: string,
		ability: string,
		validSeatIds: string[],
		teammateSeatIds: string[] = []
	) {
		if (night == null) return;
		actionError = null;
		await run(
			askNightChoice(session.client, gameId, night, seatId, characterId, ability, validSeatIds, teammateSeatIds)
		);
	}

	function startEdit(seatId: string, seedText: string) {
		draftText[seatId] = seedText;
		editing[seatId] = true;
	}

	function seatName(id: string): string {
		const s = session.seats.find((x) => x.id === id);
		return s ? s.name || `Seat ${s.seat_index + 1}` : '?';
	}

	/** The Spy's "sees the grimoire" ability, as a one-shot snapshot text sent
	 * like any other info — every seat's true character (the Drunk's REAL
	 * identity, not their cover story) and the red herring, exactly what the
	 * physical grimoire book would show. Taken fresh each time the button is
	 * clicked, so re-sending after a death or a new deal is just a click. */
	function grimoireSnapshotText(): string {
		if (!script) return '';
		const ordered = [...session.seats].sort((a, b) => a.seat_index - b.seat_index);
		const lines = ordered.map((seat) => {
			const label = seat.name || `Seat ${seat.seat_index + 1}`;
			const trueCharId = isDrunkSeat(seat.id) ? 'drunk' : session.roleFor(seat.id);
			const charName = trueCharId
				? (getCharacter(script!, trueCharId)?.name ?? trueCharId)
				: '— no character —';
			const tags = [
				!seat.alive && 'dead',
				seat.id === session.redHerringSeatId && 'red herring'
			].filter(Boolean);
			return `${label} — ${charName}${tags.length ? ` (${tags.join(', ')})` : ''}`;
		});
		return lines.join('\n');
	}