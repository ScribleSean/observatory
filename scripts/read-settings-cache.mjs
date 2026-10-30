import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {
  DEFAULT_LIMITS,DEFAULT_SCAN_BYTES,EFFORTS,FIELDS,LineReader,PyTypeError,TIERS,ValueError,
  cpLen,get,has,inEfforts,isDict,isoformat,label,number,openForReading,parseIsoformat,pyDumps,pyEqual,
  pyLoads,pyLoadsBytes,sha256Hex,toolIdentifier,validEvent,
} from './read-settings.mjs';

const HEX64=/^[a-f0-9]{64}$/;
const SCHEMA='CREATE TABLE events (key TEXT PRIMARY KEY, signature TEXT NOT NULL, data TEXT NOT NULL)';
const windows=process.platform==='win32';
const realpath=windows?fs.realpathSync.native:fs.realpathSync;

export function cacheEvent(event,cached=false) {
  if(!validEvent(event)||!isDict(get(event,'payload')))return null;
  const payload=event.payload;
  let kind=get(event,'type');
  const subtype=get(payload,'type');
  let safe=null;
  if(subtype==='thread_settings_applied') {
    const settings=get(payload,'thread_settings');
    if(!isDict(settings))return null;
    const values={};
    for(const key of ['model','reasoning_effort','service_tier']) {
      if(!has(settings,key))continue;
      const value=settings[key];
      values[key]=key==='model'?label(value):typeof value==='string'&&(key==='reasoning_effort'?EFFORTS.has(value):TIERS.has(value))?value:'unknown';
    }
    safe={type:subtype,thread_settings:values};
    kind=['event_msg','turn_context','response_item'].includes(kind)?kind:'event_msg';
  } else if(kind==='turn_context') {
    safe={model:label(get(payload,'model')),effort:inEfforts(get(payload,'effort'))?payload.effort:'unknown'};
    const turnId=cached?get(payload,'usage_turn_key'):get(payload,'turn_id');
    if(typeof turnId==='string') {
      if(cached&&!HEX64.test(turnId))return null;
      safe.usage_turn_key=cached?turnId:sha256Hex(turnId);
    }
    if(has(payload,'service_tier')) {
      const tier=payload.service_tier;
      safe.service_tier=typeof tier==='string'&&TIERS.has(tier)?tier:'unknown';
    }
  } else if(kind==='session_meta') {
    // Kept so a fork's copy of its parent can be found, with the id as its hash.
    safe={};
    const identity=get(payload,'id');
    if(typeof identity==='string') {
      if(cached&&!HEX64.test(identity))return null;
      safe.id=cached?identity:sha256Hex(identity);
    }
  } else if(kind==='event_msg'&&subtype==='token_count') {
    const info=get(payload,'info');
    if(!isDict(info)||!isDict(get(info,'total_token_usage')))return null;
    const values={};
    for(const key of ['total_token_usage','last_token_usage']) {
      const source=get(info,key);
      if(!isDict(source))continue;
      values[key]=Object.fromEntries(FIELDS.map(field=>[field,number(has(source,field)?source[field]:field==='cache_write_input_tokens'?0:null)]));
    }
    safe={type:subtype,info:values};
  } else if(kind==='response_item'&&(subtype==='function_call'||subtype==='custom_tool_call')) {
    let identity=get(payload,'call_id');
    if(typeof identity!=='string')return null;
    if(cached) {
      if(!HEX64.test(identity))return null;
    } else identity=sha256Hex(identity);
    safe={type:subtype,call_id:identity,name:toolIdentifier(get(payload,'name'),'Unknown tool'),namespace:toolIdentifier(get(payload,'namespace'),'')};
  }
  if(safe===null)return null;
  const result={type:kind,payload:safe};
  const timestamp=get(event,'timestamp');
  if(typeof timestamp==='string'&&cpLen(timestamp)<=64) {
    try {
      const stamp=parseIsoformat(timestamp.replaceAll('Z','+00:00'));
      if(stamp.tz!==null)result.timestamp=isoformat(stamp);
    } catch(error) {if(!(error instanceof ValueError))throw error;}
  }
  return result;
}

function safeLine(line) {
  try {return cacheEvent(pyLoadsBytes(line));}
  catch(error) {
    if(error instanceof ValueError||error instanceof PyTypeError)return null;
    throw error;
  }
}

const mode=info=>Number(info.mode)&0o777;
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
// Path(directory) drops repeated separators, trailing separators and '.' parts.
const windowsForm=directory=>path.win32.normalize(directory).replace(/[\\/]+$/,'').toLowerCase();
function pathlibForm(directory) {
  const lead=directory.startsWith('//')&&!directory.startsWith('///')?'//':'/';
  return lead+directory.split('/').filter(part=>part&&part!=='.').join('/');
}

export function windowsCanonical(directory,{realpath=fs.realpathSync.native,lstat=fs.lstatSync}={}) {
  return realpath(directory).toLowerCase()===windowsForm(directory)&&!lstat(directory).isSymbolicLink();
}

export class SettingsCache {
  constructor(directory,budget=DEFAULT_SCAN_BYTES,{limits=DEFAULT_LIMITS}={}) {
    this.limits=limits;
    if(typeof directory!=='string'||!path.isAbsolute(directory))throw new ValueError('Unsafe cache directory');
    const canonical=windows?windowsCanonical(directory):realpath(directory)===pathlibForm(directory)&&!fs.lstatSync(directory).isSymbolicLink();
    if(!canonical)throw new ValueError('Unsafe cache directory');
    if(!windows&&mode(fs.statSync(directory))&0o077)throw new ValueError('Unsafe cache permissions');
    this.readBudget=null;
    this.remaining=budget;
    this.used=new Set();
    this.pending=false;
    this.scannedBytes=0;
    this.hits=0;
    const file=path.join(directory,'events.sqlite');
    try {fs.closeSync(fs.openSync(file,'wx',0o600));}
    catch(error) {if(error.code!=='EEXIST')throw error;}
    const before=fs.lstatSync(file,{bigint:true});
    if(!before.isFile()||before.nlink!==1n||before.size>BigInt(limits.maxCacheBytes)||(!windows&&mode(before)&0o077))
      throw new ValueError('Unsafe cache file');
    for(const suffix of ['-journal','-wal','-shm']) {
      let info;
      try {info=fs.lstatSync(file+suffix);}
      catch(error) {if(error.code==='ENOENT'||error.code==='ENOTDIR')continue;throw error;}
      if(!info.isFile()||info.nlink!==1||(!windows&&mode(info)&0o077))throw new ValueError('Unsafe cache sidecar');
    }
    this.db=new DatabaseSync(file,{timeout:1000});
    const after=fs.lstatSync(file,{bigint:true});
    if(!sameFile(before,after)) {
      this.db.close();
      throw new ValueError('Changing cache file');
    }
    const value=sql=>Object.values(this.db.prepare(sql).get()??{})[0];
    const objects=()=>this.db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
    try {
      this.db.exec('PRAGMA busy_timeout=1000');
      this.db.exec('PRAGMA trusted_schema=OFF');
      this.db.exec('PRAGMA synchronous=FULL');
      this.db.exec(`PRAGMA max_page_count=${Math.floor(limits.maxCacheBytes/limits.cachePageSize)}`);
      if(value('PRAGMA journal_mode')!=='delete'||value('PRAGMA page_size')!==limits.cachePageSize)
        throw new ValueError('Unsupported cache format');
      this.db.exec('BEGIN IMMEDIATE');
      let found=objects();
      const version=value('PRAGMA user_version');
      if(before.size===0n&&!found.length&&version===0) {
        const locked=fs.lstatSync(file,{bigint:true});
        if(!sameFile(locked,before)||locked.size!==0n)throw new ValueError('Changing cache file');
        this.db.exec(SCHEMA);
        this.db.exec('PRAGMA user_version=1');
        found=objects();
      }
      if(value('PRAGMA user_version')!==1||found.length!==1||found[0].type!=='table'||found[0].name!=='events'||found[0].sql!==SCHEMA)
        throw new ValueError('Unsupported cache format');
      this.db.exec('COMMIT');
    } catch(error) {
      this.db.close();
      throw error;
    }
  }

  static signature(info) {
    // Windows path stat may report creation time as ctime while fstat reports
    // change time. Do not compare these different fields across APIs.
    const values=[2,String(info.dev),String(info.ino),Number(info.size),String(info.mtimeNs)];
    if(!windows)values.push(String(info.ctimeNs));
    return pyDumps(values);
  }

  events(file,expected) {
    this.readBudget?.check();
    const {maxLineBytes,maxLines,maxRetainedBytes}=this.limits;
    // Version 2 entries keep session_meta; older ones are read again and dropped.
    const key=sha256Hex('2\0'+String(file));
    this.used.add(key);
    const signature=SettingsCache.signature(expected);
    if(SettingsCache.signature(fs.statSync(file,{bigint:true}))!==signature) {
      this.pending=true;
      return [];
    }
    const row=this.db.prepare('SELECT signature, data FROM events WHERE key=?').get(key);
    if(row&&row.signature===signature) {
      const data=row.data;
      if((typeof data==='string'?cpLen(data):data.length)>maxRetainedBytes+2*maxLines+2)
        throw new ValueError('Private event cache entry limit');
      let saved;
      try {saved=typeof data==='string'?pyLoads(data):pyLoadsBytes(data);}
      catch(error) {
        if(!(error instanceof ValueError))throw error;
        saved=null;
      }
      if(Array.isArray(saved)) {
        let retained=0;
        let valid=true;
        for(const event of saved) {
          this.readBudget?.check();
          if(!isDict(event)||!pyEqual(cacheEvent(event,true),event)) {
            valid=false;
            break;
          }
          retained+=pyDumps(event).length;
          if(retained>maxRetainedBytes)throw new ValueError('Private event cache entry limit');
        }
        if(valid) {
          this.hits+=1;
          return saved;
        }
      }
    }
    const size=Number(expected.size);
    if(size>this.remaining) {
      this.pending=true;
      return [];
    }
    this.remaining-=size;
    this.scannedBytes+=size;
    const events=[];
    let retained=0;
    const fd=openForReading(file);
    try {
      if(SettingsCache.signature(fs.fstatSync(fd,{bigint:true}))!==signature) {
        this.pending=true;
        return [];
      }
      const reader=new LineReader(fd);
      let remaining=size;
      let skipping=false;
      while(remaining) {
        this.readBudget?.check();
        const line=reader.readline(Math.min(maxLineBytes+1,remaining));
        if(!line.length)break;
        this.readBudget?.charge(line.length,!skipping);
        remaining-=line.length;
        if(skipping||line.length>maxLineBytes) {
          skipping=line.at(-1)!==10;
          continue;
        }
        const safe=safeLine(line);
        if(safe!==null) {
          retained+=pyDumps(safe).length;
          if(retained>maxRetainedBytes)throw new ValueError('Private event cache entry limit');
          events.push(safe);
        }
      }
      if(remaining||SettingsCache.signature(fs.fstatSync(fd,{bigint:true}))!==signature) {
        this.pending=true;
        return [];
      }
    } finally {fs.closeSync(fd);}
    this.db.prepare('INSERT INTO events VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET signature=excluded.signature, data=excluded.data')
      .run(key,signature,pyDumps(events));
    return events;
  }

  close({completed=false}={}) {
    try {
      if(!completed)return;
      this.db.exec('BEGIN');
      for(const {key} of this.db.prepare('SELECT key FROM events').all()) {
        this.readBudget?.check();
        if(!this.used.has(key))this.db.prepare('DELETE FROM events WHERE key=?').run(key);
      }
      this.db.exec('COMMIT');
    } finally {
      this.db.close();
    }
  }
}

