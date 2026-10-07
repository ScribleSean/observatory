import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = (name) => readFileSync(path.join(root, name), 'utf8');
const manifest = JSON.parse(source('package.json'));
const preload = manifest.scripts.test.match(
  /^node --import (\S+) --test scripts\/\*\.test\.mjs$/,
)?.[1];
assert.ok(preload, 'Keep the preload and unfiltered source-test discovery');
// Also reject an orphaned copy at the original packaged location.
const testSetup = [
  preload,
  'scripts/test-source-runtime.mjs',
  'scripts/test-file-symlink.mjs',
  'scripts/test-python.mjs',
  'native/tests/archive-retirement-fixture.mjs',
];

test('Mac Collector/scripts excludes source-test support', () => {
  const loops = [
    ...source('native/build.mjs').matchAll(
      /for\(const name of readdirSync\(path\.join\(root,'scripts'\)\)\) \{[\s\S]*?\r?\n\}/g,
    ),
  ];
  assert.equal(loops.length, 1, 'Expected the native script-copy selector');
  const selected = [];
  const scripts = path.join(root, 'fictional-package', 'Collector', 'scripts');
  // Execute only this trusted repository loop with inert copy callbacks.
  // This is not a VM security sandbox or a native application build.
  vm.runInNewContext(loops[0][0], {
    root,
    scripts,
    path,
    readdirSync(directory) {
      assert.equal(directory, path.join(root, 'scripts'));
      return readdirSync(directory);
    },
    cpSync(input, output) {
      assert.equal(path.dirname(input), path.join(root, 'scripts'));
      assert.equal(path.dirname(output), scripts);
      selected.push(input);
    },
  });
  assert.ok(selected.includes(path.join(root, 'scripts/run-collector.py')));
  assert.ok(
    !selected.includes(
      path.join(root, 'scripts/source-test-packaging.test.mjs'),
    ),
  );
  assert.deepEqual(
    testSetup.filter((file) => selected.includes(path.resolve(root, file))),
    [],
    'Source-test support is packaged',
  );
});

test('Windows Collector/scripts excludes source-test support', () => {
  // Evaluate the literal Content globs, not MSBuild targets or a native build.
  const items = [
    ...source('native/windows/WorkspaceObservatory.csproj').matchAll(
      /<Content\s+([^>]+)>([\s\S]*?)<\/Content>/g,
    ),
  ].filter((item) =>
    item[2].includes('<Link>Collector/scripts/%(Filename)%(Extension)</Link>'),
  );
  assert.equal(items.length, 1, 'Expected the Collector/scripts Content item');
  const patterns = (attribute) => {
    const value = items[0][1].match(new RegExp(`${attribute}="([^"]+)"`))?.[1];
    assert.ok(value, `Expected literal ${attribute} patterns`);
    assert.doesNotMatch(
      value,
      /[$@%&]/,
      'Do not model expanded MSBuild expressions',
    );
    return value.split(';');
  };
  const include = patterns('Include');
  const exclude = patterns('Exclude');
  const selected = (file) => {
    if (!existsSync(path.resolve(root, file))) return false;
    const relative = path.posix.relative('native/windows', file);
    return (
      include.some((pattern) => path.posix.matchesGlob(relative, pattern)) &&
      !exclude.some((pattern) => path.posix.matchesGlob(relative, pattern))
    );
  };
  assert.ok(selected('scripts/run-collector.py'));
  assert.ok(!selected('scripts/source-test-packaging.test.mjs'));
  assert.deepEqual(
    testSetup.filter(selected),
    [],
    'Source-test support is packaged',
  );
});
