import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {privateCollectorDirectory} from './peer-directory.mjs';
import {retainQuotaHistory} from './quota-history.mjs';
import {parseQuotaRecord,selectQuotaRecord} from './quota-record.mjs';
import {archiveSchema,archiveIndex,backfillQuotaArchive,archiveQuotaPoll,readQuotaArchivePage} from './quota-archive.mjs';
import {withPeerStateLock} from './peer-lock.mjs';

const schema='CREATE TABLE quota_state (slot INTEGER PRIMARY KEY CHECK (slot = 1), record TEXT NOT NULL CHECK (length(record) <= 16000000))';
const hex=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const timestamp=value=>Number.isSafeInteger(value) && value>=0 && value<=8640000000000000;
const sharingOff=()=>({enabled:false,generation:null,scope:null,pairingId:null});
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
  const directory=await privateCollectorDirectory(runtime,'private-quota',true);
  const file=path.join(directory,'state.sqlite');
  // Exclusive file creation preserves private permissions before SQLite opens it.
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
    else if(hex(value.history.scope))history=retainQuotaHistory(value.history,{status:value.history.latestReadStatus},{scope:value.history.scope,now});
    else throw Error('Invalid quota account scope');
  }
  const sharing=readSharing(value.sharing,history);
  let remote=null;
  if(sharing.enabled && value.remote) {
    const saved=value.remote;
    if(!timestamp(saved.receivedAt) || !['Mac','Windows'].includes(saved.host) || saved.pairingId!==sharing.pairingId)
      throw Error('Invalid saved peer allowance');
    remote={receivedAt:saved.receivedAt,host:saved.host,pairingId:saved.pairingId,
      record:parseQuotaRecord(saved.record,saved.host,saved.receivedAt)};
  }
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
  // Persist the initial salt before any network read, including concurrent runs.
  save(db,state);return state;
});

// Collection occurs outside the transaction. Reject a late result if another
// collector or a source-disable operation has already changed this generation.
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

const archiveDeletionToken=(state,scope)=>createHash('sha256')
  .update(JSON.stringify(['observatory-quota-archive-delete-v1',state.salt,state.revision,scope])).digest('hex');

// Internal owner-local API. Native controls must resolve the selected account
// locally, never accept arbitrary database paths or expose scope keys to peers.
export const inspectQuotaArchive=(runtime,{scope},now=Date.now())=>withDatabase(runtime,db=>{
  if(!hex(scope) || !timestamp(now))throw Error('Invalid archive selection');
  const state=read(db,now);
  const groups=db.prepare('SELECT kind,COUNT(*) AS count,MIN(observed_at) AS firstAt,MAX(observed_at) AS lastAt FROM quota_archive WHERE scope=? GROUP BY kind').all(scope);
  const bytes=db.prepare('PRAGMA page_count').get().page_count*4096;
  return {groups,storageBytes:bytes,storageLimitBytes:8*1024*1024*1024,
    token:groups.length?archiveDeletionToken(state,scope):null};
});

// Logical deletion is atomic with invalidation of pending collectors. It does
// not claim secure erasure of backups, filesystem snapshots or paired devices.
export const deleteQuotaArchive=async(runtime,{scope,token,confirmation},now=Date.now())=>{
  if(!hex(scope) || !hex(token) || confirmation!=='delete-account-history' || !timestamp(now))throw Error('Invalid archive deletion confirmation');
  await lstat(path.join(runtime,'private-quota'));
  return withPeerStateLock(runtime,()=>withDatabase(runtime,db=>{
  const previous=read(db,now);
  if(token!==archiveDeletionToken(previous,scope))throw Error('Archive deletion confirmation expired');
  if(!db.prepare('SELECT 1 FROM quota_archive WHERE scope=? LIMIT 1').get(scope))throw Error('Archive already empty');
  const next={...previous,revision:previous.revision+1};
  if(!Number.isSafeInteger(next.revision))throw Error('Quota revision exhausted');
  if(previous.history?.scope===scope) {
    next.history=retainQuotaHistory(null,null,{enabled:false,now});
    next.sharing=sharingOff();next.remote=null;
  }
  const removed=db.prepare('DELETE FROM quota_archive WHERE scope=?').run(scope).changes;
  save(db,next);
  return {deletedRecords:removed};
  }));
};

// Called only after explicit consent for this account and paired device. A new
// consent rotates the public generation, including when the pairing changes.
// Disabling changes the revision so an in-flight collection cannot undo it.
export const setQuotaSharing=(runtime,{revision,enabled,pairingId},now=Date.now())=>withDatabase(runtime,db=>{
  if(!timestamp(now) || typeof enabled!=='boolean')throw Error('Invalid quota sharing consent');
  const previous=read(db,now);
  if(previous.revision!==revision)throw Error('Quota sharing superseded');
  if(enabled && (!hex(pairingId) || !hex(previous.history?.scope) ||
      !['ok','stale'].includes(previous.history?.status) || previous.history.latestReadStatus!=='ok'))
    throw Error('Read the current account before sharing');
  const next={...previous,revision:previous.revision+1,remote:null,sharing:enabled?
    {enabled:true,generation:randomBytes(16).toString('hex'),scope:previous.history.scope,pairingId}:sharingOff()};
  if(!Number.isSafeInteger(next.revision))throw Error('Quota revision exhausted');
  save(db,next);return next;
});

// Pairing retirement is unconditional and atomic with respect to collectors.
// Do not initialize quota storage for users who never enabled monitoring.
export async function revokeQuotaSharing(runtime,now=Date.now()) {
  try {await lstat(path.join(runtime,'private-quota'));}
  catch(error) {if(error.code==='ENOENT')return;throw error;}
  return withDatabase(runtime,db=>{
    if(!timestamp(now))throw Error('Invalid observation time');
    const previous=read(db,now);
    const next={...previous,revision:previous.revision+1,sharing:sharingOff(),remote:null};
    if(!Number.isSafeInteger(next.revision))throw Error('Quota revision exhausted');
    save(db,next);
  });
}

// Caller authenticates the peer and holds the pairing lock. Recheck consent in
// the same transaction as the saved watermark so disable cannot race acceptance.
export const exchangeQuotaState=(runtime,{revision,pairingId,host,record,outgoing},now=Date.now())=>withDatabase(runtime,db=>{
  if(!timestamp(now))throw Error('Invalid allowance exchange time');
  const previous=read(db,now);
  if(previous.revision!==revision || !previous.sharing.enabled || previous.sharing.pairingId!==pairingId)
    throw Error('Allowance sharing superseded');
  const incoming=parseQuotaRecord(record,host,now);
  const prior=previous.remote?.host===host?previous.remote.record:null;
  const selected=selectQuotaRecord(prior,incoming);
  const sequence=previous.revision+1;
  if(!Number.isSafeInteger(sequence))throw Error('Quota revision exhausted');
  const exported=parseQuotaRecord({version:1,sequence,payload:outgoing},host==='Mac'?'Windows':'Mac',now);
  const next={...previous,revision:sequence,remote:selected===prior?previous.remote:{receivedAt:now,host,pairingId,record:incoming}};
  save(db,next);
  return exported;
});

export const publishQuotaState=(runtime,{revision,pairingId,host,payload},now=Date.now())=>withDatabase(runtime,db=>{
  const previous=read(db,now);
  if(previous.revision!==revision || !previous.sharing.enabled || previous.sharing.pairingId!==pairingId)
    throw Error('Allowance sharing superseded');
  const record=parseQuotaRecord({version:1,sequence:previous.revision+1,payload},host,now);
  save(db,{...previous,revision:record.sequence});
  return record;
});

export const acceptQuotaReply=(runtime,{revision,pairingId,host,record},now=Date.now())=>withDatabase(runtime,db=>{
  if(!timestamp(now))throw Error('Invalid allowance reply time');
  const previous=read(db,now);
  if(previous.revision!==revision || !previous.sharing.enabled || previous.sharing.pairingId!==pairingId)
    throw Error('Allowance sharing superseded');
  if(record===null) {save(db,{...previous,remote:null});return;}
  const incoming=parseQuotaRecord(record,host,now),prior=previous.remote?.host===host?previous.remote.record:null;
  if(selectQuotaRecord(prior,incoming)===prior)return;
  save(db,{...previous,remote:{receivedAt:now,host,pairingId,record:incoming}});
});
