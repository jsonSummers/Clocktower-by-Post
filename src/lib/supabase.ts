import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

export const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
export const supabaseAnonKey = env.PUBLIC_SUPABASE_ANON_KEY ?? '';

/** False until a real project URL + anon key are in .env — the UI shows a hint. */
export const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const url = supabaseUrl || 'https://placeholder.supabase.co';
const key = supabaseAnonKey || 'placeholder-anon-key';

/** The one client a real player's or Storyteller's device uses. Session persists. */
export const supabase: SupabaseClient = createClient(url, key, {
	auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cbp-auth' }
});

let signInOnce: Promise<void> | null = null;

/** Anonymous sign-in for the main client, run at most once per page load. */
export function ensureSignedIn(): Promise<void> {
	if (!signInOnce) {
		signInOnce = signInAnon(supabase);
	}
	return signInOnce;
}

/** Anonymous sign-in for any client (used by the simulator's fake players too). */
export async function signInAnon(client: SupabaseClient): Promise<void> {
	const { data } = await client.auth.getSession();
	if (!data.session) {
		const { error } = await client.auth.signInAnonymously();
		if (error) throw new Error(`sign-in failed: ${error.message}`);
	}
}

/**
 * A throwaway client with its own isolated session — one per simulated player
 * on the /dev screen. Each gets a unique storageKey so its anon token never
 * overwrites the real login (or another bot's).
 */
export function createSimClient(): SupabaseClient {
	const tag = `cbp-sim-${Math.random().toString(36).slice(2)}`;
	return createClient(url, key, {
		auth: {
			persistSession: false,
			autoRefreshToken: true,
			storageKey: tag,
			storage: {
				getItem: () => null,
				setItem: () => {},
				removeItem: () => {}
			}
		}
	});
}
