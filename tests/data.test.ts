import { describe, expect, it } from 'vitest';
import { validateEquipment, validateEra, validateScenario } from '../src/core/data';
import { clone, equipment, era, scenario, scenarios } from './fixtures';

describe('shipped data', () => {
  it('equipment table is valid', () => {
    expect(validateEquipment(equipment)).toEqual([]);
  });

  it('1970s era file is valid against the equipment table', () => {
    expect(validateEra(era, equipment)).toEqual([]);
  });

  it('ships at least three scenarios, all valid', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(3);
    for (const s of scenarios) expect(validateScenario(s, era, equipment)).toEqual([]);
  });

  it('uses T-55 = 1.0 as the reference weapon', () => {
    expect(equipment['T-55']!.cp).toBe(1);
    expect(equipment['T-55']!.basis).toBe('source');
  });

  it('marks every coefficient as source-based or game-tuned', () => {
    for (const eq of Object.values(equipment)) expect(['source', 'game-tuned']).toContain(eq.basis);
  });
});

describe('validateEquipment', () => {
  it('rejects bad categories, coefficients and basis', () => {
    const bad = clone(equipment);
    bad['T-62'] = { ...bad['T-62']!, category: 'cavalry' as never, cp: -1, basis: 'guess' as never };
    const errors = validateEquipment(bad);
    expect(errors.some((e) => e.includes('category'))).toBe(true);
    expect(errors.some((e) => e.includes('cp'))).toBe(true);
    expect(errors.some((e) => e.includes('basis'))).toBe(true);
  });
});

describe('validateEra', () => {
  it('catches unknown equipment, wrong era, bad parent, duplicate ids and bad strength', () => {
    const bad = clone(era);
    bad.soviet.units[0]!.equipment = { 'T-99': 1, M1: 1 };
    bad.soviet.units[1]!.parent = 'NOPE';
    bad.soviet.units[2]!.id = bad.soviet.units[3]!.id;
    bad.soviet.units[4]!.strength = 1.5;
    const errors = validateEra(bad, equipment);
    expect(errors.some((e) => e.includes('unknown equipment "T-99"'))).toBe(true);
    expect(errors.some((e) => e.includes('M1 is not available in 1970s'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown parent'))).toBe(true);
    expect(errors.some((e) => e.includes('duplicate id'))).toBe(true);
    expect(errors.some((e) => e.includes('strength'))).toBe(true);
  });

  it('catches missing norms and bad adjudication, recon and prep-time parameters', () => {
    const bad = clone(era);
    delete (bad.norms.roles.attack!.required as Partial<Record<string, number>>).tanks;
    bad.adjudication.stalledAt = 2;
    bad.adjudication.exploitRole = 'raid';
    bad.recon.residualLow = 1.2;
    bad.prepTime.table = bad.prepTime.table.filter((r) => r.hoursLeft > 0);
    const errors = validateEra(bad, equipment);
    expect(errors.some((e) => e.includes('norm attack.tanks'))).toBe(true);
    expect(errors.some((e) => e.includes('thresholds'))).toBe(true);
    expect(errors.some((e) => e.includes('exploitRole'))).toBe(true);
    expect(errors.some((e) => e.includes('recon'))).toBe(true);
    expect(errors.some((e) => e.includes('0 hours left'))).toBe(true);
  });
});

describe('validateScenario', () => {
  const base = scenario('1970s-01');

  it('catches bad placements, intel ranges and reaction units', () => {
    const bad = clone(base);
    bad.nato.estimate[0]!.placement = 'Z';
    bad.nato.estimate[1]!.intel = { status: 'suspected', low: 1.2, high: 0.8 };
    bad.natoReaction.units = ['GHOST', 'TM-A'];
    const errors = validateScenario(bad, era, equipment);
    expect(errors.some((e) => e.includes('unknown placement'))).toBe(true);
    expect(errors.some((e) => e.includes('intel range'))).toBe(true);
    expect(errors.some((e) => e.includes('"GHOST" is not in the truth'))).toBe(true);
    expect(errors.some((e) => e.includes('"TM-A" must be placed in reserve'))).toBe(true);
  });

  it('catches a broken school solution and non-selectable default roles', () => {
    const bad = clone(base);
    bad.schoolSolution.plan.assignment = { XX: 'A', TB: 'Q' };
    bad.schoolSolution.plan.roles = { A: 'exploitation' };
    bad.schoolSolution.recon = ['A', 'B', 'C', 'D'];
    bad.sectors[0]!.defaultRole = 'exploitation';
    const errors = validateScenario(bad, era, equipment);
    expect(errors.some((e) => e.includes('unknown formation "XX"'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown placement "Q"'))).toBe(true);
    expect(errors.some((e) => e.includes('bad role A=exploitation'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown sector "D"'))).toBe(true);
    expect(errors.some((e) => e.includes('default role'))).toBe(true);
  });

  it('catches NATO positions that contradict their placement or stand on the Soviet side', () => {
    const bad = clone(base);
    bad.nato.truth[0]!.pos = { x: 13000, y: 4500 }; // Team A placed in A but standing in C
    bad.nato.estimate[0]!.pos = { x: 16000, y: 10500 };
    const errors = validateScenario(bad, era, equipment);
    expect(errors.some((e) => e.includes('does not match its position'))).toBe(true);
    expect(errors.some((e) => e.includes('west of the line of contact'))).toBe(true);
  });

  it('catches an era mismatch', () => {
    const bad = clone(base);
    bad.era = '1980s';
    expect(validateScenario(bad, era, equipment).some((e) => e.includes('era'))).toBe(true);
  });
});
