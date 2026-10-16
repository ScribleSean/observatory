import * as fs from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {appNames} from '../app-names.mjs';

const marker='observatory-migration.json';
const byText=(a,b)=>a<b?-1:a>b?1:0;
const digest=value=>createHash('sha256').update(value).digest('hex');
const safePath=rel=>rel.split('/').some(part=>part.startsWith('private-'))?rel.split('/')[0]:rel;
const identity=info=>({dev:info.dev,ino:info.ino,uid:info.uid,nlink:info.nlink,size:info.size,mtimeMs:Math.trunc(info.mtimeMs)});
function readSource(file,expected,destination) {
  let fd,out;
  try {
    fd=fs.openSync(file,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const info=fs.fstatSync(fd);
    if(!info.isFile() || ['dev','ino','size','mtimeMs'].some(key=>identity(info)[key]!==expected[key]))
      throw Error('Source file changed.');
    if(destination)out=fs.openSync(destination,'wx',0o600);
    const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);
    let length;
    while((length=fs.readSync(fd,buffer,0,buffer.length,null))>0) {
      hash.update(buffer.subarray(0,length));
      if(out!==undefined)fs.writeFileSync(out,buffer.subarray(0,length));
    }
    if(out!==undefined)fs.fsyncSync(out);
    return hash.digest('hex');
  } catch {
    if(out!==undefined)fs.unlinkSync(destination);
    throw Error('The earlier data folder changed during the copy. Quit every Observatory app and run again.');
  } finally {
    if(fd!==undefined)fs.closeSync(fd);
    if(out!==undefined)fs.closeSync(out);
  }
}
export function runningProcessArgs(readPs=execFileSync) {
  return readPs('/bin/ps',['-axo','pid=,args='],{encoding:'utf8',timeout:10000})
    .split('\n').filter(line=>Number(line.trim().split(/\s+/)[0])!==process.pid)
    .map(line=>line.trim().replace(/^\d+\s+/,'')).join('\n');
}
export function assertObservatoryStopped(runningProcesses,message) {
  let output;
  try{output=runningProcesses();}catch{throw Error('Cannot verify application shutdown.');}
  if(typeof output!=='string' || output.length>8*1024*1024)throw Error('Cannot verify application shutdown.');
  const executable=new RegExp('/'+appNames.internal.macExecutable.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(\\s|$)');
  for(const line of output.split('\n')) {
    const category=/\.app\/Contents\/Resources\/Runtime\//.test(line)?
      'a bundled Observatory runtime (this includes a shell whose command names the bundled node)':
      line.includes('claude-statusline-bridge.mjs')?'the Claude Code status line bridge':
      executable.test(line) || line.includes('/'+appNames.legacy.macBundle+'/') ||
      line.includes('/'+appNames.visible.macBundle+'/')?'an Observatory app':null;
    if(category)throw Error(message+' Still running: '+category+'.');
  }
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
      if(info.uid!==process.getuid())throw Error('Entry is not owned by the current user: '+safePath(rel));
      if(info.isFile() && rel.split('/').slice(0,-1).some(part=>part.startsWith('private-')) && info.nlink!==1)
        throw Error('Private file has multiple links: '+safePath(rel));
      if(info.isSocket() || info.isFIFO()){skipped.push(rel);continue;}
      if(info.isSymbolicLink() && rel.startsWith('Backups/')) {
        const linkText=fs.readlinkSync(file);
        const destination=path.posix.normalize(path.posix.dirname(rel)+'/'+linkText);
        if(path.posix.isAbsolute(linkText) || (destination!=='Backups' && !destination.startsWith('Backups/')))
          linksOutsideBackups.push(rel);
        entries.push({path:rel,type:'symlink',linkText,...identity(info)});
        times.set(rel,{atime:info.atimeMs/1000,mtime:info.mtimeMs/1000});
        continue;
      }
      if(!info.isDirectory() && !info.isFile()){refused.push(rel);continue;}
      const entry={path:rel,type:info.isDirectory()?'directory':'file',mode:info.mode&0o7777,
        ...identity(info)};
      times.set(rel,{atime:info.atimeMs/1000,mtime:info.mtimeMs/1000});
      if(info.isFile())entry.sha256=readSource(file,entry);
      entries.push(entry);
      if(info.isDirectory())visit(rel);
    }
  }
  visit('');entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return {entries,skipped:skipped.sort(byText),refused:refused.sort(byText),linksOutsideBackups:linksOutsideBackups.sort(byText),times};
}
const hash=m=>digest(JSON.stringify(m.entries));
// Copies have new inodes and link counts. Directory sizes depend on the filesystem.
const copyHash=m=>digest(JSON.stringify(m.entries.map(({dev:_dev,ino:_ino,nlink:_nlink,size,...entry})=>
  entry.type==='file'?{...entry,size}:entry)));
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
function statusLineTargetsEarlierFolder(settingsPath,legacy) {
  if(!settingsPath)return 'Unknown';
  try {
    const settings=JSON.parse(fs.readFileSync(settingsPath,'utf8'));
    const command=settings.statusLine?.command;
    return typeof command==='string' && command.includes('claude-statusline-bridge.mjs') && command.includes(legacy);
  } catch{return 'Unknown';}
}
export function inspectDataMigration(options) {
  layout(options);
  const {legacy,target,stage}=options,source=stat(legacy)?manifest(legacy):null;
  return {legacy:source?'present':'missing',target:!stat(target)?'missing':!fs.readdirSync(target).length?'empty':
    source && receiptMatches(target,hash(source))?'migrated':validReceipt(target)?'migrated-earlier-folder-changed':'holds-data',stage:stat(stage)?'present':'missing',
    files:source?counts(source).files:null,bytes:source?counts(source).bytes:null,
    statusLineTargetsEarlierFolder:statusLineTargetsEarlierFolder(options.settingsPath,legacy),
    refused:source?.refused??[],skipped:source?.skipped??[],linksOutsideBackups:source?.linksOutsideBackups??[]};
}
function validReceipt(folder) {
  try {
    const file=path.join(folder,marker);
    if(!stat(file)?.isFile())return false;
    const receipt=JSON.parse(fs.readFileSync(file,'utf8'));
    return receipt.schema===1 && /^[a-f0-9]{64}$/.test(receipt.manifestSha256);
  } catch{return false;}
}
function writableStage(folder) {
  fs.chmodSync(folder,0o700);
  for(const name of fs.readdirSync(folder)) {
    const file=path.join(folder,name);
    if(fs.lstatSync(file).isDirectory())writableStage(file);
  }
}
export function migrateDataFolder({legacy,target,stage,runningProcesses,now=()=>new Date(),hooks={},statfs=fs.statfsSync}) {
  const stopped=()=>assertObservatoryStopped(runningProcesses,
    'Quit every Observatory app and close Claude Code sessions that show the Observatory status line, then run again.');
  stopped();
  layout({legacy,target,stage});
  if(!stat(legacy))throw Error('The earlier data folder is missing.');
  const rootInfo=fs.lstatSync(legacy),source=manifest(legacy),summary=counts(source);
  if(source.refused.length)throw Error('Unsupported entries: '+source.refused.map(p=>JSON.stringify(safePath(p))).join(', ')+'.');
  if(stat(target) && fs.readdirSync(target).length) {
    if(receiptMatches(target,summary.manifestSha256))return {state:'already-migrated',...summary};
    throw Error('The new data folder already holds data');
  }
  const aside=()=>{
    if(stat(stage))fs.renameSync(stage,path.join(path.dirname(stage),'.'+appNames.visible.dataFolder+'-migration-stale-'+
      now().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')+'-'+randomBytes(2).toString('hex')));
  };
  const matches=()=>{
    const copied=manifest(stage,{ignoreMarker:true});
    return copyHash(copied)===copyHash(source) && !copied.refused.length && !copied.skipped.length;
  };
  let ready=false;
  if(stat(stage)) {
    try{ready=receiptMatches(stage,summary.manifestSha256) && matches();}catch{}
    if(!ready)aside();
  }
  if(!ready) {
    const space=statfs(path.dirname(stage));
    if(!(Number(space.bavail)*Number(space.bsize)>summary.bytes*1.1+64*1024*1024))
      throw Error('Not enough free space for the copy.');
    fs.mkdirSync(stage,{mode:0o700});
    writableStage(stage);
  }
  try {
    if(!ready) {
      // Copy contents, modes and times only. Extended attributes and ACLs are not copied.
      for(const entry of source.entries) {
        const dest=path.join(stage,entry.path),time=source.times.get(entry.path);
        if(entry.type==='directory') {fs.mkdirSync(dest,{mode:0o700});continue;}
        const temporary=dest+'.'+randomBytes(12).toString('hex')+'.observatory-partial';
        try {
          if(entry.type==='symlink') {
            fs.symlinkSync(entry.linkText,temporary);
            fs.lutimesSync(temporary,time.atime,time.mtime);
          } else {
            if(readSource(path.join(legacy,entry.path),entry,temporary)!==entry.sha256)
              throw Error('The copied file does not match.');
            fs.chmodSync(temporary,entry.mode);
            fs.utimesSync(temporary,time.atime,time.mtime);
          }
          fs.renameSync(temporary,dest);
        } catch(error) {
          if(stat(temporary))fs.unlinkSync(temporary);
          throw error;
        }
        hooks.afterFile?.(entry.path);
      }
      for(const entry of [...source.entries].reverse())if(entry.type==='directory') {
        const dest=path.join(stage,entry.path),time=source.times.get(entry.path);
        fs.chmodSync(dest,entry.mode);fs.utimesSync(dest,time.atime,time.mtime);
      }
    }
    stopped();
    let current;
    try{current=manifest(legacy);}catch{throw Error('The earlier data folder changed during the copy. Quit every Observatory app and run again.');}
    if(hash(current)!==hash(source) || JSON.stringify(current.skipped)!==JSON.stringify(source.skipped) || current.refused.length)
      throw Error('The earlier data folder changed during the copy. Quit every Observatory app and run again.');
    if(!matches())throw Error('The staging copy does not match the earlier data folder.');
  } catch(error) {aside();throw error;}
  if(!ready) {
    const temporary=path.join(stage,marker+'.'+randomBytes(12).toString('hex'));
    writeSynced(temporary,JSON.stringify({schema:1,from:appNames.legacy.dataFolder,to:appNames.visible.dataFolder,
      completedAt:now().toISOString(),...summary})+'\n');
    fs.renameSync(temporary,path.join(stage,marker));
    syncDirectory(stage);
  }
  hooks.afterReceipt?.();
  fs.chmodSync(stage,rootInfo.mode&0o7777);
  fs.utimesSync(stage,rootInfo.atimeMs/1000,rootInfo.mtimeMs/1000);
  stopped();
  fs.renameSync(stage,target);syncDirectory(path.dirname(target));
  return {state:'migrated',...summary};
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [command,...flags]=process.argv.slice(2);
    if(!['status','copy'].includes(command) ||
      (command==='copy'?flags.length!==1 || flags[0]!=='--confirm-app-quit':flags.length!==0))
      throw Error('Use status or copy with --confirm-app-quit.');
    const parent=path.join(homedir(),'Library/Application Support');
    const options={legacy:path.join(parent,appNames.legacy.dataFolder),target:path.join(parent,appNames.visible.dataFolder),
      stage:path.join(parent,'.'+appNames.visible.dataFolder+'-migration')};
    const result=command==='status'?inspectDataMigration({...options,settingsPath:path.join(homedir(),'.claude','settings.json')}):migrateDataFolder({...options,
        runningProcesses:runningProcessArgs});
    console.log(JSON.stringify(result,(key,value)=>
      ['refused','skipped','linksOutsideBackups'].includes(key) && Array.isArray(value)?value.map(safePath):value));
  } catch(error) {
    console.error(!error.code && typeof error.message==='string' && !error.message.includes(homedir())?error.message:
      'Data migration refused. Check the folders and quit every Observatory app before retrying.');
    process.exitCode=1;
  }
}
