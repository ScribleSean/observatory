export const snapshotMaximumBytes=16_000_000;
export const snapshotHistoryBudget=12_000_000;

// Readers refuse usage.json above snapshotMaximumBytes. Retained activity
// history is the part that grows with time, so above the budget the oldest
// whole dates are dropped from every host together. Counts are never changed.
export function serializeSnapshot(data) {
  let text=JSON.stringify(data),bytes=Buffer.byteLength(text);
  const history=Array.isArray(data?.activityHistory)?data.activityHistory:null;
  if(!history || bytes<=snapshotHistoryBudget)return {text,bytes};
  const sizes=new Map();
  for(const host of history)for(const day of Array.isArray(host?.days)?host.days:[])
    if(typeof day?.date==='string')sizes.set(day.date,(sizes.get(day.date)||0)+Buffer.byteLength(JSON.stringify(day))+1);
  const removed=new Set();
  let estimate=bytes;
  for(const date of [...sizes.keys()].sort()) {
    if(estimate<=snapshotHistoryBudget)break;
    removed.add(date);estimate-=sizes.get(date);
  }
  for(const host of history)if(Array.isArray(host?.days))host.days=host.days.filter(day=>!removed.has(day?.date));
  text=JSON.stringify(data);bytes=Buffer.byteLength(text);
  return {text,bytes};
}

export async function writeSnapshot(data,{atomic,startedAt,beforeReplace}) {
  const {text,bytes}=serializeSnapshot(data);
  if(bytes>snapshotMaximumBytes) {
    await atomic('collector.json',{state:'failed',reason:'snapshot-too-large',startedAt,
      finishedAt:new Date().toISOString(),bytes:Math.round(bytes)});
    throw Error('Snapshot size limit of 16000000 bytes exceeded');
  }
  await atomic('usage.json',text,beforeReplace,true);
  return bytes;
}
