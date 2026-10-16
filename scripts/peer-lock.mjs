import {AsyncLocalStorage} from 'node:async_hooks';
import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {privateCollectorDirectory} from './peer-directory.mjs';

const held=new AsyncLocalStorage();

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
  for(const suffix of ['-journal','-wal','-shm']) {
    try {
      const info=await lstat(filename+suffix);
      if(suffix!=='-journal' || !info.isFile() || info.isSymbolicLink() || info.nlink!==1 || info.size>65536 ||
        (process.platform!=='win32' && (info.mode&0o077)))throw Error('Unsafe pairing lock sidecar');
    }
    catch(error) {if(error.code!=='ENOENT')throw error;}
  }
  let database;
  const lease={active:false};
  try {
    database=new DatabaseSync(filename);
    const after=await lstat(filename);
    if(after.dev!==before.dev || after.ino!==before.ino)throw Error('Changing pairing operation lock');
    if(database.prepare('PRAGMA journal_mode').get().journal_mode!=='delete')throw Error('Unsupported pairing lock mode');
    database.exec('PRAGMA busy_timeout=0; PRAGMA trusted_schema=OFF');
    // Windows verifies protected ACLs through its system helper while holding
    // the lease. Allow short normal writers to finish before treating it busy.
    const deadline=performance.now()+(process.platform==='win32'?5000:1000);
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
    if(database) {try{database.exec('ROLLBACK');}catch{}database.close();}
  }
}
