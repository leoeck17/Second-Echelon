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
  /** false: applied by the game (e.g. exploitation), not chosen by the player. */
  selectable?: boolean;
  note?: string;
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

/** Planning hours left at H-hour -> readiness multiplier for the whole regiment. */
export interface PrepTime {
  table: { hoursLeft: number; readiness: number }[];
}

export interface ReconParams {
  hoursPerSector: number;
  /** Intel range of a unit confirmed by recon or contact. */
  residualLow: number;
  residualHigh: number;
}

export interface AdjudicationParams {
  /** Weights of each ratio in the sector score (geometric mean); need not sum to 1. */
  weights: Record<RatioKey, number>;
  /** Upper cap on ratio / norm per category, so an unopposed category can't dominate. */
  cap: number;
  /** Lower floor on ratio / norm per category, so one empty category doesn't zero the score. */
  floor: number;
  epsilonLow: number;
  epsilonHigh: number;
  /** Effective score at or above which a sector attack succeeds. */
  successAt: number;
  /** Effective score at or above which it stalls (below: repulsed). */
  stalledAt: number;
  /** Soviet loss fraction in a sector = sovLossBase x intensity / score. */
  sovLossBase: number;
  /** NATO loss fraction in a sector = natoLossBase x intensity x score. */
  natoLossBase: number;
  maxLoss: number;
  /** Loss multiplier per sector role (a holding attack is less intense). */
  roleIntensity: Record<string, number>;
  /** Regiment losses (fraction of starting potential) above which it is no longer combat-capable. */
  lossLimit: number;
  /** Role whose norms apply in phase 2 to a sector broken through in phase 1. */
  exploitRole: string;
  /** Share of the regiment's starting potential that must stand in a won sector to take the objective. */
  exploitMinShare: number;
}

export interface EraData {
  era: string;
  name: string;
  norms: Norms;
  prepTime: PrepTime;
  recon: ReconParams;
  adjudication: AdjudicationParams;
  soviet: Force;
}

export interface NatoReaction {
  /** True NATO units (placement "reserve") that move after phase 1. */
  units: string[];
  rule: 'most-threatened';
  text: string;
}

export interface SchoolSolution {
  recon: string[];
  plan: { assignment: Record<string, Placement>; roles: Record<string, string> };
  decision: Record<string, Placement>;
  text: string;
}

export interface Scenario {
  id: string;
  era: string;
  title: string;
  brief: string;
  seed: number;
  planningHours: number;
  timeLimitSec?: { planning?: number; decision?: number };
  sectors: Sector[];
  nato: {
    name: string;
    formations: Formation[];
    /** The intelligence picture the player starts with. */
    estimate: Unit[];
    /** What is really there. Estimate units without a counterpart here are dummies. */
    truth: Unit[];
  };
  natoReaction: NatoReaction;
  schoolSolution: SchoolSolution;
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

/**
 * Check the units of one force. sectorIds is the set of valid sector placements
 * (null = placements are not checked, e.g. for the Soviet side).
 */
function checkUnits(
  units: Unit[],
  formations: Formation[],
  side: Side,
  label: string,
  era: string,
  table: EquipmentTable,
  sectorIds: Set<string> | null,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const formationIds = new Set(formations.map((f) => f.id));
  for (const u of units) {
    const where = `${label} unit ${u.id}`;
    if (ids.has(u.id)) errors.push(`${where}: duplicate id`);
    ids.add(u.id);
    if (u.side !== side) errors.push(`${where}: side is "${u.side}", expected "${side}"`);
    if (!formationIds.has(u.parent)) errors.push(`${where}: unknown parent "${u.parent}"`);
    if (!(u.strength >= 0 && u.strength <= 1)) errors.push(`${where}: strength must be in [0, 1]`);
    if (!(u.readiness >= 0 && u.readiness <= 1)) errors.push(`${where}: readiness must be in [0, 1]`);
    for (const [eq, n] of Object.entries(u.equipment)) {
      const type = table[eq];
      if (!type) errors.push(`${where}: unknown equipment "${eq}"`);
      else if (!type.era.includes(era)) errors.push(`${where}: ${eq} is not available in ${era}`);
      if (!isFiniteNonNeg(n)) errors.push(`${where}: count of ${eq} must be a non-negative number`);
    }
    if (u.intel && !(u.intel.low >= 0 && u.intel.low <= 1 && u.intel.high >= 1)) {
      errors.push(`${where}: intel range must satisfy 0 <= low <= 1 <= high`);
    }
    if (sectorIds) {
      const p = u.placement;
      if (p === undefined) errors.push(`${where}: needs a placement`);
      else if (p !== null && p !== 'spread' && p !== 'reserve' && !sectorIds.has(p)) {
        errors.push(`${where}: unknown placement "${p}"`);
      }
    }
  }
  return errors;
}

/** Returns a list of problems with an era file against an equipment table; empty when valid. */
export function validateEra(era: EraData, table: EquipmentTable): string[] {
  const errors: string[] = [];
  if (!(era.norms.amberFraction > 0 && era.norms.amberFraction <= 1)) errors.push('norms.amberFraction must be in (0, 1]');
  for (const [role, norms] of Object.entries(era.norms.roles)) {
    for (const k of RATIO_KEYS) {
      if (!isFiniteNonNeg(norms.required[k])) errors.push(`norm ${role}.${k}: missing or invalid`);
    }
  }
  const prep = era.prepTime?.table ?? [];
  if (prep.length === 0) errors.push('prepTime.table is empty');
  if (!prep.some((r) => r.hoursLeft === 0)) errors.push('prepTime.table needs a row for 0 hours left');
  for (const r of prep) {
    if (!isFiniteNonNeg(r.hoursLeft) || !(r.readiness > 0 && r.readiness <= 1)) errors.push('prepTime.table: invalid row');
  }
  const rc = era.recon;
  if (!rc || !(rc.hoursPerSector > 0) || !(rc.residualLow <= 1 && rc.residualHigh >= 1)) errors.push('recon parameters invalid');
  const a = era.adjudication;
  if (!a) {
    errors.push('adjudication parameters missing');
  } else {
    for (const k of RATIO_KEYS) if (!isFiniteNonNeg(a.weights?.[k])) errors.push(`adjudication.weights.${k}: missing or invalid`);
    if (!(a.cap >= 1 && a.floor > 0 && a.floor <= 1)) errors.push('adjudication cap/floor invalid');
    if (!(a.epsilonLow > 0 && a.epsilonLow <= a.epsilonHigh)) errors.push('adjudication epsilon range invalid');
    if (!(a.stalledAt > 0 && a.stalledAt <= a.successAt)) errors.push('adjudication thresholds invalid');
    if (!(a.maxLoss > 0 && a.maxLoss <= 1)) errors.push('adjudication.maxLoss must be in (0, 1]');
    if (!(a.lossLimit > 0 && a.lossLimit < 1)) errors.push('adjudication.lossLimit must be in (0, 1)');
    for (const role of Object.keys(era.norms.roles)) {
      if (!isFiniteNonNeg(a.roleIntensity?.[role])) errors.push(`adjudication.roleIntensity.${role}: missing`);
    }
    if (!era.norms.roles[a.exploitRole]) errors.push(`adjudication.exploitRole: unknown role "${a.exploitRole}"`);
    if (!(a.exploitMinShare >= 0 && a.exploitMinShare < 1)) errors.push('adjudication.exploitMinShare must be in [0, 1)');
  }
  errors.push(...checkUnits(era.soviet.units, era.soviet.formations, 'SOV', 'SOV', era.era, table, null));
  return errors;
}

/** Returns a list of problems with a scenario against its era and the equipment table; empty when valid. */
export function validateScenario(sc: Scenario, era: EraData, table: EquipmentTable): string[] {
  const errors: string[] = [];
  const at = (msg: string) => `${sc.id}: ${msg}`;
  if (sc.era !== era.era) errors.push(at(`era "${sc.era}" does not match "${era.era}"`));
  if (!Number.isInteger(sc.seed)) errors.push(at('seed must be an integer'));
  if (!isFiniteNonNeg(sc.planningHours)) errors.push(at('planningHours invalid'));
  const sectorIds = new Set(sc.sectors.map((s) => s.id));
  if (sectorIds.size !== sc.sectors.length) errors.push(at('duplicate sector ids'));
  for (const s of sc.sectors) {
    if (s.id === 'spread' || s.id === 'reserve') errors.push(at(`sector id "${s.id}" is reserved`));
    const role = era.norms.roles[s.defaultRole];
    if (!role || role.selectable === false) errors.push(at(`sector ${s.id}: unknown default role "${s.defaultRole}"`));
    if (!(s.widthKm > 0)) errors.push(at(`sector ${s.id}: widthKm must be positive`));
  }
  const f = sc.nato.formations;
  errors.push(...checkUnits(sc.nato.estimate, f, 'NATO', `${sc.id} estimate`, era.era, table, sectorIds));
  errors.push(...checkUnits(sc.nato.truth, f, 'NATO', `${sc.id} truth`, era.era, table, sectorIds));
  for (const id of sc.natoReaction.units) {
    const u = sc.nato.truth.find((x) => x.id === id);
    if (!u) errors.push(at(`reaction unit "${id}" is not in the truth`));
    else if (u.placement !== 'reserve') errors.push(at(`reaction unit "${id}" must be placed in reserve`));
  }
  const school = sc.schoolSolution;
  const sovIds = new Set(era.soviet.formations.map((x) => x.id));
  for (const s of school.recon) if (!sectorIds.has(s)) errors.push(at(`school recon: unknown sector "${s}"`));
  for (const [fid, p] of [...Object.entries(school.plan.assignment), ...Object.entries(school.decision)]) {
    if (!sovIds.has(fid)) errors.push(at(`school solution: unknown formation "${fid}"`));
    if (p !== null && p !== 'spread' && !sectorIds.has(p)) errors.push(at(`school solution: unknown placement "${p}"`));
  }
  for (const [sid, r] of Object.entries(school.plan.roles)) {
    if (!sectorIds.has(sid) || !era.norms.roles[r] || era.norms.roles[r]!.selectable === false) {
      errors.push(at(`school solution: bad role ${sid}=${r}`));
    }
  }
  if (school.recon.length * era.recon.hoursPerSector > sc.planningHours) errors.push(at('school recon exceeds planning hours'));
  return errors;
}
