import { describe, it, expect } from 'vitest';
import {
	washerwomanCandidates,
	librarianCandidates,
	investigatorCandidates,
	chefCandidates,
	empathCandidates,
	undertakerCandidates,
	infoCandidatesFor,
	choicePromptFor,
	wakeOrder,
	type NightContext
} from './nightInfo';
import { troubleBrewing } from './scripts/trouble-brewing';
import { getCharacter } from './scripts';
import type { SeatRow } from './types';

function seat(i: number, id = `s${i}`, alive = true): SeatRow {
	return { id, game_id: 'g', seat_index: i, name: `P${i}`, user_id: null, alive, ghost_vote_available: true };
}

// 7 seats: washerwoman, librarian, investigator, chef, empath, poisoner(evil), imp(evil)
const seats = [seat(0), seat(1), seat(2), seat(3), seat(4), seat(5), seat(6)];
const roles: Record<string, string> = {
	s0: 'washerwoman',
	s1: 'librarian',
	s2: 'investigator',
	s3: 'chef',
	s4: 'empath',
	s5: 'poisoner',
	s6: 'imp'
};
const roleOf = (id: string) => roles[id] ?? null;

function ctxFor(askingSeatId: string, night = 1, variant = 0): NightContext {
	return { script: troubleBrewing, seats, roleOf, night, askingSeatId, variant };
}

describe('preplan candidates (washerwoman/librarian/investigator)', () => {
	it('washerwoman always proposes a truthful pairing that really includes a townsfolk', () => {
		const cands = washerwomanCandidates(ctxFor('s0'));
		const truth = cands.find((c) => c.truthful)!;
		expect(truth).toBeTruthy();
		// the sentence names a real townsfolk character
		const named = truth.text.match(/one of them is the (.+)\./)?.[1];
		expect(named).toBeTruthy();
		const holderSeat = truth.seatIds!.find((id) => getCharacter(troubleBrewing, roleOf(id)!)?.name === named);
		expect(holderSeat).toBeTruthy();
	});

	it('leans-good picks an evil decoy when one exists', () => {
		const cands = washerwomanCandidates(ctxFor('s0'));
		const leansGood = cands.find((c) => c.label === 'Leans good')!;
		const decoyId = leansGood.seatIds!.find((id) => roleOf(id) !== 'washerwoman' && getCharacter(troubleBrewing, roleOf(id)!)?.team !== 'townsfolk');
		// decoy should be an evil seat (poisoner or imp), not a random good one, since evil decoys exist
		const decoyTeam = decoyId ? getCharacter(troubleBrewing, roleOf(decoyId)!)?.team : undefined;
		expect(['minion', 'demon']).toContain(decoyTeam);
	});

	it('librarian reports "no outsiders" when none are in play', () => {
		const cands = librarianCandidates(ctxFor('s1'));
		expect(cands).toHaveLength(1);
		expect(cands[0].text).toBe('No Outsiders are in play.');
		expect(cands[0].truthful).toBe(true);
	});

	it('investigator finds the real minion', () => {
		const cands = investigatorCandidates(ctxFor('s2'));
		const truth = cands.find((c) => c.truthful)!;
		expect(truth.text).toContain('Poisoner');
	});
});

describe('numeric candidates (chef/empath)', () => {
	it('chef counts adjacent evil pairs (poisoner+imp are neighbours here)', () => {
		const cands = chefCandidates(ctxFor('s3'));
		const truth = cands.find((c) => c.truthful)!;
		expect(truth.text).toContain('1 pair');
	});

	it('empath counts evil among living neighbours', () => {
		// s4 (empath)'s neighbours are s3 (chef, good) and s5 (poisoner, evil) -> 1
		const cands = empathCandidates(ctxFor('s4'));
		const truth = cands.find((c) => c.truthful)!;
		expect(truth.text).toContain('1 of your living neighbours is evil');
	});

	it('poisoned alternates move the count away from truth', () => {
		const cands = chefCandidates(ctxFor('s3'));
		const lower = cands.find((c) => c.label.includes('lower'))!;
		const higher = cands.find((c) => c.label.includes('higher'))!;
		expect(lower.text).not.toBe(cands.find((c) => c.truthful)!.text);
		expect(higher.text).not.toBe(cands.find((c) => c.truthful)!.text);
		expect(lower.truthful).toBe(false);
		expect(higher.truthful).toBe(false);
	});
});

describe('undertaker', () => {
	it('reports nobody executed when null', () => {
		const cands = undertakerCandidates(ctxFor('s3', 2), null);
		expect(cands).toHaveLength(1);
		expect(cands[0].text).toBe('Nobody was executed yesterday.');
	});

	it('names the real executed character truthfully', () => {
		const cands = undertakerCandidates(ctxFor('s3', 2), 'imp');
		const truth = cands.find((c) => c.truthful)!;
		expect(truth.text).toBe('The Imp was executed.');
	});
});

describe('infoCandidatesFor dispatch', () => {
	it('routes each info-role id to its generator', () => {
		expect(infoCandidatesFor(ctxFor('s0'), getCharacter(troubleBrewing, 'washerwoman')!)).not.toBeNull();
		expect(infoCandidatesFor(ctxFor('s3'), getCharacter(troubleBrewing, 'chef')!)).not.toBeNull();
	});

	it('returns null for choose/none/grimoire prompts', () => {
		expect(infoCandidatesFor(ctxFor('s6'), getCharacter(troubleBrewing, 'imp')!)).toBeNull();
		expect(infoCandidatesFor(ctxFor('s5'), getCharacter(troubleBrewing, 'baron')!)).toBeNull();
	});
});

describe('choicePromptFor', () => {
	it('excludes self when canPickSelf is false', () => {
		const prompt = choicePromptFor(ctxFor('s6'), getCharacter(troubleBrewing, 'imp')!);
		// imp canPickSelf true, so self should be included
		expect(prompt!.validSeatIds).toContain('s6');
	});

	it('excludes the asking seat for monk-style abilities', () => {
		const monk = { ...getCharacter(troubleBrewing, 'imp')!, id: 'monk-test', prompt: { kind: 'choose' as const, count: 1 as const, canPickSelf: false } };
		const prompt = choicePromptFor(ctxFor('s6'), monk);
		expect(prompt!.validSeatIds).not.toContain('s6');
	});

	it('returns null for non-choose prompts', () => {
		expect(choicePromptFor(ctxFor('s0'), getCharacter(troubleBrewing, 'washerwoman')!)).toBeNull();
	});
});

describe('wakeOrder', () => {
	it('orders first-night actors by firstNight value, skipping unassigned characters', () => {
		const steps = wakeOrder(troubleBrewing, seats, roleOf, 1);
		const ids = steps.map((s) => s.character.id);
		expect(ids.indexOf('imp')).toBeLessThan(ids.indexOf('poisoner'));
		expect(ids.indexOf('washerwoman')).toBeGreaterThan(ids.indexOf('poisoner'));
		// none of the unassigned characters (e.g. 'monk') appear
		expect(ids).not.toContain('monk');
	});

	it('second night excludes first-night-only roles like washerwoman', () => {
		const steps = wakeOrder(troubleBrewing, seats, roleOf, 2);
		const ids = steps.map((s) => s.character.id);
		expect(ids).not.toContain('washerwoman');
	});
});
