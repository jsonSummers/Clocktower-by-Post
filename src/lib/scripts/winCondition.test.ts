import { describe, it, expect } from 'vitest';
import { checkWinCondition, voteState } from './winCondition';
import type { Script, SeatRow, SeatRoleRow } from '../types';

function seat(i: number, opts: Partial<SeatRow> = {}): SeatRow {
	return {
		id: `s${i}`,
		game_id: 'g',
		seat_index: i,
		name: `P${i}`,
		user_id: `u${i}`,
		alive: true,
		ghost_vote_available: true,
		...opts
	};
}

function role(seatId: string, characterId: string): SeatRoleRow {
	return { seat_id: seatId, game_id: 'g', character_id: characterId };
}

const script: Script = {
	id: 'trouble-brewing',
	name: 'Trouble Brewing',
	author: 'test',
	minPlayers: 5,
	maxPlayers: 15,
	characters: [
		{
			id: 'washerwoman',
			name: 'Washerwoman',
			team: 'townsfolk',
			summary: '',
			firstNight: 1,
			otherNight: null,
			prompt: { kind: 'info-preplan' }
		},
		{
			id: 'imp',
			name: 'Imp',
			team: 'demon',
			summary: '',
			firstNight: null,
			otherNight: 1,
			prompt: { kind: 'grimoire' }
		}
	]
};

describe('checkWinCondition', () => {
	it('no winner before roles are dealt', () => {
		const seats = [seat(0), seat(1), seat(2)];
		const result = checkWinCondition(seats, [], script);
		expect(result.winner).toBeNull();
	});

	it('good wins once the Demon is dead', () => {
		const seats = [seat(0), seat(1), seat(2, { alive: false }), seat(3), seat(4)];
		const roles = [
			role('s0', 'washerwoman'),
			role('s1', 'washerwoman'),
			role('s2', 'imp'),
			role('s3', 'washerwoman'),
			role('s4', 'washerwoman')
		];
		const result = checkWinCondition(seats, roles, script);
		expect(result.winner).toBe('good');
		expect(result.aliveDemons).toHaveLength(0);
	});

	it('evil wins once only two players are left alive', () => {
		const seats = [
			seat(0, { alive: false }),
			seat(1, { alive: false }),
			seat(2),
			seat(3),
			seat(4, { alive: false })
		];
		const roles = [
			role('s0', 'washerwoman'),
			role('s1', 'washerwoman'),
			role('s2', 'imp'),
			role('s3', 'washerwoman'),
			role('s4', 'washerwoman')
		];
		const result = checkWinCondition(seats, roles, script);
		expect(result.winner).toBe('evil');
		expect(result.aliveDemons).toHaveLength(1);
	});

	it('a single seated Demon seat is both "two or fewer alive" and a live Demon — evil wins', () => {
		const seats = [seat(0)];
		const roles = [role('s0', 'imp')];
		const result = checkWinCondition(seats, roles, script);
		expect(result.winner).toBe('evil');
	});

	it('ignores open (unclaimed) seats entirely', () => {
		const seats = [seat(0), seat(1, { user_id: null, alive: true })];
		const roles = [role('s0', 'imp')];
		const result = checkWinCondition(seats, roles, script);
		// only s0 is seated; a lone seated Demon is <=2 alive -> evil wins
		expect(result.winner).toBe('evil');
		expect(result.aliveCount).toBe(1);
	});
});

describe('voteState', () => {
	it('majority is more than half the alive seated players', () => {
		const seats = [seat(0), seat(1), seat(2), seat(3), seat(4), seat(5), seat(6)];
		expect(voteState(seats).votesToExecute).toBe(4);
	});

	it('rounds up for an even number alive', () => {
		const seats = [seat(0), seat(1), seat(2), seat(3), seat(4), seat(5)];
		expect(voteState(seats).votesToExecute).toBe(4);
	});

	it('counts dead seats with an unused ghost vote as extra possible votes', () => {
		const seats = [
			seat(0),
			seat(1),
			seat(2, { alive: false, ghost_vote_available: true }),
			seat(3, { alive: false, ghost_vote_available: false })
		];
		const v = voteState(seats);
		expect(v.aliveCount).toBe(2);
		expect(v.ghostVoteSeats).toHaveLength(1);
		expect(v.ghostVoteSeats[0].seatId).toBe('s2');
		expect(v.maxPossibleVotes).toBe(3);
	});

	it('ignores open seats', () => {
		const seats = [seat(0), seat(1, { user_id: null })];
		expect(voteState(seats).aliveCount).toBe(1);
	});
});
