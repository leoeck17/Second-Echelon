import { describe, expect, it } from 'vitest';
import equipmentJson from '../data/equipment.json';
import eraJson from '../data/eras/1970s.json';
import type { EquipmentTable, EraData } from '../src/core/data';
import { totalPotential } from '../src/core/cofm';
import { assign, defaultPlan, evaluatePlan, sanitizePlan, setRole } from '../src/planning/plan';

const equipment = equipmentJson as EquipmentTable;
const era = eraJson as unknown as EraData;

describe('defaultPlan', () => {
  it('commits nothing and uses default roles', () => {
    const plan = defaultPlan(era);
    expect(Object.values(plan.assignment).every((p) => p === null)).toBe(true);
    expect(plan.roles).toEqual({ A: 'attack', B: 'breakthrough', C: 'attack' });
  });

  it('gives zero Soviet ratios and leaves the whole regiment uncommitted', () => {
    const r = evaluatePlan(era, equipment, defaultPlan(era));
    const total = totalPotential(era.soviet.units, equipment);
    expect(r.uncommitted.overall).toBeCloseTo(total.overall);
    for (const s of r.sectors) {
      expect(s.soviet.overall).toBe(0);
      expect(s.ratios.overall.value).toBe(0);
      expect(s.verdict).toBe('red');
    }
  });
});

describe('assign and setRole', () => {
  it('returns a new plan and keeps the old one unchanged', () => {
    const p0 = defaultPlan(era);
    const p1 = assign(era, p0, 'TB', 'B');
    expect(p0.assignment.TB).toBeNull();
    expect(p1.assignment.TB).toBe('B');
  });

  it('treats reserve as uncommitted', () => {
    expect(assign(era, defaultPlan(era), 'TB', 'reserve').assignment.TB).toBeNull();
  });

  it('refuses spread for manoeuvre battalions and unknown ids', () => {
    expect(() => assign(era, defaultPlan(era), '1MRB', 'spread')).toThrow();
    expect(() => assign(era, defaultPlan(era), 'XX', 'A')).toThrow();
    expect(() => assign(era, defaultPlan(era), 'TB', 'Z')).toThrow();
    expect(() => setRole(era, defaultPlan(era), 'A', 'raid')).toThrow();
  });
});

describe('evaluatePlan', () => {
  it('moves potential from uncommitted into the chosen sector', () => {
    const plan = assign(era, defaultPlan(era), 'TB', 'B');
    const r = evaluatePlan(era, equipment, plan);
    const b = r.sectors.find((s) => s.sector.id === 'B')!;
    expect(b.soviet.tanks).toBeCloseTo(31); // 31 T-62 at 1.0
    expect(b.formations).toEqual(['TB']);
    expect(r.sectors.find((s) => s.sector.id === 'A')!.soviet.tanks).toBe(0);
  });

  it('spreads artillery evenly and lists it in every sector', () => {
    const plan = assign(era, defaultPlan(era), 'RAB', 'spread');
    const r = evaluatePlan(era, equipment, plan);
    for (const s of r.sectors) {
      expect(s.soviet.artillery).toBeCloseTo((18 * equipment['2S1']!.cp) / 3);
      expect(s.formations).toContain('RAB');
    }
  });

  it('keeps the NATO brigade reserve out of the sectors', () => {
    const r = evaluatePlan(era, equipment, defaultPlan(era));
    expect(r.natoReserve.mid.tanks).toBeCloseTo(17 * equipment.M60A1!.cp);
    const sectorTanks = r.sectors.reduce((acc, s) => acc + s.nato.mid.tanks, 0);
    expect(sectorTanks).toBeCloseTo(17 * equipment.M60A1!.cp); // the TF's own tank company
  });

  it('a massed breakthrough meets the tank and artillery norms on that sector', () => {
    let plan = defaultPlan(era);
    for (const f of ['TB', '1MRB', '2MRB', 'RAB', 'DAB', 'AAB', 'ATB']) plan = assign(era, plan, f, 'A');
    plan = setRole(era, plan, 'A', 'breakthrough');
    const a = evaluatePlan(era, equipment, plan).sectors.find((s) => s.sector.id === 'A')!;
    expect(a.assessment.tanks.status).toBe('green');
    expect(a.assessment.artillery.status).toBe('green');
    expect(a.assessment.overall.status).toBe('green');
  });

  it('the norms change with the sector role', () => {
    let plan = assign(era, defaultPlan(era), '3MRB', 'C');
    plan = setRole(era, plan, 'C', 'holding');
    const holding = evaluatePlan(era, equipment, plan).sectors.find((s) => s.sector.id === 'C')!;
    plan = setRole(era, plan, 'C', 'attack');
    const attack = evaluatePlan(era, equipment, plan).sectors.find((s) => s.sector.id === 'C')!;
    expect(holding.assessment.overall.required).toBe(1);
    expect(attack.assessment.overall.required).toBe(3);
    expect(holding.ratios.overall.value).toBeCloseTo(attack.ratios.overall.value);
  });
});

describe('sanitizePlan', () => {
  it('drops unknown formations, sectors, roles and illegal spreads', () => {
    const p = sanitizePlan(era, {
      assignment: { TB: 'B', '1MRB': 'spread', RAB: 'spread', GHOST: 'A', DAB: 'Q' },
      roles: { A: 'holding', B: 'raid' },
    });
    expect(p.assignment.TB).toBe('B');
    expect(p.assignment['1MRB']).toBeNull();
    expect(p.assignment.RAB).toBe('spread');
    expect(p.assignment.DAB).toBeNull();
    expect('GHOST' in p.assignment).toBe(false);
    expect(p.roles).toEqual({ A: 'holding', B: 'breakthrough', C: 'attack' });
  });

  it('copes with garbage', () => {
    expect(sanitizePlan(era, null)).toEqual(defaultPlan(era));
  });
});
