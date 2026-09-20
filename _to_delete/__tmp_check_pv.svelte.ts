
	import { serverTimeSynced } from '$lib/server-time';
	import { GameSession } from '$lib/game.svelte';
	import { getScript, getCharacter } from '$lib/scripts';
	import { formatClock } from '$lib/clock';
	import { applyScriptTheme } from '$lib/scriptTheme';
	import { voteState } from '$lib/scripts/winCondition';
	import { requestMeet, leaveSeat, submitNightChoice, castVote, retractVote } from '$lib/actions';
	import Circle from './Circle.svelte';
	import ClockFace from './ClockFace.svelte';
	import InfoDrawer from './InfoDrawer.svelte';
	import Avatar from './Avatar.svelte';

	interface Props {
		session: GameSession;
		gameId: string;
	}
	let { session, gameId }: Props = $props();

	let infoOpen = $state(false);
	let meetReason = $state('');
	let amnesiacGuess = $state('');
	let lastGather = $state(false);
	let actionError = $state<string | null>(null);
	let confirmingLeave = $state(false);
	let leaveTimer: ReturnType<typeof setTimeout> | null = null;
	let selectedSeatIds = $state<string[]>([]);
	let newNightInfo = $state(false);
	let newNightInfoTimer: ReturnType<typeof setTimeout> | null = null;

	const script = $derived(session.game ? getScript(session.game.script_id) : undefined);
	// Steampunk theme for Laissez un Faire, gothic for everything else --
	// see src/lib/scriptTheme.ts. Also applied by the dev-page simulator's
	// own top-level effect when this is rendered as a bot's screen there;
	// both compute the same value from the same script_id, so it's a
	// harmless no-op overlap, not a conflict.
	$effect(() => applyScriptTheme(session.game?.script_id));
	const roleChar = $derived(
		script && session.myRole ? getCharacter(script, session.myRole) : undefined
	);
	// ---- tonight's info / choice, if this character has something to do ----
	const nightRow = $derived(session.myNightAction);
	const actsTonight = $derived.by(() => {
		if (!roleChar || session.phase?.kind !== 'night') return false;
		const isFirst = session.phase.cycle <= 1;
		return (isFirst ? roleChar.firstNight : roleChar.otherNight) != null;
	});
	const maxChoice = $derived(roleChar?.prompt.kind === 'choose' ? roleChar.prompt.count : 1);
	/** night_actions.choices is stored as { ids, teammateIds } for choose-type
	 * prompts (see askNightChoice() in actions.ts) — teammateIds are seats the
	 * Storyteller has flagged as this player's known fellow evil team members,
	 * so e.g. the Imp doesn't accidentally pick their own Poisoner. Falls back
	 * to treating a bare array (older rows) as no-teammate-info. */
	const storedChoices = $derived.by(() => {
		const raw = nightRow?.choices as { ids?: string[]; teammateIds?: string[] } | string[] | null;
		if (!raw) return { ids: [] as string[], teammateIds: [] as string[] };
		if (Array.isArray(raw)) return { ids: raw, teammateIds: [] as string[] };
		return { ids: raw.ids ?? [], teammateIds: raw.teammateIds ?? [] };
	});
	const choiceSeatIds = $derived(storedChoices.ids);
	const teammateSeatIdSet = $derived(new Set(storedChoices.teammateIds));
	const chosenSeatIds = $derived.by(() => {
		if (!nightRow?.result) return null;
		try {
			const v = JSON.parse(nightRow.result);
			return Array.isArray(v) ? (v as string[]) : null;
		} catch {
			return null;
		}
	});

	$effect(() => {
		void nightRow?.id;
		selectedSeatIds = [];
	});

	function toggleChoice(seatId: string) {
		if (selectedSeatIds.includes(seatId)) {
			selectedSeatIds = selectedSeatIds.filter((id) => id !== seatId);
		} else if (selectedSeatIds.length < maxChoice) {
			selectedSeatIds = [...selectedSeatIds, seatId];
		}
	}

	async function submitChoice() {
		if (!nightRow) return;
		actionError = null;
		const { error } = await submitNightChoice(session.client, nightRow.id, selectedSeatIds);
		if (error) actionError = error.message;
	}
	// ---- nomination / voting ----
	const nom = $derived(session.latestNomination);
	const nomVotes = $derived(session.votesForLatest);
	const nomThreshold = $derived(voteState(session.seats).votesToExecute);
	const nomineeName = $derived(
		nom ? (session.seats.find((s) => s.id === nom.nominee_seat_id)?.name ?? '?') : ''
	);
	const nominatorName = $derived(
		nom?.nominator_seat_id
			? (session.seats.find((s) => s.id === nom.nominator_seat_id)?.name ?? null)
			: null
	);
	const canVote = $derived(
		session.mySeat && (session.mySeat.alive || session.mySeat.ghost_vote_available)
	);
	/** "1:23" / "+0:07 over" — see GameSession.debateRemainingMs. Null hides
	 * the timer line entirely (no timer set for this nomination, or it's not
	 * in debate right now). */
	const debateDisplay = $derived.by(() => {
		const ms = session.debateRemainingMs;
		if (ms == null) return null;
		return formatClock({ running: true, elapsedMs: 0, remainingMs: ms, overrun: ms < 0 });
	});
	const debateOverrun = $derived((session.debateRemainingMs ?? 0) < 0);
	let voting = $state(false);
	async function toggleVote() {
		if (!nom) return;
		voting = true;
		actionError = null;
		const { error } = session.myVoteCast
			? await retractVote(session.client, nom.id)
			: await castVote(session.client, nom.id);
		if (error) actionError = error instanceof Error ? error.message : String(error);
		voting = false;
	}

	// Buzz once when a nomination newly opens or moves into voting — the
	// point of doing this on the phone at all, for a party spread out beyond
	// earshot of "I nominate...".
	let sawNomination = false;
	let lastNomSig = '';
	$effect(() => {
		const sig = nom ? `${nom.id}:${nom.stage}` : '';
		if (!sawNomination) {
			sawNomination = true;
			lastNomSig = sig;
			return;
		}
		if (sig !== lastNomSig && sig !== '') buzz();
		lastNomSig = sig;
	});

	const neighbourIds = $derived(
		[session.myNeighbours.ccw?.id, session.myNeighbours.cw?.id].filter(Boolean) as string[]
	);
	const neighbourNames = $derived(
		neighbourIds
			.map((id) => session.seats.find((s) => s.id === id)?.name)
			.filter(Boolean)
			.join(' and ')
	);
	const myOpenRequest = $derived(
		session.mySeat
			? session.meetRequests.find(
					(r) => r.seat_id === session.mySeat!.id && r.status === 'waiting'
				)
			: undefined
	);
	const queuePosition = $derived(
		myOpenRequest
			? session.meetRequests
					.filter((r) => r.status === 'waiting')
					.findIndex((r) => r.id === myOpenRequest!.id) + 1
			: 0
	);

	$effect(() => {
		const on = session.game?.gather ?? false;
		if (on && !lastGather) buzz();
		lastGather = on;
	});

	// Let a player know the Storyteller released (or updated) their night
	// info without them having to keep checking the screen — skip the
	// baseline captured on first load/mount so a reconnect doesn't re-buzz
	// for information they've already seen.
	let sawNightInfo = false;
	let lastNightSig = '';
	$effect(() => {
		const sig = nightRow ? `${nightRow.id}:${nightRow.result ?? ''}:${nightRow.prompt ?? ''}` : '';
		if (!sawNightInfo) {
			sawNightInfo = true;
			lastNightSig = sig;
			return;
		}
		if (sig !== lastNightSig && sig !== '') {
			buzz();
			newNightInfo = true;
			if (newNightInfoTimer) clearTimeout(newNightInfoTimer);
			newNightInfoTimer = setTimeout(() => (newNightInfo = false), 5000);
		}
		lastNightSig = sig;
	});

	function buzz() {
		navigator.vibrate?.([200, 100, 200, 100, 200]);
		try {
			const ctx = new AudioContext();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.frequency.value = 660;
			gain.gain.value = 0.06;
			osc.connect(gain).connect(ctx.destination);
			osc.start();
			osc.stop(ctx.currentTime + 0.5);
		} catch {
			/* audio may be blocked until first interaction */
		}
	}

	async function askToMeet() {
		if (!session.mySeat) return;
		actionError = null;
		const { error } = await requestMeet(
			session.client,
			gameId,
			session.mySeat.id,
			meetReason.trim() || null
		);
		if (error) actionError = error.message;
		else meetReason = '';
	}

	/** Savant/Fisherman/Artist/Amnesiac's "privately ask the Storyteller"
	 * abilities (Character.dayAsk) reuse this same meet-request queue,
	 * tagged so the Storyteller's Requests panel can recognise and prep for
	 * them — see dayAsk.ts. The actual exchange happens face to face; this
	 * just flags that the player is waiting and, for the Amnesiac, carries
	 * their typed guess along. */
	async function askDayAsk(tag: string, extra?: string) {
		if (!session.mySeat) return;
		actionError = null;
		const reason = extra?.trim() ? `${tag} ${extra.trim()}` : `${tag} wants to talk privately`;
		const { error } = await requestMeet(session.client, gameId, session.mySeat.id, reason);
		if (error) actionError = error.message;
		else amnesiacGuess = '';
	}

	function dayAskGuidance(kind: string): string {
		switch (kind) {
			case 'savant':
				return 'Walk over any time to privately hear one true and one false statement, unmarked.';
			case 'fisherman':
				return 'Once per game: walk over to privately ask for advice on how to help your team win.';
			case 'artist':
				return 'Once per game: walk over to privately ask any yes/no question.';
			default:
				return 'Walk over to the Storyteller privately.';
		}
	}

	function clickLeave() {
		if (!confirmingLeave) {
			confirmingLeave = true;
			leaveTimer = setTimeout(() => (confirmingLeave = false), 4000);
			return;
		}
		if (leaveTimer) clearTimeout(leaveTimer);
		confirmingLeave = false;
		doLeave();
	}

	async function doLeave() {
		if (!session.mySeat) return;
		actionError = null;
		const { error } = await leaveSeat(session.client, session.mySeat.id);
		if (error) actionError = error instanceof Error ? error.message : String(error);
	}
