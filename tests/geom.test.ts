import { describe, expect, it } from 'vitest';
import { crossingsAtX, dist, distToPolyline, distToSegment, minX, pointInRing, polylineLength, sampleAlong } from '../src/core/geom';

describe('geom', () => {
  it('measures distances to points, segments and polylines', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(distToPolyline({ x: 12, y: 5 }, line)).toBe(2);
    expect(distToPolyline({ x: 1, y: 1 }, [])).toBe(Infinity);
    expect(polylineLength(line)).toBe(20);
  });

  it('tests points against a polygon', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInRing({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInRing({ x: 15, y: 5 }, sq)).toBe(false);
  });

  it('samples along a line and finds where it crosses a meridian', () => {
    const pts = sampleAlong([{ x: 0, y: 0 }, { x: 250, y: 0 }], 100);
    expect(pts.length).toBe(4);
    expect(pts[pts.length - 1]).toEqual({ x: 250, y: 0 });
    const zig = [{ x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 20 }];
    expect(crossingsAtX(zig, 5)).toEqual([5, 15]);
    expect(crossingsAtX(zig, 20)).toEqual([]);
    expect(minX(zig)).toBe(0);
  });
});
