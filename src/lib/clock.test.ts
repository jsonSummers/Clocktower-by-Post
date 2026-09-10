import { describe, it, expect } from 'vitest';
import {
	readClock,
	measureOffset,
	bestOffset,
	formatClock,
	phaseLabel,
	nextPhase,
	pause,
	resume,
	adjustDuration,
	type PhaseState
} from './clock';

const MIN = 60_000;

function night(overrides: Partial<PhaseState> = {}): PhaseState {
	return {
		kind: 'night',
		cycle: 1,
		startedAt: 1_000_000,
		durationMs: 12 * MIN,
		pausedAt: null,
		pausedAccumMs: 0,
		...overrides
	};
}

describe('readClock', () => {
	it('counts down while running, zero offset', () => {
		const phase = night();
		const view = readClock(phase, phase.startedAt + 2 * MIN, 0);
		expect(view.running).toBe(true);
		expect(view.elapsedMs).toBe(2 * MIN);
		expect(view.remainingMs).toBe(10 * MIN);
		expect(view.overrun).toBe(false);
	});

	it('applies the client/server offset', () => {
		const phase = night();
		// this device's clock is 5s behind the server
		const offset = 5_000;
		const view = readClock(phase, phase.startedAt + 2 * MIN, offset);
		expect(view.elapsedMs).toBe(2 * MIN + 5_000);
	});

	it('never reports negative elapsed before the phase starts', () => {
		const phase = night();
		const view = readClock(phase, phase.startedAt - 30_000, 0);
		expect(view.elapsedMs).toBe(0);
		expect(view.remainingMs).toBe(12 * MIN);
	});

	it('reports overrun once past the planned end', () => {
		const phase = night({ durationMs: 10 * MIN });
		const view = readClock(phase, phase.startedAt + 11 * MIN, 0);
		expect(view.remainingMs).toBe(-1 * MIN);
		expect(view.overrun).toBe(true);
	});

	it('freezes while paused', () => {
		const phase = night({ pausedAt: 1_000_000 + 3 * MIN });
		const later = readClock(phase, phase.startedAt + 20 * MIN, 0);
		expect(later.running).toBe(false);
		expect(later.elapsedMs).toBe(3 * MIN);
		expect(later.remainingMs).toBe(9 * MIN);
	});

	it('excludes accumulated paused time', () => {
		const phase = night({ pausedAccumMs: 4 * MIN });
		const view = readClock(phase, phase.startedAt + 10 * MIN, 0);
		expect(view.elapsedMs).toBe(6 * MIN);
	});

	it('open-ended phase counts up with no remaining', () => {
		const phase = night({ durationMs: 0 });
		const view = readClock(phase, phase.startedAt + 7 * MIN, 0);
		expect(view.remainingMs).toBeNull();
		expect(view.overrun).toBe(false);
		expect(view.elapsedMs).toBe(7 * MIN);
	});

	it('lobby and ended phases are not running', () => {
		expect(readClock(night({ kind: 'lobby' }), 2_000_000, 0).running).toBe(false);
		expect(readClock(night({ kind: 'ended' }), 2_000_000, 0).running).toBe(false);
	});
});

describe('measureOffset / bestOffset', () => {
	it('recovers a known offset from a symmetric round trip', () => {
		// client sends at 0, receives at 100 (100ms RTT). Server clock is 10s ahead:
		// at the trip midpoint (client t=50) the server reads 10_050.
		const offset = measureOffset(0, 10_050, 100);
		expect(offset).toBe(10_000);
	});

	it('bestOffset picks the sample with the smallest round trip', () => {
		const samples: Array<[number, number, number]> = [
			[0, 10_500, 1000], // 1000ms RTT, noisy
			[2000, 12_030, 2060], // 60ms RTT, clean -> offset 10_000
			[5000, 15_400, 5800] // 800ms RTT
		];
		expect(bestOffset(samples)).toBe(10_000);
	});

	it('bestOffset returns 0 with no samples', () => {
		expect(bestOffset([])).toBe(0);
	});
});

describe('formatClock', () => {
	it('formats remaining time as m:ss', () => {
		expect(formatClock({ running: true, elapsedMs: 65_000, remainingMs: 125_000, overrun: false })).toBe(
			'2:05'
		);
	});
	it('prefixes overrun with +', () => {
		expect(formatClock({ running: true, elapsedMs: 0, remainingMs: -47_000, overrun: true })).toBe(
			'+0:47'
		);
	});
	it('falls back to elapsed for open-ended phases', () => {
		expect(formatClock({ running: true, elapsedMs: 90_000, remainingMs: null, overrun: false })).toBe(
			'1:30'
		);
	});
});

describe('phase transitions', () => {
	it('labels phases', () => {
		expect(phaseLabel(night({ kind: 'lobby', cycle: 0 }))).toBe('Lobby');
		expect(phaseLabel(night({ kind: 'day', cycle: 2 }))).toBe('Day 2');
		expect(phaseLabel(night({ cycle: 3 }))).toBe('Night 3');
	});

	it('lobby -> night 1 -> day 1 -> night 2', () => {
		const lobby: PhaseState = {
			kind: 'lobby',
			cycle: 0,
			startedAt: 0,
			durationMs: 0,
			pausedAt: null,
			pausedAccumMs: 0
		};
		const n1 = nextPhase(lobby, 100, 12 * MIN);
		expect(n1).toMatchObject({ kind: 'night', cycle: 1, startedAt: 100 });
		const d1 = nextPhase(n1, 200, 30 * MIN);
		expect(d1).toMatchObject({ kind: 'day', cycle: 1 });
		const n2 = nextPhase(d1, 300, 12 * MIN);
		expect(n2).toMatchObject({ kind: 'night', cycle: 2 });
	});

	it('pause then resume folds the gap into pausedAccumMs', () => {
		let phase = night();
		phase = pause(phase, phase.startedAt + 2 * MIN);
		expect(phase.pausedAt).not.toBeNull();
		phase = resume(phase, phase.startedAt + 5 * MIN);
		expect(phase.pausedAt).toBeNull();
		expect(phase.pausedAccumMs).toBe(3 * MIN);

		// 8 minutes of wall-clock after start, but 3 were paused -> 5 elapsed
		const view = readClock(phase, phase.startedAt + 8 * MIN, 0);
		expect(view.elapsedMs).toBe(5 * MIN);
	});

	it('double pause and stray resume are no-ops', () => {
		const running = night();
		expect(resume(running, 123).pausedAccumMs).toBe(0);
		const paused = pause(running, 500);
		expect(pause(paused, 999).pausedAt).toBe(500);
	});

	it('adjustDuration clamps at zero', () => {
		expect(adjustDuration(night(), 3 * MIN).durationMs).toBe(15 * MIN);
		expect(adjustDuration(night(), -100 * MIN).durationMs).toBe(0);
	});
});
