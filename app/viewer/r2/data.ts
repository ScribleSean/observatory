// The one seam between the round 2 blocks and the view-models. Every block reads its numbers here,
// from lib/scope.mjs and the documented builders in lib/view-r2.mjs.
import { createContext, useContext } from 'react';
import type { Spec } from '@json-render/react';

export { defaultScope, patchScope, scopeToSearch, scopeFromSearch } from '../../../lib/scope.mjs';
export { buildFrame, buildOverview, buildSessions, buildTokens, buildScreenTime, metric, answerQuestion, resolveBlock } from '../../../lib/view-r2.mjs';

export type Scope = import('../../../lib/scope.mjs').Scope;
export type ScopePatch = import('../../../lib/scope.mjs').ScopePatch;
export type Period = import('../../../lib/scope.mjs').Period;
export type RangeUnit = import('../../../lib/scope.mjs').RangeUnit;
export type DeviceChip = import('../../../lib/scope.mjs').DeviceChip;
export type Num = import('../../../lib/view-r2.mjs').Num;
export type Part = import('../../../lib/view-r2.mjs').Part;
export type Frame = import('../../../lib/view-r2.mjs').Frame;
export type DayPoint = import('../../../lib/view-r2.mjs').DayPoint;
export type OverviewVM = import('../../../lib/view-r2.mjs').OverviewVM;
export type SessionsVM = import('../../../lib/view-r2.mjs').SessionsVM;
export type SessionRow = import('../../../lib/view-r2.mjs').SessionRow;
export type AskAnswer = import('../../../lib/view-r2.mjs').AskAnswer;
export type MetricId = import('../../../lib/r2-blocks.mjs').MetricId;
export type Dim = import('../../../lib/r2-blocks.mjs').Dim;
export type SavedView = import('../../../lib/r2-blocks.mjs').SavedView;
export type Snapshot = Record<string, unknown>;
export type ViewId = 'overview' | 'sessions' | 'limits' | 'tokens' | 'screen-time' | 'drift' | 'settings';

/** True when the snapshot carries the daily ledger history round 2 reads. */
export function hasHistory(snapshot: Snapshot | null): boolean {
  const view = snapshot?.view as { ledgerHistory?: unknown } | undefined;
  return Array.isArray(view?.ledgerHistory) && view.ledgerHistory.length > 0;
}

// ---------- what every block shares ----------

export type Ui = {
  snapshot: Snapshot;
  scope: Scope;
  now: number;
  frame: Frame;
  view: ViewId;
  today: string;
  openMetric: MetricId | null;
  selected: string | null;
  setScope: (next: Scope) => void;
  toggleMetric: (id: MetricId) => void;
  openSession: (key: string | null) => void;
};
export const R2Context = createContext<Ui | null>(null);
export function useR2(): Ui {
  const ui = useContext(R2Context);
  if (!ui) throw new Error('A round 2 block was drawn outside the dashboard');
  return ui;
}
export const SpecContext = createContext<Spec | null>(null);
export const StripContext = createContext(false);

// ---------- wording and formats ----------

export const UNKNOWN = 'Unknown';
export const METRIC_LABELS: Record<MetricId, string> = {
  spend: 'Spend', merged: 'Branches merged', onMain: 'Commits on main', churn: 'Churn', perLanded: 'Cost per landed change', noCommitSpend: 'Spend with no commits',
  tokens: 'Tokens', screenTime: 'Screen time', grokRequests: 'Grok requests', sessions: 'Sessions', subagents: 'Subagents',
};
export const DIM_LABELS: Record<Dim, string> = {
  device: 'Device', role: 'Role', session: 'Session', repo: 'Repo', model: 'Model', kind: 'Work', origin: 'How it ran', tool: 'Source', agent: 'Agent', category: 'Kind of app',
};
export const SPEND_METRICS: MetricId[] = ['spend', 'perLanded', 'noCommitSpend'];
export const HOST_TINTS: Record<string, string> = { Mac: 'mac', Windows: 'pc', Linux: 'ubuntu' };

export const count = (value: number | null) => value === null ? UNKNOWN : Math.round(value).toLocaleString('en-US');
export const share = (value: number | null) => value === null ? '' : `${value > 0 && value < 10 ? value.toFixed(1) : Math.round(value)}%`;
export const plural = (value: number, word: string) => `${count(value)} ${word}${Math.round(value) === 1 ? '' : 's'}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10);
export const dayLabel = (date: string, long = false) => `${long ? `${DAYS[utc(date).getUTCDay()]} ` : ''}${MONTHS[utc(date).getUTCMonth()]} ${utc(date).getUTCDate()}`;
export const weekdayLabel = (date: string) => `${DAYS[utc(date).getUTCDay()]} ${utc(date).getUTCDate()}`;
export const monthLabel = (date: string) => MONTHS[utc(date).getUTCMonth()];

export function clock(time: string | null, timeZone: string): string {
  const at = Date.parse(time ?? '');
  return Number.isFinite(at) ? new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(at)) : UNKNOWN;
}
export function started(time: string | null, timeZone: string): string {
  const at = Date.parse(time ?? '');
  return Number.isFinite(at) ? new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(at)).replace(',', '') : UNKNOWN;
}

/** Every bucket of the period's chart, with the ones still ahead, so a week always draws seven columns. */
export function bucketDates(period: Period): string[] {
  const first = utc(period.first), year = first.getUTCFullYear(), month = first.getUTCMonth();
  if (period.unit === 'week') return Array.from({ length: 7 }, (_, index) => isoDate(first.getTime() + index * 86400000));
  if (period.unit === 'month') return Array.from({ length: new Date(Date.UTC(year, month + 1, 0)).getUTCDate() }, (_, index) => isoDate(Date.UTC(year, month, index + 1)));
  if (period.unit === 'year') return Array.from({ length: 12 }, (_, index) => isoDate(Date.UTC(year, index, 1)));
  if (period.unit === 'all') return [...new Set(period.dates.map(date => `${date.slice(0, 7)}-01`))];
  return [period.first];
}

/** What sits beside the stepper label: "This week", "Yesterday". */
export function periodNote(period: Period, today: string): string {
  const { unit, current, first, last } = period;
  if (unit === 'all' || unit === 'year') return '';
  if (current) return unit === 'day' ? 'Today' : `This ${unit}`;
  const daysBack = Math.round((utc(today).getTime() - utc(last).getTime()) / 86400000);
  if (unit === 'day') return daysBack === 1 ? 'Yesterday' : '';
  if (unit === 'week') return daysBack >= 1 && daysBack <= 7 ? 'Last week' : '';
  const before = new Date(Date.UTC(utc(today).getUTCFullYear(), utc(today).getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  return first.slice(0, 7) === before ? 'Last month' : '';
}
