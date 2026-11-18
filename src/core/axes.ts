// Axes of advance: which NATO units an attack engages, bypasses or encircles.
// Pure logic: no DOM access.

import type { AxesParams, Unit } from './data';
import { crossingsAtX, distToPolyline, minX, type Pt } from './geom';

/** One manoeuvre formation's axis: the full path from its position to the end of its advance. */
export interface AxisPlan {
  formationId: string;
  sectorId: string;
  path: Pt[];
}

export interface Contact {
  /** Sectors whose axes engage the unit. */
  engaged: string[];
  /** Sectors whose axes pass the unit without engaging it. */
  bypassed: string[];
  /** Sectors whose axes pass the unit on both sides and close behind it. */
  encircled: string[];
}

const uniq = (xs: string[]) => [...new Set(xs)];

/** Can this unit be engaged by manoeuvre at all (it stands in a sector and its location is known)? */
export const isTargetable = (u: Unit): boolean =>
  !!u.pos && u.placement !== null && u.placement !== undefined && u.placement !== 'spread' && u.placement !== 'reserve';

/**
 * Contact of each targetable NATO unit with the attack's axes.
 * - engaged: an axis passes within engagementRadius;
 * - bypassed: not engaged, but an axis crosses the unit's depth within bypassRange of it;
 * - encircled: not engaged, and axes cross its depth both north and south of it (within
 *   encircleRange) and get closeDistance beyond it.
 */
export function analyseAxes(axes: readonly AxisPlan[], nato: readonly Unit[], p: AxesParams): Record<string, Contact> {
  const out: Record<string, Contact> = {};
  for (const u of nato) {
    if (!isTargetable(u)) continue;
    const pos = u.pos!;
    const engaged = axes.filter((a) => distToPolyline(pos, a.path) <= p.engagementRadius).map((a) => a.sectorId);
    if (engaged.length) {
      out[u.id] = { engaged: uniq(engaged), bypassed: [], encircled: [] };
      continue;
    }
    const bypassed: string[] = [];
    const north: string[] = [];
    const south: string[] = [];
    for (const a of axes) {
      const ys = crossingsAtX(a.path, pos.x);
      if (ys.some((y) => Math.abs(y - pos.y) <= p.bypassRange)) bypassed.push(a.sectorId);
      const beyond = minX(a.path) <= pos.x - p.closeDistance;
      if (!beyond) continue;
      if (ys.some((y) => y > pos.y && y - pos.y <= p.encircleRange)) north.push(a.sectorId);
      if (ys.some((y) => y < pos.y && pos.y - y <= p.encircleRange)) south.push(a.sectorId);
    }
    const encircled = north.length && south.length ? uniq([...north, ...south]) : [];
    if (bypassed.length || encircled.length) out[u.id] = { engaged: [], bypassed: uniq(bypassed), encircled };
  }
  return out;
}

/**
 * After a phase: units bypassed or encircled by an attack that succeeded are cut off.
 * They lose cutOffLoss (encircled: encircledLoss) of their strength.
 */
export function applyCutOff(
  nato: readonly Unit[],
  contacts: Record<string, Contact>,
  successful: ReadonlySet<string>,
  p: AxesParams,
): { nato: Unit[]; cutOff: string[]; encircled: string[] } {
  const cutOff: string[] = [];
  const encircled: string[] = [];
  const out = nato.map((u) => {
    const c = contacts[u.id];
    if (!c || c.engaged.length) return u;
    if (c.encircled.length && c.encircled.every((s) => successful.has(s))) {
      encircled.push(u.id);
      return { ...u, strength: u.strength * (1 - p.encircledLoss) };
    }
    if (c.bypassed.some((s) => successful.has(s)) || c.encircled.some((s) => successful.has(s))) {
      cutOff.push(u.id);
      return { ...u, strength: u.strength * (1 - p.cutOffLoss) };
    }
    return u;
  });
  return { nato: out, cutOff, encircled };
}
