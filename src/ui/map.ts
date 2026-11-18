// The map as SVG: terrain, sectors and depth bands, NATO markers, Soviet counters and axes.
// North is up; the Soviets attack from the right (east). Coordinates are metres; the SVG
// y axis points down, so every y is flipped. Rendering is pure markup; input handling is
// in attachMapInput.

import type { Contact } from '../core/axes';
import type { Unit } from '../core/data';
import type { Pt } from '../core/geom';
import type { MapFeature } from '../core/terrain';
import { attackAxes, axisPath, type Plan } from '../planning/plan';
import type { TdgContext } from '../planning/tdg';
import { escapeHtml as esc } from './format';

export interface MapView {
  plan: Plan;
  /** NATO units to draw (estimate while planning, truth in the debrief). */
  nato: Unit[];
  /** NATO ids to mark, e.g. dummies or units found by recon. */
  tags?: Record<string, string>;
  contacts?: Record<string, Contact>;
  selected: string | null;
  isMovable: (formationId: string) => boolean;
  /** Draw the axes of second-echelon formations too (decision phase). */
  zoom: number;
}

const AREA_STYLE: Record<string, string> = {
  forest: 'map-forest',
  town: 'map-town',
  water: 'map-water',
  marsh: 'map-marsh',
  ridge: 'map-ridge',
};

const UNIT_W = 900;
const UNIT_H = 560;

export function renderMap(ctx: TdgContext, v: MapView): string {
  const { map, scenario } = ctx;
  const H = map.height;
  const fy = (y: number) => H - y;
  const pts = (cs: [number, number][]) => cs.map(([x, y]) => `${x},${fy(y)}`).join(' ');
  const g = scenario.geometry;

  const areas = map.features
    .filter((f): f is MapFeature & { geometry: { type: 'Polygon' } } => f.geometry.type === 'Polygon')
    .map((f) => `<polygon class="${AREA_STYLE[f.properties.kind] ?? ''}" points="${pts(f.geometry.coordinates[0]!)}"><title>${esc(f.properties.name ?? f.properties.kind)} (${f.properties.kind})</title></polygon>`)
    .join('');
  const lines = map.features
    .filter((f): f is MapFeature & { geometry: { type: 'LineString' } } => f.geometry.type === 'LineString')
    .map((f) => `<polyline class="map-${f.properties.kind}" points="${pts(f.geometry.coordinates)}"><title>${esc(f.properties.name ?? f.properties.kind)}</title></polyline>`)
    .join('');
  const points = map.features
    .filter((f): f is MapFeature & { geometry: { type: 'Point' } } => f.geometry.type === 'Point')
    .map((f) => {
      const [x, y] = f.geometry.coordinates;
      return f.properties.kind === 'crossing'
        ? `<circle class="map-crossing" cx="${x}" cy="${fy(y)}" r="160"><title>${esc(f.properties.name ?? 'Crossing')}</title></circle>`
        : `<text class="map-place" x="${x}" y="${fy(y)}">${esc(f.properties.name ?? '')}</text>`;
    })
    .join('');

  // Depth bands east of the line of contact, and the sector lanes.
  const ys = scenario.sectors.flatMap((s) => s.yRange);
  const zone: [number, number] = [Math.min(...ys), Math.max(...ys)];
  const bandNames: [keyof typeof g.bands, string][] = [
    ['first', '1st echelon'],
    ['second', '2nd echelon'],
    ['reserve', 'Assembly / reserve'],
    ['generalSupport', 'Artillery GS'],
  ];
  const bands = bandNames
    .map(([k, label], i) => {
      const [x0, x1] = g.bands[k];
      return `<rect class="band band-${i}" x="${x0}" y="${fy(H)}" width="${x1 - x0}" height="${H}"/>
        <text class="band-label" x="${(x0 + x1) / 2}" y="${fy(H) + 380}">${label}</text>`;
    })
    .join('');
  const lanes = scenario.sectors
    .map((s) => {
      const [y0, y1] = s.yRange;
      return `<line class="lane" x1="0" x2="${map.width}" y1="${fy(y0)}" y2="${fy(y0)}"/><line class="lane" x1="0" x2="${map.width}" y1="${fy(y1)}" y2="${fy(y1)}"/>
        <text class="lane-label" x="${map.width - 250}" y="${fy((y0 + y1) / 2)}">${esc(s.id)}</text>`;
    })
    .join('');
  const flot = `<line class="flot" x1="${g.lineOfContactX}" x2="${g.lineOfContactX}" y1="0" y2="${H}"/>
    <text class="flot-label" x="${g.lineOfContactX - 150}" y="${fy(zone[1]) - 250}">Line of contact</text>`;
  const objectives = g.objectives
    .map((o) => `<g class="objective"><circle cx="${o.x}" cy="${fy(o.y)}" r="380"/><text x="${o.x}" y="${fy(o.y) + 900}">${esc(o.name.split(':')[0]!)}</text><title>${esc(o.name)}</title></g>`)
    .join('');

  // Axes of advance.
  const pc = { era: ctx.era, scenario, map };
  const attacking = new Set(attackAxes(pc, v.plan).map((a) => a.formationId));
  const axes = ctx.era.soviet.formations
    .filter((f) => !f.canSpread && (attacking.has(f.id) || v.selected === f.id) && v.plan.echelon[f.id] !== 'reserve')
    .map((f) => {
      const path = axisPath(pc, v.plan, f.id);
      if (path.length < 2) return '';
      const sel = v.selected === f.id;
      const wps = (v.plan.axes[f.id] ?? [])
        .map((p) => `<circle class="waypoint" cx="${p.x}" cy="${fy(p.y)}" r="${sel ? 200 : 120}"/>`)
        .join('');
      return `<polyline class="axis${sel ? ' selected' : ''}${attacking.has(f.id) ? '' : ' pending'}" points="${path.map((p) => `${p.x},${fy(p.y)}`).join(' ')}" marker-end="url(#arrow)"/>${wps}`;
    })
    .join('');

  // NATO markers.
  const natoMarks = v.nato
    .filter((u) => u.pos && u.placement !== null)
    .map((u) => {
      const p = u.pos!;
      const status = u.intel?.status ?? 'confirmed';
      const c = v.contacts?.[u.id];
      const contact = c ? (c.engaged.length ? 'engaged' : c.encircled.length ? 'encircled' : 'bypassed') : '';
      const tag = v.tags?.[u.id];
      return `<g class="nato-mark ${status} ${contact}" transform="translate(${p.x},${fy(p.y)})">
        <rect x="${-UNIT_W / 2}" y="${-UNIT_H / 2}" width="${UNIT_W}" height="${UNIT_H}"/>
        <text y="120">${esc(u.id)}</text>
        ${tag ? `<text class="mark-tag" y="${UNIT_H / 2 + 330}">${esc(tag)}</text>` : contact ? `<text class="mark-tag" y="${UNIT_H / 2 + 330}">${contact}</text>` : ''}
        <title>${esc(u.name)} — ${status}${contact ? `, ${contact}` : ''}${tag ? `, ${tag}` : ''}</title></g>`;
    })
    .join('');

  // Soviet counters.
  const counters = ctx.era.soviet.formations
    .map((f) => {
      const p = v.plan.positions[f.id];
      if (!p) return '';
      const movable = v.isMovable(f.id);
      const sel = v.selected === f.id;
      const ech = v.plan.echelon[f.id];
      const w = Math.max(UNIT_W, f.short.length * 175 + 160);
      return `<g class="sov-counter${sel ? ' selected' : ''}${movable ? '' : ' locked'}${f.canSpread ? ' fires' : ''} ech-${ech}" data-fid="${f.id}" transform="translate(${p.x},${fy(p.y)})" tabindex="-1">
        <rect x="${-w / 2}" y="${-UNIT_H / 2}" width="${w}" height="${UNIT_H}"/>
        <text y="120">${esc(f.short)}</text><title>${esc(f.name)}${movable ? '' : ' (in contact)'}</title></g>`;
    })
    .join('');

  return `
    <div class="map-scroll" id="map-scroll">
      <svg id="map" class="map" viewBox="0 0 ${map.width} ${H}" style="width:${Math.round(v.zoom * 100)}%" role="img"
        aria-label="Map: ${esc(map.name)}. North is up; your regiment attacks from the right." data-h="${H}">
        <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" class="arrow-head"/></marker></defs>
        <rect class="map-open" x="0" y="0" width="${map.width}" height="${H}" data-ground="1"/>
        <g class="layer-areas">${areas}</g>
        <g class="layer-bands">${bands}</g>
        <g class="layer-lines">${lines}</g>
        <g class="layer-points">${points}</g>
        <g class="layer-lanes">${lanes}${flot}${objectives}</g>
        <g class="layer-axes">${axes}</g>
        <g class="layer-nato">${natoMarks}</g>
        <g class="layer-sov">${counters}</g>
        <g class="compass" transform="translate(600,${fy(H) + 900})"><path d="M0,-500 L180,0 L0,-120 L-180,0 z"/><text y="350">N</text></g>
      </svg>
    </div>`;
}

export interface MapHandlers {
  /** A counter was tapped (selected) without moving. */
  select: (formationId: string) => void;
  /** A counter was dragged and dropped at a point. */
  drop: (formationId: string, p: Pt) => void;
  /** The map (not a counter) was tapped at a point. */
  tap: (p: Pt) => void;
}

/** Convert a pointer event on the map to map metres. */
function toMap(svg: SVGSVGElement, ev: PointerEvent): Pt | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
  const h = Number(svg.dataset.h);
  return { x: pt.x, y: h - pt.y };
}

/**
 * Pointer input on the map, delegated from root so it survives re-renders. Dragging a
 * counter moves it; a tap selects a counter or reports a point on the map. Works the
 * same for mouse, pen and touch.
 */
export function attachMapInput(root: HTMLElement, h: MapHandlers): void {
  let drag: { fid: string; el: SVGGElement; start: Pt; moved: boolean; id: number; base: string } | null = null;
  let tapStart: { x: number; y: number; id: number } | null = null;
  const SLOP = 8; // px before a press counts as a drag

  root.addEventListener('pointerdown', (ev) => {
    const target = ev.target as Element;
    const svg = target.closest<SVGSVGElement>('svg#map');
    if (!svg) return;
    const counter = target.closest<SVGGElement>('.sov-counter');
    if (counter && !counter.classList.contains('locked')) {
      drag = { fid: counter.dataset.fid!, el: counter, start: { x: ev.clientX, y: ev.clientY }, moved: false, id: ev.pointerId, base: counter.getAttribute('transform') ?? '' };
      counter.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    } else if (counter) {
      h.select(counter.dataset.fid!);
    } else {
      tapStart = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
    }
  });

  root.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.start.x, ev.clientY - drag.start.y) < SLOP) return;
    drag.moved = true;
    const svg = drag.el.ownerSVGElement;
    if (!svg) return;
    const p = toMap(svg, ev);
    if (p) drag.el.setAttribute('transform', `translate(${p.x},${Number(svg.dataset.h) - p.y})`);
    drag.el.classList.add('dragging');
  });

  const end = (ev: PointerEvent, cancelled: boolean) => {
    if (drag && ev.pointerId === drag.id) {
      const d = drag;
      drag = null;
      const svg = d.el.ownerSVGElement;
      if (cancelled || !svg) {
        d.el.setAttribute('transform', d.base);
        return;
      }
      if (d.moved) {
        const p = toMap(svg, ev);
        if (p) h.drop(d.fid, p);
      } else {
        h.select(d.fid);
      }
      return;
    }
    if (tapStart && ev.pointerId === tapStart.id) {
      const moved = Math.hypot(ev.clientX - tapStart.x, ev.clientY - tapStart.y) >= SLOP;
      tapStart = null;
      const svg = (ev.target as Element).closest<SVGSVGElement>('svg#map');
      if (!moved && !cancelled && svg) {
        const p = toMap(svg, ev);
        if (p) h.tap(p);
      }
    }
  };
  root.addEventListener('pointerup', (ev) => end(ev, false));
  root.addEventListener('pointercancel', (ev) => end(ev, true));
}
