/**
 * amnesiac-abilities.ts — a starter deck of ready-made secret abilities for
 * the Amnesiac (Laissez un Faire). Per the character's own real rules, the
 * Storyteller picks (or writes) the Amnesiac's true ability in secret before
 * the game starts, then privately runs it for them all game — the player
 * never sees this file or its contents, only the Storyteller does.
 *
 * Design guidance from the actual rules text: aim for something genuinely
 * guessable through play (an information-gathering power the player can
 * accumulate clues about), a little stronger than a typical Townsfolk to
 * offset the deduction difficulty, and distinct from any character actually
 * in play this game (to avoid a confusing duplicate). Every entry here is
 * an original, paraphrased ability — never another character's real name or
 * official wording — and deliberately avoids the game's real character
 * names so it can't be mistaken for one of them.
 *
 * `runAs` is a hint for HOW the Storyteller runs it mechanically, not
 * something the app automates — see the "Amnesiac" section of the host
 * page for why: this character's whole point is Storyteller improvisation,
 * closer to how a physical game already runs it than something worth
 * force-fitting into the structured night-dispatch flow.
 */

export interface AmnesiacAbility {
	id: string;
	/** Short private label for the Storyteller's own reference — never shown to the player. */
	name: string;
	/** The actual secret ability text, paraphrased and ready to run as-is. */
	text: string;
	/** How it's run: 'nightly' (wake them most/every night with something),
	 * 'once' (a single-use power, any time the Storyteller allows it), or
	 * 'passive' (no waking at all — purely something the Storyteller tracks
	 * and occasionally acts on, e.g. reacting to a death). */
	runAs: 'nightly' | 'once' | 'passive';
	/** A one-line steer for what a good day-guess should sound like, so the
	 * Storyteller can judge "Cold/Warm/Hot/Bingo" consistently. */
	guessHint: string;
}

export const AMNESIAC_ABILITIES: AmnesiacAbility[] = [
	{
		id: 'neighbour-alignment',
		name: 'Neighbour read',
		text: 'Each night, you learn whether the player to your left is good or evil.',
		runAs: 'nightly',
		guessHint: 'Guesses in the shape of "I learn something about a specific neighbour" are warm-to-hot.'
	},
	{
		id: 'not-the-demon',
		name: 'Elimination ping',
		text: 'Each night, you learn one living player who is definitely not the Demon.',
		runAs: 'nightly',
		guessHint: 'Guesses about "ruling players out" or "learning who is safe" are warm-to-hot.'
	},
	{
		id: 'evil-pair-count',
		name: 'Evil proximity count',
		text: 'Each night, you learn how many players within 2 seats of you (either direction) are evil.',
		runAs: 'nightly',
		guessHint: 'Guesses mentioning a number, a count, or "nearby players" are warm-to-hot.'
	},
	{
		id: 'one-shot-reveal',
		name: 'Delayed reveal',
		text: 'Once per game, at night, choose a player: you learn their character.',
		runAs: 'once',
		guessHint: 'Guesses about "finding out someone\'s exact role" are hot; guessing it\'s repeatable is cold.'
	},
	{
		id: 'death-echo',
		name: 'Death echo',
		text: 'Each time a player dies, you learn their alignment (good or evil), but not who they were.',
		runAs: 'passive',
		guessHint: 'Guesses tied to "when someone dies" or "after an execution/kill" are warm-to-hot.'
	},
	{
		id: 'first-night-townsfolk-count',
		name: 'Townsfolk census',
		text: 'On the first night, you learn how many Townsfolk are sitting next to another Townsfolk.',
		runAs: 'once',
		guessHint: 'Guesses about "counting Townsfolk neighbours" or a one-time first-night fact are warm-to-hot.'
	},
	{
		id: 'protective-hunch',
		name: 'Protective hunch',
		text: 'Each night, choose a player. If the Demon kills them tonight, you learn that it happened (but not who the Demon is).',
		runAs: 'nightly',
		guessHint: 'Guesses about "protecting" or "watching over" someone, without actually stopping the kill, are warm-to-hot.'
	},
	{
		id: 'silent-slayer',
		name: 'Silent shot',
		text: 'Once per game, during the day, privately tell the Storyteller a player you suspect is the Demon. If correct, the Storyteller quietly notes it but nothing happens publicly yet — you learn only "correct" or "incorrect".',
		runAs: 'once',
		guessHint: 'Guesses shaped like "I get to accuse the Demon privately" or a one-time gamble are hot.'
	},
	{
		id: 'rotating-empath',
		name: 'Rotating empath',
		text: "Each night, you learn whether a specific living player (a different one each night, Storyteller's choice) is good or evil.",
		runAs: 'nightly',
		guessHint: 'Guesses about learning one player\'s alignment per night, rotating around the circle, are warm-to-hot.'
	},
	{
		id: 'outsider-sense',
		name: 'Outsider sense',
		text: 'On the first night, you learn how many Outsiders are in play (but not who).',
		runAs: 'once',
		guessHint: 'Guesses about "a count of a character type" on the first night are warm-to-hot.'
	},
	{
		id: 'no-ability',
		name: 'True to the name',
		text: 'You have no ability at all — you really are just an ordinary Townsfolk who thinks they forgot one.',
		runAs: 'passive',
		guessHint: 'A guess of "I have no ability" is Bingo the moment they say it — a fun rare option, use sparingly.'
	}
];

export function getAmnesiacAbility(id: string): AmnesiacAbility | undefined {
	return AMNESIAC_ABILITIES.find((a) => a.id === id);
}
