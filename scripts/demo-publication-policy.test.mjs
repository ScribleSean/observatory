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

test('the demo artifact is checked and built from fictional data in the hosted checkout', () => {
  const steps = [
    '- run: npm ci',
    '- run: node --test scripts/demo.test.mjs scripts/demo-build.test.mjs scripts/demo-workflow.test.mjs scripts/demo-publication-policy.test.mjs scripts/documentation.test.mjs',
    '- run: npx vite build --config native/vite.demo.config.mts',
    '- run: node scripts/prepare-pages.mjs',
    '- run: node scripts/check-demo-build.mjs',
    'actions/upload-pages-artifact@',
  ];
  let previous = -1;
  for (const step of steps) {
    const position = workflow.indexOf(step);
    assert.ok(position > previous, step);
    previous = position;
  }
  assert.match(workflow, /path: dist\/pages/);
});

test('only the deploy job declares publication write permissions', () => {
  const build = workflow.match(/^  build:\r?\n([\s\S]*?)^  deploy:\r?\n/m)?.[1];
  assert.ok(build);
  assert.doesNotMatch(build, /^\s*(?:pages|id-token): write\s*$/m);
  const deploy = workflow.slice(workflow.indexOf('  deploy:'));
  for (const permission of ['pages: write', 'id-token: write']) {
    assert.equal(workflow.split(permission).length - 1, 1);
    assert.ok(deploy.includes(permission));
  }
});
