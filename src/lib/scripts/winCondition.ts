import type { Script, SeatRow, SeatRoleRow } from '../types';

export type Winner = 'good' | 'evil' | null;

export interface AliveDemon {
	seatId: string;
	seatName: string;
	characterId: string;
}

export interface WinState {
	winner: Winner;
	/** Human-readable reason, e.g. "The Demon is dead." Null while no one has won yet. */
	reason: string | null;
	/** Seated (claimed) seats currently alive — open seats never count. */
	aliveCount: number;
	/** Living Demon-team seats, so the Storyteller can double check before declaring. */
	aliveDemons: AliveDemon[];
}

/**
 * Computes the two script-agnostic Trouble Brewing win conditions from live
 * seat/role state:
 *   - Good wins once no living seat holds a Demon-team character.
 *   - Evil wins once only two seated players are left alive.
 * This deliberately does not know about script-specific extra conditions
 * (e.g. "evil also wins if the Saint is executed") — those stay a
 * Storyteller call. Nothing here writes to the database or ends the game on
 * its own; it's a read-only check for the Storyteller's screen to surface.
 */
export function checkWinCondition(
	seats: SeatRow[],
	roles: SeatRoleRow[],
	script: Script | undefined
): WinState {
	const seated = seats.filter((s) => s.user_id !== null);
	const alive = seated.filter((s) => s.alive);

	const aliveDemons: AliveDemon[] = [];
	for (const seat of alive) {
		const roleId = roles.find((r) => r.seat_id === seat.id)?.character_id;
		if (!roleId) continue;
		const char = script?.characters.find((c) => c.id === roleId);
		if (char?.team === 'demon') {
			aliveDemons.push({ seatId: seat.id, seatName: seat.name, characterId: roleId });
		}
	}

	// Only declare good's win once roles have actually been dealt — before
	// that, "no living Demon" just means nobody's been assigned one yet, not
	// that the Demon died.
	const rolesDealt = roles.length > 0;

	if (seated.length > 0 && rolesDealt && aliveDemons.length === 0) {
		return { winner: 'good', reason: 'The Demon is dead.', aliveCount: alive.length, aliveDemons };
	}
	if (seated.length > 0 && alive.length <= 2) {
		return {
			winner: 'evil',
			reason: 'Only two players are left alive.',
			aliveCount: alive.length,
			aliveDemons
		};
	}
	return { winner: null, reason: null, aliveCount: alive.length, aliveDemons };
}

export interface GhostVoteSeat {
	seatId: string;
	seatName: string;
}

export interface VoteState {
	/** Seated players currently alive. */
	aliveCount: number;
	/** More than half the alive players, rounded up — the official threshold to execute. */
	votesToExecute: number;
	/** Dead seats that still hold their one-time ghost vote. */
	ghostVoteSeats: GhostVoteSeat[];
	/** Alive count plus every remaining ghost vote — the most votes that could ever be cast. */
	maxPossibleVotes: number;
}

/**
 * Majority-vote and ghost-vote bookkeeping for the Storyteller to reference
 * while running an in-person nomination. The threshold is fixed by the
 * number of *living* seated players (dead players' ghost votes are extra
 * votes on top, not part of the base the majority is measured against).
 */
export function voteState(seats: SeatRow[]): VoteState {
	const seated = seats.filter((s) => s.user_id !== null);
	const alive = seated.filter((s) => s.alive);
	const ghostVoteSeats = seated
		.filter((s) => !s.alive && s.ghost_vote_available)
		.map((s) => ({ seatId: s.id, seatName: s.name }));
	return {
		aliveCount: alive.length,
		votesToExecute: Math.floor(alive.length / 2) + 1,
		ghostVoteSeats,
		maxPossibleVotes: alive.length + ghostVoteSeats.length
	};
}
