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

/** Fisher-Yates using a supplied seeded rng, so results are reproducible per (night, seat, variant). */
function shuffledBy<T>(arr: T[], rng: () => number): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
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

/**
 * Each night: shows a player of a different character TYPE than whoever was
 * shown last night (Balloonist). The app doesn't persist which type was
 * shown on a previous night (that would need a structured history alongside
 * the free-text info the Storyteller actually sends, which they're free to
 * edit) — so this always proposes a fresh random living seat and leaves the
 * "different type than last time" check to the Storyteller's own notes,
 * same spirit as the Undertaker's day-log gap noted above.
 */
export function balloonistCandidates(ctx: NightContext): InfoCandidate[] {
	const alive = ctx.seats.filter((s) => s.id !== ctx.askingSeatId);
	if (!alive.length) {
		return [
			{
				label: 'Neutral',
				text: 'No other players are seated to show.',
				rationale: 'Not enough seated players.',
				truthful: true
			}
		];
	}
	const rng = seeded(`${ctx.night}:${ctx.askingSeatId}:balloonist:${ctx.variant ?? 0}`);
	const seat = pickOne(alive, rng)!;
	return [
		{
			label: 'Neutral',
			text: `You are shown ${seatLabel(seat)}.`,
			rationale:
				"Must be a different character type than whoever was shown last night — the app doesn't track that across nights, so check your own notes before sending. Shuffle for another random pick.",
			truthful: true,
			seatIds: [seat.id]
		}
	];
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
		if (character.prompt.compute === 'balloonist') return balloonistCandidates(ctx);
	}
	return null;
}

// ---------------------------------------------------------------------------
// Night 1 evil-team recognition

export interface EvilRevealStep {
	seat: SeatRow;
	character: Character;
	/** Ready-worded reveal text for this seat — what the Demon or Minion
	 * learns about the rest of the evil team on Night 1. */
	text: string;
}

/**
 * Night 1 only: every seated Demon and Minion, with what they learn about
 * each other. Independent of wakeOrder()/nightOrder() because some evil
 * characters (Scarlet Woman, Baron in Trouble Brewing) are otherwise fully
 * passive and never get a night step at all — but per the real rules the
 * whole evil team still wakes briefly on the first night to see each other.
 *
 * The Demon learns its Minions plus three not-in-play "bluff" characters
 * (so it has something to claim if asked what it is). Each Minion learns
 * the Demon and its fellow Minions.
 */
export function night1EvilReveals(ctx: NightContext): EvilRevealStep[] {
	if (ctx.night !== 1) return [];
	// Most scripts have the evil team wake together on Night 1 to learn each
	// other; some Teensyville scripts (Laissez un Faire) explicitly don't —
	// see the Script.evilTeamKnowsEachOther doc comment in types.ts.
	if (ctx.script.evilTeamKnowsEachOther === false) return [];
	const dealt: { seat: SeatRow; character: Character }[] = [];
	for (const seat of ctx.seats) {
		const cid = ctx.roleOf(seat.id);
		const character = cid ? ctx.script.characters.find((c) => c.id === cid) : undefined;
		if (character) dealt.push({ seat, character });
	}
	const demonEntry = dealt.find((d) => d.character.team === 'demon');
	const minionEntries = dealt.filter((d) => d.character.team === 'minion');
	const steps: EvilRevealStep[] = [];

	if (demonEntry) {
		const others = minionEntries.map((m) => `${seatLabel(m.seat)} (the ${m.character.name})`);
		const inPlayIds = new Set(dealt.map((d) => d.character.id));
		const rng = seeded(`${ctx.night}:bluffs:${demonEntry.seat.id}:${ctx.variant ?? 0}`);
		const notInPlay = shuffledBy(
			ctx.script.characters.filter((c) => !inPlayIds.has(c.id) && c.id !== demonEntry.character.id),
			rng
		);
		const bluffs = notInPlay.slice(0, 3);
		const minionsText = others.length ? others.join(', ') : 'none — you are the only evil player';
		const bluffsText = bluffs.length
			? bluffs.map((c) => c.name).join(', ')
			: '(script has too few unused characters left for bluffs)';
		steps.push({
			seat: demonEntry.seat,
			character: demonEntry.character,
			text: `You are the ${demonEntry.character.name}. Your Minions: ${minionsText}. Not-in-play bluffs, in case anyone asks what you are: ${bluffsText}. You do not kill tonight.`
		});
	}

	for (const m of minionEntries) {
		const fellow = minionEntries
			.filter((x) => x.seat.id !== m.seat.id)
			.map((x) => `${seatLabel(x.seat)} (the ${x.character.name})`);
		const demonText = demonEntry
			? `${seatLabel(demonEntry.seat)} (the ${demonEntry.character.name})`
			: 'not yet assigned';
		steps.push({
			seat: m.seat,
			character: m.character,
			text: `You are Evil. The Demon is ${demonText}.${
				fellow.length ? ` Your fellow Minions: ${fellow.join(', ')}.` : ' You are the only Minion.'
			}`
		});
	}

	return steps;
}

// ---------------------------------------------------------------------------
// choose-type prompts (the player picks, not the Storyteller)

export interface ChoicePrompt {
	ability: string;
	count: 1 | 2;
	canPickSelf: boolean;
	/** Seats the player may legally choose among. */
	validSeatIds: string[];
	/** Seats within validSeatIds that the asking player already knows are
	 * fellow evil team members (from Night 1 mutual recognition) — empty for
	 * a good-aligned asker, who has no such knowledge. Lets the choice UI
	 * flag them so e.g. the Imp doesn't accidentally kill their own Poisoner,
	 * or the Poisoner doesn't waste their poison on the Demon. */
	teammateSeatIds: string[];
}

export function choicePromptFor(ctx: NightContext, character: Character): ChoicePrompt | null {
	if (character.prompt.kind !== 'choose') return null;
	const alive = ctx.seats.filter((s) => s.alive);
	const pool = character.prompt.canPickSelf ? alive : alive.filter((s) => s.id !== ctx.askingSeatId);
	// Only an evil asker on a script where evil actually knows each other has
	// teammates to flag — a good player picking a target (Monk, Fortune
	// Teller, Ravenkeeper, Butler) never knows who's evil, and on a script
	// like Laissez un Faire the evil team itself doesn't know each other
	// either (Script.evilTeamKnowsEachOther: false).
	const teammateSeatIds =
		ctx.script.evilTeamKnowsEachOther !== false && isEvilSeat(ctx, ctx.askingSeatId)
			? pool.filter((s) => isEvilSeat(ctx, s.id)).map((s) => s.id)
			: [];
	return {
		ability: character.summary,
		count: character.prompt.count,
		canPickSelf: character.prompt.canPickSelf,
		validSeatIds: pool.map((s) => s.id),
		teammateSeatIds
	};
}

/** A submitted choose-type `result` is either the plain picks array a player
 * writes via submitNightChoice, or — once the Storyteller has computed and
 * sent a reveal on top of it (Fortune Teller's yes/no, Ravenkeeper's
 * revealed character) — an object carrying both. Reusing the one `result`
 * field this way avoids a schema change, since night_actions only allows one
 * row per (game, night, seat). */
export interface ParsedChoiceResult {
	picks: string[];
	reading?: string;
}

export function parseChoiceResult(raw: string | null): ParsedChoiceResult | null {
	if (!raw) return null;
	try {
		const v = JSON.parse(raw);
		if (Array.isArray(v)) return { picks: v as string[] };
		if (v && typeof v === 'object' && Array.isArray((v as { picks?: unknown }).picks)) {
			const obj = v as { picks: string[]; reading?: string };
			return { picks: obj.picks, reading: obj.reading };
		}
	} catch {
		/* not JSON — treat as no valid answer yet */
	}
	return null;
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
	const included = new Set<string>();

	if (night === 1 && script.evilTeamKnowsEachOther !== false) {
		// The evil team recognises each other first, even characters that are
		// otherwise fully passive and never get a firstNight entry at all
		// (Scarlet Woman, Baron) — see night1EvilReveals(). Skipped entirely
		// for a script that opts out (Script.evilTeamKnowsEachOther: false).
		const evilFirst = script.characters
			.filter((c) => (c.team === 'demon' || c.team === 'minion') && bySeat.has(c.id))
			.sort((a, b) => (a.team === 'demon' ? 0 : 1) - (b.team === 'demon' ? 0 : 1));
		for (const character of evilFirst) {
			const seat = bySeat.get(character.id);
			if (seat && !included.has(character.id)) {
				steps.push({ seat, character });
				included.add(character.id);
			}
		}
	}

	for (const character of order) {
		if (included.has(character.id)) continue;
		const seat = bySeat.get(character.id);
		if (!seat) continue;
		// A wakeIfDead character (Ravenkeeper) only gets a step once it's
		// actually dead -- "if you die at night, ..." isn't an ability they
		// have while still alive. Which night, and whether it's already been
		// used once, is filtered separately in NightDispatch.svelte (this
		// function has no access to night_actions history).
		if (character.wakeIfDead && seat.alive) continue;
		steps.push({ seat, character });
		included.add(character.id);
	}
	return steps;
}
