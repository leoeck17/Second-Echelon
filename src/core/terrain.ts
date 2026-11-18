// The map: terrain polygons, roads, rivers and places as GeoJSON in local metres
// (origin bottom-left, x east, y north). Pure logic: no DOM access.

import { distToPolyline, pointInRing, sampleAlong, dist, type Pt } from './geom';

export const TERRAIN_KINDS = ['open', 'forest', 'town', 'water', 'marsh', 'ridge'] as const;
export type TerrainKind = (typeof TERRAIN_KINDS)[number];
export const AREA_KINDS: readonly TerrainKind[] = ['forest', 'town', 'water', 'marsh', 'ridge'];
export const LINE_KINDS = ['road', 'river', 'ridgeline'] as const;
export const POINT_KINDS = ['crossing', 'place'] as const;

type Coord = [number, number];

export interface MapFeature {
  type: 'Feature';
  properties: { kind: string; name?: string };
  geometry:
    | { type: 'Polygon'; coordinates: Coord[][] }
    | { type: 'LineString'; coordinates: Coord[] }
    | { type: 'Point'; coordinates: Coord };
}

export interface MapData {
  type: 'FeatureCollection';
  id: string;
  name: string;
  /** Size in metres. */
  width: number;
  height: number;
  /** Optional decorative background image covering the whole map. */
  background?: { image: string };
  features: MapFeature[];
}

export interface TerrainParams {
  /** Multiplier on the defender's potential by the terrain it holds. */
  defence: Record<TerrainKind, number>;
  /** Cost of moving a metre through each terrain (open = 1). */
  movement: Record<TerrainKind, number>;
  /** Cost on a road, and how close counts as on it (m). */
  roadMovement: number;
  roadWidth: number;
  /** A river can be crossed without penalty this close to a crossing point (m). */
  crossingRadius: number;
  /** Extra cost for crossing a river away from a crossing point. */
  riverPenalty: number;
}

const toPt = (c: Coord): Pt => ({ x: c[0], y: c[1] });

/** Pre-processed map for fast lookups. */
export interface TerrainIndex {
  map: MapData;
  areas: { kind: TerrainKind; ring: Pt[] }[];
  roads: Pt[][];
  rivers: Pt[][];
  crossings: Pt[];
}

const cache = new WeakMap<MapData, TerrainIndex>();

export function indexMap(map: MapData): TerrainIndex {
  const hit = cache.get(map);
  if (hit) return hit;
  const idx: TerrainIndex = { map, areas: [], roads: [], rivers: [], crossings: [] };
  for (const f of map.features) {
    const g = f.geometry;
    if (g.type === 'Polygon' && (AREA_KINDS as readonly string[]).includes(f.properties.kind)) {
      idx.areas.push({ kind: f.properties.kind as TerrainKind, ring: g.coordinates[0]!.map(toPt) });
    } else if (g.type === 'LineString' && f.properties.kind === 'road') idx.roads.push(g.coordinates.map(toPt));
    else if (g.type === 'LineString' && f.properties.kind === 'river') idx.rivers.push(g.coordinates.map(toPt));
    else if (g.type === 'Point' && f.properties.kind === 'crossing') idx.crossings.push(toPt(g.coordinates));
  }
  cache.set(map, idx);
  return idx;
}

/** Terrain at a point: the last area polygon containing it (later features draw on top), else open. */
export function terrainAt(map: MapData, p: Pt): TerrainKind {
  const idx = indexMap(map);
  let kind: TerrainKind = 'open';
  for (const a of idx.areas) if (pointInRing(p, a.ring)) kind = a.kind;
  return kind;
}

export function defenceAt(map: MapData, p: Pt, params: TerrainParams): number {
  return params.defence[terrainAt(map, p)];
}

/**
 * Movement cost of a route: metres weighted by terrain, with roads cheaper and
 * river crossings away from a crossing point penalised. Sampled every 100 m.
 */
export function routeCost(map: MapData, route: readonly Pt[], params: TerrainParams): number {
  const idx = indexMap(map);
  const step = 100;
  const pts = sampleAlong(route, step);
  let cost = 0;
  let wasNearRiver = false;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const len = dist(a, b);
    const onRoad = idx.roads.some((r) => distToPolyline(mid, r) <= params.roadWidth);
    cost += len * (onRoad ? params.roadMovement : params.movement[terrainAt(map, mid)]);
    const nearRiver = idx.rivers.some((r) => distToPolyline(mid, r) <= step / 2);
    if (nearRiver && !wasNearRiver) {
      const atCrossing = idx.crossings.some((c) => dist(c, mid) <= params.crossingRadius);
      if (!atCrossing) cost += params.riverPenalty;
    }
    wasNearRiver = nearRiver;
  }
  return cost;
}

/** Returns a list of problems with a map; empty when valid. */
export function validateMap(map: MapData): string[] {
  const errors: string[] = [];
  const at = (m: string) => `map ${map.id}: ${m}`;
  if (!(map.width > 0 && map.height > 0)) errors.push(at('width and height must be positive'));
  const inBounds = (c: Coord) => c[0] >= 0 && c[0] <= map.width && c[1] >= 0 && c[1] <= map.height;
  map.features.forEach((f, i) => {
    const g = f.geometry;
    const k = f.properties?.kind;
    const where = `feature ${i} (${k})`;
    if (g.type === 'Polygon') {
      if (!(AREA_KINDS as readonly string[]).includes(k)) errors.push(at(`${where}: unknown area kind`));
      const ring = g.coordinates[0] ?? [];
      if (ring.length < 3) errors.push(at(`${where}: polygon needs at least 3 points`));
      if (!ring.every(inBounds)) errors.push(at(`${where}: outside the map`));
    } else if (g.type === 'LineString') {
      if (!(LINE_KINDS as readonly string[]).includes(k)) errors.push(at(`${where}: unknown line kind`));
      if (g.coordinates.length < 2) errors.push(at(`${where}: line needs at least 2 points`));
      if (!g.coordinates.every(inBounds)) errors.push(at(`${where}: outside the map`));
    } else if (g.type === 'Point') {
      if (!(POINT_KINDS as readonly string[]).includes(k)) errors.push(at(`${where}: unknown point kind`));
      if (!inBounds(g.coordinates)) errors.push(at(`${where}: outside the map`));
    } else {
      errors.push(at(`${where}: unsupported geometry`));
    }
  });
  return errors;
}
