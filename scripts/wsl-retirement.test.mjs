import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test(
  'legacy Windows switches cannot start WSL during real collector orchestration',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const runtime = await realpath(
      await mkdtemp(path.join(tmpdir(), 'observatory-retired-wsl-')),
    );
    t.after(() => rm(runtime, { recursive: true, force: true }));
    const file = path.join(runtime, 'collector.config.json');
    const config = JSON.stringify({
      activity: false,
      codex: true,
      wispr: false,
      quota: true,
      wslDistribution: 'Ubuntu',
      quotaWslDistribution: 'Ubuntu',
    });
    await writeFile(file, config);
    const original = childProcess.spawn,
      calls = [];
    // No reader process can launch. In particular the RED run cannot start WSL
    // or read an installed account. Only synthetic saved counters are returned.
    childProcess.spawn = (executable) => {
      calls.push(executable);
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stdin = new PassThrough();
      child.stdin.resume();
      child.stdin.on('finish', () =>
        queueMicrotask(() => {
          child.stdout.emit(
            'data',
            Buffer.from(
              /wsl(?:\.exe)?$/i.test(executable)
                ? '/home/fixture\n'
                : JSON.stringify({
                    status: 'ok',
                    profiles: [],
                    tools: [],
                    inventory: { status: 'ok', keys: [], parents: [] },
                  }),
            ),
          );
          child.emit('close', 0);
        }),
      );
      return child;
    };
    syncBuiltinESMExports();
    try {
      const { collectWindows } = await import('./collect-windows.mjs');
      const result = await collectWindows(runtime);
      assert.equal(
        calls.some((file) => /wsl(?:\.exe)?$/i.test(file)),
        false,
      );
      assert.equal(calls.length, 1);
      assert.equal(
        result.data.tokens.find((source) => source.host === 'Windows').status,
        'ok',
      );
      assert.equal(
        result.data.tokens.some((source) => source.host === 'Ubuntu'),
        false,
      );
      assert.equal(result.data.quota.status, 'not-connected');
      assert.equal(result.status.sourcesConfigured, 2);
      const legacyPair = {
        pairId: 'a'.repeat(64),
        deviceId: 'b'.repeat(64),
        comparisonId: 'c'.repeat(64),
        comparisonSalt: 'd'.repeat(64),
        host: 'Windows',
        codexHosts: ['Windows', 'Ubuntu'],
      };
      const paired = await collectWindows(runtime, legacyPair);
      assert.equal(paired.peer.status, 'ready');
      assert.deepEqual(
        paired.peer.payload.codex.map((source) => ({
          host: source.host,
          status: source.status,
        })),
        [
          { host: 'Windows', status: 'ok' },
          { host: 'Ubuntu', status: 'not-connected' },
        ],
      );
      assert.equal(calls.length, 2);
      assert.equal(
        calls.some((file) => /wsl(?:\.exe)?$/i.test(file)),
        false,
      );
      assert.deepEqual(legacyPair.codexHosts, ['Windows', 'Ubuntu']);
      assert.equal(await readFile(file, 'utf8'), config);
    } finally {
      childProcess.spawn = original;
      syncBuiltinESMExports();
    }
  },
);
