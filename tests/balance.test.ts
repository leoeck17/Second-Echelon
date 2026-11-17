// Balance checks: the scenarios should reward sound plans and punish poor ones.
// These run the whole game over many seeds, so they guard tuning changes in data/.
import { describe, expect, it } from 'vitest';
import { simulate, type Playthrough } from '../src/planning/tdg';
import { ctxFor, scenario, scenarios } from './fixtures';

const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

function winRate(scId: string, play: Playthrough): number {
  const ctx = ctxFor(scenario(scId));
  return SEEDS.filter((seed) => simulate(ctx, seed, play).final!.verdict === 'success').length / SEEDS.length;
}

/** Spread the regiment across the front, artillery spread, no reserve kept back, no recon. */
const broadFront: Playthrough = {
  recon: [],
  plan: { assignment: { '1MRB': 'A', TB: 'A', '2MRB': 'B', '3MRB': 'C', RAB: 'spread', DAB: 'spread', AAB: 'spread' }, roles: {} },
  decision: {},
};

describe('balance', () => {
  for (const sc of scenarios) {
    it(`${sc.id}: the school solution wins at least 70% of runs`, () => {
      expect(winRate(sc.id, sc.schoolSolution)).toBeGreaterThanOrEqual(0.7);
    });

    it(`${sc.id}: a broad-front attack with no second echelon wins at most 30%`, () => {
      expect(winRate(sc.id, broadFront)).toBeLessThanOrEqual(0.3);
    });

    it(`${sc.id}: committing the second echelon matters`, () => {
      const without = { ...sc.schoolSolution, decision: {} };
      expect(winRate(sc.id, sc.schoolSolution)).toBeGreaterThan(winRate(sc.id, without));
    });
  }

  it('scenario 2: trusting the estimate (mass on A, as in scenario 1) mostly fails', () => {
    const trap = scenario('1970s-01').schoolSolution;
    expect(winRate('1970s-02', { ...trap, recon: [] })).toBeLessThanOrEqual(0.3);
    expect(winRate('1970s-02', scenario('1970s-02').schoolSolution)).toBeGreaterThan(winRate('1970s-02', trap) + 0.4);
  });
});
