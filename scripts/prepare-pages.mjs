import {mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {demoFixture, DEMO_FIXTURE_TIME} from './demo.mjs';
import {assetDigests, checkDemoBuild} from './check-demo-build.mjs';

export async function preparePages(dir, {revision, dirty}) {
  assert.match(revision, /^[0-9a-f]{40}$/, 'A full lowercase Git revision is required');
  assert.equal(typeof dirty, 'boolean');
  const assets = await assetDigests(dir);
  const usage = JSON.stringify(demoFixture());
  await mkdir(path.join(dir, 'local'), {recursive: true});
  await writeFile(path.join(dir, 'local/usage.json'), usage, {flag: 'wx'});
  const fixture = {source: 'lib/sample-snapshot.mjs', time: DEMO_FIXTURE_TIME, sha256: createHash('sha256').update(usage).digest('hex')};
  await writeFile(path.join(dir, 'build-info.json'), JSON.stringify({revision, dirty, fixture, assets}));
  await checkDemoBuild(dir);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let revision, dirty;
  try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
    dirty = execFileSync('git', ['status', '--porcelain'], {encoding: 'utf8'}).trim().length > 0;
  } catch (cause) {
    throw new Error('Could not read Git revision and working tree status for the demo build', {cause});
  }
  await preparePages(path.resolve('dist/pages'), {revision, dirty});
  console.log('Synthetic demo output verified.');
}
