import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { syncServerTime, currentOffset } from './server-time';
import { phaseFromGame } from './phase';
import { livingNeighbours } from './circle';
import { readClock, formatClock, phaseLabel, type ClockView, type PhaseState } from './clock';
import type { GameRow, SeatRow, SeatRoleRow, MeetRequestRow, NightActionRow, GrimoireRow } from './types';

/**
 * Live view of one game for a single client (a real device, or one simulated
 * player). Keeps the games row, seats, visible role assignments, and meet
 * requests fresh over realtime, and ticks a locally-computed clock.
 *
 *   const g = new GameSession();            // real device
 *   const g = new GameSession(simClient);   // a fake player in the simulator
 *   onMount(() => { g.start(gameId); return () => g.stop(); });
 */
export class GameSession {
	game = $state<GameRow | null>(null);
	seats = $state<SeatRow[]>([]);
	/** Role rows this client is allowed to see: own seat for a player, all for the Storyteller. */
	roles = $state<SeatRoleRow[]>([]);
	meetRequests = $state<MeetRequestRow[]>([]);
	/** Every row for the Storyteller; only this seat's released rows for a player. */
	nightActions = $state<NightActionRow[]>([]);
	/** Storyteller-only per RLS — a player's client always sees an empty array here. */
	grimoire = $state<GrimoireRow[]>([]);
	error = $state<string | null>(null);
	now = $state(Date.now());
	userId = $state<string | null>(null);

	#client: SupabaseClient;
	#channel: RealtimeChannel | null = null;
	#timer: ReturnType<typeof setInterval> | null = null;
	#gameId = '';

	constructor(client: SupabaseClient = supabase) {
		this.#client = client;
	}

	get client() {
		return this.#client;
	}

	readonly phase = $derived<PhaseState | null>(this.game ? phaseFromGame(this.game) : null);
	readonly view = $derived<ClockView | null>(
		this.phase ? readClock(this.phase, this.now, currentOffset()) : null
	);
	readonly label = $derived(this.phase ? phaseLabel(this.phase) : '');
	readonly display = $derived(this.view ? formatClock(this.view) : '--:--');
	readonly paused = $derived(this.game?.phase_paused_at != null);
	readonly claimedSeats = $derived(this.seats.filter((s) => s.user_id !== null).length);
	readonly mySeat = $derived<SeatRow | null>(
		this.userId ? (this.seats.find((s) => s.user_id === this.userId) ?? null) : null
	);
	readonly myRole = $derived<string | null>(
		this.mySeat ? (this.roles.find((r) => r.seat_id === this.mySeat!.id)?.character_id ?? null) : null
	);
	readonly myNeighbours = $derived(
		this.mySeat ? livingNeighbours(this.seats, this.mySeat.id) : { ccw: null, cw: null }
	);
	/** This client's own night_actions row for the current night, once the Storyteller has released it. */
	readonly myNightAction = $derived<NightActionRow | null>(
		this.mySeat && this.phase?.kind === 'night'
			? (this.nightActions.find(
					(a) => a.seat_id === this.mySeat!.id && a.night === this.phase!.cycle
				) ?? null)
			: null
	);
	/** The Fortune Teller's red herring seat, for the Storyteller's session only
	 * (grimoire is empty for a player's client, so this is null for them too). */
	readonly redHerringSeatId = $derived<string | null>(
		this.grimoire.find((g) => g.is_red_herring)?.seat_id ?? null
	);

	roleFor(seatId: string): string | null {
		return this.roles.find((r) => r.seat_id === seatId)?.character_id ?? null;
	}

	async start(gameId: string) {
		this.#gameId = gameId;
		await syncServerTime(this.#client).catch(() => {});

		const { data: auth } = await this.#client.auth.getUser();
		this.userId = auth.user?.id ?? null;

		const { data: game, error: gameErr } = await this.#client
			.from('games')
			.select('*')
			.eq('id', gameId)
			.single();
		if (gameErr) {
			this.error = gameErr.message;
			return;
		}
		this.game = game as GameRow;
		await this.refreshAll();

		this.#channel = this.#client
			.channel(`game:${gameId}:${Math.random().toString(36).slice(2)}`)
			.on(
				'postgres_changes',
				{ event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
				(p) => (this.game = p.new as GameRow)
			)
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'seats', filter: `game_id=eq.${gameId}` },
				() => this.refreshSeats()
			)
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'seat_roles', filter: `game_id=eq.${gameId}` },
				() => this.refreshRoles()
			)
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'meet_requests', filter: `game_id=eq.${gameId}` },
				() => this.refreshMeet()
			)
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'night_actions', filter: `game_id=eq.${gameId}` },
				() => this.refreshNightActions()
			)
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'grimoire', filter: `game_id=eq.${gameId}` },
				() => this.refreshGrimoire()
			)
			.subscribe();

		this.#timer = setInterval(() => (this.now = Date.now()), 250);
	}

	async refreshAll() {
		await Promise.all([
			this.refreshSeats(),
			this.refreshRoles(),
			this.refreshMeet(),
			this.refreshNightActions(),
			this.refreshGrimoire()
		]);
	}

	async refreshSeats() {
		const { data } = await this.#client
			.from('seats')
			.select('*')
			.eq('game_id', this.#gameId)
			.order('seat_index');
		if (data) this.seats = data as SeatRow[];
	}

	async refreshRoles() {
		const { data } = await this.#client
			.from('seat_roles')
			.select('*')
			.eq('game_id', this.#gameId);
		this.roles = (data ?? []) as SeatRoleRow[];
	}

	async refreshMeet() {
		const { data } = await this.#client
			.from('meet_requests')
			.select('*')
			.eq('game_id', this.#gameId)
			.order('created_at');
		this.meetRequests = (data ?? []) as MeetRequestRow[];
	}

	async refreshNightActions() {
		const { data } = await this.#client.from('night_actions').select('*').eq('game_id', this.#gameId);
		this.nightActions = (data ?? []) as NightActionRow[];
	}

	/** Empty (not an error) for a player's client — grimoire is storyteller-only per RLS. */
	async refreshGrimoire() {
		const { data } = await this.#client.from('grimoire').select('*').eq('game_id', this.#gameId);
		this.grimoire = (data ?? []) as GrimoireRow[];
	}

	stop() {
		if (this.#channel) this.#client.removeChannel(this.#channel);
		if (this.#timer) clearInterval(this.#timer);
		this.#channel = null;
		this.#timer = null;
	}
}
