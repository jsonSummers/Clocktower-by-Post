import type { PhaseState } from './clock';
import type { GameRow } from './types';

/** Turn a games row into the PhaseState the clock logic works with. */
export function phaseFromGame(g: GameRow): PhaseState {
	return {
		kind: g.phase_kind,
		cycle: g.phase_cycle,
		startedAt: Date.parse(g.phase_started_at),
		durationMs: Number(g.phase_duration_ms),
		pausedAt: g.phase_paused_at ? Date.parse(g.phase_paused_at) : null,
		pausedAccumMs: Number(g.phase_paused_accum_ms)
	};
}
