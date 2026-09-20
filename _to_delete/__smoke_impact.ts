import { chefCandidates, empathCandidates, washerwomanCandidates, type NightContext } from '../src/lib/nightInfo';
import { getScript } from '../src/lib/scripts';

const script = getScript('trouble-brewing')!;

function seat(i: number, id: string) {
	return { id, seat_index: i, name: `Seat${i}`, alive: true, user_id: 'u' + i, ghost_vote_available: true, game_id: 'g' } as any;
}

// 7 seats around a ring, evil at index 4 and 5 (adjacent -> chef should see 1 pair)
const seats = [0, 1, 2, 3, 4, 5, 6].map((i) => seat(i, 's' + i));
const roles: Record<string, string> = {
	s0: 'washerwoman', s1: 'librarian', s2: 'investigator', s3: 'chef',
	s4: 'poisoner', s5: 'imp', s6: 'empath'
};
const roleOf = (id: string) => roles[id] ?? null;

function ctx(askingSeatId: string, extra: Partial<NightContext> = {}): NightContext {
	return { script, seats, roleOf, night: 1, askingSeatId, variant: 0, ...extra };
}

console.log('--- chef, medium (default) ---');
console.log(chefCandidates(ctx('s3')));
console.log('--- chef, low (no lie candidates) ---');
console.log(chefCandidates(ctx('s3', { impactLevel: 'low' })));
console.log('--- chef, high (+/-2) ---');
console.log(chefCandidates(ctx('s3', { impactLevel: 'high' })));

console.log('--- empath, medium ---');
console.log(empathCandidates(ctx('s6')));

console.log('--- washerwoman, low impact (decoy far from truth seat) x5 ---');
for (let v = 0; v < 5; v++) {
	const cands = washerwomanCandidates(ctx('s0', { variant: v, impactLevel: 'low' }));
	console.log(v, cands.map((c) => ({ label: c.label, seatIds: c.seatIds })));
}
console.log('--- washerwoman, high impact (decoy adjacent to truth seat) x5 ---');
for (let v = 0; v < 5; v++) {
	const cands = washerwomanCandidates(ctx('s0', { variant: v, impactLevel: 'high' }));
	console.log(v, cands.map((c) => ({ label: c.label, seatIds: c.seatIds })));
}
