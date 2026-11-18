// Plan model on the map: where each Soviet formation stands, its echelon and its axis
// of advance, plus each sector's role. A formation's sector and echelon follow from its
// position: the sector lane (by y) and the depth band (by x) east of the line of contact.
// Pure logic: no DOM access.

import type { AxisPlan, Contact } from '../core/axes';
import {
  addPotential,
  assessSector,
  estimatedUnitPotential,
  scalePotential,
  sectorRatios,
  totalPotential,
  worstStatus,
  zeroEstimate,
  type Estimate,
  type NormStatus,
  type Potential,
  type Ratios,
  type SectorAssessment,
} from '../core/cofm';
import { RATIO_KEYS, type Echelon, type EquipmentTable, type EraData, type Formation, type Placement, type Scenario, type Sector, type Unit } from '../core/data';
import { buildFights, natoFightPotential, weightedPotential, type FightResult } from '../core/fight';
import type { Pt } from '../core/geom';
import type { MapData } from '../core/terrain';

/** What a plan is checked against: era norms and order of battle, the scenario and its map. */
export interface PlanContext {
  era: EraData;
  scenario: Scenario;
  map: MapData;
}

export interface Plan {
  /** Formation id -> sector it fights in, "spread" (fires on general support) or null. Derived from position. */
  assignment: Record<string, Placement>;
  /** Sector id -> role key in norms.roles. */
  roles: Record<string, string>;
  /** Formation id -> echelon. Derived from position. */
  echelon: Record<string, Echelon>;
  /** Formation id -> position on the map (m). */
  positions: Record<string, Pt>;
  /** Formation id -> waypoints of its axis of advance (the start is its position). */
  axes: Record<string, Pt[]>;
}

export interface SectorResult {
  sector: Sector;
  role: string;
  /** Formations fighting here: first echelon and supporting fires. */
  formations: string[];
  /** Second-echelon formations standing behind this sector. */
  secondEchelon: string[];
  soviet: Potential;
  /** Estimated NATO potential in the fight, terrain multiplier applied. */
  nato: Estimate;
  terrain: number;
  engaged: string[];
  bypassed: string[];
  encircled: string[];
  ratios: Ratios;
  assessment: SectorAssessment;
  verdict: NormStatus;
}

export interface PlanResult {
  sectors: SectorResult[];
  /** Soviet potential not fighting: second echelon and reserve. */
  uncommitted: Potential;
  /** NATO potential estimated outside the fights (reserves, depth, unknown location). */
  natoReserve: Estimate;
  contacts: Record<string, Contact>;
}

export type Band = Echelon | 'generalSupport';

const inRange = (v: number, r: readonly [number, number]) => v >= r[0] && v < r[1];

export function laneAt(ctx: PlanContext, y: number): string | null {
  return ctx.scenario.sectors.find((s) => inRange(y, s.yRange))?.id ?? null;
}

export function bandAt(ctx: PlanContext, x: number): Band | null {
  const b = ctx.scenario.geometry.bands;
  if (inRange(x, b.first)) return 'first';
  if (inRange(x, b.second)) return 'second';
  if (inRange(x, b.reserve)) return 'reserve';
  if (x >= b.generalSupport[0] && x <= b.generalSupport[1]) return 'generalSupport';
  return null;
}

const formationOf = (ctx: PlanContext, id: string): Formation => {
  const f = ctx.era.soviet.formations.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown formation "${id}"`);
  return f;
};

export const isFires = (f: Formation): boolean => f.canSpread;

/** Default spot for a formation in a sector lane and band (or the assembly area), spaced by formation order. */
export function defaultPosition(ctx: PlanContext, formationId: string, sectorId: string | null, band: Band): Pt {
  const i = ctx.era.soviet.formations.findIndex((f) => f.id === formationId);
  const b = ctx.scenario.geometry.bands[band];
  const midX = (b[0] + b[1]) / 2;
  if (sectorId === null) {
    // Assembly area: a column down the band, spread over the attack zone.
    const ys = ctx.scenario.sectors.flatMap((s) => s.yRange);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const n = ctx.era.soviet.formations.length;
    return { x: midX + (i % 2 ? 500 : -500), y: y0 + ((i + 0.5) * (y1 - y0)) / n };
  }
  const lane = ctx.scenario.sectors.find((s) => s.id === sectorId)!.yRange;
  const cy = (lane[0] + lane[1]) / 2;
  const half = (lane[1] - lane[0]) / 2;
  return { x: midX + ((Math.floor(i / 3) % 3) - 1) * 400, y: cy + ((i % 3) - 1) * Math.min(400, half * 0.3) };
}

function settle(ctx: PlanContext, plan: Plan, formationId: string, pos: Pt): Plan | string {
  const f = formationOf(ctx, formationId);
  const band = bandAt(ctx, pos.x);
  const lane = laneAt(ctx, pos.y);
  if (band === null) return 'Place units east of the line of contact, in the deployment area.';
  let assignment: Placement = null;
  let echelon: Echelon = 'reserve';
  if (isFires(f)) {
    if (band === 'generalSupport') assignment = 'spread';
    else if (band === 'first' || band === 'second') {
      if (!lane) return 'Artillery supporting a sector must stand behind that sector.';
      assignment = lane;
    }
    echelon = band === 'reserve' ? 'reserve' : 'first';
  } else if (band === 'first' || band === 'second') {
    if (!lane) return 'Place the battalion behind one of the sectors.';
    assignment = lane;
    echelon = band;
  }
  return {
    ...plan,
    assignment: { ...plan.assignment, [formationId]: assignment },
    echelon: { ...plan.echelon, [formationId]: echelon },
    positions: { ...plan.positions, [formationId]: { x: Math.round(pos.x), y: Math.round(pos.y) } },
    axes: { ...plan.axes, [formationId]: [] },
  };
}

/** Move a formation to a point; sector and echelon follow. Throws with a reason if the spot is not allowed. */
export function placeFormation(ctx: PlanContext, plan: Plan, formationId: string, pos: Pt): Plan {
  const r = settle(ctx, plan, formationId, pos);
  if (typeof r === 'string') throw new Error(r);
  return r;
}

/** Start of planning: every formation in the assembly area, sectors at their default roles. */
export function defaultPlan(ctx: PlanContext): Plan {
  let plan: Plan = { assignment: {}, roles: {}, echelon: {}, positions: {}, axes: {} };
  for (const s of ctx.scenario.sectors) plan.roles[s.id] = s.defaultRole;
  for (const f of ctx.era.soviet.formations) {
    plan = placeFormation(ctx, plan, f.id, defaultPosition(ctx, f.id, null, 'reserve'));
  }
  return plan;
}

/**
 * Button fallback: put a formation in a sector's first echelon (fires: behind it), on
 * general support ("spread"), or back in the assembly area (null).
 */
export function assign(ctx: PlanContext, plan: Plan, formationId: string, placement: Placement): Plan {
  const f = formationOf(ctx, formationId);
  if (placement === 'spread' && !f.canSpread) throw new Error(`${f.short} cannot be spread over sectors`);
  if (placement === 'reserve' || placement === null) {
    return placeFormation(ctx, plan, formationId, defaultPosition(ctx, formationId, null, 'reserve'));
  }
  if (placement === 'spread') {
    return placeFormation(ctx, plan, formationId, defaultPosition(ctx, formationId, null, 'generalSupport'));
  }
  if (!ctx.scenario.sectors.some((s) => s.id === placement)) throw new Error(`Unknown sector "${placement}"`);
  return placeFormation(ctx, plan, formationId, defaultPosition(ctx, formationId, placement, isFires(f) ? 'second' : 'first'));
}

/** Put a formation in a sector's second echelon. */
export function assignSecondEchelon(ctx: PlanContext, plan: Plan, formationId: string, sectorId: string): Plan {
  return placeFormation(ctx, plan, formationId, defaultPosition(ctx, formationId, sectorId, 'second'));
}

export function setAxis(ctx: PlanContext, plan: Plan, formationId: string, waypoints: Pt[]): Plan {
  const f = formationOf(ctx, formationId);
  if (isFires(f)) throw new Error(`${f.short} fires; it has no axis of advance`);
  const w = ctx.map.width;
  const h = ctx.map.height;
  const clean = waypoints.map((p) => ({ x: Math.round(Math.max(0, Math.min(w, p.x))), y: Math.round(Math.max(0, Math.min(h, p.y))) }));
  return { ...plan, axes: { ...plan.axes, [formationId]: clean } };
}

/** The full axis of a formation: its position, its waypoints, then on west to the objective depth. */
export function axisPath(ctx: PlanContext, plan: Plan, formationId: string): Pt[] {
  const start = plan.positions[formationId];
  if (!start) return [];
  const path = [start, ...(plan.axes[formationId] ?? [])];
  const last = path[path.length - 1]!;
  const endX = ctx.scenario.geometry.objectiveX;
  if (last.x > endX) path.push({ x: endX, y: last.y });
  return path;
}

/** Axes of the formations attacking now: first-echelon manoeuvre formations in a sector. */
export function attackAxes(ctx: PlanContext, plan: Plan): AxisPlan[] {
  return ctx.era.soviet.formations
    .filter((f) => !isFires(f) && plan.echelon[f.id] === 'first' && typeof plan.assignment[f.id] === 'string' && plan.assignment[f.id] !== 'spread')
    .map((f) => ({ formationId: f.id, sectorId: plan.assignment[f.id] as string, path: axisPath(ctx, plan, f.id) }));
}

/** Where a Soviet unit fights under a plan: first echelon and fires only. */
export const sovietPlacement =
  (plan: Plan) =>
  (u: Unit): Placement =>
    plan.echelon[u.parent] === 'first' ? plan.assignment[u.parent] ?? null : null;

/** Where a NATO unit stands: its own placement. */
export const natoPlacement = (u: Unit): Placement => u.placement ?? null;

/** Copies of units with readiness multiplied by k (e.g. time for battle procedure). */
export function withReadiness(units: readonly Unit[], k: number): Unit[] {
  return units.map((u) => ({ ...u, readiness: u.readiness * k }));
}

/** Roles the player may choose (not game-applied ones such as exploitation). */
export function isSelectableRole(ctx: PlanContext, role: string): boolean {
  const r = ctx.era.norms.roles[role];
  return !!r && r.selectable !== false;
}

export function setRole(ctx: PlanContext, plan: Plan, sectorId: string, role: string): Plan {
  if (!isSelectableRole(ctx, role)) throw new Error(`Unknown role "${role}"`);
  if (!ctx.scenario.sectors.some((s) => s.id === sectorId)) throw new Error(`Unknown sector "${sectorId}"`);
  return { ...plan, roles: { ...plan.roles, [sectorId]: role } };
}

/**
 * Build a full plan from a compact one (school solutions, tests): formations with a
 * sector go to its first echelon (fires: behind it), "spread" to general support,
 * null to the assembly area; then axes and roles are applied.
 */
export function sanitizePlan(
  ctx: PlanContext,
  compact: { assignment?: Record<string, Placement>; roles?: Record<string, string>; axes?: Record<string, Pt[]> } | null | undefined,
): Plan {
  let plan = defaultPlan(ctx);
  const sectorIds = new Set(ctx.scenario.sectors.map((s) => s.id));
  for (const f of ctx.era.soviet.formations) {
    const p = compact?.assignment?.[f.id];
    if (p === null || p === undefined) continue;
    if (sectorIds.has(p) || (p === 'spread' && f.canSpread)) plan = assign(ctx, plan, f.id, p);
  }
  for (const s of ctx.scenario.sectors) {
    const r = compact?.roles?.[s.id];
    if (r && isSelectableRole(ctx, r)) plan.roles[s.id] = r;
  }
  for (const [fid, pts] of Object.entries(compact?.axes ?? {})) {
    const f = ctx.era.soviet.formations.find((x) => x.id === fid);
    if (f && !isFires(f)) plan = setAxis(ctx, plan, fid, pts);
  }
  return plan;
}

/** Who fights whom under a plan, against a given set of NATO units. */
export function planFights(
  ctx: PlanContext,
  table: EquipmentTable,
  plan: Plan,
  forces: { soviet: readonly Unit[]; nato: readonly Unit[] },
  alwaysEngaged?: ReadonlySet<string>,
): FightResult {
  return buildFights({
    sectors: ctx.scenario.sectors,
    map: ctx.map,
    terrain: ctx.era.terrain,
    axesParams: ctx.era.axes,
    table,
    soviet: forces.soviet,
    sovPlacement: sovietPlacement(plan),
    axes: attackAxes(ctx, plan),
    nato: forces.nato,
    alwaysEngaged,
  });
}

/**
 * Rate a plan: Soviet units (as they stand) against a set of NATO units, either the
 * intelligence estimate (during planning) or the truth (in the debrief).
 */
export function evaluatePlan(
  ctx: PlanContext,
  table: EquipmentTable,
  plan: Plan,
  forces: { soviet: readonly Unit[]; nato: readonly Unit[] },
  alwaysEngaged?: ReadonlySet<string>,
): PlanResult {
  const fights = planFights(ctx, table, plan, forces, alwaysEngaged);
  const inFight = new Set<string>();
  const sectors = ctx.scenario.sectors.map((sector): SectorResult => {
    const role = plan.roles[sector.id] ?? sector.defaultRole;
    const norms = ctx.era.norms.roles[role];
    if (!norms) throw new Error(`Unknown role "${role}"`);
    const f = fights.sectors[sector.id]!;
    for (const id of [...Object.keys(f.nato), ...Object.keys(f.flank)]) inFight.add(id);
    const sov = weightedPotential(forces.soviet, f.soviet, table);
    let nato: Estimate = {
      low: natoFightPotential(forces.nato, f, table, (u) => estimatedUnitPotential(u, table).low),
      mid: natoFightPotential(forces.nato, f, table, (u) => estimatedUnitPotential(u, table).mid),
      high: natoFightPotential(forces.nato, f, table, (u) => estimatedUnitPotential(u, table).high),
    };
    const k = f.terrain;
    nato = { low: scalePotential(nato.low, k), mid: scalePotential(nato.mid, k), high: scalePotential(nato.high, k) };
    const ratios = sectorRatios(sov, nato);
    const assessment = assessSector(ratios, norms.required, ctx.era.norms.amberFraction);
    const formations = ctx.era.soviet.formations
      .filter((fm) => plan.echelon[fm.id] === 'first' && (plan.assignment[fm.id] === sector.id || plan.assignment[fm.id] === 'spread'))
      .map((fm) => fm.id);
    const secondEchelon = ctx.era.soviet.formations
      .filter((fm) => plan.echelon[fm.id] === 'second' && plan.assignment[fm.id] === sector.id)
      .map((fm) => fm.id);
    return {
      sector,
      role,
      formations,
      secondEchelon,
      soviet: sov,
      nato,
      terrain: k,
      engaged: f.engaged,
      bypassed: f.bypassed,
      encircled: f.encircled,
      ratios,
      assessment,
      verdict: worstStatus(RATIO_KEYS.map((key) => assessment[key].status)),
    };
  });

  const sovPlace = sovietPlacement(plan);
  const uncommitted = totalPotential(
    forces.soviet.filter((u) => sovPlace(u) === null),
    table,
  );
  const natoReserve = forces.nato
    .filter((u) => !inFight.has(u.id))
    .map((u) => estimatedUnitPotential(u, table))
    .reduce(
      (acc, e) => ({ low: addPotential(acc.low, e.low), mid: addPotential(acc.mid, e.mid), high: addPotential(acc.high, e.high) }),
      zeroEstimate(),
    );
  return { sectors, uncommitted, natoReserve, contacts: fights.contacts };
}
