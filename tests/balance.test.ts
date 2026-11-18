// Balance checks: each scenario should reward the lesson it teaches and punish the
// obvious mistake. These play the whole game over many seeds, so they guard every
// tuning change in data/.
import { describe, expect, it } from 'vitest';
import { simulate, type Playthrough, type TdgState } from '../src/planning/tdg';
import { ctxFor, scenario, scenarios } from './fixtures';

const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

function runs(scId: string, play: Playthrough): TdgState[] {
  const ctx = ctxFor(scenario(scId));
  return SEEDS.map((seed) => simulate(ctx, seed, play));
}
const winRate = (states: TdgState[]) => states.filter((s) => s.final!.verdict === 'success').length / states.length;

/** Spread the regiment across the front, artillery spread, nothing kept back, no recon. */
const broadFront: Playthrough = {
  recon: [],
  plan: { assignment: { '1MRB': 'A', TB: 'A', '2MRB': 'B', '3MRB': 'C', RAB: 'spread', DAB: 'spread', AAB: 'spread' }, roles: {} },
  decision: {},
};

describe('balance: every scenario', () => {
  for (const sc of scenarios) {
    it(`${sc.id}: the school solution wins at least 70% of runs`, () => {
      expect(winRate(runs(sc.id, sc.schoolSolution))).toBeGreaterThanOrEqual(0.7);
    });

    it(`${sc.id}: committing the second echelon never hurts`, () => {
      const without = { ...sc.schoolSolution, decision: {} };
      expect(winRate(runs(sc.id, sc.schoolSolution))).toBeGreaterThanOrEqual(winRate(runs(sc.id, without)));
    });
  }
});

describe('balance: the lesson of each scenario', () => {
  for (const id of ['1970s-01', '1970s-02', '1970s-03']) {
    it(`${id}: a broad-front attack with nothing kept back wins at most 30%`, () => {
      expect(winRate(runs(id, broadFront))).toBeLessThanOrEqual(0.3);
    });
  }

  for (const id of ['1970s-01', '1970s-02']) {
    it(`${id}: the second echelon matters (at least 15 points)`, () => {
      const sc = scenario(id);
      const without = { ...sc.schoolSolution, decision: {} };
      expect(winRate(runs(id, sc.schoolSolution)) - winRate(runs(id, without))).toBeGreaterThanOrEqual(0.15);
    });
  }

  it('1970s-02: trusting the estimate (mass on A, as in scenario 1) mostly fails', () => {
    const trap = scenario('1970s-01').schoolSolution;
    expect(winRate(runs('1970s-02', { ...trap, recon: [] }))).toBeLessThanOrEqual(0.3);
  });

  it('1970s-04: attacking the strongpoint head-on mostly fails', () => {
    const frontal: Playthrough = {
      recon: [],
      plan: { assignment: { TB: 'B', '1MRB': 'B', '2MRB': 'B', RAB: 'B', DAB: 'B', AAB: 'B', ATB: 'B' }, roles: { A: 'holding', B: 'breakthrough', C: 'holding' } },
      decision: { '3MRB': 'B' },
    };
    expect(winRate(runs('1970s-04', frontal))).toBeLessThanOrEqual(0.3);
  });

  it('1970s-04: the school pincer encircles the strongpoint in most runs', () => {
    const states = runs('1970s-04', scenario('1970s-04').schoolSolution);
    const encircled = states.filter((s) => s.encircled?.includes('TM-B')).length / states.length;
    expect(encircled).toBeGreaterThanOrEqual(0.7);
  });
});
