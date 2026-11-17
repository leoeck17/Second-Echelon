// Seeded random numbers, so a battle can be replayed exactly. Pure logic: no DOM access.

export type Rng = () => number;

/** Mulberry32: small, fast, good enough for games. Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a seed plus keys, so each (phase, sector) gets its own independent stream. */
export function hashSeed(seed: number, ...keys: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of [seed, ...keys].join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A generator for one named stream of a seeded run. */
export function rngFor(seed: number, ...keys: (string | number)[]): Rng {
  return mulberry32(hashSeed(seed, ...keys));
}

export function uniform(rng: Rng, low: number, high: number): number {
  return low + (high - low) * rng();
}
