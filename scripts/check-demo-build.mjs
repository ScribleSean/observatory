import {readFile, readdir, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {demoFixture, DEMO_FIXTURE_TIME} from './demo.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const forbidden = new Set(['local.config.json', '.env', '.git', '.codex', 'private-sync', 'private-quota']);

export async function assetDigests(dir) {
  const files = [];
  async function walk(relative) {
    const absolute = path.join(dir, relative);
    const info = await lstat(absolute);
    assert.ok(!info.isSymbolicLink(), 'No symlinks in demo output');
    assert.ok(!forbidden.has(path.basename(absolute)), 'Private path excluded');
    if (info.isDirectory()) {
      for (const name of await readdir(absolute)) await walk(relative ? `${relative}/${name}` : name);
    } else {
      assert.ok(info.isFile(), 'Only regular files in demo output');
      if (relative.startsWith('assets/')) files.push(relative);
    }
  }
  await walk('');
  return Object.fromEntries(await Promise.all(files.sort().map(async file => [file, sha256(await readFile(path.join(dir, file)))])));
}

export async function checkDemoBuild(dir) {
  const assets = await assetDigests(dir);
  assert.deepEqual((await readdir(dir)).sort(), ['assets', 'build-info.json', 'index.html', 'local', 'panel.html', 'product.html']);
  assert.deepEqual(await readdir(path.join(dir, 'local')), ['usage.json']);
  const usage = await readFile(path.join(dir, 'local/usage.json'));
  assert.deepEqual(usage, Buffer.from(JSON.stringify(demoFixture())), 'Usage bytes must match the fictional fixture');
  assert.equal(JSON.parse(usage).demo, true);
  const info = JSON.parse(await readFile(path.join(dir, 'build-info.json'), 'utf8'));
  assert.deepEqual(Object.keys(info).sort(), ['assets', 'dirty', 'fixture', 'revision']);
  assert.match(info.revision, /^[0-9a-f]{40}$/);
  assert.equal(typeof info.dirty, 'boolean');
  assert.deepEqual(info.fixture, {source: 'lib/sample-snapshot.mjs', time: DEMO_FIXTURE_TIME, sha256: sha256(usage)});
  assert.deepEqual(info.assets, assets);
  assert.ok(Object.hasOwn(assets, 'assets/third-party-licenses.txt'), 'Third-party licenses required');
  for (const page of ['index.html', 'panel.html', 'product.html']) {
    const html = await readFile(path.join(dir, page), 'utf8');
    for (const tag of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
      const attributes = Object.fromEntries([...tag[0].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(match => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]]));
      const ref = tag[1].toLowerCase() === 'script' ? attributes.src : attributes.href;
      if (ref === undefined || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) continue;
      assert.ok(ref.startsWith('/observatory/'), `${page} must use the demo base path`);
      const relative = decodeURIComponent(ref.slice('/observatory/'.length).split(/[?#]/)[0]);
      assert.ok(relative && !relative.split('/').includes('..') && !relative.includes('\\'), 'Asset path must stay inside the output');
      assert.ok((await lstat(path.join(dir, relative))).isFile(), `Referenced file must exist: ${relative}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkDemoBuild(path.resolve('dist/pages'));
  console.log('Synthetic demo output verified.');
}
