import { describe, it, expect } from 'vitest';
import { livingNeighbours, seatLayout, adjacentPairs } from './circle';
import type { SeatRow } from './types';

function seat(i: number, alive = true, id = `s${i}`): SeatRow {
	return {
		id,
		game_id: 'g',
		seat_index: i,
		name: `P${i}`,
		user_id: null,
		alive,
		ghost_vote_available: true
	};
}

describe('livingNeighbours', () => {
	it('adjacent seats when everyone is alive', () => {
		const seats = [seat(0), seat(1), seat(2), seat(3)];
		const nb = livingNeighbours(seats, 's1');
		expect(nb.ccw?.id).toBe('s0');
		expect(nb.cw?.id).toBe('s2');
	});

	it('wraps around the ring', () => {
		const seats = [seat(0), seat(1), seat(2), seat(3)];
		const nb = livingNeighbours(seats, 's0');
		expect(nb.ccw?.id).toBe('s3');
		expect(nb.cw?.id).toBe('s1');
	});

	it('skips the dead', () => {
		const seats = [seat(0), seat(1, false), seat(2, false), seat(3)];
		const nb = livingNeighbours(seats, 's0');
		expect(nb.ccw?.id).toBe('s3');
		expect(nb.cw?.id).toBe('s3');
	});

	it('both null when the seat is the last one alive', () => {
		const seats = [seat(0), seat(1, false), seat(2, false)];
		expect(livingNeighbours(seats, 's0')).toEqual({ ccw: null, cw: null });
	});

	it('unknown seat id gives nulls', () => {
		expect(livingNeighbours([seat(0), seat(1)], 'nope')).toEqual({ ccw: null, cw: null });
	});

	it('ignores array order, honours seat_index', () => {
		const seats = [seat(2), seat(0), seat(3), seat(1)];
		const nb = livingNeighbours(seats, 's2');
		expect(nb.ccw?.id).toBe('s1');
		expect(nb.cw?.id).toBe('s3');
	});
});

describe('seatLayout', () => {
	it('places seat 0 at top-centre', () => {
		const [first] = seatLayout(4);
		expect(first.x).toBeCloseTo(0.5, 5);
		expect(first.y).toBeCloseTo(0.0, 5);
	});
	it('returns one point per seat', () => {
		expect(seatLayout(7)).toHaveLength(7);
	});
});

describe('adjacentPairs', () => {
	const evilIds = (ids: string[]) => (s: SeatRow) => ids.includes(s.id);

	it('counts touching evil pairs', () => {
		const seats = [seat(0), seat(1), seat(2), seat(3), seat(4)];
		expect(adjacentPairs(seats, evilIds(['s1', 's2']))).toBe(1);
	});
	it('evil split apart counts zero', () => {
		const seats = [seat(0), seat(1), seat(2), seat(3), seat(4)];
		expect(adjacentPairs(seats, evilIds(['s1', 's3']))).toBe(0);
	});
	it('wraps: seat 0 and last seat are adjacent', () => {
		const seats = [seat(0), seat(1), seat(2), seat(3)];
		expect(adjacentPairs(seats, evilIds(['s0', 's3']))).toBe(1);
	});
	it('dead evil players do not form pairs', () => {
		const seats = [seat(0), seat(1, false), seat(2), seat(3)];
		expect(adjacentPairs(seats, evilIds(['s1', 's2']))).toBe(0);
	});
});
