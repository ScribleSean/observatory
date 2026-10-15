import {constants} from 'node:fs';
import {lstat,open,realpath,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {trustedDirectoryAncestry,verifyPrivateDirectory} from './peer-directory.mjs';
import {retainActivityHistory} from './activity-history.mjs';

const maximumBytes=16_000_000;
const same=(a,b)=>a.dev===b.dev && a.ino===b.ino && a.size===b.size &&
  a.mtimeNs===b.mtimeNs && a.ctimeNs===b.ctimeNs;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

async function readEvidence(file,limit=maximumBytes,privateFile=false) {
  if(!path.isAbsolute(file) || await realpath(path.dirname(file))!==path.dirname(file))
    throw Error('Canonical snapshot location required');
  const entry=await lstat(file,{bigint:true});
  if(!entry.isFile() || entry.isSymbolicLink() || entry.nlink!==1n || entry.size>BigInt(limit) ||
    (privateFile && process.platform!=='win32' && (entry.uid!==BigInt(process.getuid()) || (entry.mode&0o077n)!==0n)))
    throw Error('Invalid snapshot file');
  const handle=await open(file,(privateFile?constants.O_RDWR:constants.O_RDONLY)|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await handle.stat({bigint:true});
    if(!same(entry,before))throw Error('Changing snapshot');
    const bytes=Buffer.alloc(Number(before.size)+1);
    let total=0;
    while(total<bytes.length) {
      const {bytesRead}=await handle.read(bytes,total,bytes.length-total,total);
      if(!bytesRead)break;
      total+=bytesRead;
    }
    // Flush verified archive handles before allowing the original to change.
    if(privateFile)await handle.sync();
    const after=await handle.stat({bigint:true}),named=await lstat(file,{bigint:true});
    if(total!==Number(before.size) || !same(before,after) || !same(before,named) ||
      named.isSymbolicLink() || await realpath(path.dirname(file))!==path.dirname(file))
      throw Error('Changing snapshot');
    return {data:bytes.subarray(0,total),info:before};
  } finally {await handle.close();}
}

async function readSnapshot(file,privateFile=false) {
  const snapshot=await readEvidence(file,maximumBytes,privateFile);
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(snapshot.data));
  if(!value || value.schema!==2 || typeof value.collectedAt!=='string' ||
    !Number.isFinite(Date.parse(value.collectedAt)))throw Error('Invalid snapshot header');
  return {...snapshot,collectedAt:value.collectedAt,value};
}

// Migration preparation only. The caller owns collector locking and activation.
// Partial writes remain in a new private directory and never count as success.
// This preserves existing snapshot bytes, not arbitrary raw source records.
export async function archiveMacSnapshot(snapshotFile,archiveRoot) {
  if(process.platform!=='darwin')throw Error('Mac archive preparation required');
  if(!path.isAbsolute(archiveRoot) || await realpath(archiveRoot)!==archiveRoot)
    throw Error('Canonical private archive directory required');
  const root=await trustedDirectoryAncestry(archiveRoot);
  if(!root.isDirectory() || root.isSymbolicLink() || root.uid!==process.getuid() || (root.mode&0o077)!==0)
    throw Error('Private owner-only archive directory required');
  const snapshot=await readSnapshot(snapshotFile);
  const folder=await mkdtemp(path.join(archiveRoot,'snapshot-'));
  return writeArchive(snapshot,folder,'snapshot.json','receipt.json');
}

async function syncDirectory(folder) {
  // Node cannot open a Windows directory for fsync. File contents are flushed
  // on both platforms. POSIX also flushes the new directory entries.
  if(process.platform==='win32')return;
  const directory=await open(folder,constants.O_RDONLY);
  try {await directory.sync();}finally {await directory.close();}
}

async function writeExclusive(file,bytes) {
  const output=await open(file,'wx',0o600);
  try {await output.writeFile(bytes);await output.sync();}
  finally {await output.close();}
}

async function writeArchive(snapshot,folder,snapshotName,receiptName) {
  const directory=await verifyPrivateDirectory(folder);
  const file=path.join(folder,snapshotName);
  await writeExclusive(file,snapshot.data);
  const saved=await readSnapshot(file,true);
  const sha256=digest(snapshot.data);
  if(!saved.data.equals(snapshot.data))throw Error('Archive verification failed');
  const expected={version:1,collectedAt:snapshot.collectedAt,bytes:snapshot.data.length,sha256};
  const receiptFile=path.join(folder,receiptName);
  await writeExclusive(receiptFile,JSON.stringify(expected)+'\n');
  const receiptEvidence=await readEvidence(receiptFile,8192,true);
  const receipt=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(receiptEvidence.data));
  if(!receipt || Object.keys(receipt).length!==Object.keys(expected).length ||
    Object.entries(expected).some(([key,value])=>receipt[key]!==value))
    throw Error('Archive receipt verification failed');
  await syncDirectory(folder);
  await syncDirectory(path.dirname(folder));
  await verifyPrivateDirectory(folder);
  const current=await lstat(folder),finalSnapshot=await readSnapshot(file,true),finalReceipt=await readEvidence(receiptFile,8192,true);
  if(current.isSymbolicLink() || current.dev!==directory.dev || current.ino!==directory.ino ||
    !same(saved.info,finalSnapshot.info) || !finalSnapshot.data.equals(snapshot.data) ||
    !same(receiptEvidence.info,finalReceipt.info) || !finalReceipt.data.equals(receiptEvidence.data))
    throw Error('Archive changed during verification');
  return {file,...receipt};
}

async function optionalSnapshot(file) {
  // Only an initially absent entry means first collection. A disappearance
  // after opening or while verifying the read must propagate as a failure.
  try {await lstat(file);}catch(error) {if(error.code==='ENOENT')return null;throw error;}
  // A crash before the data reached disk can leave a snapshot of zero bytes
  // only. It holds no records, so it counts as a first collection. Any other
  // unreadable snapshot still fails closed.
  if((await readEvidence(file,maximumBytes)).data.every(byte=>byte===0))return null;
  return readSnapshot(file);
}

// The platform caller already owns collection.lock or .runtime/collector.lock.
// Do not acquire a second lock here. Read history from the same stable source,
// then check it again immediately before the caller renames.
export async function retirementSnapshotGuard(runtime) {
  if(!path.isAbsolute(runtime) || path.resolve(runtime)!==await realpath(runtime))
    throw Error('Canonical snapshot runtime required');
  const file=path.join(runtime,'public/local/usage.json');
  const snapshot=await optionalSnapshot(file);
  const value=snapshot?.value;
  const history=value ? (Array.isArray(value.activityHistory)?value.activityHistory:
    retainActivityHistory([],[value.combined,...(value.activity||[])].filter(Boolean),value.collectedAt)) : [];
  const unchanged=async()=>{
    const current=await optionalSnapshot(file);
    if(snapshot ? !current || !same(snapshot.info,current.info) || !snapshot.data.equals(current.data) : current)
      throw Error('Snapshot changed during collection');
  };
  return {history,preserve:async()=>{
    // This is the last check before the caller renames.
    await unchanged();
  }};
}
