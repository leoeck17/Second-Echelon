// Data model for equipment, units and era files, plus validation.
// Pure logic: no DOM access.

/** COFM categories an equipment type can belong to. "other" counts toward overall only. */
export const CATEGORIES = ['tanks', 'antitank', 'artillery', 'infantry', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Keys for which a ratio is computed and compared with a norm. */
export const RATIO_KEYS = ['tanks', 'antitank', 'artillery', 'infantry', 'overall'] as const;
export type RatioKey = (typeof RATIO_KEYS)[number];

export type Basis = 'source' | 'game-tuned';

export interface EquipmentType {
  name: string;
  type: string;
  category: Category;
  /** Coefficient of commensurability, T-55 = 1.0. */
  cp: number;
  era: string[];
  basis: Basis;
  ref?: string;
}

export type EquipmentTable = Record<string, EquipmentType>;

export type Side = 'SOV' | 'NATO';

export type IntelStatus = 'confirmed' | 'suspected' | 'unknown';

/** Intelligence estimate of a unit's potential, as multipliers of its nominal potential. */
export interface IntelEstimate {
  status: IntelStatus;
  low: number;
  high: number;
}

/**
 * Where a unit's potential counts:
 * - a sector id: fully in that sector
 * - "spread": divided evenly over all sectors (e.g. artillery on general support)
 * - "reserve": not counted in any sector
 * - null: unassigned, not counted
 */
export type Placement = string | 'spread' | 'reserve' | null;

export interface Unit {
  id: string;
  side: Side;
  name: string;
  parent: string;
  equipment: Record<string, number>;
  /** k_strength, 0..1: fraction of authorised strength still present. */
  strength: number;
  /** k_readiness, 0..1: training, fatigue, preparation. */
  readiness: number;
  placement?: Placement;
  intel?: IntelEstimate;
  note?: string;
}

export interface Formation {
  id: string;
  name: string;
  short: string;
  kind: string;
  canSpread: boolean;
}

export interface Force {
  name: string;
  formations: Formation[];
  units: Unit[];
}

export interface RoleNorms {
  label: string;
  required: Record<RatioKey, number>;
  basis?: Partial<Record<RatioKey, string>>;
}

export interface Norms {
  /** A ratio at or above amberFraction x required (but below required) is amber. */
  amberFraction: number;
  roles: Record<string, RoleNorms>;
}

export interface Sector {
  id: string;
  name: string;
  widthKm: number;
  defaultRole: string;
}

export interface EraData {
  era: string;
  name: string;
  scenario: { title: string; brief: string };
  norms: Norms;
  sectors: Sector[];
  soviet: Force;
  nato: Force;
}

const isFiniteNonNeg = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/** Returns a list of problems with the equipment table; empty when valid. */
export function validateEquipment(table: EquipmentTable): string[] {
  const errors: string[] = [];
  for (const [key, eq] of Object.entries(table)) {
    if (!CATEGORIES.includes(eq.category)) errors.push(`equipment ${key}: unknown category "${eq.category}"`);
    if (!isFiniteNonNeg(eq.cp)) errors.push(`equipment ${key}: cp must be a non-negative number`);
    if (eq.basis !== 'source' && eq.basis !== 'game-tuned') errors.push(`equipment ${key}: basis must be "source" or "game-tuned"`);
    if (!Array.isArray(eq.era) || eq.era.length === 0) errors.push(`equipment ${key}: era list is empty`);
  }
  return errors;
}

/** Returns a list of problems with an era file against an equipment table; empty when valid. */
export function validateEra(era: EraData, table: EquipmentTable): string[] {
  const errors: string[] = [];
  const sectorIds = new Set(era.sectors.map((s) => s.id));
  if (sectorIds.size !== era.sectors.length) errors.push('duplicate sector ids');
  for (const s of era.sectors) {
    if (s.id === 'spread' || s.id === 'reserve') errors.push(`sector id "${s.id}" is reserved`);
    if (!era.norms.roles[s.defaultRole]) errors.push(`sector ${s.id}: unknown default role "${s.defaultRole}"`);
    if (!(s.widthKm > 0)) errors.push(`sector ${s.id}: widthKm must be positive`);
  }
  if (!(era.norms.amberFraction > 0 && era.norms.amberFraction <= 1)) errors.push('norms.amberFraction must be in (0, 1]');
  for (const [role, norms] of Object.entries(era.norms.roles)) {
    for (const k of RATIO_KEYS) {
      if (!isFiniteNonNeg(norms.required[k])) errors.push(`norm ${role}.${k}: missing or invalid`);
    }
  }

  const ids = new Set<string>();
  const checkForce = (force: Force, side: Side) => {
    const formationIds = new Set(force.formations.map((f) => f.id));
    for (const u of force.units) {
      const where = `${side} unit ${u.id}`;
      if (ids.has(u.id)) errors.push(`${where}: duplicate id`);
      ids.add(u.id);
      if (u.side !== side) errors.push(`${where}: side is "${u.side}", expected "${side}"`);
      if (!formationIds.has(u.parent)) errors.push(`${where}: unknown parent "${u.parent}"`);
      if (!(u.strength >= 0 && u.strength <= 1)) errors.push(`${where}: strength must be in [0, 1]`);
      if (!(u.readiness >= 0 && u.readiness <= 1)) errors.push(`${where}: readiness must be in [0, 1]`);
      for (const [eq, n] of Object.entries(u.equipment)) {
        const type = table[eq];
        if (!type) errors.push(`${where}: unknown equipment "${eq}"`);
        else if (!type.era.includes(era.era)) errors.push(`${where}: ${eq} is not available in ${era.era}`);
        if (!isFiniteNonNeg(n)) errors.push(`${where}: count of ${eq} must be a non-negative number`);
      }
      if (u.intel && !(u.intel.low >= 0 && u.intel.low <= 1 && u.intel.high >= 1)) {
        errors.push(`${where}: intel range must satisfy 0 <= low <= 1 <= high`);
      }
      if (side === 'NATO') {
        const p = u.placement;
        if (p === undefined) errors.push(`${where}: NATO units need a placement`);
        else if (p !== null && p !== 'spread' && p !== 'reserve' && !sectorIds.has(p)) {
          errors.push(`${where}: unknown placement "${p}"`);
        }
      }
    }
  };
  checkForce(era.soviet, 'SOV');
  checkForce(era.nato, 'NATO');
  return errors;
}
