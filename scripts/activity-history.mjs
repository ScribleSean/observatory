import {categories,appLabels,timezone} from './activity-timeline.mjs';
import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
const dateKey=value=>dateFormat.format(new Date(value));
const allowedCategories=[...categories,'Mixed activity'];
const allowedApps=[...appLabels,'Overlapping categories','Multiple apps'];
const valid=n=>typeof n==='number' && Number.isFinite(n) && n>=0 && n<=90000;
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const values=(obj,keys)=>Object.fromEntries(keys.filter(k=>valid(obj?.[k])).map(k=>[k,Math.round(obj[k]*1000)/1000]));
export function activityTrackingHealth(source, collectedAt) {
  const through = stamp(source?.trackingThrough), at = stamp(collectedAt);
  if (source?.status !== 'ok' || !through || !at || Date.parse(through) > Date.parse(at)) {
    return {trackingStatus:'unknown',trackingThrough:through,
      trackingMessage:'Tracking freshness is unknown. A successful historical read does not prove that watchers are running.'};
  }
  const recent = Date.parse(at) - Date.parse(through) <= 10 * 60_000;
  return {trackingStatus:recent?'recent':'stale',trackingThrough:through,
    trackingMessage:recent
      ? (source.host === 'Combined' ? 'At least one device had tracking coverage within 10 minutes of collection. This does not verify every device.' : 'Tracking coverage observed within 10 minutes of collection. This includes idle time, not just active use.')
      : 'No recent tracking coverage at collection. The device may be asleep, offline, or its watchers stopped. Saved history is retained.'};
}
function safeDay(row) {
  if(!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !valid(row.seconds) || !Array.isArray(row.hours) || row.hours.length!==24 || !row.hours.every(valid)) return null;
  const apps={};
  for(const category of allowedCategories) if(row.apps?.[category]) apps[category]=values(row.apps[category],allowedApps);
  return {date:row.date,seconds:Math.round(row.seconds*1000)/1000,hours:row.hours.map(n=>Math.round(n*1000)/1000),
    categories:values(row.categories,allowedCategories),apps,
    ...(valid(row.trackedSeconds)?{trackedSeconds:Math.round(row.trackedSeconds*1000)/1000}:{}),
    ...(Array.isArray(row.trackedHours)&&row.trackedHours.length===24&&row.trackedHours.every(valid)?{trackedHours:row.trackedHours.map(n=>Math.round(n*1000)/1000)}:{}),
    windowStart:stamp(row.windowStart),windowEnd:stamp(row.windowEnd)};
}

export function retainActivityHistory(previous,current,collectedAt,maxDates=3650) {
  if(!Number.isInteger(maxDates)||maxDates<1||maxDates>3650) throw Error('Invalid history bound');
  return ['Combined','Mac','Windows'].map(host=>{
    const before=previous?.find(r=>r.host===host), source=current.find(r=>r.host===host);
    const days=new Map((before?.days||[]).map(safeDay).filter(Boolean).map(row=>[row.date,row]));
    if(source?.status==='ok' && stamp(source.start) && stamp(source.end)) {
      const first=dateKey(source.start),last=dateKey(source.end);
      for(const input of source.days||[]) {
        const row=safeDay({...input,windowStart:input.date===first?source.start:null,windowEnd:input.date===last?source.end:null});
        if(!row) continue;
        const prior=days.get(row.date);
        const lo=r=>r.windowStart?Date.parse(r.windowStart):-Infinity;
        const hi=r=>r.windowEnd?Date.parse(r.windowEnd):Infinity;
        // Replacement, never addition. A shrinking boundary day cannot erase history.
        if(!prior || (lo(row)<=lo(prior)&&hi(row)>=hi(prior))) days.set(row.date,row);
      }
    }
    const retained=[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-maxDates);
    return {host,status:retained.length?'ok':'unavailable',latestReadStatus:source?.status||'unavailable',
      asOf:source?.status==='ok'?stamp(collectedAt):stamp(before?.asOf),
      ...activityTrackingHealth(source,collectedAt),maxDates,days:retained};
  });
}

export async function previousActivityHistory(file) {
  let handle;
  try {
    // O_NOFOLLOW is unavailable on Windows. Check the named entry explicitly
    // on every platform, then ensure the opened file matches that entry.
    const entry=await lstat(file);
    if(!entry.isFile() || entry.isSymbolicLink())throw Error('Invalid previous snapshot');
    handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const info=await handle.stat();
    if(!info.isFile() || info.size>16_000_000 || info.dev!==entry.dev || info.ino!==entry.ino) throw Error('Invalid previous snapshot');
    const buffer=Buffer.alloc(info.size+1);
    const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
    const after=await handle.stat();
    const named=await lstat(file);
    if(bytesRead!==info.size || after.size!==info.size || after.mtimeMs!==info.mtimeMs ||
      named.isSymbolicLink() || named.dev!==info.dev || named.ino!==info.ino) throw Error('Changing previous snapshot');
    const value=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));
    if(Array.isArray(value.activityHistory)) return value.activityHistory;
    return retainActivityHistory([], [value.combined,...(value.activity||[])].filter(Boolean),value.collectedAt);
  } catch(error) {
    if(error.code==='ENOENT') return [];
    throw error;
  } finally {await handle?.close();}
}
