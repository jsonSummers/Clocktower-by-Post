/**
 * dayAsk.ts — Storyteller prep for the "player quietly walks over and asks
 * the Storyteller something" abilities (Savant, Fisherman; Artist and the
 * Amnesiac's daily guess need no prep, see below) that some scripts have,
 * starting with Laissez un Faire.
 *
 * These aren't run through night_actions at all — the real exchange happens
 * face to face, in person, same as "ask to see the Storyteller" already
 * does elsewhere in this app (see requestMeet()/resolveMeet() in actions.ts
 * and the Requests queue on the Storyteller's page). This module only
 * proposes a couple of worked examples so the Storyteller has something
 * ready before they walk over — nothing here is ever sent to the player.
 */
import type { SeatRow, Team } from './types';
import type { NightContext } from './nightInfo';

export interface DayAskCandidate {
	label: string;
	text: string;
}

export interface DayAskPrep {
	/** What to keep in mind before answering — shown to the Storyteller only. */
	guidance: string;
	/** Worked examples to riff on, not to read verbatim. */
	candidates: DayAskCandidate[];
}

function seatLabel(s: SeatRow): string {
	return s.name || `Seat ${s.seat_index + 1}`;
}

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

function teamOf(ctx: NightContext, seatId: string): Team | null {
	const cid = ctx.roleOf(seatId);
	if (!cid) return null;
	return ctx.script.characters.find((c) => c.id === cid)?.team ?? null;
}

function isEvil(ctx: NightContext, seatId: string): boolean {
	const t = teamOf(ctx, seatId);
	return t === 'minion' || t === 'demon';
}

/**
 * Savant: normally one true, one false statement, every day, order
 * unspecified. When the Savant is poisoned/drunk, real rules let the
 * Storyteller give any mix — both true, both false, or the normal one-and-
 * one — since a poisoned Savant's info need not follow the usual rule at
 * all. `truthCount` picks that mix (defaults to the normal 1); both
 * statements are still built from real game state (a "false" one is a
 * genuine lie — the stated team is the opposite of that seat's real team),
 * so plugging either straight in is always legitimate.
 */
export function savantPrep(ctx: NightContext, variant = 0, truthCount: 0 | 1 | 2 = 1): DayAskPrep {
	const alive = ctx.seats.filter((s) => s.alive);
	const rng = seeded(`${ctx.askingSeatId}:savant:${variant}`);
	const seatA = pickOne(alive, rng);
	const seatB = pickOne(
		alive.filter((s) => s.id !== seatA?.id),
		rng
	);
	// Statement 1 is true whenever at least one statement should be (truthCount
	// 1 or 2); statement 2 is true only when both should be (truthCount 2).
	// Arbitrary which seat gets which slot when truthCount is 1 — the
	// Storyteller reads both without saying which is which anyway.
	const wants: [SeatRow | undefined, boolean][] = [
		[seatA, truthCount >= 1],
		[seatB, truthCount >= 2]
	];
	const candidates: DayAskCandidate[] = [];
	wants.forEach(([seat, wantTrue], i) => {
		if (!seat) return;
		const evil = isEvil(ctx, seat.id);
		const claimEvil = wantTrue ? evil : !evil;
		candidates.push({
			label: `Statement ${i + 1} (${wantTrue ? 'true' : 'false'})`,
			text: `${seatLabel(seat)} is ${claimEvil ? 'evil' : 'good'}.`
		});
	});
	const mixNote =
		truthCount === 1
			? 'Give exactly one true and one false statement, in either order, without saying which is which.'
			: truthCount === 2
				? 'Poisoned/drunk: give two TRUE statements today, without saying so.'
				: 'Poisoned/drunk: give two FALSE statements today, without saying so.';
	return {
		guidance: `${mixNote} Anything true/false is fine — these are just a ready pair.`,
		candidates
	};
}

/**
 * Fisherman: once per game, actionable advice rather than a fact. The wiki
 * is explicit — tell them what to DO, not what IS. These are phrasing
 * templates naming real living seats, not alignment claims.
 */
export function fishermanPrep(ctx: NightContext, variant = 0): DayAskPrep {
	const alive = ctx.seats.filter((s) => s.alive && s.id !== ctx.askingSeatId);
	const rng = seeded(`${ctx.askingSeatId}:fisherman:${variant}`);
	const a = pickOne(alive, rng);
	const b = pickOne(
		alive.filter((s) => s.id !== a?.id),
		rng
	);
	const candidates: DayAskCandidate[] = [];
	if (a) candidates.push({ label: 'Push an execution', text: `Consider putting ${seatLabel(a)} up for execution today.` });
	if (b) candidates.push({ label: 'Hold off', text: `Hold off on executing ${seatLabel(b)} today — there's more to learn first.` });
	candidates.push({ label: 'Stay quiet', text: "Don't reveal your character to anyone yet." });
	return {
		guidance:
			"Give advice on what to DO, not a fact about who's what — e.g. who to execute or protect with suspicion, not their alignment. If the Fisherman is poisoned/drunk, the advice may be misleading instead.",
		candidates
	};
}

/**
 * Artist: a private yes/no/"I don't know" answer to a question THEY ask —
 * there's nothing to suggest ahead of time since the question is theirs,
 * just the reminder of how to answer honestly.
 */
export const ARTIST_GUIDANCE =
	'They ask a private yes/no question; answer honestly with "yes", "no", or "I don\'t know" — no elaboration.';
