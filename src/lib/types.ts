/**
 * types.ts — the shared domain vocabulary, mirroring the database schema
 * in db/schema.sql. Keep the two in step.
 */

import type { PhaseKind } from './clock';

export type Team = 'townsfolk' | 'outsider' | 'minion' | 'demon' | 'traveller' | 'fabled';

/** A single character in a script. Ability text is paraphrased or Storyteller-entered — never the official wording. */
export interface Character {
	id: string;
	name: string;
	team: Team;
	/** Paraphrased summary of what the character does, for the Storyteller's reference. */
	summary: string;
	/** Relative position in the first-night wake order; null = does not act on the first night. */
	firstNight: number | null;
	/** Relative position in the every-other-night wake order; null = does not act on later nights. */
	otherNight: number | null;
	/** How the Storyteller's night-dispatch screen should behave for this character. */
	prompt: NightPrompt;
	/** Adjustment to the team composition when this character is in play (Baron, etc.). */
	setup?: SetupModifier;
	/** True for day-only or passive abilities the Storyteller tracks by hand. */
	daySide?: boolean;
	/** Gets a red herring assigned at deal time (Fortune Teller). */
	redHerring?: boolean;
	/** Extra gate on top of firstNight/otherNight: this character's wake step
	 * only appears once the seat is actually dead (Ravenkeeper — "if you die
	 * at night"), and only once (not repeated on every later night). See
	 * wakeOrder() in nightInfo.ts and the filtering in NightDispatch.svelte. */
	wakeIfDead?: boolean;
	/** A player-initiated, in-person "go privately ask the Storyteller"
	 * ability that isn't tied to the night wake order (Savant, Fisherman,
	 * Artist, Amnesiac's daily guess). Reuses the existing meet-request
	 * queue — see requestMeet()/resolveMeet() in actions.ts and dayAsk.ts —
	 * rather than a new mechanism, since the real exchange happens face to
	 * face and the app's only job is to flag the request and (for
	 * Savant/Fisherman) prep the Storyteller with worked suggestions before
	 * they walk over. */
	dayAsk?: DayAskKind;
}

/** Which flavour of "player asks, Storyteller answers in person" this is —
 * decides the tag on the meet-request and what (if anything) dayAsk.ts
 * prepares for the Storyteller. See Character.dayAsk. */
export type DayAskKind =
	| { kind: 'savant' } // one true + one false statement, once per day
	| { kind: 'fisherman'; oncePerGame: true } // one-time actionable advice
	| { kind: 'artist'; oncePerGame: true } // one-time private yes/no/unknown question
	| { kind: 'amnesiac' }; // daily guess at their own Storyteller-assigned ability

export type NightPrompt =
	| { kind: 'none' } // passive; nothing to send
	| { kind: 'info-preplan' } // Storyteller writes the info ahead of time (Washerwoman…)
	| { kind: 'info-auto'; compute: 'chef' | 'empath' | 'undertaker' | 'balloonist' } // app suggests, Storyteller confirms
	| { kind: 'choose'; count: 1 | 2; canPickSelf: boolean } // player picks seat(s) (Monk, Fortune Teller…)
	| { kind: 'grimoire' }; // show the grimoire (Spy)

export interface SetupModifier {
	townsfolk?: number;
	outsider?: number;
	minion?: number;
	demon?: number;
}

export interface Script {
	id: string;
	name: string;
	author: string;
	minPlayers: number;
	maxPlayers: number;
	characters: Character[];
	/** Whether the evil team wakes together on Night 1 to learn each other
	 * (the Demon learns its Minions plus not-in-play bluffs; Minions learn
	 * the Demon and their fellow Minions) — true for every official script,
	 * but explicitly false for some Teensyville scripts (Laissez un Faire:
	 * "the evil team does not learn who each other are"). Defaults to true
	 * when omitted, so existing scripts don't need to set it. See
	 * night1EvilReveals() and choicePromptFor() in nightInfo.ts. */
	evilTeamKnowsEachOther?: boolean;
}

/** Base team composition for the three official scripts, by player count (5–15). */
export interface Composition {
	townsfolk: number;
	outsider: number;
	minion: number;
	demon: number;
}

// ---- database row shapes ----

export interface GameRow {
	id: string;
	join_code: string;
	script_id: string;
	storyteller_id: string;
	phase_kind: PhaseKind;
	phase_cycle: number;
	phase_started_at: string; // timestamptz
	phase_duration_ms: number;
	phase_paused_at: string | null;
	phase_paused_accum_ms: number;
	gather: boolean;
	gather_reason: string | null;
	composition: Composition | null;
	created_at: string;
}

export interface SeatRow {
	id: string;
	game_id: string;
	seat_index: number;
	name: string;
	user_id: string | null;
	alive: boolean;
	ghost_vote_available: boolean;
}

/** Secret: readable only by the seat's own device and the Storyteller. */
export interface SeatRoleRow {
	seat_id: string;
	game_id: string;
	character_id: string;
}

/** Storyteller-only working notes and status tokens for a seat. */
export interface GrimoireRow {
	seat_id: string;
	game_id: string;
	real_character_id: string | null;
	tokens: unknown;
	notes: string;
	is_red_herring: boolean;
}

export interface NightActionRow {
	id: string;
	game_id: string;
	night: number;
	seat_id: string;
	character_id: string;
	prompt: string;
	choices: unknown;
	result: string | null;
	released_at: string | null;
}

export interface MeetRequestRow {
	id: string;
	game_id: string;
	seat_id: string;
	reason: string | null;
	status: 'waiting' | 'met' | 'dismissed';
	created_at: string;
}

export type NominationStage = 'debate' | 'voting' | 'closed';

/** One nomination's accusation/defense/vote cycle — see nominations table
 * and the RPCs in db/schema.sql (open_nomination, start_voting,
 * close_nomination). Only one is ever open (stage <> 'closed') per game. */
export interface NominationRow {
	id: string;
	game_id: string;
	cycle: number;
	nominee_seat_id: string;
	nominator_seat_id: string | null;
	stage: NominationStage;
	debate_seconds: number | null;
	debate_started_at: string;
	voting_started_at: string | null;
	resolved_at: string | null;
	executed: boolean;
	created_at: string;
}

/** A raised hand on a nomination — presence of the row is the "yes" vote,
 * there's no explicit "no". Written only via cast_vote()/retract_vote(). */
export interface VoteRow {
	nomination_id: string;
	seat_id: string;
	is_ghost: boolean;
	created_at: string;
}

export interface DayLogRow {
	id: string;
	game_id: string;
	cycle: number;
	kind: 'nomination' | 'vote' | 'execution' | 'death' | 'note';
	payload: unknown;
	created_at: string;
}

export interface PlayerNoteRow {
	seat_id: string;
	game_id: string;
	body: string;
	prime_suspect_seat_id: string | null;
	updated_at: string;
}
