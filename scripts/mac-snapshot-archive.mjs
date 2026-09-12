import {constants} from 'node:fs';
import {lstat,open,realpath,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

const maximumBytes=16_000_000;
const same=(a,b)=>a.dev===b.dev && a.ino===b.ino && a.size===b.size &&
  a.mtimeNs===b.mtimeNs && a.ctimeNs===b.ctimeNs;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

async function readSnapshot(file) {
  if(!path.isAbsolute(file) || await realpath(path.dirname(file))!==path.dirname(file))
    throw Error('Canonical snapshot location required');
  const entry=await lstat(file,{bigint:true});
  if(!entry.isFile() || entry.isSymbolicLink() || entry.size>BigInt(maximumBytes))
    throw Error('Invalid snapshot file');
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
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
    const after=await handle.stat({bigint:true}),named=await lstat(file,{bigint:true});
    if(total!==Number(before.size) || !same(before,after) || !same(before,named))
      throw Error('Changing snapshot');
    const data=bytes.subarray(0,total);
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
    if(!value || value.schema!==2 || typeof value.collectedAt!=='string' ||
      !Number.isFinite(Date.parse(value.collectedAt)))throw Error('Invalid snapshot header');
    return {data,collectedAt:value.collectedAt};
  } finally {await handle.close();}
}

// Migration preparation only. The caller owns collector locking and activation.
// Partial writes remain in a new private directory and never count as success.
// This preserves existing snapshot bytes, not arbitrary raw source records.
export async function archiveMacSnapshot(snapshotFile,archiveRoot) {
  if(process.platform!=='darwin')throw Error('Mac archive preparation required');
  if(!path.isAbsolute(archiveRoot) || await realpath(archiveRoot)!==archiveRoot)
    throw Error('Canonical private archive directory required');
  const root=await lstat(archiveRoot);
  if(!root.isDirectory() || root.isSymbolicLink() || root.uid!==process.getuid() || (root.mode&0o077)!==0)
    throw Error('Private owner-only archive directory required');
  const snapshot=await readSnapshot(snapshotFile);
  const folder=await mkdtemp(path.join(archiveRoot,'snapshot-'));
  const file=path.join(folder,'snapshot.json');
  const output=await open(file,'wx',0o600);
  try {await output.writeFile(snapshot.data);await output.sync();}
  finally {await output.close();}
  const saved=await readSnapshot(file);
  const sha256=digest(snapshot.data);
  if(digest(saved.data)!==sha256)throw Error('Archive verification failed');
  const receipt={version:1,collectedAt:snapshot.collectedAt,bytes:snapshot.data.length,sha256};
  const manifest=await open(path.join(folder,'receipt.json'),'wx',0o600);
  try {await manifest.writeFile(JSON.stringify(receipt)+'\n');await manifest.sync();}
  finally {await manifest.close();}
  const directory=await open(folder,constants.O_RDONLY);
  try {await directory.sync();}finally {await directory.close();}
  const parent=await open(archiveRoot,constants.O_RDONLY);
  try {await parent.sync();}finally {await parent.close();}
  return {file,...receipt};
}
