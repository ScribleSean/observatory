import {execFile} from 'node:child_process';
import {constants,existsSync,lstatSync} from 'node:fs';
import {open,realpath,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual,promisify} from 'node:util';
import {sshMigrationReceipt,validatePeerTransport} from './peer-transport.mjs';

// Collector/scripts ships without native/. Tests keep these literals aligned with app-names.json.
export const renameNames=Object.freeze({visibleDataFolder:'Observatory',legacyDataFolder:'Workspace Observatory',
  visibleProductName:'Observatory',legacyProductName:'Workspace Observatory'});
const direct=process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
const fields=['remoteNode','remoteScript','remoteRuntime'];
const mismatch='The saved Windows paths do not match the PC migration record. Pairing repair is needed.';
const exact=(value,keys)=>value!==null && typeof value==='object' && !Array.isArray(value) &&
  Reflect.ownKeys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
const normalize=value=>value.replaceAll('/','\\').toLowerCase();
const execute=promisify(execFile);
// The helper's own process is left out, because it may run with the node bundled in Observatory.app.
const processes=async()=>(await execute('/bin/ps',['-axo','pid=,args='],{maxBuffer:4*1024*1024})).stdout
  .split('\n').filter(line=>Number(line.trim().split(/\s+/)[0])!==process.pid)
  .map(line=>line.trim().replace(/^\d+\s+/,'')).join('\n');

function checkProcesses(text) {
  if(typeof text!=='string')throw Error('Mac process check unavailable.');
  for(const line of text.split('\n')) {
    const category=/\.app\/Contents\/Resources\/Runtime\//.test(line)?
      'a bundled Observatory runtime (this includes a shell whose command names the bundled node)':
      line.includes('claude-statusline-bridge.mjs')?'the Claude Code status line bridge':
      /\/WorkspaceObservatory(\s|$)/.test(line) || line.includes('/'+renameNames.legacyProductName+'.app/') ||
      line.includes('/'+renameNames.visibleProductName+'.app/')?'an Observatory app':null;
    if(category)throw Error('Quit the Mac app and its helpers before updating pairing. Still running: '+category+'.');
  }
}
function checkReceipt(record,transport) {
  if(!record || typeof record!=='object' || Array.isArray(record) || record.schema!==1 ||
    record.windowsAppRunning!==false || !exact(record.ssh,['from','to']))throw Error('Invalid PC migration record or PC app still running.');
  for(const side of ['from','to']) {
    if(!exact(record.ssh[side],fields))throw Error('Invalid PC migration paths.');
    validatePeerTransport({...transport,...record.ssh[side]});
  }
}
function replacement(transport,record) {
  const matches=side=>fields.every(key=>normalize(transport[key])===normalize(record.ssh[side][key]));
  if(matches('to'))return null;
  if(!matches('from'))throw Error(mismatch);
  return {...transport,...Object.fromEntries(fields.map(key=>[key,transport[key].includes('/')?
    record.ssh.to[key].replaceAll('\\','/'):record.ssh.to[key].replaceAll('/','\\')]))};
}
function visibleLayout(transport,dataFolder=renameNames.visibleDataFolder,productName=renameNames.visibleProductName) {
  return transport?.kind==='ssh-windows' &&
    path.win32.basename(transport.remoteRuntime).toLowerCase()===dataFolder.toLowerCase() &&
    ['remoteNode','remoteScript'].every(key=>normalize(transport[key]).split('\\').some((part,index,parts)=>
      part==='programs' && parts[index+1]===productName.toLowerCase() && index+2<parts.length));
}
function interruptedPair(active,pending) {
  if(!active || !pending)return null;
  for(const [earlier,updated] of [[active,pending],[pending,active]]) {
    if(!visibleLayout(earlier.transport,renameNames.legacyDataFolder,renameNames.legacyProductName) ||
      !visibleLayout(updated.transport))continue;
    const transport={...earlier.transport};
    if(path.win32.basename(transport.remoteRuntime).toLowerCase()!==renameNames.legacyDataFolder.toLowerCase())continue;
    transport.remoteRuntime=transport.remoteRuntime.slice(0,-renameNames.legacyDataFolder.length)+renameNames.visibleDataFolder;
    for(const key of ['remoteNode','remoteScript'])
      transport[key]=transport[key].replace(/([\\/]Programs[\\/])Workspace Observatory(?=[\\/])/i,
        (_,prefix)=>prefix+renameNames.visibleProductName);
    const normalized=value=>({...value,transport:{...value.transport,
      ...Object.fromEntries(fields.map(key=>[key,normalize(value.transport[key])]))}});
    if(isDeepStrictEqual(normalized({...earlier,transport}),normalized(updated)))return {earlier,updated};
  }
  return null;
}
async function rawPair(directory,name,safe,validatePairing) {
  const file=await open(path.join(directory,name),constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info=await file.stat();
    if(!info.isFile() || info.nlink!==1 || info.size>4096 || (info.mode&0o077))throw Error('Unsafe private pairing file');
    const raw=JSON.parse(await file.readFile('utf8'));
    if(!isDeepStrictEqual(validatePairing(raw),safe))throw Error('Pairing changed during rename.');
    return raw;
  } finally {await file.close();}
}
async function atomicWrite(directory,name,value) {
  const bytes=JSON.stringify(value);
  if(Buffer.byteLength(bytes)>4096)throw Error('Private pairing size limit');
  const temporary=path.join(directory,`.rename-${randomUUID()}.tmp`);
  const file=await open(temporary,'wx',0o600);
  try {
    try {await file.writeFile(bytes);await file.sync();}finally {await file.close();}
    await rename(temporary,path.join(directory,name));
    const folder=await open(directory,'r');
    try {await folder.sync();}finally {await folder.close();}
  } finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function renameWindowsTransport({runtime,fetchReceipt=sshMigrationReceipt,runningProcesses=processes,hooks={}}) {
  if(typeof runtime!=='string' || !path.isAbsolute(runtime) || runtime!==path.resolve(runtime) ||
    runtime!==await realpath(runtime) || path.basename(runtime)!==renameNames.visibleDataFolder)
    throw Error('Canonical Observatory Mac runtime required.');
  checkProcesses(await runningProcesses());
  const {readPairing,readPendingPairing,validatePairing}=await import('./peer-pairing.mjs');
  const {privateSyncDirectory}=await import('./peer-directory.mjs');
  const {withPeerStateLock}=await import('./peer-lock.mjs');
  async function read() {
    const active=await readPairing(runtime),pending=await readPendingPairing(runtime);
    if(active && pending && !isDeepStrictEqual(active,pending) && !interruptedPair(active,pending))
      throw Error('Conflicting pending pairing.');
    return {active,pending};
  }
  const initial=await read();
  if(initial.active?.transport?.kind!=='ssh-windows')return {state:'unchanged',reason:'not-ssh'};
  const interrupted=interruptedPair(initial.active,initial.pending);
  if(!interrupted && visibleLayout(initial.active.transport))return {state:'unchanged',reason:'already-updated'};
  const earlier=interrupted?.earlier ?? initial.active;
  const record=await fetchReceipt(earlier.transport);
  checkReceipt(record,earlier.transport);
  const nextTransport=replacement(earlier.transport,record);
  if(interrupted && !isDeepStrictEqual(nextTransport,interrupted.updated.transport))throw Error('Conflicting pending pairing.');
  if(!nextTransport)return {state:'unchanged',reason:'already-updated'};
  return withPeerStateLock(runtime,async()=>{
    checkProcesses(await runningProcesses());
    const current=await read();
    if(!isDeepStrictEqual(current,initial))throw Error('Pairing changed during rename.');
    const transport=nextTransport;
    const directory=await privateSyncDirectory(runtime);
    const names=current.pending?['setup.pending.json','pairing.json']:['pairing.json'];
    const updates=[],rawPairs=[];
    for(const name of names) {
      const raw=await rawPair(directory,name,name==='pairing.json'?current.active:current.pending,validatePairing);
      rawPairs.push(raw);
      const updated={...raw,transport};
      validatePairing(updated);
      if(Buffer.byteLength(JSON.stringify(updated))>4096)throw Error('Private pairing size limit');
      if(!isDeepStrictEqual(raw,updated))updates.push([name,updated]);
    }
    if(interrupted && !interruptedPair(...rawPairs))throw Error('Conflicting pending pairing.');
    for(const [index,[name,updated]] of updates.entries()) {
      await atomicWrite(directory,name,updated);
      if(index===0)await hooks.afterFirstWrite?.();
    }
    return {state:'updated',fields:[...fields]};
  });
}
function sourcePython() {
  if(process.env.OBSERVATORY_PYTHON!==undefined || existsSync(new URL('../../Runtime/python/bin/python3',import.meta.url)))return;
  for(const name of [renameNames.visibleProductName,renameNames.legacyProductName]) {
    for(const folder of [path.join(homedir(),'Applications'),'/Applications']) {
      const candidate=path.join(folder,name+'.app','Contents/Resources/Runtime/python/bin/python3');
      try {const info=lstatSync(candidate);if(info.isFile() && !info.isSymbolicLink()){process.env.OBSERVATORY_PYTHON=candidate;return;}}
      catch(error) {if(error.code!=='ENOENT' && error.code!=='ENOTDIR')throw error;}
    }
  }
}
async function main() {
  const args=process.argv.slice(2);
  if(args.length!==2 || args[0]!=='--runtime')throw Error('Use --runtime with an absolute Observatory folder.');
  sourcePython();
  const result=await renameWindowsTransport({runtime:args[1]});
  process.stdout.write(JSON.stringify({state:result.state,...(result.reason?{reason:result.reason}:{})})+'\n');
}
if(direct)
  main().catch(error=>{
    const message=typeof error?.message==='string' && !error.message.includes(homedir()) && !/[\\/]/.test(error.message)?error.message:
      'Windows pairing paths could not be updated. Quit both apps and verify the migration record and pairing.';
    process.stderr.write(message+'\n');process.exitCode=1;
  });
