import './ui/style.css';
import { validateEquipment, validateEra, validateScenario } from './core/data';
import { equipment, era, scenarios } from './content';
import { mountApp } from './ui/app';

const root = document.getElementById('app')!;

const errors = [
  ...validateEquipment(equipment),
  ...validateEra(era, equipment),
  ...scenarios.flatMap((s) => validateScenario(s, era, equipment)),
];
if (errors.length > 0) {
  root.innerHTML = `<pre class="data-errors">Data errors:\n${errors.map((e) => `- ${e}`).join('\n')}</pre>`;
} else {
  mountApp(root, era, equipment, scenarios);
}
