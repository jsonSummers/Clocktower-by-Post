import type { Script } from '../types';

/**
 * Laissez un Faire — an official Teensyville (small-party) script by The
 * Pandemonium Institute. Ability summaries here are PARAPHRASED mechanics
 * for the Storyteller's reference, paraphrased from the character wiki, not
 * the official card text — same convention as trouble-brewing.ts. Night
 * order values are a first-pass relative ordering entered by hand (this
 * script's official night sheet wasn't available while building this) —
 * sanity-check them before a real game.
 *
 * Two things make this script meaningfully different from Trouble Brewing,
 * both handled in nightInfo.ts rather than here:
 *   - `evilTeamKnowsEachOther: false` below — per the real Teensyville
 *     design, the evil team does NOT wake together on Night 1 to learn each
 *     other, and the Demon gets no not-in-play bluffs either.
 *   - Several Townsfolk (Savant, Fisherman, Artist, the Amnesiac's daily
 *     guess) work by the player privately walking over to the Storyteller
 *     in person, any time — not through the structured night-dispatch
 *     queue. These use `dayAsk` (see types.ts) and reuse the existing
 *     "ask to see the Storyteller" meet-request queue rather than a new
 *     mechanism, since the real exchange is a face-to-face conversation the
 *     app was never going to relay anyway. See dayAsk.ts for the Storyteller
 *     prep this app *does* offer ahead of that conversation, and the
 *     "Amnesiac" section of the Storyteller's page for how that one
 *     character's secret ability gets chosen and tracked.
 *
 * A few abilities (Cannibal's borrowed ability, the Lunatic's fake Demon
 * night) are inherently Storyteller-improvised even in a physical game —
 * these are left as manual/free-text wake steps rather than force-fit into
 * automation that would fight the character's own design.
 */
export const laissezUnFaire: Script = {
	id: 'laissez-un-faire',
	name: 'Laissez un Faire',
	author: 'The Pandemonium Institute',
	minPlayers: 5,
	// The script's own pool tops out at 6 Townsfolk / 2 Outsiders / 2 Minions —
	// using this app's shared 5–15 composition table (composition.ts), 9
	// players (5 Townsfolk / 2 Outsiders / 1 Minion / 1 Demon) is the largest
	// count that still fits inside that pool. Pandemonium markets it for
	// "five or six" as the cosy Teensyville/party-favour count; this app
	// allows up to 9 since the maths still works cleanly.
	maxPlayers: 9,
	evilTeamKnowsEachOther: false,
	characters: [
		// ---- Townsfolk ----
		{
			id: 'balloonist',
			name: 'Balloonist',
			team: 'townsfolk',
			summary:
				'Each night: learns a player — a different character TYPE than whoever was shown the previous night.',
			firstNight: 20,
			otherNight: 20,
			prompt: { kind: 'info-auto', compute: 'balloonist' }
		},
		{
			id: 'savant',
			name: 'Savant',
			team: 'townsfolk',
			summary:
				'Any day, may privately visit the Storyteller to hear two things: one true, one false, unmarked.',
			firstNight: null,
			otherNight: null,
			prompt: { kind: 'none' },
			daySide: true,
			dayAsk: { kind: 'savant' }
		},
		{
			id: 'amnesiac',
			name: 'Amnesiac',
			team: 'townsfolk',
			summary:
				"Doesn't know their own ability — the Storyteller secretly assigns one at setup and runs it for them all game. Each day, may privately guess what it is and learn how close they are.",
			firstNight: null,
			otherNight: null,
			prompt: { kind: 'none' },
			daySide: true,
			dayAsk: { kind: 'amnesiac' }
		},
		{
			id: 'fisherman',
			name: 'Fisherman',
			team: 'townsfolk',
			summary: 'Once per game, during the day, may privately ask the Storyteller for advice on how to help their team win.',
			firstNight: null,
			otherNight: null,
			prompt: { kind: 'none' },
			daySide: true,
			dayAsk: { kind: 'fisherman', oncePerGame: true }
		},
		{
			id: 'artist',
			name: 'Artist',
			team: 'townsfolk',
			summary: 'Once per game, during the day, may privately ask the Storyteller any yes/no question and get an honest answer.',
			firstNight: null,
			otherNight: null,
			prompt: { kind: 'none' },
			daySide: true,
			dayAsk: { kind: 'artist', oncePerGame: true }
		},
		{
			id: 'cannibal',
			name: 'Cannibal',
			team: 'townsfolk',
			summary:
				"Gains the ability of the last player executed. If that player was evil, the Cannibal is poisoned instead (their belief of having an ability is false) until the next good player dies by execution. Storyteller-run: if the borrowed ability would wake at night, wake this seat manually and dispatch it as a free-text night action.",
			firstNight: null,
			otherNight: null,
			prompt: { kind: 'none' },
			daySide: true
		},

		// ---- Outsiders ----
		{
			id: 'mutant',
			name: 'Mutant',
			team: 'outsider',
			summary:
				"If they're 'mad' about being an Outsider — actively trying to convince others of it — the Storyteller may execute them, day or night.",
			firstNight: null,
			otherNight: null,
			prompt: { kind: 'none' },
			daySide: true
		},
		{
			id: 'lunatic',
			name: 'Lunatic',
			team: 'outsider',
			summary:
				"Secretly believes they're the Demon and plays a fake version of it — wakes and makes 'kill' choices with no real effect. The real Demon is told who the Lunatic is and what they chose each night. Fully Storyteller-run: on Night 1 give them fake Minions and bluffs by hand (free text); on later nights ask them to 'choose' and privately tell the real Demon their pick.",
			firstNight: 1,
			otherNight: 40,
			prompt: { kind: 'none' }
		},

		// ---- Minions ----
		{
			id: 'widow',
			name: 'Widow',
			team: 'minion',
			summary:
				'First night only: views the grimoire and chooses a player to poison for the rest of the game (until the Widow dies). One good player learns a Widow is in play. Storyteller: also show them the grimoire by hand (you already have it open on your own roster panel), and separately tell any one good player, in person, that a Widow is in play.',
			firstNight: 10,
			otherNight: null,
			prompt: { kind: 'choose', count: 1, canPickSelf: true }
		},
		{
			id: 'goblin',
			name: 'Goblin',
			team: 'minion',
			summary:
				"If they publicly claim to be the Goblin when nominated, and are executed that same day, evil wins immediately. A live, verbal claim — the Storyteller just needs to catch it and rule accordingly.",
			firstNight: null,
			otherNight: null,
			prompt: { kind: 'none' },
			daySide: true
		},

		// ---- Demon ----
		{
			id: 'leviathan',
			name: 'Leviathan',
			team: 'demon',
			summary:
				"Doesn't kill at night at all. Announce at setup (not night 1) that a Leviathan is in play — everyone knows from the start. Evil wins if more than one good player is ever executed, OR if the Leviathan is still alive at the end of day 5. Track executions and the day count by hand; nothing here is automated.",
			firstNight: null,
			otherNight: null,
			prompt: { kind: 'none' },
			daySide: true
		}
	]
};
