import { describe, expect, it } from 'vitest';
import equipmentJson from '../data/equipment.json';
import eraJson from '../data/eras/1970s.json';
import { validateEquipment, validateEra, type EquipmentTable, type EraData } from '../src/core/data';

const equipment = equipmentJson as EquipmentTable;
const era = eraJson as unknown as EraData;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('shipped data', () => {
  it('equipment table is valid', () => {
    expect(validateEquipment(equipment)).toEqual([]);
  });

  it('1970s era file is valid against the equipment table', () => {
    expect(validateEra(era, equipment)).toEqual([]);
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
  it('catches unknown equipment, wrong era, bad parent and bad placement', () => {
    const bad = clone(era);
    bad.soviet.units[0]!.equipment = { 'T-99': 1, M1: 1 };
    bad.soviet.units[1]!.parent = 'NOPE';
    bad.nato.units[0]!.placement = 'Z';
    bad.nato.units[1]!.intel = { status: 'suspected', low: 1.2, high: 0.8 };
    const errors = validateEra(bad, equipment);
    expect(errors.some((e) => e.includes('unknown equipment "T-99"'))).toBe(true);
    expect(errors.some((e) => e.includes('M1 is not available in 1970s'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown parent'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown placement'))).toBe(true);
    expect(errors.some((e) => e.includes('intel range'))).toBe(true);
  });

  it('catches duplicate ids and out-of-range strength', () => {
    const bad = clone(era);
    bad.soviet.units[1]!.id = bad.soviet.units[0]!.id;
    bad.soviet.units[2]!.strength = 1.5;
    const errors = validateEra(bad, equipment);
    expect(errors.some((e) => e.includes('duplicate id'))).toBe(true);
    expect(errors.some((e) => e.includes('strength'))).toBe(true);
  });

  it('catches missing norms and unknown default roles', () => {
    const bad = clone(era);
    delete (bad.norms.roles.attack!.required as Partial<Record<string, number>>).tanks;
    bad.sectors[0]!.defaultRole = 'raid';
    const errors = validateEra(bad, equipment);
    expect(errors.some((e) => e.includes('norm attack.tanks'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown default role'))).toBe(true);
  });
});
