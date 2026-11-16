import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32, rngFor, uniform } from '../src/core/rng';

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });

  it('differs between seeds and stays in [0, 1)', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(a()).not.toBe(b());
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it('gives independent named streams', () => {
    expect(hashSeed(7, 1, 'A')).toBe(hashSeed(7, 1, 'A'));
    expect(hashSeed(7, 1, 'A')).not.toBe(hashSeed(7, 1, 'B'));
    expect(hashSeed(7, 1, 'A')).not.toBe(hashSeed(7, 2, 'A'));
    expect(rngFor(7, 1, 'A')()).toBe(rngFor(7, 1, 'A')());
  });

  it('uniform maps into the range', () => {
    const r = mulberry32(3);
    for (let i = 0; i < 100; i++) {
      const x = uniform(r, 0.8, 1.2);
      expect(x).toBeGreaterThanOrEqual(0.8);
      expect(x).toBeLessThan(1.2);
    }
  });
});
