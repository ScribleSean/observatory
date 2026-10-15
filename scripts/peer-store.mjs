import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {parsePeerPayload} from './peer-payload.mjs';
import {selectPeerRevision} from './peer-revision.mjs';
import {privateSyncDirectory} from './peer-directory.mjs';
import {assertPeerNotRevoked} from './peer-revocation.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {readPairing} from './peer-pairing.mjs';

const limit=17_000_000;
const schema="CREATE TABLE peer_state (slot TEXT PRIMARY KEY CHECK (slot IN ('local', 'peer')), record TEXT NOT NULL CHECK (length(record) <= 17000000))";
const digest=payload=>createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const missing=error=>error.code==='ENOENT';
const validSlot=slot=>{if(!['local','peer'].includes(slot))throw Error('Invalid peer state slot');};

export async function assertCurrentPeerConfig(runtime,config,slot='local') {
  validSlot(slot);
  try {await lstat(path.join(runtime,'private-repair','require-pairing'));}
  catch(error) {if(missing(error))return;throw error;}
  const active=(await readPairing(runtime))?.[slot];
  const keys=['pairId','deviceId','comparisonId','host'];
  if(!active || !keys.every(key=>isDeepStrictEqual(active[key],config[key])))
    throw Error('Retired or unavailable pairing generation');
}

async function locations(runtime,create=false) {
  const directory=await privateSyncDirectory(runtime,create);
  await assertPeerNotRevoked(directory);
  for(const name of ['peer.json','write.lock']) {
    try {await lstat(path.join(directory,name));throw Error('Legacy development peer state requires explicit migration');}
    catch(error){if(!missing(error))throw error;}
  }
  return {directory,file:path.join(directory,'state.sqlite')};
}

function validate(record,config,now) {
  if(!record || typeof record!=='object' || Array.isArray(record) || record.version!==1 ||
    Object.keys(record).length!==3 || Object.keys(record).some(key=>!['version','revision','payload'].includes(key)))
    throw Error('Invalid peer state');
  const payload=parsePeerPayload(JSON.stringify(record.payload),config,now);
  const selected=selectPeerRevision(null,record.revision,config,now);
  if(record.revision.digest!==digest(payload) || record.revision.collectedAt!==payload.collectedAt ||
    !isDeepStrictEqual(record.revision,selected.revision))throw Error('Peer state integrity mismatch');
  return {version:1,revision:selected.revision,payload};
}

async function safeFile(file,optional=false) {
  try {
    const info=await lstat(file);
    if(!info.isFile() || info.isSymbolicLink() || info.nlink!==1 || info.size>64*1024*1024 ||
      (process.platform!=='win32' && (info.mode&0o077)))throw Error('Unsafe peer database file');
    return info;
  } catch(error){if(optional && missing(error))return null;throw error;}
}

async function database(runtime,create) {
  const location=await locations(runtime,create);
  let created=false;
  if(create) {
    try {
      const file=await open(location.file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
      await file.close();created=true;
    } catch(error){if(error.code!=='EEXIST')throw error;}
  }
  const before=await safeFile(location.file,!create);
  if(!before)return null;
  for(const suffix of ['-journal','-wal','-shm'])await safeFile(location.file+suffix,true);
  let db;
  try {
    db=new DatabaseSync(location.file);
    const after=await safeFile(location.file);
    if(after.dev!==before.dev || after.ino!==before.ino)throw Error('Changing peer database');
    db.exec('PRAGMA busy_timeout=1000; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');
    if(db.prepare('PRAGMA journal_mode').get().journal_mode!=='delete' ||
      db.prepare('PRAGMA page_size').get().page_size!==4096)throw Error('Unsupported peer database mode');
    db.exec('BEGIN IMMEDIATE');
    await assertPeerNotRevoked(location.directory);
    db.exec('PRAGMA max_page_count=16384');
    if(created) {
      db.exec(schema);
    }
    const objects=db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
    if(objects.length!==1 || objects[0].type!=='table' || objects[0].name!=='peer_state' || objects[0].sql!==schema)
      throw Error('Invalid peer database schema');
    return db;
  } catch(error) {
    if(db){try{db.exec('ROLLBACK');}catch{}db.close();}
    throw error;
  }
}

function read(db,config,now,slot) {
  const row=db.prepare('SELECT record FROM peer_state WHERE slot=?').get(slot);
  if(!row)return null;
  if(typeof row.record!=='string' || Buffer.byteLength(row.record)>limit)throw Error('Invalid peer state size');
  return validate(JSON.parse(row.record),config,now);
}

export function createPeerRecord(payload,config,sequence,now=Date.now()) {
  const safe=parsePeerPayload(JSON.stringify(payload),config,now);
  return validate({version:1,payload:safe,revision:{version:1,pairId:config.pairId,deviceId:config.deviceId,
    comparisonId:config.comparisonId,host:config.host,sequence,collectedAt:safe.collectedAt,digest:digest(safe)}},config,now);
}

export const readPeerState=(runtime,config,now=Date.now(),slot='peer')=>
  withPeerStateLock(runtime,()=>readPeerStateLocked(runtime,config,now,slot));
async function readPeerStateLocked(runtime,config,now,slot) {
  validSlot(slot);
  await assertCurrentPeerConfig(runtime,config,slot);
  let db;
  try {
    try{db=await database(runtime,false);}catch(error){if(missing(error))return null;throw error;}
    if(!db)return null;
    const result=read(db,config,now,slot);db.exec('COMMIT');return result;
  } finally {if(db){try{db.exec('ROLLBACK');}catch{}db.close();}}
}

export const publishLocalPayload=(runtime,payload,config,now=Date.now())=>
  withPeerStateLock(runtime,()=>publishLocalPayloadLocked(runtime,payload,config,now));
async function publishLocalPayloadLocked(runtime,payload,config,now) {
  await assertCurrentPeerConfig(runtime,config,'local');
  const safe=parsePeerPayload(JSON.stringify(payload),config,now);
  let db;
  try {
    db=await database(runtime,true);
    const current=read(db,config,now,'local');
    const sequence=(current?.revision.sequence??0)+1;
    if(!Number.isSafeInteger(sequence))throw Error('Local sequence exhausted; repair pairing explicitly');
    const candidate=createPeerRecord(safe,config,sequence,now);
    selectPeerRevision(current?.revision??null,candidate.revision,config,now);
    const bytes=JSON.stringify(candidate);
    if(Buffer.byteLength(bytes)>limit)throw Error('Peer state too large');
    db.prepare("INSERT INTO peer_state (slot,record) VALUES ('local',?) ON CONFLICT(slot) DO UPDATE SET record=excluded.record").run(bytes);
    db.exec('COMMIT');
    return candidate;
  } finally {if(db){try{db.exec('ROLLBACK');}catch{}db.close();}}
}

export const acceptPeerState=(runtime,incoming,config,now=Date.now(),slot='peer')=>
  withPeerStateLock(runtime,()=>acceptPeerStateLocked(runtime,incoming,config,now,slot));
async function acceptPeerStateLocked(runtime,incoming,config,now,slot) {
  validSlot(slot);
  await assertCurrentPeerConfig(runtime,config,slot);
  const candidate=validate(incoming,config,now);
  let db;
  try {
    db=await database(runtime,true);
    const current=read(db,config,now,slot);
    const decision=selectPeerRevision(current?.revision??null,candidate.revision,config,now);
    if(decision.action==='replace') {
      const bytes=JSON.stringify(candidate);
      if(Buffer.byteLength(bytes)>limit)throw Error('Peer state too large');
      db.prepare('INSERT INTO peer_state (slot,record) VALUES (?,?) ON CONFLICT(slot) DO UPDATE SET record=excluded.record').run(slot,bytes);
    }
    db.exec('COMMIT');
    return {action:decision.action,reason:decision.reason,status:decision.status};
  } finally {if(db){try{db.exec('ROLLBACK');}catch{}db.close();}}
}
