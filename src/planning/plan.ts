// Plan model: which Soviet formation goes to which sector, and each sector's role.
// Evaluating a plan runs the COFM core for every sector. Pure logic: no DOM access.

import {
  addPotential,
  assessSector,
  estimatedUnitPotential,
  sectorEstimates,
  sectorPotentials,
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
import { RATIO_KEYS, type EquipmentTable, type EraData, type Placement, type Sector, type Unit } from '../core/data';

/** What a plan is checked against: the era's norms and Soviet order of battle, and the scenario's sectors. */
export interface PlanContext {
  era: EraData;
  sectors: readonly Sector[];
}

export interface Plan {
  /** Soviet formation id -> placement (sector id, "spread" or null for uncommitted). */
  assignment: Record<string, Placement>;
  /** Sector id -> role key in norms.roles. */
  roles: Record<string, string>;
}

export interface SectorResult {
  sector: Sector;
  role: string;
  formations: string[];
  soviet: Potential;
  nato: Estimate;
  ratios: Ratios;
  assessment: SectorAssessment;
  /** Worst status over all categories. */
  verdict: NormStatus;
}

export interface PlanResult {
  sectors: SectorResult[];
  /** Soviet potential not committed to any sector. */
  uncommitted: Potential;
  /** NATO potential estimated outside the sectors (reserves, unknown location). */
  natoReserve: Estimate;
}

/** Start of planning: nothing committed, sectors at their default roles. */
export function defaultPlan(ctx: PlanContext): Plan {
  const assignment: Record<string, Placement> = {};
  for (const f of ctx.era.soviet.formations) assignment[f.id] = null;
  const roles: Record<string, string> = {};
  for (const s of ctx.sectors) roles[s.id] = s.defaultRole;
  return { assignment, roles };
}

/** Repair a plan (e.g. from storage or data) so it only uses ids and roles the context knows. */
export function sanitizePlan(ctx: PlanContext, plan: Partial<Plan> | null | undefined): Plan {
  const clean = defaultPlan(ctx);
  const sectorIds = new Set(ctx.sectors.map((s) => s.id));
  for (const f of ctx.era.soviet.formations) {
    const p = plan?.assignment?.[f.id];
    if (p === null || p === undefined) continue;
    if (sectorIds.has(p) || (p === 'spread' && f.canSpread)) clean.assignment[f.id] = p;
  }
  for (const s of ctx.sectors) {
    const r = plan?.roles?.[s.id];
    if (r && isSelectableRole(ctx, r)) clean.roles[s.id] = r;
  }
  return clean;
}

/** Assign a formation; returns a new plan. Refuses "spread" for formations that cannot spread. */
export function assign(ctx: PlanContext, plan: Plan, formationId: string, placement: Placement): Plan {
  const f = ctx.era.soviet.formations.find((x) => x.id === formationId);
  if (!f) throw new Error(`Unknown formation "${formationId}"`);
  if (placement === 'spread' && !f.canSpread) throw new Error(`${f.short} cannot be spread over sectors`);
  if (placement === 'reserve') placement = null;
  if (placement !== null && placement !== 'spread' && !ctx.sectors.some((s) => s.id === placement)) {
    throw new Error(`Unknown sector "${placement}"`);
  }
  return { ...plan, assignment: { ...plan.assignment, [formationId]: placement } };
}

/** Roles the player may choose (not game-applied ones such as exploitation). */
export function isSelectableRole(ctx: PlanContext, role: string): boolean {
  const r = ctx.era.norms.roles[role];
  return !!r && r.selectable !== false;
}

export function setRole(ctx: PlanContext, plan: Plan, sectorId: string, role: string): Plan {
  if (!isSelectableRole(ctx, role)) throw new Error(`Unknown role "${role}"`);
  if (!ctx.sectors.some((s) => s.id === sectorId)) throw new Error(`Unknown sector "${sectorId}"`);
  return { ...plan, roles: { ...plan.roles, [sectorId]: role } };
}

/** Where a Soviet unit stands under a plan: its formation's placement. */
export const sovietPlacement =
  (plan: Plan) =>
  (u: Unit): Placement =>
    plan.assignment[u.parent] ?? null;

/** Where a NATO unit stands: its own placement. */
export const natoPlacement = (u: Unit): Placement => u.placement ?? null;

/** Copies of units with readiness multiplied by k (e.g. time for battle procedure). */
export function withReadiness(units: readonly Unit[], k: number): Unit[] {
  return units.map((u) => ({ ...u, readiness: u.readiness * k }));
}

/**
 * Rate a plan: Soviet units (as they currently stand) against a set of NATO units,
 * either the intelligence estimate (during planning) or the truth (in the debrief).
 */
export function evaluatePlan(
  ctx: PlanContext,
  table: EquipmentTable,
  plan: Plan,
  forces: { soviet: readonly Unit[]; nato: readonly Unit[] },
): PlanResult {
  const sectorIds = ctx.sectors.map((s) => s.id);
  const sovPlace = sovietPlacement(plan);
  const sov = sectorPotentials(forces.soviet, sovPlace, sectorIds, table);
  const nato = sectorEstimates(forces.nato, natoPlacement, sectorIds, table);

  const sectors = ctx.sectors.map((sector): SectorResult => {
    const role = plan.roles[sector.id] ?? sector.defaultRole;
    const norms = ctx.era.norms.roles[role];
    if (!norms) throw new Error(`Unknown role "${role}"`);
    const ratios = sectorRatios(sov[sector.id]!, nato[sector.id]!);
    const assessment = assessSector(ratios, norms.required, ctx.era.norms.amberFraction);
    const formations = ctx.era.soviet.formations
      .filter((f) => {
        const p = plan.assignment[f.id];
        return p === sector.id || p === 'spread';
      })
      .map((f) => f.id);
    return {
      sector,
      role,
      formations,
      soviet: sov[sector.id]!,
      nato: nato[sector.id]!,
      ratios,
      assessment,
      verdict: worstStatus(RATIO_KEYS.map((k) => assessment[k].status)),
    };
  });

  const uncommitted = totalPotential(
    forces.soviet.filter((u) => sovPlace(u) === null),
    table,
  );
  const natoReserve = forces.nato
    .filter((u) => {
      const p = natoPlacement(u);
      return p === null || p === 'reserve';
    })
    .map((u) => estimatedUnitPotential(u, table))
    .reduce(
      (acc, e) => ({
        low: addPotential(acc.low, e.low),
        mid: addPotential(acc.mid, e.mid),
        high: addPotential(acc.high, e.high),
      }),
      zeroEstimate(),
    );

  return { sectors, uncommitted, natoReserve };
}
