import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import {
  mkdtemp,
  cp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
  readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('bundled Mac collector honors its private runtime and ignores legacy hub settings',
  { skip: process.platform !== 'darwin' }, async (t) => {
  const runtime = await realpath(
    await mkdtemp(path.join(tmpdir(), 'observatory-legacy-scope-')),
  );
  t.after(() => rm(runtime, { recursive: true, force: true }));
  const bundle = await realpath(
    await mkdtemp(path.join(tmpdir(), 'observatory-legacy-bundle-')),
  );
  t.after(() => rm(bundle, { recursive: true, force: true }));
  // Bundled code and private state are separate, as in the native Mac launch.
  await cp(new URL('./', import.meta.url), path.join(bundle, 'scripts'), {
    recursive: true,
  });
  await writeFile(path.join(runtime, 'collector.config.json'), JSON.stringify({
    activity: false, codex: false, claude: false, wispr: false, quota: false,
    receipts: true, benchmarks: true,
  }));
  const receipts = path.join(runtime, 'receipts');
  await mkdir(receipts);
  const config = JSON.stringify({
    macCcusage: '/fixture/ccusage',
    ubuntuCcusage: '/fixture/ccusage',
    ubuntuHost: 'retired-host',
    windowsHost: 'windows-host',
    macCodexHome: '/fictional/.codex',
    ubuntuCodexHome: '/home/fixture/.codex',
    windowsCodexHome: '/mnt/c/Users/fixture/.codex',
    receiptDirectory: receipts,
    localModelResults: '/home/fixture/results',
    dictation: { mac: false, windows: false },
  });
  await writeFile(path.join(runtime, 'local.config.json'), config);
  const originals = {
      spawn: childProcess.spawn,
      execFile: childProcess.execFile,
      fetch: globalThis.fetch,
    },
    calls = [];
  const command = async (file, args) => {
    calls.push({ file, args });
    throw Error('Unexpected fixture command');
  };
  childProcess.execFile = () => {
    throw Error('Unexpected callback command');
  };
  childProcess.execFile[promisify.custom] = command;
  childProcess.spawn = (file, args) => {
    calls.push({ file, args });
    throw Error('Synthetic reader unavailable');
  };
  globalThis.fetch = async (...args) => {
    calls.push({ file: 'fetch', args });
    throw Error('Synthetic activity unavailable');
  };
  syncBuiltinESMExports();
  try {
    const { collectMac } = await import(
      pathToFileURL(path.join(bundle, 'scripts/collect-mac.mjs'))
    );
    await collectMac(runtime, '/fixture/python3');
    const recorded = JSON.stringify(calls);
    for (const value of ['/fixture/ccusage', 'retired-host', 'windows-host'])
      assert.equal(recorded.includes(value), false);
    assert.deepEqual(await readdir(bundle), ['scripts']);
    const data = JSON.parse(
      await readFile(path.join(runtime, 'public/local/usage.json'), 'utf8'),
    );
    assert.equal(
      data.tokens.some((source) => source.host === 'Ubuntu'),
      false,
    );
    assert.deepEqual(data.agents, []);
    assert.equal(data.agentSource.status, 'not-connected');
    assert.equal(data.localModel.status, 'not-connected');
    assert.equal(
      await readFile(path.join(runtime, 'local.config.json'), 'utf8'),
      config,
    );
  } finally {
    childProcess.spawn = originals.spawn;
    childProcess.execFile = originals.execFile;
    globalThis.fetch = originals.fetch;
    syncBuiltinESMExports();
  }
});

test('Mac collector refuses a relative runtime before collection',
  { skip: process.platform !== 'darwin' }, async (t) => {
  const cwd = await realpath(
    await mkdtemp(path.join(tmpdir(), 'observatory-relative-runtime-')),
  );
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await assert.rejects(
    promisify(childProcess.execFile)(process.execPath, [
      fileURLToPath(new URL('./collect-mac.mjs', import.meta.url)),
    ], {
      cwd,
      env: { ...process.env, OBSERVATORY_RUNTIME: 'relative-runtime',
        OBSERVATORY_PYTHON: '/fixture/python3' },
    }),
    (error) => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /Mac collection unavailable/);
      return true;
    },
  );
  assert.equal((await readdir(cwd)).includes('relative-runtime'), false);
});
