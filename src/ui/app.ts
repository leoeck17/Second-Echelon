// Controller: holds the current screen, dispatches actions to the TDG reducer, runs the
// countdown and re-renders. All game logic lives in core/ and planning/.

import type { EquipmentTable, EraData, Placement, Scenario } from '../core/data';
import { evaluatePlan } from '../planning/plan';
import {
  initialState,
  planContext,
  rateAgainstEstimate,
  simulate,
  tdgReducer,
  type TdgAction,
  type TdgContext,
  type TdgState,
  type Verdict,
} from '../planning/tdg';
import { Countdown } from './timer';
import { formatClock, renderBriefing, renderDebrief, renderDecision, renderHeader, renderMenu, renderPlanning, type Debrief } from './views';

const TIMER_KEY = 'correlation.timer';
const BEST_KEY = 'correlation.best';
const RANK: Record<Verdict, number> = { failure: 1, partial: 2, success: 3 };

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: preferences just don't persist */
  }
}

type Screen = { kind: 'menu' } | { kind: 'game'; ctx: TdgContext; state: TdgState; debrief?: Debrief };

export function mountApp(root: HTMLElement, era: EraData, table: EquipmentTable, scenarios: Scenario[]): void {
  const contexts = scenarios.map((scenario): TdgContext => ({ era, scenario, table }));
  let screen: Screen = { kind: 'menu' };
  let timerOn = load<boolean>(TIMER_KEY, true);
  const best = load<Record<string, Verdict>>(BEST_KEY, {});
  const countdown = new Countdown();

  function timeLimit(ctx: TdgContext, s: TdgState): number | null {
    if (!timerOn) return null;
    const t = ctx.scenario.timeLimitSec;
    if (s.phase === 'planning') return t?.planning ?? null;
    if (s.phase === 'decision') return t?.decision ?? null;
    return null;
  }

  /** Start or stop the countdown when the phase changes. */
  function syncTimer(prev: TdgState | null, next: TdgState, ctx: TdgContext): void {
    if (prev && prev.phase === next.phase && countdown.running === (timeLimit(ctx, next) !== null)) return;
    const limit = timeLimit(ctx, next);
    if (limit === null) {
      countdown.stop();
      return;
    }
    countdown.start(
      limit,
      (left) => {
        const el = root.querySelector<HTMLElement>('#timer');
        if (el) {
          el.textContent = formatClock(left);
          el.classList.toggle('low', left <= 30);
        }
      },
      () => dispatch({ type: 'timeout' }),
    );
  }

  function buildDebrief(ctx: TdgContext, s: TdgState): Debrief {
    const committed = s.committed!;
    const readied = initialState(ctx, s.seed).soviet.map((u) => ({ ...u, readiness: u.readiness * s.readiness }));
    return {
      plannedVsTruth: evaluatePlan(planContext(ctx), ctx.table, committed.plan, { soviet: readied, nato: ctx.scenario.nato.truth }),
      school: simulate(ctx, s.seed, ctx.scenario.schoolSolution),
    };
  }

  function dispatch(action: TdgAction, refocus?: string): void {
    if (screen.kind !== 'game') return;
    const { ctx, state: prev } = screen;
    const next = tdgReducer(ctx, prev, action);
    let debrief = screen.debrief;
    if (next.phase === 'debrief' && prev.phase !== 'debrief') {
      debrief = buildDebrief(ctx, next);
      const v = next.final!.verdict;
      const old = best[ctx.scenario.id];
      if (!old || RANK[v] > RANK[old]) {
        best[ctx.scenario.id] = v;
        save(BEST_KEY, best);
      }
    }
    if (next.phase !== 'debrief') debrief = undefined;
    screen = { kind: 'game', ctx, state: next, debrief };
    syncTimer(prev, next, ctx);
    render();
    if (refocus) root.querySelector<HTMLElement>(refocus)?.focus();
    if (prev.phase !== next.phase) window.scrollTo({ top: 0 });
  }

  function openScenario(id: string): void {
    const ctx = contexts.find((c) => c.scenario.id === id);
    if (!ctx) return;
    countdown.stop();
    screen = { kind: 'game', ctx, state: initialState(ctx) };
    render();
    window.scrollTo({ top: 0 });
  }

  function toMenu(): void {
    countdown.stop();
    screen = { kind: 'menu' };
    render();
    window.scrollTo({ top: 0 });
  }

  function render(): void {
    if (screen.kind === 'menu') {
      root.innerHTML = renderMenu(
        contexts.map((ctx) => ({ ctx, best: best[ctx.scenario.id] ?? null })),
        timerOn,
      );
      return;
    }
    const { ctx, state: s } = screen;
    const left = countdown.left;
    const header = renderHeader(ctx, s);
    const timer = left !== null ? { seconds: left } : null;
    let body = '';
    if (s.phase === 'briefing') body = renderBriefing(ctx, s, timerOn);
    else if (s.phase === 'planning') body = renderPlanning(ctx, s, rateAgainstEstimate(ctx, s), timer);
    else if (s.phase === 'decision') body = renderDecision(ctx, s, rateAgainstEstimate(ctx, s), timer);
    else body = renderDebrief(ctx, s, screen.debrief ?? buildDebrief(ctx, s));
    root.innerHTML = `${header}${body}
      <footer class="foot muted">Potentials in T-55 equivalents. Ratios are Soviet ÷ estimated NATO; small figures show the
        range implied by the intelligence estimate. Norms already include the defender's terrain and preparation.</footer>`;
  }

  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el || el instanceof HTMLInputElement || el instanceof HTMLSelectElement) return;
    const d = el.dataset;
    switch (d.action) {
      case 'play':
        return openScenario(d.scenario!);
      case 'menu':
        return toMenu();
      case 'start':
        return dispatch({ type: 'start' });
      case 'recon':
        return dispatch({ type: 'recon', sectorId: d.sector! });
      case 'assign': {
        const placement: Placement = d.placement || null;
        const sel = `.assign[data-formation="${d.formation}"][data-placement="${d.placement ?? ''}"]`;
        return dispatch({ type: 'assign', formationId: d.formation!, placement }, sel);
      }
      case 'commit':
        return dispatch({ type: 'commit' });
      case 'decide':
        return dispatch({ type: 'decide' });
      case 'replay':
        return dispatch({ type: 'restart' });
      case 'new-seed':
        return dispatch({ type: 'restart', seed: Math.floor(Math.random() * 1e9) });
    }
  });

  root.addEventListener('change', (ev) => {
    const el = ev.target as HTMLInputElement | HTMLSelectElement;
    if (el.dataset.action === 'role') {
      dispatch({ type: 'setRole', sectorId: el.dataset.sector!, role: el.value }, `select[data-sector="${el.dataset.sector}"]`);
    } else if (el.dataset.action === 'toggle-timer') {
      timerOn = (el as HTMLInputElement).checked;
      save(TIMER_KEY, timerOn);
      if (screen.kind === 'game') syncTimer(null, screen.state, screen.ctx);
      render();
    }
  });

  render();
}
