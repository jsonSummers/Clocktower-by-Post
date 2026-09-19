import { base } from '$app/paths';
import type { ScriptTheme } from './scriptTheme';

/**
 * app.css defines --altar-tex/--stone-tex/--parchment-tex/--wood-tex/
 * --redstone-tex as CSS custom properties with hardcoded root-relative
 * url('/textures/...') values, once per [data-theme]/[data-script-theme]
 * combination. That's fine for a deploy at the domain root (Vercel,
 * self-hosted, a custom domain) but breaks on a GitHub Pages *project*
 * page, served from /reponame/ — CSS url() values aren't something
 * SvelteKit's router or its `base` path can rewrite, unlike a Svelte
 * component's own href/src attributes.
 *
 * Fix: re-set these same properties from JS, inline on <html>, with the
 * correct `base` prefix baked in — inline style always wins over a
 * stylesheet :root rule regardless of specificity, so this fully
 * overrides app.css's values once it runs (and since this is a client-only
 * SPA with no SSR, nothing paints before it does — no visible flash).
 *
 * Two independent call sites feed this: +layout.svelte's day/night $effect
 * (setMode) and scriptTheme.ts's applyScriptTheme (setScriptTheme). Each
 * just updates its own half of the state and re-derives the full set, so
 * call order between the two never matters.
 */

type Mode = 'day' | 'night';

const FILES: Record<ScriptTheme, Record<Mode, { altar: string; stone: string; parchment: string }>> = {
	gothic: {
		day: { altar: 'altar-brick.jpg', stone: 'limestone.jpg', parchment: 'parchment.jpg' },
		night: {
			altar: 'altar-brick-night.jpg',
			stone: 'limestone-night.jpg',
			parchment: 'parchment-night.jpg'
		}
	},
	lovecraft: {
		day: {
			altar: 'altar-brick-lovecraft.jpg',
			stone: 'warded-damask.jpg',
			parchment: 'old-leather.jpg'
		},
		night: {
			altar: 'altar-brick-lovecraft-night.jpg',
			stone: 'warded-damask-night.jpg',
			parchment: 'old-leather-night.jpg'
		}
	}
};

let scriptTheme: ScriptTheme = 'gothic';
let mode: Mode = 'day';

function apply() {
	if (typeof document === 'undefined') return;
	const files = FILES[scriptTheme][mode];
	const style = document.documentElement.style;
	const url = (name: string) => `url('${base}/textures/${name}')`;
	style.setProperty('--altar-tex', url(files.altar));
	style.setProperty('--stone-tex', url(files.stone));
	style.setProperty('--parchment-tex', url(files.parchment));
	// Constant across every theme/mode today, but still routed through the
	// same base-prefixing so a future themed variant of either just works.
	style.setProperty('--wood-tex', url('oak.jpg'));
	style.setProperty('--redstone-tex', url('redstone.jpg'));
}

export function setTextureMode(next: Mode) {
	mode = next;
	apply();
}

export function setTextureScriptTheme(next: ScriptTheme) {
	scriptTheme = next;
	apply();
}
