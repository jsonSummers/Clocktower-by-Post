-- ============================================================================
--  Clocktower by Post — incremental fix: add missing nominations/votes tables
-- ----------------------------------------------------------------------------
--  Paste this into the Supabase SQL editor (Dashboard → SQL → New query) and
--  run it once. Unlike db/schema.sql, this is NOT destructive: it only adds
--  the two tables `nominations` and `votes` (and the RLS policies, realtime
--  registration, and functions that depend on them), which were defined in
--  db/schema.sql but never actually applied to this project — that's why
--  the Vote tab's queries have been 404ing. Every other table in schema.sql
--  (games, seats, seat_roles, grimoire, night_actions, prep_notes,
--  meet_requests, day_log, player_notes) already exists live and is left
--  untouched by this script; existing game data is not affected.
--
--  Safe to re-run: functions use CREATE OR REPLACE, policies are dropped
--  and recreated, and the realtime registration is guarded.
-- ============================================================================

-- ---- tables ----------------------------------------------------------------

create table if not exists nominations (
	id                     uuid primary key default gen_random_uuid(),
	game_id                uuid not null references games(id) on delete cascade,
	cycle                  int  not null,
	nominee_seat_id        uuid not null references seats(id) on delete cascade,
	nominator_seat_id      uuid references seats(id) on delete set null,
	stage                  text not null default 'debate'
	                         check (stage in ('debate','voting','closed')),
	debate_seconds         int,
	debate_started_at      timestamptz not null default now(),
	voting_started_at      timestamptz,
	resolved_at            timestamptz,
	executed               boolean not null default false,
	created_at             timestamptz not null default now()
);
create index if not exists nominations_game_idx on nominations(game_id, cycle);

create table if not exists votes (
	nomination_id          uuid not null references nominations(id) on delete cascade,
	seat_id                uuid not null references seats(id) on delete cascade,
	is_ghost               boolean not null default false,
	created_at             timestamptz not null default now(),
	primary key (nomination_id, seat_id)
);

-- ---- functions (SECURITY DEFINER, mirrors db/schema.sql) -------------------

create or replace function open_nomination(
	p_game_id uuid,
	p_nominee_seat_id uuid,
	p_nominator_seat_id uuid default null,
	p_debate_seconds int default null
)
returns nominations
language plpgsql security definer set search_path = public as $$
declare
	v_cycle int;
	v_row   nominations;
begin
	if not is_storyteller(p_game_id) then
		raise exception 'not the storyteller';
	end if;
	select phase_cycle into v_cycle from games where id = p_game_id;
	if exists (
		select 1 from nominations where game_id = p_game_id and stage <> 'closed'
	) then
		raise exception 'a nomination is already open for this game';
	end if;
	if exists (
		select 1 from nominations
		where game_id = p_game_id and cycle = v_cycle and nominee_seat_id = p_nominee_seat_id
	) then
		raise exception 'this seat has already been nominated today';
	end if;

	insert into nominations (game_id, cycle, nominee_seat_id, nominator_seat_id, debate_seconds)
	values (p_game_id, v_cycle, p_nominee_seat_id, p_nominator_seat_id, p_debate_seconds)
	returning * into v_row;

	insert into day_log (game_id, cycle, kind, payload)
	values (
		p_game_id, v_cycle, 'nomination',
		jsonb_build_object(
			'nomination_id', v_row.id,
			'nominee_seat_id', p_nominee_seat_id,
			'nominator_seat_id', p_nominator_seat_id
		)
	);

	return v_row;
end;
$$;

create or replace function start_voting(p_nomination_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
	v_game_id uuid;
begin
	select game_id into v_game_id from nominations where id = p_nomination_id;
	if v_game_id is null or not is_storyteller(v_game_id) then
		raise exception 'not allowed';
	end if;
	update nominations set stage = 'voting', voting_started_at = now()
	where id = p_nomination_id and stage = 'debate';
end;
$$;

create or replace function cast_vote(p_nomination_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
	v_nom  nominations;
	v_seat seats;
begin
	select * into v_nom from nominations where id = p_nomination_id;
	if v_nom.id is null or v_nom.stage <> 'voting' then
		raise exception 'voting is not open';
	end if;
	select * into v_seat from seats where game_id = v_nom.game_id and user_id = auth.uid();
	if v_seat.id is null then
		raise exception 'you are not seated in this game';
	end if;
	if not v_seat.alive and not v_seat.ghost_vote_available then
		raise exception 'no ghost vote remaining';
	end if;
	insert into votes (nomination_id, seat_id, is_ghost)
	values (p_nomination_id, v_seat.id, not v_seat.alive)
	on conflict (nomination_id, seat_id) do nothing;
end;
$$;

create or replace function retract_vote(p_nomination_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
	v_seat_id uuid;
begin
	select s.id into v_seat_id
	from seats s join nominations n on n.game_id = s.game_id
	where n.id = p_nomination_id and s.user_id = auth.uid() and n.stage = 'voting';
	if v_seat_id is not null then
		delete from votes where nomination_id = p_nomination_id and seat_id = v_seat_id;
	end if;
end;
$$;

create or replace function close_nomination(p_nomination_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
	v_game_id uuid;
begin
	select game_id into v_game_id from nominations where id = p_nomination_id;
	if v_game_id is null or not is_storyteller(v_game_id) then
		raise exception 'not allowed';
	end if;
	update nominations set stage = 'closed', resolved_at = now() where id = p_nomination_id;
	update seats set ghost_vote_available = false
	where id in (
		select seat_id from votes where nomination_id = p_nomination_id and is_ghost
	);
	insert into day_log (game_id, cycle, kind, payload)
	select game_id, cycle, 'vote', jsonb_build_object(
		'nomination_id', id,
		'votes', (select count(*) from votes where nomination_id = p_nomination_id)
	)
	from nominations where id = p_nomination_id;
end;
$$;

-- ---- row-level security -----------------------------------------------

alter table nominations enable row level security;
alter table votes        enable row level security;

drop policy if exists nominations_select on nominations;
drop policy if exists nominations_insert on nominations;
drop policy if exists nominations_update on nominations;
drop policy if exists nominations_delete on nominations;

-- nominations: participants read (everyone should see what's being decided);
-- only the Storyteller writes directly (players act through the functions above).
create policy nominations_select on nominations for select using ( in_game(game_id) );
create policy nominations_insert on nominations for insert with check ( is_storyteller(game_id) );
create policy nominations_update on nominations for update using ( is_storyteller(game_id) );
create policy nominations_delete on nominations for delete using ( is_storyteller(game_id) );

drop policy if exists votes_select on votes;
drop policy if exists votes_storyteller_write on votes;

-- votes: everyone in the game can see who's raised a hand — voting is public
-- on purpose: writes go through cast_vote()/retract_vote() (SECURITY
-- DEFINER) for players, or directly by the Storyteller.
create policy votes_select on votes for select
	using ( exists (select 1 from nominations n where n.id = nomination_id and in_game(n.game_id)) );
create policy votes_storyteller_write on votes for all
	using ( exists (select 1 from nominations n where n.id = nomination_id and is_storyteller(n.game_id)) )
	with check ( exists (select 1 from nominations n where n.id = nomination_id and is_storyteller(n.game_id)) );

-- ---- realtime ---------------------------------------------------------

do $$
begin
	if not exists (
		select 1 from pg_publication_tables
		where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'nominations'
	) then
		alter publication supabase_realtime add table nominations;
	end if;
	if not exists (
		select 1 from pg_publication_tables
		where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'votes'
	) then
		alter publication supabase_realtime add table votes;
	end if;
end $$;
