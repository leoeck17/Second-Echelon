// Who fights whom in each sector: Soviet first echelon and its fires against the NATO
// units its axes engage, plus the flank threat of units it bypasses, with terrain and tempo.
// Used both to rate a plan against the estimate and to adjudicate it against the truth.
// Pure logic: no DOM access.

import { analyseAxes, isTargetable, type AxisPlan, type Contact } from './axes';
import { addPotential, unitPotential, zeroPotential, type Potential } from './cofm';
import type { AxesParams, EquipmentTable, Placement, Sector, Unit } from './data';
import { dist, type Pt } from './geom';
import { defenceAt, routeCost, type MapData, type TerrainParams } from './terrain';

export interface SectorFight {
  sectorId: string;
  /** Soviet unit id -> weight (fires spread over sectors, tempo of the axis). */
  soviet: Record<string, number>;
  /** NATO unit id -> weight in the fight (1 engaged, 1/n spread fires). */
  nato: Record<string, number>;
  /** NATO unit id -> flank-threat weight (bypassed / encircled units). Counts toward overall only. */
  flank: Record<string, number>;
  /** NATO units engaged in this sector (they take losses here). */
  engaged: string[];
  bypassed: string[];
  encircled: string[];
  /** Potential-weighted defence multiplier of the terrain the engaged NATO units hold. */
  terrain: number;
}

export interface FightInput {
  sectors: readonly Sector[];
  map: MapData;
  terrain: TerrainParams;
  axesParams: AxesParams;
  table: EquipmentTable;
  soviet: readonly Unit[];
  /** Where a Soviet unit fights: a sector, "spread" (fires), or null (not attacking). */
  sovPlacement: (u: Unit) => Placement;
  /** Axes of the attacking manoeuvre formations. */
  axes: readonly AxisPlan[];
  nato: readonly Unit[];
  /** NATO units that engage their sector whatever the axes do (e.g. a counterattacking reserve). */
  alwaysEngaged?: ReadonlySet<string>;
}

export interface FightResult {
  sectors: Record<string, SectorFight>;
  contacts: Record<string, Contact>;
}

/** Tempo of an axis: (direct distance / terrain-weighted route cost) ^ exponent, at most 1. */
export function axisTempo(map: MapData, path: readonly Pt[], terrain: TerrainParams, exponent: number): number {
  if (path.length < 2) return 1;
  const direct = dist(path[0]!, path[path.length - 1]!);
  const cost = routeCost(map, path, terrain);
  if (direct <= 0 || cost <= 0) return 1;
  return Math.min(1, Math.pow(direct / cost, exponent));
}

export function buildFights(input: FightInput): FightResult {
  const ids = input.sectors.map((s) => s.id);
  const contacts = analyseAxes(input.axes, input.nato, input.axesParams);
  const tempoByFormation = new Map<string, number>();
  for (const a of input.axes) {
    tempoByFormation.set(a.formationId, axisTempo(input.map, a.path, input.terrain, input.axesParams.tempoExponent));
  }
  const sectors: Record<string, SectorFight> = {};
  for (const id of ids) {
    sectors[id] = { sectorId: id, soviet: {}, nato: {}, flank: {}, engaged: [], bypassed: [], encircled: [], terrain: 1 };
  }
  for (const u of input.soviet) {
    const p = input.sovPlacement(u);
    const tempo = tempoByFormation.get(u.parent) ?? 1;
    if (p === 'spread') for (const id of ids) sectors[id]!.soviet[u.id] = 1 / ids.length;
    else if (p !== null && sectors[p]) sectors[p]!.soviet[u.id] = tempo;
  }
  const flank = input.axesParams.flankWeight;
  for (const u of input.nato) {
    if (u.placement === 'spread') {
      for (const id of ids) sectors[id]!.nato[u.id] = 1 / ids.length;
      continue;
    }
    if (input.alwaysEngaged?.has(u.id) && u.placement && sectors[u.placement]) {
      const f = sectors[u.placement]!;
      f.nato[u.id] = 1;
      f.engaged.push(u.id);
      continue;
    }
    if (!isTargetable(u)) continue;
    const c = contacts[u.id];
    if (!c) continue;
    for (const s of c.engaged) {
      sectors[s]!.nato[u.id] = 1;
      sectors[s]!.engaged.push(u.id);
    }
    for (const s of c.encircled) {
      sectors[s]!.flank[u.id] = flank;
      sectors[s]!.encircled.push(u.id);
    }
    for (const s of c.bypassed) {
      if (c.encircled.includes(s)) continue;
      sectors[s]!.flank[u.id] = flank;
      sectors[s]!.bypassed.push(u.id);
    }
  }
  // Terrain: weighted by the engaged units' potential.
  const byId = new Map(input.nato.map((u) => [u.id, u]));
  for (const f of Object.values(sectors)) {
    let w = 0;
    let acc = 0;
    for (const id of f.engaged) {
      const u = byId.get(id)!;
      const pot = unitPotential(u, input.table).overall;
      if (!u.pos || pot <= 0) continue;
      w += pot;
      acc += pot * defenceAt(input.map, u.pos, input.terrain);
    }
    f.terrain = w > 0 ? acc / w : 1;
  }
  return { sectors, contacts };
}

/**
 * NATO potential in a fight: the engaged units by category, plus the flank threat of
 * bypassed units added to overall only (a threat to the attack as a whole, not a tank duel).
 */
export function natoFightPotential(units: readonly Unit[], f: SectorFight, table: EquipmentTable, scale = (u: Unit) => unitPotential(u, table)): Potential {
  let p = zeroPotential();
  let flank = 0;
  for (const u of units) {
    const w = f.nato[u.id];
    const fw = f.flank[u.id];
    if (!w && !fw) continue;
    const up = scale(u);
    if (w) p = addPotential(p, up, w);
    if (fw) flank += fw * up.overall;
  }
  return { ...p, overall: p.overall + flank };
}

/** Potential of a weighted set of units. */
export function weightedPotential(units: readonly Unit[], weights: Record<string, number>, table: EquipmentTable): Potential {
  let p = zeroPotential();
  for (const u of units) {
    const w = weights[u.id];
    if (w) p = addPotential(p, unitPotential(u, table), w);
  }
  return p;
}
