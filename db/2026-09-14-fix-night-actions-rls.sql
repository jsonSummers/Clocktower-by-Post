-- ============================================================================
--  Clocktower by Post — incremental fix: night_actions_update RLS
-- ----------------------------------------------------------------------------
--  Paste this into the Supabase SQL editor (Dashboard → SQL → New query) and
--  run it once. Non-destructive: touches only one policy, no tables or data.
--
--  The bug (already fixed in db/schema.sql and committed/pushed to GitHub as
--  of commit 6f6a462, but never applied to this live project): the
--  night_actions_update policy had no explicit `with check`, so Postgres
--  reused the `using` clause — which requires `result is null` — against the
--  UPDATED row too. That means the moment a player's write actually set
--  `result`, Postgres re-checked "is result still null?", found it wasn't,
--  and rejected the write with "new row violates row-level security policy
--  for table night_actions". Reproduced live in this session: a Monk
--  couldn't submit their protection choice and got exactly that error.
--
--  This has nothing to do with the app's own confirm-choice UI code — the UI
--  was always doing the right thing; the database was silently refusing the
--  write underneath it.
-- ============================================================================

drop policy if exists night_actions_update on night_actions;

create policy night_actions_update on night_actions for update
	using (
		is_storyteller(game_id)
		or (owns_seat(seat_id) and released_at is not null and result is null)
	)
	with check (
		is_storyteller(game_id) or owns_seat(seat_id)
	);
