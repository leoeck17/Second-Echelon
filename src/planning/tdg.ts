// Tactical decision game: a pure state machine over one scenario.
//   briefing -> planning (recon, place, axes, commit) -> decision (phase 1 result, commit
//   second echelon) -> debrief
// Pure logic: no DOM access, no timers. The UI dispatches actions, including "timeout".

import { resolvePhase, type PhaseResult } from '../core/adjudicate';
import { applyCutOff, type Contact } from '../core/axes';
import { totalPotential } from '../core/cofm';
import type { EquipmentTable, EraData, Placement, Scenario, Unit } from '../core/data';
import { weightedPotential } from '../core/fight';
import { readinessFromPrepTime, reconSector, type ReconFinding } from '../core/fog';
import type { Pt } from '../core/geom';
import type { MapData } from '../core/terrain';
import {
  assign,
  assignSecondEchelon,
  defaultPlan,
  evaluatePlan,
  placeFormation,
  planFights,
  sanitizePlan,
  setAxis,
  setRole,
  withReadiness,
  type Plan,
  type PlanContext,
  type PlanResult,
} from './plan';

export interface TdgContext {
  era: EraData;
  scenario: Scenario;
  table: EquipmentTable;
  map: MapData;
}

export type TdgPhase = 'briefing' | 'planning' | 'decision' | 'debrief';

export type Verdict = 'success' | 'partial' | 'failure';

export interface FinalResult {
  verdict: Verdict;
  /** Breakthrough or attack sectors that succeeded in phase 2. */
  wonSectors: string[];
  /** Fraction of the regiment's starting potential lost. */
  regimentLoss: number;
  combatCapable: boolean;
  /** Enough of the regiment stands in a won sector to go on to the objective. */
  objectiveTaken: boolean;
  /** Share of the regiment's starting potential in the strongest won sector, after phase-2 losses. */
  exploitShare: number;
}

export interface Reaction {
  units: string[];
  /** Sector the NATO reserve moved into, or null if nothing was attacked. */
  sectorId: string | null;
}

export interface TdgState {
  phase: TdgPhase;
  seed: number;
  plan: Plan;
  hoursSpent: number;
  reconned: string[];
  /** The current intelligence picture of NATO. */
  estimate: Unit[];
  findings: ReconFinding[];
  timedOut: { planning: boolean; decision: boolean };
  /** Readiness multiplier from planning time left, fixed at commit. */
  readiness: number;
  /** Plan and its rating against the estimate, as committed. */
  committed?: { plan: Plan; planned: PlanResult };
  phase1?: PhaseResult;
  /** How phase 1's axes met the true NATO units. */
  contacts1?: Record<string, Contact>;
  /** NATO units cut off or encircled by a successful phase-1 attack. */
  cutOff?: string[];
  encircled?: string[];
  reaction?: Reaction;
  /** Soviet units as they stand now (readiness applied, losses taken). */
  soviet: Unit[];
  /** The true NATO units as they stand now. */
  nato: Unit[];
  phase2?: PhaseResult;
  final?: FinalResult;
  /** Why the last action was refused, if it was. */
  error?: string;
}

export type TdgAction =
  | { type: 'start' }
  | { type: 'recon'; sectorId: string }
  | { type: 'assign'; formationId: string; placement: Placement }
  | { type: 'place'; formationId: string; pos: Pt }
  | { type: 'second'; formationId: string; sectorId: string }
  | { type: 'setAxis'; formationId: string; waypoints: Pt[] }
  | { type: 'setRole'; sectorId: string; role: string }
  | { type: 'commit' }
  | { type: 'decide' }
  | { type: 'timeout' }
  | { type: 'restart'; seed?: number };

export const planContext = (ctx: TdgContext): PlanContext => ({ era: ctx.era, scenario: ctx.scenario, map: ctx.map });

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function initialState(ctx: TdgContext, seed = ctx.scenario.seed): TdgState {
  return {
    phase: 'briefing',
    seed,
    plan: defaultPlan(planContext(ctx)),
    hoursSpent: 0,
    reconned: [],
    estimate: clone(ctx.scenario.nato.estimate),
    findings: [],
    timedOut: { planning: false, decision: false },
    readiness: 1,
    soviet: clone(ctx.era.soviet.units),
    nato: clone(ctx.scenario.nato.truth),
  };
}

export function hoursLeft(ctx: TdgContext, s: TdgState): number {
  return ctx.scenario.planningHours - s.hoursSpent;
}

/** Readiness the regiment would have if the plan were committed now. */
export function currentReadiness(ctx: TdgContext, s: TdgState): number {
  return readinessFromPrepTime(hoursLeft(ctx, s), ctx.era.prepTime);
}

/** In the decision, only the second echelon, the reserve and the artillery can move. */
export function movableInDecision(ctx: TdgContext, s: TdgState, formationId: string): boolean {
  const f = ctx.era.soviet.formations.find((x) => x.id === formationId);
  if (!f) return false;
  if (f.canSpread) return true;
  return s.committed?.plan.echelon[formationId] !== 'first';
}

const reactionSet = (s: TdgState) => new Set(s.reaction?.sectorId ? s.reaction.units : []);

/**
 * The plan's rating against the current estimate. While planning, Soviet units get the
 * readiness they would have if committed now; in the decision, they stand as they are
 * after phase 1, and sectors already broken through are rated against exploitation norms.
 */
export function rateAgainstEstimate(ctx: TdgContext, s: TdgState): PlanResult {
  const before = s.phase === 'planning' || s.phase === 'briefing';
  const soviet = before ? withReadiness(s.soviet, currentReadiness(ctx, s)) : s.soviet;
  const plan = s.phase === 'decision' ? { ...s.plan, roles: phase2Roles(ctx, s) } : s.plan;
  return evaluatePlan(planContext(ctx), ctx.table, plan, { soviet, nato: s.estimate }, reactionSet(s));
}

/** Potential at readiness 1, so the prep-time multiplier doesn't count as a loss. */
function nominalPotential(ctx: TdgContext, units: readonly Unit[]): number {
  return totalPotential(units.map((u) => ({ ...u, readiness: 1 })), ctx.table).overall;
}

function regimentLoss(ctx: TdgContext, now: readonly Unit[]): number {
  const start = nominalPotential(ctx, ctx.era.soviet.units);
  return start > 0 ? 1 - nominalPotential(ctx, now) / start : 0;
}

function commit(ctx: TdgContext, s: TdgState): TdgState {
  const pc = planContext(ctx);
  const readiness = currentReadiness(ctx, s);
  const soviet = withReadiness(s.soviet, readiness);
  const planned = evaluatePlan(pc, ctx.table, s.plan, { soviet, nato: s.estimate });
  const fights = planFights(pc, ctx.table, s.plan, { soviet, nato: s.nato });
  const phase1 = resolvePhase({
    seed: s.seed,
    phase: 1,
    sectors: ctx.scenario.sectors,
    roles: s.plan.roles,
    norms: ctx.era.norms,
    params: ctx.era.adjudication,
    table: ctx.table,
    soviet,
    nato: s.nato,
    fights: fights.sectors,
  });

  // Units bypassed or encircled by an attack that broke through are cut off.
  const won = new Set(phase1.sectors.filter((x) => x.outcome === 'success').map((x) => x.sectorId));
  const cut = applyCutOff(phase1.nato, fights.contacts, won, ctx.era.axes);
  let nato = cut.nato;

  // Contact reveals the sectors that were attacked.
  let estimate = s.estimate;
  const findings = [...s.findings];
  const attacked = phase1.sectors.filter((x) => x.outcome !== 'none');
  for (const x of attacked) {
    const before = new Map(estimate.map((u) => [u.id, u]));
    const r = reconSector(estimate, nato, x.sectorId, ctx.era.recon);
    estimate = r.estimate;
    // Report only news: a unit already confirmed in this sector is no surprise.
    findings.push(
      ...r.findings.filter((f) => {
        const b = before.get(f.unitId);
        return !(f.kind === 'confirmed' && b?.intel?.status === 'confirmed' && b.placement === x.sectorId);
      }),
    );
  }

  // NATO reaction (Active Defense): the reserve moves toward the identified main effort,
  // the attacked sector with the most Soviet combat potential committed. It counterattacks
  // there whatever the axes do.
  const target = [...attacked].sort((a, b) => b.soviet.overall - a.soviet.overall)[0]?.sectorId ?? null;
  const reactionIds = ctx.scenario.natoReaction.units;
  if (target) {
    const lane = ctx.scenario.sectors.find((x) => x.id === target)!.yRange;
    const pos = { x: ctx.scenario.geometry.reactionX, y: (lane[0] + lane[1]) / 2 };
    nato = nato.map((u) => (reactionIds.includes(u.id) ? { ...u, placement: target, pos } : u));
    const note = 'Reported moving up to counterattack.';
    const known = new Set(estimate.map((u) => u.id));
    estimate = estimate.map((u) => (reactionIds.includes(u.id) ? { ...u, placement: target, pos, note } : u));
    for (const u of nato) {
      if (reactionIds.includes(u.id) && !known.has(u.id)) {
        estimate.push({ ...u, note, intel: { status: 'suspected', low: 0.75, high: 1.25 } });
      }
    }
  }

  return {
    ...s,
    phase: 'decision',
    readiness,
    committed: { plan: s.plan, planned },
    phase1,
    contacts1: fights.contacts,
    cutOff: cut.cutOff,
    encircled: cut.encircled,
    reaction: { units: reactionIds, sectorId: target },
    soviet: phase1.soviet,
    nato,
    estimate,
    findings,
    error: undefined,
  };
}

/** Roles used in phase 2: a sector broken through in phase 1 is now exploiting. */
export function phase2Roles(ctx: TdgContext, s: TdgState): Record<string, string> {
  const roles = { ...s.plan.roles };
  for (const x of s.phase1?.sectors ?? []) {
    if (x.outcome === 'success' && isAttackRole(x.role)) roles[x.sectorId] = ctx.era.adjudication.exploitRole;
  }
  return roles;
}

const isAttackRole = (role: string) => role === 'breakthrough' || role === 'attack';

function decide(ctx: TdgContext, s: TdgState): TdgState {
  const pc = planContext(ctx);
  const fights = planFights(pc, ctx.table, s.plan, { soviet: s.soviet, nato: s.nato }, reactionSet(s));
  const phase2 = resolvePhase({
    seed: s.seed,
    phase: 2,
    sectors: ctx.scenario.sectors,
    roles: phase2Roles(ctx, s),
    norms: ctx.era.norms,
    params: ctx.era.adjudication,
    table: ctx.table,
    soviet: s.soviet,
    nato: s.nato,
    fights: fights.sectors,
  });
  // A sector counts as won if its attack (or exploitation) succeeded in phase 2.
  const wonSectors = phase2.sectors
    .filter((x) => x.outcome === 'success' && isAttackRole(s.plan.roles[x.sectorId] ?? ''))
    .map((x) => x.sectorId);
  // Taking the objective needs enough of the regiment through the gap after the fighting.
  const start = nominalPotential(ctx, ctx.era.soviet.units);
  const nominal = phase2.soviet.map((u) => ({ ...u, readiness: 1 }));
  const strongest = Math.max(
    0,
    ...wonSectors.map((id) => {
      // Everything standing in that sector now: first echelon (fires counted once) and second echelon.
      const weights: Record<string, number> = {};
      for (const u of nominal) {
        const f = ctx.era.soviet.formations.find((x) => x.id === u.parent)!;
        if (s.plan.assignment[f.id] === id && !f.canSpread) weights[u.id] = 1;
      }
      return weightedPotential(nominal, weights, ctx.table).overall;
    }),
  );
  const exploitShare = start > 0 ? strongest / start : 0;
  const objectiveTaken = wonSectors.length > 0 && exploitShare >= ctx.era.adjudication.exploitMinShare;
  const loss = regimentLoss(ctx, phase2.soviet);
  const combatCapable = loss < ctx.era.adjudication.lossLimit;
  const verdict: Verdict = !wonSectors.length ? 'failure' : objectiveTaken && combatCapable ? 'success' : 'partial';
  return {
    ...s,
    phase: 'debrief',
    phase2,
    soviet: phase2.soviet,
    nato: phase2.nato,
    final: { verdict, wonSectors, regimentLoss: loss, combatCapable, objectiveTaken, exploitShare },
    error: undefined,
  };
}

const refuse = (s: TdgState, error: string): TdgState => ({ ...s, error });

function edit(s: TdgState, f: () => Plan): TdgState {
  try {
    return { ...s, plan: f(), error: undefined };
  } catch (e) {
    return refuse(s, (e as Error).message);
  }
}

export function tdgReducer(ctx: TdgContext, s: TdgState, a: TdgAction): TdgState {
  const pc = planContext(ctx);
  const canMove = (id: string) => s.phase === 'planning' || (s.phase === 'decision' && movableInDecision(ctx, s, id));
  switch (a.type) {
    case 'restart':
      return initialState(ctx, a.seed ?? s.seed);
    case 'start':
      return s.phase === 'briefing' ? { ...s, phase: 'planning', error: undefined } : s;
    case 'recon': {
      if (s.phase !== 'planning') return refuse(s, 'Recon is only possible while planning.');
      if (!ctx.scenario.sectors.some((x) => x.id === a.sectorId)) return refuse(s, `Unknown sector ${a.sectorId}.`);
      if (s.reconned.includes(a.sectorId)) return refuse(s, `Sector ${a.sectorId} has already been reconnoitred.`);
      const cost = ctx.era.recon.hoursPerSector;
      if (hoursLeft(ctx, s) < cost) return refuse(s, `Not enough planning time left (recon takes ${cost} h).`);
      const r = reconSector(s.estimate, s.nato, a.sectorId, ctx.era.recon);
      return {
        ...s,
        estimate: r.estimate,
        findings: [...s.findings, ...r.findings],
        reconned: [...s.reconned, a.sectorId],
        hoursSpent: s.hoursSpent + cost,
        error: undefined,
      };
    }
    case 'assign':
    case 'second':
    case 'place':
    case 'setAxis': {
      if (s.phase !== 'planning' && s.phase !== 'decision') return refuse(s, 'Nothing to move now.');
      if (!canMove(a.formationId)) return refuse(s, 'Battalions already in contact cannot be moved.');
      if (a.type === 'assign') return edit(s, () => assign(pc, s.plan, a.formationId, a.placement));
      if (a.type === 'place') return edit(s, () => placeFormation(pc, s.plan, a.formationId, a.pos));
      if (a.type === 'second') return edit(s, () => assignSecondEchelon(pc, s.plan, a.formationId, a.sectorId));
      return edit(s, () => setAxis(pc, s.plan, a.formationId, a.waypoints));
    }
    case 'setRole':
      if (s.phase !== 'planning') return refuse(s, 'Sector roles are fixed once the plan is committed.');
      return edit(s, () => setRole(pc, s.plan, a.sectorId, a.role));
    case 'commit':
      return s.phase === 'planning' ? commit(ctx, s) : refuse(s, 'There is no plan to commit now.');
    case 'decide':
      return s.phase === 'decision' ? decide(ctx, s) : refuse(s, 'There is no decision to make now.');
    case 'timeout':
      if (s.phase === 'planning') return { ...commit(ctx, s), timedOut: { ...s.timedOut, planning: true } };
      if (s.phase === 'decision') return { ...decide(ctx, s), timedOut: { ...s.timedOut, decision: true } };
      return s;
  }
}

export interface Playthrough {
  recon: string[];
  plan: { assignment: Record<string, Placement>; roles: Record<string, string>; axes?: Record<string, Pt[]> };
  decision: Record<string, Placement>;
  decisionAxes?: Record<string, Pt[]>;
}

/** Play a whole scenario from fixed choices; used for the school solution and balance tests. */
export function simulate(ctx: TdgContext, seed: number, play: Playthrough): TdgState {
  const step = (s: TdgState, a: TdgAction) => tdgReducer(ctx, s, a);
  let s = step(initialState(ctx, seed), { type: 'start' });
  for (const sectorId of play.recon) s = step(s, { type: 'recon', sectorId });
  s = { ...s, plan: sanitizePlan(planContext(ctx), play.plan) };
  s = step(s, { type: 'commit' });
  for (const [formationId, placement] of Object.entries(play.decision)) {
    s = step(s, { type: 'assign', formationId, placement });
  }
  for (const [formationId, waypoints] of Object.entries(play.decisionAxes ?? {})) {
    s = step(s, { type: 'setAxis', formationId, waypoints });
  }
  return step(s, { type: 'decide' });
}
