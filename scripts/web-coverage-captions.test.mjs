import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import { projectCurrentSources } from './current-sources.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Compile trusted repository JSX in memory, never snapshot-supplied code.
// This uses real React rendering, not a security sandbox or component stubs.
function compileJsx(source, filename) {
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const loaded = { exports: {} };
  compileFunction(outputText, ['require', 'module', 'exports'], { filename })(
    createRequire(filename),
    loaded,
    loaded.exports,
  );
  return loaded.exports.default;
}

const providerFile = fileURLToPath(
  new URL('../app/provider-coverage.tsx', import.meta.url),
);
const ProviderCoverage = compileJsx(
  readFileSync(providerFile, 'utf8'),
  providerFile,
);
const renderCoverage = (tokens, sources) =>
  renderToStaticMarkup(
    React.createElement(ProviderCoverage, { tokens, sources }),
  );
const codexReading = (html) =>
  html.match(/<dt>Codex<\/dt><dd>([^<]*)<\/dd>/)?.[1];

const token = (host, status = 'ok') => ({
  host,
  status,
  days: [{ date: '2026-09-12', totalTokens: 123, requestCount: 1 }],
});

void test('mixed native and archived Codex rows count only native device records', () => {
  const tokens = [
    token('Windows'),
    token('Mac', 'unavailable'),
    token('Ubuntu'),
  ];
  const before = structuredClone(tokens);
  assert.equal(
    codexReading(renderCoverage(tokens)),
    '1/2 native device records read',
  );
  assert.deepEqual(tokens, before, 'Rendering preserves every saved record');
});

void test('archived-only Codex rows remain saved and are labeled outside native coverage', () => {
  const tokens = [token('Ubuntu')];
  const before = structuredClone(tokens);
  const html = renderCoverage(tokens);
  assert.equal(codexReading(html), 'Unknown');
  assert.match(
    html,
    /Archived or unsupported device records are not included in native coverage\./,
  );
  assert.deepEqual(
    tokens,
    before,
    'Archived records and counters are not rewritten',
  );
});

/** @type {[string, ReturnType<typeof token>[], string, boolean][]} */
const coverageCases = [
  [
    'native-only',
    [token('Mac'), token('Windows')],
    '2/2 native device records read',
    false,
  ],
  ['empty', [], 'Unknown', false],
  [
    'disabled native row',
    [token('Mac', 'not-connected'), token('Windows')],
    '1/1 native device records read',
    false,
  ],
  [
    'all native rows disabled',
    [token('Mac', 'not-connected'), token('Windows', 'not-connected')],
    'Unknown',
    false,
  ],
  [
    'unavailable native rows',
    [token('Mac', 'unavailable'), token('Windows', 'unavailable')],
    '0/2 native device records read',
    false,
  ],
  [
    'unknown native status',
    [token('Windows', 'future-status')],
    '0/1 native device records read',
    false,
  ],
  [
    'noncanonical hosts and non-ok statuses',
    [
      token('All'),
      token('mac'),
      token('windows'),
      token('New device'),
      token(''),
      token('Mac', 'unknown'),
      token('Windows', 'disabled'),
    ],
    '0/2 native device records read',
    true,
  ],
  [
    'records, not deduplicated devices',
    [token('Mac'), token('Mac')],
    '2/2 native device records read',
    false,
  ],
];
for (const [name, tokens, expected, archived] of coverageCases) {
  void test(`Codex coverage: ${name}`, () => {
    const before = structuredClone(tokens);
    const html = renderCoverage(tokens);
    assert.equal(codexReading(html), expected);
    assert.equal(
      html.includes('Archived or unsupported device records'),
      archived,
    );
    assert.deepEqual(tokens, before);
  });
}

void test('provider coverage keeps unknowns, per-device counters and privacy limits', () => {
  const sources = [
    {
      provider: 'claude-code',
      ...token('Mac'),
      days: [{ date: '2026-09-12', totalTokens: 0, requestCount: 0 }],
    },
    { provider: 'claude-code', ...token('Windows') },
    { provider: 'claude-code', ...token('Ubuntu', 'stale') },
  ];
  const before = structuredClone(sources);
  const html = renderCoverage([], sources);
  assert.match(html, /Claude Code · Mac<\/dt><dd>0 tokens · 1 recorded date/);
  assert.match(
    html,
    /Claude Code · Windows<\/dt><dd>123 tokens · 1 recorded date/,
  );
  assert.match(
    html,
    /Claude Code · Ubuntu<\/dt><dd>Unknown · reading is stale/,
  );
  for (const provider of ['ChatGPT', 'Cursor', 'Antigravity']) {
    assert.ok(html.includes(`<dt>${provider}</dt><dd>Unknown</dd>`));
  }
  assert.match(html, /Device totals are not added together/);
  assert.match(html, /not subscription limits or a bill/);
  assert.doesNotMatch(html, /<button|download=|Export/);
  assert.deepEqual(sources, before);
});

const pageFile = fileURLToPath(new URL('../app/page.tsx', import.meta.url));
const pageSource = ts.createSourceFile(
  pageFile,
  readFileSync(pageFile, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const captions = [];
function findCaption(node) {
  if (
    ts.isJsxElement(node) &&
    node.openingElement.tagName.getText(pageSource) === 'p' &&
    node.children.some(
      (child) => ts.isJsxText(child) && child.text.includes('Newest receipt:'),
    )
  ) {
    captions.push(node.getText(pageSource));
  }
  ts.forEachChild(node, findCaption);
}
findCaption(pageSource);
assert.equal(captions.length, 1, 'Render the unique existing Agents caption');
// Render the exact caption JSX from Home in a fixture component. Do not import
// Home's fetch lifecycle, substitute its logic, or add a production test seam.
const ReceiptCaption = compileJsx(
  `export default function ReceiptCaption({ data }) { return (${captions[0]}); }`,
  pageFile,
);
const renderCaption = (agents) =>
  renderToStaticMarkup(
    React.createElement(ReceiptCaption, { data: { agents } }),
  );
const receipt = (status, recordedAt = '2026-09-12T12:00:00Z') => ({
  status,
  recordedAt,
});

void test('one failed handoff renders singular receipt and failure nouns', () => {
  assert.equal(
    renderCaption([receipt('failed')]),
    '<p class="quiet-note">1 handoff receipt · 1 saved failure. Not a live agent monitor. Newest receipt: 2026-09-12T12:00:00Z.</p>',
  );
});

/** @type {[string, ReturnType<typeof receipt>[], string, string][]} */
const captionCases = [
  ['zero', [], '0 handoff receipts · 0 saved failures', 'Unknown'],
  [
    'one successful receipt',
    [receipt('returned')],
    '1 handoff receipt · 0 saved failures',
    '2026-09-12T12:00:00Z',
  ],
  [
    'many receipts, one failure',
    [receipt('returned'), receipt('failed')],
    '2 handoff receipts · 1 saved failure',
    '2026-09-12T12:00:00Z',
  ],
  [
    'many receipts and failures',
    [
      receipt('failed', '2026-09-12T12:00:00Z'),
      receipt('returned', '2026-09-10T12:00:00Z'),
      receipt('failed', '2026-09-11T12:00:00Z'),
    ],
    '3 handoff receipts · 2 saved failures',
    '2026-09-12T12:00:00Z',
  ],
  [
    'unknown status and timestamp',
    [receipt('unavailable', '')],
    '1 handoff receipt · 0 saved failures',
    'Unknown',
  ],
];
for (const [name, agents, counts, newest] of captionCases) {
  void test(`receipt caption: ${name}`, () => {
    const before = structuredClone(agents);
    assert.equal(
      renderCaption(agents),
      `<p class="quiet-note">${counts}. Not a live agent monitor. Newest receipt: ${newest}.</p>`,
    );
    assert.deepEqual(
      agents,
      before,
      'Rendering does not sort or rewrite receipts',
    );
  });
}

/**
 * @param {(node: import('typescript').Node) => boolean} matches
 * @param {string} name
 */
function uniqueHomeFragment(matches, name) {
  /** @type {import('typescript').Node[]} */
  const nodes = [];
  /** @param {import('typescript').Node} node */
  function visit(node) {
    if (matches(node)) nodes.push(node);
    ts.forEachChild(node, visit);
  }
  visit(pageSource);
  assert.equal(nodes.length, 1, `Render the unique Home ${name}`);
  let owner = nodes[0].parent;
  while (
    owner &&
    !(ts.isFunctionDeclaration(owner) && owner.name?.text === 'Home')
  ) {
    owner = owner.parent;
  }
  assert.ok(owner, `${name} belongs to Home`);
  return nodes[0].getText(pageSource);
}

const homeUpdater = uniqueHomeFragment(
  (node) =>
    ts.isArrowFunction(node) &&
    ts.isCallExpression(node.parent) &&
    ts.isIdentifier(node.parent.expression) &&
    node.parent.expression.text === 'setData',
  'setData updater',
);
const homeProvider = uniqueHomeFragment(
  (node) =>
    ts.isJsxSelfClosingElement(node) &&
    node.tagName.getText(pageSource) === 'ProviderCoverage',
  'ProviderCoverage caller',
);
const homeNotice = uniqueHomeFragment(
  (node) =>
    ts.isJsxExpression(node) &&
    Boolean(
      node.expression &&
      ts.isBinaryExpression(node.expression) &&
      node.expression.left.getText(pageSource) === 'data.hasRetiredSources',
    ),
  'historical notice conditional',
);
// Characterize the existing projection and exact Home fragments, not Home's
// imports, effects, fetch lifecycle, browser behavior or native acceptance.
const updateHomeData = compileJsx(
  `export default function update(previous, v, projectCurrentSources) {
    return (${homeUpdater})(previous);
  }`,
  pageFile,
);
const HomeCoverage = compileJsx(
  `export default function HomeCoverage({ data, ProviderCoverage }) {
    return <>${homeProvider}${homeNotice}</>;
  }`,
  pageFile,
);

const homeBenchmarks = uniqueHomeFragment(
  (node) =>
    ts.isJsxExpression(node) &&
    node
      .getText(pageSource)
      .startsWith('{localRecords.length>0 && data.localModel'),
  'saved benchmark panel',
);
const formatters = pageSource.statements
  .filter(ts.isVariableStatement)
  .flatMap((node) => node.declarationList.declarations)
  .filter((node) => ts.isIdentifier(node.name) && node.name.text === 'fmt');
assert.equal(formatters.length, 1, 'Use the existing saved-number formatter');
const HomeBenchmarks = compileJsx(
  `const ${formatters[0].getText(pageSource)};
  export default function HomeBenchmarks({ data }) {
    const localRecords = data?.localModel?.records || [];
    return <>${homeBenchmarks}</>;
  }`,
  pageFile,
);

void test('Home benchmark records do not infer collection state', (t) => {
  const raw = {
    collectedAt: '2026-09-12T12:00:00Z',
    activity: [],
    agents: [],
    tokens: [token('Mac')],
    settings: [],
    localModel: {
      host: 'Ubuntu',
      status: 'ok',
      checkedAt: '2026-09-12T12:00:00Z',
      records: [
        {
          model: 'fictional-model',
          status: 'complete',
          recordedAt: '2026-09-12T12:00:00Z',
          seconds: 1,
          output: 1,
          peakGpuMiB: 1024,
        },
      ],
    },
  };
  const before = structuredClone(raw);
  const data = updateHomeData(null, raw, projectCurrentSources);
  const html = renderToStaticMarkup(
    React.createElement(HomeBenchmarks, { data }),
  );
  t.diagnostic(html);
  assert.match(html, /<h2>Historical local model runs<\/h2>/);
  assert.match(html, /<strong>fictional-model<\/strong>/);
  assert.match(html, /<dt>Completed calls<\/dt><dd>1\/1<\/dd>/);
  assert.equal(
    html.match(/<p>(.*?)<\/p>/)?.[1],
    'Saved benchmark measurements. These records are excluded from the current-source summary in this web view and are separate from cloud tokens and active time.',
    'Saved records establish neither enabled nor disabled collection',
  );
  assert.strictEqual(data.localModel, raw.localModel);
  assert.deepEqual(raw, before);
});

void test('Home unsupported-host notice does not invent Ubuntu provenance', (t) => {
  const raw = {
    collectedAt: '2026-09-12T12:00:00Z',
    activity: [],
    agents: [],
    tokens: [token('Windows'), token('New device')],
    settings: [
      { host: 'Windows', status: 'ok' },
      { host: 'New device', status: 'ok' },
    ],
    combinedTokens: token('All'),
    combinedSettings: { host: 'All', status: 'ok', profiles: [] },
  };
  const before = structuredClone(raw);
  assert.doesNotMatch(JSON.stringify(raw), /Ubuntu/);
  const data = updateHomeData(null, raw, projectCurrentSources);
  assert.deepEqual(data.tokens, [raw.tokens[0]]);
  assert.deepEqual(data.settings, [raw.settings[0]]);
  assert.strictEqual(data.tokens[0], raw.tokens[0]);
  assert.strictEqual(data.settings[0], raw.settings[0]);
  for (const key of ['combinedTokens', 'combinedSettings']) {
    assert.deepEqual(data[key], { host: 'All', status: 'unavailable' });
  }
  assert.equal(data.hasRetiredSources, true);
  const html = renderToStaticMarkup(
    React.createElement(HomeCoverage, { data, ProviderCoverage }),
  );
  t.diagnostic(html);
  assert.equal(codexReading(html), '1/1 native device records read');
  assert.ok(
    html.includes(
      '<p class="quiet-note">This saved snapshot contains historical or unsupported-source records. They are not current source choices or part of Windows and Mac totals. Legacy mixed-source totals remain Unknown until a native collection verifies them.</p>',
    ),
    'The exclusion notice does not assign a source to unsupported records',
  );
  assert.doesNotMatch(html, /Ubuntu/);
  assert.deepEqual(raw, before);
});

/** @type {[string, ReturnType<typeof token>[], string[], string][]} */
const compositionCases = [
  [
    'mixed native and archived',
    [token('Windows'), token('Mac', 'unavailable'), token('Ubuntu')],
    ['Windows', 'Mac'],
    '1/2 native device records read',
  ],
  ['archived only', [token('Ubuntu')], [], 'Unknown'],
];
for (const [name, tokens, hosts, expected] of compositionCases) {
  void test(`Home coverage composition: ${name}`, () => {
    const raw = {
      collectedAt: '2026-09-12T12:00:00Z',
      activity: [],
      tokens,
      settings: tokens.map(({ host, status }) => ({ host, status })),
      agents: [receipt('failed')],
      providerTokenSources: [
        {
          provider: 'claude-code',
          ...token('Ubuntu', 'stale'),
          checkedAt: '2026-09-11T12:00:00Z',
        },
      ],
      combinedTokens: token('All'),
      combinedSettings: { host: 'All', status: 'ok', profiles: [] },
    };
    const before = structuredClone(raw);
    const data = updateHomeData(null, raw, projectCurrentSources);
    assert.notStrictEqual(data, raw);
    assert.deepEqual(
      data.tokens.map((row) => row.host),
      hosts,
    );
    assert.deepEqual(
      data.settings.map((row) => row.host),
      hosts,
    );
    for (const key of ['combinedTokens', 'combinedSettings']) {
      assert.deepEqual(data[key], { host: 'All', status: 'unavailable' });
    }
    assert.equal(data.hasRetiredSources, true);
    assert.strictEqual(data.agents, raw.agents);
    assert.strictEqual(data.providerTokenSources, raw.providerTokenSources);
    const html = renderToStaticMarkup(
      React.createElement(HomeCoverage, { data, ProviderCoverage }),
    );
    assert.equal(codexReading(html), expected);
    assert.match(
      html,
      /Claude Code · Ubuntu<\/dt><dd>Unknown · reading is stale/,
    );
    assert.ok(
      html.includes(
        '<p class="quiet-note">This saved snapshot contains historical or unsupported-source records. They are not current source choices or part of Windows and Mac totals. Legacy mixed-source totals remain Unknown until a native collection verifies them.</p>',
      ),
    );
    assert.doesNotMatch(html, /Archived or unsupported device records/);
    assert.strictEqual(updateHomeData(data, raw, projectCurrentSources), data);
    assert.strictEqual(
      updateHomeData(
        data,
        { ...raw, collectedAt: '2026-09-11T12:00:00Z' },
        projectCurrentSources,
      ),
      data,
    );
    assert.deepEqual(
      raw,
      before,
      'Projection and rendering preserve saved records and aggregate counters',
    );
  });
}
