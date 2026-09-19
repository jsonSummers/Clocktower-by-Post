-- ============================================================================
--  Clocktower by Post — incremental addition: Virgin ability (resolve_virgin)
-- ----------------------------------------------------------------------------
--  Paste this into the Supabase SQL editor (Dashboard → SQL → New query) and
--  run it once. Non-destructive: adds one new function only, no tables,
--  policies, or data touched.
--
--  Implements the official Virgin ability: "The first time she is nominated,
--  if the nominator is a Townsfolk, that nominator is executed instead."
--  Previously this character existed only as a card definition (name/summary)
--  with no actual game logic anywhere in the app.
--
--  This function does the execution + closes the nomination; the *decision*
--  of whether it should fire is made client-side by checkVirgin() in
--  src/lib/scripts/virgin.ts (mirrors how win-condition checks work in this
--  app -- a pure read-only check, with the Storyteller always confirming via
--  an explicit button click, which is what actually calls this RPC).
--
--  Safe to re-run: uses CREATE OR REPLACE.
-- ============================================================================

create or replace function resolve_virgin(p_nomination_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
	v_game_id           uuid;
	v_nominee_seat_id   uuid;
	v_nominator_seat_id uuid;
	v_nominee_character text;
begin
	select game_id, nominee_seat_id, nominator_seat_id
	  into v_game_id, v_nominee_seat_id, v_nominator_seat_id
	  from nominations where id = p_nomination_id;

	if v_game_id is null or not is_storyteller(v_game_id) then
		raise exception 'not allowed';
	end if;
	if v_nominator_seat_id is null then
		raise exception 'this nomination has no recorded nominator';
	end if;

	select character_id into v_nominee_character
	  from seat_roles where game_id = v_game_id and seat_id = v_nominee_seat_id;
	if v_nominee_character is distinct from 'virgin' then
		raise exception 'the nominee is not the Virgin';
	end if;

	if exists (
		select 1 from nominations
		where nominee_seat_id = v_nominee_seat_id and id <> p_nomination_id
	) then
		raise exception 'the Virgin has already been nominated before -- this only fires once';
	end if;

	update seats set alive = false, ghost_vote_available = true
	where id = v_nominator_seat_id;

	update nominations set stage = 'closed', resolved_at = now()
	where id = p_nomination_id;

	insert into day_log (game_id, cycle, kind, payload)
	select game_id, cycle, 'virgin', jsonb_build_object(
		'nomination_id', id,
		'nominee_seat_id', nominee_seat_id,
		'nominator_seat_id', nominator_seat_id
	)
	from nominations where id = p_nomination_id;
end;
$$;
