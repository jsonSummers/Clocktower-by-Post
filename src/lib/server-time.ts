import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { bestOffset } from './clock';

let cachedOffset = 0;
let synced = false;

/** serverNow - clientNow in ms, as last measured. 0 until syncServerTime() runs. */
export function currentOffset(): number {
	return cachedOffset;
}

export function serverTimeSynced(): boolean {
	return synced;
}

/**
 * Measure the offset between this device's clock and the server's, using a few
 * round trips to the server_now() RPC and keeping the least noisy sample.
 * All clients share one server, so a single cached offset is enough.
 */
export async function syncServerTime(client: SupabaseClient = supabase, samples = 3): Promise<number> {
	const results: Array<[number, number, number]> = [];
	for (let i = 0; i < samples; i++) {
		const sentAt = Date.now();
		const { data, error } = await client.rpc('server_now');
		const receivedAt = Date.now();
		if (error) continue;
		const serverMs = Number(data);
		if (!Number.isFinite(serverMs)) continue;
		results.push([sentAt, serverMs, receivedAt]);
	}
	if (results.length > 0) {
		cachedOffset = bestOffset(results);
		synced = true;
	}
	return cachedOffset;
}
