import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../.github/workflows/demo.yml', import.meta.url),
  'utf8',
);

test('publishing the demo requires a manual workflow dispatch', () => {
  const triggers = workflow.match(/^on:\r?\n([\s\S]*?)(?=^\S)/m)?.[1];
  assert.ok(triggers, 'The workflow declares its triggers');
  const events = [...triggers.matchAll(/^ {2}([\w-]+):/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(events, ['workflow_dispatch']);
});

test('manual demo publication still requires the current main revision', () => {
  assert.ok(workflow.includes('refs/heads/main'));
  assert.ok(workflow.includes('"$GITHUB_SHA" == "$latest"'));
  assert.ok(workflow.includes("if: steps.current.outputs.current == 'true'"));
});

test('the demo artifact is built from fictional data in the hosted checkout', () => {
  const build = workflow.indexOf('- run: npx vite build --config native/vite.demo.config.mts');
  const prepare = workflow.indexOf('- run: node scripts/prepare-pages.mjs');
  const upload = workflow.indexOf('actions/upload-pages-artifact@');
  assert.ok(build >= 0 && build < prepare && prepare < upload);
  assert.match(workflow, /path: dist\/pages/);
});
