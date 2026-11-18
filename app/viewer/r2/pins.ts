// The views the Overview can show: the built-in specs and pinned questions from lib/r2-specs.mjs (the one
// source), saved views, and the answer the Ask field composes. Also the pure steps behind the Ask field, a
// pin click and the back button, so the tests can run them without a browser.
import type { Spec } from '@json-render/react';
import { SPEC_LIMITS } from '../../../lib/r2-blocks.mjs';
import { checkSavedView } from '../../../lib/r2-catalog.mjs';
import { PINNED_QUESTIONS, VIEW_SPECS } from '../../../lib/r2-specs.mjs';
import { answerQuestion, patchScope, type AskAnswer, type SavedView, type Scope, type ScopePatch, type ViewId } from './data';
import { viewFromHash } from './Nav';

/** A view the Overview can draw, plus what it sets on the scope bar when it opens. */
export type Pin = SavedView & { patch?: ScopePatch | null };

export const OVERVIEW: Pin = VIEW_SPECS.overview as Pin;
export const SESSIONS: Pin = VIEW_SPECS.sessions as Pin;
export const PINS: Pin[] = [OVERVIEW, ...PINNED_QUESTIONS.map(pin => ({ ...pin.view, patch: pin.patch }) as Pin)];

/** Built-in pins first, then saved views whose id no built-in pin uses. */
export function pinsWith(saved: SavedView[]): Pin[] {
  return [...PINS, ...saved.filter(row => !PINS.some(pin => pin.id === row.id))];
}

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

/** The saved views file from GET /local/views.json: a list, or an object holding one. Each view passes the catalog check before it is drawn. */
export function savedViewsFrom(body: unknown): SavedView[] {
  const list = Array.isArray(body) ? body : Array.isArray((body as { views?: unknown } | null)?.views) ? (body as { views: unknown[] }).views : [];
  return list.filter(row => checkSavedView(row).ok).slice(0, SPEC_LIMITS.savedViews).map(row => ({ ...row, origin: 'composed' as const }));
}

/** What the Overview shows after a question or a pin click. */
export type Opened = { pin: Pin; question: string | null; missed: boolean; answer: AskAnswer | null };

/**
 * The Ask field. A pinned question or a saved view opens that pin. A rule answer opens the spec it composed,
 * with the range, devices and sources the question named. Nothing matched opens the Overview with a note.
 */
export function askFor(text: string, pins: Pin[], { now, timeZone = 'UTC' }: { now?: number; timeZone?: string } = {}): Opened {
  const answer = answerQuestion(text, { savedViews: pins, now, timeZone });
  if (!answer.view) return { pin: OVERVIEW, question: text, missed: true, answer: null };
  const listed = answer.view.id === 'ask' ? undefined : pins.find(row => row.id === answer.view?.id);
  const pin: Pin = listed ? { ...listed, patch: answer.patch ?? listed.patch ?? null } : { ...answer.view, patch: answer.patch };
  return { pin, question: text, missed: false, answer };
}

/**
 * The scope a pin opens on: its patch over the current scope, with a range that names no day anchored on today.
 * A pin with no patch (the Overview, a saved view, Clear) opens on the base scope, so an Ask's filter does not linger.
 */
export function scopeFor(pin: Pin, scope: Scope, today: string, base: Scope = scope): Scope {
  const patch = pin.patch;
  if (!patch) return base;
  return patchScope(scope, patch.range && !patch.range.anchor ? { ...patch, range: { ...patch.range, anchor: today } } : patch);
}

/** The screen the address names, read again after the back button or an edited hash. */
export function fromAddress(hash: string, search: string): { view: ViewId; search: string } {
  return { view: viewFromHash(hash), search };
}
