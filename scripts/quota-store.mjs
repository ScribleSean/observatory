import {open,lstat} from 'node:fs/promises';
import {constants,openSync,closeSync,fsyncSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {privateFolder} from '../lib/private-folder.mjs';
import {retainQuotaHistory} from './quota-history.mjs';
import {archiveSchema,archiveIndex,backfillQuotaArchive,archiveQuotaPoll,readQuotaArchivePage,readQuotaArchiveChart} from './quota-archive.mjs';

const schema='CREATE TABLE quota_state (slot INTEGER PRIMARY KEY CHECK (slot = 1), record TEXT NOT NULL CHECK (length(record) <= 16000000))';
const hex=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const timestamp=value=>Number.isSafeInteger(value) && value>=0 && value<=8640000000000000;
const sharingOff=()=>({enabled:false,generation:null,scope:null,pairingId:null});

// Never restore this automatically over newer observations.
function backupLegacyQuota(directory,record) {
  const file=path.join(directory,'migration-v1-'+randomBytes(16).toString('hex')+'.sqlite');
  const descriptor=openSync(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
  closeSync(descriptor);
  const saved=new DatabaseSync(file);
  try {
    saved.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
    saved.exec(schema);
    saved.prepare('INSERT INTO quota_state(slot,record) VALUES(1,?)').run(record);
    saved.exec('COMMIT');
    if(saved.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Quota migration backup verification failed');
  } finally {saved.close();}
  const durable=openSync(file,constants.O_RDWR);
  try {fsyncSync(durable);} finally {closeSync(durable);}
  if(process.platform!=='win32') {
    const handle=openSync(directory,constants.O_RDONLY);
    try {fsyncSync(handle);} finally {closeSync(handle);}
  }
}
function readSharing(value,history) {
  if(value===undefined)return sharingOff();
  if(!value || typeof value.enabled!=='boolean')throw Error('Invalid quota sharing state');
  if(!value.enabled)return sharingOff();
  if(typeof value.generation!=='string' || !/^[a-f0-9]{32}$/.test(value.generation) || !hex(value.scope) || !hex(value.pairingId))throw Error('Invalid quota sharing identity');
  if(value.scope!==history?.scope || ['not-connected','needs-auth','unsupported'].includes(history?.status))return sharingOff();
  return {enabled:true,generation:value.generation,scope:value.scope,pairingId:value.pairingId};
}

async function safeFile(file,optional=false) {
  try {
    const info=await lstat(file);
    if(!info.isFile() || info.isSymbolicLink() || info.nlink!==1 || info.size>8*1024*1024*1024 ||
      (process.platform!=='win32' && (info.mode&0o077)))throw Error('Unsafe quota database file');
    return info;
  } catch(error) {if(optional && error.code==='ENOENT')return null;throw error;}
}

async function withDatabase(runtime,action) {
  const directory=await privateFolder(runtime,'private-quota');
  const file=path.join(directory,'state.sqlite');
  try {const handle=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);await handle.close();}
  catch(error) {if(error.code!=='EEXIST')throw error;}
  const before=await safeFile(file);
  for(const suffix of ['-journal','-wal','-shm'])await safeFile(file+suffix,true);
  let db;
  try {
    db=new DatabaseSync(file);
    const after=await safeFile(file);
    if(before.dev!==after.dev || before.ino!==after.ino)throw Error('Changing quota database');
    db.exec('PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');
    if(db.prepare('PRAGMA journal_mode').get().journal_mode!=='delete' || db.prepare('PRAGMA page_size').get().page_size!==4096)
      throw Error('Unsupported quota database mode');
    db.exec('BEGIN IMMEDIATE; PRAGMA max_page_count=2097152');
    let objects=db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
    if(!objects.length && before.size===0) {db.exec(schema);objects=db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();}
    const cache=objects.find(object=>object.name==='quota_state');
    if(!cache || cache.type!=='table' || cache.sql!==schema)
      throw Error('Invalid quota database schema');
    if(objects.length===1) {
      const old=db.prepare('SELECT record FROM quota_state WHERE slot=1').get();
      read(db,Date.now());
      if(old)backupLegacyQuota(directory,old.record);
      db.exec(archiveSchema);db.exec(archiveIndex);
      if(old)backfillQuotaArchive(db,JSON.parse(old.record).history);
    } else if(objects.length!==3 || !objects.some(object=>object.type==='table' && object.name==='quota_archive' && object.sql===archiveSchema) ||
      !objects.some(object=>object.type==='index' && object.name==='quota_archive_lookup' && object.sql===archiveIndex))throw Error('Invalid quota archive schema');
    const result=action(db);
    db.exec('COMMIT');
    return result;
  } finally {
    if(db) {try {db.exec('ROLLBACK');}catch{}db.close();}
  }
}

function read(db,now) {
  const row=db.prepare('SELECT record FROM quota_state WHERE slot=1').get();
  if(!row)return {version:1,revision:0,salt:randomBytes(32).toString('hex'),history:null,nextAttemptAt:0,failures:0,sharing:sharingOff()};
  if(typeof row.record!=='string' || Buffer.byteLength(row.record)>16_000_000)throw Error('Invalid quota record');
  const value=JSON.parse(row.record);
  if(value?.version!==1 || !Number.isSafeInteger(value.revision) || value.revision<0 || !hex(value.salt) ||
    !timestamp(value.nextAttemptAt) || !Number.isSafeInteger(value.failures) || value.failures<0 || value.failures>32)
    throw Error('Invalid quota state');
  let history=null;
  if(value.history) {
    if(value.history.status==='not-connected')history=retainQuotaHistory(null,null,{enabled:false,now});
    else if(hex(value.history.scope)) {
      if(!['ok','stale','unavailable','needs-auth','unsupported'].includes(value.history.status))throw Error('Invalid saved quota status');
      history=retainQuotaHistory(value.history,{status:value.history.latestReadStatus},{scope:value.history.scope,now});
      if(value.history.status==='ok' && history.status==='stale' && history.latestReadStatus==='ok' && history.asOf && history.asOf===value.history.asOf)history.status='ok';
    }
    else throw Error('Invalid quota account scope');
  }
  const sharing=readSharing(value.sharing,history);
  const remote=null;
  return {version:1,revision:value.revision,salt:value.salt,history,nextAttemptAt:value.nextAttemptAt,failures:value.failures,
    sharing,remote};
}

function save(db,value) {
  const record=JSON.stringify(value);
  if(Buffer.byteLength(record)>16_000_000)throw Error('Quota retention limit exceeded');
  db.prepare('INSERT INTO quota_state(slot,record) VALUES(1,?) ON CONFLICT(slot) DO UPDATE SET record=excluded.record').run(record);
}

// The salt is private state. Never include this result wholesale in a snapshot.
export const readQuotaState=(runtime,now=Date.now())=>withDatabase(runtime,db=>{
  if(!timestamp(now))throw Error('Invalid observation time');
  const state=read(db,now);
  save(db,state);return state;
});

export const updateQuotaState=(runtime,{revision,scope,observation,enabled=true,nextAttemptAt=0,failures=0},now=Date.now())=>withDatabase(runtime,db=>{
  if(!timestamp(now) || !timestamp(nextAttemptAt) || !Number.isSafeInteger(failures) || failures<0 || failures>32)
    throw Error('Invalid quota polling state');
  const previous=read(db,now);
  if(previous.revision!==revision)throw Error('Quota collection superseded');
  const next={...previous,revision:previous.revision+1,
    history:retainQuotaHistory(previous.history,observation,{scope,enabled,now}),
    nextAttemptAt:enabled?nextAttemptAt:Math.max(previous.nextAttemptAt,nextAttemptAt),failures:enabled?failures:previous.failures};
  if(!Number.isSafeInteger(next.revision))throw Error('Quota revision exhausted');
  next.sharing=readSharing(previous.sharing,next.history);
  if(!next.sharing.enabled)next.remote=null;
  archiveQuotaPoll(db,{scope,observation,enabled},now);
  save(db,next);return next;
});

export const readQuotaArchive=(runtime,query)=>withDatabase(runtime,db=>readQuotaArchivePage(db,query));
export const readQuotaChart=(runtime,query)=>withDatabase(runtime,db=>readQuotaArchiveChart(db,query));
