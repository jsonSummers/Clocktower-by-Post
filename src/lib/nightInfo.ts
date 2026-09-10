/**
 * nightInfo.ts — turns a character's night prompt into what the Storyteller
 * actually needs on screen: the wake-order queue, ready-made info candidates
 * for the roles that report something, and the valid-target list for the
 * roles where the *player* picks someone.
 *
 * Everything here is pure (no Supabase, no DOM) — seats/roles go in as plain
 * data, candidates come out as plain data. The night-dispatch UI decides what
 * to do with them (host page, dev simulator, eventually the player's own
 * screen for choose-type prompts).
 *
 * ---- the "candidate" idea ----
 * For an info-reporting role (Washerwoman, Chef, ...) there is rarely exactly
 * one honest thing to say — Trouble Brewing deliberately leaves the Storyteller
 * a choice (which decoy to pair with the truth; whether a poisoned player's
 * number is a lie). Rather than making the Storyteller compose that from
 * scratch every time, `infoCandidatesFor` proposes a few ready worded options
 * the Storyteller can click straight in, tweak, or ignore entirely in favour
 * of their own text:
 *
 *   - "Neutral" — always genuinely correct, honestly worded, decoy picked
 *     without any lean either way.
 *   - "Helps good team" / "Helps evil team" — for the two-seats-one-is-X
 *     roles, a decoy chosen to tilt who ends up under a cloud of suspicion
 *     (see the rationale strings below for exactly how and why — it's a
 *     judgement call, not game theory gospel, which is why the reasoning is
 *     spelled out rather than hidden behind the label).
 *   - "If poisoned/drunk" alternates — only ever legitimate to send when
 *     that really is this player's state; nothing here checks that for you.
 *
 * And always, right next to the candidates: a plain text box, so the
 * Storyteller can ignore all of the above and make up their own wording —
 * the candidates are a head start, never a requirement.
 *
 * Nothing is ever sent automatically. The Storyteller always clicks (or
 * types) the final wording themselves.
 */
import type { Character, Script, SeatRow, Team } from './types';
import { adjacentPairs, livingNeighbours } from './circle';
import { getCharacter, nightOrder } from './scripts';

// ---------------------------------------------------------------------------
// context & small helpers

export interface NightContext {
	script: Script;
	/** All seats in the game (any alive/dead state — callers filter as needed). */
	seats: SeatRow[];
	roleOf: (seatId: string) => string | null;
	/** The current night number (1 = first night). */
	night: number;
	/** The seat whose ability is being dispatched. */
	askingSeatId: string;
	/** Bump this to regenerate candidates ("Shuffle") without changing on every rerender. */
	variant?: number;
}

const EVIL_TEAMS: Team[] = ['minion', 'demon'];

function teamOf(ctx: NightContext, seatId: string): Team | null {
	const cid = ctx.roleOf(seatId);
	if (!cid) return null;
	return getCharacter(ctx.script, cid)?.team ?? null;
}

function isEvilSeat(ctx: NightContext, seatId: string): boolean {
	const t = teamOf(ctx, seatId);
	return t !== null && EVIL_TEAMS.includes(t);
}

function seatLabel(s: SeatRow): string {
	return s.name || `Seat ${s.seat_index + 1}`;
}

/** Small deterministic PRNG so the same (game, night, seat, category, variant) always
 * proposes the same candidate — re-rendering the screen doesn't reshuffle it under you. */
function seeded(seedStr: string): () => number {
	let h = 1779033703 ^ seedStr.length;
	for (let i = 0; i < seedStr.length; i++) {
		h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	return function () {
		h = Math.imul(h ^ (h >>> 16), 2246822507);
		h = Math.imul(h ^ (h >>> 13), 3266489909);
		h ^= h >>> 16;
		return (h >>> 0) / 4294967296;
	};
}

function pickOne<T>(arr: T[], rng: () => number): T | undefined {
	if (!arr.length) return undefined;
	return arr[Math.floor(rng() * arr.length)];
}

// ---------------------------------------------------------------------------
// info candidates

export interface InfoCandidate {
	/** Short chip label, e.g. "Neutral", "Helps evil team", "If poisoned (higher)". */
	label: string;
	/** The finished sentence, ready to send as-is or edit further. */
	text: string;
	/** Storyteller-facing explanation of how/why this candidate was built. */
	rationale: string;
	/** True for the one candidate that's always honestly correct. */
	truthful: boolean;
	/** Seats this candidate references, for optional highlighting on the circle. */
	seatIds?: string[];
}

const PREPLAN_TEAM: Partial<Record<string, Team>> = {
	washerwoman: 'townsfolk',
	librarian: 'outsider',
	investigator: 'minion'
};

const PREPLAN_NONE_TEXT: Partial<Record<string, string>> = {
	washerwoman: 'No other Townsfolk are assigned yet — there is nothing truthful to show.',
	librarian: 'No Outsiders are in play.',
	investigator: 'No Minions are assigned yet — there is nothing truthful to show.'
};

/**
 * "Two seats, one of them is a <team> called X" — Washerwoman / Librarian /
 * Investigator all share this shape. The Storyteller always picks which
 * in-play holder of that team to reveal and which seat to pair it with; this
 * proposes the truthful pairing plus two decoy leanings.
 */
function preplanCandidates(ctx: NightContext, wantTeam: Team, noneText: string): InfoCandidate[] {
	const holders = ctx.seats.filter((s) => s.id !== ctx.askingSeatId && teamOf(ctx, s.id) === wantTeam);
	if (!holders.length) {
		return [{ label: 'Neutral', text: noneText, rationale: 'Only truthful option available.', truthful: true }];
	}

	function build(label: string, rationaleWhy: string, decoyFilter: (s: SeatRow) => boolean): InfoCandidate {
		const rng = seeded(`${ctx.night}:${ctx.askingSeatId}:${label}:${ctx.variant ?? 0}`);
		const truthSeat = pickOne(holders, rng)!;
		const charName = getCharacter(ctx.script, ctx.roleOf(truthSeat.id)!)?.name ?? '?';
		const pool = ctx.seats.filter((s) => s.id !== ctx.askingSeatId && s.id !== truthSeat.id);
		const preferred = pool.filter(decoyFilter);
		const decoy = pickOne(preferred.length ? preferred : pool, rng);
		if (!decoy) {
			return {
				label,
				text: noneText,
				rationale: 'Not enough other seated players to pair with — need at least two.',
				truthful: label === 'Neutral'
			};
		}
		const swap = rng() < 0.5;
		const a = swap ? decoy : truthSeat;
		const b = swap ? truthSeat : decoy;
		return {
			label,
			text: `${seatLabel(a)} and ${seatLabel(b)} — one of them is the ${charName}.`,
			rationale: `${seatLabel(truthSeat)} really is the ${charName}, paired with ${seatLabel(decoy)}. ${rationaleWhy}`,
			truthful: label === 'Neutral',
			seatIds: [truthSeat.id, decoy.id]
		};
	}

	return [
		build('Neutral', 'Decoy chosen at random — no lean either way.', () => true),
		build(
			'Helps good team',
			'Decoy is actually evil, so the accusation quietly spreads onto a real evil player instead of an innocent one.',
			(s) => isEvilSeat(ctx, s.id)
		),
		build(
			'Helps evil team',
			"Decoy is good, so the pairing looks entirely innocuous and gives the true evil player's cover story more room.",
			(s) => !isEvilSeat(ctx, s.id)
		)
	];
}

function numberCandidates(trueN: number, phrase: (n: number) => string): InfoCandidate[] {
	const lower = Math.max(0, trueN - 1);
	const higher = trueN + 1;
	return [
		{ label: 'Neutral', text: phrase(trueN), rationale: 'The real count.', truthful: true },
		{
			label: 'Helps evil team (if poisoned)',
			text: phrase(lower),
			rationale:
				'Only send this if the player is actually poisoned or the Drunk this night — understates evil, so it tends to help evil feel safer.',
			truthful: false
		},
		{
			label: 'Helps good team (if poisoned)',
			text: phrase(higher),
			rationale:
				'Only send this if the player is actually poisoned or the Drunk this night — overstates evil, so it tends to add pressure that helps good.',
			truthful: false
		}
	];
}

export function washerwomanCandidates(ctx: NightContext): InfoCandidate[] {
	return preplanCandidates(ctx, 'townsfolk', PREPLAN_NONE_TEXT.washerwoman!);
}

export function librarianCandidates(ctx: NightContext): InfoCandidate[] {
	return preplanCandidates(ctx, 'outsider', PREPLAN_NONE_TEXT.librarian!);
}

export function investigatorCandidates(ctx: NightContext): InfoCandidate[] {
	return preplanCandidates(ctx, 'minion', PREPLAN_NONE_TEXT.investigator!);
}

export function chefCandidates(ctx: NightContext): InfoCandidate[] {
	const n = adjacentPairs(ctx.seats, (s) => isEvilSeat(ctx, s.id));
	return numberCandidates(n, (n) => `${n} pair${n === 1 ? '' : 's'} of evil players are sitting next to each other.`);
}

export function empathCandidates(ctx: NightContext): InfoCandidate[] {
	const { ccw, cw } = livingNeighbours(ctx.seats, ctx.askingSeatId);
	const n = [ccw, cw].filter((s) => s && isEvilSeat(ctx, s.id)).length;
	return numberCandidates(n, (n) => `${n} of your living neighbours ${n === 1 ? 'is' : 'are'} evil.`);
}

/**
 * Undertaker needs to know who was executed the previous day. The day log
 * isn't wired up yet (see docs/decisions.md), so the Storyteller tells this
 * function directly — pass the executed seat's character id, or null if
 * nobody died.
 */
export function undertakerCandidates(ctx: NightContext, executedCharacterId: string | null): InfoCandidate[] {
	if (!executedCharacterId) {
		return [
			{ label: 'Neutral', text: 'Nobody was executed yesterday.', rationale: 'No execution recorded.', truthful: true }
		];
	}
	const trueName = getCharacter(ctx.script, executedCharacterId)?.name ?? executedCharacterId;
	const rng = seeded(`${ctx.night}:${ctx.askingSeatId}:undertaker:${ctx.variant ?? 0}`);
	const alts = ctx.script.characters.filter((c) => c.id !== executedCharacterId);
	const altA = pickOne(alts, rng);
	const altB = pickOne(
		alts.filter((c) => c.id !== altA?.id),
		rng
	);
	const out: InfoCandidate[] = [
		{ label: 'Neutral', text: `The ${trueName} was executed.`, rationale: 'The character actually executed.', truthful: true }
	];
	if (altA)
		out.push({
			label: 'Alt. name A (if poisoned)',
			text: `The ${altA.name} was executed.`,
			rationale: 'Only legitimate under poison/drunk — names a different character than was really executed.',
			truthful: false
		});
	if (altB)
		out.push({
			label: 'Alt. name B (if poisoned)',
			text: `The ${altB.name} was executed.`,
			rationale: 'A second false name, same condition.',
			truthful: false
		});
	return out;
}

/** Dispatches on the character's declared prompt kind — the thing to extend when a new script adds an info role. */
export function infoCandidatesFor(
	ctx: NightContext,
	character: Character,
	opts?: { executedCharacterId?: string | null }
): InfoCandidate[] | null {
	if (character.prompt.kind === 'info-preplan') {
		const team = PREPLAN_TEAM[character.id];
		const none = PREPLAN_NONE_TEXT[character.id];
		if (!team || !none) return null;
		return preplanCandidates(ctx, team, none);
	}
	if (character.prompt.kind === 'info-auto') {
		if (character.prompt.compute === 'chef') return chefCandidates(ctx);
		if (character.prompt.compute === 'empath') return empathCandidates(ctx);
		if (character.prompt.compute === 'undertaker') return undertakerCandidates(ctx, opts?.executedCharacterId ?? null);
	}
	return null;
}

// ---------------------------------------------------------------------------
// choose-type prompts (the player picks, not the Storyteller)

export interface ChoicePrompt {
	ability: string;
	count: 1 | 2;
	canPickSelf: boolean;
	/** Seats the player may legally choose among. */
	validSeatIds: string[];
}

export function choicePromptFor(ctx: NightContext, character: Character): ChoicePrompt | null {
	if (character.prompt.kind !== 'choose') return null;
	const alive = ctx.seats.filter((s) => s.alive);
	const pool = character.prompt.canPickSelf ? alive : alive.filter((s) => s.id !== ctx.askingSeatId);
	return {
		ability: character.summary,
		count: character.prompt.count,
		canPickSelf: character.prompt.canPickSelf,
		validSeatIds: pool.map((s) => s.id)
	};
}

// ---------------------------------------------------------------------------
// wake order

export interface WakeStep {
	seat: SeatRow;
	character: Character;
}

/** Which seated, role-assigned characters act this night, in order. Builds on scripts.ts's nightOrder(). */
export function wakeOrder(
	script: Script,
	seats: SeatRow[],
	roleOf: (seatId: string) => string | null,
	night: number
): WakeStep[] {
	const order = nightOrder(script, night <= 1);
	const bySeat = new Map<string, SeatRow>();
	for (const s of seats) {
		const cid = roleOf(s.id);
		if (cid && !bySeat.has(cid)) bySeat.set(cid, s);
	}
	const steps: WakeStep[] = [];
	for (const character of order) {
		const seat = bySeat.get(character.id);
		if (seat) steps.push({ seat, character });
	}
	return steps;
}
