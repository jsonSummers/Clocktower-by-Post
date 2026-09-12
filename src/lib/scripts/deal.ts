import type { Character, Composition, Script, SeatRow, Team } from '../types';
import { baseComposition, applySetup } from './composition';

export interface DealResult {
	/** seatId -> characterId for every seat that got dealt a character. For
	 * the Drunk's seat (see `drunk` below) this is already the FAKE
	 * Townsfolk id, not `'drunk'` itself — that seat's own screen, and
	 * everyone else's, only ever sees the cover story. */
	assignments: Map<string, string>;
	comp: Composition;
	/** The Fortune Teller's red herring seat, or null if no `redHerring`
	 * character (currently just the Fortune Teller) was dealt. */
	redHerringSeatId: string | null;
	/** The Drunk's seat and the fake Townsfolk identity they were dealt, or
	 * null if the Drunk wasn't drawn this deal. Per the real rules (and
	 * community convention, to avoid a confusing duplicate), the fake role
	 * is a Townsfolk NOT otherwise in play — the Drunk doesn't know they're
	 * the Drunk, thinks they're that Townsfolk, and that character's
	 * ability simply doesn't work for them. `applyDeal` uses this to record
	 * the true identity in `grimoire.real_character_id`, which only the
	 * Storyteller can read. */
	drunk: { seatId: string; fakeCharacterId: string } | null;
}

function shuffled<T>(arr: T[]): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

/** n distinct characters chosen at random from a team's pool — not just the
 * first n in script-definition order — clamped to what's actually available. */
function pickTeam(pool: Character[], n: number): Character[] {
	return shuffled(pool).slice(0, Math.max(0, Math.min(n, pool.length)));
}

/**
 * Deals a full game for the given seats: randomly chooses which characters
 * fill each team slot, applies setup modifiers (Baron's +2 outsider/-2
 * townsfolk) only when the character granting them is actually drawn, and —
 * when a `redHerring` character (the Fortune Teller) is in play — picks its
 * red herring from the dealt good (non-evil) seats. Pure function: no
 * Supabase, nothing written. `applyDeal` in actions.ts writes the result.
 */
export function dealGame(script: Script, seats: SeatRow[]): DealResult {
	const base = baseComposition(seats.length);
	const byTeam = (t: Team) => script.characters.filter((c) => c.team === t);

	// Minions first: a setup modifier (Baron) only ever comes from a minion
	// in Trouble Brewing, so we need to know which minions are drawn before
	// finalising the townsfolk/outsider counts the rest of the deal uses.
	const minions = pickTeam(byTeam('minion'), base.minion);
	const setupMods = minions.filter((c) => c.setup).map((c) => c.setup!);
	const comp = setupMods.length ? applySetup(base, setupMods) : base;

	const demons = pickTeam(byTeam('demon'), comp.demon);
	const townsfolk = pickTeam(byTeam('townsfolk'), comp.townsfolk);
	const outsiders = pickTeam(byTeam('outsider'), comp.outsider);

	const pool = shuffled([...townsfolk, ...outsiders, ...minions, ...demons]);
	const seatOrder = shuffled(seats);

	const assignments = new Map<string, string>();
	seatOrder.forEach((seat, i) => {
		const character = pool[i];
		if (character) assignments.set(seat.id, character.id);
	});

	// The Drunk: swap their seat's assignment to a not-in-play Townsfolk
	// before anything downstream (red herring eligibility, the caller) ever
	// sees a `'drunk'` id in `assignments`.
	let drunk: DealResult['drunk'] = null;
	const drunkSeatId = [...assignments.entries()].find(([, cid]) => cid === 'drunk')?.[0];
	if (drunkSeatId) {
		const inPlayIds = new Set(assignments.values());
		const allTownsfolk = byTeam('townsfolk');
		const notInPlay = shuffled(allTownsfolk.filter((c) => !inPlayIds.has(c.id)));
		// Fallback (every Townsfolk in the script happens to already be in
		// play — only possible on a tiny/unusual script): reuse one that IS
		// in play rather than leave the Drunk with no cover story at all.
		const fake = notInPlay[0] ?? shuffled(allTownsfolk)[0];
		if (fake) {
			assignments.set(drunkSeatId, fake.id);
			drunk = { seatId: drunkSeatId, fakeCharacterId: fake.id };
		}
	}

	let redHerringSeatId: string | null = null;
	if (pool.some((c) => c.redHerring)) {
		const goodSeatIds = [...assignments.entries()]
			.filter(([, cid]) => {
				const team = script.characters.find((c) => c.id === cid)?.team;
				return team !== 'demon' && team !== 'minion';
			})
			.map(([seatId]) => seatId);
		if (goodSeatIds.length) {
			redHerringSeatId = goodSeatIds[Math.floor(Math.random() * goodSeatIds.length)];
		}
	}

	return { assignments, comp, redHerringSeatId, drunk };
}
