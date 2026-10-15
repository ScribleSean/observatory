#!/usr/bin/env node
import {gunzipSync,gzipSync} from 'node:zlib';
import {lstat,readFile,rename,unlink,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

export const FORMAT='observatory-export';
export const VERSION=1;
const maxCompressed=64*1024*1024,maxPlain=256*1024*1024;
const platforms={Mac:'macOS',Windows:'Windows'};
const control=value=>[...value].some(character=>character.charCodeAt(0)<32 || character.charCodeAt(0)===127);
const isObject=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const validDate=value=>typeof value==='string' && /^\d{4}-\d\d-\d\d$/.test(value) && !Number.isNaN(Date.parse(value+'T12:00:00Z'));
const validTime=value=>typeof value==='string' && value.length<=40 && !Number.isNaN(Date.parse(value));

function plain(value,depth=0,budget={left:2_000_000}) {
  if(--budget.left<0)throw Error('Record is too large');
  if(value===null || typeof value==='boolean')return value;
  if(typeof value==='number') {if(!Number.isFinite(value))throw Error('Invalid number');return value;}
  if(typeof value==='string') {
    if(value.length>80 || control(value))throw Error('Invalid text in a record');
    return value;
  }
  if(depth>=8)throw Error('Record is nested too deeply');
  if(Array.isArray(value))return value.map(item=>plain(item,depth+1,budget));
  if(isObject(value)) {
    const result={};
    for(const [key,item] of Object.entries(value)) {
      if(key.length>80 || control(key) || key==='__proto__')throw Error('Invalid field name in a record');
      result[key]=plain(item,depth+1,budget);
    }
    return result;
  }
  throw Error('Unsupported value in a record');
}

function days(source) {
  const seen=new Set(),result=[];
  for(const day of Array.isArray(source?.days)?source.days:[]) {
    if(!isObject(day) || !validDate(day.date) || seen.has(day.date))continue;
    seen.add(day.date);result.push(plain(day));
  }
  return result.sort((a,b)=>a.date<b.date?-1:1);
}

const readable=source=>isObject(source) && source.status==='ok';
const rows=value=>Array.isArray(value)?value.filter(isObject):[];

function limits(source,provider) {
  if(!isObject(source) || !['ok','stale'].includes(source.status) || !validTime(source.checkedAt))return null;
  const windows=rows(source.windows).map(row=>plain({bucket:row.bucket,window:row.window,durationMinutes:row.durationMinutes,
    remainingPercent:row.remainingPercent,resetsAt:row.resetsAt}));
  const history=rows(source.history).filter(row=>validTime(row.checkedAt)).map(row=>plain({checkedAt:row.checkedAt,
    windows:rows(row.windows).map(item=>({bucket:item.bucket,window:item.window,remainingPercent:item.remainingPercent,resetsAt:item.resetsAt}))}));
  const dailyTokens=rows(source.dailyUsageBuckets).filter(row=>validDate(row.startDate)).map(row=>plain({date:row.startDate,tokens:row.tokens}));
  return {provider,observedAt:source.checkedAt,windows,history,dailyTokens};
}

export function buildExport(snapshot,{appVersion='Unknown',now=new Date(),device}={}) {
  if(!isObject(snapshot))throw Error('A snapshot is required');
  if(!Object.hasOwn(platforms,device))throw Error('The exporting device must be Mac or Windows');
  const names=isObject(snapshot.deviceNames)?snapshot.deviceNames:{};
  const records=[];
  const add=(kind,provider,host,source)=>{
    if(!Object.hasOwn(platforms,host) || !readable(source))return;
    const list=days(source);
    if(list.length)records.push({kind,provider,device:host,days:list});
  };
  const history=rows(snapshot.activityHistory);
  for(const host of Object.keys(platforms)) {
    add('activity','activitywatch',host,history.find(row=>row.host===host) ?? rows(snapshot.activity).find(row=>row.host===host));
    add('tokens','codex',host,rows(snapshot.tokens).find(row=>row.host===host));
    for(const source of rows(snapshot.providerTokenSources).filter(row=>row.host===host && row.provider==='claude-code'))add('tokens','claude-code',host,source);
    for(const source of rows(snapshot.dictation).filter(row=>row.host===host))
      add('dictation',typeof source.source==='string' && source.source.length<=40?source.source:'Unknown',host,source);
  }
  const used=new Set(records.map(record=>record.device));
  const combined=[];
  const combinedActivity=history.find(row=>row.host==='Combined');
  if(readable(combinedActivity) && days(combinedActivity).length)combined.push({kind:'activity',provider:'activitywatch',days:days(combinedActivity)});
  if(readable(snapshot.combinedTokens) && snapshot.combinedTokens.verification?.status==='verified' && days(snapshot.combinedTokens).length)
    combined.push({kind:'tokens',provider:'codex',days:days(snapshot.combinedTokens)});
  return {
    format:FORMAT,version:VERSION,exportedAt:now.toISOString(),appVersion:String(appVersion).slice(0,40),
    exportedBy:device,timezone:typeof snapshot.timezone==='string'?snapshot.timezone.slice(0,64):'Unknown',
    snapshotAt:validTime(snapshot.collectedAt)?snapshot.collectedAt:null,
    devices:Object.keys(platforms).filter(host=>used.has(host)).map(host=>({id:host,platform:platforms[host],
      name:typeof names[host]==='string' && names[host].trim()?names[host].trim().slice(0,32):null})),
    records,combined,
    limits:[limits(snapshot.quota,'codex'),limits(snapshot.claudeLimits,'claude-code')].filter(Boolean),
  };
}

export function encodeExport(document) {
  const bytes=gzipSync(Buffer.from(JSON.stringify(validateExport(document)),'utf8'),{level:9});
  if(bytes.length>maxCompressed)throw Error('Export is too large');
  return bytes;
}

export function decodeExport(bytes) {
  if(!Buffer.isBuffer(bytes) || bytes.length<20 || bytes.length>maxCompressed)throw Error('Not an Observatory file');
  let text;
  try {text=gunzipSync(bytes,{maxOutputLength:maxPlain}).toString('utf8');}
  catch {throw Error('Not an Observatory file, or the file is damaged');}
  let document;
  try {document=JSON.parse(text);}catch {throw Error('The Observatory file is damaged');}
  return validateExport(document);
}

export function validateExport(document) {
  if(!isObject(document) || document.format!==FORMAT)throw Error('Not an Observatory file');
  if(document.version!==VERSION)throw Error(`This Observatory file is version ${String(document.version).slice(0,8)}. This build reads version ${VERSION}.`);
  if(!validTime(document.exportedAt) || !Object.hasOwn(platforms,document.exportedBy))throw Error('The Observatory file has an invalid header');
  const devices=rows(document.devices).map(device=>{
    if(!Object.hasOwn(platforms,device.id) || device.platform!==platforms[device.id] ||
      !(device.name===null || (typeof device.name==='string' && device.name.length<=32 && !control(device.name))))throw Error('Invalid device in the Observatory file');
    return {id:device.id,platform:device.platform,name:device.name};
  });
  if(new Set(devices.map(device=>device.id)).size!==devices.length)throw Error('A device is listed twice');
  const known=new Set(devices.map(device=>device.id)),seen=new Set();
  const record=(raw,needsDevice)=>{
    if(!['activity','tokens','dictation'].includes(raw.kind) || typeof raw.provider!=='string' || raw.provider.length>40 || !Array.isArray(raw.days) ||
      (needsDevice && !known.has(raw.device)))throw Error('Invalid record in the Observatory file');
    const key=[raw.kind,raw.provider,needsDevice?raw.device:'combined'].join('|');
    if(seen.has(key))throw Error('A record set is listed twice');
    seen.add(key);
    const dates=new Set();
    const list=raw.days.map(day=>{
      if(!isObject(day) || !validDate(day.date) || dates.has(day.date))throw Error('Invalid day in the Observatory file');
      dates.add(day.date);return plain(day);
    });
    return {kind:raw.kind,provider:raw.provider,...(needsDevice?{device:raw.device}:{}),days:list};
  };
  return {
    format:FORMAT,version:VERSION,exportedAt:document.exportedAt,appVersion:typeof document.appVersion==='string'?document.appVersion.slice(0,40):'Unknown',
    exportedBy:document.exportedBy,timezone:typeof document.timezone==='string'?document.timezone.slice(0,64):'Unknown',
    snapshotAt:validTime(document.snapshotAt)?document.snapshotAt:null,
    devices,records:rows(document.records).map(raw=>record(raw,true)),combined:rows(document.combined).map(raw=>record(raw,false)),
    limits:rows(document.limits).map(raw=>{
      if(!['codex','claude-code'].includes(raw.provider) || !validTime(raw.observedAt))throw Error('Invalid limits in the Observatory file');
      return {provider:raw.provider,observedAt:raw.observedAt,windows:plain(rows(raw.windows)),history:plain(rows(raw.history)),dailyTokens:plain(rows(raw.dailyTokens))};
    }),
  };
}

export function describeExport(document) {
  const clean=validateExport(document);
  const range=list=>list.length?{from:list[0].date,to:list.at(-1).date,days:list.length}:{days:0};
  return {format:clean.format,version:clean.version,exportedAt:clean.exportedAt,exportedBy:clean.exportedBy,appVersion:clean.appVersion,
    devices:clean.devices.map(device=>device.name?`${device.name} (${device.platform})`:device.platform),
    records:clean.records.map(item=>({kind:item.kind,provider:item.provider,device:item.device,...range(item.days)})),
    combined:clean.combined.map(item=>({kind:item.kind,provider:item.provider,...range(item.days)})),
    limits:clean.limits.map(item=>({provider:item.provider,observedAt:item.observedAt,windows:item.windows.length,readings:item.history.length}))};
}

async function readSnapshot(runtime) {
  const file=path.join(runtime,'public/local/usage.json');
  const info=await lstat(file);
  if(!info.isFile() || info.isSymbolicLink() || info.size>64*1024*1024)throw Error('The saved snapshot is not a plain file');
  return JSON.parse(await readFile(file,'utf8'));
}

export async function exportToFile({runtime,out,device,appVersion,now=new Date()}) {
  if(!path.isAbsolute(runtime ?? '') || !path.isAbsolute(out ?? ''))throw Error('Absolute runtime and output paths are required');
  if(!out.endsWith('.observatory'))throw Error('The output file name must end with .observatory');
  const bytes=encodeExport(buildExport(await readSnapshot(runtime),{appVersion,now,device}));
  const temporary=path.join(path.dirname(out),`.${path.basename(out)}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary,bytes,{flag:'wx',mode:0o600});
    await lstat(out).then(()=>{throw Object.assign(Error('A file with that name already exists'),{code:'EEXIST'});},error=>{if(error.code!=='ENOENT')throw error;});
    await rename(temporary,out);
  } finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return {out,bytes:bytes.length,...describeExport(decodeExport(bytes))};
}

export async function inspectFile(file) {
  const info=await lstat(file);
  if(!info.isFile() || info.isSymbolicLink() || info.size>maxCompressed)throw Error('Not a plain Observatory file');
  return describeExport(decodeExport(await readFile(file)));
}

if(process.argv[1] && path.basename(process.argv[1])==='observatory-file.mjs') {
  const [action,...rest]=process.argv.slice(2);
  const option=name=>{const index=rest.indexOf(name);return index>=0?rest[index+1]:undefined;};
  const device=process.platform==='darwin'?'Mac':process.platform==='win32'?'Windows':undefined;
  const run=action==='export'?()=>exportToFile({runtime:option('--runtime') ?? process.env.OBSERVATORY_RUNTIME,out:option('--out'),device,appVersion:option('--app-version')})
    :action==='inspect'?()=>inspectFile(rest[0]):null;
  if(!run) {console.error('Usage: observatory-file.mjs export --runtime <folder> --out <file.observatory> | inspect <file.observatory>');process.exitCode=2;}
  else run().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
