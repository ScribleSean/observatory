import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {preparePages} from './prepare-pages.mjs';
import {checkDemoBuild} from './check-demo-build.mjs';
import {demoFixture, DEMO_FIXTURE_TIME, sampleSnapshot} from './demo.mjs';

async function output(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'observatory-demo-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await mkdir(path.join(dir, 'assets'));
  for (const page of ['index.html', 'panel.html', 'product.html']) {
    await writeFile(path.join(dir, page), '<script type="module" src="/observatory/assets/a.js"></script>');
  }
  await writeFile(path.join(dir, 'assets/a.js'), 'export default true');
  await writeFile(path.join(dir, 'assets/third-party-licenses.txt'), 'Fictional license fixture');
  return dir;
}
const provenance = {revision: 'a'.repeat(40), dirty: false};

void test('synthetic output verifies with the exact fixture digest', async t => {
  const dir = await output(t);
  await preparePages(dir, provenance);
  await checkDemoBuild(dir);
  const info = JSON.parse(await readFile(path.join(dir, 'build-info.json')));
  const bytes = await readFile(path.join(dir, 'local/usage.json'));
  assert.equal(info.fixture.sha256, createHash('sha256').update(bytes).digest('hex'));
});

for (const [name, file, content] of [
  ['changed usage byte', 'local/usage.json', JSON.stringify(demoFixture()) + ' '],
  ['extra top-level page', 'dashboard.html', 'Unexpected page'],
  ['changed asset', 'assets/a.js', 'export default false'],
]) {
  void test(`rejects ${name}`, async t => {
    const dir = await output(t);
    await preparePages(dir, provenance);
    await writeFile(path.join(dir, file), content);
    await assert.rejects(checkDemoBuild(dir));
  });
}

void test('rejects a revision that is not 40 lowercase hex characters', async t => {
  const dir = await output(t);
  await assert.rejects(preparePages(dir, {...provenance, revision: 'invalid'}));
  await preparePages(dir, provenance);
  const file = path.join(dir, 'build-info.json');
  const info = JSON.parse(await readFile(file));
  await writeFile(file, JSON.stringify({...info, revision: 'invalid'}));
  await assert.rejects(checkDemoBuild(dir));
});

void test('preparation refuses to overwrite existing usage', async t => {
  const dir = await output(t);
  await mkdir(path.join(dir, 'local'));
  await writeFile(path.join(dir, 'local/usage.json'), 'Existing fictional bytes');
  await assert.rejects(preparePages(dir, provenance), {code: 'EEXIST'});
  assert.equal(await readFile(path.join(dir, 'local/usage.json'), 'utf8'), 'Existing fictional bytes');
});

void test('demo fixture is deterministic and uses the shared sample', () => {
  assert.deepEqual(demoFixture(), demoFixture());
  assert.deepEqual(demoFixture(), sampleSnapshot(Date.parse(DEMO_FIXTURE_TIME)));
});
