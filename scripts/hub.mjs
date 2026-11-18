import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {localFolder} from '../lib/config.mjs';
import {combine,carriedDevice,ownRows,HOSTS,CLOCK_SKEW_MS} from '../lib/combine.mjs';
import {writeAtomic} from '../lib/atomic-file.mjs';
import {privateFolder,titleSalt} from '../lib/private-folder.mjs';
import {sshTransport,MAX_FILE_BYTES} from './hub-transport.mjs';
import {serializeSnapshot} from './snapshot-size.mjs';

const HOST={mac:'Mac',windows:'Windows',linux:'Linux'};
// combined.json stores each computer's rows twice (snapshots and view), so each computer's snapshot
// is capped at the file limit over twice the number of computers. A larger snapshot loses its oldest
// activity history first, as the collector does. The margin covers the summary fields around them.
export const peerBytes=computers=>Math.floor(MAX_FILE_BYTES/(2*Math.max(2,computers)))-64_000;
export const MAX_PEER_BYTES=peerBytes(2);

async function readJson(file) {
  try {
    const text=await readFile(file,'utf8');
    if(Buffer.byteLength(text)>MAX_FILE_BYTES)return null;
    return JSON.parse(text);
  } catch {return null;}
}

async function readOwn(folder,cap) {
  const own=await readJson(path.join(folder,'usage.json'));
  if(!own)return {snapshot:null,error:'no local snapshot'};
  const sized=serializeSnapshot(own,{budget:cap,maximum:cap});
  if(sized.bytes>cap)return {snapshot:null,error:'local snapshot is too large'};
  return {snapshot:JSON.parse(sized.text)};
}

function parseSnapshot(text,host,now,cap) {
  let value;
  try {value=JSON.parse(text);}catch {throw Error('invalid snapshot');}
  if(!value || typeof value!=='object' || Array.isArray(value) || value.schema!==2 || !Number.isFinite(Date.parse(value.collectedAt)))
    throw Error('invalid snapshot');
  if(Date.parse(value.collectedAt)>now+CLOCK_SKEW_MS)throw Error('snapshot is dated in the future');
  const claimed=value.device?.host;
  const own=key=>Array.isArray(value[key]) && value[key].some(row=>row?.host===host && row.status!=='not-connected');
  if(claimed!==undefined ? claimed!==host : !['activity','tokens','settings'].some(own))
    throw Error('snapshot is for another computer');
  const cleaned=ownRows(value,host);
  if(!cleaned)throw Error('invalid snapshot');
  const snapshot={...cleaned,schema:2,device:{host,name:cleaned.name}};
  const sized=serializeSnapshot(snapshot,{budget:cap,maximum:cap});
  if(sized.bytes>cap)throw Error('snapshot is too large');
  return JSON.parse(sized.text);
}

function validatedDevice(combined,host,now,cap) {
  const carried=carriedDevice(combined,host);
  if(!carried)return null;
  try {
    return {...carried,snapshot:parseSnapshot(JSON.stringify({...carried.snapshot,schema:2}),host,now,cap)};
  } catch {return null;}
}

export async function runHub(config,{transport=sshTransport(),now=()=>Date.now()}={}) {
  const folder=await privateFolder(config.dataFolder,'public','local');
  const previous=await readJson(path.join(folder,'combined.json'));
  const cap=peerBytes(1+config.hub.spokes.length);
  const devices=[{host:config.host,name:config.device.name,...await readOwn(folder,cap)}];
  const report=[];
  for(const spoke of config.hub.spokes) {
    const host=HOST[spoke.platform];
    // A computer the settings turn off is not reached at all. Its last copy keeps its history, and it reads Off.
    if(spoke.off) {
      const carried=validatedDevice(previous,host,now(),cap);
      devices.push({...(carried??{host,name:spoke.name,snapshot:null}),name:spoke.name,off:true});
      report.push({name:spoke.name,host,pull:'off'});
      continue;
    }
    try {
      const snapshot=parseSnapshot(await transport.pull(spoke),host,now(),cap);
      devices.push({host,name:spoke.name,snapshot});
      report.push({name:spoke.name,host,pull:'ok'});
    } catch(error) {
      const carried=validatedDevice(previous,host,now(),cap);
      // The hub's own settings decide Off: a copy that was Off before reads late now that the computer is on again.
      devices.push({...(carried??{host,name:spoke.name,snapshot:null}),name:spoke.name,off:false,error:error.message});
      report.push({name:spoke.name,host,pull:error.message});
    }
  }
  const combined=combine(devices,{now:now(),generatedBy:config.host,engines:config.engines,...await titleSettings(config)});
  combined.hub={role:'hub',spokes:report};
  const text=JSON.stringify(combined);
  await writeAtomic(path.join(folder,'combined.json'),text);
  for(const entry of report) {
    if(entry.pull!=='ok') {entry.push='skipped';continue;}
    try {await transport.push(config.hub.spokes.find(s=>s.name===entry.name),text);entry.push='ok';}
    catch(error) {entry.push=error.message;}
  }
  await writeAtomic(path.join(folder,'combined.json'),JSON.stringify(combined));
  return combined;
}

// This computer's own titles setting, applied to every computer's sessions it combines.
async function titleSettings(config) {
  const titles=config.sessions?.titles!==false;
  return {titles,salt:titles?null:await titleSalt(config.dataFolder)};
}

const newer=(a,b)=>!b?a:!a?b:(Date.parse(b.snapshot.collectedAt)>Date.parse(a.snapshot.collectedAt)?b:a);

export async function recombine(config,{now=()=>Date.now()}={}) {
  const folder=await privateFolder(config.dataFolder,'public','local');
  const mine=await readJson(path.join(folder,'combined.json'));
  const inbox=await readJson(path.join(folder,'combined.incoming.json'));
  const incoming=inbox?.hub?.role==='hub' && Date.parse(inbox.generatedAt)<=now()+CLOCK_SKEW_MS?inbox:null;
  const others=HOSTS.filter(host=>host!==config.host && (carriedDevice(mine,host) || carriedDevice(incoming,host)));
  const cap=peerBytes(1+others.length);
  const devices=[{host:config.host,name:config.device.name,...await readOwn(folder,cap)}];
  const hubTime=copy=>copy?.hub?.role==='hub'?copy.generatedAt:copy?.hub?.hubWroteAt;
  // Whether a computer is Off is the hub's setting, so it comes from the copy the hub wrote last, whatever the age
  // of the snapshots. An Off computer's snapshot never changes, so its age cannot decide this.
  const fromHub=incoming && !(Date.parse(hubTime(mine))>=Date.parse(incoming.generatedAt))?incoming:mine;
  for(const host of others) {
    const carried=newer(validatedDevice(mine,host,now(),cap),validatedDevice(incoming,host,now(),cap));
    if(carried)devices.push({...carried,off:carriedDevice(fromHub,host)?.off===true});
  }
  const combined=combine(devices,{now:now(),generatedBy:config.host,engines:config.engines,...await titleSettings(config)});
  const hubWroteAt=[hubTime(mine),hubTime(incoming)].filter(at=>Number.isFinite(Date.parse(at)))
    .sort((a,b)=>Date.parse(b)-Date.parse(a))[0] ?? null;
  combined.hub={role:'spoke',hubWroteAt};
  await writeAtomic(path.join(folder,'combined.json'),JSON.stringify(combined));
  return combined;
}

export {localFolder};
