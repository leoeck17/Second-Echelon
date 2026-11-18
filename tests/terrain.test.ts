import { describe, expect, it } from 'vitest';
import { defenceAt, routeCost, terrainAt, validateMap, type MapData } from '../src/core/terrain';
import { era, maps } from './fixtures';

const map = maps['central-01']!;
const t = era.terrain;

describe('terrain', () => {
  it('the shipped map is valid', () => {
    expect(validateMap(map)).toEqual([]);
  });

  it('looks up terrain by point', () => {
    expect(terrainAt(map, { x: 12000, y: 7500 })).toBe('town'); // Altdorf
    expect(terrainAt(map, { x: 12000, y: 11500 })).toBe('forest'); // Hoher Wald
    expect(terrainAt(map, { x: 10200, y: 4000 })).toBe('ridge');
    expect(terrainAt(map, { x: 14000, y: 5000 })).toBe('open');
    expect(defenceAt(map, { x: 12000, y: 7500 }, t)).toBe(t.defence.town);
  });

  it('prices routes: roads are cheap, forest dear, rivers away from a crossing very dear', () => {
    const open = routeCost(map, [{ x: 15000, y: 5000 }, { x: 14000, y: 5000 }], t);
    expect(open).toBeCloseTo(1000, -1);
    const road = routeCost(map, [{ x: 18000, y: 7500 }, { x: 17000, y: 7500 }], t);
    expect(road).toBeLessThan(open);
    const forest = routeCost(map, [{ x: 13000, y: 11500 }, { x: 12000, y: 11500 }], t);
    expect(forest).toBeGreaterThan(open * 1.5);
    const bridge = routeCost(map, [{ x: 7600, y: 7500 }, { x: 6600, y: 7500 }], t);
    const wade = routeCost(map, [{ x: 7500, y: 10500 }, { x: 6500, y: 10500 }], t);
    expect(wade - bridge).toBeGreaterThan(t.riverPenalty * 0.9);
  });

  it('validation catches unknown kinds and features off the map', () => {
    const bad: MapData = {
      ...map,
      features: [
        { type: 'Feature', properties: { kind: 'lava' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
        { type: 'Feature', properties: { kind: 'road' }, geometry: { type: 'LineString', coordinates: [[0, 0], [99999, 0]] } },
      ],
    };
    const errors = validateMap(bad);
    expect(errors.some((e) => e.includes('unknown area kind'))).toBe(true);
    expect(errors.some((e) => e.includes('outside the map'))).toBe(true);
  });
});
