// The shipped game content (equipment, era, scenarios), bundled by Vite.
// Shared by the app and the tests; validation happens where it is used.
import equipmentJson from '../data/equipment.json';
import eraJson from '../data/eras/1970s.json';
import type { EquipmentTable, EraData, Scenario } from './core/data';

export const equipment = equipmentJson as EquipmentTable;
export const era = eraJson as unknown as EraData;

const modules = import.meta.glob<Scenario>('../data/scenarios/*.json', { eager: true, import: 'default' });

/** All scenarios, ordered by file name. */
export const scenarios: Scenario[] = Object.keys(modules)
  .sort()
  .map((k) => modules[k]!);
