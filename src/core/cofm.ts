// Correlation of forces and means (COFM).
//
//   P_unit   = k_strength * k_readiness * sum_i n_i * c_i      (per category)
//   COFM_sec = sum P_Soviet / sum P^_NATO                       (per category and overall)
//
// Pure logic: no DOM access. All coefficients and norms come from data files.

import {
  CATEGORIES,
  RATIO_KEYS,
  type Category,
  type EquipmentTable,
  type Placement,
  type RatioKey,
  type Unit,
} from './data';

/** Potential per category, plus the overall sum of all categories. */
export type Potential = Record<Category | 'overall', number>;

/** An estimated potential: point value (mid) with a low–high range. */
export interface Estimate {
  low: Potential;
  mid: Potential;
  high: Potential;
}

/** A force ratio with the range implied by the estimate of the enemy. */
export interface RatioValue {
  /** Soviet / NATO point estimate. */
  value: number;
  /** Pessimistic: Soviet / NATO high estimate. */
  low: number;
  /** Optimistic: Soviet / NATO low estimate. */
  high: number;
}

export type Ratios = Record<RatioKey, RatioValue>;

export type NormStatus = 'green' | 'amber' | 'red' | 'none';

export interface CategoryAssessment {
  ratio: RatioValue;
  required: number;
  /** Status of the point estimate against the norm. */
  status: NormStatus;
  /** Status if the enemy turns out to be at the high end of the estimate. */
  pessimistic: NormStatus;
}

export type SectorAssessment = Record<RatioKey, CategoryAssessment>;

/** Tolerance for comparing ratios with norms, so 2.9999999 still meets 3:1. */
const EPS = 1e-9;

export function zeroPotential(): Potential {
  return { tanks: 0, antitank: 0, artillery: 0, infantry: 0, other: 0, overall: 0 };
}

/** a + weight * b, as a new object. */
export function addPotential(a: Potential, b: Potential, weight = 1): Potential {
  const out = zeroPotential();
  for (const k of [...CATEGORIES, 'overall'] as const) out[k] = a[k] + weight * b[k];
  return out;
}

export function scalePotential(p: Potential, factor: number): Potential {
  return addPotential(zeroPotential(), p, factor);
}

/**
 * Combat potential of one unit: k_strength * k_readiness * sum(n_i * c_i), split by
 * the category of each equipment type. Throws on unknown equipment so data errors
 * surface instead of silently scoring zero.
 */
export function unitPotential(unit: Unit, table: EquipmentTable): Potential {
  const p = zeroPotential();
  const k = unit.strength * unit.readiness;
  for (const [key, n] of Object.entries(unit.equipment)) {
    const eq = table[key];
    if (!eq) throw new Error(`Unit ${unit.id}: unknown equipment "${key}"`);
    const v = k * n * eq.cp;
    p[eq.category] += v;
    p.overall += v;
  }
  return p;
}

/** Sum of the potentials of a list of units. */
export function totalPotential(units: readonly Unit[], table: EquipmentTable): Potential {
  return units.reduce((acc, u) => addPotential(acc, unitPotential(u, table)), zeroPotential());
}

/**
 * Fraction of a unit's potential that counts in each sector, given its placement.
 * A sector id puts all of it there; "spread" divides it evenly; anything else
 * (reserve, unassigned, unknown sector) puts it nowhere.
 */
export function placementWeights(placement: Placement, sectorIds: readonly string[]): Record<string, number> {
  const w: Record<string, number> = {};
  for (const id of sectorIds) w[id] = 0;
  if (placement === 'spread') {
    for (const id of sectorIds) w[id] = 1 / sectorIds.length;
  } else if (placement !== null && placement in w) {
    w[placement] = 1;
  }
  return w;
}

/** Potential per sector for a set of units, where placementOf says where each unit stands. */
export function sectorPotentials(
  units: readonly Unit[],
  placementOf: (u: Unit) => Placement,
  sectorIds: readonly string[],
  table: EquipmentTable,
): Record<string, Potential> {
  const out: Record<string, Potential> = {};
  for (const id of sectorIds) out[id] = zeroPotential();
  for (const u of units) {
    const w = placementWeights(placementOf(u), sectorIds);
    const p = unitPotential(u, table);
    for (const id of sectorIds) {
      const wi = w[id] ?? 0;
      if (wi > 0) out[id] = addPotential(out[id]!, p, wi);
    }
  }
  return out;
}

/** Estimated potential of a unit: nominal potential scaled by its intel range (1/1 if none). */
export function estimatedUnitPotential(unit: Unit, table: EquipmentTable): Estimate {
  const mid = unitPotential(unit, table);
  const low = unit.intel?.low ?? 1;
  const high = unit.intel?.high ?? 1;
  return { low: scalePotential(mid, low), mid, high: scalePotential(mid, high) };
}

export function zeroEstimate(): Estimate {
  return { low: zeroPotential(), mid: zeroPotential(), high: zeroPotential() };
}

/** Estimated potential per sector (low, mid, high), for the enemy side. */
export function sectorEstimates(
  units: readonly Unit[],
  placementOf: (u: Unit) => Placement,
  sectorIds: readonly string[],
  table: EquipmentTable,
): Record<string, Estimate> {
  const out: Record<string, Estimate> = {};
  for (const id of sectorIds) out[id] = zeroEstimate();
  for (const u of units) {
    const w = placementWeights(placementOf(u), sectorIds);
    const e = estimatedUnitPotential(u, table);
    for (const id of sectorIds) {
      const wi = w[id] ?? 0;
      if (wi <= 0) continue;
      const cur = out[id]!;
      out[id] = {
        low: addPotential(cur.low, e.low, wi),
        mid: addPotential(cur.mid, e.mid, wi),
        high: addPotential(cur.high, e.high, wi),
      };
    }
  }
  return out;
}

/**
 * own / enemy. Edge cases: x / 0 = Infinity for x > 0 (unopposed),
 * 0 / 0 = NaN (nothing on either side: no ratio).
 */
export function ratio(own: number, enemy: number): number {
  if (enemy <= 0) return own > 0 ? Infinity : NaN;
  return own / enemy;
}

/** Ratios per category and overall for one sector. */
export function sectorRatios(own: Potential, enemy: Estimate): Ratios {
  const out = {} as Ratios;
  for (const k of RATIO_KEYS) {
    out[k] = {
      value: ratio(own[k], enemy.mid[k]),
      low: ratio(own[k], enemy.high[k]),
      high: ratio(own[k], enemy.low[k]),
    };
  }
  return out;
}

/**
 * Colour a ratio against a norm: green at or above the norm, amber at or above
 * amberFraction of it, red below. NaN (nothing on either side) gives "none".
 */
export function compareWithNorm(r: number, required: number, amberFraction: number): NormStatus {
  if (Number.isNaN(r)) return 'none';
  if (r + EPS >= required) return 'green';
  if (r + EPS >= required * amberFraction) return 'amber';
  return 'red';
}

/** Compare each ratio of a sector with the norms for that sector's role. */
export function assessSector(
  ratios: Ratios,
  required: Record<RatioKey, number>,
  amberFraction: number,
): SectorAssessment {
  const out = {} as SectorAssessment;
  for (const k of RATIO_KEYS) {
    const r = ratios[k];
    out[k] = {
      ratio: r,
      required: required[k],
      status: compareWithNorm(r.value, required[k], amberFraction),
      pessimistic: compareWithNorm(r.low, required[k], amberFraction),
    };
  }
  return out;
}

const SEVERITY: Record<NormStatus, number> = { none: 0, green: 1, amber: 2, red: 3 };

/** The worst of a set of statuses; "none" only if every status is "none". */
export function worstStatus(statuses: Iterable<NormStatus>): NormStatus {
  let worst: NormStatus = 'none';
  for (const s of statuses) if (SEVERITY[s] > SEVERITY[worst]) worst = s;
  return worst;
}
