import type { SeatRow } from './types';

export interface Neighbours {
	/** Nearest living seat toward lower seat_index (wrapping around the ring). */
	ccw: SeatRow | null;
	/** Nearest living seat toward higher seat_index (wrapping around the ring). */
	cw: SeatRow | null;
}

/**
 * The two living neighbours of a seat — the nearest living player on each side,
 * skipping the dead, walking around the ring. When only one other player is
 * alive, both sides are that same player. When the seat is the last one alive,
 * both are null.
 *
 * Seat order is `seat_index`; the ring wraps from the highest index back to 0.
 */
export function livingNeighbours(seats: SeatRow[], seatId: string): Neighbours {
	const ring = [...seats].sort((a, b) => a.seat_index - b.seat_index);
	const n = ring.length;
	const idx = ring.findIndex((s) => s.id === seatId);
	if (n === 0 || idx === -1) return { ccw: null, cw: null };

	const at = (i: number) => ring[((i % n) + n) % n];

	const walk = (dir: 1 | -1): SeatRow | null => {
		for (let k = 1; k < n; k++) {
			const seat = at(idx + dir * k);
			if (seat.id === seatId) break;
			if (seat.alive) return seat;
		}
		return null;
	};

	return { ccw: walk(-1), cw: walk(1) };
}

/**
 * x/y coordinates (0..1, origin top-left) for `count` seats evenly spaced on a
 * circle, seat 0 at the top, going clockwise. `radius` is a fraction of the
 * box half-width so labels near the edge still fit.
 */
export function seatLayout(count: number, radius = 0.5): Array<{ x: number; y: number }> {
	const out: Array<{ x: number; y: number }> = [];
	for (let i = 0; i < count; i++) {
		const angle = -Math.PI / 2 + (i / count) * Math.PI * 2;
		out.push({ x: 0.5 + radius * Math.cos(angle), y: 0.5 + radius * Math.sin(angle) });
	}
	return out;
}

/**
 * Ring distance between two seats, in seats, the short way round (0 for the
 * same seat, 1 for immediate neighbours, up to floor(n/2) for the seat
 * furthest around). Ignores alive/dead — used for decoy-proximity choices,
 * where a dead seat is just as valid a pairing as a living one.
 */
export function circleDistance(seats: SeatRow[], seatIdA: string, seatIdB: string): number {
	const ring = [...seats].sort((a, b) => a.seat_index - b.seat_index);
	const n = ring.length;
	const i = ring.findIndex((s) => s.id === seatIdA);
	const j = ring.findIndex((s) => s.id === seatIdB);
	if (n === 0 || i === -1 || j === -1) return 0;
	const raw = Math.abs(i - j);
	return Math.min(raw, n - raw);
}

/** Count of pairs of adjacent living seats where both are flagged evil (Chef-style). */
export function adjacentPairs(seats: SeatRow[], isEvil: (s: SeatRow) => boolean): number {
	const ring = [...seats].sort((a, b) => a.seat_index - b.seat_index).filter((s) => s.alive);
	const n = ring.length;
	if (n < 2) return 0;
	let pairs = 0;
	for (let i = 0; i < n; i++) {
		const a = ring[i];
		const b = ring[(i + 1) % n];
		if (n === 2 && i === 1) break; // don't double-count the single pair in a 2-ring
		if (isEvil(a) && isEvil(b)) pairs++;
	}
	return pairs;
}
