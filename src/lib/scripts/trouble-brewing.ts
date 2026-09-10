import type { Script } from '../types';

/**
 * Trouble Brewing — the teaching script. 5–15 players.
 *
 * Ability summaries here are PARAPHRASED mechanics for the Storyteller's
 * reference, not the official card text. Night-order values are relative sort
 * keys entered by hand for a first pass — verify them against the official
 * night sheets or the community script-tool data before relying on them
 * (see the design brief, "Limits of this model").
 */
export const troubleBrewing: Script = {
	id: 'trouble-brewing',
	name: 'Trouble Brewing',
	author: 'The Pandemonium Institute',
	minPlayers: 5,
	maxPlayers: 15,
	characters: [
		// ---- Townsfolk ----
		{
			id: 'washerwoman',
			name: 'Washerwoman',
			team: 'townsfolk',
			summary: 'First night: learns that one of two shown players is a particular Townsfolk.',
			firstNight: 20,
			otherNight: null,
			prompt: { kind: 'info-preplan' }
		},
		{
			id: 'librarian',
			name: 'Librarian',
			team: 'townsfolk',
			summary:
				'First night: learns that one of two shown players is a particular Outsider — or that no Outsiders are in play.',
			firstNight: 21,
			otherNight: null,
			prompt: { kind: 'info-preplan' }
		},
		{
			id: 'investigator',
			name: 'Investigator',
			team: 'townsfolk',
			summary: 'First night: learns that one of two shown players is a particular Minion.',
			firstNight: 22,
			otherNight: null,
			prompt: { kind: 'info-preplan' }
		},
		{
			id: 'chef',
			name: 'Chef',
			team: 'townsfolk',
			summary: 'First night: learns how many pairs of evil players are sitting next to each other.',
			firstNight: 30,
			otherNight: null,
			prompt: { kind: 'info-auto', compute: 'chef' }
		},
		{
			id: 'empath',
			name: 'Empath',
			team: 'townsfolk',
			summary: 'Each night: learns how many of their two living neighbours are evil.',
			firstNight: 40,
			otherNight: 50,
			prompt: { kind: 'info-auto', compute: 'empath' }
		},
		{
			id: 'fortune-teller',
			name: 'Fortune Teller',
			team: 'townsfolk',
			summary:
				'Each night: picks two players and learns whether either reads as the Demon. One good player is a permanent false positive (the red herring).',
			firstNight: 41,
			otherNight: 51,
			prompt: { kind: 'choose', count: 2, canPickSelf: true }
		},
		{
			id: 'undertaker',
			name: 'Undertaker',
			team: 'townsfolk',
			summary: 'Each night except the first: learns which character was executed that day.',
			firstNight: null,
			otherNight: 40,
			prompt: { kind: 'info-auto', compute: 'undertaker' }
		},
		{
			id: 'monk',
			name: 'Monk',
			team: 'townsfolk',
			summary: 'Each night except the first: protects another player from the Demon that night.',
			firstNight: null,
			otherNight: 20,
			prompt: { kind: 'choose', count: 1, canPickSelf: false }
		},
		{
			id: 'ravenkeeper',
			name: 'Ravenkeeper',
			team: 'townsfolk',
			summary: 'If they die at night, they pick a player and learn that player’s character.',
			firstNight: null,
			otherNight: 35,
			prompt: { kind: 'choose', count: 1, canPickSelf: false }
		},
		{
			id: 'virgin',
			name: 'Virgin',
			team: 'townsfolk',
			summary:
				'The first time they are nominated, if the nominator is a Townsfolk, that nominator is executed instead.',
			firstNight: null,
			otherNight: null,
			prompt: { kind: 'none' },
			daySide: true
		},
		{
			id: 'slayer',
			name: 'Slayer',
			team: 'townsfolk',
			summary: 'Once per game, during the day, publicly chooses a player; if they are the Demon, they die.',
			firstNight: null,
			otherNight: null,
			prompt: { kind: 'none' },
			daySide: true
		},
		{
			id: 'soldier',
			name: 'Soldier',
			team: 'townsfolk',
			summary: 'Safe from the Demon.',
			firstNight: null,
			otherNight: null,
			prompt: { kind: 'none' }
		},
		{
			id: 'mayor',
			name: 'Mayor',
			team: 'townsfolk',
			summary:
				'If only three players live and no execution occurs, the good team wins. A Demon kill on the Mayor may be redirected.',
			firstNight: null,
			otherNight: null,
			prompt: { kind: 'none' }
		},

		// ---- Outsiders ----
		{
			id: 'butler',
			name: 'Butler',
			team: 'outsider',
			summary: 'Each night: picks a master. The Butler may only vote when their master is voting.',
			firstNight: 50,
			otherNight: 60,
			prompt: { kind: 'choose', count: 1, canPickSelf: false }
		},
		{
			id: 'drunk',
			name: 'Drunk',
			team: 'outsider',
			summary:
				'Does not know they are the Drunk. They think they are a Townsfolk, but their ability does nothing.',
			firstNight: null,
			otherNight: null,
			prompt: { kind: 'none' }
		},
		{
			id: 'recluse',
			name: 'Recluse',
			team: 'outsider',
			summary: 'Might register as evil, and as a Minion or Demon, even though they are good.',
			firstNight: null,
			otherNight: null,
			prompt: { kind: 'none' }
		},
		{
			id: 'saint',
			name: 'Saint',
			team: 'outsider',
			summary: 'If the Saint is executed, the good team loses.',
			firstNight: null,
			otherNight: null,
			prompt: { kind: 'none' },
			daySide: true
		},

		// ---- Minions ----
		{
			id: 'poisoner',
			name: 'Poisoner',
			team: 'minion',
			summary:
				'Each night: chooses a player. That player’s ability malfunctions until the following dusk.',
			firstNight: 10,
			otherNight: 10,
			prompt: { kind: 'choose', count: 1, canPickSelf: true }
		},
		{
			id: 'spy',
			name: 'Spy',
			team: 'minion',
			summary: 'Each night: sees the grimoire. Might register as good, and as a Townsfolk or Outsider.',
			firstNight: 60,
			otherNight: 70,
			prompt: { kind: 'grimoire' }
		},
		{
			id: 'scarlet-woman',
			name: 'Scarlet Woman',
			team: 'minion',
			summary:
				'If there are five or more players alive and the Demon dies, the Scarlet Woman becomes the Demon.',
			firstNight: null,
			otherNight: null,
			prompt: { kind: 'none' }
		},
		{
			id: 'baron',
			name: 'Baron',
			team: 'minion',
			summary: 'Adds two Outsiders to the game (and removes two Townsfolk) during setup.',
			firstNight: null,
			otherNight: null,
			prompt: { kind: 'none' },
			setup: { outsider: 2, townsfolk: -2 }
		},

		// ---- Demon ----
		{
			id: 'imp',
			name: 'Imp',
			team: 'demon',
			summary:
				'First night: learns the Minions and three not-in-play bluffs. Each night after: chooses a player to die; may pass the Demon on by choosing itself.',
			firstNight: 1,
			otherNight: 30,
			prompt: { kind: 'choose', count: 1, canPickSelf: true }
		}
	]
};
