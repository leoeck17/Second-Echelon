// HTML renderers for each screen. They take state and return markup; no event handling,
// no arithmetic beyond formatting. All text from data files is escaped.

import type { Outcome, SectorOutcome } from '../core/adjudicate';
import { estimatedUnitPotential, totalPotential, unitPotential, type Potential } from '../core/cofm';
import { RATIO_KEYS, type Formation, type Placement, type RatioKey, type Unit } from '../core/data';
import type { FindingKind } from '../core/fog';
import type { PlanResult, SectorResult } from '../planning/plan';
import {
  currentReadiness,
  hoursLeft,
  movableInDecision,
  phase2Roles,
  type TdgContext,
  type TdgState,
  type Verdict,
} from '../planning/tdg';
import { STATUS_GLYPH, STATUS_TEXT, escapeHtml as esc, formatNorm, formatPotential, formatRatio, formatRatioRange } from './format';

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

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function equipmentSummary(units: readonly Unit[]): string {
  const counts = new Map<string, number>();
  for (const u of units) {
    for (const [k, n] of Object.entries(u.equipment)) counts.set(k, (counts.get(k) ?? 0) + n);
  }
  return [...counts].map(([k, n]) => `${n} ${esc(k)}`).join(' · ');
}

function categoryChips(p: Potential): string {
  return (Object.keys(SHORT) as (keyof typeof SHORT)[])
    .filter((k) => p[k] > 0.05)
    .map((k) => `<span class="chip">${SHORT[k]} ${p[k].toFixed(1)}</span>`)
    .join('');
}

function sectorName(ctx: TdgContext, p: Placement): string {
  if (p === null) return 'Location unknown';
  if (p === 'spread') return 'Fires into all sectors';
  if (p === 'reserve') return 'Reserve';
  return ctx.scenario.sectors.find((s) => s.id === p)?.name ?? p;
}

function placeBadge(p: Placement): string {
  return p === null ? '?' : p === 'spread' ? 'All' : p === 'reserve' ? 'Res' : p;
}

// ---------------------------------------------------------------------------------------
// Shared chrome

const STEPS: { phase: TdgState['phase']; label: string }[] = [
  { phase: 'briefing', label: 'Briefing' },
  { phase: 'planning', label: 'Planning' },
  { phase: 'decision', label: 'Decision' },
  { phase: 'debrief', label: 'Debrief' },
];

export function renderTimer(timer: { seconds: number } | null): string {
  return timer
    ? `<span class="timer${timer.seconds <= 30 ? ' low' : ''}" id="timer" role="timer" aria-live="off" title="Time left for this decision">${formatClock(timer.seconds)}</span>`
    : '';
}

export function renderHeader(ctx: TdgContext, s: TdgState): string {
  const idx = STEPS.findIndex((x) => x.phase === s.phase);
  const steps = STEPS.map(
    (x, i) => `<li class="${i < idx ? 'done' : i === idx ? 'current' : ''}"${i === idx ? ' aria-current="step"' : ''}>${x.label}</li>`,
  ).join('');
  return `
    <header class="top">
      <div>
        <h1><button type="button" class="linkish" data-action="menu" title="Back to scenarios">Correlation</button>
          <span class="muted">· ${esc(ctx.scenario.title)}</span></h1>
        <ol class="stepper">${steps}</ol>
      </div>
      <div class="top-right">
        <button type="button" data-action="menu">Scenarios</button>
      </div>
    </header>`;
}

function errorLine(s: TdgState): string {
  return s.error ? `<p class="error" role="alert">${esc(s.error)}</p>` : '';
}

const LEGEND = (amber: number) => `
  <div class="legend" aria-label="Legend">
    <span class="status-green">✓ meets norm</span>
    <span class="status-amber">≈ ≥ ${Math.round(amber * 100)}% of norm</span>
    <span class="status-red">✗ below</span>
    <span><span class="risk">▲</span> fails if NATO is at the high estimate</span>
  </div>`;

// ---------------------------------------------------------------------------------------
// Scenario list

export interface MenuEntry {
  ctx: TdgContext;
  best: Verdict | null;
}

const VERDICT_LABEL: Record<Verdict, string> = { success: 'Mission accomplished', partial: 'Partial success', failure: 'Mission failed' };

export function renderMenu(entries: MenuEntry[], timerOn: boolean): string {
  const cards = entries
    .map(({ ctx, best }) => {
      const sc = ctx.scenario;
      const t = sc.timeLimitSec;
      const limits = t?.planning ? `${formatClock(t.planning)} to plan${t.decision ? `, ${formatClock(t.decision)} to decide` : ''}` : 'Untimed';
      return `
        <li class="card">
          <h2>${esc(sc.title)}</h2>
          <p>${esc(sc.brief)}</p>
          <p class="facts"><span>${esc(ctx.era.name)}</span><span>${sc.planningHours} planning hours</span><span>${limits}</span></p>
          <div class="card-foot">
            ${best ? `<span class="chip verdict-${best}">Best: ${VERDICT_LABEL[best]}</span>` : '<span class="muted">Not played yet</span>'}
            <button type="button" class="primary" data-action="play" data-scenario="${esc(sc.id)}">Play</button>
          </div>
        </li>`;
    })
    .join('');
  return `
    <header class="top">
      <div>
        <h1>Correlation <span class="muted">· tactical decision games</span></h1>
        <p class="brief">You command a Soviet motor rifle regiment. Each scenario: read the situation, spend planning time on
          reconnaissance, mass your battalions against the norms, then make one decision when the enemy reacts.
          The battle is decided by the true force ratios, which you only ever see through your intelligence estimate.</p>
      </div>
      <label class="toggle"><input type="checkbox" data-action="toggle-timer" ${timerOn ? 'checked' : ''}> Time limits</label>
    </header>
    <main class="menu"><ol class="cards">${cards}</ol></main>`;
}

// ---------------------------------------------------------------------------------------
// Briefing

export function renderBriefing(ctx: TdgContext, s: TdgState, timerOn: boolean): string {
  const sc = ctx.scenario;
  const prep = [...ctx.era.prepTime.table]
    .sort((a, b) => b.hoursLeft - a.hoursLeft)
    .map((r) => `<li>${r.hoursLeft > 0 ? `${r.hoursLeft}+ h left` : 'No time left'}: readiness ${pct(r.readiness)}</li>`)
    .join('');
  const bySector = sc.sectors
    .map((sec) => {
      const units = s.estimate.filter((u) => u.placement === sec.id);
      const list = units.length
        ? units.map((u) => `<li>${esc(u.name)} <span class="chip intel-${u.intel?.status ?? 'confirmed'}">${u.intel?.status ?? 'confirmed'}</span></li>`).join('')
        : '<li class="muted">Nothing reported</li>';
      return `<div class="brief-sector"><h3>${esc(sec.name)} <span class="width">${sec.widthKm} km</span></h3><ul>${list}</ul></div>`;
    })
    .join('');
  const other = s.estimate.filter((u) => !sc.sectors.some((sec) => sec.id === u.placement));
  const t = sc.timeLimitSec;
  return `
    <main class="briefing">
      <section class="panel">
        <h2>Situation</h2>
        <p class="lead">${esc(sc.brief)}</p>
        <h3>Known enemy positions</h3>
        <div class="brief-sectors">${bySector}</div>
        ${other.length ? `<p class="note">Also reported: ${other.map((u) => `${esc(u.name)} (${esc(sectorName(ctx, u.placement ?? null).toLowerCase())})`).join('; ')}.</p>` : ''}
      </section>
      <section class="panel">
        <h2>Your time</h2>
        <p>You have <strong>${sc.planningHours} hours</strong> before H-hour. Reconnoitring a sector takes
          ${ctx.era.recon.hoursPerSector} h and replaces the estimate there with what is really there (dummies vanish,
          hidden units appear). Hours you don't spend on recon go to battle procedure:</p>
        <ul class="prep">${prep}</ul>
        <h3>How it ends</h3>
        <p>Phase 1: your first echelon attacks. NATO then moves its reserve toward your main effort and you decide what to
          commit. Phase 2 settles it. You accomplish the mission if a sector you attack is broken through and held with at
          least ${pct(ctx.era.adjudication.exploitMinShare)} of the regiment, and losses stay below
          ${pct(ctx.era.adjudication.lossLimit)}.</p>
        <label class="toggle"><input type="checkbox" data-action="toggle-timer" ${timerOn ? 'checked' : ''}>
          Time limits${t?.planning ? ` (${formatClock(t.planning)} to plan${t.decision ? `, ${formatClock(t.decision)} to decide` : ''})` : ''}</label>
        <p class="muted small">Seed ${s.seed}</p>
        <button type="button" class="primary big" data-action="start">Begin planning</button>
      </section>
    </main>`;
}

// ---------------------------------------------------------------------------------------
// The three-column planning view (used in planning and in the decision)

interface ForcesOpts {
  editableRoles: boolean;
  isMovable: (formationId: string) => boolean;
  lockedReason: string;
}

function renderFormation(ctx: TdgContext, s: TdgState, f: Formation, opts: ForcesOpts): string {
  const units = s.soviet.filter((u) => u.parent === f.id);
  const p = totalPotential(units, ctx.table);
  const current = s.plan.assignment[f.id] ?? null;
  const movable = opts.isMovable(f.id);
  const byNote = new Map<string, string[]>();
  for (const u of ctx.era.soviet.units.filter((x) => x.parent === f.id)) {
    if (u.note) byNote.set(u.note, [...(byNote.get(u.note) ?? []), u.name]);
  }
  const notes = [...byNote].map(([note, names]) => `${esc(names.join(', '))}: ${esc(note)}`);
  // Losses relative to the start of the battle (data understrength is not a loss).
  const start = new Map(ctx.era.soviet.units.map((u) => [u.id, u.strength]));
  const lossy = units.some((u) => u.strength < (start.get(u.id) ?? 1) - 1e-9);
  const strength = lossy
    ? totalPotential(units.map((u) => ({ ...u, strength: start.get(u.id) ?? 1 })), ctx.table).overall
    : 0;
  const options: { value: Placement; label: string; title: string }[] = [
    ...ctx.scenario.sectors.map((sec) => ({ value: sec.id as Placement, label: sec.id, title: `Assign to ${sec.name}` })),
    ...(f.canSpread ? [{ value: 'spread' as Placement, label: 'Spread', title: 'Divide fires evenly over all sectors' }] : []),
    { value: null, label: '—', title: 'Uncommitted (second echelon / reserve)' },
  ];
  const buttons = movable
    ? options
        .map((o) => {
          const on = o.value === current;
          return `<button type="button" class="assign${on ? ' on' : ''}" data-action="assign" data-formation="${f.id}"
            data-placement="${o.value ?? ''}" aria-pressed="${on}" title="${esc(o.title)}">${o.label}</button>`;
        })
        .join('')
    : `<span class="locked">${esc(sectorName(ctx, current))} · ${esc(opts.lockedReason)}</span>`;
  return `
    <li class="formation${current !== null ? ' committed' : ''}${movable ? '' : ' locked-card'}">
      <div class="formation-head">
        <span class="formation-name" title="${esc(f.name)}">${esc(f.short)}</span>
        <span class="formation-full">${esc(f.name)}</span>
        <span class="formation-pot" title="Combat potential (T-55 = 1.0)">${p.overall.toFixed(1)}</span>
      </div>
      <div class="equip">${equipmentSummary(units)}</div>
      <div class="chips">${categoryChips(p)}${lossy ? `<span class="chip warn">${pct(1 - p.overall / strength)} lost</span>` : ''}</div>
      ${notes.length ? `<div class="note">${notes.join('<br>')}</div>` : ''}
      <div class="assign-row" role="group" aria-label="Assign ${esc(f.short)}">${buttons}</div>
    </li>`;
}

function renderSector(ctx: TdgContext, s: TdgState, r: SectorResult, opts: ForcesOpts): string {
  const roleOptions = Object.entries(ctx.era.norms.roles)
    .filter(([key, role]) => role.selectable !== false || key === r.role)
    .map(([key, role]) => `<option value="${key}"${key === r.role ? ' selected' : ''}>${esc(role.label)}</option>`)
    .join('');
  const roleNote = ctx.era.norms.roles[r.role]?.note;
  const committed = r.formations.length
    ? r.formations
        .map((id) => {
          const f = ctx.era.soviet.formations.find((x) => x.id === id)!;
          const spread = s.plan.assignment[id] === 'spread';
          const label = `${esc(f.short)}${spread ? ' <small>⅓</small>' : ''}`;
          return opts.isMovable(id)
            ? `<button type="button" class="committed-chip" data-action="assign" data-formation="${id}" data-placement=""
                title="Withdraw ${esc(f.short)} to uncommitted">${label} ×</button>`
            : `<span class="committed-chip fixed">${label}</span>`;
        })
        .join('')
    : '<span class="muted">No Soviet units assigned</span>';
  const rows = RATIO_KEYS.map((k) => {
    const a = r.assessment[k];
    const n = r.nato;
    const range = n.low[k] === n.high[k] ? '' : `<small>${n.low[k].toFixed(1)}–${n.high[k].toFixed(1)}</small>`;
    const ratioRange =
      a.ratio.low === a.ratio.high || Number.isNaN(a.ratio.value) ? '' : `<small>${formatRatioRange(a.ratio.low, a.ratio.high)}</small>`;
    const riskier = a.pessimistic !== a.status && a.pessimistic !== 'none';
    const title =
      `${LABEL[k]}: ${formatRatio(a.ratio.value)} against a norm of ${formatNorm(a.required)} (${STATUS_TEXT[a.status]}).` +
      (ratioRange ? ` If NATO is at the high end of the estimate: ${formatRatio(a.ratio.low)} (${STATUS_TEXT[a.pessimistic]}).` : '');
    return `
      <tr class="${k === 'overall' ? 'overall' : ''}">
        <th scope="row">${LABEL[k]}</th>
        <td class="num">${formatPotential(r.soviet[k])}</td>
        <td class="num">${formatPotential(n.mid[k])}${range}</td>
        <td class="ratio status-${a.status}" title="${esc(title)}">
          <span class="glyph" aria-hidden="true">${STATUS_GLYPH[a.status]}</span>${formatRatio(a.ratio.value)}${riskier ? '<span class="risk" aria-label="at risk">▲</span>' : ''}
          ${ratioRange}
        </td>
        <td class="num norm">${formatNorm(a.required)}</td>
      </tr>`;
  }).join('');
  const reconned = s.reconned.includes(r.sector.id);
  return `
    <section class="sector verdict-${r.verdict}" aria-label="${esc(r.sector.name)}">
      <header>
        <h3>${esc(r.sector.name)}</h3>
        <span class="width">${r.sector.widthKm} km${reconned ? ' · reconnoitred' : ''}</span>
        <span class="verdict status-${r.verdict}">${STATUS_GLYPH[r.verdict]} ${r.verdict === 'none' ? 'empty' : STATUS_TEXT[r.verdict]}</span>
      </header>
      <label class="role">Role
        <select data-action="role" data-sector="${r.sector.id}"${opts.editableRoles ? '' : ' disabled'}>${roleOptions}</select>
      </label>
      ${roleNote ? `<p class="note">${esc(roleNote)}</p>` : ''}
      <div class="committed-list">${committed}</div>
      <table>
        <thead><tr><th></th><th class="num">SOV</th><th class="num" title="Estimated NATO potential">NATO</th><th>Ratio</th><th class="num">Norm</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function renderNatoUnit(ctx: TdgContext, u: Unit): string {
  const e = estimatedUnitPotential(u, ctx.table);
  const status = u.intel?.status ?? 'confirmed';
  const range = e.low.overall === e.high.overall ? '' : ` <small>(${e.low.overall.toFixed(1)}–${e.high.overall.toFixed(1)})</small>`;
  const place = u.placement ?? null;
  return `
    <li class="nato-unit">
      <div class="formation-head">
        <span class="badge place">${esc(placeBadge(place))}</span>
        <span class="formation-full">${esc(u.name)}</span>
        <span class="formation-pot">${e.mid.overall.toFixed(1)}${range}</span>
      </div>
      <div class="equip">${equipmentSummary([u])}</div>
      <div class="chips">${categoryChips(unitPotential(u, ctx.table))}<span class="chip intel-${status}">${status}</span></div>
      <div class="note">${esc(sectorName(ctx, place))}${u.note ? ` — ${esc(u.note)}` : ''}</div>
    </li>`;
}

function renderForces(ctx: TdgContext, s: TdgState, result: PlanResult, opts: ForcesOpts): string {
  const order = (u: Unit) => {
    const i = ctx.scenario.sectors.findIndex((x) => x.id === u.placement);
    return i >= 0 ? i : u.placement === 'spread' ? 90 : u.placement === 'reserve' ? 95 : 99;
  };
  const estimate = [...s.estimate].sort((a, b) => order(a) - order(b));
  const res = result.natoReserve;
  const total = totalPotential(s.soviet, ctx.table);
  return `
    <div class="layout">
      <aside class="panel soviet">
        <h2>${esc(ctx.era.soviet.name)}</h2>
        <p class="summary">Uncommitted <strong>${result.uncommitted.overall.toFixed(1)}</strong> of ${total.overall.toFixed(1)}</p>
        <ul class="list">${ctx.era.soviet.formations.map((f) => renderFormation(ctx, s, f, opts)).join('')}</ul>
      </aside>
      <section class="sectors" aria-label="Sectors">${result.sectors.map((r) => renderSector(ctx, s, r, opts)).join('')}</section>
      <aside class="panel nato">
        <h2>${esc(ctx.scenario.nato.name)} <span class="muted">(estimate)</span></h2>
        <p class="summary">Outside the sectors: <strong>${res.mid.overall.toFixed(1)}</strong>
          ${res.low.overall !== res.high.overall ? `<small>(${res.low.overall.toFixed(1)}–${res.high.overall.toFixed(1)})</small>` : ''}</p>
        <ul class="list">${estimate.map((u) => renderNatoUnit(ctx, u)).join('')}</ul>
      </aside>
    </div>`;
}

// ---------------------------------------------------------------------------------------
// Planning

const FINDING_TEXT: Record<FindingKind, string> = {
  confirmed: 'confirmed as reported',
  changed: 'found, but stronger or weaker than reported',
  dummy: 'is a dummy position',
  hidden: 'found — not previously reported',
  'moved-here': 'found here, not where it was reported',
  absent: 'not found where reported; location unknown',
};

function renderFindings(ctx: TdgContext, s: TdgState): string {
  if (!s.findings.length) return '';
  const items = s.findings
    .map((f) => {
      const sec = ctx.scenario.sectors.find((x) => x.id === f.sectorId);
      return `<li class="finding-${f.kind}"><strong>${esc(sec?.id ?? f.sectorId)}</strong> ${esc(f.unitName)} ${FINDING_TEXT[f.kind]}</li>`;
    })
    .join('');
  return `<details class="findings" open><summary>Intelligence reports (${s.findings.length})</summary><ul>${items}</ul></details>`;
}

export function renderPlanning(ctx: TdgContext, s: TdgState, result: PlanResult, timer: { seconds: number } | null): string {
  const left = hoursLeft(ctx, s);
  const cost = ctx.era.recon.hoursPerSector;
  const k = currentReadiness(ctx, s);
  const reconButtons = ctx.scenario.sectors
    .map((sec) => {
      const done = s.reconned.includes(sec.id);
      const disabled = done || left < cost;
      return `<button type="button" data-action="recon" data-sector="${sec.id}"${disabled ? ' disabled' : ''}
        title="${done ? 'Already reconnoitred' : `Spend ${cost} h to see what is really in ${esc(sec.name)}`}">${done ? '✓ ' : ''}Recon ${sec.id}</button>`;
    })
    .join('');
  const opts: ForcesOpts = { editableRoles: true, isMovable: () => true, lockedReason: '' };
  return `
    <main>
      <div class="actionbar sticky">
        <div class="recon">
          <span><strong>${left} h</strong> of ${ctx.scenario.planningHours} h left · readiness at H-hour <strong>${pct(k)}</strong></span>
          <span class="recon-buttons">${reconButtons}</span>
          <span class="muted small">Recon costs ${cost} h per sector.</span>
        </div>
        <span class="bar-end">${renderTimer(timer)}<button type="button" class="primary" data-action="commit">Commit plan</button></span>
      </div>
      ${errorLine(s)}
      ${renderFindings(ctx, s)}
      ${LEGEND(ctx.era.norms.amberFraction)}
      ${renderForces(ctx, s, result, opts)}
    </main>`;
}

// ---------------------------------------------------------------------------------------
// Decision

const OUTCOME_TEXT: Record<Outcome, string> = { success: 'Broke through', stalled: 'Stalled', repulsed: 'Repulsed', none: 'No attack' };

function outcomeText(role: string, o: Outcome): string {
  if (o === 'success' && role === 'holding') return 'Enemy fixed';
  if (o === 'success' && role === 'exploitation') return 'Exploited and held';
  return OUTCOME_TEXT[o];
}

function outcomeChip(x: SectorOutcome): string {
  return `<span class="outcome outcome-${x.outcome}">${outcomeText(x.role, x.outcome)}</span>`;
}

function renderPhaseSummary(ctx: TdgContext, sectors: SectorOutcome[]): string {
  return sectors
    .map((x) => {
      const sec = ctx.scenario.sectors.find((y) => y.id === x.sectorId)!;
      const role = ctx.era.norms.roles[x.role]?.label ?? x.role;
      const losses = x.outcome === 'none' ? '' : `<small>Losses: ours ${pct(x.sovLoss)}, theirs ${pct(x.natoLoss)}</small>`;
      return `<li><span class="sector-id">${esc(sec.id)}</span><span>${esc(role)}</span>${outcomeChip(x)}${losses}</li>`;
    })
    .join('');
}

export function renderDecision(ctx: TdgContext, s: TdgState, result: PlanResult, timer: { seconds: number } | null): string {
  const p1 = s.phase1!;
  const target = s.reaction?.sectorId ? ctx.scenario.sectors.find((x) => x.id === s.reaction!.sectorId) : null;
  const roles = phase2Roles(ctx, s);
  const exploiting = ctx.scenario.sectors.filter((x) => roles[x.id] === ctx.era.adjudication.exploitRole);
  const situation = [
    s.timedOut.planning ? 'Time ran out: your plan was committed as it stood.' : '',
    target ? `${esc(ctx.scenario.natoReaction.text)} It is reported moving into <strong>${esc(target.name)}</strong>.` : 'Nothing was attacked, so NATO holds its reserve back.',
    exploiting.length
      ? `${exploiting.map((x) => esc(x.id)).join(', ')}: the defence is broken; phase 2 there is about exploiting and holding off counterattacks (exploitation norms).`
      : '',
    'Contact has revealed the enemy in the sectors you attacked.',
  ]
    .filter(Boolean)
    .map((t) => `<li>${t}</li>`)
    .join('');
  const opts: ForcesOpts = {
    editableRoles: false,
    isMovable: (id) => movableInDecision(ctx, s, id),
    lockedReason: 'in contact',
  };
  return `
    <main>
      <div class="actionbar sticky">
        <span>Commit your second echelon, then continue.</span>
        <span class="bar-end">${renderTimer(timer)}<button type="button" class="primary" data-action="decide">Issue orders — continue the battle</button></span>
      </div>
      <section class="panel situation">
        <h2>Phase 1 results</h2>
        <ul class="phase-summary">${renderPhaseSummary(ctx, p1.sectors)}</ul>
        <h3>Situation</h3>
        <ul class="situation-list">${situation}</ul>
        <p>Commit your second echelon and reserve, or shift your artillery. Battalions in contact stay where they are.</p>
      </section>
      ${errorLine(s)}
      ${renderFindings(ctx, s)}
      ${renderForces(ctx, s, result, opts)}
    </main>`;
}

// ---------------------------------------------------------------------------------------
// Debrief

export interface Debrief {
  /** The plan as committed, rated against the truth at H-hour. */
  plannedVsTruth: PlanResult;
  /** The school solution played with the same seed. */
  school: TdgState;
}

type IntelTag = 'accurate' | 'changed' | 'moved' | 'dummy' | 'hidden';

function intelTag(e: Unit | undefined, t: Unit | undefined): IntelTag {
  if (!t) return 'dummy';
  if (!e) return 'hidden';
  if (e.placement !== t.placement) return 'moved';
  const keys = new Set([...Object.keys(e.equipment), ...Object.keys(t.equipment)]);
  for (const k of keys) if ((e.equipment[k] ?? 0) !== (t.equipment[k] ?? 0)) return 'changed';
  return 'accurate';
}

const TAG_TEXT: Record<IntelTag, string> = {
  accurate: 'Accurate',
  changed: 'Strength wrong',
  moved: 'Location wrong',
  dummy: 'Dummy',
  hidden: 'Not reported',
};

function verdictText(ctx: TdgContext, s: TdgState): string {
  const f = s.final!;
  const won = f.wonSectors.map((id) => ctx.scenario.sectors.find((x) => x.id === id)?.name ?? id).join(', ');
  const parts: string[] = [];
  if (!f.wonSectors.length) parts.push('No sector you attacked was broken through and held.');
  else parts.push(`Broken through and held: ${esc(won)}.`);
  if (f.wonSectors.length && !f.objectiveTaken) {
    parts.push(
      `Too little of the regiment got through (${pct(f.exploitShare)}; ${pct(ctx.era.adjudication.exploitMinShare)} needed) to go on to the objective.`,
    );
  }
  parts.push(
    `Regiment losses ${pct(f.regimentLoss)} (limit ${pct(ctx.era.adjudication.lossLimit)}): ${f.combatCapable ? 'still combat-capable' : 'no longer combat-capable'}.`,
  );
  if (s.timedOut.planning) parts.push('The plan was committed when time ran out.');
  if (s.timedOut.decision) parts.push('No orders were issued before time ran out.');
  return parts.join(' ');
}

export function renderDebrief(ctx: TdgContext, s: TdgState, d: Debrief): string {
  const f = s.final!;
  const planned = s.committed!.planned;
  const rows = ctx.scenario.sectors
    .map((sec) => {
      const pl = planned.sectors.find((x) => x.sector.id === sec.id)!;
      const tr = d.plannedVsTruth.sectors.find((x) => x.sector.id === sec.id)!;
      const a = s.phase1!.sectors.find((x) => x.sectorId === sec.id)!;
      const b = s.phase2!.sectors.find((x) => x.sectorId === sec.id)!;
      const role = ctx.era.norms.roles[pl.role]?.label ?? pl.role;
      const cell = (r: SectorResult) =>
        r.soviet.overall <= 0
          ? '<td class="muted">not attacked</td>'
          : `<td class="ratio status-${r.assessment.overall.status}">${formatRatio(r.ratios.overall.value)}<small>tanks ${formatRatio(r.ratios.tanks.value)}</small></td>`;
      return `
        <tr>
          <th scope="row">${esc(sec.name)}<small>${esc(role)}</small></th>
          ${cell(pl)}
          ${cell(tr)}
          <td>${outcomeChip(a)}${a.outcome !== 'none' ? `<small>−${pct(a.sovLoss)} / −${pct(a.natoLoss)}</small>` : ''}</td>
          <td>${outcomeChip(b)}${b.outcome !== 'none' ? `<small>−${pct(b.sovLoss)} / −${pct(b.natoLoss)}</small>` : ''}</td>
        </tr>`;
    })
    .join('');

  const est = new Map(ctx.scenario.nato.estimate.map((u) => [u.id, u]));
  const tru = new Map(ctx.scenario.nato.truth.map((u) => [u.id, u]));
  const ids = [...new Set([...est.keys(), ...tru.keys()])];
  const intel = ids
    .map((id) => {
      const e = est.get(id);
      const t = tru.get(id);
      const tag = intelTag(e, t);
      const desc = (u?: Unit) =>
        u ? `${esc(placeBadge(u.placement ?? null))} · ${unitPotential(u, ctx.table).overall.toFixed(1)}<small>${equipmentSummary([u])}</small>` : '—';
      return `
        <tr>
          <th scope="row">${esc((t ?? e)!.name)}</th>
          <td>${desc(e)}</td>
          <td>${desc(t)}</td>
          <td><span class="tag tag-${tag}">${TAG_TEXT[tag]}</span>${tag !== 'accurate' && s.findings.some((x) => x.unitId === id) ? '<small>found in time</small>' : ''}</td>
        </tr>`;
    })
    .join('');

  const school = d.school.final!;
  const sp = ctx.scenario.schoolSolution;
  const assignments = ctx.era.soviet.formations
    .map((fm) => {
      const p0 = sp.plan.assignment[fm.id] ?? null;
      const p1 = sp.decision[fm.id];
      if (p0 === null && p1 === undefined) return '';
      return `<li><strong>${esc(fm.short)}</strong> ${p0 === null ? 'second echelon' : esc(placeBadge(p0))}${p1 !== undefined ? ` → ${esc(placeBadge(p1))} in phase 2` : ''}</li>`;
    })
    .join('');
  const schoolRoles = ctx.scenario.sectors
    .map((sec) => `${esc(sec.id)}: ${esc(ctx.era.norms.roles[sp.plan.roles[sec.id] ?? sec.defaultRole]?.label ?? '')}`)
    .join(' · ');

  return `
    <main class="debrief">
      <section class="banner verdict-${f.verdict}" role="status">
        <h2>${VERDICT_LABEL[f.verdict]}</h2>
        <p>${verdictText(ctx, s)}</p>
        <p class="muted small">Seed ${s.seed} · readiness at H-hour ${pct(s.readiness)} · recon: ${s.reconned.length ? s.reconned.join(', ') : 'none'}</p>
        <div class="actionbar">
          <button type="button" data-action="replay" title="Same seed: same luck, so only your choices change the result">Replay (same seed)</button>
          <button type="button" data-action="new-seed">Replay with new seed</button>
          <button type="button" class="primary" data-action="menu">Scenarios</button>
        </div>
      </section>

      <section class="panel">
        <h2>Plan versus reality</h2>
        <p class="note">Overall force ratio by sector: as you planned it against the estimate, and as it really was at H-hour.
          Losses are shown as ours / theirs.</p>
        <div class="table-wrap"><table class="debrief-table">
          <thead><tr><th>Sector</th><th>Planned</th><th>Actual</th><th>Phase 1</th><th>Phase 2</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </section>

      <section class="panel">
        <h2>The enemy, revealed</h2>
        <div class="table-wrap"><table class="debrief-table">
          <thead><tr><th>Unit</th><th>Reported</th><th>Actually</th><th></th></tr></thead>
          <tbody>${intel}</tbody>
        </table></div>
      </section>

      <section class="panel">
        <h2>School solution</h2>
        <p>${esc(sp.text)}</p>
        <p class="note">Recon: ${sp.recon.length ? esc(sp.recon.join(', ')) : 'none'} · roles ${schoolRoles}</p>
        <ul class="school-list">${assignments}</ul>
        <p>Played with the same seed: <span class="chip verdict-${school.verdict}">${VERDICT_LABEL[school.verdict]}</span>
          losses ${pct(school.regimentLoss)}.</p>
      </section>
    </main>`;
}
