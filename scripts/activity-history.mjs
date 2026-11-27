import {categories,appLabels,timezone} from './activity-timeline.mjs';
import {appLabelOk} from '../lib/my-apps.mjs';
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
  // freshness-exempt: watcher coverage before collection, which the message below names as 10 minutes.
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
  const myApps=row.myApps && typeof row.myApps==='object' && !Array.isArray(row.myApps)
    ?Object.fromEntries(Object.entries(row.myApps).filter(([label,n])=>appLabelOk(label)&&valid(n)).map(([label,n])=>[label,Math.round(n*1000)/1000])):null;
  return {date:row.date,seconds:Math.round(row.seconds*1000)/1000,hours:row.hours.map(n=>Math.round(n*1000)/1000),
    categories:values(row.categories,allowedCategories),apps,
    ...(myApps?{myApps}:{}),...Object.fromEntries(['browserUnmatched','browserHidden'].filter(key=>myApps && valid(row[key])).map(key=>[key,Math.round(row[key]*1000)/1000])),
    ...(valid(row.trackedSeconds)?{trackedSeconds:Math.round(row.trackedSeconds*1000)/1000}:{}),
    ...(Array.isArray(row.trackedHours)&&row.trackedHours.length===24&&row.trackedHours.every(valid)?{trackedHours:row.trackedHours.map(n=>Math.round(n*1000)/1000)}:{}),
    windowStart:stamp(row.windowStart),windowEnd:stamp(row.windowEnd)};
}

// Daily history is kept with no age limit. A bound is only for tests and size checks.
export function retainActivityHistory(previous,current,collectedAt,maxDates=Infinity) {
  if(maxDates!==Infinity && (!Number.isInteger(maxDates)||maxDates<1)) throw Error('Invalid history bound');
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
        if(!prior || (lo(row)<=lo(prior)&&hi(row)>=hi(prior))) days.set(row.date,row);
      }
    }
    const retained=[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-maxDates);
    return {host,status:retained.length?'ok':'unavailable',latestReadStatus:source?.status||'unavailable',
      asOf:source?.status==='ok'?stamp(collectedAt):stamp(before?.asOf),
      ...activityTrackingHealth(source,collectedAt),days:retained};
  });
}


// ---------------------------------------------------------------------------------------------------
// My apps over the whole history. Each read labels the days it covers with the rules of the moment. The history
// row remembers which rules (myAppsKey) labeled the days from myAppsFrom on, and each run labels one more chunk of
// older days from ActivityWatch until its first recorded day (myAppsFirst), so the whole history is labeled the
// same way. When the rules change, the older labels are dropped and labeling starts again from the current read.

export const BACKFILL_DAYS=6;
const shift=(date,days)=>new Date(Date.parse(`${date}T12:00:00Z`)+days*86400000).toISOString().slice(0,10);
const zoneParts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const wall=ms=>{const p=Object.fromEntries(zoneParts.formatToParts(ms).map(x=>[x.type,x.value]));return Date.UTC(+p.year,p.month-1,+p.day,+p.hour,+p.minute,+p.second);};
/** The instant a day starts in the collector's time zone. */
export function dayStart(date) {
  const utc=Date.parse(`${date}T00:00:00Z`);
  let guess=utc-(wall(utc)-utc);
  guess=utc-(wall(guess)-guess);
  return guess;
}
const strip=day=>{const {myApps:_m,browserUnmatched:_b,browserHidden:_h,...rest}=day;return rest;};

/**
 * Settles the my-apps labels of this computer's history row after a read, and names the older chunk to label next.
 * @param {object} row          the history row retainActivityHistory just made
 * @param {object | undefined} previous  the same row from the previous snapshot
 * @param {{key: string | null, rules: number, windowStart: string | null}} options
 * @returns {{row: object, chunk: {start: Date, end: Date} | null}}
 */
export function settleMyApps(row,previous,{key,rules,windowStart}) {
  const {myAppsKey:_k,myAppsFrom:_f,myAppsFirst:_r,myAppsRules:_n,...plain}=row;
  if(!key)return {row:{...plain,days:plain.days.map(strip)},chunk:null};
  // Nothing was read this time: the labels and how far back they go stay as they were.
  if(!stamp(windowStart)) {
    const kept=Object.fromEntries(['myAppsKey','myAppsRules','myAppsFrom','myAppsFirst'].filter(name=>previous?.[name]!==undefined).map(name=>[name,previous[name]]));
    return {row:{...plain,...kept},chunk:null};
  }
  const same=previous?.myAppsKey===key && /^\d{4}-\d{2}-\d{2}$/.test(previous?.myAppsFrom);
  // The read's first day is partial, so labels under these rules are whole from the day after.
  const from=same?previous.myAppsFrom:shift(dateKey(windowStart),1);
  const first=same && /^\d{4}-\d{2}-\d{2}$/.test(previous?.myAppsFirst)?previous.myAppsFirst:null;
  const days=plain.days.map(day=>day.date<from?strip(day):day);
  const settled={...plain,days,myAppsKey:key,myAppsRules:rules,myAppsFrom:from,...(first?{myAppsFirst:first}:{})};
  const done=first!==null && from<=first;
  return {row:settled,chunk:done?null:{start:new Date(dayStart(shift(from,-BACKFILL_DAYS))),end:new Date(dayStart(from))}};
}

/** Adds an older chunk's labels (from cleanActivity) to the history row's days and moves myAppsFrom back. */
export function addMyAppsChunk(row,chunk,read) {
  const startDate=dateKey(chunk.start);
  const labeled=new Map((read?.days ?? []).filter(day=>day.date>=startDate && day.date<row.myAppsFrom).map(day=>[day.date,day]));
  const days=row.days.map(day=>{
    const found=labeled.get(day.date);
    if(!found?.myApps)return day;
    const clean=safeDay({...day,myApps:found.myApps,browserUnmatched:found.browserUnmatched,browserHidden:found.browserHidden});
    if(!clean)return day;
    const {browserUnmatched:_b,browserHidden:_h,...rest}=day;
    return {...rest,myApps:clean.myApps,...Object.fromEntries(['browserUnmatched','browserHidden'].filter(key=>clean[key]!==undefined).map(key=>[key,clean[key]]))};
  });
  const first=Number.isFinite(read?.firstRecorded)?dateKey(read.firstRecorded):null;
  return {...row,days,myAppsFrom:startDate,...(first?{myAppsFirst:first}:{})};
}
