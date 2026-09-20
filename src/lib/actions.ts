import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhaseKind } from './clock';
import type { DealResult } from './scripts/deal';

/**
 * Thin wrappers around the writes each screen makes. Every one takes the client
 * to act as, so the simulator can drive them as different players.
 */

// ---- seats / grimoire (Storyteller) ----

export function setSeatName(c: SupabaseClient, seatId: string, name: string) {
	return c.from('seats').update({ name }).eq('id', seatId);
}

/** Marking a seat dead grants a fresh, unused ghost vote (the official rule);
 * reviving a seat leaves ghost_vote_available alone since it doesn't apply
 * while alive. */
export function setSeatAlive(c: SupabaseClient, seatId: string, alive: boolean) {
	const patch: { alive: boolean; ghost_vote_available?: boolean } = { alive };
	if (!alive) patch.ghost_vote_available = true;
	return c.from('seats').update(patch).eq('id', seatId);
}

/** Storyteller toggles whether a dead seat still has their one-time ghost vote. */
export function setGhostVoteAvailable(c: SupabaseClient, seatId: string, available: boolean) {
	return c.from('seats').update({ ghost_vote_available: available }).eq('id', seatId);
}

export function assignRole(
	c: SupabaseClient,
	gameId: string,
	seatId: string,
	characterId: string | null
) {
	if (!characterId) return c.from('seat_roles').delete().eq('seat_id', seatId);
	return c
		.from('seat_roles')
		.upsert({ seat_id: seatId, game_id: gameId, character_id: characterId });
}

export function setGrimoireNote(c: SupabaseClient, gameId: string, seatId: string, notes: string) {
	return c.from('grimoire').upsert({ seat_id: seatId, game_id: gameId, notes });
}

/** Storyteller marks a seat as secretly the Drunk: `fakeCharacterId` is what
 * that seat's own screen and everyone else's continues to show (the caller
 * is responsible for actually assigning it via `assignRole` — this only
 * records the true identity, which `grimoire` RLS keeps Storyteller-only). */
export function setDrunk(c: SupabaseClient, gameId: string, seatId: string) {
	return c
		.from('grimoire')
		.upsert({ seat_id: seatId, game_id: gameId, real_character_id: 'drunk' }, { onConflict: 'seat_id' });
}

/** Storyteller undoes setDrunk — the seat's displayed character stays
 * whatever it currently is (a separate assignRole call to actually change it
 * back is the caller's choice, not this one's). */
export function clearDrunk(c: SupabaseClient, seatId: string) {
	return c.from('grimoire').update({ real_character_id: null }).eq('seat_id', seatId);
}

/** Storyteller marks a seat as the Fortune Teller's red herring — clears any
 * previous one first, since only one seat can hold it at a time (same rule
 * applyDeal() follows when a Fortune Teller is auto-dealt). */
export async function setRedHerring(c: SupabaseClient, gameId: string, seatId: string) {
	const { error: clearErr } = await c
		.from('grimoire')
		.update({ is_red_herring: false })
		.eq('game_id', gameId);
	if (clearErr) return { error: clearErr };
	return c
		.from('grimoire')
		.upsert({ seat_id: seatId, game_id: gameId, is_red_herring: true }, { onConflict: 'seat_id' });
}

/** Storyteller clears the red herring without assigning a new one. */
export function clearRedHerring(c: SupabaseClient, gameId: string) {
	return c.from('grimoire').update({ is_red_herring: false }).eq('game_id', gameId);
}

/**
 * Writes a dealGame() result to the database: replaces every seat_roles row
 * for the game, clears any previous red herring and Drunk marker and sets
 * the new ones, records the composition actually used (accounting for
 * Baron's swing if it was drawn), and clears night_actions so a redeal
 * starts night info fresh. Storyteller-only, per the same RLS every other
 * write here relies on.
 */
export async function applyDeal(c: SupabaseClient, gameId: string, result: DealResult) {
	const { error: clearRolesErr } = await c.from('seat_roles').delete().eq('game_id', gameId);
	if (clearRolesErr) return { error: clearRolesErr };

	const { error: clearHerringErr } = await c
		.from('grimoire')
		.update({ is_red_herring: false, real_character_id: null })
		.eq('game_id', gameId);
	if (clearHerringErr) return { error: clearHerringErr };

	const { error: clearActionsErr } = await c.from('night_actions').delete().eq('game_id', gameId);
	if (clearActionsErr) return { error: clearActionsErr };

	const rows = [...result.assignments.entries()].map(([seat_id, character_id]) => ({
		seat_id,
		game_id: gameId,
		character_id
	}));
	if (rows.length) {
		const { error } = await c.from('seat_roles').insert(rows);
		if (error) return { error };
	}

	if (result.redHerringSeatId) {
		const { error } = await c
			.from('grimoire')
			.upsert(
				{ seat_id: result.redHerringSeatId, game_id: gameId, is_red_herring: true },
				{ onConflict: 'seat_id' }
			);
		if (error) return { error };
	}

	if (result.drunk) {
		const { error } = await setDrunk(c, gameId, result.drunk.seatId);
		if (error) return { error };
	}

	return c.from('games').update({ composition: result.comp }).eq('id', gameId);
}

// ---- seat lifecycle ----

/** Storyteller reorders the circle: swap a seat with its ring-neighbour. */
export function moveSeat(c: SupabaseClient, seatId: string, direction: 'up' | 'down') {
	return c.rpc('move_seat', { p_seat_id: seatId, p_direction: direction });
}

/** Storyteller frees a seat (clears the claim, name, role, pending requests). */
export function kickSeat(c: SupabaseClient, seatId: string) {
	return c.rpc('kick_seat', { p_seat_id: seatId });
}

/** A player gives up their own seat, e.g. to let someone else take it. */
export function leaveSeat(c: SupabaseClient, seatId: string) {
	return c.rpc('leave_seat', { p_seat_id: seatId });
}

/** A player names or renames themselves — the only field a device may write on its own seat. */
export function setMyName(c: SupabaseClient, seatId: string, name: string) {
	return c.rpc('set_my_name', { p_seat_id: seatId, p_name: name });
}

// ---- meet requests ----

export function requestMeet(
	c: SupabaseClient,
	gameId: string,
	seatId: string,
	reason: string | null
) {
	return c.from('meet_requests').insert({ game_id: gameId, seat_id: seatId, reason });
}

export function resolveMeet(c: SupabaseClient, id: string, status: 'met' | 'dismissed') {
	return c.from('meet_requests').update({ status }).eq('id', id);
}

// ---- phase control (Storyteller) — server stamps the timestamps ----

export const phase = {
	set: (c: SupabaseClient, gameId: string, kind: PhaseKind, cycle: number, durationMs: number) =>
		c.rpc('set_phase', {
			p_game_id: gameId,
			p_kind: kind,
			p_cycle: cycle,
			p_duration_ms: Math.max(0, Math.round(durationMs))
		}),
	pause: (c: SupabaseClient, gameId: string) => c.rpc('pause_phase', { p_game_id: gameId }),
	resume: (c: SupabaseClient, gameId: string) => c.rpc('resume_phase', { p_game_id: gameId }),
	adjust: (c: SupabaseClient, gameId: string, deltaMs: number) =>
		c.rpc('adjust_duration', { p_game_id: gameId, p_delta_ms: deltaMs }),
	gather: (c: SupabaseClient, gameId: string, on: boolean, reason: string | null) =>
		c.rpc('set_gather', { p_game_id: gameId, p_on: on, p_reason: on ? reason : null })
};

// ---- night dispatch (Storyteller drafts info; players answer choose-type prompts) ----

/** Storyteller sends finished info straight to a seat for this night — creates or overwrites that seat's row. */
export function sendNightInfo(
	c: SupabaseClient,
	gameId: string,
	night: number,
	seatId: string,
	characterId: string,
	promptText: string,
	resultText: string
) {
	return c.from('night_actions').upsert(
		{
			game_id: gameId,
			night,
			seat_id: seatId,
			character_id: characterId,
			prompt: promptText,
			choices: null,
			result: resultText,
			released_at: new Date().toISOString()
		},
		{ onConflict: 'game_id,night,seat_id' }
	);
}

/** Storyteller opens a choose-type prompt to a seat; the player then submits their pick via submitNightChoice.
 * `teammateSeatIds` (a subset of validSeatIds) are seats the asking player
 * already knows are fellow evil team members — see choicePromptFor() in
 * nightInfo.ts — so the player's own choice screen can flag them. */
export function askNightChoice(
	c: SupabaseClient,
	gameId: string,
	night: number,
	seatId: string,
	characterId: string,
	abilityText: string,
	validSeatIds: string[],
	teammateSeatIds: string[] = []
) {
	return c.from('night_actions').upsert(
		{
			game_id: gameId,
			night,
			seat_id: seatId,
			character_id: characterId,
			prompt: abilityText,
			choices: { ids: validSeatIds, teammateIds: teammateSeatIds },
			result: null,
			released_at: new Date().toISOString()
		},
		{ onConflict: 'game_id,night,seat_id' }
	);
}

/** A player answers their own released choose-type prompt — allowed once, while no answer is recorded yet. */
export function submitNightChoice(c: SupabaseClient, actionId: string, seatIds: string[]) {
	return c.from('night_actions').update({ result: JSON.stringify(seatIds) }).eq('id', actionId);
}

/** Storyteller lets a seat choose again (clears a submitted answer without clearing the prompt). */
export function reopenNightChoice(c: SupabaseClient, actionId: string) {
	return c.from('night_actions').update({ result: null }).eq('id', actionId);
}

/** Storyteller clears a seat's night action entirely, so it can be redrafted from scratch. */
export function clearNightAction(c: SupabaseClient, actionId: string) {
	return c.from('night_actions').delete().eq('id', actionId);
}

/** Storyteller appends a computed reveal onto an already-submitted choose-type
 * answer, without touching the picks (Fortune Teller's yes/no, Ravenkeeper's
 * revealed character) — reuses the one `result` field rather than a schema
 * change, since night_actions allows only one row per seat per night. */
export function sendChoiceReading(
	c: SupabaseClient,
	actionId: string,
	picks: string[],
	reading: string
) {
	return c.from('night_actions').update({ result: JSON.stringify({ picks, reading }) }).eq('id', actionId);
}

// ---- nominations / voting (day phase) ----
// See db/schema.sql's "nominations / voting" section for the full rules
// these RPCs enforce (one open nomination at a time, once-per-day-per-seat,
// ghost-vote gating). Executing the nominee is a separate, explicit call to
// the existing setSeatAlive() above — these functions only run the
// debate/vote mechanics, not the outcome.

/** Storyteller opens a nomination. `debateSeconds` is optional — purely a
 * countdown the UI can show; the Storyteller still moves the stage forward
 * by hand via startVoting(), nothing auto-advances. */
export function openNomination(
	c: SupabaseClient,
	gameId: string,
	nomineeSeatId: string,
	nominatorSeatId: string | null,
	debateSeconds: number | null
) {
	return c.rpc('open_nomination', {
		p_game_id: gameId,
		p_nominee_seat_id: nomineeSeatId,
		p_nominator_seat_id: nominatorSeatId,
		p_debate_seconds: debateSeconds
	});
}

/** Storyteller moves a nomination from debate into voting. */
export function startVoting(c: SupabaseClient, nominationId: string) {
	return c.rpc('start_voting', { p_nomination_id: nominationId });
}

/** A seat raises its hand — cast as whichever seat auth.uid() owns, server-side. */
export function castVote(c: SupabaseClient, nominationId: string) {
	return c.rpc('cast_vote', { p_nomination_id: nominationId });
}

/** A seat lowers its hand again before the vote closes. */
export function retractVote(c: SupabaseClient, nominationId: string) {
	return c.rpc('retract_vote', { p_nomination_id: nominationId });
}

/** Storyteller locks in the tally and spends any ghost votes used. */
export function closeNomination(c: SupabaseClient, nominationId: string) {
	return c.rpc('close_nomination', { p_nomination_id: nominationId });
}

/** Storyteller records the nomination as executed (the seat's alive flag is
 * flipped separately via setSeatAlive — this just tags which nomination
 * caused it, for the day's history). */
export function markExecuted(c: SupabaseClient, nominationId: string) {
	return c.from('nominations').update({ executed: true }).eq('id', nominationId);
}

/** Storyteller dismisses an open nomination without a vote (mis-click, or a
 * player withdraws it) — deletes it outright rather than closing with zero
 * votes, so it doesn't count against that seat's once-per-day limit. */
export function dismissNomination(c: SupabaseClient, nominationId: string) {
	return c.from('nominations').delete().eq('id', nominationId);
}

// ---- prep notes (Storyteller's pre-written drafts for an upcoming night) ----

/** Storyteller drafts or updates their private plan for what a seat will be
 * told on a given night — safe to call repeatedly while typing, there's no
 * separate create step. Works for a night that hasn't happened yet, so the
 * Storyteller can plan ahead during the day. */
export function savePrepNote(
	c: SupabaseClient,
	gameId: string,
	night: number,
	seatId: string,
	body: string
) {
	return c
		.from('prep_notes')
		.upsert(
			{ game_id: gameId, night, seat_id: seatId, body },
			{ onConflict: 'game_id,night,seat_id' }
		);
}

/** Tags a draft as already sent, once its wording has actually gone out as
 * that seat's night info — purely a "used" hint in the UI, nothing else
 * reads this back. */
export function markPrepNoteReleased(c: SupabaseClient, id: string) {
	return c.from('prep_notes').update({ released: true }).eq('id', id);
}

/** Storyteller fires the Virgin's ability: the nominator is executed instead
 * of the nominee, and the nomination closes with no debate/vote. Whether this
 * SHOULD fire is decided client-side by checkVirgin() (src/lib/scripts/virgin.ts)
 * — this action is only called from the explicit "Execute nominator instead
 * (Virgin)" button, same pattern as every other storyteller ruling here. The
 * RPC does the seat-death + nomination-close + day_log entry in one place. */
export function resolveVirgin(c: SupabaseClient, nominationId: string) {
	return c.rpc('resolve_virgin', { p_nomination_id: nominationId });
}
