import { describe, expect, it } from 'vitest';
import {
  addPotential,
  assessSector,
  compareWithNorm,
  estimatedUnitPotential,
  placementWeights,
  ratio,
  scalePotential,
  sectorEstimates,
  sectorPotentials,
  sectorRatios,
  totalPotential,
  unitPotential,
  worstStatus,
  zeroPotential,
  type Potential,
} from '../src/core/cofm';
import type { EquipmentTable, Placement, Unit } from '../src/core/data';

// Small synthetic table so the tests do not depend on tuned game data.
const table: EquipmentTable = {
  T55: { name: 'T-55', type: 'tank', category: 'tanks', cp: 1.0, era: ['x'], basis: 'source' },
  BMP: { name: 'BMP-1', type: 'ifv', category: 'infantry', cp: 0.8, era: ['x'], basis: 'source' },
  RPG: { name: 'RPG-7', type: 'rpg', category: 'antitank', cp: 0.1, era: ['x'], basis: 'game-tuned' },
  HOW: { name: 'D-30', type: 'howitzer', category: 'artillery', cp: 0.5, era: ['x'], basis: 'game-tuned' },
  ZSU: { name: 'ZSU', type: 'spaag', category: 'other', cp: 0.4, era: ['x'], basis: 'game-tuned' },
};

function unit(id: string, equipment: Record<string, number>, extra: Partial<Unit> = {}): Unit {
  return { id, side: 'SOV', name: id, parent: 'P', equipment, strength: 1, readiness: 1, ...extra };
}

function pot(p: Partial<Potential>): Potential {
  const z = zeroPotential();
  return { ...z, ...p };
}

describe('unitPotential', () => {
  it('sums n * c per category and overall', () => {
    const p = unitPotential(unit('a', { T55: 10, BMP: 10, RPG: 9, HOW: 6, ZSU: 2 }), table);
    expect(p.tanks).toBeCloseTo(10);
    expect(p.infantry).toBeCloseTo(8);
    expect(p.antitank).toBeCloseTo(0.9);
    expect(p.artillery).toBeCloseTo(3);
    expect(p.other).toBeCloseTo(0.8);
    expect(p.overall).toBeCloseTo(10 + 8 + 0.9 + 3 + 0.8);
  });

  it('applies k_strength and k_readiness multiplicatively', () => {
    const p = unitPotential(unit('a', { T55: 10 }, { strength: 0.5, readiness: 0.8 }), table);
    expect(p.tanks).toBeCloseTo(4);
    expect(p.overall).toBeCloseTo(4);
  });

  it('is zero for a unit with no equipment or zero strength', () => {
    expect(unitPotential(unit('a', {}), table)).toEqual(zeroPotential());
    expect(unitPotential(unit('a', { T55: 10 }, { strength: 0 }), table).overall).toBe(0);
  });

  it('throws on unknown equipment', () => {
    expect(() => unitPotential(unit('a', { 'T-99': 1 }), table)).toThrow(/unknown equipment/);
  });
});

describe('potential arithmetic', () => {
  it('adds with a weight and scales', () => {
    const a = pot({ tanks: 2, overall: 2 });
    const b = pot({ tanks: 4, infantry: 2, overall: 6 });
    expect(addPotential(a, b, 0.5)).toEqual(pot({ tanks: 4, infantry: 1, overall: 5 }));
    expect(scalePotential(b, 2)).toEqual(pot({ tanks: 8, infantry: 4, overall: 12 }));
  });

  it('does not mutate its inputs', () => {
    const a = pot({ tanks: 1, overall: 1 });
    addPotential(a, a);
    expect(a.tanks).toBe(1);
  });

  it('totals a list of units', () => {
    const t = totalPotential([unit('a', { T55: 3 }), unit('b', { T55: 2, BMP: 5 })], table);
    expect(t.tanks).toBeCloseTo(5);
    expect(t.infantry).toBeCloseTo(4);
    expect(t.overall).toBeCloseTo(9);
  });
});

describe('placementWeights', () => {
  const ids = ['A', 'B', 'C'];
  it('puts everything in the named sector', () => {
    expect(placementWeights('B', ids)).toEqual({ A: 0, B: 1, C: 0 });
  });
  it('spreads evenly', () => {
    const w = placementWeights('spread', ids);
    expect(w.A! + w.B! + w.C!).toBeCloseTo(1);
    expect(w.A).toBeCloseTo(1 / 3);
  });
  it('counts reserve, unassigned and unknown sectors nowhere', () => {
    for (const p of ['reserve', null, 'Z'] as Placement[]) {
      expect(placementWeights(p, ids)).toEqual({ A: 0, B: 0, C: 0 });
    }
  });
});

describe('sectorPotentials', () => {
  const units = [
    unit('tank', { T55: 10 }),
    unit('mr', { BMP: 10 }),
    unit('arty', { HOW: 6 }),
    unit('res', { T55: 99 }),
  ];
  const placements: Record<string, Placement> = { tank: 'A', mr: 'A', arty: 'spread', res: 'reserve' };
  const sp = sectorPotentials(units, (u) => placements[u.id] ?? null, ['A', 'B', 'C'], table);

  it('sums the units in each sector', () => {
    expect(sp.A!.tanks).toBeCloseTo(10);
    expect(sp.A!.infantry).toBeCloseTo(8);
    expect(sp.B!.tanks).toBe(0);
  });

  it('divides spread units over all sectors', () => {
    expect(sp.A!.artillery).toBeCloseTo(1);
    expect(sp.B!.artillery).toBeCloseTo(1);
    expect(sp.C!.artillery).toBeCloseTo(1);
  });

  it('leaves reserves out and conserves the committed total', () => {
    const sum = sp.A!.overall + sp.B!.overall + sp.C!.overall;
    expect(sum).toBeCloseTo(10 + 8 + 3);
  });
});

describe('estimates', () => {
  it('scales by the intel range, defaulting to exact', () => {
    const e = estimatedUnitPotential(
      unit('n', { T55: 10 }, { side: 'NATO', intel: { status: 'suspected', low: 0.5, high: 1.5 } }),
      table,
    );
    expect(e.low.tanks).toBeCloseTo(5);
    expect(e.mid.tanks).toBeCloseTo(10);
    expect(e.high.tanks).toBeCloseTo(15);

    const exact = estimatedUnitPotential(unit('n', { T55: 10 }), table);
    expect(exact.low).toEqual(exact.mid);
    expect(exact.high).toEqual(exact.mid);
  });

  it('builds per-sector low/mid/high totals', () => {
    const units = [
      unit('a', { T55: 10 }, { intel: { status: 'confirmed', low: 1, high: 1 } }),
      unit('b', { T55: 10 }, { intel: { status: 'suspected', low: 0.5, high: 2 } }),
    ];
    const se = sectorEstimates(units, () => 'A', ['A', 'B'], table);
    expect(se.A!.low.tanks).toBeCloseTo(15);
    expect(se.A!.mid.tanks).toBeCloseTo(20);
    expect(se.A!.high.tanks).toBeCloseTo(30);
    expect(se.B!.mid.overall).toBe(0);
  });
});

describe('ratio', () => {
  it('divides', () => expect(ratio(9, 3)).toBe(3));
  it('is Infinity when unopposed', () => expect(ratio(1, 0)).toBe(Infinity));
  it('is NaN when both sides are empty', () => expect(ratio(0, 0)).toBeNaN());
  it('is zero when the attacker has nothing', () => expect(ratio(0, 5)).toBe(0));
});

describe('sectorRatios', () => {
  it('gives point, pessimistic and optimistic ratios', () => {
    const own = pot({ tanks: 30, overall: 30 });
    const enemy = {
      low: pot({ tanks: 5, overall: 5 }),
      mid: pot({ tanks: 6, overall: 6 }),
      high: pot({ tanks: 10, overall: 10 }),
    };
    const r = sectorRatios(own, enemy);
    expect(r.tanks).toEqual({ value: 5, low: 3, high: 6 });
    expect(r.overall.value).toBe(5);
    expect(r.artillery.value).toBeNaN();
  });
});

describe('compareWithNorm', () => {
  it('is green at or above the norm', () => {
    expect(compareWithNorm(3, 3, 0.75)).toBe('green');
    expect(compareWithNorm(2.9999999999, 3, 0.75)).toBe('green');
    expect(compareWithNorm(Infinity, 5, 0.75)).toBe('green');
  });
  it('is amber between amberFraction x norm and the norm', () => {
    expect(compareWithNorm(2.25, 3, 0.75)).toBe('amber');
    expect(compareWithNorm(2.9, 3, 0.75)).toBe('amber');
  });
  it('is red below that', () => {
    expect(compareWithNorm(2.2, 3, 0.75)).toBe('red');
    expect(compareWithNorm(0, 1, 0.75)).toBe('red');
  });
  it('is none when there is no ratio', () => {
    expect(compareWithNorm(NaN, 3, 0.75)).toBe('none');
  });
});

describe('assessSector and worstStatus', () => {
  const own = pot({ tanks: 30, antitank: 2, artillery: 10, infantry: 0, overall: 42 });
  const e = pot({ tanks: 6, antitank: 2, artillery: 4, infantry: 0, overall: 12 });
  const ratios = sectorRatios(own, { low: e, mid: e, high: scalePotential(e, 1.5) });
  const required = { tanks: 5, antitank: 1, artillery: 3, infantry: 3, overall: 3 };
  const a = assessSector(ratios, required, 0.75);

  it('colours each category against its own norm', () => {
    expect(a.tanks.status).toBe('green'); // 5.0 vs 5
    expect(a.antitank.status).toBe('green'); // 1.0 vs 1
    expect(a.artillery.status).toBe('amber'); // 2.5 vs 3, amber from 2.25
    expect(a.artillery.pessimistic).toBe('red'); // 10 / 6 = 1.67
  });

  it('reports the pessimistic status separately', () => {
    expect(a.tanks.pessimistic).toBe('red'); // 30 / 9 = 3.33 vs 5
    expect(a.overall.status).toBe('green'); // 3.5
    expect(a.overall.pessimistic).toBe('amber'); // 42 / 18 = 2.33
    expect(a.infantry.status).toBe('none');
  });

  it('worstStatus picks the most severe and ignores none', () => {
    expect(worstStatus(['green', 'none', 'amber'])).toBe('amber');
    expect(worstStatus(['green', 'red', 'amber'])).toBe('red');
    expect(worstStatus(['none', 'none'])).toBe('none');
    expect(worstStatus([])).toBe('none');
  });
});
