import { describe, expect, it } from 'vitest';
import { totalPotential } from '../src/core/cofm';
import {
  assign,
  assignSecondEchelon,
  attackAxes,
  axisPath,
  bandAt,
  defaultPlan,
  evaluatePlan,
  isSelectableRole,
  laneAt,
  placeFormation,
  sanitizePlan,
  setAxis,
  setRole,
  withReadiness,
} from '../src/planning/plan';
import { planContext } from '../src/planning/tdg';
import { ctxFor, equipment, era, scenario } from './fixtures';

const sc = scenario('1970s-01');
const ctx = planContext(ctxFor(sc));
const forces = { soviet: era.soviet.units, nato: sc.nato.estimate };
const g = sc.geometry;

describe('map geometry', () => {
  it('finds lanes by y and bands by x', () => {
    expect(laneAt(ctx, 10500)).toBe('A');
    expect(laneAt(ctx, 7500)).toBe('B');
    expect(laneAt(ctx, 4500)).toBe('C');
    expect(laneAt(ctx, 14000)).toBeNull();
    expect(bandAt(ctx, g.bands.first[0] + 10)).toBe('first');
    expect(bandAt(ctx, g.bands.second[0] + 10)).toBe('second');
    expect(bandAt(ctx, g.bands.reserve[0] + 10)).toBe('reserve');
    expect(bandAt(ctx, g.bands.generalSupport[1])).toBe('generalSupport');
    expect(bandAt(ctx, g.lineOfContactX - 100)).toBeNull();
  });
});

describe('defaultPlan', () => {
  it('starts with everything in the assembly area, nothing fighting', () => {
    const plan = defaultPlan(ctx);
    expect(Object.values(plan.assignment).every((p) => p === null)).toBe(true);
    expect(Object.values(plan.echelon).every((e) => e === 'reserve')).toBe(true);
    expect(plan.roles).toEqual({ A: 'attack', B: 'breakthrough', C: 'attack' });
    for (const p of Object.values(plan.positions)) expect(bandAt(ctx, p.x)).toBe('reserve');
  });

  it('gives zero Soviet ratios and leaves the whole regiment uncommitted', () => {
    const r = evaluatePlan(ctx, equipment, defaultPlan(ctx), forces);
    expect(r.uncommitted.overall).toBeCloseTo(totalPotential(era.soviet.units, equipment).overall);
    for (const s of r.sectors) expect(s.soviet.overall).toBe(0);
  });
});

describe('placeFormation', () => {
  const p0 = defaultPlan(ctx);

  it('derives sector and echelon from the drop point', () => {
    const p1 = placeFormation(ctx, p0, 'TB', { x: 16000, y: 10500 });
    expect(p1.assignment.TB).toBe('A');
    expect(p1.echelon.TB).toBe('first');
    const p2 = placeFormation(ctx, p0, '2MRB', { x: 18000, y: 7500 });
    expect(p2.assignment['2MRB']).toBe('B');
    expect(p2.echelon['2MRB']).toBe('second');
    const p3 = placeFormation(ctx, p0, '2MRB', { x: 21000, y: 7500 });
    expect(p3.assignment['2MRB']).toBeNull();
    expect(p3.echelon['2MRB']).toBe('reserve');
  });

  it('puts artillery behind a sector in support of it, and in the general-support area on all sectors', () => {
    expect(placeFormation(ctx, p0, 'RAB', { x: 18000, y: 4500 }).assignment.RAB).toBe('C');
    expect(placeFormation(ctx, p0, 'RAB', { x: 24000, y: 7000 }).assignment.RAB).toBe('spread');
    expect(placeFormation(ctx, p0, 'RAB', { x: 21000, y: 7000 }).assignment.RAB).toBeNull();
  });

  it('refuses spots west of the line of contact or outside the sectors', () => {
    expect(() => placeFormation(ctx, p0, 'TB', { x: 12000, y: 7500 })).toThrow(/east of the line/);
    expect(() => placeFormation(ctx, p0, 'TB', { x: 16000, y: 14000 })).toThrow(/behind one of the sectors/);
  });

  it('does not mutate the old plan, and moving clears the axis', () => {
    const p1 = setAxis(ctx, placeFormation(ctx, p0, 'TB', { x: 16000, y: 10500 }), 'TB', [{ x: 12000, y: 9000 }]);
    const p2 = placeFormation(ctx, p1, 'TB', { x: 16000, y: 4500 });
    expect(p0.assignment.TB).toBeNull();
    expect(p1.axes.TB).toHaveLength(1);
    expect(p2.axes.TB).toEqual([]);
  });
});

describe('button fallback', () => {
  it('assign puts manoeuvre units in the first echelon, fires behind the sector, null back to the assembly area', () => {
    let p = assign(ctx, defaultPlan(ctx), 'TB', 'B');
    expect(p.assignment.TB).toBe('B');
    expect(p.echelon.TB).toBe('first');
    p = assign(ctx, p, 'RAB', 'A');
    expect(p.assignment.RAB).toBe('A');
    p = assign(ctx, p, 'DAB', 'spread');
    expect(p.assignment.DAB).toBe('spread');
    p = assign(ctx, p, 'TB', null);
    expect(p.assignment.TB).toBeNull();
    p = assignSecondEchelon(ctx, p, '2MRB', 'C');
    expect(p.echelon['2MRB']).toBe('second');
    expect(p.assignment['2MRB']).toBe('C');
  });

  it('refuses spread for manoeuvre battalions, unknown ids and game-only roles', () => {
    expect(() => assign(ctx, defaultPlan(ctx), '1MRB', 'spread')).toThrow();
    expect(() => assign(ctx, defaultPlan(ctx), 'XX', 'A')).toThrow();
    expect(() => assign(ctx, defaultPlan(ctx), 'TB', 'Z')).toThrow();
    expect(() => setRole(ctx, defaultPlan(ctx), 'A', 'exploitation')).toThrow();
    expect(isSelectableRole(ctx, 'holding')).toBe(true);
    expect(isSelectableRole(ctx, 'exploitation')).toBe(false);
  });
});

describe('axes', () => {
  it('default axis runs straight west to the objective depth', () => {
    const p = assign(ctx, defaultPlan(ctx), 'TB', 'A');
    const path = axisPath(ctx, p, 'TB');
    expect(path).toHaveLength(2);
    expect(path[1]!.x).toBe(g.objectiveX);
    expect(path[1]!.y).toBe(path[0]!.y);
  });

  it('waypoints bend the axis, which then continues west', () => {
    let p = assign(ctx, defaultPlan(ctx), 'TB', 'A');
    p = setAxis(ctx, p, 'TB', [{ x: 12000, y: 12500 }]);
    const path = axisPath(ctx, p, 'TB');
    expect(path).toHaveLength(3);
    expect(path[2]).toEqual({ x: g.objectiveX, y: 12500 });
  });

  it('only first-echelon manoeuvre formations attack along axes', () => {
    let p = assign(ctx, defaultPlan(ctx), 'TB', 'A');
    p = assignSecondEchelon(ctx, p, '1MRB', 'A');
    p = assign(ctx, p, 'RAB', 'A');
    expect(attackAxes(ctx, p).map((a) => a.formationId)).toEqual(['TB']);
    expect(() => setAxis(ctx, p, 'RAB', [])).toThrow(/fires/);
  });

  it('an axis decides which NATO units are engaged and which are bypassed', () => {
    let p = assign(ctx, defaultPlan(ctx), 'TB', 'A');
    const straight = evaluatePlan(ctx, equipment, p, forces).sectors[0]!;
    expect(straight.engaged).toContain('TM-A');
    // Swing north of the forest position, far enough to pass it without engaging.
    p = setAxis(ctx, p, 'TB', [{ x: 15000, y: 12900 }, { x: 8000, y: 12900 }]);
    const swung = evaluatePlan(ctx, equipment, p, forces).sectors[0]!;
    expect(swung.engaged).not.toContain('TM-A');
    expect(swung.bypassed).toContain('TM-A');
  });
});

describe('evaluatePlan', () => {
  it('counts the first echelon and reports the second echelon separately', () => {
    let p = assign(ctx, defaultPlan(ctx), 'TB', 'A');
    p = assignSecondEchelon(ctx, p, '1MRB', 'A');
    const a = evaluatePlan(ctx, equipment, p, forces).sectors[0]!;
    expect(a.formations).toEqual(['TB']);
    expect(a.secondEchelon).toEqual(['1MRB']);
    expect(a.soviet.infantry).toBe(0);
  });

  it('applies terrain to the NATO side: Team A holds a forest', () => {
    const a = evaluatePlan(ctx, equipment, assign(ctx, defaultPlan(ctx), 'TB', 'A'), forces).sectors[0]!;
    expect(a.terrain).toBeCloseTo(era.terrain.defence.forest);
  });

  it('applies a readiness multiplier', () => {
    const plan = assign(ctx, defaultPlan(ctx), 'TB', 'A');
    const full = evaluatePlan(ctx, equipment, plan, forces);
    const tired = evaluatePlan(ctx, equipment, plan, { ...forces, soviet: withReadiness(era.soviet.units, 0.85) });
    expect(tired.sectors[0]!.soviet.tanks).toBeCloseTo(full.sectors[0]!.soviet.tanks * 0.85);
  });

  it('a massed attack meets the overall and artillery norms; forest slows the tanks below the tank norm', () => {
    let plan = defaultPlan(ctx);
    for (const f of ['TB', '1MRB', '2MRB', 'RAB', 'DAB', 'AAB', 'ATB']) plan = assign(ctx, plan, f, 'A');
    plan = setRole(ctx, plan, 'A', 'breakthrough');
    const a = evaluatePlan(ctx, equipment, plan, forces).sectors[0]!;
    expect(a.assessment.overall.status).toBe('green');
    expect(a.assessment.artillery.status).toBe('green');
    expect(a.soviet.tanks).toBeLessThan(31); // axis through the Hoher Wald costs tempo
  });
});

describe('sanitizePlan', () => {
  it('builds a full plan from a compact one and drops what it does not know', () => {
    const p = sanitizePlan(ctx, {
      assignment: { TB: 'B', '1MRB': 'spread', RAB: 'spread', GHOST: 'A', DAB: 'Q' },
      roles: { A: 'holding', B: 'raid', C: 'exploitation' },
      axes: { TB: [{ x: 12000, y: 9000 }], RAB: [{ x: 1, y: 1 }] },
    });
    expect(p.assignment.TB).toBe('B');
    expect(p.assignment['1MRB']).toBeNull();
    expect(p.assignment.RAB).toBe('spread');
    expect(p.assignment.DAB).toBeNull();
    expect('GHOST' in p.assignment).toBe(false);
    expect(p.roles).toEqual({ A: 'holding', B: 'breakthrough', C: 'attack' });
    expect(p.axes.TB).toEqual([{ x: 12000, y: 9000 }]);
    expect(p.axes.RAB).toEqual([]);
  });

  it('copes with garbage', () => {
    expect(sanitizePlan(ctx, null)).toEqual(defaultPlan(ctx));
  });
});
