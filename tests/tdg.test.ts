import { describe, expect, it } from 'vitest';
import {
  currentReadiness,
  hoursLeft,
  initialState,
  movableInDecision,
  phase2Roles,
  rateAgainstEstimate,
  simulate,
  tdgReducer,
  type TdgAction,
  type TdgState,
} from '../src/planning/tdg';
import { ctxFor, scenario } from './fixtures';

const sc1 = scenario('1970s-01');
const sc2 = scenario('1970s-02');
const ctx = ctxFor(sc1);
const run = (s: TdgState, ...actions: TdgAction[]) => actions.reduce((acc, a) => tdgReducer(ctx, acc, a), s);
const planning = () => run(initialState(ctx), { type: 'start' });

describe('tdg: briefing and planning', () => {
  it('starts in the briefing with the scenario estimate and nothing committed', () => {
    const s = initialState(ctx);
    expect(s.phase).toBe('briefing');
    expect(s.seed).toBe(sc1.seed);
    expect(s.estimate).toEqual(sc1.nato.estimate);
    expect(Object.values(s.plan.assignment).every((p) => p === null)).toBe(true);
    expect(run(s, { type: 'start' }).phase).toBe('planning');
  });

  it('assigns and sets roles while planning', () => {
    const s = run(planning(), { type: 'assign', formationId: 'TB', placement: 'A' }, { type: 'setRole', sectorId: 'A', role: 'holding' });
    expect(s.plan.assignment.TB).toBe('A');
    expect(s.plan.roles.A).toBe('holding');
    expect(s.error).toBeUndefined();
  });

  it('refuses illegal moves with a reason instead of throwing', () => {
    const s = run(planning(), { type: 'assign', formationId: '1MRB', placement: 'spread' });
    expect(s.error).toMatch(/cannot be spread/);
    expect(run(planning(), { type: 'setRole', sectorId: 'A', role: 'exploitation' }).error).toBeDefined();
  });

  it('recon spends planning hours, reveals the sector and lowers readiness', () => {
    const s0 = planning();
    expect(currentReadiness(ctx, s0)).toBe(1);
    const s1 = run(s0, { type: 'recon', sectorId: 'C' });
    expect(hoursLeft(ctx, s1)).toBe(sc1.planningHours - 2);
    expect(s1.reconned).toEqual(['C']);
    expect(s1.findings.some((f) => f.unitId === 'TM-C' && f.kind === 'changed')).toBe(true);
    const s3 = run(s1, { type: 'recon', sectorId: 'A' }, { type: 'recon', sectorId: 'B' });
    expect(hoursLeft(ctx, s3)).toBe(0);
    expect(currentReadiness(ctx, s3)).toBeLessThan(1);
  });

  it('refuses recon twice in a sector or beyond the budget', () => {
    const s1 = run(planning(), { type: 'recon', sectorId: 'A' });
    expect(run(s1, { type: 'recon', sectorId: 'A' }).error).toMatch(/already/);
    const ctx3 = ctxFor(scenario('1970s-03'));
    let s = tdgReducer(ctx3, initialState(ctx3), { type: 'start' });
    s = tdgReducer(ctx3, s, { type: 'recon', sectorId: 'A' });
    s = tdgReducer(ctx3, s, { type: 'recon', sectorId: 'B' });
    expect(s.error).toMatch(/Not enough planning time/);
    expect(s.reconned).toEqual(['A']);
  });

  it('rates the plan against the current estimate with current readiness', () => {
    const fresh = run(planning(), { type: 'assign', formationId: 'TB', placement: 'A' });
    const s = run(fresh, { type: 'recon', sectorId: 'A' }, { type: 'recon', sectorId: 'B' }, { type: 'recon', sectorId: 'C' });
    const k = currentReadiness(ctx, s);
    expect(k).toBeLessThan(1);
    expect(rateAgainstEstimate(ctx, s).sectors[0]!.soviet.tanks).toBeCloseTo(rateAgainstEstimate(ctx, fresh).sectors[0]!.soviet.tanks * k);
  });
});

describe('tdg: commit and decision', () => {
  const committed = () =>
    run(
      planning(),
      { type: 'assign', formationId: 'TB', placement: 'A' },
      { type: 'assign', formationId: '1MRB', placement: 'A' },
      { type: 'assign', formationId: 'RAB', placement: 'A' },
      { type: 'setRole', sectorId: 'A', role: 'breakthrough' },
      { type: 'commit' },
    );

  it('resolves phase 1, reveals attacked sectors and moves the NATO reserve to the main effort', () => {
    const s = committed();
    expect(s.phase).toBe('decision');
    expect(s.phase1!.sectors.find((x) => x.sectorId === 'A')!.outcome).not.toBe('none');
    expect(s.phase1!.sectors.find((x) => x.sectorId === 'B')!.outcome).toBe('none');
    expect(s.reaction).toEqual({ units: ['BDE-RES'], sectorId: 'A' });
    expect(s.nato.find((u) => u.id === 'BDE-RES')!.placement).toBe('A');
    expect(s.estimate.find((u) => u.id === 'BDE-RES')!.placement).toBe('A');
    expect(s.estimate.find((u) => u.id === 'TM-A')!.intel!.status).toBe('confirmed');
    expect(s.soviet.find((u) => u.id === 'TB-1')!.strength).toBeLessThan(1);
  });

  it('contact reports only news, not units already confirmed there', () => {
    const s = committed();
    const contact = s.findings.filter((f) => f.sectorId === 'A');
    expect(contact.some((f) => f.unitId === 'TM-A')).toBe(false); // confirmed before, losses are no news
    expect(s.estimate.find((u) => u.id === 'BDE-RES')!.note).toMatch(/counterattack/);
  });

  it('only lets uncommitted formations and fire support move in the decision', () => {
    const s = committed();
    expect(movableInDecision(ctx, s, 'TB')).toBe(false);
    expect(movableInDecision(ctx, s, '2MRB')).toBe(true);
    expect(movableInDecision(ctx, s, 'RAB')).toBe(true);
    expect(run(s, { type: 'assign', formationId: 'TB', placement: 'B' }).error).toMatch(/in contact/);
    expect(run(s, { type: 'assign', formationId: '2MRB', placement: 'A' }).plan.assignment['2MRB']).toBe('A');
    expect(run(s, { type: 'setRole', sectorId: 'A', role: 'attack' }).error).toBeDefined();
    expect(run(s, { type: 'recon', sectorId: 'B' }).error).toBeDefined();
  });

  it('switches a sector broken through in phase 1 to exploitation norms for phase 2', () => {
    const s = committed();
    const roles = phase2Roles(ctx, s);
    const a = s.phase1!.sectors.find((x) => x.sectorId === 'A')!;
    expect(roles.A).toBe(a.outcome === 'success' ? 'exploitation' : 'breakthrough');
    expect(roles.B).toBe(s.plan.roles.B);
  });

  it('decide resolves phase 2 and produces a final result', () => {
    const s = run(committed(), { type: 'assign', formationId: '2MRB', placement: 'A' }, { type: 'decide' });
    expect(s.phase).toBe('debrief');
    expect(s.phase2).toBeDefined();
    expect(['success', 'partial', 'failure']).toContain(s.final!.verdict);
    expect(s.final!.regimentLoss).toBeGreaterThan(0);
    expect(s.final!.regimentLoss).toBeLessThan(1);
  });
});

describe('tdg: timeout and restart', () => {
  it('a planning timeout commits the plan as it stands', () => {
    const s = run(planning(), { type: 'assign', formationId: 'TB', placement: 'A' }, { type: 'timeout' });
    expect(s.phase).toBe('decision');
    expect(s.timedOut.planning).toBe(true);
    expect(s.committed!.plan.assignment.TB).toBe('A');
  });

  it('a decision timeout resolves phase 2 with no further orders', () => {
    const s = run(planning(), { type: 'assign', formationId: 'TB', placement: 'A' }, { type: 'commit' }, { type: 'timeout' });
    expect(s.phase).toBe('debrief');
    expect(s.timedOut.decision).toBe(true);
  });

  it('timeout does nothing in the briefing or debrief', () => {
    const b = initialState(ctx);
    expect(run(b, { type: 'timeout' })).toEqual(b);
  });

  it('restart goes back to the briefing, optionally with a new seed', () => {
    const s = run(planning(), { type: 'recon', sectorId: 'A' }, { type: 'restart', seed: 99 });
    expect(s.phase).toBe('briefing');
    expect(s.seed).toBe(99);
    expect(s.reconned).toEqual([]);
  });

  it('a run is reproducible from its seed', () => {
    const play = sc2.schoolSolution;
    const c2 = ctxFor(sc2);
    expect(simulate(c2, 123, play).final).toEqual(simulate(c2, 123, play).final);
  });
});
