<script lang="ts">
	import type { Script, Team } from '$lib/types';
	import Avatar from './Avatar.svelte';

	interface Props {
		script: Script | undefined;
		open: boolean;
		onclose: () => void;
	}
	let { script, open, onclose }: Props = $props();

	const TEAM_ORDER: Team[] = ['townsfolk', 'outsider', 'minion', 'demon', 'traveller', 'fabled'];
	const TEAM_LABEL: Record<Team, string> = {
		townsfolk: 'Townsfolk',
		outsider: 'Outsiders',
		minion: 'Minions',
		demon: 'Demon',
		traveller: 'Travellers',
		fabled: 'Fabled'
	};

	const grouped = $derived(
		TEAM_ORDER.map((team) => ({
			team,
			chars: (script?.characters ?? []).filter((c) => c.team === team)
		})).filter((g) => g.chars.length > 0)
	);
</script>

{#if open}
	<div class="scrim" onclick={onclose} role="presentation"></div>
	<aside class="drawer" aria-label="Help">
		<div class="head">
			<h2>How this works</h2>
			<button onclick={onclose} aria-label="Close">✕</button>
		</div>

		<div class="body stack">
			<section class="stack" style="gap:0.4rem">
				<p>
					The clock at the top is shared by everyone. During the <strong>day</strong> you talk in
					person; during the <strong>night</strong> you'll get any private information on this
					screen.
				</p>
				<p>
					Nominations, votes and executions happen <strong>in person</strong> when the group gathers
					— the app just keeps time and passes you what you need to know.
				</p>
				<p>
					Stuck, or need a private word? Use <strong>Ask to see the Storyteller</strong> and they'll
					come find you.
				</p>
			</section>

			{#if script}
				<section class="stack" style="gap:0.6rem">
					<h3>{script.name} — the characters</h3>
					<p class="muted">Summaries are paraphrased. Your Storyteller has the final word.</p>
					{#each grouped as g (g.team)}
						<div>
							<div class="team">{TEAM_LABEL[g.team]}</div>
							<ul>
								{#each g.chars as c (c.id)}
									<li class="charrow">
										<Avatar characterId={c.id} size="sm" label={c.name} />
										<span><strong>{c.name}.</strong> {c.summary}</span>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				</section>
			{/if}
		</div>
	</aside>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 40;
	}
	.drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(28rem, 92vw);
		background: var(--bg);
		border-left: 1px solid var(--border);
		z-index: 41;
		display: flex;
		flex-direction: column;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.1rem;
		border-bottom: 1px solid var(--border);
	}
	.head h2 {
		margin: 0;
		font-size: 1.15rem;
	}
	.head button {
		border: none;
		background: transparent;
		font-size: 1rem;
		padding: 0.3rem 0.5rem;
	}
	.body {
		padding: 1.1rem;
		overflow-y: auto;
	}
	.team {
		font-size: 0.72rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--accent);
		margin-bottom: 0.2rem;
	}
	.body ul {
		margin: 0;
		padding-left: 0;
		list-style: none;
	}
	.body li {
		margin-bottom: 0.35rem;
		font-size: 0.9rem;
	}
	.charrow {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}
	.charrow span {
		padding-top: 0.1rem;
	}
</style>
