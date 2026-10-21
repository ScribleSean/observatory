// Combine step. The hub pulls each spoke's own snapshot, combines, and writes
// combined.json locally and back to every spoke it reached. A spoke recombines
// from its own fresh snapshot plus the devices in the last combined.json.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {localFolder} from '../lib/config.mjs';
import {combine,carriedDevice,ownRows,HOSTS,CLOCK_SKEW_MS} from '../lib/combine.mjs';
import {writeAtomic} from '../lib/atomic-file.mjs';
import {privateFolder} from '../lib/private-folder.mjs';
import {sshTransport,MAX_FILE_BYTES} from './hub-transport.mjs';

const HOST={mac:'Mac',windows:'Windows'};

async function readJson(file) {
  try {
    const text=await readFile(file,'utf8');
    if(Buffer.byteLength(text)>MAX_FILE_BYTES)return null;
    return JSON.parse(text);
  } catch {return null;}
}

function parseSnapshot(text,host,now) {
  let value;
  try {value=JSON.parse(text);}catch {throw Error('invalid snapshot');}
  if(!value || typeof value!=='object' || Array.isArray(value) || value.schema!==2 || !Number.isFinite(Date.parse(value.collectedAt)))
    throw Error('invalid snapshot');
  // A clock far ahead would make this copy look newest forever.
  if(Date.parse(value.collectedAt)>now+CLOCK_SKEW_MS)throw Error('snapshot is dated in the future');
  // A spoke's snapshot must be about itself. Older snapshots have no device field.
  const claimed=value.device?.host;
  const own=key=>Array.isArray(value[key]) && value[key].some(row=>row?.host===host && row.status!=='not-connected');
  if(claimed!==undefined ? claimed!==host : !['activity','tokens','settings'].some(own))
    throw Error('snapshot is for another computer');
  // Run the allowlists here, inside the pull's own error handling, so a
  // malformed spoke file fails only that spoke.
  if(!ownRows(value,host))throw Error('invalid snapshot');
  return value;
}

export async function runHub(config,{transport=sshTransport(),now=()=>Date.now()}={}) {
  const folder=await privateFolder(config.dataFolder,'public','local');
  const previous=await readJson(path.join(folder,'combined.json'));
  const own=await readJson(path.join(folder,'usage.json'));
  const devices=[{host:config.host,name:config.device.name,snapshot:own,...(own?{}:{error:'no local snapshot'})}];
  const report=[];
  for(const spoke of config.hub.spokes) {
    const host=HOST[spoke.platform];
    try {
      const snapshot=parseSnapshot(await transport.pull(spoke),host,now());
      devices.push({host,name:spoke.name,snapshot});
      report.push({name:spoke.name,host,pull:'ok'});
    } catch(error) {
      // Keep the last known copy so its age shows, instead of dropping the computer.
      const carried=carriedDevice(previous,host);
      devices.push({...(carried??{host,name:spoke.name,snapshot:null}),name:spoke.name,error:error.message});
      report.push({name:spoke.name,host,pull:error.message});
    }
  }
  const combined=combine(devices,{now:now(),generatedBy:config.host});
  combined.hub={role:'hub',spokes:report};
  // Write locally first, so the hub's own view never waits on a slow spoke.
  const text=JSON.stringify(combined);
  await writeAtomic(path.join(folder,'combined.json'),text);
  for(const entry of report) {
    if(entry.pull!=='ok') {entry.push='skipped';continue;}
    try {await transport.push(config.hub.spokes.find(s=>s.name===entry.name),text);entry.push='ok';}
    catch(error) {entry.push=error.message;}
  }
  // Then save how each write-back went, so the menu can say when one failed.
  await writeAtomic(path.join(folder,'combined.json'),JSON.stringify(combined));
  return combined;
}

// The newer of the spoke's own combined.json and the hub's inbox copy.
const newer=(a,b)=>!b?a:!a?b:(Date.parse(b.generatedAt)>Date.parse(a.generatedAt)?b:a);

export async function recombine(config,{now=()=>Date.now()}={}) {
  const folder=await privateFolder(config.dataFolder,'public','local');
  const mine=await readJson(path.join(folder,'combined.json'));
  const inbox=await readJson(path.join(folder,'combined.incoming.json'));
  // Only a copy the hub wrote counts as inbox data.
  const previous=newer(mine,inbox?.hub?.role==='hub' && Date.parse(inbox.generatedAt)<=now()+CLOCK_SKEW_MS?inbox:null);
  const own=await readJson(path.join(folder,'usage.json'));
  const devices=[{host:config.host,name:config.device.name,snapshot:own,...(own?{}:{error:'no local snapshot'})}];
  for(const host of HOSTS.filter(host=>host!==config.host)) {
    const carried=carriedDevice(previous,host);
    if(carried)devices.push(carried);
  }
  const combined=combine(devices,{now:now(),generatedBy:config.host});
  combined.hub={role:'spoke',hubWroteAt:previous?.hub?.role==='hub'?previous.generatedAt:previous?.hub?.hubWroteAt ?? null};
  await writeAtomic(path.join(folder,'combined.json'),JSON.stringify(combined));
  return combined;
}

export {localFolder};
