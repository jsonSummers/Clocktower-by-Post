/**
 * poison.ts — a small per-seat status-token system, layered on grimoire's
 * `tokens` jsonb column (already in db/schema.sql, previously unused by any
 * app code). Just one status so far (poisoned), covering two sources with
 * very different lifetimes:
 *
 *   - the Widow's chosen victim: poisoned for as long as the Widow's own
 *     seat stays alive — fully derivable from live game state, so nothing
 *     ever has to actively "clear" it; poisonStatus() just naturally stops
 *     returning true the moment it's re-evaluated after the Widow dies.
 *   - the Cannibal, having inherited an evil player's ability: poisoned
 *     "until a good player dies" — the app has no full death-history log to
 *     derive that from (see nightInfo.ts's Undertaker/Balloonist doc
 *     comments for the same standing gap), so this one is a plain
 *     Storyteller-toggled flag, cleared by hand.
 *
 * Either way "poisoned" only ever changes what the Storyteller is free to
 * make up for that seat's info (see nightInfo.ts's numberCandidates() "if
 * poisoned" alternates) — nothing here sends anything on its own.
 */
import type { GrimoireRow, SeatRow } from './types';

export type SeatToken =
	| { kind: 'poisoned'; source: 'widow'; sourceSeatId: string }
	| { kind: 'poisoned'; source: 'cannibal' };

export function parseTokens(raw: unknown): SeatToken[] {
	return Array.isArray(raw) ? (raw as SeatToken[]) : [];
}

export interface PoisonStatus {
	poisoned: boolean;
	/** Short human-readable reason, for the Storyteller-facing badge. Null when not poisoned. */
	reason: string | null;
	/** Which token is driving `poisoned`, so callers can removeToken() it
	 * without parsing `reason`. Null when not poisoned. */
	source: SeatToken['source'] | null;
}

/** Whether a seat is currently poisoned, and why. Re-derived from live state
 * every call — see the module doc above for why that matters for the Widow
 * case in particular. */
export function poisonStatus(seatId: string, grimoire: GrimoireRow[], seats: SeatRow[]): PoisonStatus {
	const tokens = parseTokens(grimoire.find((g) => g.seat_id === seatId)?.tokens);
	for (const t of tokens) {
		if (t.kind !== 'poisoned') continue;
		if (t.source === 'widow') {
			const widowSeat = seats.find((s) => s.id === t.sourceSeatId);
			if (widowSeat?.alive) {
				return {
					poisoned: true,
					reason: `poisoned by the Widow (${widowSeat.name || 'their seat'})`,
					source: 'widow'
				};
			}
			continue; // the Widow's dead — this one's lapsed; keep checking other tokens
		}
		if (t.source === 'cannibal') {
			return {
				poisoned: true,
				reason: 'poisoned — inherited an evil ability, until a good player dies',
				source: 'cannibal'
			};
		}
	}
	return { poisoned: false, reason: null, source: null };
}

/** Adds a token, replacing any existing one with the same (kind, source) —
 * never duplicates. Pass a grimoire row's raw `tokens` value in. */
export function addToken(existingTokens: unknown, token: SeatToken): SeatToken[] {
	const tokens = parseTokens(existingTokens).filter(
		(t) => !(t.kind === token.kind && t.source === token.source)
	);
	tokens.push(token);
	return tokens;
}

/** Removes every token matching this (kind, source) pair. */
export function removeToken(
	existingTokens: unknown,
	kind: SeatToken['kind'],
	source: SeatToken['source']
): SeatToken[] {
	return parseTokens(existingTokens).filter((t) => !(t.kind === kind && t.source === source));
}
