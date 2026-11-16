// Fog of war: the intelligence estimate, recon, and readiness lost to time spent planning.
// Pure logic: no DOM access.

import type { PrepTime, ReconParams, Unit } from './data';

export type FindingKind = 'confirmed' | 'changed' | 'dummy' | 'hidden' | 'moved-here' | 'absent';

export interface ReconFinding {
  kind: FindingKind;
  sectorId: string;
  unitId: string;
  unitName: string;
}

const cloneUnit = (u: Unit): Unit => ({ ...u, equipment: { ...u.equipment }, intel: u.intel && { ...u.intel } });

/** Same authorised equipment. Strength is ignored: battle losses are not an intelligence error. */
function sameEquipment(a: Unit, b: Unit): boolean {
  const keys = new Set([...Object.keys(a.equipment), ...Object.keys(b.equipment)]);
  for (const k of keys) if ((a.equipment[k] ?? 0) !== (b.equipment[k] ?? 0)) return false;
  return true;
}

/**
 * Recon (or contact) in one sector replaces the estimate there with the truth:
 * - units really there become "confirmed" with the residual intel range;
 * - estimated units with no true counterpart are dummies and disappear;
 * - estimated units that are really elsewhere lose their location ("absent");
 * - true units nobody reported appear ("hidden"), and units reported elsewhere are found ("moved-here").
 * Units outside the sector, including spread and reserve units, are untouched.
 */
export function reconSector(
  estimate: readonly Unit[],
  truth: readonly Unit[],
  sectorId: string,
  params: Pick<ReconParams, 'residualLow' | 'residualHigh'>,
): { estimate: Unit[]; findings: ReconFinding[] } {
  const truthById = new Map(truth.map((t) => [t.id, t]));
  const estById = new Map(estimate.map((e) => [e.id, e]));
  const here = truth.filter((t) => t.placement === sectorId);
  const hereIds = new Set(here.map((t) => t.id));
  const out: Unit[] = [];
  const findings: ReconFinding[] = [];
  const note = (kind: FindingKind, u: Unit) => findings.push({ kind, sectorId, unitId: u.id, unitName: u.name });

  for (const e of estimate) {
    if (hereIds.has(e.id)) continue; // replaced by the confirmed true unit below
    if (e.placement !== sectorId) {
      out.push(e);
      continue;
    }
    if (!truthById.has(e.id)) {
      note('dummy', e);
      continue;
    }
    note('absent', e);
    out.push({ ...cloneUnit(e), placement: null, intel: { status: 'unknown', low: e.intel?.low ?? 1, high: e.intel?.high ?? 1 } });
  }
  for (const t of here) {
    const e = estById.get(t.id);
    const confirmed: Unit = {
      ...cloneUnit(t),
      intel: { status: 'confirmed', low: params.residualLow, high: params.residualHigh },
    };
    out.push(confirmed);
    if (!e) note('hidden', t);
    else if (e.placement !== sectorId) note('moved-here', t);
    else if (!sameEquipment(e, t)) note('changed', t);
    else note('confirmed', t);
  }
  return { estimate: out, findings };
}

/** Readiness multiplier for the hours left before H-hour: the row with the largest hoursLeft not above it. */
export function readinessFromPrepTime(hoursLeft: number, prep: PrepTime): number {
  const rows = [...prep.table].sort((a, b) => b.hoursLeft - a.hoursLeft);
  for (const r of rows) if (hoursLeft >= r.hoursLeft) return r.readiness;
  return rows[rows.length - 1]?.readiness ?? 1;
}
