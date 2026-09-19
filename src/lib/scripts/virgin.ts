import type { NominationRow, Script, SeatRoleRow } from '../types';

export interface VirginCheck {
	/** True if the official Virgin ability should fire for this nomination:
	 * it's the first time this seat has ever been nominated, the nominee
	 * holds the Virgin, and the nominator is a Townsfolk. */
	fires: boolean;
	/** The seat that would be executed instead of a normal debate/vote. */
	nominatorSeatId: string | null;
	/** Set when `fires` is false but the nominee IS the Virgin, so the
	 * Storyteller's screen can still explain why nothing special happens
	 * (e.g. "already nominated before", "nominator isn't a Townsfolk"). */
	reason: string | null;
}

const NOT_VIRGIN: VirginCheck = { fires: false, nominatorSeatId: null, reason: null };

/**
 * Read-only check for the Virgin's ability, mirroring checkWinCondition's
 * shape: it never writes anything and the Storyteller always makes the
 * final call (resolveVirgin() in actions.ts is a separate, explicit click).
 * "Is the nominator a Townsfolk" is a script-authored fact (Character.team),
 * so — same as checkWinCondition — that lookup happens here in the app
 * layer rather than in the database, which only knows character ids as
 * plain text.
 */
export function checkVirgin(
	nomination: NominationRow,
	allNominations: NominationRow[],
	roles: SeatRoleRow[],
	script: Script | undefined
): VirginCheck {
	const nomineeCharacterId = roles.find(
		(r) => r.seat_id === nomination.nominee_seat_id
	)?.character_id;
	if (nomineeCharacterId !== 'virgin') return NOT_VIRGIN;

	const priorNominationOfVirgin = allNominations.some(
		(n) => n.nominee_seat_id === nomination.nominee_seat_id && n.id !== nomination.id
	);
	if (priorNominationOfVirgin) {
		return {
			fires: false,
			nominatorSeatId: null,
			reason: "The Virgin has already been nominated before — the ability only ever triggers once."
		};
	}

	if (!nomination.nominator_seat_id) {
		return {
			fires: false,
			nominatorSeatId: null,
			reason: "No nominator is recorded for this nomination, so there's no one for the ability to execute."
		};
	}

	const nominatorCharacterId = roles.find(
		(r) => r.seat_id === nomination.nominator_seat_id
	)?.character_id;
	const nominatorTeam = script?.characters.find((c) => c.id === nominatorCharacterId)?.team;
	if (nominatorTeam !== 'townsfolk') {
		return {
			fires: false,
			nominatorSeatId: nomination.nominator_seat_id,
			reason: "The nominator isn't a Townsfolk, so the Virgin's ability doesn't trigger — this nomination proceeds normally."
		};
	}

	return { fires: true, nominatorSeatId: nomination.nominator_seat_id, reason: null };
}
