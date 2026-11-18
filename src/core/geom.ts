// Plane geometry in metres (x east, y north). Pure logic: no DOM access.

export interface Pt {
  x: number;
  y: number;
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance from p to the segment ab. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Distance from p to a polyline (a single point counts as a degenerate line). */
export function distToPolyline(p: Pt, line: readonly Pt[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return dist(p, line[0]!);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, distToSegment(p, line[i - 1]!, line[i]!));
  return best;
}

export function polylineLength(line: readonly Pt[]): number {
  let len = 0;
  for (let i = 1; i < line.length; i++) len += dist(line[i - 1]!, line[i]!);
  return len;
}

/** Ray-casting point-in-polygon test for a single ring (closed or open). */
export function pointInRing(p: Pt, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Points every `step` metres along a polyline, including both ends. */
export function sampleAlong(line: readonly Pt[], step: number): Pt[] {
  if (line.length === 0) return [];
  const out: Pt[] = [line[0]!];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/**
 * Where a polyline crosses the vertical line x = x0: the y values of all crossings,
 * found segment by segment.
 */
export function crossingsAtX(line: readonly Pt[], x0: number): number[] {
  const ys: number[] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    if ((a.x - x0) * (b.x - x0) > 0 || a.x === b.x) continue;
    const t = (x0 - a.x) / (b.x - a.x);
    ys.push(a.y + t * (b.y - a.y));
  }
  return ys;
}

export function minX(line: readonly Pt[]): number {
  return Math.min(...line.map((p) => p.x));
}
