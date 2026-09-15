import {cleanQuotaObservation} from './quota-history.mjs';
import {rasterQuotaTimeline} from './quota-chart-raster.mjs';

const timelinePredicate=`(kind='observation' OR (kind='poll' AND
    (json_extract(record,'$.status')!='ok' OR NOT EXISTS
      (SELECT 1 FROM quota_archive AS observation WHERE observation.scope=quota_archive.scope
       AND observation.kind='observation' AND observation.observed_at=quota_archive.observed_at))))`;

export const archiveSchema="CREATE TABLE quota_archive (id INTEGER PRIMARY KEY, scope TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('observation','daily','poll')), observed_at INTEGER NOT NULL, record TEXT NOT NULL CHECK (length(record) <= 16384), UNIQUE(scope,kind,observed_at,record))";
export const archiveIndex='CREATE INDEX quota_archive_lookup ON quota_archive(scope,kind,observed_at,id)';
const scopeKey=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const validTime=value=>Number.isSafeInteger(value) && value>=0 && value<=8640000000000000;
const statuses=['ok','unavailable','needs-auth','unsupported','rate-limited'];

function append(db,scope,kind,at,record) {
  if(!scopeKey(scope) || !validTime(at))throw Error('Invalid archive identity');
  const json=JSON.stringify(record);
  if(Buffer.byteLength(json)>16384)throw Error('Archive entry too large');
  db.prepare('INSERT OR IGNORE INTO quota_archive(scope,kind,observed_at,record) VALUES(?,?,?,?)').run(scope,kind,at,json);
}

function daily(db,scope,rows,checkedAt,now) {
  const at=Date.parse(checkedAt);
  if(!validTime(at) || at>now || !Array.isArray(rows) || rows.length>36600)return;
  for(const row of rows) {
    const day=Date.parse(row?.startDate);
    if(typeof row?.startDate!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.startDate) ||
      !validTime(day) || new Date(day).toISOString().slice(0,10)!==row.startDate || day>now ||
      !Number.isSafeInteger(row.tokens) || row.tokens<0)continue;
    append(db,scope,'daily',at,{checkedAt:new Date(at).toISOString(),startDate:row.startDate,tokens:row.tokens});
  }
}

// Runs in the cache transaction. Backfill before its first retention prune.
export function backfillQuotaArchive(db,history) {
  if(!scopeKey(history?.scope))return;
  if(!Array.isArray(history.samples) || history.samples.length>10000)throw Error('Invalid legacy quota history');
  for(const input of history.samples) {
    const at=Date.parse(input?.checkedAt),row=cleanQuotaObservation(input,at);
    if(row)append(db,history.scope,'observation',at,row);
  }
  daily(db,history.scope,history.dailyUsageBuckets,history.dailyAsOf,Date.now());
}

export function archiveQuotaPoll(db,{scope,observation,enabled},now) {
  if(!enabled || !scopeKey(scope))return;
  const status=statuses.includes(observation?.status)?observation.status:'unavailable';
  append(db,scope,'poll',now,{checkedAt:new Date(now).toISOString(),status});
  if(status==='ok') {
    const row=cleanQuotaObservation(observation,now);
    if(row)append(db,scope,'observation',Date.parse(row.checkedAt),row);
  }
  if(observation?.accountUsage?.status==='ok')
    daily(db,scope,observation.accountUsage.dailyUsageBuckets,observation.accountUsage.checkedAt??observation.checkedAt,now);
}

// Owner-local only. Never project archive scope keys or records wholesale to peers.
export function readQuotaArchivePage(db,{scope,kind,from=0,to=8640000000000000,after=null,limit=100}={}) {
  if(!scopeKey(scope) || !['observation','daily','poll','timeline'].includes(kind) ||
    !validTime(from) || !validTime(to) || from>to || !Number.isSafeInteger(limit) || limit<1 || limit>200 ||
    (after!==null && (!validTime(after.at) || !Number.isSafeInteger(after.id) || after.id<1)))throw Error('Invalid archive query');
  // Failed checks are evidence of unknown coverage, including failures shorter
  // than the normal gap threshold. Omit a successful poll only when a matching
  // observation exists. An empty successful response still has unknown coverage.
  const predicate=kind==='timeline'?timelinePredicate:'kind=?';
  const found=db.prepare(`SELECT id,observed_at,record FROM quota_archive WHERE scope=? AND ${predicate} AND observed_at>=? AND observed_at<=? AND (observed_at,id)>(?,?) ORDER BY observed_at,id LIMIT ?`)
    .all(scope,...(kind==='timeline'?[]:[kind]),from,to,after?.at??-1,after?.id??0,limit+1);
  const records=[];let bytes=0,last=null;
  for(const row of found.slice(0,limit)) {
    bytes+=Buffer.byteLength(row.record);
    if(bytes>512000)break;
    records.push(JSON.parse(row.record));last={at:row.observed_at,id:row.id};
  }
  return {records,next:found.length>records.length?last:null};
}

export function readQuotaArchiveChart(db,{scope,...options}) {
  if(!scopeKey(scope))throw Error('Invalid archive scope');
  function* records() {
    const query=db.prepare(`SELECT record FROM quota_archive WHERE scope=? AND ${timelinePredicate}
      AND observed_at>=? AND observed_at<=? ORDER BY observed_at,id`);
    for(const row of query.iterate(scope,options.from,options.to))yield JSON.parse(row.record);
  }
  return {chart:rasterQuotaTimeline(records(),options)};
}
