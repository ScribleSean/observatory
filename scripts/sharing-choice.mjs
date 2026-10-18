import {lstat,open,rename,unlink} from 'node:fs/promises';
import {constants,realpathSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateSyncDirectory,privateRefusalBudget} from './peer-directory.mjs';
import {limitPeerLockWait,withPeerStateLock} from './peer-lock.mjs';
import {readPairing} from './peer-pairing.mjs';
import {recent} from './quota-sharing-control.mjs';
import {readQuotaState,setQuotaSharing,revokeQuotaSharing} from './quota-store.mjs';
import {readProviderTokenState,setProviderTokenSharing,disableProviderTokenSharing,recentProviderSource} from './provider-token-store.mjs';

const channels=['codex-limits','claude-code-tokens'];
class SharingChoiceValidationError extends Error {}
const fail=()=>new SharingChoiceValidationError('Sharing choice unavailable');
const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) &&
  Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
const exists=async filename=>{try {await lstat(filename);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const result=(chosen=false,state='off')=>({version:1,chosen,channels:Object.fromEntries(channels.map(channel=>[channel,state]))});
const same=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs','mode','nlink','uid'].every(key=>a[key]===b[key]);
async function readIntent(runtime,pair,directory) {
  directory??=await privateSyncDirectory(runtime);
  const filename=path.join(directory,'sharing-choice.json');
  let before;
  try {before=await lstat(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(!before.isFile() || before.isSymbolicLink() || before.nlink!==1 || before.size>1024 ||
    (process.platform!=='win32' && ((before.mode&0o077) || before.uid!==process.getuid())))throw fail();
  const file=await open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    if(!same(before,await file.stat()))throw fail();
    const bytes=Buffer.alloc(1025),{bytesRead}=await file.read(bytes,0,bytes.length,0);
    if(bytesRead!==before.size || !same(before,await file.stat()) || !same(before,await lstat(filename)))throw fail();
    let value;
    try {value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead)));}
    catch {throw fail();}
    if(!exact(value,['version','pairId','enabled','applied']) || value.version!==1 || value.enabled!==true ||
      typeof value.pairId!=='string' || !/^[a-f0-9]{64}$/.test(value.pairId) || !exact(value.applied,channels) ||
      channels.some(channel=>typeof value.applied[channel]!=='boolean'))throw fail();
    return value.pairId===pair.local.pairId?value:null;
  } finally {await file.close();}
}
async function writeIntent(runtime,value,directory) {
  directory??=await privateSyncDirectory(runtime);
  const pending=path.join(directory,`sharing-choice-${randomBytes(16).toString('hex')}.pending`);
  let created=false,renamed=false;
  try {
    const file=await open(pending,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
    created=true;
    try {await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}
    await rename(pending,path.join(directory,'sharing-choice.json'));renamed=true;
  } finally {if(created && !renamed)await unlink(pending);}
  await privateSyncDirectory(runtime);
}
async function quotaState(runtime,now) {
  return await exists(path.join(runtime,'private-quota'))?readQuotaState(runtime,now):null;
}
const quotaOn=(state,pair)=>Boolean(state?.sharing.enabled && state.sharing.pairingId===pair.local.pairId);

export const chooseSharing=(runtime,{enabled})=>withPeerStateLock(runtime,async()=>{
  if(typeof enabled!=='boolean')throw fail();
  if(!enabled) {
    await clearSharingChoice(runtime);
    await revokeQuotaSharing(runtime);
    await disableProviderTokenSharing(runtime);
    return;
  }
  let pair;
  try {pair=await readPairing(runtime);}catch {throw fail();}
  if(!pair)throw fail();
  const directory=await privateSyncDirectory(runtime);
  let prior;
  try {prior=await readIntent(runtime,pair,directory);}catch {}
  await writeIntent(runtime,prior??{version:1,pairId:pair.local.pairId,enabled:true,
    applied:Object.fromEntries(channels.map(channel=>[channel,false]))},directory);
});

// Callers must already hold the peer lock because the lstat fast path runs before locking.
export async function markSharingChoiceApplied(runtime,channel) {
  try {await lstat(path.join(runtime,'private-sync','sharing-choice.json'));}catch(error){if(error.code==='ENOENT')return;}
  await withPeerStateLock(runtime,async()=>{
    if(!channels.includes(channel))return;
    let pair,intent,directory;
    try {
      pair=await readPairing(runtime);
      if(!pair)return;
      directory=await privateSyncDirectory(runtime);
      intent=await readIntent(runtime,pair,directory);
    } catch(error) {
      if(!(error instanceof SharingChoiceValidationError))await clearSharingChoice(runtime);
      return;
    }
    if(!intent || intent.applied[channel])return;
    intent.applied[channel]=true;
    try {await writeIntent(runtime,intent,directory);}
    catch {await clearSharingChoice(runtime);}
  });
}

export const applySharingChoice=(runtime,channel,now=Date.now())=>withPeerStateLock(runtime,async()=>{
  if(!channels.includes(channel) || !Number.isSafeInteger(now) || now<0)throw fail();
  let pair,intent,directory;
  try {
    pair=await readPairing(runtime);
    if(pair) {
      directory=await privateSyncDirectory(runtime);
      intent=await readIntent(runtime,pair,directory);
    }
  } catch {return {status:'none'};}
  if(!intent)return {status:'none'};
  if(intent.applied[channel])return {status:'already-applied'};
  if(channel==='codex-limits') {
    const state=await quotaState(runtime,now);
    if(!quotaOn(state,pair)) {
      if(!recent(state,now))return {status:'waiting-for-reading'};
      await setQuotaSharing(runtime,{revision:state.revision,enabled:true,pairingId:pair.local.pairId},now);
    }
  } else {
    const state=await readProviderTokenState(runtime,now);
    if(!state?.generation) {
      if(!recentProviderSource(state?.source,now))return {status:'waiting-for-reading'};
      await setProviderTokenSharing(runtime,{revision:state.revision,enabled:true},now);
    }
  }
  intent.applied[channel]=true;
  await writeIntent(runtime,intent,directory);
  return {status:'applied'};
});

export async function readSharingChoice(runtime,now=Date.now(),options={}) {
  const retry=privateRefusalBudget(options);
  try {return await retry(()=>withPeerStateLock(runtime,async()=>{
    let directory;
    try {directory=await privateSyncDirectory(runtime);}catch(error){if(error.code==='ENOENT')return result();throw error;}
    if(await exists(path.join(directory,'revoked')))return result();
    const pair=await readPairing(runtime);
    if(!pair)return result();
    const intent=await readIntent(runtime,pair,directory),quota=await quotaState(runtime,now),provider=await readProviderTokenState(runtime,now);
    const status=result(Boolean(intent));
    for(const channel of channels)status.channels[channel]=(channel==='codex-limits'?quotaOn(quota,pair):Boolean(provider?.generation))?
      'on':intent && !intent.applied[channel]?'waiting-for-reading':'off';
    return status;
  }));}catch {return result(false,'unavailable');}
}

export const clearSharingChoice=runtime=>withPeerStateLock(runtime,async()=>{
  let directory;
  try {directory=await privateSyncDirectory(runtime);}catch(error){if(error.code==='ENOENT')return;throw error;}
  const filename=path.join(directory,'sharing-choice.json');
  let info;
  try {info=await lstat(filename);}catch(error){if(error.code==='ENOENT')return;throw error;}
  if(!info.isFile() || info.isSymbolicLink())throw fail();
  await unlink(filename);
});

export const peerLockWaitCapMs=5000;
export const commandExitMs=(platform=process.platform)=>platform==='win32'?40000:10000;

async function main() {
  // Fit inside the 45000 ms Windows bridge deadline and the command exit timer.
  limitPeerLockWait(peerLockWaitCapMs);
  const args=process.argv.slice(2);
  if(args.length!==2 || args[0]!=='--runtime' || !path.isAbsolute(args[1]))throw fail();
  const chunks=[];let bytes=0;
  const timeout=setTimeout(()=>{process.stderr.write('Sharing choice unavailable.\n');process.exit(1);},commandExitMs());
  try {
    for await(const chunk of process.stdin) {bytes+=chunk.length;if(bytes>1024)throw fail();chunks.push(chunk);}
    const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    let response;
    if(request?.action==='choose' && exact(request,['action','enabled']) && typeof request.enabled==='boolean')
      response=await withPeerStateLock(args[1],async()=>{
        await chooseSharing(args[1],{enabled:request.enabled});
        return readSharingChoice(args[1]);
      });
    else if(request?.action!=='status' || !exact(request,['action']))throw fail();
    else response=await readSharingChoice(args[1]);
    process.stdout.write(JSON.stringify(response)+'\n');
  } finally {clearTimeout(timeout);}
}
if(process.argv[1] && process.argv[1]!=='-' && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))main().catch(()=>{
  process.stderr.write('Sharing choice unavailable.\n');process.exitCode=1;
});
