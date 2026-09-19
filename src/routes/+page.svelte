<script lang="ts">
	import { goto } from '$app/navigation';
	import { supabase, ensureSignedIn, isConfigured } from '$lib/supabase';
	import { SCRIPTS } from '$lib/scripts';
	import { applyScriptTheme } from '$lib/scriptTheme';
	import type { GameRow } from '$lib/types';

	let scriptId = $state(SCRIPTS[0].id);

	// Live-preview the picked script's theme right here on the picker --
	// see src/lib/scriptTheme.ts. Resets to the gothic default on unmount.
	$effect(() => applyScriptTheme(scriptId));
	let seatCount = $state(8);
	let joinCode = $state('');
	let playerName = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function startGame() {
		busy = true;
		error = null;
		try {
			await ensureSignedIn();
			const { data, error: rpcErr } = await supabase.rpc('create_game', {
				p_script_id: scriptId,
				p_seat_count: seatCount
			});
			if (rpcErr) throw new Error(rpcErr.message);
			const game = data as GameRow;
			await goto(`/host/${game.id}`);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function joinGame() {
		busy = true;
		error = null;
		try {
			await ensureSignedIn();
			const { data, error: rpcErr } = await supabase.rpc('join_game', {
				p_join_code: joinCode.trim().toUpperCase(),
				p_name: playerName.trim()
			});
			if (rpcErr) throw new Error(rpcErr.message);
			await goto(`/play/${data as string}`);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<div class="stack">
	<header>
		<h1>Clocktower by Post</h1>
		<p class="muted">An async companion for Blood on the Clock Tower.</p>
	</header>

	{#if !isConfigured}
		<div class="card error">
			Supabase isn't configured yet. Copy <code>.env.example</code> to <code>.env</code> and add your
			project URL and anon key, then restart the dev server.
		</div>
	{/if}

	<section class="card stack">
		<h2>Join a game</h2>
		<div>
			<label for="code">Game code</label>
			<input id="code" bind:value={joinCode} placeholder="ABCD" maxlength="4" autocomplete="off" />
		</div>
		<div>
			<label for="name">Your name</label>
			<input id="name" bind:value={playerName} placeholder="e.g. Sam" autocomplete="off" />
		</div>
		<button
			class="primary"
			onclick={joinGame}
			disabled={busy || joinCode.trim().length < 4 || playerName.trim().length === 0}
		>
			Join
		</button>
	</section>

	<section class="card stack">
		<h2>Start a game</h2>
		<p class="muted">You'll be the Storyteller.</p>
		<div>
			<label for="script">Script</label>
			<select id="script" bind:value={scriptId}>
				{#each SCRIPTS as s (s.id)}
					<option value={s.id}>{s.name} ({s.minPlayers}&ndash;{s.maxPlayers})</option>
				{/each}
			</select>
		</div>
		<div>
			<label for="seats">Seats</label>
			<input id="seats" type="number" min="2" max="22" bind:value={seatCount} />
		</div>
		<button onclick={startGame} disabled={busy}>Create game</button>
	</section>

	{#if error}
		<p class="error">{error}</p>
	{/if}
</div>
