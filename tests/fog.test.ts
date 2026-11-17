import { describe, expect, it } from 'vitest';
import type { Unit } from '../src/core/data';
import { readinessFromPrepTime, reconSector } from '../src/core/fog';
import { era } from './fixtures';

function nato(id: string, placement: string, eq: Record<string, number> = { M60A1: 5 }, extra: Partial<Unit> = {}): Unit {
  return { id, side: 'NATO', name: id, parent: 'TF', equipment: eq, strength: 1, readiness: 1, placement, ...extra };
}
const susp = { status: 'suspected' as const, low: 0.5, high: 1.5 };
const params = { residualLow: 0.9, residualHigh: 1.1 };

describe('reconSector', () => {
  const estimate = [
    nato('SAME', 'A', { M60A1: 5 }, { intel: susp }),
    nato('CHANGED', 'A', { M113: 9 }, { intel: susp }),
    nato('DUMMY', 'A', { M60A1: 7 }, { intel: susp }),
    nato('GONE', 'A', { M113: 4 }, { intel: susp }),
    nato('MOVER', 'B', { M60A1: 7 }, { intel: susp }),
    nato('OTHER', 'C', { M113: 4 }, { intel: susp }),
    nato('ARTY', 'spread', { M109A1: 6 }, { intel: susp }),
  ];
  const truth = [
    nato('SAME', 'A', { M60A1: 5 }),
    nato('CHANGED', 'A', { M113: 9, M60A1: 4 }),
    nato('GONE', 'C', { M113: 4 }),
    nato('MOVER', 'A', { M60A1: 7 }),
    nato('HIDDEN', 'A', { TOW: 4 }),
    nato('OTHER', 'C', { M113: 6 }),
    nato('ARTY', 'spread', { M109A1: 12 }),
  ];
  const { estimate: out, findings } = reconSector(estimate, truth, 'A', params);
  const byId = new Map(out.map((u) => [u.id, u]));
  const kind = (id: string) => findings.find((f) => f.unitId === id)?.kind;

  it('confirms units that are really there, with the residual range and true equipment', () => {
    expect(kind('SAME')).toBe('confirmed');
    expect(kind('CHANGED')).toBe('changed');
    expect(byId.get('CHANGED')!.equipment).toEqual({ M113: 9, M60A1: 4 });
    expect(byId.get('SAME')!.intel).toEqual({ status: 'confirmed', low: 0.9, high: 1.1 });
  });

  it('removes dummies', () => {
    expect(kind('DUMMY')).toBe('dummy');
    expect(byId.has('DUMMY')).toBe(false);
  });

  it('marks units that are not there as location unknown, without revealing where they are', () => {
    expect(kind('GONE')).toBe('absent');
    expect(byId.get('GONE')!.placement).toBeNull();
    expect(byId.get('GONE')!.intel!.status).toBe('unknown');
  });

  it('finds hidden units and units reported elsewhere', () => {
    expect(kind('HIDDEN')).toBe('hidden');
    expect(kind('MOVER')).toBe('moved-here');
    expect(byId.get('MOVER')!.placement).toBe('A');
    expect(out.filter((u) => u.id === 'MOVER')).toHaveLength(1);
  });

  it('leaves other sectors and spread units untouched', () => {
    expect(byId.get('OTHER')).toEqual(estimate[5]);
    expect(byId.get('ARTY')).toEqual(estimate[6]);
    expect(findings.every((f) => f.sectorId === 'A')).toBe(true);
  });

  it('does not report battle losses as an intelligence error', () => {
    const r = reconSector([nato('X', 'A', { M60A1: 5 })], [nato('X', 'A', { M60A1: 5 }, { strength: 0.7 })], 'A', params);
    expect(r.findings[0]!.kind).toBe('confirmed');
    expect(r.estimate[0]!.strength).toBe(0.7);
  });

  it('does not mutate its inputs', () => {
    expect(estimate[0]!.intel).toEqual(susp);
    expect(truth[0]!.intel).toBeUndefined();
  });
});

describe('readinessFromPrepTime', () => {
  it('uses the row with the largest hoursLeft not above the time left', () => {
    const prep = { table: [{ hoursLeft: 0, readiness: 0.85 }, { hoursLeft: 4, readiness: 1 }, { hoursLeft: 2, readiness: 0.95 }] };
    expect(readinessFromPrepTime(6, prep)).toBe(1);
    expect(readinessFromPrepTime(4, prep)).toBe(1);
    expect(readinessFromPrepTime(3, prep)).toBe(0.95);
    expect(readinessFromPrepTime(0, prep)).toBe(0.85);
    expect(readinessFromPrepTime(-1, prep)).toBe(0.85);
  });

  it('works with the shipped table', () => {
    expect(readinessFromPrepTime(6, era.prepTime)).toBe(1);
    expect(readinessFromPrepTime(0, era.prepTime)).toBeLessThan(1);
  });
});
