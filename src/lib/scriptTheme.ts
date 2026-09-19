import { scriptForCharacter } from './scripts';
import { setTextureScriptTheme } from './textureVars';

/**
 * Which visual theme a script's screens use. Trouble Brewing (and anything
 * unlisted, so a future script defaults sanely) gets the existing pale
 * "monastery by day" / "night vigil" gothic theme; Laissez un Faire gets a
 * Victorian-occult "old leather book" theme -- deep oxblood leather and
 * damask, cult-sigil iconography, with small tarnished-brass accents as the
 * one remaining steampunk touch -- since it's the goblin/lunatic/cannibal
 * "silly little party script" rather than the po-faced main one. (An
 * earlier pass made this a full brass-and-gearwork steampunk theme; Mickey
 * steered it toward Lovecraftian instead the next day -- see the project
 * doc's 2026-09-18 entries for both.)
 *
 * Applied as document.documentElement.dataset.scriptTheme -- a second,
 * independent attribute alongside the existing [data-theme='day'|'night']
 * toggle in +layout.svelte, so a Laissez un Faire game can still be played
 * in "night" mode (candlelit ritual) or "day" mode (a curtained study). See
 * src/app.css's [data-script-theme='lovecraft'] block for the actual
 * colours/textures, and src/lib/eldritchFrame.ts for the matching avatar
 * frame.
 */
export type ScriptTheme = 'gothic' | 'lovecraft';

const SCRIPT_THEME: Record<string, ScriptTheme> = {
	'laissez-un-faire': 'lovecraft'
};

export function themeForScript(scriptId: string | null | undefined): ScriptTheme {
	return (scriptId && SCRIPT_THEME[scriptId]) || 'gothic';
}

/**
 * Which frame an individual avatar should render, looked up straight from
 * the character id (no need for the caller to already have the script in
 * scope) -- see scriptForCharacter().
 */
export function frameForCharacter(characterId: string | null | undefined): ScriptTheme {
	if (!characterId) return 'gothic';
	return themeForScript(scriptForCharacter(characterId)?.id);
}

/**
 * Call from inside a component's own `$effect(...)`, e.g.
 *   $effect(() => applyScriptTheme(session.game?.script_id));
 * Sets [data-script-theme] on <html> and returns a cleanup that resets it
 * back to the gothic default -- so navigating away from a Laissez un Faire
 * screen (back to the home page, or a /dev bot-view selector changing)
 * never leaves the lovecraft theme stuck on an unrelated screen.
 */
export function applyScriptTheme(scriptId: string | null | undefined) {
	if (typeof document === 'undefined') return;
	document.documentElement.dataset.scriptTheme = themeForScript(scriptId);
	setTextureScriptTheme(themeForScript(scriptId));
	return () => {
		document.documentElement.dataset.scriptTheme = 'gothic';
		setTextureScriptTheme('gothic');
	};
}
