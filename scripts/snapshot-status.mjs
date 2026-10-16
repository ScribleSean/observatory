import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const maximumBytes=16000000;
const isObject=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const allowed=(value,set)=>set.has(value)?value:'<value>';
const statuses=new Set('ok stale unavailable not-connected partial disabled unknown failed missing needs-auth rate-limited exhausted not-supported idle pending unverified verified sync-disabled peer-disabled'.split(' '));
const refusals=new Set(['private-folder-refused','ancestor-refused']);
const usageCommands=new Set(['read','not-found','failed','timed-out','unrecognized']);
const windows=new Set(['five_hour','seven_day','primary','secondary']);
const verifications=new Set('verified unverified overlap partial unreconciled inconsistent ambiguous pending missing'.split(' '));
const hosts=new Set(['Mac','Windows','Combined','Ubuntu']);
const fields=new Set(('activity activityHistory apiEstimate apps asOf audioRecords audioSeconds bucket cacheCreationTokens cacheReadTokens cacheWrites cached categories category checked checkedAt checkedOn claudeLimits collectedAt combined combinedTokens count coveredTokens date days demo deviceNames dictation durationMinutes effort estimatedExhaustionAt excluded history host hours inferred input inputTokens latestReadStatus model models namespace observedAt observedMinutes output outputTokens pace parts peerQuota percentagePointsPerHour prices profiles provider providerTokenSources quota reasoningOutputTokens receivedAt refusal remainingMinutes remainingPercent requestCount resetsAt scope seconds sessionCost settings snapshotStable source speed status timezone tokens tool tools totalTokens trackedSeconds trackingStatus trackingThrough transcriptions usd verification window windows wordRecords words '+
  'schema agents agentSource localModel combinedSettings tokenProfiles dailyUsageBuckets accountUsageCheckedAt usageCommand reader byModel projects inventory intervals trackingIntervals state sourcesRead sourcesConfigured peer payload codex usedPercentage five_hour seven_day').split(' '));

export function snapshotStatus(snapshot) {
  if(!isObject(snapshot))throw Error('Snapshot unavailable');
  const rows={},limits={},paths=new Set();
  let count=0;
  for(const name of ['activity','tokens','settings','dictation','providerTokenSources']) {
    if(!Array.isArray(snapshot[name]))continue;
    rows[name]=snapshot[name].map(value=>{
      const row=isObject(value)?value:{};
      return {host:allowed(row.host,hosts),status:allowed(row.status,statuses),
        ...(Object.hasOwn(row,'refusal')?{refusal:allowed(row.refusal,refusals)}:{}),
        days:Array.isArray(row.days)?row.days.length:null};
    });
    count+=rows[name].length;
  }
  for(const name of ['quota','peerQuota','claudeLimits']) {
    const source=snapshot[name];
    if(!isObject(source))continue;
    limits[name]={status:allowed(source.status,statuses),
      windows:Array.isArray(source.windows)?source.windows.map(entry=>allowed(entry?.window,windows)):[],
      ...(Object.hasOwn(source,'usageCommand')?{usageCommand:allowed(source.usageCommand,usageCommands)}:{}),
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
        // Only known field names are printed. Data keys are hidden.
        const clean=fields.has(key)?key:'<key>';
        const next=prefix?`${prefix}.${clean}`:clean;
        paths.add(next);
        visit(entry,next,depth+1);
      }
    }
  }
  visit(snapshot,'',0);
  const keys=[...paths].sort((a,b)=>a<b?-1:a>b?1:0),checkedOn=snapshot.prices?.checkedOn;
  return {rows,limits,
    ...(Object.hasOwn(snapshot,'combinedTokens')?{combinedTokens:{status:allowed(snapshot.combinedTokens?.status,statuses),
      verification:allowed(isObject(snapshot.combinedTokens?.verification)?snapshot.combinedTokens.verification.status:snapshot.combinedTokens?.verification,verifications)}}:{}),
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
