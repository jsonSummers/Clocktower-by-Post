import type { Character, Script } from '../types';
import { troubleBrewing } from './trouble-brewing';
import { laissezUnFaire } from './laissez-un-faire';

/** Every script the app knows about. Add new scripts here. */
export const SCRIPTS: Script[] = [troubleBrewing, laissezUnFaire];

export function getScript(id: string): Script | undefined {
	return SCRIPTS.find((s) => s.id === id);
}

export function getCharacter(script: Script, characterId: string): Character | undefined {
	return script.characters.find((c) => c.id === characterId);
}

/**
 * Reverse lookup: which script a character id belongs to, without the
 * caller already knowing which script it's on -- used by Avatar.svelte to
 * pick the right portrait frame (gothic arch vs. brass porthole) purely
 * from a character id. Character ids are unique across every script in
 * SCRIPTS (checked at write-time, not enforced at runtime), so this is
 * unambiguous.
 */
export function scriptForCharacter(characterId: string): Script | undefined {
	return SCRIPTS.find((s) => s.characters.some((c) => c.id === characterId));
}

/**
 * The order the Storyteller's night-dispatch screen should walk, for a given
 * night. `first` selects the first-night order; otherwise the every-other-night
 * order. Characters that don't act on that night are excluded.
 */
export function nightOrder(script: Script, first: boolean): Character[] {
	return script.characters
		.filter((c) => (first ? c.firstNight : c.otherNight) !== null)
		.sort((a, b) => {
			const av = (first ? a.firstNight : a.otherNight) as number;
			const bv = (first ? b.firstNight : b.otherNight) as number;
			return av - bv;
		});
}

export { troubleBrewing, laissezUnFaire };
