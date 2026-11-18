// The block catalog as json-render sees it: one zod schema per block (lib/r2-blocks.mjs), and the
// checks every spec passes before it is saved or drawn. See docs/R2-PLAN.md.
//
// catalog.validate in json-render 0.22.0 checks element types but not each element's props, so
// checkSpec also parses every element's props with its own strict schema. Strict schemas refuse any
// prop the catalog does not name, so a spec cannot carry numbers or titles in a stray field.

import './zod-config.mjs';
import { defineCatalog, validateSpec } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { z } from 'zod';
import { BLOCK_TYPES, METRICS, DIMS, METRIC_DIMS, SPEC_LIMITS } from './r2-blocks.mjs';
import { ROLES } from './roles.mjs';
import { RANGE_UNITS, SOURCE_IDS, HOSTS, validDate } from './scope.mjs';

const scopePatch = z.object({
  devices: z.array(z.enum(HOSTS)).min(1).max(HOSTS.length).optional(),
  range: z.object({
    unit: z.enum(RANGE_UNITS).optional(),
    anchor: z.string().refine(validDate, 'a YYYY-MM-DD date').optional(),
  }).strict().optional(),
  sources: z.array(z.enum(SOURCE_IDS)).min(1).max(SOURCE_IDS.length).optional(),
}).strict();

// Every block can say how many of 12 columns and how many rows it covers.
const place = {
  span: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(12)]).optional(),
  rows: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
};
const metric = z.enum(METRICS);
// Control characters, and the bidirectional marks and overrides that can make text read in a different order
// than it is stored (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069).
// oxlint-disable-next-line no-control-regex -- refusing control characters is the point
const CONTROL = /[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const plainText = z.string().max(80).refine(text => !CONTROL.test(text), 'has control characters');
const dim = z.enum(DIMS);

/** The props schema of each block, strict. */
export const PROP_SCHEMAS = Object.freeze({
  Section: z.object({ title: plainText.nullable(), columns: z.union([1, 2, 3, 4, 6, 12].map(value => z.literal(value))), ...place }).strict(),
  Headline: z.object({ metric, compare: z.boolean().optional(), breakdowns: z.array(dim).max(DIMS.length).optional(), scope: scopePatch.optional(), ...place }).strict(),
  SpendLandedChart: z.object({ stack: z.enum(['device', 'model', 'role']).nullable().optional(), scope: scopePatch.optional(), ...place }).strict(),
  SessionsTable: z.object({
    groupBy: z.enum(['role', 'device', 'repo']).nullable().optional(), role: z.enum(ROLES).nullable().optional(), running: z.boolean().optional(),
    sort: z.enum(['spend', 'onMain', 'perLanded', 'startedAt']).optional(), limit: z.number().int().min(1).max(500).optional(),
    scope: scopePatch.optional(), ...place,
  }).strict(),
  Breakdown: z.object({ metric, dim, limit: z.number().int().min(1).max(50).optional(), scope: scopePatch.optional(), ...place }).strict(),
  LimitMeter: z.object({ engine: z.enum(SOURCE_IDS), window: z.string().regex(/^[a-z0-9_]{1,32}$/).nullable().optional(), history: z.boolean().optional(), ...place }).strict(),
  GrokRequests: z.object({ scope: scopePatch.optional(), ...place }).strict(),
  Timeline: z.object({ series: z.enum(['spend', 'tokens', 'screenTime', 'grokRequests', 'subagents']), by: dim.nullable().optional(), scope: scopePatch.optional(), ...place }).strict(),
  Flags: z.object({ limit: z.number().int().min(1).max(10).optional(), scope: scopePatch.optional(), ...place }).strict(),
});

/** What each block shows, for the catalog an agent reads (scripts/mcp-server.mjs get_catalog). */
export const DESCRIPTIONS = Object.freeze({
  Section: 'The one container. Lays its children on a 12 column grid, each spanning `columns` unless it sets `span`.',
  Headline: 'One metric over the scope, with its comparison and a breakdown that opens in place.',
  SpendLandedChart: 'Spend per day (per month for year and all) over commits on main and commits not yet on main.',
  SessionsTable: 'Sessions ranked by spend, as "[role] object", with commits on main and cost per landed change.',
  Breakdown: 'One metric split by one dimension as a ranked bar list.',
  LimitMeter: 'One engine\'s account limit windows, read once, with the computer they were read on.',
  GrokRequests: 'Grok requests per day and its weekly limit. Never added to dollars or tokens.',
  Timeline: 'One series per day (per month for year and all), optionally split.',
  Flags: 'Lines that need the user: stale computers, a landed rate that fell, sessions with nothing on main.',
});

/** The json-render catalog: the same blocks for built-in and composed screens. */
export const catalog = defineCatalog(schema, {
  components: Object.fromEntries(BLOCK_TYPES.map(type => [type, { props: PROP_SCHEMAS[type], slots: type === 'Section' ? ['default'] : [], description: DESCRIPTIONS[type] }])),
  actions: {},
});

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const issueText = (key, error) => error.issues.map(issue => `${key}: ${issue.path.join('.') || 'props'} ${issue.message}`);

// A metric splits only by the dimensions it supports (METRIC_DIMS): a commit is not made by a model.
function dimErrors(key, type, props) {
  const dims = METRIC_DIMS[props.metric];
  if (!dims) return [];
  const wanted = type === 'Breakdown' ? [props.dim] : type === 'Headline' ? props.breakdowns ?? [] : [];
  const bad = wanted.filter(dim => !dims.includes(dim));
  return bad.length ? [`${key}: ${props.metric} does not split by ${bad.join(', ')} (it splits by ${dims.join(', ') || 'nothing'})`] : [];
}

/**
 * Checks a spec against the catalog and SPEC_LIMITS. The root is a Section, only Sections have
 * children, every element is reachable from the root, and no element appears twice in the tree.
 * @param {unknown} spec
 * @returns {{ok: true, spec: {root: string, elements: Record<string, object>}} | {ok: false, errors: string[]}}
 */
export function checkSpec(spec) {
  const errors = [];
  let bytes;
  try { bytes = new TextEncoder().encode(JSON.stringify(spec)).length; } catch { return { ok: false, errors: ['spec is not JSON'] }; }
  if (!object(spec) || typeof spec.root !== 'string' || !object(spec.elements)) return { ok: false, errors: ['spec needs a root key and an elements map'] };
  if (bytes > SPEC_LIMITS.bytes) errors.push(`spec is ${bytes} bytes, over ${SPEC_LIMITS.bytes}`);
  const keys = Object.keys(spec.elements);
  if (keys.length > SPEC_LIMITS.elements) errors.push(`spec has ${keys.length} elements, over ${SPEC_LIMITS.elements}`);
  if (errors.length) return { ok: false, errors };
  for (const key of keys) if (!/^[A-Za-z0-9_-]{1,48}$/.test(key)) errors.push(`element key "${key.slice(0, 48)}" is not letters, digits, dashes or underscores`);
  for (const [key, element] of Object.entries(spec.elements)) {
    if (!object(element)) { errors.push(`${key}: not an object`); continue; }
    const extra = Object.keys(element).filter(field => !['type', 'props', 'children'].includes(field));
    if (extra.length) errors.push(`${key}: unknown fields ${extra.join(', ')}`);
    if (!BLOCK_TYPES.includes(element.type)) { errors.push(`${key}: unknown block ${String(element.type).slice(0, 40)}`); continue; }
    const parsed = PROP_SCHEMAS[element.type].safeParse(element.props);
    if (!parsed.success) errors.push(...issueText(key, parsed.error));
    else errors.push(...dimErrors(key, element.type, parsed.data));
    const children = element.children ?? [];
    if (!Array.isArray(children)) errors.push(`${key}: children is not a list`);
    else if (element.type !== 'Section' && children.length) errors.push(`${key}: only a Section has children`);
    // Own keys only: "constructor" or "__proto__" would otherwise find a member every object inherits.
    else for (const child of children)
      if (typeof child !== 'string' || !Object.hasOwn(spec.elements, child)) errors.push(`${key}: child ${String(child).slice(0, 48)} is not an element`);
  }
  if (!Object.hasOwn(spec.elements, spec.root)) errors.push(`the root ${spec.root.slice(0, 48)} is not an element`);
  if (errors.length) return { ok: false, errors };
  // A leaf may leave children out. json-render's own check wants the list, so it sees an empty one.
  const full = { ...spec, elements: Object.fromEntries(Object.entries(spec.elements).map(([key, element]) => [key, { ...element, children: element.children ?? [] }])) };
  const whole = catalog.validate(full);
  if (!whole.success) errors.push(...issueText('spec', whole.error));
  const structure = validateSpec(full, { checkOrphans: true });
  for (const issue of structure.issues.filter(issue => issue.severity === 'error' || issue.code === 'orphaned_element'))
    errors.push(`${issue.elementKey ?? 'spec'}: ${issue.message}`);
  if (errors.length) return { ok: false, errors };
  if (spec.elements[spec.root].type !== 'Section') return { ok: false, errors: ['the root is not a Section'] };
  // Depth and a tree with no element reached twice (a cycle would never end drawing).
  const seen = new Set();
  const walk = (key, depth) => {
    if (seen.has(key)) { errors.push(`${key}: appears twice in the tree`); return; }
    seen.add(key);
    if (depth > SPEC_LIMITS.depth) { errors.push(`${key}: deeper than ${SPEC_LIMITS.depth}`); return; }
    for (const child of spec.elements[key].children ?? []) walk(child, depth + 1);
  };
  walk(spec.root, 1);
  return errors.length ? { ok: false, errors } : { ok: true, spec };
}

/**
 * Checks a saved view (lib/r2-blocks.mjs SavedView) and its spec.
 * @param {unknown} view
 * @returns {{ok: true, view: import('./r2-blocks.mjs').SavedView} | {ok: false, errors: string[]}}
 */
export function checkSavedView(view) {
  if (!object(view)) return { ok: false, errors: ['a saved view is an object'] };
  const errors = [];
  if (typeof view.id !== 'string' || !/^[a-z0-9-]{1,48}$/.test(view.id) || view.id === 'ask') errors.push('id is lowercase letters, digits and dashes, at most 48, and is not ask');
  if (typeof view.title !== 'string' || !view.title.trim() || view.title.length > 80 || CONTROL.test(view.title)) errors.push('title is 1 to 80 characters of plain text');
  if (view.question !== null && (typeof view.question !== 'string' || !view.question.trim() || view.question.length > 200 || CONTROL.test(view.question))) errors.push('question is null or 1 to 200 characters of plain text');
  if (typeof view.savedAt !== 'string' || !Number.isFinite(Date.parse(view.savedAt)) || new Date(view.savedAt).toISOString() !== view.savedAt) errors.push('savedAt is an ISO time');
  if (!['built-in', 'composed'].includes(view.origin)) errors.push('origin is built-in or composed');
  const extra = Object.keys(view).filter(field => !['id', 'title', 'question', 'spec', 'savedAt', 'origin'].includes(field));
  if (extra.length) errors.push(`unknown fields ${extra.join(', ')}`);
  const spec = checkSpec(view.spec);
  if (!spec.ok) errors.push(...spec.errors);
  return errors.length ? { ok: false, errors } : { ok: true, view };
}
