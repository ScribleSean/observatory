import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source contracts only. Do not execute collectors, permissions or deployment.
const workflow = readFileSync(
  new URL('../.github/workflows/demo.yml', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');
const build = workflow.match(/^  build:\n([\s\S]*?)^  deploy:\n/m)?.[1] ?? '';
const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

test('demo runs the full native suite on a supported hosted platform', () => {
  assert.match(
    build,
    /^    runs-on: (?:windows|macos)-latest$/m,
    'The full suite includes native private-directory positives. Linux is intentionally unsupported.',
  );
  assert.doesNotMatch(build, /^\s*(?:if|continue-on-error|container):/m);
});

test('demo retains the full test and TypeScript gates before synthetic packaging', () => {
  assert.equal(
    manifest.scripts.test,
    'node --import ./native/tests/test-source-runtime.mjs --test scripts/*.test.mjs',
  );
  assert.equal(
    build.slice(build.indexOf('    steps:\n')),
    `    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test && npx tsc --noEmit
      # Fresh hosted checkout only. Never upload a workstation build.
      - run: npm run demo
      - run: npm run build
        env:
          DASHBOARD_BASE_PATH: /observatory
      - run: node scripts/prepare-pages.mjs
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist/pages
`,
  );
});

test('demo retains manual-only publication and read-only workflow permissions', () => {
  assert.equal(
    workflow.slice(0, workflow.indexOf('jobs:\n')),
    `name: Publish synthetic demo
on:
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: public-demo
  cancel-in-progress: false
`,
  );
});

test('deployment retains its Linux host and newest-main publication guard', () => {
  assert.equal(
    workflow.slice(workflow.indexOf('  deploy:\n')),
    `  deploy:
    needs: build
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Confirm current main revision
        id: current
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          set -euo pipefail
          latest=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq '.object.sha')
          if [[ ! "$latest" =~ ^[0-9a-f]{40}$ ]]; then
            echo "Could not verify the current main revision."
            exit 1
          fi
          if [[ "$GITHUB_REF" == "refs/heads/main" && "$GITHUB_SHA" == "$latest" ]]; then
            echo "current=true" >> "$GITHUB_OUTPUT"
          else
            echo "current=false" >> "$GITHUB_OUTPUT"
            echo "Skipping a superseded or non-main demo revision."
          fi
      - name: Deploy
        id: deployment
        if: steps.current.outputs.current == 'true'
        uses: actions/deploy-pages@v4
`,
  );
});
