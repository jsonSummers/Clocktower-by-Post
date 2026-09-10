-- ============================================================================
--  Clocktower by Post — database schema
-- ----------------------------------------------------------------------------
--  Paste this whole file into the Supabase SQL editor (Dashboard → SQL → New
--  query) and run it once. Re-running is safe: it drops and recreates.
--
--  Auth model: every device signs in anonymously, so auth.uid() is a stable
--  per-device id. The Storyteller is the device that created the game. Players
--  claim a seat via the join_game() function.
--
--  Row-level security is the real boundary — a player's device physically
--  cannot read the grimoire, another player's role, or anyone's private notes.
-- ============================================================================

-- ---- clean slate ----------------------------------------------------------
drop table if exists player_notes    cascade;
drop table if exists day_log         cascade;
drop table if exists meet_requests   cascade;
drop table if exists prep_notes      cascade;
drop table if exists night_actions   cascade;
drop table if exists grimoire        cascade;
drop table if exists seat_roles      cascade;
drop table if exists seats           cascade;
drop table if exists games           cascade;

drop function if exists is_storyteller(uuid) cascade;
drop function if exists in_game(uuid)        cascade;
drop function if exists owns_seat(uuid)      cascade;
drop function if exists server_now()         cascade;
drop function if exists create_game(text, int) cascade;
drop function if exists join_game(text, text)   cascade;
drop function if exists set_phase(uuid, text, int, bigint) cascade;
drop function if exists pause_phase(uuid)     cascade;
drop function if exists resume_phase(uuid)    cascade;
drop function if exists adjust_duration(uuid, bigint) cascade;
drop function if exists set_gather(uuid, boolean, text) cascade;
drop function if exists leave_seat(uuid)   cascade;
drop function if exists kick_seat(uuid)    cascade;
drop function if exists move_seat(uuid, text) cascade;
drop function if exists set_my_name(uuid, text) cascade;
drop function if exists touch_updated_at()   cascade;

-- ---- tables --------------------------------------------------------------

create table games (
	id                     uuid primary key default gen_random_uuid(),
	join_code              text not null unique,
	script_id              text not null,
	storyteller_id         uuid not null default auth.uid(),
	phase_kind             text not null default 'lobby'
	                         check (phase_kind in ('lobby','day','night','gather','ended')),
	phase_cycle            int  not null default 0,
	phase_started_at       timestamptz not null default now(),
	phase_duration_ms      bigint not null default 0,
	phase_paused_at        timestamptz,
	phase_paused_accum_ms  bigint not null default 0,
	gather                 boolean not null default false,
	gather_reason          text,
	composition            jsonb,
	created_at             timestamptz not null default now()
);

create table seats (
	id                     uuid primary key default gen_random_uuid(),
	game_id                uuid not null references games(id) on delete cascade,
	seat_index             int  not null,
	name                   text not null default '',
	user_id                uuid,
	alive                  boolean not null default true,
	ghost_vote_available   boolean not null default true,
	created_at             timestamptz not null default now(),
	unique (game_id, seat_index)
);
create index seats_game_idx on seats(game_id);
create index seats_user_idx on seats(user_id);

-- Secret character assignment, split from seats so RLS can hide it.
create table seat_roles (
	seat_id                uuid primary key references seats(id) on delete cascade,
	game_id                uuid not null references games(id) on delete cascade,
	character_id           text not null
);

-- Storyteller-only working state.
create table grimoire (
	seat_id                uuid primary key references seats(id) on delete cascade,
	game_id                uuid not null references games(id) on delete cascade,
	real_character_id      text,
	tokens                 jsonb not null default '[]'::jsonb,
	notes                  text not null default ''
);

create table night_actions (
	id                     uuid primary key default gen_random_uuid(),
	game_id                uuid not null references games(id) on delete cascade,
	night                  int  not null,
	seat_id                uuid not null references seats(id) on delete cascade,
	character_id           text not null,
	prompt                 text not null default '',
	choices                jsonb,
	result                 text,
	released_at            timestamptz,
	created_at             timestamptz not null default now(),
	unique (game_id, night, seat_id)
);
create index night_actions_game_idx on night_actions(game_id, night);

-- Storyteller's pre-written drafts. Players never see these; released info is
-- copied into night_actions.
create table prep_notes (
	id                     uuid primary key default gen_random_uuid(),
	game_id                uuid not null references games(id) on delete cascade,
	night                  int  not null,
	seat_id                uuid not null references seats(id) on delete cascade,
	body                   text not null default '',
	released               boolean not null default false,
	unique (game_id, night, seat_id)
);

create table meet_requests (
	id                     uuid primary key default gen_random_uuid(),
	game_id                uuid not null references games(id) on delete cascade,
	seat_id                uuid not null references seats(id) on delete cascade,
	reason                 text,
	status                 text not null default 'waiting'
	                         check (status in ('waiting','met','dismissed')),
	created_at             timestamptz not null default now()
);
create index meet_requests_game_idx on meet_requests(game_id, status);

create table day_log (
	id                     uuid primary key default gen_random_uuid(),
	game_id                uuid not null references games(id) on delete cascade,
	cycle                  int  not null,
	kind                   text not null
	                         check (kind in ('nomination','vote','execution','death','note')),
	payload                jsonb not null default '{}'::jsonb,
	created_at             timestamptz not null default now()
);
create index day_log_game_idx on day_log(game_id, created_at);

create table player_notes (
	seat_id                uuid primary key references seats(id) on delete cascade,
	game_id                uuid not null references games(id) on delete cascade,
	body                   text not null default '',
	prime_suspect_seat_id  uuid references seats(id) on delete set null,
	updated_at             timestamptz not null default now()
);

-- ---- helper functions (SECURITY DEFINER to avoid RLS recursion) ----------

create function is_storyteller(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
	select exists (select 1 from games where id = g and storyteller_id = auth.uid());
$$;

create function owns_seat(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
	select exists (select 1 from seats where id = s and user_id = auth.uid());
$$;

create function in_game(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
	select is_storyteller(g)
	    or exists (select 1 from seats where game_id = g and user_id = auth.uid());
$$;

-- Clock reference: epoch milliseconds on the server, for offset measurement.
create function server_now() returns bigint
language sql stable as $$
	select (extract(epoch from now()) * 1000)::bigint;
$$;

create function touch_updated_at() returns trigger
language plpgsql as $$
begin
	new.updated_at := now();
	return new;
end;
$$;

create trigger player_notes_touch before update on player_notes
	for each row execute function touch_updated_at();

-- ---- RPCs ---------------------------------------------------------------

-- Create a game with N empty seats, a unique join code, in the lobby phase.
create function create_game(p_script_id text, p_seat_count int)
returns games
language plpgsql security definer set search_path = public as $$
declare
	v_code text;
	v_game games;
	i int;
begin
	if auth.uid() is null then
		raise exception 'not signed in';
	end if;
	if p_seat_count < 2 or p_seat_count > 22 then
		raise exception 'seat count must be between 2 and 22';
	end if;

	loop
		v_code := upper(
			substr('ABCDEFGHJKLMNPQRSTUVWXYZ', floor(random()*24)::int + 1, 1) ||
			substr('ABCDEFGHJKLMNPQRSTUVWXYZ', floor(random()*24)::int + 1, 1) ||
			substr('ABCDEFGHJKLMNPQRSTUVWXYZ', floor(random()*24)::int + 1, 1) ||
			substr('ABCDEFGHJKLMNPQRSTUVWXYZ', floor(random()*24)::int + 1, 1)
		);
		exit when not exists (select 1 from games where join_code = v_code);
	end loop;

	insert into games (join_code, script_id, storyteller_id)
	values (v_code, p_script_id, auth.uid())
	returning * into v_game;

	for i in 0 .. p_seat_count - 1 loop
		insert into seats (game_id, seat_index) values (v_game.id, i);
	end loop;

	return v_game;
end;
$$;

-- Claim a seat in a game by its join code. Idempotent for a device that has
-- already joined. Returns the game id.
create function join_game(p_join_code text, p_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
	v_game_id uuid;
	v_seat_id uuid;
begin
	if auth.uid() is null then
		raise exception 'not signed in';
	end if;

	select id into v_game_id from games where join_code = upper(p_join_code);
	if v_game_id is null then
		raise exception 'no game with that code';
	end if;

	-- already in this game?
	select id into v_seat_id from seats
	where game_id = v_game_id and user_id = auth.uid()
	limit 1;
	if v_seat_id is not null then
		update seats set name = coalesce(nullif(p_name, ''), name) where id = v_seat_id;
		return v_game_id;
	end if;

	-- take the lowest unclaimed seat
	select id into v_seat_id from seats
	where game_id = v_game_id and user_id is null
	order by seat_index
	limit 1
	for update skip locked;
	if v_seat_id is null then
		raise exception 'this game is full';
	end if;

	update seats set user_id = auth.uid(), name = coalesce(nullif(p_name, ''), name)
	where id = v_seat_id;

	insert into player_notes (seat_id, game_id) values (v_seat_id, v_game_id)
	on conflict do nothing;

	return v_game_id;
end;
$$;

-- Seat lifecycle: a player leaving their own seat, or the Storyteller
-- freeing/kicking one. Either way the seat goes back to "open" (name
-- cleared, unclaimed) but keeps its seat_index, so the circle and everyone
-- else's neighbour math don't shift under them. Any secret role and pending
-- meet request, and any private notes on that seat are cleared too, so a
-- later, different occupant never inherits the previous sitter's information.
create function leave_seat(p_seat_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
	if not owns_seat(p_seat_id) then
		raise exception 'not your seat';
	end if;
	update seats set user_id = null, name = '' where id = p_seat_id;
	delete from seat_roles where seat_id = p_seat_id;
	delete from meet_requests where seat_id = p_seat_id and status = 'waiting';
	delete from player_notes where seat_id = p_seat_id;
end;
$$;

create function kick_seat(p_seat_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
	v_game_id uuid;
begin
	select game_id into v_game_id from seats where id = p_seat_id;
	if v_game_id is null then
		raise exception 'seat not found';
	end if;
	if not is_storyteller(v_game_id) then
		raise exception 'not the storyteller';
	end if;
	update seats set user_id = null, name = '' where id = p_seat_id;
	delete from seat_roles where seat_id = p_seat_id;
	delete from meet_requests where seat_id = p_seat_id and status = 'waiting';
	delete from player_notes where seat_id = p_seat_id;
end;
$$;

-- A player naming (or renaming) themselves. Replaces writing to seats
-- directly, so a device can only ever touch its own name, never anyone
-- else's row, alive flag, or seat position.
create function set_my_name(p_seat_id uuid, p_name text)
returns void
language plpgsql security definer set search_path = public as $$
begin
	if not owns_seat(p_seat_id) then
		raise exception 'not your seat';
	end if;
	update seats set name = p_name where id = p_seat_id;
end;
$$;

-- Storyteller reordering the circle: swap a seat with its neighbour in
-- seat_index order (wrapping around the ring). One statement so the
-- unique(game_id, seat_index) constraint never sees a transient clash.
create function move_seat(p_seat_id uuid, p_direction text)
returns void
language plpgsql security definer set search_path = public as $$
declare
	v_game_id   uuid;
	v_idx       int;
	v_count     int;
	v_other_idx int;
	v_other_id  uuid;
begin
	select game_id, seat_index into v_game_id, v_idx from seats where id = p_seat_id;
	if v_game_id is null then
		raise exception 'seat not found';
	end if;
	if not is_storyteller(v_game_id) then
		raise exception 'not the storyteller';
	end if;
	if p_direction not in ('up', 'down') then
		raise exception 'direction must be up or down';
	end if;

	select count(*) into v_count from seats where game_id = v_game_id;
	v_other_idx := case when p_direction = 'up'
		then (v_idx - 1 + v_count) % v_count
		else (v_idx + 1) % v_count
	end;

	select id into v_other_id from seats
	where game_id = v_game_id and seat_index = v_other_idx;

	update seats set seat_index = case id
		when p_seat_id then v_other_idx
		when v_other_id then v_idx
	end
	where id in (p_seat_id, v_other_id);
end;
$$;

-- Phase control. started_at / paused math is done server-side with now(), so
-- no client clock is ever trusted. RLS on games (update = is_storyteller)
-- authorises these; they run as the caller.

create function set_phase(p_game_id uuid, p_kind text, p_cycle int, p_duration_ms bigint)
returns void
language sql set search_path = public as $$
	update games set
		phase_kind = p_kind,
		phase_cycle = p_cycle,
		phase_started_at = now(),
		phase_duration_ms = greatest(0, p_duration_ms),
		phase_paused_at = null,
		phase_paused_accum_ms = 0,
		gather = false,
		gather_reason = null
	where id = p_game_id;
$$;

create function pause_phase(p_game_id uuid)
returns void
language sql set search_path = public as $$
	update games set phase_paused_at = now()
	where id = p_game_id and phase_paused_at is null;
$$;

create function resume_phase(p_game_id uuid)
returns void
language sql set search_path = public as $$
	update games set
		phase_paused_accum_ms = phase_paused_accum_ms
			+ (extract(epoch from (now() - phase_paused_at)) * 1000)::bigint,
		phase_paused_at = null
	where id = p_game_id and phase_paused_at is not null;
$$;

create function adjust_duration(p_game_id uuid, p_delta_ms bigint)
returns void
language sql set search_path = public as $$
	update games set phase_duration_ms = greatest(0, phase_duration_ms + p_delta_ms)
	where id = p_game_id;
$$;

create function set_gather(p_game_id uuid, p_on boolean, p_reason text)
returns void
language sql set search_path = public as $$
	update games set gather = p_on, gather_reason = case when p_on then p_reason else null end
	where id = p_game_id;
$$;

-- ---- row-level security ------------------------------------------------

alter table games         enable row level security;
alter table seats         enable row level security;
alter table seat_roles    enable row level security;
alter table grimoire      enable row level security;
alter table night_actions enable row level security;
alter table prep_notes    enable row level security;
alter table meet_requests enable row level security;
alter table day_log       enable row level security;
alter table player_notes  enable row level security;

-- games: participants read; storyteller writes.
create policy games_select on games for select using ( in_game(id) );
create policy games_insert on games for insert with check ( storyteller_id = auth.uid() );
create policy games_update on games for update using ( is_storyteller(id) );
create policy games_delete on games for delete using ( is_storyteller(id) );

-- seats: participants read; only the storyteller writes the table directly.
-- Players change their own seat only through leave_seat() / set_my_name()
-- above (SECURITY DEFINER), so a device can never touch another seat's
-- alive flag, position, or claim -- and can't un-kill itself.
create policy seats_select on seats for select using ( in_game(game_id) );
create policy seats_insert on seats for insert with check ( is_storyteller(game_id) );
create policy seats_update on seats for update using ( is_storyteller(game_id) );
create policy seats_delete on seats for delete using ( is_storyteller(game_id) );

-- seat_roles: the seat's own device and the storyteller.
create policy seat_roles_select on seat_roles for select
	using ( owns_seat(seat_id) or is_storyteller(game_id) );
create policy seat_roles_write on seat_roles for all
	using ( is_storyteller(game_id) ) with check ( is_storyteller(game_id) );

-- grimoire: storyteller only.
create policy grimoire_all on grimoire for all
	using ( is_storyteller(game_id) ) with check ( is_storyteller(game_id) );

-- night_actions: storyteller always sees/writes everything. A player sees
-- their own row once the Storyteller releases it (released_at set) -- true
-- whether the release is a finished info string (Washerwoman...) or an open
-- question waiting on their pick (Monk...). A player may then write their
-- own `result` exactly once, only while it is still empty -- so a released
-- info row (result already set by the Storyteller) can never be overwritten
-- by the player, and a released choose-type prompt can be answered but not
-- silently re-answered without the Storyteller reopening it first.
create policy night_actions_select on night_actions for select
	using ( is_storyteller(game_id) or (owns_seat(seat_id) and released_at is not null) );
create policy night_actions_insert on night_actions for insert
	with check ( is_storyteller(game_id) );
create policy night_actions_update on night_actions for update
	using (
		is_storyteller(game_id)
		or (owns_seat(seat_id) and released_at is not null and result is null)
	);
create policy night_actions_delete on night_actions for delete
	using ( is_storyteller(game_id) );

-- prep_notes: storyteller only.
create policy prep_notes_all on prep_notes for all
	using ( is_storyteller(game_id) ) with check ( is_storyteller(game_id) );

-- meet_requests: storyteller and the requesting seat.
create policy meet_select on meet_requests for select
	using ( is_storyteller(game_id) or owns_seat(seat_id) );
create policy meet_insert on meet_requests for insert
	with check ( owns_seat(seat_id) );
create policy meet_update on meet_requests for update
	using ( is_storyteller(game_id) or owns_seat(seat_id) );
create policy meet_delete on meet_requests for delete
	using ( is_storyteller(game_id) );

-- day_log: participants read; storyteller writes.
create policy day_log_select on day_log for select using ( in_game(game_id) );
create policy day_log_write on day_log for all
	using ( is_storyteller(game_id) ) with check ( is_storyteller(game_id) );

-- player_notes: the seat owner, and nobody else — not even the storyteller.
create policy player_notes_all on player_notes for all
	using ( owns_seat(seat_id) ) with check ( owns_seat(seat_id) );

-- ---- realtime ---------------------------------------------------------
-- Push changes on these tables to subscribed devices. RLS still applies, so
-- each device only receives rows it is allowed to see.
alter publication supabase_realtime add table games;
alter publication supabase_realtime add table seats;
alter publication supabase_realtime add table seat_roles;
alter publication supabase_realtime add table night_actions;
alter publication supabase_realtime add table meet_requests;
alter publication supabase_realtime add table day_log;
