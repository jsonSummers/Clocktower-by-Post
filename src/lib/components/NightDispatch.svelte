<script lang="ts">
	/**
	 * NightDispatch — the Storyteller's per-night queue. Walks tonight's wake
	 * order (from nightInfo.ts) and, for each seat whose character acts, shows
	 * exactly what needs deciding: ready-worded info candidates to click in or
	 * edit for info roles, or a "let them choose" trigger + the player's
	 * submitted answer for choose roles.
	 *
	 * Used both on the real Storyteller page (host/[gameId]) and inline in the
	 * /dev simulator, so solo-testing shows the same thing a live game would.
	 *
	 * ---- preview mode ----
	 * The host page never passes `previewNight`, so it behaves exactly as
	 * before: the queue only appears once the game clock is actually in a
	 * night phase, and every button really sends/asks. The /dev simulator
	 * passes a chosen night number instead, so the whole queue — every
	 * character's ability, the wake order, and worked example candidates for
	 * every info role — can be read at any time, without first walking the
	 * clock there. If the previewed night isn't the game's *actual* current
	 * night, sending/asking is disabled (a duplicate dispatch for a night
	 * that hasn't arrived yet would just be confusing) and the panel reads
	 * as reference only.
	 */
	import type { GameSession } from '$lib/game.svelte';
	import { getScript, getCharacter, findCharacterAnywhere } from '$lib/scripts';
	import type { Character } from '$lib/types';
	import {
		wakeOrder,
		infoCandidatesFor,
		night1EvilReveals,
		parseChoiceResult,
		choicePromptFor,
		mimicWakeStep,
		type InfoCandidate,
		type WakeStep,
		type ImpactLevel
	} from '$lib/nightInfo';
	import { parseAmnesiacNote } from '$lib/scripts/amnesiac-abilities';
	import { parseCannibalNote } from '$lib/scripts/cannibal';
	import { poisonStatus, addToken } from '$lib/poison';
	import {
		sendNightInfo,
		askNightChoice,
		sendChoiceReading,
		reopenNightChoice,
		clearNightAction,
		savePrepNote,
		markPrepNoteReleased,
		setSeatTokens
	} from '$lib/actions';
	import Avatar from './Avatar.svelte';

	interface Props {
		session: GameSession;
		gameId: string;
		/** Show this night instead of the game's actual current night — for
		 * previewing without moving the clock. Omit for the real ST page. */
		previewNight?: number | null;
	}
	let { session, gameId, previewNight = null }: Props = $props();

	let actionError = $state<string | null>(null);
	async function run(p: PromiseLike<{ error: unknown }>) {
		const { error } = await p;
		if (error) actionError = error instanceof Error ? error.message : String(error);
	}

	const script = $derived(session.game ? getScript(session.game.script_id) : undefined);
	/** The night this panel dispatches for. Stays on last night's number
	 * through the FOLLOWING day too (same phase_cycle — see clock.ts'
	 * night N -> day N), not just while phase_kind is literally 'night' —
	 * otherwise anything not yet sent (a Ravenkeeper prompt surfaced by a
	 * kill the Storyteller only marked dead a moment before advancing, say)
	 * became permanently unreachable the instant the clock moved to day.
	 * Once the NEXT night starts, this rolls forward and that window closes. */
	const actualNight = $derived(
		session.phase?.kind === 'night' || session.phase?.kind === 'day'
			? session.phase.cycle
			: null
	);
	const night = $derived(previewNight ?? actualNight);
	/** False when previewing a night other than the one the game clock is
	 * really on — the panel becomes read-only reference in that case. */
	const live = $derived(previewNight == null || previewNight === actualNight);
	/**
	 * The Amnesiac's own wake step(s) — not a real seat_roles assignment, so
	 * wakeOrder() can't find them the normal way. Built from grimoire.notes
	 * (see amnesiac-abilities.ts): a `mimics` assignment reuses the mimicked
	 * character's real mechanics wholesale (its night-order slot, its info
	 * candidates if it has any) so the Storyteller runs it exactly like
	 * anyone else who's really that character; a plain `text` assignment
	 * (prewritten or free-written) instead gets a generic nightly reminder
	 * slot near the end of the queue, with that text shown as a prompt for
	 * the Storyteller to improvise from — same spirit as Cannibal/Lunatic's
	 * "wake manually and dispatch as free text" in laissez-un-faire.ts.
	 */
	const amnesiacWakes = $derived.by(() => {
		if (night == null) return [];
		const out: WakeStep[] = [];
		for (const seat of session.seats) {
			if (session.roleFor(seat.id) !== 'amnesiac') continue;
			const note = session.grimoire.find((g) => g.seat_id === seat.id)?.notes;
			const info = parseAmnesiacNote(note);
			if (!info) continue;
			if (info.mimics) {
				const mimicked = findCharacterAnywhere(info.mimics);
				const step = mimicked ? mimicWakeStep(seat, mimicked, night, 'Amnesiac') : null;
				if (step) out.push(step);
			} else if (info.text) {
				out.push({
					seat,
					character: {
						id: 'amnesiac',
						name: 'Amnesiac',
						team: 'townsfolk',
						summary: info.text,
						firstNight: 900,
						otherNight: 900,
						prompt: { kind: 'none' }
					}
				});
			}
		}
		return out;
	});
	/** The Cannibal's inherited wake step — see cannibal.ts. Unlike the
	 * Amnesiac, there's no "custom text" fallback: the Cannibal only ever
	 * has something to inherit once an execution has actually happened, and
	 * the assignment is always a real character id (the executed player's
	 * own, or the bluff character the Storyteller substituted for it). */
	const cannibalWakes = $derived.by(() => {
		if (night == null) return [];
		const out: WakeStep[] = [];
		for (const seat of session.seats) {
			if (session.roleFor(seat.id) !== 'cannibal') continue;
			const info = parseCannibalNote(session.grimoire.find((g) => g.seat_id === seat.id)?.notes);
			if (!info) continue;
			const mimicked = findCharacterAnywhere(info.inherits);
			const step = mimicked ? mimicWakeStep(seat, mimicked, night, 'Cannibal') : null;
			if (step) out.push(step);
		}
		return out;
	});
	const steps = $derived.by(() => {
		if (!script || night == null) return [];
		const raw = wakeOrder(script, session.seats, (id) => session.roleFor(id), night, [
			...amnesiacWakes,
			...cannibalWakes
		]);
		// A wakeIfDead character (Ravenkeeper) is otherwise eligible on every
		// night once dead — cut it off after the first night it actually got
		// a chance to act, so it doesn't keep re-asking on every later night.
		return raw.filter((step) => {
			if (!step.character.wakeIfDead) return true;
			return !session.nightActions.some(
				(a) => a.seat_id === step.seat.id && a.character_id === step.character.id && a.night < night
			);
		});
	});

	/** Night 1 only: characterId -> the ready-worded evil-team-recognition text
	 * (Demon learns Minions + bluffs; Minions learn the Demon and each other). */
	const evilRevealMap = $derived.by(() => {
		if (!script || night !== 1) return new Map<string, string>();
		const ctx = {
			script,
			seats: session.seats,
			roleOf: (id: string) => session.roleFor(id),
			night: 1,
			askingSeatId: '',
			variant: 0
		};
		return new Map(night1EvilReveals(ctx).map((s) => [s.character.id, s.text]));
	});
	function evilRevealText(characterId: string): string | null {
		return evilRevealMap.get(characterId) ?? null;
	}
	/** True when the Night 1 reveal IS the whole message for this character
	 * (Imp/demon — no kill tonight; Scarlet Woman & Baron/none) — as opposed to
	 * a role that also has its own action that night (Poisoner's choose; the
	 * Spy's grimoire, which happens every night including the first), where
	 * the reveal is folded into that action instead, since night_actions
	 * allows only one row per seat per night. */
	function isRevealOnly(character: Character): boolean {
		if (character.team === 'demon') return character.prompt.kind === 'choose';
		if (character.team === 'minion') return character.prompt.kind === 'none';
		return false;
	}
	function isDemonSeat(seatId: string): boolean {
		const cid = session.roleFor(seatId);
		const c = script && cid ? getCharacter(script, cid) : undefined;
		return c?.team === 'demon';
	}
	/** True when this seat's displayed character is a cover story for the
	 * Drunk — the seat itself has no idea, but the Storyteller needs the
	 * reminder that anything "learned" here doesn't have to be true. */
	function isDrunkSeat(seatId: string): boolean {
		return session.grimoire.find((g) => g.seat_id === seatId)?.real_character_id === 'drunk';
	}

	function actionFor(seatId: string) {
		// Preview mode never reflects real dispatch state — it's a reference
		// view of what *would* be asked/sent, not a record of what was.
		if (night == null || !live) return undefined;
		return session.nightActions.find((a) => a.seat_id === seatId && a.night === night);
	}

	// Per-seat scratch state: the text currently staged in the box, a shuffle
	// counter for regenerating candidates, and (Undertaker only) who was
	// executed yesterday.
	let draftText = $state<Record<string, string>>({});
	let variant = $state<Record<string, number>>({});
	/** How strong the Storyteller wants a pairing/count candidate to be —
	 * see nightInfo.ts's ImpactLevel doc comment. Per-seat, defaults to
	 * 'medium' (this file's original, unparametrised behaviour). */
	let impactLevel = $state<Record<string, ImpactLevel>>({});
	let executedFor = $state<Record<string, string>>({});
	let editing = $state<Record<string, boolean>>({});
	/** Staged text for the per-seat "plan ahead" note — see prepNoteFor() and
	 * the Amnesiac's wake step above. Keyed by seatId; only diverges from
	 * the saved session.prepNotes row while the Storyteller is mid-edit. */
	let prepDraft = $state<Record<string, string>>({});

	function candidatesFor(seatId: string, characterId: string): InfoCandidate[] {
		if (!script || night == null) return [];
		const character = script.characters.find((c) => c.id === characterId);
		if (!character) return [];
		// Night 1 reveal-only characters (Imp, Spy, ...) get their own dedicated
		// send button in the template and never reach this function via an
		// info-preplan/info-auto branch — nothing to special-case here anymore.
		const ctx = {
			script,
			seats: session.seats,
			roleOf: (id: string) => session.roleFor(id),
			night,
			askingSeatId: seatId,
			variant: variant[seatId] ?? 0,
			impactLevel: impactLevel[seatId] ?? 'medium'
		};
		const opts =
			character.prompt.kind === 'info-auto' && character.prompt.compute === 'undertaker'
				? { executedCharacterId: executedFor[seatId] || null }
				: undefined;
		return infoCandidatesFor(ctx, character, opts) ?? [];
	}

	function shuffle(seatId: string) {
		variant[seatId] = (variant[seatId] ?? 0) + 1;
	}

	/** Only the pairing roles (Washerwoman/Librarian/Investigator) and the
	 * two count roles (Chef/Empath) actually read impactLevel — showing the
	 * selector for Undertaker/Balloonist etc. would just be a dead control. */
	function usesImpactLevel(character: Character): boolean {
		if (character.prompt.kind === 'info-preplan') return true;
		return (
			character.prompt.kind === 'info-auto' &&
			(character.prompt.compute === 'chef' || character.prompt.compute === 'empath')
		);
	}

	async function send(seatId: string, characterId: string) {
		const text = (draftText[seatId] ?? '').trim();
		if (!text || night == null) return;
		actionError = null;
		await run(sendNightInfo(session.client, gameId, night, seatId, characterId, '', text));
		editing[seatId] = false;
		const note = prepNoteFor(seatId);
		if (note && !note.released) run(markPrepNoteReleased(session.client, note.id));
	}

	/** This seat's saved "plan ahead" draft for the night being shown, if any. */
	function prepNoteFor(seatId: string) {
		if (night == null) return undefined;
		return session.prepNotes.find((p) => p.seat_id === seatId && p.night === night);
	}

	function savePrep(seatId: string) {
		if (night == null) return;
		const body = (prepDraft[seatId] ?? prepNoteFor(seatId)?.body ?? '').trim();
		run(savePrepNote(session.client, gameId, night, seatId, body));
	}

	/** Marks the Widow's chosen victim poisoned — see poison.ts. Re-derived
	 * live from whether the Widow's own seat is still alive, so there's
	 * nothing to "clear" when the Widow eventually dies. */
	async function poisonWidowVictim(victimSeatId: string, widowSeatId: string) {
		const existing = session.grimoire.find((g) => g.seat_id === victimSeatId)?.tokens;
		const tokens = addToken(existing, { kind: 'poisoned', source: 'widow', sourceSeatId: widowSeatId });
		await run(setSeatTokens(session.client, gameId, victimSeatId, tokens));
	}

	async function ask(
		seatId: string,
		characterId: string,
		ability: string,
		validSeatIds: string[],
		teammateSeatIds: string[] = []
	) {
		if (night == null) return;
		actionError = null;
		await run(
			askNightChoice(session.client, gameId, night, seatId, characterId, ability, validSeatIds, teammateSeatIds)
		);
	}

	function startEdit(seatId: string, seedText: string) {
		draftText[seatId] = seedText;
		editing[seatId] = true;
	}

	function seatName(id: string): string {
		const s = session.seats.find((x) => x.id === id);
		return s ? s.name || `Seat ${s.seat_index + 1}` : '?';
	}

	/** The Spy's "sees the grimoire" ability, as a one-shot snapshot text sent
	 * like any other info — every seat's true character (the Drunk's REAL
	 * identity, not their cover story) and the red herring, exactly what the
	 * physical grimoire book would show. Taken fresh each time the button is
	 * clicked, so re-sending after a death or a new deal is just a click. */
	function grimoireSnapshotText(): string {
		if (!script) return '';
		const ordered = [...session.seats].sort((a, b) => a.seat_index - b.seat_index);
		const lines = ordered.map((seat) => {
			const label = seat.name || `Seat ${seat.seat_index + 1}`;
			const trueCharId = isDrunkSeat(seat.id) ? 'drunk' : session.roleFor(seat.id);
			const charName = trueCharId
				? (getCharacter(script!, trueCharId)?.name ?? trueCharId)
				: '— no character —';
			const tags = [
				!seat.alive && 'dead',
				seat.id === session.redHerringSeatId && 'red herring'
			].filter(Boolean);
			return `${label} — ${charName}${tags.length ? ` (${tags.join(', ')})` : ''}`;
		});
		return lines.join('\n');
	}
</script>

{#if night == null}
	<p class="muted">Night dispatch shows up here once the game is in a night phase.</p>
{:else if steps.length === 0}
	<p class="muted">No one seated tonight has a character with something to do.</p>
{:else}
	{#if !live}
		<p class="preview-banner">
			Preview of Night {night} — reference only. {actualNight == null
				? 'The game isn’t in a night phase yet, so nothing here can actually be sent.'
				: `The game is really on Night ${actualNight} — switch the preview to match to send anything.`}
		</p>
	{/if}
	<div class="stack">
		{#each steps as step (step.seat.id)}
			{@const action = actionFor(step.seat.id)}
			{@const kind = step.character.prompt.kind}
			{@const reveal = night === 1 ? evilRevealText(step.character.id) : null}
			{@const revealOnly = reveal != null && isRevealOnly(step.character)}
			<div class="card stack step">
				<div class="row" style="align-items:center;justify-content:space-between;flex-wrap:nowrap">
					<div class="row" style="align-items:center;flex-wrap:nowrap;gap:0.5rem">
						<Avatar characterId={step.character.id} size="sm" />
						<div>
							<strong>{step.character.name}</strong>
							<div class="muted" style="font-size:0.8rem">{step.seat.name || `Seat ${step.seat.seat_index + 1}`}</div>
						</div>
					</div>
					<span class="status" class:done={action?.released_at}>
						{#if !live}
							preview
						{:else if kind === 'choose' && !revealOnly && action?.result}
							answered
						{:else if action?.released_at}
							sent
						{:else}
							pending
						{/if}
					</span>
				</div>

				<details class="prepnote">
					<summary>📝 Notes to self{prepNoteFor(step.seat.id)?.body ? '' : ' (empty)'}</summary>
					<textarea
						rows="2"
						placeholder="Plan what you'll tell them, or jot a reminder — private, never sent, works for future nights too."
						value={prepDraft[step.seat.id] ?? prepNoteFor(step.seat.id)?.body ?? ''}
						oninput={(e) => (prepDraft[step.seat.id] = e.currentTarget.value)}
					></textarea>
					<button onclick={() => savePrep(step.seat.id)}>Save note</button>
				</details>

				{#if session.roleFor(step.seat.id) === 'amnesiac'}
					<p class="drunk-warning">
						🌀 Amnesiac's secret ability: {step.character.summary}
					</p>
				{/if}

				{#if isDrunkSeat(step.seat.id)}
					<p class="drunk-warning">
						🍺 This seat is actually the Drunk, shown as the {step.character.name} — their ability
						doesn't really work. Anything sent here doesn't need to be true.
					</p>
				{/if}

				{@const poison = poisonStatus(step.seat.id, session.grimoire, session.seats)}
				{#if poison.poisoned}
					<p class="drunk-warning">
						🧪 {seatName(step.seat.id)} is {poison.reason} — the "if poisoned" candidates below are
						fair game.
					</p>
				{/if}

				{#if revealOnly}
					<!-- Night 1 evil-team recognition IS the whole message for this
					     character (Imp/demon; Spy/grimoire; Scarlet Woman & Baron/none) —
					     a dedicated one-click send rather than routing it through the
					     generic info-candidate box below, so it can't be missed or
					     mistaken for something that needs composing. -->
					<p class="revealbox">{reveal}</p>
					{#if !live}
						<p class="muted hint" style="margin:0">Preview only — switch to the real night to send.</p>
					{:else if action?.released_at}
						<p class="muted" style="margin:0">Sent.</p>
					{:else}
						<button
							class="primary"
							onclick={() =>
								run(sendNightInfo(session.client, gameId, night!, step.seat.id, step.character.id, '', reveal!))}
						>
							Send Night 1 reveal to {step.seat.name || 'them'}
						</button>
					{/if}
				{:else if kind === 'grimoire'}
					{#if reveal}
						<p class="revealbox">{reveal}</p>
					{/if}
					{#if !live}
						<p class="muted hint" style="margin:0">
							Sends a snapshot of every seat's true character — preview only, switch to the real
							night to send.
						</p>
					{:else if action?.result}
						<p class="grimoire-snapshot">{action.result}</p>
						<div class="row">
							<button
								onclick={() =>
									run(
										sendNightInfo(
											session.client,
											gameId,
											night!,
											step.seat.id,
											step.character.id,
											'',
											reveal ? `${reveal}\n\n${grimoireSnapshotText()}` : grimoireSnapshotText()
										)
									)}
							>
								Refresh &amp; resend
							</button>
						</div>
					{:else}
						<p class="muted" style="margin:0">
							Sees the full grimoire — every seat's true character (the Drunk's real identity, not
							their cover) and the red herring.
						</p>
						<button
							class="primary"
							onclick={() =>
								run(
									sendNightInfo(
										session.client,
										gameId,
										night!,
										step.seat.id,
										step.character.id,
										'',
										reveal ? `${reveal}\n\n${grimoireSnapshotText()}` : grimoireSnapshotText()
									)
								)}
						>
							Send grimoire snapshot to {step.seat.name || 'them'}
						</button>
					{/if}
				{:else if kind === 'choose'}
					{#if step.character.prompt.kind === 'choose'}
						{@const choicePrompt = choicePromptFor(
							{
								script: script!,
								seats: session.seats,
								roleOf: (id: string) => session.roleFor(id),
								night: night!,
								askingSeatId: step.seat.id
							},
							step.character
						)}
						{@const pool = session.seats.filter((s) => choicePrompt?.validSeatIds.includes(s.id))}
						{@const teammateSeatIds = choicePrompt?.teammateSeatIds ?? []}
						{#if reveal}
							<p class="revealbox">{reveal}</p>
						{/if}
						{#if !live}
							<p style="margin:0">{step.character.summary}</p>
							<p class="muted" style="margin:0">
								Player picks {step.character.prompt.count === 2 ? 'two seats' : 'one seat'} from
								among {pool.length} eligible {pool.length === 1 ? 'seat' : 'seats'}
								{step.character.prompt.canPickSelf ? '(may pick themselves)' : '(not themselves)'}.
							</p>
							{#if teammateSeatIds.length}
								<p class="muted" style="margin:0">
									🤝 {teammateSeatIds.length} of those {teammateSeatIds.length === 1 ? 'seat is' : 'seats are'} a fellow evil teammate — flagged for the player too.
								</p>
							{/if}
						{:else if action?.result}
							{@const parsed = parseChoiceResult(action.result)}
							<p style="margin:0">
								Chose: <strong>{(parsed?.picks ?? []).map(seatName).join(' and ') || '—'}</strong>
							</p>
							{#if step.character.id === 'fortune-teller' && parsed}
								{#if parsed.reading}
									<p style="margin:0">
										Reading sent: <strong>{parsed.reading === 'yes' ? 'Yes — reads as the Demon' : 'No'}</strong>
									</p>
								{:else}
									{@const yesReading = parsed.picks.some(
										(id) => isDemonSeat(id) || id === session.redHerringSeatId
									)}
									<button
										class="primary"
										onclick={() =>
											run(
												sendChoiceReading(
													session.client,
													action.id,
													parsed.picks,
													yesReading ? 'yes' : 'no'
												)
											)}
									>
										Send reading: {yesReading ? 'Yes' : 'No'}
									</button>
								{/if}
							{:else if step.character.id === 'ravenkeeper' && parsed}
								{#if parsed.reading}
									<p style="margin:0">Reveal sent: <strong>{parsed.reading}</strong></p>
								{:else}
									{@const targetId = parsed.picks[0]}
									{@const targetCharId = targetId ? session.roleFor(targetId) : null}
									{@const targetName =
										(script && targetCharId ? getCharacter(script, targetCharId)?.name : null) ??
										'no character assigned'}
									<button
										class="primary"
										onclick={() =>
											run(sendChoiceReading(session.client, action.id, parsed.picks, targetName))}
									>
										Send reveal: {targetName}
									</button>
								{/if}
							{:else if step.character.id === 'widow' && parsed}
								{@const victimId = parsed.picks[0]}
								{@const victimPoison = victimId ? poisonStatus(victimId, session.grimoire, session.seats) : null}
								{#if victimId}
									{#if victimPoison?.poisoned}
										<p class="muted" style="margin:0">🧪 {seatName(victimId)} is {victimPoison.reason}.</p>
									{:else}
										<button class="primary" onclick={() => poisonWidowVictim(victimId, step.seat.id)}>
											🧪 Poison {seatName(victimId)}
										</button>
									{/if}
								{/if}
							{/if}
							<div class="row">
								<button onclick={() => run(reopenNightChoice(session.client, action.id))}>
									Let them choose again
								</button>
							</div>
						{:else if action?.released_at}
							<p class="muted" style="margin:0">Waiting on {step.seat.name || 'them'} to answer…</p>
						{:else}
							<p class="muted" style="margin:0">{step.character.summary}</p>
							{#if teammateSeatIds.length}
								<p class="muted teammate-note" style="margin:0">
									🤝 {teammateSeatIds.map(seatName).join(', ')} will be flagged to {step.seat.name || 'them'} as fellow evil.
								</p>
							{/if}
							<button
								class="primary"
								onclick={() =>
									ask(
										step.seat.id,
										step.character.id,
										reveal ? `${reveal}\n\n${step.character.summary}` : step.character.summary,
										pool.map((s) => s.id),
										teammateSeatIds
									)}
							>
								Ask {step.seat.name || 'them'} to choose
							</button>
						{/if}
					{/if}
				{:else if !live}
					<!-- preview: read-only worked examples, nothing to click or send -->
					<div class="stack" style="gap:0.35rem">
						{#each candidatesFor(step.seat.id, step.character.id) as cand (cand.label)}
							<div class="preview-cand" class:truthful={cand.truthful}>
								<span class="candlabel">{cand.label}</span>
								<span>{cand.text}</span>
							</div>
						{/each}
					</div>
					<p class="muted hint" style="margin:0">
						Or the Storyteller can always write their own wording instead — same as live.
					</p>
				{:else}
					<!-- info-preplan / info-auto: candidates to click in, or write your own -->
					{#if step.character.id === 'undertaker'}
						<div>
							<label for="exec-{step.seat.id}">Executed yesterday</label>
							<select id="exec-{step.seat.id}" bind:value={executedFor[step.seat.id]}>
								<option value="">— nobody executed —</option>
								{#each script?.characters ?? [] as c (c.id)}
									<option value={c.id}>{c.name}</option>
								{/each}
							</select>
						</div>
					{/if}

					{#if action?.released_at && !editing[step.seat.id]}
						<p style="margin:0"><strong>{action.result}</strong></p>
						<div class="row">
							<button onclick={() => startEdit(step.seat.id, action.result ?? '')}>Edit &amp; resend</button>
						</div>
					{:else}
						<div class="row candidates">
							{#each candidatesFor(step.seat.id, step.character.id) as cand (cand.label)}
								<button
									class="candidate"
									class:truthful={cand.truthful}
									title={cand.rationale}
									onclick={() => (draftText[step.seat.id] = cand.text)}
								>
									{cand.label}
								</button>
							{/each}
							{#if usesImpactLevel(step.character)}
								<select
									value={impactLevel[step.seat.id] ?? 'medium'}
									onchange={(e) =>
										(impactLevel[step.seat.id] = e.currentTarget.value as ImpactLevel)}
									title="How strong/actionable this candidate should be — see the ⓘ rationale on each option"
								>
									<option value="low">Impact: low</option>
									<option value="medium">Impact: medium</option>
									<option value="high">Impact: high</option>
								</select>
							{/if}
							<button onclick={() => shuffle(step.seat.id)} title="Regenerate the decoy/lie candidates">
								&#x21bb; shuffle
							</button>
							{#if prepNoteFor(step.seat.id)?.body}
								<button
									onclick={() => (draftText[step.seat.id] = prepNoteFor(step.seat.id)?.body ?? '')}
									title="Copy in the note you planned earlier"
								>
									📝 use my note
								</button>
							{/if}
						</div>
						<textarea
							rows="2"
							placeholder="Click a candidate above, or write your own…"
							value={draftText[step.seat.id] ?? ''}
							oninput={(e) => (draftText[step.seat.id] = e.currentTarget.value)}
						></textarea>
						<div class="row">
							<button
								class="primary"
								disabled={!(draftText[step.seat.id] ?? '').trim()}
								onclick={() => send(step.seat.id, step.character.id)}
							>
								Send to {step.seat.name || 'them'}
							</button>
						</div>
					{/if}
				{/if}

				{#if action}
					<button
						class="clearlink"
						onclick={() => {
							run(clearNightAction(session.client, action.id));
							editing[step.seat.id] = false;
						}}
					>
						clear
					</button>
				{/if}
			</div>
		{/each}
	</div>
	{#if actionError}<p class="error">{actionError}</p>{/if}
{/if}

<style>
	.step {
		gap: 0.6rem;
	}
	.status {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-dim);
		white-space: nowrap;
	}
	.status.done {
		color: var(--ok);
	}
	.candidates {
		gap: 0.4rem;
	}
	.candidate {
		font-size: 0.78rem;
		padding: 0.4rem 0.6rem;
	}
	.candidate.truthful {
		border-color: var(--ok);
	}
	textarea {
		width: 100%;
		font: inherit;
		color: var(--text);
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.6rem 0.7rem;
		resize: vertical;
	}
	.clearlink {
		align-self: flex-start;
		border: none;
		background: none;
		padding: 0.3rem 0;
		min-height: auto;
		font-size: 0.72rem;
		color: var(--text-dim);
		text-decoration: underline;
	}
	.preview-banner {
		margin: 0;
		font-size: 0.82rem;
		color: var(--text-dim);
		background: var(--surface-2);
		border: 1px dashed var(--border);
		border-radius: 8px;
		padding: 0.6rem 0.8rem;
	}
	.revealbox {
		margin: 0;
		font-size: 0.85rem;
		background: var(--surface-2);
		border: 1px solid var(--ok);
		border-radius: 8px;
		padding: 0.55rem 0.7rem;
	}
	.drunk-warning {
		margin: 0;
		font-size: 0.82rem;
		background: var(--surface-2);
		border: 1px dashed var(--accent);
		border-radius: 8px;
		padding: 0.5rem 0.7rem;
	}
	.preview-cand {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		font-size: 0.88rem;
		padding: 0.4rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-2);
	}
	.preview-cand.truthful {
		border-color: var(--ok);
	}
	.preview-cand .candlabel {
		flex: 0 0 auto;
		font-weight: 600;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-dim);
	}
	.hint {
		font-size: 0.78rem;
	}
	.teammate-note {
		color: var(--accent);
	}
	.grimoire-snapshot {
		margin: 0;
		white-space: pre-wrap;
		font-size: 0.85rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.55rem 0.7rem;
	}
	.prepnote {
		font-size: 0.82rem;
	}
	.prepnote summary {
		cursor: pointer;
		color: var(--text-dim);
	}
	.prepnote textarea {
		margin-top: 0.4rem;
		font-size: 0.82rem;
	}
</style>
