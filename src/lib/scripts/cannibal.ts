/**
 * cannibal.ts — the Cannibal's "gains the ability of the recently executed
 * player" assignment (Laissez un Faire). Structurally the same idea as the
 * Amnesiac's "secretly IS another character" (amnesiac-abilities.ts): the
 * Storyteller records which character's mechanics this seat now runs, and
 * NightDispatch.svelte gives them a real nightly wake step for it via the
 * same mimicWakeStep() helper (nightInfo.ts) — automatic info candidates
 * when the inherited character has any, a real choose-prompt sent to their
 * phone when it doesn't, exactly like anyone genuinely playing that role.
 *
 * Per the real rules ("If they are evil, you are poisoned until a good
 * player dies"), the default assignment is always literally whichever
 * character was actually executed — including an evil one, deliberately not
 * restricted the way the Amnesiac's mimic list is (see setCannibalAbility()
 * in the host page's Seats tab), since inheriting an evil ability while
 * poisoned (the Storyteller is free to lie about what it reports) is the
 * correctly-modelled outcome, not a mistake to prevent. The one Storyteller
 * override this module supports is "they were actually bluffing as ___":
 * a Minion doesn't have a townsfolk-shaped ability worth inheriting, so
 * letting the Cannibal take the character the Minion publicly claimed to be
 * instead is the practical fix Mickey's group actually wants — the poison
 * still applies either way, since the executed player really was evil.
 */

export interface CannibalAssignment {
	/** The character id whose mechanics this seat now runs. */
	inherits: string;
	/** True once the Storyteller has been told the poison applies (executed
	 * player was evil) — purely informational, doesn't gate anything; the
	 * actual poison status lives in poison.ts's grimoire tokens, which is
	 * what NightDispatch/the Seats tab actually check. */
	poisoned: boolean;
}

const CANNIBAL_NOTE_PREFIX = '[Cannibal] ';

export function encodeCannibalNote(a: CannibalAssignment): string {
	return CANNIBAL_NOTE_PREFIX + JSON.stringify(a);
}

export function parseCannibalNote(note: string | null | undefined): CannibalAssignment | null {
	if (!note || !note.startsWith(CANNIBAL_NOTE_PREFIX)) return null;
	try {
		const v: unknown = JSON.parse(note.slice(CANNIBAL_NOTE_PREFIX.length));
		if (v && typeof v === 'object' && typeof (v as { inherits?: unknown }).inherits === 'string') {
			const obj = v as { inherits: string; poisoned?: unknown };
			return { inherits: obj.inherits, poisoned: obj.poisoned === true };
		}
	} catch {
		/* malformed — treat as unset */
	}
	return null;
}
