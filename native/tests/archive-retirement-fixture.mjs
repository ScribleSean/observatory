// Real fictional-file I/O with inert permissions, providers and peer transport.
// This is a trusted-code regression fixture, not an OS sandbox or ACL test.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export async function retirementFixture(t, bytes) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), 'observatory-retirement-recovery-')),
  );
  const runtime = path.join(root, 'runtime');
  const scripts = path.join(root, 'bundle', 'scripts');
  const source = fileURLToPath(new URL('../../scripts/', import.meta.url));
  const events = [];
  const restore = [];
  const replace = (object, name, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    Object.defineProperty(object, name, {
      configurable: true,
      writable: true,
      value,
    });
    restore.push(() =>
      descriptor
        ? Object.defineProperty(object, name, descriptor)
        : delete object[name],
    );
  };
  const forbidden = () => {
    events.push('forbidden external operation');
    throw Error('External operation forbidden in retirement fixture');
  };
  const command = () => forbidden();
  command[promisify.custom] = async () => forbidden();
  for (const name of [
    'exec',
    'execSync',
    'execFileSync',
    'spawn',
    'spawnSync',
    'fork',
  ])
    replace(childProcess, name, forbidden);
  replace(childProcess, 'execFile', command);
  replace(childProcess.ChildProcess.prototype, 'spawn', forbidden);
  assert.equal(promisify(childProcess.execFile), command[promisify.custom]);
  for (const [object, names] of [
    [net, ['connect', 'createConnection', 'createServer']],
    [net.Socket.prototype, ['connect']],
    [net.Server.prototype, ['listen']],
    [tls, ['connect', 'createServer']],
    [http, ['request', 'get', 'createServer']],
    [https, ['request', 'get', 'createServer']],
    [http2, ['connect', 'createServer', 'createSecureServer']],
    [dgram, ['createSocket']],
    [dns, ['lookup', 'resolve', 'resolve4', 'resolve6']],
  ])
    for (const name of names) replace(object, name, forbidden);
  replace(globalThis, 'fetch', forbidden);
  for (const name of [
    'chmod',
    'fchmod',
    'lchmod',
    'chown',
    'fchown',
    'lchown',
    'link',
    'symlink',
  ])
    for (const object of [fs, syncFs])
      for (const key of [name, name + 'Sync'])
        if (typeof object[key] === 'function') replace(object, key, forbidden);
  const confined = (value, write = false) => {
    const target = path.resolve(
      value instanceof URL ? fileURLToPath(value) : value,
    );
    const owned = target === root || target.startsWith(root + path.sep);
    const sourceRead = !write && target.startsWith(source);
    if (!owned && !sourceRead) forbidden();
  };
  for (const [names, write] of [
    [['readFile', 'readdir', 'lstat', 'stat', 'realpath', 'access'], false],
    [['mkdir', 'mkdtemp', 'writeFile', 'appendFile', 'unlink', 'rm'], true],
  ])
    for (const name of names) {
      const original = fs[name];
      replace(fs, name, (file, ...args) => {
        confined(file, write);
        return original(file, ...args);
      });
    }
  const open = fs.open;
  replace(fs, 'open', (file, flags, ...args) => {
    const write =
      typeof flags === 'string'
        ? /[wa+]/.test(flags)
        : Boolean(
            flags &
            (syncFs.constants.O_WRONLY |
              syncFs.constants.O_RDWR |
              syncFs.constants.O_CREAT |
              syncFs.constants.O_TRUNC),
          );
    confined(file, write);
    return open(file, flags, ...args);
  });
  const copyFile = fs.copyFile;
  replace(fs, 'copyFile', (from, to, ...args) => {
    confined(from);
    confined(to, true);
    return copyFile(from, to, ...args);
  });
  // Exercise the Windows caller on every test host without launching Windows.
  // Permission policy and directory fsync are outside this modeled platform seam.
  replace(process, 'platform', 'win32');
  t.after(async () => {
    for (const undo of restore.reverse()) undo();
    syncBuiltinESMExports();
    await fs.rm(root, { recursive: true, force: true });
    assert.deepEqual(events, [], 'No external operation may even be attempted');
  });
  syncBuiltinESMExports();

  const stubs = {
    'peer-directory.mjs': `
      import {mkdir,lstat} from 'node:fs/promises';
      import path from 'node:path';
      export const trustedDirectoryAncestry=directory=>lstat(directory);
      export const verifyPrivateDirectory=directory=>lstat(directory);
      export async function privateCollectorDirectory(root,name,create=false) {
        if(name!=='private-repair')throw Error('Unexpected permission dependency');
        const folder=path.join(root,name);
        if(create)await mkdir(folder,{recursive:true});
        else await lstat(folder);
        return folder;
      }`,
    'peer-pairing.mjs': 'export async function readPairing(){return null;}',
    'peer-finalize.mjs': 'export async function finalizePeerCollection(){}',
    'collect-quota.mjs': `
      export let reads=0;
      export async function collectQuota(){reads++;return {status:'not-connected'};}
      export function attachQuota(result,quota){result.data.quota=quota;}
      export function findCodexExecutable(){throw Error('Unexpected provider discovery');}
      export function collectLegacyQuota(){throw Error('Unexpected legacy provider');}`,
    'quota-sync.mjs': `
      export let syncs=0;
      export async function attachQuotaSync(){syncs++;}`,
    'provider-token-sync.mjs':
      'export async function attachProviderTokenSync(){}',
    'collect-antigravity-allowance.mjs': `
      export async function collectConfiguredAntigravityAllowance(){return {status:'not-connected'};}
      export function attachProviderAllowances(){}`,
  };
  await fs.mkdir(scripts, { recursive: true });
  await fs.mkdir(path.join(runtime, 'public/local'), { recursive: true });
  const copied = new Set();
  async function copy(name) {
    assert.match(name, /^[a-z0-9-]+\.mjs$/);
    if (copied.has(name)) return;
    copied.add(name);
    if (Object.hasOwn(stubs, name)) {
      await fs.writeFile(path.join(scripts, name), stubs[name]);
      return;
    }
    const bytes = await fs.readFile(path.join(source, name));
    await fs.writeFile(path.join(scripts, name), bytes);
    // Copy exact production bytes, including the real snapshot projection and
    // history code. Only named external dependencies above are substituted.
    for (const match of bytes
      .toString()
      .matchAll(/(?:from\s*|import\s*\()['"]\.\/([a-z0-9-]+\.mjs)['"]/g))
      await copy(match[1]);
  }
  await copy('collect-windows.mjs');
  await fs.copyFile(
    path.join(source, 'read-settings.py'),
    path.join(scripts, 'read-settings.py'),
  );
  const file = path.join(runtime, 'public/local/usage.json');
  await fs.writeFile(file, bytes);
  const config = JSON.stringify({
    activity: false,
    codex: false,
    wispr: false,
    quota: false,
    claude: false,
    antigravity: false,
  });
  await fs.writeFile(path.join(runtime, 'collector.config.json'), config);
  const rename = fs.rename;
  let failRename = false;
  let renameAttempts = 0;
  replace(fs, 'rename', async (from, to) => {
    assert.ok(path.resolve(from).startsWith(root + path.sep));
    assert.ok(path.resolve(to).startsWith(root + path.sep));
    if (to === file) {
      renameAttempts++;
      if (failRename)
        throw Object.assign(Error('Fictional final rename EIO'), {
          code: 'EIO',
        });
    }
    return rename(from, to);
  });
  syncBuiltinESMExports();
  const load = (name) => import(pathToFileURL(path.join(scripts, name)));
  const { collectWindows } = await load('collect-windows.mjs');
  const quota = await load('collect-quota.mjs');
  const peer = await load('quota-sync.mjs');
  return {
    root,
    runtime,
    file,
    config,
    snapshot: path.join(
      runtime,
      '.runtime/private-repair/retirement-snapshot.json',
    ),
    receipt: path.join(
      runtime,
      '.runtime/private-repair/retirement-receipt.json',
    ),
    collect: (options) => collectWindows(runtime, null, options),
    failRename: (value) => {
      failRename = value;
    },
    counts: () => ({ reads: quota.reads, syncs: peer.syncs, renameAttempts }),
  };
}
