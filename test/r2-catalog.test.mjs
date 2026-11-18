// The block catalog: every built-in spec validates, and oversize, unknown or malformed specs are refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, checkSpec, checkSavedView, PROP_SCHEMAS } from '../lib/r2-catalog.mjs';
import { BLOCK_TYPES, SPEC_LIMITS } from '../lib/r2-blocks.mjs';
import { VIEW_SPECS, PINNED_QUESTIONS, layout } from '../lib/r2-specs.mjs';

const small = () => layout(null, [{ type: 'Headline', props: { metric: 'spend' } }]);
const refused = (spec, pattern) => { const result = checkSpec(spec); assert.equal(result.ok, false); assert.match(result.errors.join('\n'), pattern); };

test('the catalog names every block and nothing else', () => {
  assert.deepEqual(catalog.componentNames.sort(), [...BLOCK_TYPES].sort());
  assert.deepEqual(Object.keys(PROP_SCHEMAS).sort(), [...BLOCK_TYPES].sort());
});

test('every built-in view and pinned question is a valid saved view', () => {
  for (const view of [...Object.values(VIEW_SPECS), ...PINNED_QUESTIONS.map(pin => pin.view)]) {
    const result = checkSavedView(view);
    assert.ok(result.ok, `${view.id}: ${result.errors?.join(', ')}`);
    assert.equal(view.origin, 'built-in');
  }
});

test('a spec holds queries, never numbers or titles', () => {
  for (const view of [...Object.values(VIEW_SPECS), ...PINNED_QUESTIONS.map(pin => pin.view)])
    for (const element of Object.values(view.spec.elements))
      for (const [key, value] of Object.entries(element.props)) if (typeof value === 'number') assert.ok(['columns', 'span', 'rows', 'limit'].includes(key), key);
});

test('unknown blocks, unknown props and bad values are refused', () => {
  const spec = small();
  spec.elements['root-0'].type = 'Iframe';
  refused(spec, /unknown block/);
  const extra = small();
  extra.elements['root-0'].props.value = 412;
  refused(extra, /Unrecognized key|unrecognized/i);
  const badMetric = small();
  badMetric.elements['root-0'].props.metric = 'happiness';
  refused(badMetric, /metric/);
  const badScope = small();
  badScope.elements['root-0'].props.scope = { devices: ['Toaster'] };
  refused(badScope, /scope/);
  const badDate = small();
  badDate.elements['root-0'].props.scope = { range: { anchor: '2026-02-30' } };
  refused(badDate, /anchor/);
  const field = small();
  field.elements['root-0'].on = { press: { action: 'x' } };
  refused(field, /unknown fields on/);
});

test('oversize specs are refused', () => {
  const many = layout(null, Array.from({ length: SPEC_LIMITS.elements }, () => ({ type: 'Headline', props: { metric: 'spend' } })));
  refused(many, /elements, over/);
  const big = small();
  big.elements.root.props.title = 'x'.repeat(80);
  for (let index = 0; index < 39; index++) big.elements[`pad${index}`] = { type: 'Flags', props: { limit: 1, scope: { devices: ['Mac', 'Windows', 'Linux'], sources: ['claude', 'codex', 'grok'], range: { unit: 'week', anchor: '2026-11-18' } } }, children: [] };
  const bytes = JSON.stringify(big).length;
  if (bytes <= SPEC_LIMITS.bytes) big.elements.root.props.title = 'x'.repeat(SPEC_LIMITS.bytes);
  refused(big, /bytes, over|over/);
});

test('the tree is a tree: a Section root, children only on Sections, no orphans, no cycles, limited depth', () => {
  const root = small();
  root.root = 'root-0';
  refused(root, /reachable|orphan|not a Section/i);
  const child = small();
  child.elements['root-0'].children = ['root'];
  refused(child, /only a Section has children/);
  const orphan = small();
  orphan.elements.loose = { type: 'Flags', props: {}, children: [] };
  refused(orphan, /loose/);
  const cycle = layout(null, [{ type: 'Section', props: { title: null, columns: 12 }, children: [] }]);
  cycle.elements['root-0'].children = ['root'];
  refused(cycle, /twice|deeper|orphan|circular/i);
  let nest = { type: 'Headline', props: { metric: 'spend' } };
  for (let index = 0; index < SPEC_LIMITS.depth; index++) nest = { type: 'Section', props: { title: null, columns: 12 }, children: [nest] };
  refused(layout(null, [nest]), /deeper than/);
  const missing = small();
  missing.elements.root.children = ['ghost'];
  refused(missing, /ghost|missing|not found/i);
  assert.equal(checkSpec(null).ok, false);
  assert.equal(checkSpec({ root: 'a' }).ok, false);
});

test('a saved view needs a clean id, a title, a save time and an origin', () => {
  const good = { id: 'my-view', title: 'Spend by repo', question: null, spec: small(), savedAt: '2026-11-18T00:00:00.000Z', origin: 'composed' };
  assert.equal(checkSavedView(good).ok, true);
  for (const bad of [{ ...good, id: 'My View' }, { ...good, title: '' }, { ...good, title: 'x'.repeat(81) }, { ...good, origin: 'agent' },
    { ...good, savedAt: 'soon' }, { ...good, data: 1 }, { ...good, spec: {} }])
    assert.equal(checkSavedView(bad).ok, false, JSON.stringify(bad).slice(0, 60));
});
