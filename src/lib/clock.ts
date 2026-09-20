/**
 * clock.ts — the synced game clock.
 *
 * The server never sends a ticking number. It stores a small PhaseState
 * (when the phase started, how long it should run, whether it is paused).
 * Every device computes its own countdown from that, corrected by a one-time
 * estimate of how far its own clock differs from the server's.
 *
 * A short disconnect changes nothing: the device already knows when the
 * phase ends. This module is pure — no network, no DOM — so it can be
 * unit-tested exhaustively (see clock.test.ts).
 */

export type PhaseKind = 'lobby' | 'day' | 'night' | 'gather' | 'ended';

export interface PhaseState {
	kind: PhaseKind;
	/** 0 during lobby; otherwise the day/night number (day 1, night 1, day 2, …). */
	cycle: number;
	/** Server epoch-ms when this phase began running. */
	startedAt: number;
	/** Planned length in ms. 0 means open-ended (counts up, no target). */
	durationMs: number;
	/** Server epoch-ms when the Storyteller paused, or null if running. */
	pausedAt: number | null;
	/** Total ms already spent paused during this phase, before the current stretch. */
	pausedAccumMs: number;
}

export interface ClockView {
	/** True when the phase is actively counting (not lobby/ended/paused). */
	running: boolean;
	/** Milliseconds the phase has been active, excluding paused time. Never negative. */
	elapsedMs: number;
	/** Milliseconds left until the planned end. Null when the phase is open-ended. Negative when overrun. */
	remainingMs: number | null;
	/** True when a timed phase has passed its planned end but not yet been advanced. */
	overrun: boolean;
}

/**
 * Read the clock for a phase as of `clientNow` (Date.now() on this device).
 *
 * @param offsetMs  serverNow - clientNow, from measureOffset(). Add it to a
 *                  client timestamp to estimate the server's clock.
 */
export function readClock(phase: PhaseState, clientNow: number, offsetMs: number): ClockView {
	const serverNow = clientNow + offsetMs;
	const running = phase.pausedAt === null && phase.kind !== 'lobby' && phase.kind !== 'ended';

	// If paused, the clock is frozen at the moment of pausing.
	const referenceNow = phase.pausedAt ?? serverNow;
	const elapsedMs = Math.max(0, referenceNow - phase.startedAt - phase.pausedAccumMs);

	if (phase.durationMs <= 0) {
		return { running, elapsedMs, remainingMs: null, overrun: false };
	}

	const remainingMs = phase.durationMs - elapsedMs;
	return { running, elapsedMs, remainingMs, overrun: remainingMs < 0 };
}

/**
 * Estimate serverNow - clientNow using one request/response round trip,
 * NTP-style: assume the server read its clock at the midpoint of the trip.
 *
 * @param clientSentAt      Date.now() just before the request
 * @param serverEpochMs     server's clock when it handled the request
 * @param clientReceivedAt  Date.now() just after the response
 */
export function measureOffset(
	clientSentAt: number,
	serverEpochMs: number,
	clientReceivedAt: number
): number {
	const roundTripMs = clientReceivedAt - clientSentAt;
	const serverNowAtReceive = serverEpochMs + roundTripMs / 2;
	return serverNowAtReceive - clientReceivedAt;
}

/**
 * Take several offset samples and keep the most trustworthy one: the sample
 * with the smallest round trip has the least uncertainty. Pass the raw
 * samples as [clientSentAt, serverEpochMs, clientReceivedAt] tuples.
 */
export function bestOffset(samples: Array<[number, number, number]>): number {
	if (samples.length === 0) return 0;
	let best = samples[0];
	let bestRtt = best[2] - best[0];
	for (const s of samples) {
		const rtt = s[2] - s[0];
		if (rtt < bestRtt) {
			best = s;
			bestRtt = rtt;
		}
	}
	return measureOffset(best[0], best[1], best[2]);
}

/** "12:05", or "+0:47" once a timed phase has overrun. Open-ended phases show elapsed as "12:05". */
export function formatClock(view: ClockView): string {
	const ms = view.remainingMs ?? view.elapsedMs;
	const overrun = view.remainingMs !== null && view.remainingMs < 0;
	const total = Math.floor(Math.abs(ms) / 1000);
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return `${overrun ? '+' : ''}${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Human label for a phase, e.g. "Night 2", "Day 1", "Lobby". */
export function phaseLabel(phase: PhaseState): string {
	switch (phase.kind) {
		case 'lobby':
			return 'Lobby';
		case 'ended':
			return 'Game over';
		case 'gather':
			return 'Gather';
		case 'day':
			return `Day ${phase.cycle}`;
		case 'night':
			return `Night ${phase.cycle}`;
		default:
			return 'Unknown';
	}
}

/**
 * Given the current phase, produce the next one when the Storyteller advances.
 * lobby -> night 1 -> day 1 -> night 2 -> day 2 -> …  (gather and ended are set explicitly)
 */
export function nextPhase(phase: PhaseState, startedAt: number, durationMs: number): PhaseState {
	const base = { startedAt, durationMs, pausedAt: null, pausedAccumMs: 0 };
	if (phase.kind === 'lobby' || phase.kind === 'gather') {
		// gather is a detour; resume assumes we return to whatever cycle we were on
		const cycle = phase.cycle === 0 ? 1 : phase.cycle;
		return { kind: 'night', cycle, ...base };
	}
	if (phase.kind === 'night') {
		return { kind: 'day', cycle: phase.cycle, ...base };
	}
	// day -> next night
	return { kind: 'night', cycle: phase.cycle + 1, ...base };
}

/**
 * Apply a pause at server time `pausedAt`. No-op if already paused.
 */
export function pause(phase: PhaseState, pausedAt: number): PhaseState {
	if (phase.pausedAt !== null) return phase;
	return { ...phase, pausedAt };
}

/**
 * Resume at server time `resumedAt`, folding the paused stretch into pausedAccumMs.
 */
export function resume(phase: PhaseState, resumedAt: number): PhaseState {
	if (phase.pausedAt === null) return phase;
	const pausedFor = Math.max(0, resumedAt - phase.pausedAt);
	return { ...phase, pausedAt: null, pausedAccumMs: phase.pausedAccumMs + pausedFor };
}

/** Extend (or, with a negative value, trim) the planned length of the current phase. */
export function adjustDuration(phase: PhaseState, deltaMs: number): PhaseState {
	return { ...phase, durationMs: Math.max(0, phase.durationMs + deltaMs) };
}

/**
 * Milliseconds left in a nomination's debate window (NominationRow's
 * debate_started_at/debate_seconds — see db/schema.sql), synced the same
 * way as the phase clock above. Null when the nomination was opened with no
 * timer at all. Goes negative once the window has run out; this is purely a
 * Storyteller aid ("a timer might be helpful") — nothing here ends the
 * debate or advances anything on its own.
 */
export function debateRemainingMs(
	debateStartedAtIso: string,
	debateSeconds: number | null,
	clientNow: number,
	offsetMs: number
): number | null {
	if (debateSeconds == null) return null;
	const serverNow = clientNow + offsetMs;
	return debateSeconds * 1000 - (serverNow - Date.parse(debateStartedAtIso));
}
