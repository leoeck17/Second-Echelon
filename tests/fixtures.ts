// The shipped data, for tests.
import type { Scenario } from '../src/core/data';
import type { TdgContext } from '../src/planning/tdg';
import { equipment, era, scenarios } from '../src/content';

export { equipment, era, scenarios };

export function scenario(idPrefix: string): Scenario {
  const s = scenarios.find((x) => x.id.startsWith(idPrefix));
  if (!s) throw new Error(`No scenario ${idPrefix}`);
  return s;
}

export const ctxFor = (s: Scenario): TdgContext => ({ era, scenario: s, table: equipment });

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
