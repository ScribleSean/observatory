import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';

const sourceBytes = Buffer.from(
  JSON.stringify({
    schema: 2,
    collectedAt: '2026-09-09T12:00:00.000Z',
    tokens: [{ host: 'Ubuntu', status: 'ok', days: [] }],
  }) + '\r\n',
);
let active;
const command = () => {
  throw Error('Unexpected callback command');
};
command[promisify.custom] = async (...args) => active.execute(...args);
const absent = () =>
  Object.assign(Error('Synthetic absent entry'), { code: 'ENOENT' });

// Entire filesystem, metadata and native verifier are modeled. No chmod,
// Set-Acl, subprocess verifier or directory-substitution experiment is run.
async function model(t, { platform = 'darwin', reject = () => false } = {}) {
  const owned = await fs.mkdtemp(path.join(tmpdir(), 'observatory-boundary-'));
  const runtime = path.join(owned, 'runtime');
  const archiveRoot = path.join(runtime, 'archives'),
    control = path.join(runtime, '.runtime');
  const folder = path.join(control, 'private-repair'),
    file = path.join(runtime, 'public/local/usage.json');
  const entries = new Map(),
    events = [];
  let ino = 1,
    serial = 0;
  function directory(name) {
    if (entries.has(name)) return;
    const parent = path.dirname(name);
    if (parent !== name) directory(parent);
    entries.set(name, { directory: true, ino: ino++, uid: 501, mode: 0o40700 });
  }
  function save(name, bytes) {
    entries.set(name, {
      directory: false,
      ino: ino++,
      uid: 501,
      mode: 0o100600,
      bytes: Buffer.from(bytes),
    });
  }
  function stat(name, options = {}) {
    const entry = entries.get(String(name));
    if (!entry) throw absent();
    const value = {
      dev: 1,
      ino: entry.ino,
      uid: entry.uid,
      mode: entry.mode,
      nlink: 1,
      size: entry.bytes?.length ?? 0,
      mtimeNs: 1,
      ctimeNs: 1,
      birthtimeNs: 1,
    };
    if (options.bigint)
      for (const key of Object.keys(value)) value[key] = BigInt(value[key]);
    return {
      ...value,
      isDirectory: () => entry.directory,
      isSymbolicLink: () => false,
      isFile: () => !entry.directory,
    };
  }
  directory(path.dirname(file));
  directory(archiveRoot);
  save(file, sourceBytes);
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalGetuid = Object.getOwnPropertyDescriptor(process, 'getuid');
  const priorPython = process.env.OBSERVATORY_PYTHON;
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
  Object.defineProperty(process, 'getuid', {
    value: () => 501,
    configurable: true,
  });
  process.env.OBSERVATORY_PYTHON = path.join(runtime, 'configured-python');
  const m = {
    runtime,
    archiveRoot,
    control,
    folder,
    file,
    entries,
    events,
    directory,
    save,
    stat,
    async execute(executable, args, options) {
      events.push({ kind: 'verify', executable, args, options });
      const windows = args.includes('-Directory');
      const name = windows ? args[args.indexOf('-Directory') + 1] : args.at(-1);
      const mode = windows
        ? args.includes('-Ancestor')
          ? '--ancestor'
          : '--private'
        : args.at(-2);
      if (reject({ name, mode, args, entries }))
        throw Object.assign(Error('Synthetic native ACL rejection'), {
          code: 1,
        });
      if (args.includes('-Initialize')) directory(name);
      return {
        stdout: windows ? 'private-sync-acl: ok\r\n' : 'private-path-acl: ok',
      };
    },
  };
  active = m;
  const originalExecFile = childProcess.execFile;
  childProcess.execFile = command;
  assert.equal(promisify(childProcess.execFile), command[promisify.custom]);
  t.after(() => {
    childProcess.execFile = originalExecFile;
    syncBuiltinESMExports();
  });
  t.mock.method(fs, 'realpath', async (name) => {
    if (!entries.has(String(name))) throw absent();
    return String(name);
  });
  t.mock.method(fs, 'lstat', async (...args) => stat(...args));
  t.mock.method(fs, 'access', async (name) => {
    events.push({ kind: 'access', name });
  });
  t.mock.method(fs, 'mkdir', async (name) => {
    events.push({ kind: 'mkdir', name });
    if (entries.has(name))
      throw Object.assign(Error('Exists'), { code: 'EEXIST' });
    directory(name);
  });
  t.mock.method(fs, 'mkdtemp', async (prefix) => {
    const name = prefix + ++serial;
    events.push({ kind: 'mkdir', name });
    directory(name);
    return name;
  });
  t.mock.method(fs, 'open', async (name, flags) => {
    name = String(name);
    events.push({ kind: 'open', name, flags });
    if (flags === 'wx') {
      if (entries.has(name))
        throw Object.assign(Error('Exists'), { code: 'EEXIST' });
      save(name, Buffer.alloc(0));
    }
    if (!entries.has(name)) throw absent();
    return {
      stat: async (options) => stat(name, options),
      sync: async () => {},
      close: async () => {},
      read: async (buffer, offset, length, position) => {
        const bytes = entries
          .get(name)
          .bytes.subarray(position, position + length);
        bytes.copy(buffer, offset);
        return { bytesRead: bytes.length };
      },
      writeFile: async (bytes) => {
        events.push({ kind: 'bytes', name });
        entries.get(name).bytes = Buffer.from(bytes);
      },
    };
  });
  syncBuiltinESMExports();
  t.after(async () => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    Object.defineProperty(process, 'platform', originalPlatform);
    if (originalGetuid)
      Object.defineProperty(process, 'getuid', originalGetuid);
    else delete process.getuid;
    if (priorPython === undefined) delete process.env.OBSERVATORY_PYTHON;
    else process.env.OBSERVATORY_PYTHON = priorPython;
    await fs.rm(owned, { recursive: true, force: true });
  });
  m.archive = await import('./mac-snapshot-archive.mjs');
  m.policy = await import('./peer-directory.mjs');
  return m;
}
const byteWrites = (m) => m.events.filter((event) => event.kind === 'bytes');

test('modeled Mac preparation refuses unsafe ancestry before creating an archive', async (t) => {
  const m = await model(t, { reject: ({ mode }) => mode === '--ancestor' });
  await assert.rejects(m.archive.archiveMacSnapshot(m.file, m.archiveRoot));
  assert.deepEqual(byteWrites(m), []);
  assert.equal(
    m.events.some((event) => event.kind === 'mkdir'),
    false,
  );
});
test('modeled Mac preparation refuses inherited file-read grants before byte writes', async (t) => {
  const m = await model(t, { reject: ({ mode }) => mode === '--private' });
  await assert.rejects(m.archive.archiveMacSnapshot(m.file, m.archiveRoot));
  assert.deepEqual(byteWrites(m), []);
});
test('modeled safe Mac preparation keeps distinct exact-byte archives', async (t) => {
  const m = await model(t);
  const first = await m.archive.archiveMacSnapshot(m.file, m.archiveRoot);
  const next = await m.archive.archiveMacSnapshot(m.file, m.archiveRoot);
  assert.notEqual(first.file, next.file);
  assert.deepEqual(m.entries.get(first.file).bytes, sourceBytes);
  assert.equal(byteWrites(m).length, 4);
});

test('modeled Mac retirement refuses unsafe ancestry before any private bytes', async (t) => {
  const m = await model(t, { reject: ({ mode }) => mode === '--ancestor' });
  await assert.rejects(
    (await m.archive.retirementSnapshotGuard(m.runtime)).preserve(),
  );
  assert.deepEqual(byteWrites(m), []);
  assert.deepEqual(m.entries.get(m.file).bytes, sourceBytes);
});
test('modeled safe retirement preserves exact bytes and reuses its two-file checkpoint', async (t) => {
  const m = await model(t);
  const guard = await m.archive.retirementSnapshotGuard(m.runtime);
  await guard.preserve();
  await guard.preserve();
  assert.deepEqual(
    m.entries.get(path.join(m.folder, 'retirement-snapshot.json')).bytes,
    sourceBytes,
  );
  assert.equal(byteWrites(m).length, 2);
  assert.deepEqual(m.entries.get(m.file).bytes, sourceBytes);
});

for (const platform of ['darwin', 'win32'])
  test(`modeled ${platform} retirement preflight rejects before directory creation`, async (t) => {
    const m = await model(t, {
      platform,
      reject: ({ mode }) => mode === '--ancestor',
    });
    await assert.rejects(
      (await m.archive.retirementSnapshotGuard(m.runtime)).preserve(),
    );
    assert.equal(
      m.events.some(
        (event) => event.kind === 'mkdir' || event.kind === 'bytes',
      ),
      false,
    );
    assert.ok(m.events.some((event) => event.kind === 'verify'));
  });
for (const acl of [
  'inherited-file-read',
  'inherited-directory-write',
  'query-failure',
  'unknown-format',
])
  test(`modeled Mac ${acl} rejection blocks retirement before an exclusive open`, async (t) => {
    const m = await model(t, {
      reject: ({ name, mode, entries }) =>
        mode === '--private' && entries.get(name)?.acl === acl,
    });
    // Native --private is authoritative even when POSIX bits report 0700.
    m.directory(m.folder);
    m.entries.get(m.folder).acl = acl;
    await assert.rejects(
      (await m.archive.retirementSnapshotGuard(m.runtime)).preserve(),
    );
    assert.equal(
      m.events.some((event) => event.kind === 'open' && event.flags === 'wx'),
      false,
    );
    assert.ok(
      m.events.some(
        (event) => event.kind === 'verify' && event.args.includes('--private'),
      ),
    );
  });
test('modeled Mac private-leaf owner mismatch cannot authorize bytes', async (t) => {
  const m = await model(t);
  m.directory(m.folder);
  m.entries.get(m.folder).uid = 999;
  await assert.rejects(
    (await m.archive.retirementSnapshotGuard(m.runtime)).preserve(),
    /Unsafe private/,
  );
  assert.deepEqual(byteWrites(m), []);
});
test('modeled ancestry identity change during native verification refuses before writes', async (t) => {
  const m = await model(t),
    execute = m.execute.bind(m);
  m.execute = async (...args) => {
    const result = await execute(...args);
    m.entries.get(m.runtime).ino++;
    return result;
  };
  await assert.rejects(
    (await m.archive.retirementSnapshotGuard(m.runtime)).preserve(),
    /ancestry changed/,
  );
  assert.deepEqual(byteWrites(m), []);
});
test('modeled Mac verifier uses the configured isolated Python and exact CLI contract', async (t) => {
  const m = await model(t);
  await (await m.archive.retirementSnapshotGuard(m.runtime)).preserve();
  const calls = m.events.filter((event) => event.kind === 'verify');
  assert.ok(calls.some((call) => call.args.includes('--ancestor')));
  assert.ok(calls.some((call) => call.args.includes('--private')));
  for (const call of calls) {
    assert.equal(call.executable, process.env.OBSERVATORY_PYTHON);
    assert.deepEqual(call.args.slice(0, 3), [
      '-I',
      '-B',
      fileURLToPath(new URL('./private-path-acl.py', import.meta.url)),
    ]);
    assert.equal(call.args.length, 5);
    assert.ok(path.isAbsolute(call.args.at(-1)));
    assert.equal(call.options.timeout, 15000);
    assert.equal(call.options.maxBuffer, 4096);
  }
});
test('modeled direct native JS caller resolves sibling bundled Python without PATH discovery', async (t) => {
  const m = await model(t);
  delete process.env.OBSERVATORY_PYTHON;
  await m.policy.trustedDirectoryAncestry(m.runtime);
  const calls = m.events.filter((event) => event.kind === 'verify');
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].executable,
    fileURLToPath(new URL('../../Runtime/python/bin/python3', import.meta.url)),
  );
});
for (const result of [
  '',
  'private-path-acl: ok\nextra',
  'private-path-acl: ok\n\n',
  'unknown',
  null,
])
  test(`modeled Mac unknown verifier result ${JSON.stringify(result)} fails closed`, async (t) => {
    const m = await model(t);
    m.execute = async () => ({ stdout: result });
    await assert.rejects(
      (await m.archive.retirementSnapshotGuard(m.runtime)).preserve(),
      /access-control verification failed/,
    );
    assert.deepEqual(byteWrites(m), []);
  });
for (const python of ['', 'relative-python'])
  test(`modeled invalid Python selection ${JSON.stringify(python)} is not replaced by discovery`, async (t) => {
    const m = await model(t);
    process.env.OBSERVATORY_PYTHON = python;
    await assert.rejects(
      m.policy.trustedDirectoryAncestry(m.runtime),
      /access-control verification failed/,
    );
    assert.equal(
      m.events.some((event) => event.kind === 'verify'),
      false,
    );
  });
test('modeled unavailable Python refuses without running a different executable', async (t) => {
  const m = await model(t);
  t.mock.method(fs, 'access', async () => {
    throw absent();
  });
  syncBuiltinESMExports();
  await assert.rejects(
    (await m.archive.retirementSnapshotGuard(m.runtime)).preserve(),
    /access-control verification failed/,
  );
  assert.equal(
    m.events.some((event) => event.kind === 'verify' || event.kind === 'bytes'),
    false,
  );
});
test('modeled missing ACL verifier refuses before writes', async (t) => {
  const m = await model(t);
  m.execute = async () => {
    throw absent();
  };
  await assert.rejects(
    (await m.archive.retirementSnapshotGuard(m.runtime)).preserve(),
    /access-control verification failed/,
  );
  assert.deepEqual(byteWrites(m), []);
});
