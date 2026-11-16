import { describe, expect, it } from 'vitest';
import { applyLosses, resolvePhase, resolveSector, sectorScore } from '../src/core/adjudicate';
import { sectorRatios, zeroPotential, type Potential } from '../src/core/cofm';
import type { AdjudicationParams, EquipmentTable, Placement, Unit } from '../src/core/data';
import { mulberry32 } from '../src/core/rng';
import { era } from './fixtures';

const p: AdjudicationParams = {
  weights: { tanks: 1, antitank: 0, artillery: 0, infantry: 0, overall: 1 },
  cap: 2,
  floor: 0.25,
  epsilonLow: 1,
  epsilonHigh: 1,
  successAt: 1,
  stalledAt: 0.75,
  sovLossBase: 0.2,
  natoLossBase: 0.3,
  maxLoss: 0.6,
  roleIntensity: { attack: 1, holding: 0.5 },
  lossLimit: 0.35,
  exploitRole: 'attack',
  exploitMinShare: 0.3,
};
const required = { tanks: 3, antitank: 1, artillery: 3, infantry: 3, overall: 3 };
const pot = (x: Partial<Potential>): Potential => ({ ...zeroPotential(), ...x });
const exact = (x: Potential) => ({ low: x, mid: x, high: x });
const score = (own: Partial<Potential>, enemy: Partial<Potential>) =>
  sectorScore(sectorRatios(pot(own), exact(pot(enemy))), required, p);

describe('sectorScore', () => {
  it('is 1 exactly at the norms', () => {
    expect(score({ tanks: 30, overall: 30 }, { tanks: 10, overall: 10 })).toBeCloseTo(1);
  });

  it('is the weighted geometric mean of ratio / norm', () => {
    // tanks 6:1 -> 2 (capped at 2), overall 1.5:1 -> 0.5: sqrt(2 * 0.5) = 1
    expect(score({ tanks: 60, overall: 30 }, { tanks: 10, overall: 20 })).toBeCloseTo(1);
  });

  it('rises with the ratio', () => {
    const a = score({ tanks: 20, overall: 20 }, { tanks: 10, overall: 10 });
    const b = score({ tanks: 25, overall: 25 }, { tanks: 10, overall: 10 });
    expect(b).toBeGreaterThan(a);
  });

  it('caps unopposed categories and floors empty ones', () => {
    expect(score({ tanks: 10, overall: 10 }, {})).toBeCloseTo(2); // all capped
    expect(score({ overall: 30 }, { tanks: 10, overall: 10 })).toBeCloseTo(Math.sqrt(0.25 * 1));
  });

  it('ignores categories with nothing on either side', () => {
    // tanks NaN: only overall counts
    expect(score({ overall: 30 }, { overall: 10 })).toBeCloseTo(1);
  });
});

describe('resolveSector', () => {
  it('classifies by effective score', () => {
    const r = mulberry32(1);
    expect(resolveSector(1.2, 'attack', r, p).outcome).toBe('success');
    expect(resolveSector(0.8, 'attack', r, p).outcome).toBe('stalled');
    expect(resolveSector(0.5, 'attack', r, p).outcome).toBe('repulsed');
  });

  it('costs the attacker more and the defender less as the score falls', () => {
    const r = mulberry32(1);
    const good = resolveSector(2, 'attack', r, p);
    const bad = resolveSector(0.5, 'attack', r, p);
    expect(bad.sovLoss).toBeGreaterThan(good.sovLoss);
    expect(bad.natoLoss).toBeLessThan(good.natoLoss);
    expect(good.sovLoss).toBeCloseTo(0.1);
    expect(good.natoLoss).toBeCloseTo(0.6);
  });

  it('caps losses and scales them by role intensity', () => {
    const r = mulberry32(1);
    expect(resolveSector(0.01, 'attack', r, p).sovLoss).toBeLessThanOrEqual(0.6);
    expect(resolveSector(1, 'holding', r, p).sovLoss).toBeCloseTo(resolveSector(1, 'attack', r, p).sovLoss / 2);
  });

  it('draws epsilon from the configured range', () => {
    const wide = { ...p, epsilonLow: 0.8, epsilonHigh: 1.2 };
    const r = mulberry32(9);
    for (let i = 0; i < 50; i++) {
      const x = resolveSector(1, 'attack', r, wide);
      expect(x.epsilon).toBeGreaterThanOrEqual(0.8);
      expect(x.epsilon).toBeLessThan(1.2);
      expect(x.effective).toBeCloseTo(x.epsilon);
    }
  });
});

describe('applyLosses', () => {
  const u = (id: string): Unit => ({ id, side: 'SOV', name: id, parent: id, equipment: { T: 1 }, strength: 1, readiness: 1 });
  const placements: Record<string, Placement> = { a: 'A', b: 'B', s: 'spread', r: 'reserve', n: null };
  const out = applyLosses(['a', 'b', 's', 'r', 'n'].map(u), (x) => placements[x.id] ?? null, { A: 0.2 });

  it('scales strength in the sector only', () => {
    expect(out[0]!.strength).toBeCloseTo(0.8);
    expect(out[1]!.strength).toBe(1);
  });

  it('spares spread, reserve and unassigned units', () => {
    expect(out.slice(2).every((x) => x.strength === 1)).toBe(true);
  });
});

describe('resolvePhase', () => {
  const table: EquipmentTable = {
    T: { name: 'T', type: 'tank', category: 'tanks', cp: 1, era: ['x'], basis: 'source' },
  };
  const mk = (id: string, side: 'SOV' | 'NATO', n: number, placement: Placement): Unit => ({
    id, side, name: id, parent: id, equipment: { T: n }, strength: 1, readiness: 1, placement,
  });
  const sectors = [
    { id: 'A', name: 'A', widthKm: 2, defaultRole: 'attack' },
    { id: 'B', name: 'B', widthKm: 2, defaultRole: 'attack' },
  ];
  const run = (seed: number) =>
    resolvePhase({
      seed,
      phase: 1,
      sectors,
      roles: { A: 'attack', B: 'attack' },
      norms: era.norms,
      params: { ...p, epsilonLow: 0.8, epsilonHigh: 1.2 },
      table,
      soviet: [mk('s1', 'SOV', 40, 'A')],
      sovPlacement: (x) => x.placement ?? null,
      nato: [mk('n1', 'NATO', 10, 'A'), mk('n2', 'NATO', 10, 'B')],
      natoPlacement: (x) => x.placement ?? null,
    });

  it('fights only where Soviet forces attack', () => {
    const r = run(1);
    expect(r.sectors[0]!.outcome).not.toBe('none');
    expect(r.sectors[1]!.outcome).toBe('none');
    expect(r.nato[1]!.strength).toBe(1);
    expect(r.soviet[0]!.strength).toBeLessThan(1);
    expect(r.nato[0]!.strength).toBeLessThan(1);
  });

  it('is reproducible for a seed', () => {
    expect(run(5)).toEqual(run(5));
    expect(run(5).sectors[0]!.epsilon).not.toBe(run(6).sectors[0]!.epsilon);
  });
});
