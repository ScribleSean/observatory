import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {privateFolder} from '../lib/private-folder.mjs';

export const PROVIDERS=['claude','codex'];
export const OBSERVERS=['Mac','Windows'];
const SCHEMA=`CREATE TABLE IF NOT EXISTS limit_readings (
  provider TEXT NOT NULL CHECK (provider IN ('claude','codex')),
  window TEXT NOT NULL CHECK (length(window) BETWEEN 1 AND 40),
  observed_at INTEGER NOT NULL,
  observer TEXT NOT NULL CHECK (observer IN ('Mac','Windows')),
  remaining REAL NOT NULL CHECK (remaining >= 0 AND remaining <= 100),
  resets_at INTEGER,
  duration_minutes INTEGER,
  source TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 200),
  PRIMARY KEY (provider, window, observed_at, observer)
) WITHOUT ROWID`;

const time=value=>{
  const at=typeof value==='number'?value:Date.parse(value);
  return Number.isFinite(at) && at>0?Math.round(at):null;
};
const windowId=value=>typeof value==='string' && /^[A-Za-z0-9_.:-]{1,40}$/.test(value)?value:null;

export async function openHistory(dataFolder) {
  const folder=await privateFolder(dataFolder,'private-limits');
  const db=new DatabaseSync(path.join(folder,'history.sqlite'));
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE;');
  db.exec(SCHEMA);
  return db;
}

export function readingsFrom(source,{provider,observer,source:origin,checkedAt}={}) {
  if(!PROVIDERS.includes(provider) || !OBSERVERS.includes(observer) || typeof origin!=='string')return [];
  if(!source || typeof source!=='object' || !Array.isArray(source.windows))return [];
  if(source.status!==undefined && !['ok','stale'].includes(source.status))return [];
  const sourceTime=time(source.checkedAt ?? checkedAt);
  return source.windows.flatMap(row=>{
    const window=windowId(row?.window);
    const remaining=row?.remainingPercent;
    const own=time(row?.checkedAt);
    const observed=own!==null && (sourceTime===null || own<=sourceTime)?own:sourceTime;
    if(!window || observed===null || typeof remaining!=='number' || !Number.isFinite(remaining) || remaining<0 || remaining>100)return [];
    const resets=time(row?.resetsAt);
    const duration=Number.isSafeInteger(row?.durationMinutes) && row.durationMinutes>0?row.durationMinutes:null;
    return [{provider,window,observedAt:observed,observer,remaining:Math.round(remaining*10)/10,resetsAt:resets,durationMinutes:duration,source:origin.slice(0,200)}];
  });
}

export function recordReadings(db,readings) {
  const insert=db.prepare(`INSERT OR IGNORE INTO limit_readings
    (provider,window,observed_at,observer,remaining,resets_at,duration_minutes,source) VALUES (?,?,?,?,?,?,?,?)`);
  let added=0;
  db.exec('BEGIN');
  try {
    for(const r of readings)added+=Number(insert.run(r.provider,r.window,r.observedAt,r.observer,r.remaining,r.resetsAt,r.durationMinutes,r.source).changes);
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
  return added;
}

const HOUR=3600000,DAY=24*HOUR;
export function compactHistory(db,{now=Date.now(),observer}={}) {
  const rows=db.prepare(`SELECT provider,window,observed_at,observer,remaining,resets_at,duration_minutes,source
    FROM limit_readings WHERE observed_at<=? ${observer?'AND observer=?':''} ORDER BY provider,window,observer,observed_at`)
    .all(...(observer?[now+5*60000,observer]:[now+5*60000]));
  const kept=new Map();
  for(const row of rows) {
    const age=now-row.observed_at;
    const bucket=age<=2*DAY?`r${row.observed_at}`:age<=30*DAY?`h${Math.floor(row.observed_at/HOUR)}`:`d${Math.floor(row.observed_at/DAY)}`;
    kept.set(`${row.provider}|${row.window}|${row.observer}|${bucket}`,row);
  }
  return [...kept.values()].map(row=>({p:row.provider,w:row.window,o:row.observer,t:new Date(row.observed_at).toISOString(),
    r:row.remaining,...(row.resets_at?{x:new Date(row.resets_at).toISOString()}:{}),...(row.duration_minutes?{d:row.duration_minutes}:{}),
    ...(row.source==='live'?{}:{s:row.source})}));
}

export function cleanHistoryPoints(points,observer) {
  if(!Array.isArray(points))return [];
  return points.slice(0,20000).flatMap(point=>{
    if(!point || typeof point!=='object')return [];
    const t=time(point.t),x=point.x===undefined?null:time(point.x);
    if(!PROVIDERS.includes(point.p) || !windowId(point.w) || point.o!==observer || t===null ||
      typeof point.r!=='number' || !Number.isFinite(point.r) || point.r<0 || point.r>100)return [];
    return [{p:point.p,w:point.w,o:observer,t:new Date(t).toISOString(),r:point.r,
      ...(x!==null?{x:new Date(x).toISOString()}:{}),...(Number.isSafeInteger(point.d) && point.d>0?{d:point.d}:{}),
      ...(typeof point.s==='string' && /^[A-Za-z0-9 _./:-]{1,200}$/.test(point.s)?{s:point.s}:{})}];
  });
}
