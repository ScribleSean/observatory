import {lstat,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from './cycle-processes.mjs';

export function assertPrivateOwner(info,target,platform=process.platform) {
  if(platform==='win32' || typeof process.getuid!=='function')return;
  if(info.uid!==process.getuid())throw Error(`Unsafe ${target}: not owned by the current user. Fix with: chown "$USER" "${target}"`);
  if((info.mode & 0o077)!==0)throw Error(`Unsafe ${target}: group or others have access. Fix with: chmod ${info.isDirectory()?'700':'600'} "${target}"`);
}

// Windows keeps access rules in an ACL, not mode bits. The rules are read as SDDL, which names
// accounts by SID, so the check does not depend on the display language.
const SYSTEM='S-1-5-18',ADMINISTRATORS='S-1-5-32-544';
const ALIASES={SY:SYSTEM,BA:ADMINISTRATORS,CO:'S-1-3-0',OW:'S-1-3-4',WD:'S-1-1-0',AU:'S-1-5-11',BU:'S-1-5-32-545',
  IU:'S-1-5-4',BG:'S-1-5-32-546',AN:'S-1-5-7',NU:'S-1-5-2',BO:'S-1-5-32-551',PU:'S-1-5-32-547',SU:'S-1-5-6',
  LS:'S-1-5-19',NS:'S-1-5-20',RD:'S-1-5-32-555'};
// CREATOR OWNER and OWNER RIGHTS stand for whoever owns the item, which the owner check covers.
const TRUSTED=new Set([SYSTEM,ADMINISTRATORS,'S-1-3-0','S-1-3-4']);
// Another account or a group the user made may read, such as the group Codex's Windows sandbox adds
// to the profile folder. Those have IDs of 1000 or more. Built-in and domain-wide groups, such as
// Everyone, Users or Domain Users, may not.
const readerAllowed=who=>{const rid=/^S-1-5-21-\d+-\d+-\d+-(\d+)$/.exec(who)?.[1];return rid!==undefined && Number(rid)>=1000;};
const RIGHTS={GA:0x10000000,GR:0x80000000,GW:0x40000000,GX:0x20000000,RC:0x20000,SD:0x10000,WD:0x40000,WO:0x80000,
  CC:0x1,DC:0x2,LC:0x4,SW:0x8,RP:0x10,WP:0x20,DT:0x40,LO:0x80,CR:0x100,FA:0x1f01ff,FR:0x120089,FW:0x120116,FX:0x1200a0};
// Read, list, traverse, read attributes, read permissions, synchronize, generic read and execute.
const READ_ONLY=0x1200a9|0x80000000|0x20000000;

function rightsMask(text) {
  if(/^0x[0-9a-f]{1,8}$/i.test(text))return Number(text);
  if(!/^(?:[A-Z]{2})+$/.test(text))return null;
  let mask=0;
  for(const alias of text.match(/../g)) {
    if(RIGHTS[alias]===undefined)return null;
    mask|=RIGHTS[alias];
  }
  return mask>>>0;
}

const sid=text=>ALIASES[text] ?? (/^S-1-[0-9-]+$/.test(text)?text:null);

// Returns why a folder is unsafe and which accounts' own entries give access they should not, or null.
// An entry this check cannot read counts as unsafe.
export function windowsAclProblem(sddl,userSid) {
  if(typeof sddl!=='string' || typeof userSid!=='string')return {reason:'unreadable',accounts:[]};
  const parts=/^O:([A-Z]{2}|S-1-[0-9-]+)(?:G:(?:[A-Z]{2}|S-1-[0-9-]+))?(.*)$/.exec(sddl);
  const owner=sid(parts?.[1] ?? '');
  if(owner!==userSid && !TRUSTED.has(owner))return {reason:'owner',accounts:[]};
  // The DACL must follow the owner and group, and its entries must run to its end, so an entry this
  // check cannot read is never skipped.
  const dacl=/^D:([A-Z]*)((?:\([^()]*\))*)(?:S:.*)?$/.exec(parts[2]);
  if(!dacl || /NO_ACCESS_CONTROL/.test(sddl))return {reason:'access',accounts:[]};
  let unsafe=false;
  const accounts=new Set();
  for(const [,entry] of dacl[2].matchAll(/\(([^()]*)\)/g)) {
    const [type,flags,rights,,,account]=entry.split(';');
    if(type==='D')continue;
    const who=sid(account ?? ''),mask=rightsMask(rights ?? '');
    if(type==='A' && who!==null && mask!==null && (who===userSid || TRUSTED.has(who) || (readerAllowed(who) && (mask & ~READ_ONLY)===0)))continue;
    unsafe=true;
    // Inherited entries go with /inheritance:r, so only the folder's own entries need removing.
    if(who!==null && who!==userSid && !TRUSTED.has(who) && !(flags ?? '').match(/../g)?.includes('ID'))accounts.add(who);
  }
  return unsafe?{reason:'access',accounts:[...accounts]}:null;
}

// icacls replaces inherited entries and removes the other accounts' own entries in one step.
export function windowsAclMessage({reason,accounts},target,userSid,detail) {
  if(reason==='owner')return `Unsafe ${target}: not owned by the current user. Fix with: takeown /f "${target}"`;
  if(reason==='unreadable')return `Unsafe ${target}: its access rules could not be read${detail?` (${detail})`:''}`;
  const remove=accounts.length?` /remove ${accounts.map(account=>`*${account}`).join(' ')}`:'';
  return `Unsafe ${target}: other accounts have access. Fix with: icacls "${target}" /inheritance:r${remove} /grant:r "*${userSid}:(OI)(CI)F" "*${SYSTEM}:(OI)(CI)F" "*${ADMINISTRATORS}:(OI)(CI)F"`;
}

const run=(program,args,env)=>new Promise((resolve,reject)=>{
  execFile(program,args,{timeout:15000,maxBuffer:65536,windowsHide:true,env},(error,stdout)=>error?reject(error):resolve(String(stdout).trim()));
});

// System programs by absolute path, so a program of the same name earlier on PATH is never run.
export async function readWindowsSecurity(folder,environment=process.env) {
  const root=environment.SystemRoot;
  if(!root || !path.win32.isAbsolute(root))throw Error('SystemRoot is not set');
  const system32=path.win32.join(root,'System32');
  const user=/"(S-1-[0-9-]+)"$/.exec(await run(path.win32.join(system32,'whoami.exe'),['/user','/fo','csv','/nh'],environment))?.[1];
  // A Node parent can inherit PowerShell 7 module paths that Windows PowerShell cannot load.
  const env=Object.fromEntries(Object.entries(environment).filter(([key])=>key.toLowerCase()!=='psmodulepath'));
  const sddl=await run(path.win32.join(system32,'WindowsPowerShell','v1.0','powershell.exe'),
    ['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; (Get-Acl -LiteralPath $env:OBSERVATORY_ACL_FOLDER).Sddl"],
    {...env,PSModulePath:path.win32.join(system32,'WindowsPowerShell','v1.0','Modules'),OBSERVATORY_ACL_FOLDER:folder});
  return {sddl,userSid:user};
}

export async function assertPrivateWindowsFolder(folder,read=readWindowsSecurity) {
  let security;
  let detail;
  try {security=await read(folder);}catch(error) {security={};detail=String(error?.message ?? '').split(/\r?\n/)[0].slice(0,200);}
  const problem=windowsAclProblem(security.sddl,security.userSid);
  if(problem)throw Error(windowsAclMessage(problem,folder,security.userSid,detail));
}

// Every private folder sits inside the data folder and inherits its ACL, so the data folder is
// checked once per process. Reading an ACL starts PowerShell, which takes a fraction of a second.
const checkedRoots=new Map();
export function assertPrivateRoot(dataFolder,platform=process.platform) {
  if(platform!=='win32')return Promise.resolve();
  const key=path.win32.resolve(dataFolder).toLowerCase();
  if(!checkedRoots.has(key))checkedRoots.set(key,assertPrivateWindowsFolder(dataFolder).catch(error=>{checkedRoots.delete(key);throw error;}));
  return checkedRoots.get(key);
}

export async function privateFolder(dataFolder,...parts) {
  const folder=path.join(dataFolder,...parts);
  await mkdir(folder,{recursive:true,mode:0o700});
  await assertPrivateRoot(dataFolder);
  const info=await lstat(folder);
  if(!info.isDirectory() || info.isSymbolicLink())throw Error(`Unsafe folder ${folder}`);
  assertPrivateOwner(info,folder);
  return folder;
}
