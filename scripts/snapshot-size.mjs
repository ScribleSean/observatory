import {retainActivityHistory} from './activity-history.mjs';
export const snapshotMaximumBytes=16_000_000;
export const snapshotHistoryBudget=12_000_000;

// The ledger lists at most LEDGER_TOP sessions per period (lib/ledger-shape.mjs), so it is small. Its
// largest part is each session's fan-out timeline: past this many bytes those timelines go first,
// then the ledger reads as unavailable, so it never pushes out the activity history.
export const ledgerBudget=2_000_000;
export function fitLedger(data,{budget=ledgerBudget}={}) {
  if(!Array.isArray(data?.ledger))return;
  const size=()=>Buffer.byteLength(JSON.stringify(data.ledger));
  if(size()<=budget)return;
  for(const row of data.ledger)for(const tool of row?.tools ?? [])for(const period of tool?.periods ?? [])
    for(const session of period?.sessions ?? [])session.fanout=[];
  if(size()<=budget)return;
  data.ledger=data.ledger.map(row=>row?.status==='ok'?{host:row.host,status:'unavailable',collectedAt:row.collectedAt}:row);
}

export function serializeSnapshot(data,{budget=snapshotHistoryBudget,maximum=snapshotMaximumBytes,ledger=ledgerBudget}={}) {
  fitLedger(data,{budget:ledger});
  let text=JSON.stringify(data),bytes=Buffer.byteLength(text);
  const history=Array.isArray(data?.activityHistory)?data.activityHistory:null;
  if(!history || bytes<=budget)return {text,bytes};
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
  const smallest=candidate(dates.length);
  const target=smallest.bytes>budget?maximum:budget;
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

