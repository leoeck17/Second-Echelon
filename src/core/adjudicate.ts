// Abstract adjudication: turns force ratios into sector outcomes and losses.
// Stands in for the M3 movement/combat simulation behind the same phase interface.
// Pure logic: no DOM access. All parameters come from the era file.

import { sectorPotentials, sectorRatios, type Potential, type Ratios } from './cofm';
import { RATIO_KEYS, type AdjudicationParams, type EquipmentTable, type Norms, type Placement, type RatioKey, type Sector, type Unit } from './data';
import { rngFor, uniform, type Rng } from './rng';

export type Outcome = 'success' | 'stalled' | 'repulsed' | 'none';

/**
 * Sector score: weighted geometric mean over categories of ratio / norm, each clamped
 * to [floor, cap]. 1.0 means "exactly at the norms". Categories with nothing on either
 * side (NaN) are left out; an empty set of categories scores the cap (unopposed).
 */
export function sectorScore(
  ratios: Ratios,
  required: Record<RatioKey, number>,
  p: Pick<AdjudicationParams, 'weights' | 'cap' | 'floor'>,
): number {
  let wsum = 0;
  let lsum = 0;
  for (const k of RATIO_KEYS) {
    const r = ratios[k].value;
    const w = p.weights[k];
    if (Number.isNaN(r) || w <= 0) continue;
    const f = required[k] > 0 ? Math.min(p.cap, Math.max(p.floor, r / required[k])) : p.cap;
    wsum += w;
    lsum += w * Math.log(f);
  }
  return wsum > 0 ? Math.exp(lsum / wsum) : p.cap;
}

export interface SectorResolution {
  epsilon: number;
  effective: number;
  outcome: Exclude<Outcome, 'none'>;
  sovLoss: number;
  natoLoss: number;
}

/** Apply chance, classify the outcome and work out the loss fraction of each side. */
export function resolveSector(score: number, role: string, rng: Rng, p: AdjudicationParams): SectorResolution {
  const epsilon = uniform(rng, p.epsilonLow, p.epsilonHigh);
  const effective = score * epsilon;
  const outcome = effective >= p.successAt ? 'success' : effective >= p.stalledAt ? 'stalled' : 'repulsed';
  const intensity = p.roleIntensity[role] ?? 1;
  const sovLoss = Math.min(p.maxLoss, (p.sovLossBase * intensity) / Math.max(effective, p.floor));
  const natoLoss = Math.min(p.maxLoss, p.natoLossBase * intensity * effective);
  return { epsilon, effective, outcome, sovLoss, natoLoss };
}

/**
 * Scale the strength of units standing in a sector by (1 - loss). Units spread over
 * all sectors (fire support), in reserve or unassigned take no losses.
 */
export function applyLosses(
  units: readonly Unit[],
  placementOf: (u: Unit) => Placement,
  lossBySector: Record<string, number>,
): Unit[] {
  return units.map((u) => {
    const p = placementOf(u);
    const loss = p !== null && p !== 'spread' && p !== 'reserve' ? lossBySector[p] ?? 0 : 0;
    return loss > 0 ? { ...u, strength: u.strength * (1 - loss) } : u;
  });
}

export interface SectorOutcome {
  sectorId: string;
  role: string;
  soviet: Potential;
  nato: Potential;
  ratios: Ratios;
  /** NaN when the sector was not attacked. */
  score: number;
  epsilon: number;
  effective: number;
  outcome: Outcome;
  sovLoss: number;
  natoLoss: number;
}

export interface PhaseInput {
  seed: number;
  phase: number;
  sectors: readonly Sector[];
  roles: Record<string, string>;
  norms: Norms;
  params: AdjudicationParams;
  table: EquipmentTable;
  soviet: readonly Unit[];
  sovPlacement: (u: Unit) => Placement;
  /** The true NATO units. */
  nato: readonly Unit[];
  natoPlacement: (u: Unit) => Placement;
}

export interface PhaseResult {
  sectors: SectorOutcome[];
  soviet: Unit[];
  nato: Unit[];
}

/** Resolve one phase of fighting in every sector. Sectors without Soviet forces see no fighting. */
export function resolvePhase(input: PhaseInput): PhaseResult {
  const ids = input.sectors.map((s) => s.id);
  const sov = sectorPotentials(input.soviet, input.sovPlacement, ids, input.table);
  const nato = sectorPotentials(input.nato, input.natoPlacement, ids, input.table);
  const sovLoss: Record<string, number> = {};
  const natoLoss: Record<string, number> = {};
  const sectors = input.sectors.map((s): SectorOutcome => {
    const role = input.roles[s.id] ?? s.defaultRole;
    const own = sov[s.id]!;
    const enemy = nato[s.id]!;
    const ratios = sectorRatios(own, { low: enemy, mid: enemy, high: enemy });
    const base = { sectorId: s.id, role, soviet: own, nato: enemy, ratios };
    if (own.overall <= 0) {
      return { ...base, score: NaN, epsilon: 1, effective: NaN, outcome: 'none', sovLoss: 0, natoLoss: 0 };
    }
    const required = input.norms.roles[role]?.required;
    if (!required) throw new Error(`Unknown role "${role}"`);
    const score = sectorScore(ratios, required, input.params);
    const r = resolveSector(score, role, rngFor(input.seed, input.phase, s.id), input.params);
    sovLoss[s.id] = r.sovLoss;
    natoLoss[s.id] = r.natoLoss;
    return { ...base, score, ...r };
  });
  return {
    sectors,
    soviet: applyLosses(input.soviet, input.sovPlacement, sovLoss),
    nato: applyLosses(input.nato, input.natoPlacement, natoLoss),
  };
}
