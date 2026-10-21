import {retainActivityHistory} from './activity-history.mjs';
export const snapshotMaximumBytes=16_000_000;
export const snapshotHistoryBudget=12_000_000;

// Readers refuse usage.json above snapshotMaximumBytes. Retained activity
// history is the part that grows with time, so above the budget the oldest
// whole dates are dropped from every host together. Counts are never changed.
export function serializeSnapshot(data) {
  let text=JSON.stringify(data),bytes=Buffer.byteLength(text);
  const history=Array.isArray(data?.activityHistory)?data.activityHistory:null;
  if(!history || bytes<=snapshotHistoryBudget)return {text,bytes};
  const dates=[...new Set(history.flatMap(host=>(Array.isArray(host?.days)?host.days:[])
    .map(day=>day?.date).filter(date=>typeof date==='string')))].sort((a,b)=>a.localeCompare(b));
  if(!dates.length)return {text,bytes};
  const emptyStatus=retainActivityHistory([],[],data.collectedAt)[0].status;
  const candidate=count=>{
    const removed=new Set(dates.slice(0,count));
    const retained=history.map(host=>{
      if(!Array.isArray(host?.days))return host;
      const days=host.days.filter(day=>!removed.has(day?.date));
      return {...host,days,...(host.days.length && !days.length?{status:emptyStatus}:{})};
    });
    const text=JSON.stringify({...data,activityHistory:retained});
    return {text,bytes:Buffer.byteLength(text),retained};
  };
  // If removing all dates cannot reach the budget, retain history up to the hard limit.
  const smallest=candidate(dates.length);
  const target=smallest.bytes>snapshotHistoryBudget?snapshotMaximumBytes:snapshotHistoryBudget;
  if(bytes<=target)return {text,bytes};
  let low=1,high=dates.length;
  while(low<high) {
    const middle=Math.floor((low+high)/2);
    if(candidate(middle).bytes<=target)high=middle;
    else low=middle+1;
  }
  const result=candidate(low);
  for(let index=0;index<history.length;index++) {
    if(!Array.isArray(history[index]?.days))continue;
    history[index].days=result.retained[index].days;
    if(!history[index].days.length && result.retained[index].status===emptyStatus)history[index].status=emptyStatus;
  }
  text=result.text;bytes=result.bytes;
  return {text,bytes};
}

export async function writeSnapshot(data,{atomic,startedAt,beforeReplace}) {
  const {text,bytes}=serializeSnapshot(data);
  if(bytes>snapshotMaximumBytes) {
    await atomic('collector.json',{state:'failed',reason:'snapshot-too-large',startedAt,
      finishedAt:new Date().toISOString(),intervalSeconds:300,maxRunSeconds:240,bytes:Math.round(bytes)});
    throw Error('Snapshot size limit of 16000000 bytes exceeded');
  }
  await atomic('usage.json',text,beforeReplace,true);
  return bytes;
}
