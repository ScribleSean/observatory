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
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('bundled legacy dashboard honors its private runtime without reading Ubuntu', async (t) => {
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
  const previousRuntime = process.env.OBSERVATORY_RUNTIME;
  process.env.OBSERVATORY_RUNTIME = runtime;
  t.after(() => {
    if (previousRuntime === undefined) delete process.env.OBSERVATORY_RUNTIME;
    else process.env.OBSERVATORY_RUNTIME = previousRuntime;
  });
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
    if (args.some((arg) => String(arg).includes('private-sync-acl.ps1')))
      return { stdout: 'private-sync-acl: ok' };
    return {
      stdout: JSON.stringify(
        file === '/fixture/ccusage'
          ? { daily: [] }
          : { categories: { Coding: 0, Terminal: 0, Browser: 0, Other: 0 } },
      ),
    };
  };
  childProcess.execFile = () => {
    throw Error('Unexpected callback command');
  };
  childProcess.execFile[promisify.custom] = command;
  childProcess.spawn = (file, args) => {
    calls.push({ file, args });
    throw Error('Synthetic reader unavailable');
  };
  globalThis.fetch = async () => {
    throw Error('Synthetic activity unavailable');
  };
  syncBuiltinESMExports();
  try {
    const { collect } = await import(
      pathToFileURL(path.join(bundle, 'scripts/collect-dashboard.mjs'))
    );
    await collect();
    assert.equal(
      calls.some((call) => call.args.includes('retired-host')),
      false,
    );
    assert.equal(
      calls.some((call) => call.file === '/fixture/ccusage'),
      true,
    );
    assert.equal(
      calls.some((call) => call.args.includes('windows-host')),
      true,
    );
    const data = JSON.parse(
      await readFile(path.join(runtime, 'public/local/usage.json'), 'utf8'),
    );
    assert.equal(
      data.tokens.some((source) => source.host === 'Ubuntu'),
      false,
    );
    assert.equal(
      data.tokens.find((source) => source.host === 'Windows').status,
      'not-connected',
    );
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

test('bundled legacy dashboard rejects a relative runtime before collection', async () => {
  const previousRuntime = process.env.OBSERVATORY_RUNTIME;
  process.env.OBSERVATORY_RUNTIME = 'relative-runtime';
  try {
    await assert.rejects(
      import(
        new URL('./collect-dashboard.mjs?relative-runtime', import.meta.url)
      ),
      /Absolute runtime path required/,
    );
  } finally {
    if (previousRuntime === undefined) delete process.env.OBSERVATORY_RUNTIME;
    else process.env.OBSERVATORY_RUNTIME = previousRuntime;
  }
});
