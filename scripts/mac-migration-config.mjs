import {constants} from 'node:fs';
import {lstat,realpath,open,mkdtemp,link} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {planLegacyMacSources} from './mac-migration-plan.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
async function legacyBytes(file) {
  const named=await lstat(file,{bigint:true});
  if(!named.isFile()||named.isSymbolicLink()||named.size>65536n)throw Error('Invalid legacy configuration');
  const input=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await input.stat({bigint:true});
    if(!same(named,before))throw Error('Changing legacy configuration');
    const bytes=Buffer.alloc(Number(before.size)+1);
    let count=0;
    while(count<bytes.length){const {bytesRead}=await input.read(bytes,count,bytes.length-count,count);if(!bytesRead)break;count+=bytesRead;}
    if(count!==Number(before.size)||!same(before,await input.stat({bigint:true}))||!same(before,await lstat(file,{bigint:true})))throw Error('Changing legacy configuration');
    return bytes.subarray(0,count);
  }finally{await input.close();}
}

// The caller must stop the app and hold its collector lock, verify peer coverage
// and retain a visible snapshot archive. This primitive does not prove those gates.
// A complete staged file is linked exclusively, so partial writes never activate.
// Staging copies remain for recovery, including after failed publication.
export async function publishMacMigrationConfig(runtime,{expectedLegacySha256,sources,home=homedir()}={}) {
  if(process.platform!=='darwin'||typeof runtime!=='string'||!path.isAbsolute(runtime)||await realpath(runtime)!==runtime)
    throw Error('Canonical Mac runtime required');
  const root=await lstat(runtime);
  if(!root.isDirectory()||root.isSymbolicLink()||root.uid!==process.getuid()||(root.mode&0o077))throw Error('Owner-only runtime required');
  if(!/^[a-f0-9]{64}$/.test(expectedLegacySha256??''))throw Error('Expected configuration hash required');
  const legacy=path.join(runtime,'local.config.json');
  const bytes=await legacyBytes(legacy);
  if(hash(bytes)!==expectedLegacySha256)throw Error('Stale migration plan');
  const plan=planLegacyMacSources(JSON.parse(bytes.toString('utf8')),home);
  if(plan.status!=='review-required'||!isDeepStrictEqual(plan.sources,sources))throw Error('Source mapping changed');
  const target=path.join(runtime,'collector.config.json');
  try{await lstat(target);throw Error('Native configuration already exists');}catch(error){if(error.code!=='ENOENT')throw error;}
  const stage=await mkdtemp(path.join(runtime,'.migration-config-'));
  const staged=path.join(stage,'collector.config.json');
  const output=await open(staged,'wx',0o600);
  try{await output.writeFile(JSON.stringify(sources));await output.sync();}finally{await output.close();}
  if(hash(await legacyBytes(legacy))!==expectedLegacySha256)throw Error('Stale migration plan');
  await link(staged,target);
  const directory=await open(runtime,constants.O_RDONLY);
  try{await directory.sync();}finally{await directory.close();}
  return {activated:true,staged,legacyPreserved:true};
}
