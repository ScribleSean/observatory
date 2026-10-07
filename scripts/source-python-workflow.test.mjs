import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../.github/workflows/macos-runtime.yml', import.meta.url),
  'utf8',
).replaceAll('\r', '');
const steps = workflow.split(/^      - /m).slice(1);
const step = (name) => {
  const matches = steps.filter((value) => value.startsWith(`name: ${name}\n`));
  assert.equal(matches.length, 1, `Expected one workflow step: ${name}`);
  return matches[0];
};

// Source contracts only. These checks never run a workflow command or download
// a runtime, build an application or dispatch CI.
test('Mac source tests and build receive the extracted pinned Python explicitly', () => {
  const build = step('Build complete Apple Silicon application');
  const python = '${{ runner.temp }}/observatory-runtime/python/bin/python3';
  assert.ok(
    build.includes(`OBSERVATORY_PYTHON: ${python}\n`),
    'The permission helper must receive the selected absolute runtime Python',
  );
  assert.ok(
    build.includes(`OBSERVATORY_TEST_PYTHON: ${python}\n`),
    'Python fixture tests must use the same verified candidate',
  );
  for (const command of ['npm test', 'node native/build.mjs']) {
    const selected = build.indexOf('test -x "$OBSERVATORY_PYTHON"');
    assert.ok(
      selected > build.indexOf('tar -xzf "$OBSERVATORY_RUNTIME_ARCHIVE"'),
    );
    assert.ok(
      selected < build.indexOf(command),
      'Select and check Python before test/build launch',
    );
  }
});

test('Mac source-runtime wiring retains pinned preparation and opt-in build gates', () => {
  assert.match(workflow, /build_app:[\s\S]*type: boolean\s+default: false/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /runs-on: macos-14/);
  assert.match(workflow, /node-version: '24\.21\.0'/);
  const fetch = step('Fetch pinned runtime archives into a new cache');
  assert.ok(
    fetch.includes(
      "json.loads(pathlib.Path('native/mac/runtime-assets.json').read_text())",
    ),
  );
  assert.ok(
    fetch.includes(
      "hashlib.sha256(target.read_bytes()).hexdigest() != asset['sha256']",
    ),
  );
  assert.ok(fetch.includes("url.scheme != 'https'"));
  assert.ok(fetch.includes("url.hostname == 'github.com'"));
  assert.ok(
    fetch.includes("'/astral-sh/python-build-standalone/releases/download/'"),
  );
  const prepare = step('Prepare verified redistributable runtime');
  assert.ok(
    prepare.includes(
      'native/mac/prepare-runtime.py --cache "$OBSERVATORY_RUNTIME_CACHE" --output "$OBSERVATORY_RUNTIME_OUTPUT"',
    ),
  );
  const build = step('Build complete Apple Silicon application');
  assert.ok(
    build.includes(
      'OBSERVATORY_RUNTIME_DIR: ${{ runner.temp }}/observatory-runtime\n',
    ),
  );
  assert.ok(
    build.includes(
      'OBSERVATORY_RUNTIME_ARCHIVE: ${{ runner.temp }}/observatory-runtime.tar.gz\n',
    ),
  );
  assert.ok(build.includes('test "$(uname -m)" = arm64'));
  assert.ok(
    build.includes(
      'node native/build.mjs --runtime-dir "$OBSERVATORY_RUNTIME_DIR" --updater-archive "$OBSERVATORY_UPDATER_ARCHIVE"',
    ),
  );
  for (const gated of steps.filter((value) =>
    /actions\/setup-node|Sparkle|Build complete|Verify native updater|Verify distributable|Retain verified/.test(
      value,
    ),
  ))
    assert.match(gated, /^        if: inputs\.build_app$/m);
  for (const selected of steps.filter(
    (value) =>
      value.includes('OBSERVATORY_PYTHON:') ||
      value.includes('OBSERVATORY_TEST_PYTHON:'),
  ))
    assert.match(selected, /^        if: inputs\.build_app$/m);
  assert.doesNotMatch(
    workflow,
    /npm run collect|scripts\/run-collector\.py|native\/install\.mjs/,
  );
  assert.match(
    workflow,
    /Runtime-only mode does not execute downloaded binaries/,
  );
});
