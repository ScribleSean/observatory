import * as fs from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {appNames} from '../app-names.mjs';
import {readPairing,validatePairing} from '../../scripts/peer-pairing.mjs';
import {withPeerStateLock} from '../../scripts/peer-lock.mjs';

const marker='observatory-migration.json';
const byText=(a,b)=>a<b?-1:a>b?1:0;
const digest=value=>createHash('sha256').update(value).digest('hex');
function hashFile(file) {
  const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024),fd=fs.openSync(file,'r');
  try {
    let length;
    while((length=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,length));
    return hash.digest('hex');
  } finally {fs.closeSync(fd);}
}
const stat=file=>{try{return fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
function layout({legacy,target,stage}) {
  if([legacy,target,stage].some(p=>typeof p!=='string' || !path.isAbsolute(p) || path.resolve(p)!==p) ||
    new Set([legacy,target,stage]).size!==3 || path.dirname(legacy)!==path.dirname(target) || path.dirname(legacy)!==path.dirname(stage))
    throw Error('Distinct absolute sibling folders are required.');
  for(let p=path.dirname(legacy);;p=path.dirname(p)) {
    const info=stat(p);
    if(!info?.isDirectory() || info.isSymbolicLink())throw Error('Linked or missing data ancestor refused.');
    if(path.dirname(p)===p)break;
  }
  for(const p of [legacy,target,stage]) {
    const info=stat(p);
    if(info && (!info.isDirectory() || info.isSymbolicLink() ||
      (p!==target && info.uid!==process.getuid())))throw Error('Unsafe data folder refused.');
  }
}
function manifest(root,{ignoreMarker=false}={}) {
  const entries=[],skipped=[],refused=[],linksOutsideBackups=[],times=new Map();
  function visit(relative) {
    for(const name of fs.readdirSync(path.join(root,relative)).sort()) {
      const rel=relative?relative+'/'+name:name;
      const file=path.join(root,rel),info=fs.lstatSync(file);
      if(ignoreMarker && rel===marker && info.isFile())continue;
      if(info.isSocket() || info.isFIFO()){skipped.push(rel);continue;}
      if(info.isSymbolicLink() && rel.startsWith('Backups/')) {
        const linkText=fs.readlinkSync(file);
        const destination=path.posix.normalize(path.posix.dirname(rel)+'/'+linkText);
        if(path.posix.isAbsolute(linkText) || (destination!=='Backups' && !destination.startsWith('Backups/')))
          linksOutsideBackups.push(rel);
        entries.push({path:rel,type:'symlink',linkText,mtimeMs:Math.trunc(info.mtimeMs)});
        times.set(rel,{atime:info.atimeMs/1000,mtime:info.mtimeMs/1000});
        continue;
      }
      if(!info.isDirectory() && !info.isFile()){refused.push(rel);continue;}
      const entry={path:rel,type:info.isDirectory()?'directory':'file',mode:info.mode&0o7777,
        size:info.size,mtimeMs:Math.trunc(info.mtimeMs)};
      times.set(rel,{atime:info.atimeMs/1000,mtime:info.mtimeMs/1000});
      if(info.isFile())entry.sha256=hashFile(file);
      entries.push(entry);
      if(info.isDirectory())visit(rel);
    }
  }
  visit('');entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return {entries,skipped:skipped.sort(byText),refused:refused.sort(byText),linksOutsideBackups:linksOutsideBackups.sort(byText),times};
}
const hash=m=>digest(JSON.stringify(m.entries));
const counts=m=>({directories:m.entries.filter(e=>e.type==='directory').length,
  files:m.entries.filter(e=>e.type==='file').length,bytes:m.entries.filter(e=>e.type==='file').reduce((n,e)=>n+e.size,0),
  skipped:m.skipped,linksOutsideBackups:m.linksOutsideBackups,manifestSha256:hash(m)});
function receiptMatches(target,sha) {
  const file=path.join(target,marker),info=stat(file);
  if(!info?.isFile() || info.isSymbolicLink())return false;
  try{return JSON.parse(fs.readFileSync(file,'utf8')).manifestSha256===sha;}catch{return false;}
}
function syncDirectory(folder) {
  const fd=fs.openSync(folder,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function writeSynced(file,bytes) {
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
export function inspectDataMigration(options) {
  layout(options);
  const {legacy,target,stage}=options,source=stat(legacy)?manifest(legacy):null;
  return {legacy:source?'present':'missing',target:!stat(target)?'missing':!fs.readdirSync(target).length?'empty':
    source && receiptMatches(target,hash(source))?'migrated':'holds-data',stage:stat(stage)?'present':'missing',
    files:source?counts(source).files:null,bytes:source?counts(source).bytes:null,
    refused:source?.refused??[],skipped:source?.skipped??[],linksOutsideBackups:source?.linksOutsideBackups??[]};
}
export function migrateDataFolder({legacy,target,stage,runningProcesses,now=()=>new Date(),hooks={}}) {
  let output;
  try{output=runningProcesses();}catch{throw Error('Cannot verify application shutdown.');}
  if(typeof output!=='string' || output.length>8*1024*1024)throw Error('Cannot verify application shutdown.');
  if(output.split('\n').some(line=>line.trim().endsWith('/'+appNames.internal.macExecutable)))
    throw Error('Quit all Observatory app copies before migration.');
  layout({legacy,target,stage});
  if(!stat(legacy))throw Error('The earlier data folder is missing.');
  const rootInfo=fs.lstatSync(legacy),source=manifest(legacy),summary=counts(source);
  if(source.refused.length)throw Error('Unsupported entries: '+source.refused.map(p=>JSON.stringify(p)).join(', ')+'.');
  if(stat(target) && fs.readdirSync(target).length) {
    if(receiptMatches(target,summary.manifestSha256))return {state:'already-migrated',...summary};
    throw Error('The new data folder already holds data');
  }
  if(!stat(stage))fs.mkdirSync(stage,{mode:0o700});
  const existing=manifest(stage);
  if(existing.refused.length || existing.skipped.length)throw Error('Unsafe staging entries refused.');
  for(const entry of existing.entries)if((entry.type==='file' || entry.type==='symlink') && entry.path.endsWith('.observatory-partial'))
    fs.unlinkSync(path.join(stage,entry.path));
  for(const entry of source.entries) {
    const dest=path.join(stage,entry.path),info=stat(dest);
    if(entry.type==='directory') {
      if(info && !info.isDirectory())throw Error('Staging entry type mismatch.');
      if(!info)fs.mkdirSync(dest,{mode:0o700});
      continue;
    }
    if(entry.type==='symlink') {
      if(info && !info.isSymbolicLink())throw Error('Staging entry type mismatch.');
      const temporary=dest+'.'+randomBytes(12).toString('hex')+'.observatory-partial';
      fs.symlinkSync(entry.linkText,temporary);
      const time=source.times.get(entry.path);
      fs.lutimesSync(temporary,time.atime,time.mtime);
      if(fs.readlinkSync(temporary)!==entry.linkText)throw Error('The copied link does not match.');
      fs.renameSync(temporary,dest);
      hooks.afterFile?.(entry.path);
      continue;
    }
    if(info && !info.isFile())throw Error('Staging entry type mismatch.');
    if(info && info.size===entry.size && (info.mode&0o7777)===entry.mode && hashFile(dest)===entry.sha256)continue;
    const temporary=dest+'.'+randomBytes(12).toString('hex')+'.observatory-partial';
    fs.copyFileSync(path.join(legacy,entry.path),temporary,fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temporary,entry.mode);
    const time=source.times.get(entry.path);
    fs.utimesSync(temporary,time.atime,time.mtime);
    if(hashFile(temporary)!==entry.sha256)throw Error('The copied file does not match.');
    fs.renameSync(temporary,dest);
    hooks.afterFile?.(entry.path);
  }
  for(const entry of [...source.entries].reverse())if(entry.type==='directory') {
    const dest=path.join(stage,entry.path),time=source.times.get(entry.path);
    fs.chmodSync(dest,entry.mode);fs.utimesSync(dest,time.atime,time.mtime);
  }
  const current=manifest(legacy),copied=manifest(stage,{ignoreMarker:true});
  if(hash(current)!==hash(source) || JSON.stringify(current.skipped)!==JSON.stringify(source.skipped) || current.refused.length)
    throw Error('The earlier data folder changed during the copy. Quit every Observatory app and run again.');
  if(hash(copied)!==hash(source) || copied.refused.length || copied.skipped.length)throw Error('The staging copy does not match the earlier data folder.');
  writeSynced(path.join(stage,marker),JSON.stringify({schema:1,from:appNames.legacy.dataFolder,to:appNames.visible.dataFolder,
    completedAt:now().toISOString(),...summary})+'\n');
  fs.chmodSync(stage,rootInfo.mode&0o7777);
  fs.utimesSync(stage,rootInfo.atimeMs/1000,rootInfo.mtimeMs/1000);
  fs.renameSync(stage,target);syncDirectory(path.dirname(target));
  return {state:'migrated',...summary};
}
export async function updateWindowsPeerPaths({runtime}) {
  if(typeof runtime!=='string' || !path.isAbsolute(runtime) || path.basename(path.resolve(runtime))!==appNames.visible.dataFolder)
    throw Error('Use the new data folder for pairing updates.');
  const initial=await readPairing(runtime);
  if(initial?.transport?.kind!=='ssh-windows')return {state:'unchanged'};
  return withPeerStateLock(runtime,async()=>{
    const pairing=await readPairing(runtime),fields=[];
    if(pairing?.transport?.kind!=='ssh-windows')return {state:'unchanged'};
    for(const field of ['remoteNode','remoteScript','remoteRuntime']) {
      const parts=pairing.transport[field].split(/([\\/])/),parent=field==='remoteRuntime'?'local':'programs';
      for(let i=2;i<parts.length;i+=2)if(parts[i]===appNames.legacy.productName && parts[i-2].toLowerCase()===parent) {
        parts[i]=appNames.visible.productName;fields.push(field);break;
      }
      pairing.transport[field]=parts.join('');
    }
    if(!fields.length)return {state:'unchanged'};
    const safe=validatePairing(pairing),directory=path.join(runtime,'private-sync');
    const temporary=path.join(directory,'pairing.'+randomBytes(12).toString('hex')+'.observatory-partial');
    writeSynced(temporary,JSON.stringify(safe)+'\n');
    fs.renameSync(temporary,path.join(directory,'pairing.json'));syncDirectory(directory);
    return {state:'updated',fields};
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [command,...flags]=process.argv.slice(2);
    if(!['status','copy','windows-peer-paths'].includes(command) ||
      (command==='copy'?flags.length!==1 || flags[0]!=='--confirm-app-quit':flags.length!==0))
      throw Error('Use status, windows-peer-paths or copy with --confirm-app-quit.');
    const parent=path.join(homedir(),'Library/Application Support');
    const options={legacy:path.join(parent,appNames.legacy.dataFolder),target:path.join(parent,appNames.visible.dataFolder),
      stage:path.join(parent,'.'+appNames.visible.dataFolder+'-migration')};
    const result=command==='status'?inspectDataMigration(options):command==='windows-peer-paths'?
      await updateWindowsPeerPaths({runtime:options.target}):migrateDataFolder({...options,
        runningProcesses:()=>execFileSync('/bin/ps',['-axo','comm='],{encoding:'utf8',timeout:10000})});
    console.log(JSON.stringify(result));
  } catch(error) {
    console.error(typeof error.message==='string' && !error.message.includes(homedir())?error.message:
      'Data migration refused. Check the folders and quit every Observatory app before retrying.');
    process.exitCode=1;
  }
}
