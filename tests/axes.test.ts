import { describe, expect, it } from 'vitest';
import { analyseAxes, applyCutOff } from '../src/core/axes';
import type { AxesParams, Unit } from '../src/core/data';
import { axisTempo, buildFights } from '../src/core/fight';
import { equipment, era, maps } from './fixtures';

const p: AxesParams = { ...era.axes, engagementRadius: 1000, bypassRange: 2000, encircleRange: 2500, closeDistance: 1000 };
const nato = (id: string, x: number, y: number, placement = 'B'): Unit => ({
  id, side: 'NATO', name: id, parent: 'TF', equipment: { M60A1: 5 }, strength: 1, readiness: 1, placement, pos: { x, y },
});
const west = (y: number, sectorId = 'B', formationId = 'F') => ({ formationId, sectorId, path: [{ x: 16000, y }, { x: 5000, y }] });

describe('analyseAxes', () => {
  const target = nato('T', 12000, 7500);

  it('engages units near the axis', () => {
    expect(analyseAxes([west(7800)], [target], p).T).toEqual({ engaged: ['B'], bypassed: [], encircled: [] });
  });

  it('bypasses units passed at a distance', () => {
    expect(analyseAxes([west(9000, 'A')], [target], p).T).toEqual({ engaged: [], bypassed: ['A'], encircled: [] });
  });

  it('encircles units passed on both sides', () => {
    const c = analyseAxes([west(9200, 'A', 'N'), west(5800, 'C', 'S')], [target], p).T!;
    expect(c.encircled.sort()).toEqual(['A', 'C']);
  });

  it('does not encircle if the axes stop short of closing behind the unit', () => {
    const short = (y: number, s: string) => ({ formationId: s, sectorId: s, path: [{ x: 16000, y }, { x: 11500, y }] });
    expect(analyseAxes([short(9200, 'A'), short(5800, 'C')], [target], p).T!.encircled).toEqual([]);
  });

  it('ignores far-away, reserve and spread units', () => {
    const r = analyseAxes([west(2000)], [target, nato('R', 12000, 2000, 'reserve'), nato('S', 12000, 2000, 'spread')], p);
    expect(r).toEqual({});
  });
});

describe('applyCutOff', () => {
  it('cuts off bypassed and encircles surrounded units only where the attack succeeded', () => {
    const units = [nato('BY', 12000, 7500), nato('EN', 12000, 7500), nato('EG', 12000, 7500)];
    const contacts = {
      BY: { engaged: [], bypassed: ['A'], encircled: [] },
      EN: { engaged: [], bypassed: [], encircled: ['A', 'C'] },
      EG: { engaged: ['A'], bypassed: [], encircled: [] },
    };
    const all = applyCutOff(units, contacts, new Set(['A', 'C']), p);
    expect(all.cutOff).toEqual(['BY']);
    expect(all.encircled).toEqual(['EN']);
    expect(all.nato[0]!.strength).toBeCloseTo(1 - p.cutOffLoss);
    expect(all.nato[1]!.strength).toBeCloseTo(1 - p.encircledLoss);
    expect(all.nato[2]!.strength).toBe(1);
    const half = applyCutOff(units, contacts, new Set(['A']), p);
    expect(half.encircled).toEqual([]);
    expect(half.cutOff.sort()).toEqual(['BY', 'EN']);
    expect(applyCutOff(units, contacts, new Set(), p).nato).toEqual(units);
  });
});

describe('buildFights', () => {
  const map = maps['central-01']!;
  const sectors = [
    { id: 'A', name: 'A', widthKm: 3, defaultRole: 'attack', yRange: [9000, 12000] as [number, number] },
    { id: 'B', name: 'B', widthKm: 3, defaultRole: 'attack', yRange: [6000, 9000] as [number, number] },
  ];
  const sov: Unit = { id: 'tb', side: 'SOV', name: 'tb', parent: 'TB', equipment: { 'T-62': 10 }, strength: 1, readiness: 1 };
  const art: Unit = { id: 'art', side: 'SOV', name: 'art', parent: 'ART', equipment: { 'D-30': 6 }, strength: 1, readiness: 1 };
  const fights = (axisY: number, extra: Partial<Parameters<typeof buildFights>[0]> = {}) =>
    buildFights({
      sectors, map, terrain: era.terrain, axesParams: p, table: equipment,
      soviet: [sov, art],
      sovPlacement: (u) => (u.id === 'tb' ? 'B' : 'spread'),
      axes: [{ formationId: 'TB', sectorId: 'B', path: [{ x: 16000, y: axisY }, { x: 5000, y: axisY }] }],
      nato: [nato('VIL', 12000, 7500), { ...nato('ART', 5000, 6500), placement: 'spread' }, nato('RES', 3000, 9500, 'reserve')],
      ...extra,
    });

  it('puts engaged units in the fight with the terrain they hold', () => {
    const f = fights(7500).sectors.B!;
    expect(f.engaged).toEqual(['VIL']);
    expect(f.nato.VIL).toBe(1);
    expect(f.terrain).toBeCloseTo(era.terrain.defence.town);
  });

  it('bypassed units become a flank threat, not part of the fight', () => {
    const f = fights(9300).sectors.B!;
    expect(f.engaged).toEqual([]);
    expect(f.flank.VIL).toBe(p.flankWeight);
    expect(f.nato.VIL).toBeUndefined();
  });

  it('spreads fires and keeps reserves out unless they counterattack', () => {
    const r = fights(7500);
    expect(r.sectors.A!.soviet.art).toBeCloseTo(0.5);
    expect(r.sectors.A!.nato.ART).toBeCloseTo(0.5);
    expect(r.sectors.B!.nato.RES).toBeUndefined();
    const counter = fights(7500, {
      nato: [{ ...nato('RES', 9500, 7500), placement: 'B' }],
      alwaysEngaged: new Set(['RES']),
    });
    expect(counter.sectors.B!.engaged).toEqual(['RES']);
  });

  it('slows an axis through forest', () => {
    const open = axisTempo(map, [{ x: 16000, y: 4500 }, { x: 13000, y: 4500 }], era.terrain, 0.5);
    const forest = axisTempo(map, [{ x: 14000, y: 11500 }, { x: 10000, y: 11500 }], era.terrain, 0.5);
    expect(open).toBeCloseTo(1, 1);
    expect(forest).toBeLessThan(0.85);
  });
});
