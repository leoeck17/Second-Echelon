// Plan model: which Soviet formation goes to which sector, and each sector's role.
// Evaluating a plan runs the COFM core for every sector. Pure logic: no DOM access.

import {
  assessSector,
  estimatedUnitPotential,
  sectorEstimates,
  sectorPotentials,
  sectorRatios,
  totalPotential,
  worstStatus,
  addPotential,
  zeroEstimate,
  type Estimate,
  type NormStatus,
  type Potential,
  type Ratios,
  type SectorAssessment,
} from '../core/cofm';
import { RATIO_KEYS, type EquipmentTable, type EraData, type Placement, type Sector, type Unit } from '../core/data';

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
  /** NATO potential estimated outside the sectors (reserves). */
  natoReserve: Estimate;
}

/** Start of planning: nothing committed, sectors at their default roles. */
export function defaultPlan(era: EraData): Plan {
  const assignment: Record<string, Placement> = {};
  for (const f of era.soviet.formations) assignment[f.id] = null;
  const roles: Record<string, string> = {};
  for (const s of era.sectors) roles[s.id] = s.defaultRole;
  return { assignment, roles };
}

/** Repair a plan (e.g. restored from storage) so it only uses ids and roles the era knows. */
export function sanitizePlan(era: EraData, plan: Partial<Plan> | null | undefined): Plan {
  const clean = defaultPlan(era);
  const sectorIds = new Set(era.sectors.map((s) => s.id));
  for (const f of era.soviet.formations) {
    const p = plan?.assignment?.[f.id];
    if (p === null || p === undefined) continue;
    if (sectorIds.has(p) || (p === 'spread' && f.canSpread)) clean.assignment[f.id] = p;
  }
  for (const s of era.sectors) {
    const r = plan?.roles?.[s.id];
    if (r && era.norms.roles[r]) clean.roles[s.id] = r;
  }
  return clean;
}

/** Assign a formation; returns a new plan. Refuses "spread" for formations that cannot spread. */
export function assign(era: EraData, plan: Plan, formationId: string, placement: Placement): Plan {
  const f = era.soviet.formations.find((x) => x.id === formationId);
  if (!f) throw new Error(`Unknown formation "${formationId}"`);
  if (placement === 'spread' && !f.canSpread) throw new Error(`${f.short} cannot be spread over sectors`);
  if (placement === 'reserve') placement = null;
  if (placement !== null && placement !== 'spread' && !era.sectors.some((s) => s.id === placement)) {
    throw new Error(`Unknown sector "${placement}"`);
  }
  return { ...plan, assignment: { ...plan.assignment, [formationId]: placement } };
}

export function setRole(era: EraData, plan: Plan, sectorId: string, role: string): Plan {
  if (!era.norms.roles[role]) throw new Error(`Unknown role "${role}"`);
  if (!era.sectors.some((s) => s.id === sectorId)) throw new Error(`Unknown sector "${sectorId}"`);
  return { ...plan, roles: { ...plan.roles, [sectorId]: role } };
}

export function evaluatePlan(era: EraData, table: EquipmentTable, plan: Plan): PlanResult {
  const sectorIds = era.sectors.map((s) => s.id);
  const sovPlacement = (u: Unit): Placement => plan.assignment[u.parent] ?? null;
  const natoPlacement = (u: Unit): Placement => u.placement ?? null;

  const sov = sectorPotentials(era.soviet.units, sovPlacement, sectorIds, table);
  const nato = sectorEstimates(era.nato.units, natoPlacement, sectorIds, table);

  const sectors = era.sectors.map((sector): SectorResult => {
    const role = plan.roles[sector.id] ?? sector.defaultRole;
    const norms = era.norms.roles[role];
    if (!norms) throw new Error(`Unknown role "${role}"`);
    const ratios = sectorRatios(sov[sector.id]!, nato[sector.id]!);
    const assessment = assessSector(ratios, norms.required, era.norms.amberFraction);
    const formations = era.soviet.formations
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
    era.soviet.units.filter((u) => sovPlacement(u) === null),
    table,
  );
  const natoReserve = era.nato.units
    .filter((u) => natoPlacement(u) === 'reserve' || natoPlacement(u) === null)
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
