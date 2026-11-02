// Display helpers for the UI.

import type { NormStatus } from '../core/cofm';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** "3.2:1", "12:1", "∞" (unopposed), "—" (nothing on either side). */
export function formatRatio(r: number): string {
  if (Number.isNaN(r)) return '—';
  if (r === Infinity) return '∞';
  if (r >= 10) return `${Math.round(r)}:1`;
  return `${r.toFixed(1)}:1`;
}

/** Compact range of two ratios without the ":1": "5.1–6.3". */
export function formatRatioRange(low: number, high: number): string {
  const f = (r: number) => formatRatio(r).replace(':1', '');
  return `${f(low)}–${f(high)}`;
}

export function formatNorm(required: number): string {
  return `${Number.isInteger(required) ? required : required.toFixed(1)}:1`;
}

export function formatPotential(p: number): string {
  return p === 0 ? '–' : p.toFixed(1);
}

export const STATUS_GLYPH: Record<NormStatus, string> = { green: '✓', amber: '≈', red: '✗', none: '' };
export const STATUS_TEXT: Record<NormStatus, string> = {
  green: 'meets norm',
  amber: 'close to norm',
  red: 'below norm',
  none: 'no forces on either side',
};
