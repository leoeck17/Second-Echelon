// Controller: holds the current screen, dispatches actions to the TDG reducer, runs the
// countdown and re-renders. All game logic lives in core/ and planning/.

import type { EquipmentTable, EraData, Placement, Scenario } from '../core/data';
import type { MapData } from '../core/terrain';
import { evaluatePlan, type PlanResult } from '../planning/plan';
import {
  initialState,
  movableInDecision,
  planContext,
  rateAgainstEstimate,
  simulate,
  tdgReducer,
  type TdgAction,
  type TdgContext,
  type TdgState,
  type Verdict,
} from '../planning/tdg';
import { escapeHtml } from './format';
import { attachMapInput, renderMap } from './map';
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

export function mountApp(root: HTMLElement, era: EraData, table: EquipmentTable, scenarios: Scenario[], maps: Record<string, MapData>): void {
  const contexts = scenarios.map((scenario): TdgContext => ({ era, scenario, table, map: maps[scenario.map]! }));
  // Map interaction state (UI only, not part of the game state).
  let selected: string | null = null;
  let mode: 'move' | 'axis' = 'move';
  let zoom = window.innerWidth < 700 ? 2.5 : 1;
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

  const movable = (ctx: TdgContext, s: TdgState, id: string) =>
    s.phase === 'planning' || (s.phase === 'decision' && movableInDecision(ctx, s, id));

  function renderMapBlock(ctx: TdgContext, s: TdgState, contacts: PlanResult['contacts'] | undefined): string {
    const sel = selected ? ctx.era.soviet.formations.find((f) => f.id === selected) : undefined;
    const canMove = !!sel && movable(ctx, s, sel.id);
    const hint = !sel
      ? 'Tap a unit (on the map or its name in the list) to select it, or drag it to a new position.'
      : !canMove
        ? `${sel.short} is in contact and cannot be moved.`
        : mode === 'axis'
          ? `Tap the map to add a waypoint to ${sel.short}'s axis of advance. It continues west from the last waypoint.`
          : `Tap the map to move ${sel.short} there, or drag it. Depth bands set the echelon.`;
    const tools = sel && canMove
      ? `<button type="button" data-action="mode-move" aria-pressed="${mode === 'move'}" class="${mode === 'move' ? 'on' : ''}">Move</button>
         ${sel.canSpread ? '' : `<button type="button" data-action="mode-axis" aria-pressed="${mode === 'axis'}" class="${mode === 'axis' ? 'on' : ''}">Draw axis</button>
         <button type="button" data-action="axis-undo">Undo point</button>
         <button type="button" data-action="axis-clear">Straight axis</button>`}
         <button type="button" data-action="deselect">Done</button>`
      : '';
    return `
      <section class="panel map-panel" aria-label="Map">
        <div class="map-toolbar">
          <span class="map-hint">${escapeHtml(hint)}</span>
          <span class="map-tools">${tools}
            <button type="button" data-action="zoom-out" title="Zoom out">−</button>
            <button type="button" data-action="zoom-in" title="Zoom in">+</button></span>
        </div>
        ${renderMap(ctx, {
          plan: s.plan,
          nato: s.estimate,
          contacts,
          selected,
          isMovable: (id) => movable(ctx, s, id),
          zoom,
        })}
      </section>`;
  }

  function renderDebriefMap(ctx: TdgContext, s: TdgState): string {
    const truthIds = new Set(ctx.scenario.nato.truth.map((u) => u.id));
    const estIds = new Set(ctx.scenario.nato.estimate.map((u) => u.id));
    const tags: Record<string, string> = {};
    for (const id of s.encircled ?? []) tags[id] = 'encircled';
    for (const id of s.cutOff ?? []) tags[id] = 'cut off';
    for (const u of ctx.scenario.nato.truth) if (!estIds.has(u.id)) tags[u.id] = 'unreported';
    const dummies = ctx.scenario.nato.estimate
      .filter((u) => !truthIds.has(u.id))
      .map((u) => ({ ...u, intel: { status: 'unknown' as const, low: 0, high: 0 } }));
    for (const u of dummies) tags[u.id] = 'dummy';
    return renderMap(ctx, {
      plan: s.plan,
      nato: [...ctx.scenario.nato.truth, ...dummies],
      tags,
      contacts: s.contacts1,
      selected: null,
      isMovable: () => false,
      zoom,
    });
  }

  function openScenario(id: string): void {
    selected = null;
    mode = 'move';
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
    else if (s.phase === 'planning' || s.phase === 'decision') {
      const result = rateAgainstEstimate(ctx, s);
      const mapBlock = renderMapBlock(ctx, s, result.contacts);
      body = s.phase === 'planning'
        ? renderPlanning(ctx, s, result, timer, mapBlock, selected)
        : renderDecision(ctx, s, result, timer, mapBlock, selected);
    } else body = renderDebrief(ctx, s, screen.debrief ?? buildDebrief(ctx, s), renderDebriefMap(ctx, s));
    // Keep the map's scroll position across re-renders.
    const sc = root.querySelector<HTMLElement>('#map-scroll');
    const keep = sc ? { left: sc.scrollLeft, top: sc.scrollTop } : null;
    root.innerHTML = `${header}${body}
      <footer class="foot muted">Potentials in T-55 equivalents. Ratios are Soviet ÷ estimated NATO; small figures show the
        range implied by the intelligence estimate. NATO potential is multiplied by the terrain it holds.</footer>`;
    const sc2 = root.querySelector<HTMLElement>('#map-scroll');
    if (sc2 && keep) {
      sc2.scrollLeft = keep.left;
      sc2.scrollTop = keep.top;
    } else if (sc2 && zoom > 1) {
      sc2.scrollLeft = sc2.scrollWidth - sc2.clientWidth; // start at the Soviet (east) side
    }
  }

  function game(): { ctx: TdgContext; state: TdgState } | null {
    return screen.kind === 'game' ? screen : null;
  }

  attachMapInput(root, {
    select: (fid) => {
      selected = selected === fid ? null : fid;
      mode = 'move';
      render();
    },
    drop: (fid, pos) => {
      selected = fid;
      dispatch({ type: 'place', formationId: fid, pos });
    },
    tap: (pos) => {
      const g = game();
      if (!g || !selected || !movable(g.ctx, g.state, selected)) return;
      if (mode === 'axis') {
        const waypoints = [...(g.state.plan.axes[selected] ?? []), pos];
        dispatch({ type: 'setAxis', formationId: selected, waypoints });
      } else {
        dispatch({ type: 'place', formationId: selected, pos });
      }
    },
  });

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
      case 'second':
        return dispatch({ type: 'second', formationId: d.formation!, sectorId: d.placement! });
      case 'select':
        selected = selected === d.formation ? null : d.formation!;
        mode = 'move';
        render();
        root.querySelector('#map-scroll')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      case 'deselect':
        selected = null;
        mode = 'move';
        return render();
      case 'mode-move':
        mode = 'move';
        return render();
      case 'mode-axis':
        mode = 'axis';
        return render();
      case 'axis-undo':
      case 'axis-clear': {
        const g = game();
        if (!g || !selected) return;
        const cur = g.state.plan.axes[selected] ?? [];
        return dispatch({ type: 'setAxis', formationId: selected, waypoints: d.action === 'axis-undo' ? cur.slice(0, -1) : [] });
      }
      case 'zoom-in':
      case 'zoom-out':
        zoom = Math.max(1, Math.min(4, zoom * (d.action === 'zoom-in' ? 1.5 : 1 / 1.5)));
        return render();
      case 'commit':
        selected = null;
        return dispatch({ type: 'commit' });
      case 'decide':
        selected = null;
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
