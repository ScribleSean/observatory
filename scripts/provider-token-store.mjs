import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {privateSyncDirectory} from './peer-directory.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {readPairing} from './peer-pairing.mjs';
import {selectPeerRevision} from './peer-revision.mjs';
import {createProviderTokenRecord,parseProviderTokenRecord,parseProviderTokenSource,
  exactProviderFields,providerGeneration,providerClock,providerTokenLimit} from './provider-token-peer.mjs';

const schema='CREATE TABLE provider_token_state (slot INTEGER PRIMARY KEY CHECK (slot = 1), record TEXT NOT NULL CHECK (length(record) <= 52000000))';
const stateLimit=52_000_000;
const hex=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const identity=source=>Object.fromEntries(['pairId','deviceId','comparisonId','host'].map(key=>[key,source[key]]));
export const providerTokenBinding=pair=>({local:identity(pair.local),peer:identity(pair.peer)});
const initial=pair=>({version:1,revision:0,salt:randomBytes(32).toString('hex'),binding:providerTokenBinding(pair),
  generation:null,source:null,local:null,remote:null});
const advance=state=>{
  const revision=state.revision+1;
  if(!Number.isSafeInteger(revision))throw Error('Provider revision exhausted');
  return {...state,revision};
};
export const recentProviderSource=(source,now)=>source?.status==='ok' && now-Date.parse(source.checkedAt)>=0 && now-Date.parse(source.checkedAt)<=600000;

function parseState(raw,now) {
  if(!exactProviderFields(raw,['version','revision','salt','binding','generation','source','local','remote']) || raw.version!==1 ||
    !Number.isSafeInteger(raw.revision) || raw.revision<0 || !hex(raw.salt) ||
    !exactProviderFields(raw.binding,['local','peer']) || (raw.generation!==null && !providerGeneration(raw.generation)))throw Error('Invalid provider state');
  const {local,peer}=raw.binding;
  for(const value of [local,peer])if(!exactProviderFields(value,['pairId','deviceId','comparisonId','host']) ||
    !['Mac','Windows'].includes(value.host) || ['pairId','deviceId','comparisonId'].some(key=>!hex(value[key])))throw Error('Invalid provider binding');
  if(local.host===peer.host || local.deviceId===peer.deviceId || local.pairId!==peer.pairId || local.comparisonId!==peer.comparisonId)
    throw Error('Invalid provider binding');
  const source=raw.source===null?null:parseProviderTokenSource(raw.source,local.host,now);
  const record=raw.local===null?null:parseProviderTokenRecord(raw.local,local,now);
  if(record && record.revision.sequence>raw.revision)throw Error('Invalid provider sequence');
  if(raw.generation && (!record || record.payload.generation!==raw.generation || !isDeepStrictEqual(record.payload.source,source) || source.status==='not-connected'))
    throw Error('Invalid provider sharing state');
  let remote=null;
  if(raw.remote!==null) {
    if(!exactProviderFields(raw.remote,['record','receivedAt','consentGeneration']) || !providerClock(raw.remote.receivedAt) ||
      (raw.remote.consentGeneration!==null && !providerGeneration(raw.remote.consentGeneration)))throw Error('Invalid provider receipt');
    remote={record:parseProviderTokenRecord(raw.remote.record,peer,raw.remote.receivedAt),
      receivedAt:raw.remote.receivedAt,consentGeneration:raw.remote.consentGeneration};
  }
  return {...raw,source,local:record,remote};
}

async function safeFile(file,optional=false) {
  try {
    const info=await lstat(file);
    if(!info.isFile() || info.isSymbolicLink() || info.nlink!==1 || info.size>64*1024*1024 ||
      (process.platform!=='win32' && (info.mode&0o077)))throw Error('Unsafe provider database file');
    return info;
  } catch(error) {if(optional && error.code==='ENOENT')return null;throw error;}
}

// A separate file preserves the exact core peer database schema. The existing
// pairing lock, revocation fence, ACL checks and directory retirement apply.
async function withState(runtime,{create=false,disabled=false,now=Date.now()}={},action) {
  if(!providerClock(now))throw Error('Invalid provider clock');
  return withPeerStateLock(runtime,async()=>{
    let pair;
    try {pair=await readPairing(runtime);}catch(error) {if(!disabled)throw error;}
    if(!pair && !disabled)return null;
    let directory;
    try {directory=await privateSyncDirectory(runtime);}catch(error) {if(error.code==='ENOENT')return null;throw error;}
    const file=path.join(directory,'provider-tokens.sqlite');
    let created=false;
    if(create)try {
      const handle=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
      await handle.close();created=true;
    } catch(error) {if(error.code!=='EEXIST')throw error;}
    const before=await safeFile(file,!create);
    if(!before)return null;
    for(const suffix of ['-journal','-wal','-shm'])await safeFile(file+suffix,true);
    let db;
    try {
      db=new DatabaseSync(file);
      const after=await safeFile(file);
      if(before.dev!==after.dev || before.ino!==after.ino)throw Error('Changing provider database');
      db.exec('PRAGMA busy_timeout=1000; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');
      if(db.prepare('PRAGMA journal_mode').get().journal_mode!=='delete' || db.prepare('PRAGMA page_size').get().page_size!==4096)
        throw Error('Unsupported provider database mode');
      db.exec('BEGIN IMMEDIATE; PRAGMA max_page_count=16384');
      if(created)db.exec(schema);
      const objects=db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
      if(objects.length!==1 || objects[0].type!=='table' || objects[0].name!=='provider_token_state' || objects[0].sql!==schema)
        throw Error('Invalid provider database schema');
      const saved=db.prepare('SELECT record FROM provider_token_state WHERE slot=1').get();
      if(saved && (typeof saved.record!=='string' || Buffer.byteLength(saved.record)>stateLimit))throw Error('Invalid provider state size');
      const state=saved?parseState(JSON.parse(saved.record),now):pair?initial(pair):null;
      if(!state || (!disabled && !isDeepStrictEqual(state.binding,providerTokenBinding(pair))))throw Error('Provider pairing superseded');
      const result=action(state,pair);
      if(result!==state || !saved) {
        const bytes=JSON.stringify(parseState(result,now));
        if(Buffer.byteLength(bytes)>stateLimit)throw Error('Provider state too large');
        db.prepare('INSERT INTO provider_token_state(slot,record) VALUES(1,?) ON CONFLICT(slot) DO UPDATE SET record=excluded.record').run(bytes);
      }
      db.exec('COMMIT');return result;
    } finally {if(db){try{db.exec('ROLLBACK');}catch{}db.close();}}
  });
}

export const readProviderTokenState=(runtime,now=Date.now())=>withState(runtime,{now},state=>state);

export const updateProviderTokenSource=(runtime,source,now=Date.now())=>withState(runtime,{create:true,now},state=>{
  const safe=parseProviderTokenSource(source,state.binding.local.host,now);
  if(Buffer.byteLength(JSON.stringify(safe))>providerTokenLimit-2048)throw Error('Provider source too large');
  if(state.source && Date.parse(safe.checkedAt)<Date.parse(state.source.checkedAt))throw Error('Regressing provider source time');
  if(isDeepStrictEqual(state.source,safe))return state;
  if(state.source?.checkedAt===safe.checkedAt)throw Error('Conflicting provider source time');
  const next={...advance(state),source:safe,generation:safe.status==='not-connected'?null:state.generation};
  if(next.generation)next.local=createProviderTokenRecord(safe,state.binding.local,next.generation,next.revision,now);
  return next;
});

export const setProviderTokenSharing=(runtime,{revision,enabled},now=Date.now())=>withState(runtime,{now},state=>{
  if(typeof enabled!=='boolean' || revision!==state.revision)throw Error('Provider sharing superseded');
  if(enabled && !recentProviderSource(state.source,now))throw Error('Read Claude usage before sharing');
  if(enabled===Boolean(state.generation))return state;
  const next={...advance(state),generation:enabled?randomBytes(16).toString('hex'):null};
  if(enabled)next.local=createProviderTokenRecord(next.source,state.binding.local,next.generation,next.revision,now);
  return next;
});

// Local disable remains possible when pairing is revoked or its file is corrupt.
export const disableProviderTokenSharing=(runtime,now=Date.now())=>withState(runtime,{disabled:true,now},state=>
  state.generation?{...advance(state),generation:null}:state);

export const acceptProviderTokenReply=(runtime,record,generation,now=Date.now())=>withState(runtime,{now},state=>{
  if(!generation || state.generation!==generation)throw Error('Provider sharing superseded');
  if(record===null)return state.remote?.consentGeneration?{...advance(state),remote:{...state.remote,consentGeneration:null}}:state;
  const incoming=parseProviderTokenRecord(record,state.binding.peer,now);
  const prior=state.remote;
  const decision=selectPeerRevision(prior?.record.revision??null,incoming.revision,state.binding.peer,now);
  if(decision.reason==='older')return state;
  if(decision.reason==='duplicate')return prior.consentGeneration===generation?state:
    {...advance(state),remote:{...prior,consentGeneration:generation}};
  return {...advance(state),remote:{record:incoming,receivedAt:now,consentGeneration:generation}};
});
