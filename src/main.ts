import './ui/style.css';
import equipmentJson from '../data/equipment.json';
import eraJson from '../data/eras/1970s.json';
import { validateEquipment, validateEra, type EquipmentTable, type EraData } from './core/data';
import { mountApp } from './ui/app';

const equipment = equipmentJson as EquipmentTable;
const era = eraJson as unknown as EraData;
const root = document.getElementById('app')!;

const errors = [...validateEquipment(equipment), ...validateEra(era, equipment)];
if (errors.length > 0) {
  root.innerHTML = `<pre class="data-errors">Data errors:\n${errors.map((e) => `- ${e}`).join('\n')}</pre>`;
} else {
  mountApp(root, era, equipment);
}
