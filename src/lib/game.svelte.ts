import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { syncServerTime, currentOffset } from './server-time';
import { phaseFromGame } from './phase';
import { livingNeighbours } from './circle';
import { readClock, formatClock, phaseLabel, type ClockView, type PhaseState } from './clock';
import type {
	GameRow,
	SeatRow,
	SeatRoleRow,
	MeetRequestRow,
	NightActionRow,
	GrimoireRow,
	NominationRow,
	VoteRow
} from './types';

/** How often we poll as a fallback, independent of realtime channel health. */
const POLL_INTERVAL_MS = 4000;
/** Base backoff for realtime reconnect attempts; doubles up to a cap. */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting' | 'polling';

/** Signatures of last-seen data per table, used to detect real changes cheaply. */
type DataSig = {
	seats: string;
	roles: string;
	meet: string;
	night: string;
	grimoire: string;
	nominations: string;
	votes: string;
};

/**
 * Live view of one game for a single client (a real device, or one simulated
 * player). Keeps the games row, seats, visible role assignments, and meet
 * requests fresh over realtime, and ticks a locally-computed clock.
 *
 *   const g = new GameSession();            // real device
 *   const g = new GameSession(simClient);   // a fake player in the simulator
 *   onMount(() => { g.start(gameId); return () => g.stop(); });
 *
 * Realtime delivery from Supabase isn't always reliable in practice (a
 * subscription can silently stop delivering events without erroring), so
 * this class does not rely on it alone: a periodic poll runs the whole time
 * as a guaranteed fallback, and the realtime channel is reconnected with
 * backoff whenever its status goes bad. `realtimeStatus` is exposed so the
 * UI can show a small "live / reconnecting / polling" indicator.
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
	/** Every nomination for the game (open and closed) — visible to everyone seated. */
	nominations = $state<NominationRow[]>([]);
	/** Every raised hand across every nomination — also visible to everyone (voting is public). */
	votes = $state<VoteRow[]>([]);
	error = $state<string | null>(null);
	now = $state(Date.now());
	userId = $state<string | null>(null);
	/** Surface realtime health so the UI can show a subtle status hint. */
	realtimeStatus = $state<RealtimeStatus>('connecting');
	/** Bumped whenever a refresh pulls in genuinely different data, so views
	 * can react (toast/pulse/vibrate) without doing their own diffing. */
	lastChangeAt = $state(Date.now());

	#client: SupabaseClient;
	#channel: RealtimeChannel | null = null;
	#timer: ReturnType<typeof setInterval> | null = null;
	#pollTimer: ReturnType<typeof setInterval> | null = null;
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	#gameId = '';
	#reconnectAttempts = 0;
	#stopped = false;

	#sig: DataSig = {
		seats: '',
		roles: '',
		meet: '',
		night: '',
		grimoire: '',
		nominations: '',
		votes: ''
	};

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
	/** Alive seats that hold an actual player (empty seats never count). */
	readonly aliveSeats = $derived(this.seats.filter((s) => s.alive && s.user_id !== null));
	/** The one nomination still in play (debate or voting), if any — only one
	 * can ever be open per game (open_nomination() enforces it). */
	readonly openNomination = $derived<NominationRow | null>(
		this.nominations.find((n) => n.stage !== 'closed') ?? null
	);
	/** The most recently touched nomination, open or not — so the last result
	 * stays visible for a moment after a vote closes, instead of the whole
	 * card vanishing the instant it's resolved. */
	readonly latestNomination = $derived<NominationRow | null>(
		[...this.nominations].sort(
			(a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
		)[0] ?? null
	);
	/** Every raised hand on the currently-shown nomination (open or latest). */
	readonly votesForLatest = $derived<VoteRow[]>(
		this.latestNomination
			? this.votes.filter((v) => v.nomination_id === this.latestNomination!.id)
			: []
	);
	/** Whether this client's own seat has raised its hand on the latest nomination. */
	readonly myVoteCast = $derived(
		this.mySeat ? this.votesForLatest.some((v) => v.seat_id === this.mySeat!.id) : false
	);

	roleFor(seatId: string): string | null {
		return this.roles.find((r) => r.seat_id === seatId)?.character_id ?? null;
	}

	async start(gameId: string) {
		this.#gameId = gameId;
		this.#stopped = false;
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

		this.#subscribe();

		this.#timer = setInterval(() => (this.now = Date.now()), 250);
		// Guaranteed fallback: keep polling regardless of what the realtime
		// channel is doing. Supabase Realtime can go quiet without ever firing
		// CHANNEL_ERROR/TIMED_OUT, so status-driven reconnects alone aren't
		// enough — this is what actually bounds staleness to a few seconds.
		this.#pollTimer = setInterval(() => this.refreshAll(), POLL_INTERVAL_MS);
	}

	#subscribe() {
		if (this.#stopped) return;
		if (this.#channel) {
			this.#client.removeChannel(this.#channel);
			this.#channel = null;
		}
		const gameId = this.#gameId;
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
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'nominations', filter: `game_id=eq.${gameId}` },
				() => this.refreshNominations()
			)
			.on(
				// votes has no game_id column of its own (it hangs off
				// nominations), so it can't be filtered server-side — just
				// refetch on any change and let the client-side join do the
				// filtering, same as it already does for reads.
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'votes' },
				() => this.refreshVotes()
			)
			.subscribe((status) => {
				if (this.#stopped) return;
				if (status === 'SUBSCRIBED') {
					this.realtimeStatus = 'live';
					this.#reconnectAttempts = 0;
					// Catch up on anything that happened while (re)connecting.
					this.refreshAll();
				} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
					this.realtimeStatus = this.#reconnectAttempts > 0 ? 'reconnecting' : 'polling';
					this.#scheduleReconnect();
				}
			});
	}

	#scheduleReconnect() {
		if (this.#stopped || this.#reconnectTimer) return;
		const attempt = this.#reconnectAttempts++;
		const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null;
			if (this.#stopped) return;
			this.#subscribe();
		}, delay);
	}

	async refreshAll() {
		await Promise.all([
			this.refreshSeats(),
			this.refreshRoles(),
			this.refreshMeet(),
			this.refreshNightActions(),
			this.refreshGrimoire(),
			this.refreshNominations(),
			this.refreshVotes()
		]);
	}

	/** Marks a fresh change only when the new data actually differs from what we had. */
	#applyIfChanged<K extends keyof DataSig>(key: K, data: unknown, apply: () => void) {
		const sig = JSON.stringify(data);
		if (sig === this.#sig[key]) return;
		this.#sig[key] = sig;
		apply();
		this.lastChangeAt = Date.now();
	}

	async refreshSeats() {
		const { data } = await this.#client
			.from('seats')
			.select('*')
			.eq('game_id', this.#gameId)
			.order('seat_index');
		if (data) this.#applyIfChanged('seats', data, () => (this.seats = data as SeatRow[]));
	}

	async refreshRoles() {
		const { data } = await this.#client
			.from('seat_roles')
			.select('*')
			.eq('game_id', this.#gameId);
		const rows = (data ?? []) as SeatRoleRow[];
		this.#applyIfChanged('roles', rows, () => (this.roles = rows));
	}

	async refreshMeet() {
		const { data } = await this.#client
			.from('meet_requests')
			.select('*')
			.eq('game_id', this.#gameId)
			.order('created_at');
		const rows = (data ?? []) as MeetRequestRow[];
		this.#applyIfChanged('meet', rows, () => (this.meetRequests = rows));
	}

	async refreshNightActions() {
		const { data } = await this.#client.from('night_actions').select('*').eq('game_id', this.#gameId);
		const rows = (data ?? []) as NightActionRow[];
		this.#applyIfChanged('night', rows, () => (this.nightActions = rows));
	}

	/** Empty (not an error) for a player's client — grimoire is storyteller-only per RLS. */
	async refreshGrimoire() {
		const { data } = await this.#client.from('grimoire').select('*').eq('game_id', this.#gameId);
		const rows = (data ?? []) as GrimoireRow[];
		this.#applyIfChanged('grimoire', rows, () => (this.grimoire = rows));
	}

	async refreshNominations() {
		const { data } = await this.#client
			.from('nominations')
			.select('*')
			.eq('game_id', this.#gameId)
			.order('created_at');
		const rows = (data ?? []) as NominationRow[];
		this.#applyIfChanged('nominations', rows, () => (this.nominations = rows));
	}

	/** votes has no game_id of its own — RLS (via a join to nominations) is
	 * what scopes this to the caller's own game, same as every read here. */
	async refreshVotes() {
		const { data } = await this.#client.from('votes').select('*');
		const rows = (data ?? []) as VoteRow[];
		this.#applyIfChanged('votes', rows, () => (this.votes = rows));
	}

	stop() {
		this.#stopped = true;
		if (this.#channel) this.#client.removeChannel(this.#channel);
		if (this.#timer) clearInterval(this.#timer);
		if (this.#pollTimer) clearInterval(this.#pollTimer);
		if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
		this.#channel = null;
		this.#timer = null;
		this.#pollTimer = null;
		this.#reconnectTimer = null;
	}
}
