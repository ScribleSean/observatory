import {AsyncLocalStorage} from 'node:async_hooks';
import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {privateCollectorDirectory} from './peer-directory.mjs';

const held=new AsyncLocalStorage();
let lockDeadlineMs=null;

export function limitPeerLockWait(untilMs) {
  if(untilMs!==null && (!Number.isFinite(untilMs) || untilMs<0))throw Error('Invalid peer lock deadline');
  lockDeadlineMs=untilMs;
}
// Keep the lock independent of garbage collection while an action is pending.
const openLockDatabases=new Set();

export function peerLockWaitMs(platform=process.platform) {
  return platform==='win32'?15000:1000;
}

export async function checkLockSidecars(filename,{stat=lstat,wait=delay,boundMs=1000}={}) {
  for(const suffix of ['-journal','-wal','-shm']) {
    let deadline;
    for(;;) {
      let info;
      try {info=await stat(filename+suffix);}
      catch(error) {if(error.code==='ENOENT')break;throw error;}
      if(suffix!=='-journal' || !info.isFile() || info.isSymbolicLink() ||
        (info.nlink!==0 && info.nlink!==1) || info.size>65536 ||
        (process.platform!=='win32' && (info.mode&0o077)))throw Error('Unsafe pairing lock sidecar');
      if(info.nlink===1)break;
      // SQLite can unlink the journal between path lookup and stat, leaving nlink at zero.
      // Wait briefly for removal to finish before checking the path again.
      deadline??=performance.now()+boundMs;
      if(performance.now()>=deadline)throw Error('Unsafe pairing lock sidecar');
      await wait(20);
    }
  }
}

// SQLite supplies a process-crash-safe local mutex outside the directory that
// repair retires. No pairing records or credentials are stored in this file.
// Short contention waits asynchronously. Longer operations fail within a bound
// so callers can retry rather than blocking the UI or resetting peer state.
export async function withPeerStateLock(runtime,action) {
  if(held.getStore()?.get(runtime)?.active)return action();
  const verificationDeadline=performance.now()+1000;
  let directory;
  // Another process holding the lock creates and removes the SQLite journal in this folder.
  // The macOS check refuses a folder whose entries change while it is inspected,
  // so a waiter retries only that check's refusal within the lock's contention bound.
  for(;;) {
    try {directory=await privateCollectorDirectory(runtime,'private-repair',true);break;}
    catch(error) {
      if(process.platform!=='darwin' || error?.message!=='Private path access-control verification failed' ||
        performance.now()>=verificationDeadline)throw error;
      await delay(20);
      if(performance.now()>=verificationDeadline)throw error;
    }
  }
  const filename=path.join(directory,'operation.sqlite');
  try {
    const file=await open(filename,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
    await file.close();
  } catch(error) {if(error.code!=='EEXIST')throw error;}
  const before=await lstat(filename);
  if(!before.isFile() || before.isSymbolicLink() || before.nlink!==1 || before.size>4096 ||
    (process.platform!=='win32' && (before.mode&0o077)))throw Error('Unsafe pairing operation lock');
  await checkLockSidecars(filename);
  let database;
  const lease={active:false};
  try {
    database=new DatabaseSync(filename);
    openLockDatabases.add(database);
    const after=await lstat(filename);
    if(after.dev!==before.dev || after.ino!==before.ino)throw Error('Changing pairing operation lock');
    if(database.prepare('PRAGMA journal_mode').get().journal_mode!=='delete')throw Error('Unsupported pairing lock mode');
    database.exec('PRAGMA busy_timeout=0; PRAGMA trusted_schema=OFF');
    // On Windows each private-folder check under the lock starts PowerShell,
    // which may take up to 15 seconds. One exchange lease runs several checks,
    // so a waiter allows at least one full check before reporting the lock busy.
    // The bound still fails so callers can retry.
    const deadline=Math.min(performance.now()+peerLockWaitMs(),lockDeadlineMs??Infinity);
    for(;;) {
      try {database.exec('BEGIN IMMEDIATE');break;}
      catch(error) {
        if(error.errcode!==5 || performance.now()>=deadline)throw error;
        await delay(20);
      }
    }
    const contexts=new Map(held.getStore()??[]);lease.active=true;contexts.set(runtime,lease);
    return await held.run(contexts,action);
  } finally {
    lease.active=false;
    if(database) {
      try{database.exec('ROLLBACK');}catch{}
      try{database.close();}finally{openLockDatabases.delete(database);}
    }
  }
}
