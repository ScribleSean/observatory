import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const maximumBytes=16000000;
const isObject=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const word=(value,pattern=/^[a-z][a-z-]{0,40}$/)=>typeof value==='string' && pattern.test(value)?value:'other';
const hosts=new Set(['Mac','Windows','Combined','Ubuntu']);

export function snapshotStatus(snapshot) {
  if(!isObject(snapshot))throw Error('Snapshot unavailable');
  const rows={},limits={},paths=new Set();
  let count=0;
  for(const name of ['activity','tokens','settings','dictation','providerTokenSources']) {
    if(!Array.isArray(snapshot[name]))continue;
    rows[name]=snapshot[name].map(value=>{
      const row=isObject(value)?value:{};
      return {host:hosts.has(row.host)?row.host:'other',status:word(row.status),
        ...(Object.hasOwn(row,'refusal')?{refusal:word(row.refusal)}:{}),
        days:Array.isArray(row.days)?row.days.length:null};
    });
    count+=rows[name].length;
  }
  for(const name of ['quota','peerQuota','claudeLimits']) {
    const source=snapshot[name];
    if(!isObject(source))continue;
    limits[name]={status:word(source.status),
      windows:Array.isArray(source.windows)?source.windows.map(entry=>word(entry?.window,/^[a-z][a-z0-9_-]{0,40}$/)):[],
      ...(Object.hasOwn(source,'usageCommand')?{usageCommand:word(source.usageCommand)}:{}),
      sessionCost:Object.hasOwn(source,'sessionCost')?'present':'absent'};
  }
  function visit(value,prefix,depth) {
    if(depth>=12 || value===null || typeof value!=='object')return;
    if(Array.isArray(value)) {
      const next=`${prefix}[]`;
      paths.add(next);
      for(const entry of value)visit(entry,next,depth+1);
    } else {
      for(const [key,entry] of Object.entries(value)) {
        // Field names start lower case. A capitalized key is data, such as an app,
        // a category or a device name, and is never printed.
        const clean=/^[a-z_][A-Za-z0-9_]{0,63}$/.test(key)?key:'<key>';
        const next=prefix?`${prefix}.${clean}`:clean;
        paths.add(next);
        visit(entry,next,depth+1);
      }
    }
  }
  visit(snapshot,'',0);
  const keys=[...paths].sort((a,b)=>a<b?-1:a>b?1:0),checkedOn=snapshot.prices?.checkedOn;
  return {rows,limits,
    ...(Object.hasOwn(snapshot,'combinedTokens')?{combinedTokens:{status:word(snapshot.combinedTokens?.status),
      verification:word(isObject(snapshot.combinedTokens?.verification)?snapshot.combinedTokens.verification.status:snapshot.combinedTokens?.verification)}}:{}),
    pricesCheckedOn:typeof checkedOn==='string' && /^\d{4}-\d{2}-\d{2}$/.test(checkedOn)?checkedOn:null,
    keys,counts:{rows:count,keys:keys.length}};
}

export async function readSnapshotStatus({runtime,file}={}) {
  let handle;
  try {
    for(const value of [runtime,file])if(value!==undefined && (typeof value!=='string' || !path.isAbsolute(value)))throw Error();
    const target=file ?? (runtime===undefined?null:path.join(runtime,'public','local','usage.json'));
    if(!target)throw Error();
    const before=await lstat(target);
    if(!before.isFile() || before.isSymbolicLink() || before.size>maximumBytes)throw Error();
    handle=await open(target,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const info=await handle.stat();
    if(!info.isFile() || info.size>maximumBytes || info.dev!==before.dev || info.ino!==before.ino)throw Error();
    const buffer=Buffer.alloc(maximumBytes+1);
    let size=0;
    while(size<buffer.length) {
      const {bytesRead}=await handle.read(buffer,size,buffer.length-size,null);
      if(!bytesRead)break;
      size+=bytesRead;
    }
    if(size>maximumBytes)throw Error();
    return snapshotStatus(JSON.parse(buffer.toString('utf8',0,size)));
  } catch {
    throw Error('Snapshot unavailable');
  } finally {
    await handle?.close().catch(()=>{});
  }
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);
  if(args.length!==2 || !['--runtime','--file'].includes(args[0]) || !path.isAbsolute(args[1])) {
    console.error('Usage: node scripts/snapshot-status.mjs --runtime <absolute folder> | --file <absolute file>');
    process.exitCode=2;
  } else {
    try {console.log(JSON.stringify(await readSnapshotStatus({[args[0].slice(2)]:args[1]})));}
    catch {console.error('Snapshot unavailable');process.exitCode=1;}
  }
}
