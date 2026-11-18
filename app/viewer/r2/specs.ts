// The built-in views as json-render specs over the block catalog (lib/r2-blocks.mjs), until
// lib/r2-specs.mjs lands with lane b. A spec names blocks and queries. It never holds a number.
import type { Spec } from '@json-render/react';
import { BLOCK_TYPES, SPEC_LIMITS } from '../../../lib/r2-blocks.mjs';
import type { SavedView, ScopePatch } from './data';

type Element = { type: string; props: Record<string, unknown>; children?: string[] };
/** A pinned question: a saved view, plus the range it opens on. */
export type Pin = SavedView & { range?: ScopePatch['range'] };

const HEADLINES = ['spend', 'merged', 'onMain', 'churn', 'perLanded', 'noCommitSpend'];
const strip: Record<string, Element> = {
  strip: { type: 'Section', props: { title: null, columns: 2 }, children: HEADLINES.map(metric => `headline-${metric}`) },
  ...Object.fromEntries(HEADLINES.map(metric => [`headline-${metric}`, { type: 'Headline', props: { metric } }])),
};
const spec = (children: string[], elements: Record<string, Element>): Spec => ({ root: 'root', elements: { root: { type: 'Section', props: { title: null, columns: 12 }, children }, ...elements } }) as Spec;
const view = (id: string, title: string, question: string | null, body: Spec, range?: Pin['range']): Pin => ({ id, title, question, spec: body, savedAt: '2026-11-18T00:00:00.000Z', origin: 'built-in', range });

const chart: Element = { type: 'SpendLandedChart', props: { stack: 'device' } };
const limits: Element = { type: 'LimitMeter', props: { engine: 'claude' } };
const running: Element = { type: 'SessionsTable', props: { running: true } };

export const OVERVIEW = view('overview', 'Overview', null, spec(['strip', 'body'], {
  ...strip,
  body: { type: 'Section', props: { title: null, columns: 4 }, children: ['main', 'side'] },
  main: { type: 'Section', props: { title: null, columns: 12 }, children: ['chart', 'sessions'] },
  side: { type: 'Section', props: { title: null, columns: 12 }, children: ['limits', 'breakdown', 'running', 'flags'] },
  chart, limits, running,
  sessions: { type: 'SessionsTable', props: { limit: 14 } },
  breakdown: { type: 'Breakdown', props: { metric: 'spend', dim: 'role', limit: 7 } },
  flags: { type: 'Flags', props: { limit: 5 } },
}));

export const SESSIONS = view('sessions', 'Sessions', null, spec(['strip', 'sessions'], {
  ...strip,
  sessions: { type: 'SessionsTable', props: { groupBy: 'role' } },
}));

export const PINS: Pin[] = [
  OVERVIEW,
  view('spend-today', 'Where did today\'s spend go?', 'Where did today\'s spend go?', spec(['thirds', 'chart', 'sessions'], {
    thirds: { type: 'Section', props: { title: null, columns: 4 }, children: ['by-role', 'by-model', 'by-kind'] },
    'by-role': { type: 'Breakdown', props: { metric: 'spend', dim: 'role' } },
    'by-model': { type: 'Breakdown', props: { metric: 'spend', dim: 'model' } },
    'by-kind': { type: 'Breakdown', props: { metric: 'spend', dim: 'kind' } },
    chart, sessions: { type: 'SessionsTable', props: { limit: 14 } },
  }), { unit: 'day' }),
  view('builders-month', 'What did Builders ship this month?', 'What did Builders ship this month?', spec(['strip', 'body'], {
    ...strip,
    body: { type: 'Section', props: { title: null, columns: 4 }, children: ['main', 'side'] },
    main: { type: 'Section', props: { title: null, columns: 12 }, children: ['sessions'] },
    side: { type: 'Section', props: { title: null, columns: 12 }, children: ['breakdown', 'timeline', 'flags'] },
    sessions: { type: 'SessionsTable', props: { role: 'Builder', limit: 14 } },
    breakdown: { type: 'Breakdown', props: { metric: 'onMain', dim: 'repo' } },
    timeline: { type: 'Timeline', props: { series: 'spend' } },
    flags: { type: 'Flags', props: { limit: 5 } },
  }), { unit: 'month' }),
  view('week-last', 'Will the week last?', 'Will the week last?', spec(['halves'], {
    halves: { type: 'Section', props: { title: null, columns: 6 }, children: ['limits', 'timeline', 'running', 'breakdown'] },
    limits, running,
    timeline: { type: 'Timeline', props: { series: 'spend' } },
    breakdown: { type: 'Breakdown', props: { metric: 'spend', dim: 'model' } },
  }), { unit: 'week' }),
  view('needs-me', 'What needs me?', 'What needs me?', spec(['halves', 'sessions'], {
    halves: { type: 'Section', props: { title: null, columns: 6 }, children: ['flags', 'running'] },
    flags: { type: 'Flags', props: { limit: 5 } }, running,
    sessions: { type: 'SessionsTable', props: { limit: 14 } },
  }), { unit: 'week' }),
];

const BLOCK_NAMES: Record<string, string> = {
  Headline: 'Headline numbers', SpendLandedChart: 'Spend and what landed', LimitMeter: 'Limits now', GrokRequests: 'Grok requests', SessionsTable: 'Sessions table',
  Breakdown: 'Where spend went', Timeline: 'Over time', Flags: 'Needs you',
};

/** The blocks a reader can switch off: every leaf block, and a strip of headlines as one. */
export function blockList(body: Spec): { key: string; name: string }[] {
  const out: { key: string; name: string }[] = [];
  const walk = (key: string) => {
    const element = body.elements[key];
    if (!element) return;
    const kids = element.children ?? [];
    if (element.type !== 'Section') out.push({ key, name: element.props.running ? 'Running now' : BLOCK_NAMES[element.type] ?? element.type });
    else if (kids.length > 0 && kids.every(kid => body.elements[kid]?.type === 'Headline')) out.push({ key, name: BLOCK_NAMES.Headline });
    else kids.forEach(walk);
  };
  walk(body.root);
  return out;
}

/** The spec without the blocks that are switched off. */
export function withoutBlocks(body: Spec, hidden: string[]): Spec {
  if (hidden.length === 0) return body;
  const elements = Object.fromEntries(Object.entries(body.elements).filter(([key]) => !hidden.includes(key))
    .map(([key, element]) => [key, element.children ? { ...element, children: element.children.filter(kid => !hidden.includes(kid)) } : element]));
  return { ...body, elements } as Spec;
}

/** A light check of a saved view before it is drawn: known blocks only, within the catalog's limits. */
export function drawable(value: unknown): value is SavedView {
  const row = value as Partial<SavedView> | null;
  const body = row?.spec as Partial<Spec> | undefined;
  if (!row || typeof row.id !== 'string' || !/^[a-z0-9-]{1,48}$/.test(row.id) || typeof row.title !== 'string' || row.title.length > 80) return false;
  if (!body || typeof body.root !== 'string' || !body.elements || typeof body.elements !== 'object' || !body.elements[body.root]) return false;
  const elements = Object.values(body.elements);
  if (elements.length > SPEC_LIMITS.elements || JSON.stringify(body).length > SPEC_LIMITS.bytes) return false;
  return elements.every(element => element && (BLOCK_TYPES as readonly string[]).includes(element.type) && typeof element.props === 'object' && element.props !== null
    && (element.children ?? []).every(key => typeof key === 'string' && key in (body.elements ?? {})));
}

/** The saved views file from GET /local/views.json: a list, or an object holding one. */
export function savedViewsFrom(body: unknown): SavedView[] {
  const list = Array.isArray(body) ? body : Array.isArray((body as { views?: unknown } | null)?.views) ? (body as { views: unknown[] }).views : [];
  return list.filter(drawable).slice(0, SPEC_LIMITS.savedViews).map(row => ({ ...row, origin: 'composed' as const }));
}
