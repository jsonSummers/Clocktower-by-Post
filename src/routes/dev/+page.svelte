<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		supabase,
		ensureSignedIn,
		createSimClient,
		signInAnon,
		isConfigured
	} from '$lib/supabase';
	import { GameSession } from '$lib/game.svelte';
	import { base } from '$app/paths';
	import { SCRIPTS, getScript, getCharacter } from '$lib/scripts';
	import { applyScriptTheme } from '$lib/scriptTheme';
	import { dealGame } from '$lib/scripts/deal';
	import { nextPhase, phaseLabel } from '$lib/clock';
	import { phase as phaseRpc, applyDeal, setSeatAlive, resolveMeet } from '$lib/actions';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import type { GameRow } from '$lib/types';
	import Circle from '$lib/components/Circle.svelte';
	import ClockFace from '$lib/components/ClockFace.svelte';
	import PlayerView from '$lib/components/PlayerView.svelte';
	import NightDispatch from '$lib/components/NightDispatch.svelte';
	import Avatar from '$lib/components/Avatar.svelte';

	let scriptId = $state(SCRIPTS[0].id);
	let seatCount = $state(7);
	let minutes = $state(2);
	let building = $state(false);
	let log = $state<string[]>([]);

	let gameId = $state<string | null>(null);
	let joinCode = $state<string | null>(null);
	let st = $state<GameSession | null>(null);
	let bots = $state<GameSession[]>([]);
	/** Which single screen is showing right now — 'st' for the Storyteller
	 * view, or a seat id for that bot's real player screen. Only one is ever
	 * rendered at a time so this page is usable on one phone: pick a screen,
	 * test it, tap another chip. */
	let viewMode = $state<string>('st');
	/** Which night the "Night dispatch" card below is showing — independent
	 * of the game's real clock, so every role's info/prompts can be read at
	 * any time without walking the phase clock there first. */
	let previewNight = $state(1);

	// A pool of anonymous identities, signed in once and reused across rebuilds
	// so we don't burn through Supabase's anon sign-in rate limit.
	const identityPool: SupabaseClient[] = [];
	let botSessions: GameSession[] = [];

	const script = $derived(getScript(scriptId));
	// Whole-page theme swap for the picked script -- see
	// src/lib/scriptTheme.ts. This page shows both the Storyteller view and
	// every bot's own screen in one document (only one at a time, per
	// viewMode above), so one effect here covers all of it.
	$effect(() => applyScriptTheme(scriptId));

	function note(m: string) {
		log = [...log, m];
	}

	function stopSessions() {
		st?.stop();
		for (const s of botSessions) s.stop();
		botSessions = [];
		bots = [];
		st = null;
		gameId = null;
		joinCode = null;
		viewMode = 'st';
	}
	onDestroy(stopSessions);

	async function getIdentities(n: number): Promise<SupabaseClient[]> {
		while (identityPool.length < n) {
			const c = createSimClient();
			await signInAnon(c); // only the *new* ones cost a sign-in
			identityPool.push(c);
		}
		return identityPool.slice(0, n);
	}

	async function build() {
		building = true;
		log = [];
		stopSessions();
		try {
			await ensureSignedIn();
			note('Preparing bot identities…');
			const identities = await getIdentities(seatCount);

			const { data, error } = await supabase.rpc('create_game', {
				p_script_id: scriptId,
				p_seat_count: seatCount
			});
			if (error) throw new Error(error.message);
			const game = data as GameRow;
			gameId = game.id;
			joinCode = game.join_code;
			note(`Game ${game.join_code} created`);

			const stSession = new GameSession(supabase);
			await stSession.start(game.id);
			st = stSession;

			const made: GameSession[] = [];
			for (let i = 0; i < seatCount; i++) {
				const { error: jErr } = await identities[i].rpc('join_game', {
					p_join_code: game.join_code,
					p_name: `Bot ${i + 1}`
				});
				if (jErr) throw new Error(`Bot ${i + 1}: ${jErr.message}`);
				const s = new GameSession(identities[i]);
				await s.start(game.id);
				made.push(s);
			}
			botSessions = made;
			bots = made;
			viewMode = 'st';
			note(`Ready — ${seatCount} bots seated.`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			note('ERROR: ' + msg);
			if (msg.includes('rate limit')) {
				note(
					'Supabase throttles new anonymous sign-ins. Wait a few minutes, reduce seats, or raise the limit in Supabase → Authentication → Rate Limits.'
				);
			}
		} finally {
			building = false;
		}
	}

	async function dealRoles() {
		if (!st || !gameId || !script) return;
		const result = dealGame(script, st.seats);
		const { error } = await applyDeal(supabase, gameId, result);
		if (error) {
			note('deal failed: ' + (error instanceof Error ? error.message : String(error)));
			return;
		}
		const { comp, redHerringSeatId } = result;
		note(
			`Dealt ${result.assignments.size} roles (${comp.townsfolk}/${comp.outsider}/${comp.minion}/${comp.demon})` +
				(redHerringSeatId ? ' · red herring set' : '')
		);
	}

	async function advance() {
		if (!st || !gameId) return;
		const target = st.phase ? nextPhase(st.phase, 0, 0) : { kind: 'night' as const, cycle: 1 };
		const { error } = await phaseRpc.set(supabase, gameId, target.kind, target.cycle, minutes * 60_000);
		note(error ? `advance failed: ${error.message}` : `-> ${target.kind} ${target.cycle}`);
	}
	async function togglePause() {
		if (!st || !gameId) return;
		const { error } = st.paused
			? await phaseRpc.resume(supabase, gameId)
			: await phaseRpc.pause(supabase, gameId);
		if (error) note(`pause failed: ${error.message}`);
	}
	async function toggleGather() {
		if (!st || !gameId) return;
		const { error } = await phaseRpc.gather(supabase, gameId, !st.game?.gather, 'Someone has died');
		if (error) note(`gather failed: ${error.message}`);
	}

	function botRole(b: GameSession): string {
		if (!script || !b.myRole) return '—';
		return getCharacter(script, b.myRole)?.name ?? b.myRole;
	}
	async function toggleAlive(b: GameSession, e: Event) {
		e.stopPropagation();
		if (!b.mySeat) return;
		await setSeatAlive(supabase, b.mySeat.id, !b.mySeat.alive);
	}
	async function clearMeet(id: string) {
		await resolveMeet(supabase, id, 'met');
	}
	const nextLabel = $derived(st?.phase ? phaseLabel(nextPhase(st.phase, 0, 0)) : 'Night 1');

	// Keep the preview night matched to the real one once the game clock
	// actually reaches a night phase, so "Advance to Night N" and the
	// dispatch card below agree by default — Prev/Next below still lets you
	// look at a different night without moving the clock.
	const actualNight = $derived(st?.phase?.kind === 'night' ? st.phase.cycle : null);
	$effect(() => {
		if (actualNight != null) previewNight = actualNight;
	});

	function timingLabel(c: { firstNight: number | null; otherNight: number | null; daySide?: boolean }): string {
		if (c.firstNight != null && c.otherNight != null) return 'first night + every night';
		if (c.firstNight != null) return 'first night only';
		if (c.otherNight != null) return 'every night but the first';
		return c.daySide ? 'day-side / passive' : 'passive';
	}
	/** Every seat with a character assigned, for the always-visible roles
	 * reference — the point is to see every ability at a glance without
	 * clicking through each bot's own screen. */
	type DealtSeat = { seat: GameSession['seats'][number]; character: NonNullable<ReturnType<typeof getCharacter>> };
	const dealtSeats = $derived.by((): DealtSeat[] => {
		if (!st || !script) return [];
		const rows: DealtSeat[] = [];
		for (const seat of st.seats) {
			const cid = st.roleFor(seat.id);
			const character = cid ? getCharacter(script, cid) : undefined;
			if (character) rows.push({ seat, character });
		}
		return rows;
	});
</script>

<div class="stack simulator">
	<header>
		<h1 style="margin:0">Simulator</h1>
		<p class="muted">
			Spins up a game with fake players, all driven from this one screen. Dev tool — not part of
			the real app.
		</p>
	</header>

	{#if !isConfigured}
		<div class="card error">Supabase isn't configured — add your keys to <code>.env</code>.</div>
	{/if}

	<details class="card build" open={!(st && st.game)}>
		<summary>
			Build controls
			{#if st && st.game}<span class="muted">— code {joinCode}</span>{/if}
		</summary>
		<div class="stack" style="margin-top:0.7rem">
			<div class="row" style="align-items:flex-end">
				<div style="flex:1;min-width:8rem">
					<label for="s">Script</label>
					<select id="s" bind:value={scriptId} disabled={building}>
						{#each SCRIPTS as sc (sc.id)}<option value={sc.id}>{sc.name}</option>{/each}
					</select>
				</div>
				<div style="width:5rem">
					<label for="n">Seats</label>
					<input id="n" type="number" min="2" max="20" bind:value={seatCount} disabled={building} />
				</div>
				<div style="width:5rem">
					<label for="m">Phase min</label>
					<input id="m" type="number" min="0" max="60" bind:value={minutes} disabled={building} />
				</div>
				<button class="primary" onclick={build} disabled={building}>
					{building ? 'Building…' : 'Build game'}
				</button>
			</div>
			{#if log.length}
				<pre class="log">{log.join('\n')}</pre>
			{/if}
		</div>
	</details>

	{#if st && st.game}
		<nav class="viewtabs">
			<button class="viewtab" class:active={viewMode === 'st'} onclick={() => (viewMode = 'st')}>
				<span class="name">🎭 Storyteller</span>
			</button>
			{#each bots as b (b.mySeat?.id ?? b)}
				{@const dead = b.mySeat && !b.mySeat.alive}
				<button
					class="viewtab"
					class:active={viewMode === b.mySeat?.id}
					class:dead
					onclick={() => (viewMode = b.mySeat?.id ?? viewMode)}
				>
					<span class="name">{b.mySeat?.name ?? '…'}</span>
					<span class="role">{botRole(b)}</span>
					<span
						class="lifebtn"
						role="button"
						tabindex="0"
						title={dead ? 'revive' : 'kill'}
						onclick={(e) => toggleAlive(b, e)}
						onkeydown={(e) => e.key === 'Enter' && toggleAlive(b, e)}
					>
						{dead ? '✝' : '♥'}
					</span>
				</button>
			{/each}
		</nav>

		{#if viewMode === 'st'}
			<section class="card stack">
				<div class="row" style="justify-content:space-between;align-items:baseline">
					<strong>Storyteller</strong>
					<span class="muted">code {joinCode} · {st.claimedSeats}/{st.seats.length} seated</span>
				</div>
				<ClockFace session={st} size="small" />
				<div class="row">
					<button class="primary" onclick={advance}>Advance to {nextLabel}</button>
					<button onclick={togglePause}>{st.paused ? 'Resume' : 'Pause'}</button>
					<button onclick={dealRoles}>Deal roles</button>
					<button onclick={toggleGather}>
						{st.game.gather ? 'Clear gather' : 'Gather'}
					</button>
					<a class="btnlink" href="{base}/host/{gameId}" target="_blank" rel="noreferrer">
						Open ST page ↗
					</a>
				</div>
				<Circle
					seats={st.seats}
					labelFor={(s) => (script && st?.roleFor(s.id) ? getCharacter(script, st.roleFor(s.id)!)?.name ?? null : null)}
				/>
			</section>

			{#if dealtSeats.length}
				<section class="card stack">
					<strong>Roles in play</strong>
					<p class="muted" style="margin:0">
						Every dealt seat's ability, exactly as worded on that player's own screen — so you don't
						have to click through every seat's screen just to check what a role says.
					</p>
					<div class="stack" style="gap:0.5rem">
						{#each dealtSeats as { seat, character } (seat.id)}
							<div class="rolerow">
								<Avatar characterId={character.id} size="sm" />
								<div class="stack" style="gap:0.15rem">
									<div class="row" style="align-items:baseline;gap:0.4rem">
										<strong>{character.name}</strong>
										<span class="muted" style="font-size:0.78rem">{seat.name || `Seat ${seat.seat_index + 1}`}</span>
										<span class="team-tag {character.team}">{character.team}</span>
									</div>
									<p style="margin:0;font-size:0.88rem">{character.summary}</p>
									<span class="muted" style="font-size:0.74rem;text-transform:uppercase;letter-spacing:0.03em">
										{timingLabel(character)}
									</span>
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<section class="card stack">
				<div class="row" style="justify-content:space-between;align-items:center">
					<strong>Night dispatch</strong>
					<div class="row" style="align-items:center;gap:0.35rem">
						<button onclick={() => (previewNight = Math.max(1, previewNight - 1))} title="Preview an earlier night">
							&larr;
						</button>
						<span class="muted" style="font-size:0.85rem;white-space:nowrap">
							Night {previewNight}
							{actualNight === previewNight ? '(live)' : '(preview)'}
						</span>
						<button onclick={() => (previewNight = previewNight + 1)} title="Preview a later night">&rarr;</button>
					</div>
				</div>
				<p class="muted" style="margin:0">
					What each seat's ability needs, and — for info roles — worked-example wording to send:
					<strong>Neutral</strong>, <strong>Helps good team</strong>, <strong>Helps evil team</strong>, or write your
					own. Same panel as the real Storyteller page; step through nights here without moving the
					game clock.
				</p>
				<NightDispatch session={st} gameId={gameId ?? ''} previewNight={previewNight} />
			</section>

			{#if st.meetRequests.some((r) => r.status === 'waiting')}
				<section class="card stack">
					<strong>Meet queue</strong>
					{#each st.meetRequests.filter((r) => r.status === 'waiting') as r, i (r.id)}
						{@const seat = st.seats.find((s) => s.id === r.seat_id)}
						<div class="row" style="justify-content:space-between">
							<span>#{i + 1} {seat?.name} <span class="muted">{r.reason ?? ''}</span></span>
							<button onclick={() => clearMeet(r.id)}>Met</button>
						</div>
					{/each}
				</section>
			{/if}
		{:else}
			{#each bots as b (b.mySeat?.id ?? b)}
				{#if viewMode === b.mySeat?.id}
					<div class="playerscreen">
						<PlayerView session={b} gameId={gameId ?? ''} />
					</div>
				{/if}
			{/each}
		{/if}
	{/if}
</div>

<style>
	:global(main:has(.simulator)) {
		max-width: 62rem;
	}
	.log {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.7rem;
		font-size: 0.78rem;
		white-space: pre-wrap;
		max-height: 9rem;
		overflow-y: auto;
		margin: 0;
	}
	.build summary {
		cursor: pointer;
		font-weight: 600;
		list-style: revert;
	}
	.build[open] summary {
		margin-bottom: 0.1rem;
	}
	/* Sticky so switching screens never needs a scroll-up first — the whole
	   point of testing several seats from one phone. */
	.viewtabs {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		flex-wrap: nowrap;
		overflow-x: auto;
		gap: 0.4rem;
		padding: 0.5rem;
		margin: 0 -0.1rem;
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(6px);
		border: 1px solid var(--border);
		border-radius: 10px;
		-webkit-overflow-scrolling: touch;
	}
	.viewtab {
		display: flex;
		align-items: center;
		flex: none;
		gap: 0.4rem;
		padding: 0.5rem 0.7rem;
		font-size: 0.8rem;
		white-space: nowrap;
	}
	.viewtab .name {
		font-weight: 600;
	}
	.viewtab .role {
		color: var(--text-dim);
	}
	.viewtab.active {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 14%, var(--surface-2));
	}
	.viewtab.dead {
		opacity: 0.6;
	}
	.lifebtn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.9rem;
		min-height: 1.9rem;
		cursor: pointer;
		font-size: 1.05rem;
	}
	.playerscreen {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.8rem;
		background: var(--surface);
	}
	.btnlink {
		display: inline-flex;
		align-items: center;
		padding: 0.6rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		font-size: 0.9rem;
		text-decoration: none;
		color: var(--text);
	}
	.btnlink:hover {
		border-color: var(--accent);
	}
	.rolerow {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		padding: 0.5rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-2);
	}
	.team-tag {
		display: inline-block;
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		border: 1px solid currentColor;
	}
	.team-tag.townsfolk {
		color: var(--night);
	}
	.team-tag.outsider {
		color: var(--accent);
	}
	.team-tag.minion,
	.team-tag.demon {
		color: var(--danger);
	}

	@media (max-width: 480px) {
		section.card.row,
		.build .row {
			flex-direction: column;
			align-items: stretch;
		}
		section.card.row > div,
		.build .row > div {
			width: 100% !important;
		}
		.viewtab {
			padding: 0.6rem 0.8rem;
			font-size: 0.85rem;
		}
	}
</style>
