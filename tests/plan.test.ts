import { describe, expect, it } from 'vitest';
import { totalPotential } from '../src/core/cofm';
import {
  assign,
  defaultPlan,
  evaluatePlan,
  isSelectableRole,
  sanitizePlan,
  setRole,
  withReadiness,
  type PlanContext,
} from '../src/planning/plan';
import { equipment, era, scenario } from './fixtures';

const sc = scenario('1970s-01');
const ctx: PlanContext = { era, sectors: sc.sectors };
const forces = { soviet: era.soviet.units, nato: sc.nato.estimate };

describe('defaultPlan', () => {
  it('commits nothing and uses the scenario default roles', () => {
    const plan = defaultPlan(ctx);
    expect(Object.values(plan.assignment).every((p) => p === null)).toBe(true);
    expect(plan.roles).toEqual({ A: 'attack', B: 'breakthrough', C: 'attack' });
  });

  it('gives zero Soviet ratios and leaves the whole regiment uncommitted', () => {
    const r = evaluatePlan(ctx, equipment, defaultPlan(ctx), forces);
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
    const p0 = defaultPlan(ctx);
    const p1 = assign(ctx, p0, 'TB', 'B');
    expect(p0.assignment.TB).toBeNull();
    expect(p1.assignment.TB).toBe('B');
  });

  it('treats reserve as uncommitted', () => {
    expect(assign(ctx, defaultPlan(ctx), 'TB', 'reserve').assignment.TB).toBeNull();
  });

  it('refuses spread for manoeuvre battalions, unknown ids and game-only roles', () => {
    expect(() => assign(ctx, defaultPlan(ctx), '1MRB', 'spread')).toThrow();
    expect(() => assign(ctx, defaultPlan(ctx), 'XX', 'A')).toThrow();
    expect(() => assign(ctx, defaultPlan(ctx), 'TB', 'Z')).toThrow();
    expect(() => setRole(ctx, defaultPlan(ctx), 'A', 'raid')).toThrow();
    expect(() => setRole(ctx, defaultPlan(ctx), 'A', 'exploitation')).toThrow();
    expect(isSelectableRole(ctx, 'holding')).toBe(true);
    expect(isSelectableRole(ctx, 'exploitation')).toBe(false);
  });
});

describe('evaluatePlan', () => {
  it('moves potential from uncommitted into the chosen sector', () => {
    const plan = assign(ctx, defaultPlan(ctx), 'TB', 'B');
    const r = evaluatePlan(ctx, equipment, plan, forces);
    const b = r.sectors.find((s) => s.sector.id === 'B')!;
    expect(b.soviet.tanks).toBeCloseTo(31); // 31 T-62 at 1.0
    expect(b.formations).toEqual(['TB']);
    expect(r.sectors.find((s) => s.sector.id === 'A')!.soviet.tanks).toBe(0);
  });

  it('spreads artillery evenly and lists it in every sector', () => {
    const plan = assign(ctx, defaultPlan(ctx), 'RAB', 'spread');
    const r = evaluatePlan(ctx, equipment, plan, forces);
    for (const s of r.sectors) {
      expect(s.soviet.artillery).toBeCloseTo((18 * equipment['2S1']!.cp) / 3);
      expect(s.formations).toContain('RAB');
    }
  });

  it('keeps the NATO brigade reserve out of the sectors', () => {
    const r = evaluatePlan(ctx, equipment, defaultPlan(ctx), forces);
    expect(r.natoReserve.mid.tanks).toBeCloseTo(17 * equipment.M60A1!.cp);
  });

  it('applies a readiness multiplier', () => {
    const plan = assign(ctx, defaultPlan(ctx), 'TB', 'A');
    const full = evaluatePlan(ctx, equipment, plan, forces);
    const tired = evaluatePlan(ctx, equipment, plan, { ...forces, soviet: withReadiness(era.soviet.units, 0.85) });
    expect(tired.sectors[0]!.soviet.tanks).toBeCloseTo(full.sectors[0]!.soviet.tanks * 0.85);
  });

  it('a massed breakthrough meets the tank and artillery norms on that sector', () => {
    let plan = defaultPlan(ctx);
    for (const f of ['TB', '1MRB', '2MRB', 'RAB', 'DAB', 'AAB', 'ATB']) plan = assign(ctx, plan, f, 'A');
    plan = setRole(ctx, plan, 'A', 'breakthrough');
    const a = evaluatePlan(ctx, equipment, plan, forces).sectors.find((s) => s.sector.id === 'A')!;
    expect(a.assessment.tanks.status).toBe('green');
    expect(a.assessment.artillery.status).toBe('green');
    expect(a.assessment.overall.status).toBe('green');
  });

  it('the norms change with the sector role', () => {
    let plan = assign(ctx, defaultPlan(ctx), '3MRB', 'C');
    plan = setRole(ctx, plan, 'C', 'holding');
    const holding = evaluatePlan(ctx, equipment, plan, forces).sectors.find((s) => s.sector.id === 'C')!;
    plan = setRole(ctx, plan, 'C', 'attack');
    const attack = evaluatePlan(ctx, equipment, plan, forces).sectors.find((s) => s.sector.id === 'C')!;
    expect(holding.assessment.overall.required).toBe(1);
    expect(attack.assessment.overall.required).toBe(3);
    expect(holding.ratios.overall.value).toBeCloseTo(attack.ratios.overall.value);
  });
});

describe('sanitizePlan', () => {
  it('drops unknown formations, sectors, roles and illegal spreads', () => {
    const p = sanitizePlan(ctx, {
      assignment: { TB: 'B', '1MRB': 'spread', RAB: 'spread', GHOST: 'A', DAB: 'Q' },
      roles: { A: 'holding', B: 'raid', C: 'exploitation' },
    });
    expect(p.assignment.TB).toBe('B');
    expect(p.assignment['1MRB']).toBeNull();
    expect(p.assignment.RAB).toBe('spread');
    expect(p.assignment.DAB).toBeNull();
    expect('GHOST' in p.assignment).toBe(false);
    expect(p.roles).toEqual({ A: 'holding', B: 'breakthrough', C: 'attack' });
  });

  it('copes with garbage', () => {
    expect(sanitizePlan(ctx, null)).toEqual(defaultPlan(ctx));
  });
});
