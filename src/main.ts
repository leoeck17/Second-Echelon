import './ui/style.css';
import { validateEquipment, validateEra, validateScenario } from './core/data';
import { equipment, era, maps, scenarios } from './content';
import { validateMap } from './core/terrain';
import { mountApp } from './ui/app';

const root = document.getElementById('app')!;

const errors = [
  ...validateEquipment(equipment),
  ...validateEra(era, equipment),
  ...Object.values(maps).flatMap((m) => validateMap(m)),
  ...scenarios.flatMap((s) => validateScenario(s, era, equipment)),
  ...scenarios.filter((s) => !maps[s.map]).map((s) => `${s.id}: unknown map "${s.map}"`),
];
if (errors.length > 0) {
  root.innerHTML = `<pre class="data-errors">Data errors:\n${errors.map((e) => `- ${e}`).join('\n')}</pre>`;
} else {
  mountApp(root, era, equipment, scenarios, maps);
}
