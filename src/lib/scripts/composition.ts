import type { Composition, SetupModifier } from '../types';

/**
 * The standard team composition table shared by the three official scripts,
 * for 5–15 players. Index the array by player count.
 *
 * Teensyville (5–7) and Travellers (>15) follow looser, Storyteller-driven
 * conventions — the app computes a suggestion from this table and always lets
 * the Storyteller edit the final numbers.
 */
const TABLE: Record<number, Composition> = {
	5: { townsfolk: 3, outsider: 0, minion: 1, demon: 1 },
	6: { townsfolk: 3, outsider: 1, minion: 1, demon: 1 },
	7: { townsfolk: 5, outsider: 0, minion: 1, demon: 1 },
	8: { townsfolk: 5, outsider: 1, minion: 1, demon: 1 },
	9: { townsfolk: 5, outsider: 2, minion: 1, demon: 1 },
	10: { townsfolk: 7, outsider: 0, minion: 2, demon: 1 },
	11: { townsfolk: 7, outsider: 1, minion: 2, demon: 1 },
	12: { townsfolk: 7, outsider: 2, minion: 2, demon: 1 },
	13: { townsfolk: 9, outsider: 0, minion: 3, demon: 1 },
	14: { townsfolk: 9, outsider: 1, minion: 3, demon: 1 },
	15: { townsfolk: 9, outsider: 2, minion: 3, demon: 1 }
};

export const MIN_STANDARD_PLAYERS = 5;
export const MAX_STANDARD_PLAYERS = 15;

/** Base composition for a player count, clamped to the 5–15 table. */
export function baseComposition(playerCount: number): Composition {
	const n = Math.max(MIN_STANDARD_PLAYERS, Math.min(MAX_STANDARD_PLAYERS, Math.round(playerCount)));
	return { ...TABLE[n] };
}

/** Apply setup modifiers (Baron: +2 outsiders / -2 townsfolk, etc.), keeping the total fixed. */
export function applySetup(base: Composition, modifiers: SetupModifier[]): Composition {
	const result = { ...base };
	for (const m of modifiers) {
		result.townsfolk += m.townsfolk ?? 0;
		result.outsider += m.outsider ?? 0;
		result.minion += m.minion ?? 0;
		result.demon += m.demon ?? 0;
	}
	// A modifier that adds Outsiders removes Townsfolk to compensate, unless the
	// script author already balanced it. Clamp to non-negative and let the
	// Storyteller fix anything odd.
	result.townsfolk = Math.max(0, result.townsfolk);
	result.outsider = Math.max(0, result.outsider);
	result.minion = Math.max(0, result.minion);
	result.demon = Math.max(0, result.demon);
	return result;
}

export function compositionTotal(c: Composition): number {
	return c.townsfolk + c.outsider + c.minion + c.demon;
}
