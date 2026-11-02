// M0 planning screen: Soviet forces | three sectors with live COFM | NATO estimate.
// All arithmetic lives in core/ and planning/; this file only renders and handles input.

import { estimatedUnitPotential, totalPotential, unitPotential, type Potential } from '../core/cofm';
import { RATIO_KEYS, type EquipmentTable, type EraData, type Formation, type Placement, type RatioKey, type Unit } from '../core/data';
import { assign, defaultPlan, evaluatePlan, sanitizePlan, setRole, type Plan, type SectorResult } from '../planning/plan';
import { STATUS_GLYPH, STATUS_TEXT, escapeHtml, formatNorm, formatPotential, formatRatio, formatRatioRange } from './format';

const STORAGE_KEY = 'correlation.m0.plan';

const LABEL: Record<RatioKey, string> = {
  tanks: 'Tanks',
  antitank: 'Antitank',
  artillery: 'Artillery',
  infantry: 'Infantry',
  overall: 'Overall',
};

const SHORT: Record<Exclude<keyof Potential, 'overall'>, string> = {
  tanks: 'Tk',
  antitank: 'AT',
  artillery: 'Art',
  infantry: 'Inf',
  other: 'Oth',
};

function loadPlan(era: EraData): Plan {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitizePlan(era, JSON.parse(raw) as Partial<Plan>);
  } catch {
    /* storage unavailable or corrupt: start fresh */
  }
  return defaultPlan(era);
}

function savePlan(plan: Plan): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  } catch {
    /* ignore */
  }
}

/** "31 BMP-1 · 27 RPG-7 · …" for a set of units. */
function equipmentSummary(units: Unit[]): string {
  const counts = new Map<string, number>();
  for (const u of units) {
    for (const [k, n] of Object.entries(u.equipment)) counts.set(k, (counts.get(k) ?? 0) + n);
  }
  return [...counts].map(([k, n]) => `${n} ${escapeHtml(k)}`).join(' · ');
}

function categoryChips(p: Potential): string {
  return (Object.keys(SHORT) as (keyof typeof SHORT)[])
    .filter((k) => p[k] > 0)
    .map((k) => `<span class="chip">${SHORT[k]} ${p[k].toFixed(1)}</span>`)
    .join('');
}

export function mountApp(root: HTMLElement, era: EraData, table: EquipmentTable): void {
  let plan = loadPlan(era);
  const sectorById = new Map(era.sectors.map((s) => [s.id, s]));
  const unitsOf = (f: Formation) => era.soviet.units.filter((u) => u.parent === f.id);

  const placementLabel = (p: Placement): string => {
    if (p === null) return 'Uncommitted';
    if (p === 'spread') return 'Spread over all sectors';
    if (p === 'reserve') return 'Reserve';
    return sectorById.get(p)?.name ?? p;
  };

  function renderFormation(f: Formation): string {
    const units = unitsOf(f);
    const p = totalPotential(units, table);
    const current = plan.assignment[f.id] ?? null;
    // Group identical notes: "7th MR Coy, 8th MR Coy: …".
    const byNote = new Map<string, string[]>();
    for (const u of units) if (u.note) byNote.set(u.note, [...(byNote.get(u.note) ?? []), u.name]);
    const notes = [...byNote].map(([note, names]) => `${escapeHtml(names.join(', '))}: ${escapeHtml(note)}`);
    const reduced = units.some((u) => u.strength < 1 || u.readiness < 1);
    const options: { value: Placement; label: string; title: string }[] = [
      ...era.sectors.map((s) => ({ value: s.id as Placement, label: s.id, title: `Assign to ${s.name}` })),
      ...(f.canSpread ? [{ value: 'spread' as Placement, label: 'Spread', title: 'Divide fires evenly over all sectors' }] : []),
      { value: null, label: '—', title: 'Uncommitted (regimental reserve)' },
    ];
    const buttons = options
      .map((o) => {
        const on = o.value === current;
        return `<button type="button" class="assign${on ? ' on' : ''}" data-action="assign" data-formation="${f.id}"
          data-placement="${o.value ?? ''}" aria-pressed="${on}" title="${escapeHtml(o.title)}">${o.label}</button>`;
      })
      .join('');
    return `
      <li class="formation${current !== null ? ' committed' : ''}" data-sector="${current ?? ''}">
        <div class="formation-head">
          <span class="formation-name" title="${escapeHtml(f.name)}">${escapeHtml(f.short)}</span>
          <span class="formation-full">${escapeHtml(f.name)}</span>
          <span class="formation-pot" title="Overall combat potential (T-55 = 1.0)">${p.overall.toFixed(1)}</span>
        </div>
        <div class="equip">${equipmentSummary(units)}</div>
        <div class="chips">${categoryChips(p)}${reduced ? '<span class="chip warn">reduced</span>' : ''}</div>
        ${notes.length ? `<div class="note">${notes.join('<br>')}</div>` : ''}
        <div class="assign-row" role="group" aria-label="Assign ${escapeHtml(f.short)}">${buttons}</div>
      </li>`;
  }

  function renderSector(s: SectorResult): string {
    const roleOptions = Object.entries(era.norms.roles)
      .map(([key, r]) => `<option value="${key}"${key === s.role ? ' selected' : ''}>${escapeHtml(r.label)}</option>`)
      .join('');
    const committed = s.formations.length
      ? s.formations
          .map((id) => {
            const f = era.soviet.formations.find((x) => x.id === id)!;
            const spread = plan.assignment[id] === 'spread';
            return `<button type="button" class="committed-chip" data-action="assign" data-formation="${id}" data-placement=""
              title="Withdraw ${escapeHtml(f.short)} to uncommitted">${escapeHtml(f.short)}${spread ? ' <small>⅓</small>' : ''} ×</button>`;
          })
          .join('')
      : '<span class="muted">No Soviet units assigned</span>';
    const rows = RATIO_KEYS.map((k) => {
      const a = s.assessment[k];
      const n = s.nato;
      const range =
        n.low[k] === n.high[k] ? '' : `<small>${n.low[k].toFixed(1)}–${n.high[k].toFixed(1)}</small>`;
      const ratioRange =
        a.ratio.low === a.ratio.high || Number.isNaN(a.ratio.value)
          ? ''
          : `<small>${formatRatioRange(a.ratio.low, a.ratio.high)}</small>`;
      const riskier = a.pessimistic !== a.status && a.pessimistic !== 'none';
      const title = `${LABEL[k]}: ${formatRatio(a.ratio.value)} against a norm of ${formatNorm(a.required)} (${STATUS_TEXT[a.status]}).`
        + (ratioRange ? ` If NATO is at the high end of the estimate: ${formatRatio(a.ratio.low)} (${STATUS_TEXT[a.pessimistic]}).` : '');
      return `
        <tr class="${k === 'overall' ? 'overall' : ''}">
          <th scope="row">${LABEL[k]}</th>
          <td class="num">${formatPotential(s.soviet[k])}</td>
          <td class="num">${formatPotential(n.mid[k])}${range}</td>
          <td class="ratio status-${a.status}" title="${escapeHtml(title)}">
            <span class="glyph" aria-hidden="true">${STATUS_GLYPH[a.status]}</span>${formatRatio(a.ratio.value)}${riskier ? '<span class="risk" aria-label="at risk">▲</span>' : ''}
            ${ratioRange}
          </td>
          <td class="num norm">${formatNorm(a.required)}</td>
        </tr>`;
    }).join('');
    return `
      <section class="sector verdict-${s.verdict}" aria-label="${escapeHtml(s.sector.name)}">
        <header>
          <h3>${escapeHtml(s.sector.name)}</h3>
          <span class="width">${s.sector.widthKm} km</span>
          <span class="verdict status-${s.verdict}">${STATUS_GLYPH[s.verdict]} ${s.verdict === 'none' ? 'empty' : STATUS_TEXT[s.verdict]}</span>
        </header>
        <label class="role">Role
          <select data-action="role" data-sector="${s.sector.id}">${roleOptions}</select>
        </label>
        <div class="committed-list">${committed}</div>
        <table>
          <thead><tr><th></th><th class="num">SOV</th><th class="num" title="Estimated NATO potential">NATO</th><th>Ratio</th><th class="num">Norm</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }

  function renderNatoUnit(u: Unit): string {
    const e = estimatedUnitPotential(u, table);
    const status = u.intel?.status ?? 'confirmed';
    const range = e.low.overall === e.high.overall ? '' : ` <small>(${e.low.overall.toFixed(1)}–${e.high.overall.toFixed(1)})</small>`;
    const place = u.placement ?? null;
    return `
      <li class="nato-unit">
        <div class="formation-head">
          <span class="badge place">${escapeHtml(place === null ? '?' : place === 'spread' ? 'All' : place === 'reserve' ? 'Res' : place)}</span>
          <span class="formation-full">${escapeHtml(u.name)}</span>
          <span class="formation-pot">${e.mid.overall.toFixed(1)}${range}</span>
        </div>
        <div class="equip">${equipmentSummary([u])}</div>
        <div class="chips">${categoryChips(unitPotential(u, table))}<span class="chip intel-${status}">${status}</span></div>
        <div class="note">${escapeHtml(placementLabel(place))}${u.note ? ` — ${escapeHtml(u.note)}` : ''}</div>
      </li>`;
  }

  function render(): void {
    const result = evaluatePlan(era, table, plan);
    const total = totalPotential(era.soviet.units, table);
    const natoOrder = (u: Unit) => {
      const p = u.placement ?? null;
      const i = era.sectors.findIndex((s) => s.id === p);
      return i >= 0 ? i : p === 'spread' ? 90 : 99;
    };
    const natoUnits = [...era.nato.units].sort((a, b) => natoOrder(a) - natoOrder(b));
    const res = result.natoReserve;

    root.innerHTML = `
      <header class="top">
        <div>
          <h1>Correlation <span class="muted">· COFM planner (M0)</span></h1>
          <p class="brief">${escapeHtml(era.name)} — ${escapeHtml(era.scenario.brief)}</p>
        </div>
        <div class="legend" aria-label="Legend">
          <span class="status-green">✓ meets norm</span>
          <span class="status-amber">≈ ≥ ${Math.round(era.norms.amberFraction * 100)}% of norm</span>
          <span class="status-red">✗ below</span>
          <span><span class="risk">▲</span> fails if NATO is at the high estimate</span>
          <button type="button" data-action="reset">Reset plan</button>
        </div>
      </header>
      <main class="layout">
        <aside class="panel soviet">
          <h2>${escapeHtml(era.soviet.name)}</h2>
          <p class="summary">Uncommitted <strong>${result.uncommitted.overall.toFixed(1)}</strong> of ${total.overall.toFixed(1)}</p>
          <ul class="list">${era.soviet.formations.map(renderFormation).join('')}</ul>
        </aside>
        <section class="sectors" aria-label="Sectors">
          ${result.sectors.map(renderSector).join('')}
        </section>
        <aside class="panel nato">
          <h2>${escapeHtml(era.nato.name)}</h2>
          <p class="summary">Outside the sectors (reserve): <strong>${res.mid.overall.toFixed(1)}</strong>
            ${res.low.overall !== res.high.overall ? `<small>(${res.low.overall.toFixed(1)}–${res.high.overall.toFixed(1)})</small>` : ''}</p>
          <ul class="list">${natoUnits.map(renderNatoUnit).join('')}</ul>
        </aside>
      </main>
      <footer class="foot muted">Potentials in T-55 equivalents. Ratios are Soviet ÷ estimated NATO; small figures show the range
        implied by the intelligence estimate. Norms already include the defender's terrain and preparation.</footer>`;
  }

  function update(next: Plan, refocus?: string): void {
    plan = next;
    savePlan(plan);
    render();
    // The DOM is rebuilt on every change; put keyboard focus back on the equivalent control.
    if (refocus) root.querySelector<HTMLElement>(refocus)?.focus();
  }

  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'assign') {
      const placement = el.dataset.placement || null;
      const sel = `.assign[data-formation="${el.dataset.formation}"][data-placement="${el.dataset.placement ?? ''}"]`;
      update(assign(era, plan, el.dataset.formation!, placement), sel);
    } else if (el.dataset.action === 'reset') {
      update(defaultPlan(era));
    }
  });
  root.addEventListener('change', (ev) => {
    const el = ev.target as HTMLSelectElement;
    if (el.dataset.action === 'role') {
      update(setRole(era, plan, el.dataset.sector!, el.value), `select[data-sector="${el.dataset.sector}"]`);
    }
  });

  render();
}
