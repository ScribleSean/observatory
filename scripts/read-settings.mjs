// Summarize saved Codex settings and tool-call categories without exporting text.
// This is a port of read-settings.py. It keeps the Python reader's results,
// limits and failure cases, including the cases where Python stops with an error.
import {createHash,createHmac} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {SettingsCache} from './read-settings-cache.mjs';

export const MAX_FILES=100_000;
export const MAX_TOTAL_BYTES=2*1024*1024*1024;
export const MAX_LINES=3_000_000;
export const MAX_LINE_BYTES=8_000_000;
export const MAX_READ_SECONDS=45;
// One million characters of at most four UTF-8 bytes, the first line limit when it was read as text.
export const FIRST_LINE_BYTES=4_000_000;
export const MAX_CACHE_BYTES=2*1024*1024*1024;
export const CACHE_PAGE_SIZE=4096;
// Parsing a saved entry peaks at about 7.6 times its size, so 64 MiB can use about 500 MiB.
export const MAX_RETAINED_BYTES=64*1024*1024;
export const DEFAULT_SCAN_BYTES=2*1024*1024*1024;

export const DEFAULT_LIMITS=Object.freeze({maxFiles:MAX_FILES,maxTotalBytes:MAX_TOTAL_BYTES,maxLines:MAX_LINES,
  maxLineBytes:MAX_LINE_BYTES,maxReadSeconds:MAX_READ_SECONDS,firstLineBytes:FIRST_LINE_BYTES,
  maxCacheBytes:MAX_CACHE_BYTES,cachePageSize:CACHE_PAGE_SIZE,maxRetainedBytes:MAX_RETAINED_BYTES});

export function readerLimits(overrides={}) {
  return Object.freeze({...DEFAULT_LIMITS,...overrides});
}

// Python exception families. Only the families Python catches are distinguished.
export class ValueError extends Error {get name() {return 'ValueError';}}
export class UnicodeError extends ValueError {get name() {return 'UnicodeError';}}
export class PyTypeError extends Error {get name() {return 'TypeError';}}
export class AttributeError extends Error {get name() {return 'AttributeError';}}
export class OverflowError extends Error {get name() {return 'OverflowError';}}

export class ReadBudget {
  // Count actual session reads, including inventory reads and retries.
  constructor({limits=DEFAULT_LIMITS,clock=()=>performance.now()/1000}={}) {
    this.limits=limits;
    this.clock=clock;
    this.started=clock();
    this.bytes=0;
    this.lines=0;
  }
  check() {
    if(this.clock()-this.started>this.limits.maxReadSeconds)throw new ValueError('Read time limit');
  }
  charge(length,newLine=true) {
    this.check();
    this.bytes+=length;
    this.lines+=length>0&&newLine?1:0;
    if(this.bytes>this.limits.maxTotalBytes||this.lines>this.limits.maxLines)throw new ValueError('Session read limit');
  }
}

export const FIELDS=['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens','total_tokens'];
export const EFFORTS=new Set(['none','minimal','low','medium','high','xhigh','max','ultra']);
export const TIERS=new Map([['default','standard'],['standard','standard'],['priority','fast'],['fast','fast']]);

// Python dictionary helpers over parsed JSON.
export const isDict=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&!(x instanceof Uint8Array);
export const has=(o,k)=>Object.hasOwn(o,k);
export const get=(o,k)=>Object.hasOwn(o,k)?o[k]:undefined;
const isNone=x=>x===null||x===undefined;
export function pyTruthy(x) {
  if(isNone(x)||x===false)return false;
  if(typeof x==='number')return x!==0;
  if(typeof x==='string'||Array.isArray(x))return x.length>0;
  if(typeof x==='object')return Object.keys(x).length>0;
  return true;
}
const pyOr=(x,fallback)=>pyTruthy(x)?x:fallback;
const unhashable=x=>Array.isArray(x)||isDict(x);
export function inEfforts(x) {
  if(unhashable(x))throw new PyTypeError('unhashable type');
  return typeof x==='string'&&EFFORTS.has(x);
}
export function tierOf(x) {
  if(unhashable(x))throw new PyTypeError('unhashable type');
  return typeof x==='string'&&TIERS.has(x)?TIERS.get(x):'unknown';
}

// Python counts code points, not UTF-16 units.
export function cpLen(text) {
  let n=text.length;
  for(let i=0;i<text.length-1;i++) {
    const c=text.charCodeAt(i);
    if(c>=0xd800&&c<0xdc00) {
      const d=text.charCodeAt(i+1);
      if(d>=0xdc00&&d<0xe000) {n--;i++;}
    }
  }
  return n;
}
// Order strings by code point, as Python does.
export function compareText(a,b) {
  if(a===b)return 0;
  const n=Math.min(a.length,b.length);
  for(let i=0;i<n;i++) {
    if(a.charCodeAt(i)!==b.charCodeAt(i)) {
      const x=a.codePointAt(i),y=b.codePointAt(i);
      return x<y?-1:x>y?1:0;
    }
  }
  return a.length-b.length;
}
const compareTuples=(a,b)=>{
  for(let i=0;i<a.length;i++) {const order=compareText(a[i],b[i]);if(order)return order;}
  return 0;
};

export function utf8(text) {
  if(!text.isWellFormed())throw new UnicodeError("'utf-8' codec can't encode surrogates");
  return Buffer.from(text,'utf8');
}
export const sha256Hex=text=>createHash('sha256').update(utf8(text)).digest('hex');

export const number=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:null;
// str.isalnum() follows the runtime's Unicode tables.
const LABEL=/^[\p{L}\p{N}\-_./:]+$/u;
export const label=x=>typeof x==='string'&&x.length>0&&cpLen(x)<=100&&LABEL.test(x)?x:'unknown';
const TOOL=/^[A-Za-z0-9_][A-Za-z0-9_.:/-]{0,199}$/;
export const toolIdentifier=(value,fallback)=>typeof value==='string'&&TOOL.test(value)?value:fallback;

// JSON with Python's extensions: NaN, Infinity and -Infinity.
export function pyLoads(text) {
  try {return JSON.parse(text);}
  catch(error) {
    if(!(error instanceof SyntaxError))throw error;
    if(!/NaN|Infinity/.test(text))throw new ValueError('Invalid JSON');
    return new ConstantParser(text).document();
  }
}
class ConstantParser {
  constructor(text) {this.s=text;this.i=0;}
  fail() {throw new ValueError('Invalid JSON');}
  ws() {while(this.i<this.s.length&&' \t\n\r'.includes(this.s[this.i]))this.i++;}
  document() {this.ws();const value=this.value();this.ws();if(this.i!==this.s.length)this.fail();return value;}
  word(text,value) {if(!this.s.startsWith(text,this.i))this.fail();this.i+=text.length;return value;}
  value() {
    const c=this.s[this.i];
    if(c==='"')return this.string();
    if(c==='{')return this.object();
    if(c==='[')return this.array();
    if(c==='n')return this.word('null',null);
    if(c==='t')return this.word('true',true);
    if(c==='f')return this.word('false',false);
    if(c==='N')return this.word('NaN',NaN);
    if(c==='I')return this.word('Infinity',Infinity);
    if(c==='-'&&this.s.startsWith('-Infinity',this.i))return this.word('-Infinity',-Infinity);
    const match=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?/y;
    match.lastIndex=this.i;
    const found=match.exec(this.s);
    if(!found)this.fail();
    this.i+=found[0].length;
    return Number(found[0]);
  }
  string() {
    // Find the closing quote, then let JSON.parse check escapes and control characters.
    let end=this.i+1;
    for(;;) {
      if(end>=this.s.length)this.fail();
      const c=this.s.charCodeAt(end);
      if(c===0x22)break;
      end+=c===0x5c?2:1;
    }
    const text=this.s.slice(this.i,end+1);
    this.i=end+1;
    try {return JSON.parse(text);}
    catch {return this.fail();}
  }
  array() {
    this.i++;this.ws();const out=[];
    if(this.s[this.i]===']') {this.i++;return out;}
    for(;;) {
      out.push(this.value());this.ws();
      const c=this.s[this.i++];
      if(c===']')return out;
      if(c!==',')this.fail();
      this.ws();
    }
  }
  object() {
    this.i++;this.ws();const out={};
    if(this.s[this.i]==='}') {this.i++;return out;}
    for(;;) {
      if(this.s[this.i]!=='"')this.fail();
      const key=this.string();this.ws();
      if(this.s[this.i++]!==':')this.fail();
      this.ws();
      Object.defineProperty(out,key,{value:this.value(),enumerable:true,writable:true,configurable:true});
      this.ws();
      const c=this.s[this.i++];
      if(c==='}')return out;
      if(c!==',')this.fail();
      this.ws();
    }
  }
}

const strictUtf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
// bytes.decode('utf-8'), which keeps a byte order mark and refuses surrogates.
export function decodeUtf8(bytes) {
  try {return strictUtf8.decode(bytes);}
  catch {throw new UnicodeError("'utf-8' codec can't decode bytes");}
}
// UTF-8 with Python's surrogatepass error handler.
function decodeUtf8Surrogates(bytes) {
  try {return strictUtf8.decode(bytes);}
  catch {}
  let out='';
  for(let i=0;i<bytes.length;) {
    const b=bytes[i];
    let cp,size;
    if(b<0x80) {cp=b;size=1;}
    else if(b>=0xc2&&b<0xe0) {cp=b&0x1f;size=2;}
    else if(b>=0xe0&&b<0xf0) {cp=b&0x0f;size=3;}
    else if(b>=0xf0&&b<0xf5) {cp=b&0x07;size=4;}
    else throw new UnicodeError('invalid start byte');
    if(i+size>bytes.length)throw new UnicodeError('unexpected end of data');
    for(let k=1;k<size;k++) {
      const c=bytes[i+k];
      if((c&0xc0)!==0x80)throw new UnicodeError('invalid continuation byte');
      cp=cp<<6|c&0x3f;
    }
    if(size===3&&cp<0x800||size===4&&(cp<0x10000||cp>0x10ffff))throw new UnicodeError('invalid continuation byte');
    out+=String.fromCodePoint(cp);
    i+=size;
  }
  return out;
}
function decodeUnits(bytes,width,little) {
  if(bytes.length%width)throw new UnicodeError('truncated data');
  let out='';
  for(let i=0;i<bytes.length;i+=width) {
    const value=width===2?(little?bytes.readUInt16LE(i):bytes.readUInt16BE(i)):(little?bytes.readUInt32LE(i):bytes.readUInt32BE(i));
    if(value>0x10ffff)throw new UnicodeError('code point not in range');
    out+=width===2?String.fromCharCode(value):String.fromCodePoint(value);
  }
  return out;
}
// json.loads(bytes), which detects UTF-16 and UTF-32 and passes surrogates.
export function pyLoadsBytes(input) {
  const b=Buffer.from(input.buffer,input.byteOffset,input.length);
  const starts=(...values)=>values.every((v,i)=>b[i]===v)&&b.length>=values.length;
  let text;
  if(starts(0,0,0xfe,0xff))text=decodeUnits(b.subarray(4),4,false);
  else if(starts(0xff,0xfe,0,0))text=decodeUnits(b.subarray(4),4,true);
  else if(starts(0xfe,0xff))text=decodeUnits(b.subarray(2),2,false);
  else if(starts(0xff,0xfe))text=decodeUnits(b.subarray(2),2,true);
  else if(starts(0xef,0xbb,0xbf))text=decodeUtf8Surrogates(b.subarray(3));
  else if(b.length>=4&&!b[0])text=decodeUnits(b,b[1]?2:4,false);
  else if(b.length>=4&&!b[1])text=decodeUnits(b,b[2]||b[3]?2:4,true);
  else if(b.length===2&&!b[0])text=decodeUnits(b,2,false);
  else if(b.length===2&&!b[1])text=decodeUnits(b,2,true);
  else text=decodeUtf8Surrogates(b);
  return pyLoads(text);
}

// json.dumps with Python's default separators and ASCII escapes.
function floatRepr(x) {
  if(Number.isNaN(x))return 'NaN';
  if(!Number.isFinite(x))return x>0?'Infinity':'-Infinity';
  if(Number.isInteger(x))return BigInt(x).toString();
  const [mantissa,exponentText]=x.toExponential().split('e');
  const exponent=Number(exponentText);
  const negative=mantissa.startsWith('-');
  const digits=mantissa.replace('-','').replace('.','');
  let body;
  if(exponent<-4||exponent>=16) {
    body=digits[0]+(digits.length>1?'.'+digits.slice(1):'')+'e'+(exponent<0?'-':'+')+String(Math.abs(exponent)).padStart(2,'0');
  } else if(exponent<0) {
    body='0.'+'0'.repeat(-exponent-1)+digits;
  } else {
    const whole=digits.slice(0,exponent+1).padEnd(exponent+1,'0');
    body=whole+'.'+(digits.slice(exponent+1)||'0');
  }
  return (negative?'-':'')+body;
}
function quote(text) {
  let out='"';
  for(let i=0;i<text.length;i++) {
    const c=text.charCodeAt(i);
    if(c===0x22)out+='\\"';
    else if(c===0x5c)out+='\\\\';
    else if(c===0x0a)out+='\\n';
    else if(c===0x0d)out+='\\r';
    else if(c===0x09)out+='\\t';
    else if(c===0x08)out+='\\b';
    else if(c===0x0c)out+='\\f';
    else if(c<0x20||c>0x7e)out+='\\u'+c.toString(16).padStart(4,'0');
    else out+=text[i];
  }
  return out+'"';
}
export function pyDumps(value,{allowNan=true}={}) {
  if(isNone(value))return 'null';
  if(value===true)return 'true';
  if(value===false)return 'false';
  if(typeof value==='number') {
    if(!allowNan&&!Number.isFinite(value))throw new ValueError('Out of range float values are not JSON compliant');
    return floatRepr(value);
  }
  if(typeof value==='string')return quote(value);
  if(Array.isArray(value))return '['+value.map(v=>pyDumps(v,{allowNan})).join(', ')+']';
  return '{'+Object.keys(value).map(k=>quote(k)+': '+pyDumps(value[k],{allowNan})).join(', ')+'}';
}
// Python == over parsed JSON values.
export function pyEqual(a,b) {
  const numeric=x=>typeof x==='boolean'?Number(x):x;
  a=numeric(a);b=numeric(b);
  if(isNone(a)||isNone(b))return isNone(a)&&isNone(b);
  if(typeof a==='number'||typeof b==='number')return a===b;
  if(typeof a==='string'||typeof b==='string')return a===b;
  if(Array.isArray(a)||Array.isArray(b))
    return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>pyEqual(v,b[i]));
  if(!isDict(a)||!isDict(b))return false;
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length&&keys.every(k=>has(b,k)&&pyEqual(a[k],b[k]));
}

// datetime.fromisoformat from CPython 3.9, ported over the UTF-8 bytes.
function digitsAt(b,at,count) {
  let value=0;
  for(let k=0;k<count;k++) {
    const d=(b[at+k]??0)-48;
    if(d<0||d>9)return null;
    value=value*10+d;
  }
  return value;
}
function parseClock(b,start,end) {
  // Returns [code, values, next] like parse_hh_mm_ss_ff.
  const values=[0,0,0,0];
  let p=start;
  for(let i=0;i<3;i++) {
    const value=digitsAt(b,p,2);
    if(value===null)return [-3,values];
    values[i]=value;
    p+=2;
    const c=b[p++]??0;
    if(p>=end)return [c!==0?1:0,values];
    if(c===0x3a)continue;
    if(c===0x2e)break;
    return [-4,values];
  }
  // CPython also reaches the fraction after a third colon.
  const remains=end-p;
  if(remains!==6&&remains!==3)return [-3,values];
  const micro=digitsAt(b,p,remains);
  if(micro===null)return [-3,values];
  values[3]=remains===3?micro*1000:micro;
  return [(b[p+remains]??0)!==0?1:0,values];
}
const DAYS=[31,28,31,30,31,30,31,31,30,31,30,31];
const leap=y=>y%4===0&&(y%100!==0||y%400===0);
export function parseIsoformat(text) {
  // The separator may be any character, including a surrogate.
  let index=0,count=0;
  while(count<10&&index<text.length) {index+=text.codePointAt(index)>0xffff?2:1;count++;}
  if(count===10&&index<text.length) {
    const c=text.charCodeAt(index);
    if(c>=0xd800&&c<0xe000&&!(c<0xdc00&&(text.charCodeAt(index+1)&0xfc00)===0xdc00))
      text=text.slice(0,index)+'T'+text.slice(index+1);
  }
  if(!text.isWellFormed())throw new ValueError('Invalid isoformat string');
  const b=Buffer.from(text,'utf8');
  const len=b.length;
  const year=digitsAt(b,0,4),month=digitsAt(b,5,2),day=digitsAt(b,8,2);
  if(year===null||month===null||day===null||b[4]!==0x2d||b[7]!==0x2d)throw new ValueError('Invalid isoformat string');
  let clock=[0,0,0,0],tz=null;
  if(len>10) {
    const lead=b[10];
    const p=(lead&0x80)===0?11:(lead&0xf0)===0xe0?13:(lead&0xf0)===0xf0?14:12;
    const end=len;
    let tzAt=p;
    do {if(b[tzAt]===0x2b||b[tzAt]===0x2d)break;} while(++tzAt<end);
    const [code,values]=parseClock(b,p,tzAt);
    if(code<0)throw new ValueError('Invalid isoformat string');
    clock=values;
    if(tzAt===end) {
      if(code===1)throw new ValueError('Invalid isoformat string');
    } else {
      const tzlen=end-tzAt;
      if(tzlen!==6&&tzlen!==9&&tzlen!==16)throw new ValueError('Invalid isoformat string');
      const sign=b[tzAt]===0x2d?-1:1;
      const [tzCode,tzValues]=parseClock(b,tzAt+1,end);
      if(tzCode!==0)throw new ValueError('Invalid isoformat string');
      const seconds=sign*(tzValues[0]*3600+tzValues[1]*60+tzValues[2]);
      const micros=sign*tzValues[3];
      if(seconds===0)tz={seconds:0,micros:0};
      else {
        const total=seconds*1e6+micros;
        if(total<=-86400e6||total>=86400e6)throw new ValueError('offset must be a timedelta strictly between -timedelta(hours=24) and timedelta(hours=24)');
        tz={seconds,micros};
      }
    }
  }
  const [hour,minute,second,microsecond]=clock;
  if(year<1||month<1||month>12||day<1||day>(month===2&&leap(year)?29:DAYS[month-1])||hour>23||minute>59||second>59)
    throw new ValueError('Invalid isoformat string');
  return {year,month,day,hour,minute,second,microsecond,tz};
}
const pad=(n,w=2)=>String(n).padStart(w,'0');
export function isoformat(stamp) {
  let out=`${pad(stamp.year,4)}-${pad(stamp.month)}-${pad(stamp.day)}T${pad(stamp.hour)}:${pad(stamp.minute)}:${pad(stamp.second)}`;
  if(stamp.microsecond)out+='.'+pad(stamp.microsecond,6);
  if(stamp.tz) {
    let total=stamp.tz.seconds*1e6+stamp.tz.micros;
    const sign=total<0?'-':'+';
    total=Math.abs(total);
    const micros=total%1e6,seconds=Math.floor(total/1e6);
    out+=`${sign}${pad(Math.floor(seconds/3600))}:${pad(Math.floor(seconds/60)%60)}`;
    if(micros)out+=`:${pad(seconds%60)}.${pad(micros,6)}`;
    else if(seconds%60)out+=`:${pad(seconds%60)}`;
  }
  return out;
}
function daysFromCivil(y,m,d) {
  y-=m<=2?1:0;
  const era=Math.floor(y/400),yoe=y-era*400;
  const doy=Math.floor((153*(m+(m>2?-3:9))+2)/5)+d-1;
  return era*146097+yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy-719468;
}
function civilFromDays(z) {
  z+=719468;
  const era=Math.floor(z/146097),doe=z-era*146097;
  const yoe=Math.floor((doe-Math.floor(doe/1460)+Math.floor(doe/36524)-Math.floor(doe/146096))/365);
  const doy=doe-(365*yoe+Math.floor(yoe/4)-Math.floor(yoe/100));
  const mp=Math.floor((5*doy+2)/153);
  const m=mp+(mp<10?3:-9);
  return [yoe+era*400+(m<=2?1:0),m,doy-Math.floor((153*mp+2)/5)+1];
}
const MIN_MICROS=BigInt(daysFromCivil(1,1,1)*86400)*1000000n;
const MAX_MICROS=BigInt(daysFromCivil(9999,12,31)*86400+86399)*1000000n+999999n;
const floorSeconds=micros=>{const q=micros/1000000n;return Number(micros%1000000n<0n?q-1n:q);};
// UTC microseconds since 1970 for an aware stamp, or OverflowError as astimezone raises.
export function utcMicros(stamp) {
  const local=BigInt(daysFromCivil(stamp.year,stamp.month,stamp.day)*86400+stamp.hour*3600+stamp.minute*60+stamp.second)*1000000n+BigInt(stamp.microsecond);
  const utc=local-BigInt(stamp.tz.seconds)*1000000n-BigInt(stamp.tz.micros);
  if(utc<MIN_MICROS||utc>MAX_MICROS)throw new OverflowError('date value out of range');
  return utc;
}
const newYorkFormat=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'longOffset'});
const newYorkOffsets=new Map();
// Transitions in this zone fall on whole UTC hours, so one lookup serves an hour.
function newYorkOffset(seconds) {
  const hour=Math.floor(seconds/3600);
  let offset=newYorkOffsets.get(hour);
  if(offset===undefined) {
    const name=newYorkFormat.formatToParts(new Date(hour*3600*1000)).find(part=>part.type==='timeZoneName').value;
    const match=/^GMT(?:([+-])(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(name);
    if(!match)throw Error('Unsupported time zone data');
    offset=match[1]?(match[1]==='-'?-1:1)*(Number(match[2])*3600+Number(match[3])*60+Number(match[4]??0)):0;
    if(newYorkOffsets.size>100_000)newYorkOffsets.clear();
    newYorkOffsets.set(hour,offset);
  }
  return offset;
}
function newYorkDay(utc) {
  const local=utc+BigInt(newYorkOffset(floorSeconds(utc)))*1000000n;
  if(local<MIN_MICROS||local>MAX_MICROS)throw new OverflowError('date value out of range');
  const seconds=floorSeconds(local);
  const days=Math.floor(seconds/86400);
  const [y,m,d]=civilFromDays(days);
  return {date:`${pad(y,4)}-${pad(m)}-${pad(d)}`,hour:Math.floor((seconds-days*86400)/3600)};
}

export function inventoryMetadata(meta,salt) {
  // Ephemeral comparison keys only. The collector never saves these keys.
  const payload=isDict(meta)&&get(meta,'type')==='session_meta'?(has(meta,'payload')?meta.payload:{}):{};
  if(!isDict(payload))return null;
  const keys=values=>values.filter(value=>typeof value==='string'&&value.length>0&&cpLen(value)<=128)
    .map(value=>createHmac('sha256',utf8(salt)).update(utf8(value)).digest('hex'));
  const owned=keys([get(payload,'id'),get(payload,'session_id')]);
  const parents=keys([get(payload,'forked_from_id'),get(payload,'parent_thread_id')]);
  return owned.length?{keys:owned,parents}:null;
}

let distinctTurns=0;
function turnIdentity(value) {
  if(typeof value==='string')return 's'+value;
  if(typeof value==='boolean')return 'n'+Number(value);
  // Each parsed NaN is a distinct object in Python, equal only to itself.
  if(typeof value==='number')return Number.isNaN(value)?'x'+ ++distinctTurns:'n'+String(value);
  return null;
}
const cutoffMicros=cutoff=>typeof cutoff==='bigint'?cutoff:BigInt(cutoff.getTime())*1000n;
const TOKEN_ROW=['inputTokens','cacheReadTokens','cacheCreationTokens','outputTokens','reasoningOutputTokens','totalTokens'];

export function summarize(events,cutoff,{retained=null,seen=null,hourTotals=null,readBudget=null}={}) {
  cutoff=cutoffMicros(cutoff);
  let model='unknown',effort='unknown',speed='unknown';
  let contextModel=null;
  let selectedModel='unknown';
  let selectedSpeed='unknown';
  let prior=null;
  let turnKey=null,turnKeyIdentity=null;
  const profiles=new Map(),tools=new Map();
  const seenCalls=new Set();
  for(const event of events) {
    readBudget?.check();
    if(!isDict(event))throw new AttributeError('event has no get');
    const p=pyOr(get(event,'payload'),{});
    if(!isDict(p))continue;
    if(get(p,'type')==='thread_settings_applied') {
      const s=pyOr(get(p,'thread_settings'),{});
      if(!isDict(s))continue;
      const nextSelected=has(s,'model')?label(s.model):selectedModel;
      if(nextSelected!==selectedModel)selectedSpeed='unknown';
      selectedModel=nextSelected;
      if(has(s,'service_tier'))selectedSpeed=tierOf(s.service_tier);
      // A newly selected model does not relabel the preceding turn.
      if(contextModel===null)model=selectedModel;
      if(selectedModel===model) {
        if(has(s,'reasoning_effort'))effort=inEfforts(s.reasoning_effort)?s.reasoning_effort:'unknown';
        if(has(s,'service_tier'))speed=tierOf(s.service_tier);
      } else speed='unknown';
    }
    if(get(event,'type')==='turn_context') {
      const turnId=get(p,'turn_id');
      const usageKey=get(p,'usage_turn_key');
      turnKey=pyTruthy(usageKey)?usageKey:typeof turnId==='string'?sha256Hex(turnId):null;
      turnKeyIdentity=isNone(turnKey)?null:turnIdentity(turnKey);
      const nextModel=label(get(p,'model'));
      if(nextModel!==model)speed='unknown';
      model=nextModel;
      contextModel=model;
      if(model===selectedModel)speed=selectedSpeed;
      effort=inEfforts(get(p,'effort'))?p.effort:'unknown';
      if(has(p,'service_tier'))speed=tierOf(p.service_tier);
    }
    if(!has(event,'timestamp'))continue;
    if(typeof event.timestamp!=='string')throw new AttributeError("timestamp has no attribute 'replace'");
    let stamp;
    try {stamp=parseIsoformat(event.timestamp.replaceAll('Z','+00:00'));}
    catch(error) {if(error instanceof ValueError)continue;throw error;}
    // A stamp without an offset fails when compared with the cutoff, as in Python.
    const utc=stamp.tz?utcMicros(stamp):null;
    const local=utc===null?{date:'',hour:0}:newYorkDay(utc);
    const date=local.date;
    const atOrAfterCutoff=()=>{
      if(utc===null)throw new PyTypeError("can't compare offset-naive and offset-aware datetimes");
      return utc>=cutoff;
    };
    if(get(event,'type')==='response_item'&&['function_call','custom_tool_call'].includes(get(p,'type'))) {
      const callId=get(p,'call_id');
      if(typeof callId!=='string'||seenCalls.has(callId))continue;
      seenCalls.add(callId);
      const tool=toolIdentifier(get(p,'name'),'Unknown tool');
      const namespace=toolIdentifier(get(p,'namespace'),'');
      if(namespace==='history'||namespace==='notes'||['history.','notes.','history__','notes__'].some(prefix=>tool.startsWith(prefix)))continue;
      const name=tool.toLowerCase();
      const category=['exec_command','write_stdin','shell'].some(x=>name.includes(x))?'Shell':name.includes('apply_patch')?'File edits':
        ['browser','cua'].some(x=>name.includes(x))?'Browser':['web','search'].some(x=>name.includes(x))?'Research':'Other tools';
      if(atOrAfterCutoff()) {
        const key=JSON.stringify([date,category,tool,namespace]);
        const row=tools.get(key);
        if(row)row.count+=1;
        else tools.set(key,{date,category,tool,namespace,count:1});
      }
    }
    if(get(event,'type')!=='event_msg'||get(p,'type')!=='token_count')continue;
    const info=()=>{
      const value=pyOr(get(p,'info'),{});
      if(!isDict(value))throw new AttributeError("info has no attribute 'get'");
      return value;
    };
    const raw=get(info(),'total_token_usage');
    if(!isDict(raw))continue;
    const counters=source=>FIELDS.map(k=>number(has(source,k)?source[k]:k==='cache_write_input_tokens'?0:null));
    const current=counters(raw);
    if(current.some(isNone))continue;
    const repeated=prior!==null&&current.every((v,i)=>v===prior[i]);
    let delta=current.map((v,i)=>v-(prior?prior[i]:0));
    prior=current;
    if(repeated)continue;
    // Match the daily reader: use the recorded request counters when the
    // cumulative counter advances. Deltas alone can lose usage after resets.
    const last=get(info(),'last_token_usage');
    if(isDict(last)) {
      delta=counters(last);
      if(delta.some(isNone))continue;
    }
    const [input,cachedInput,cacheWrite,output,reasoning,total]=delta;
    if(delta.some(v=>v<0)||total===0)continue;
    // Codex input includes cache reads and writes. Output includes reasoning.
    const uncached=input-cachedInput-cacheWrite;
    if(uncached<0||Math.abs(input+output-total)>1)continue;
    // Copies inherited by related sessions count once. Each file still
    // advances its own cumulative baseline before this shared check.
    if(seen!==null&&!isNone(turnKey)) {
      if(turnKeyIdentity===null)throw new PyTypeError('unhashable type');
      const identity=JSON.stringify([turnKeyIdentity,isoformat(stamp),model,effort,speed,current,delta]);
      if(seen.has(identity))continue;
      seen.add(identity);
    }
    if(hourTotals!==null) {
      if(!hourTotals.has(date))hourTotals.set(date,Array(24).fill(0));
      hourTotals.get(date)[local.hour]+=total;
    }
    const key=JSON.stringify([date,model,effort,speed]);
    const destinations=[...(retained!==null?[retained]:[]),...(atOrAfterCutoff()?[profiles]:[])];
    const values=[uncached,cachedInput,cacheWrite,output,reasoning,total];
    for(const destination of destinations) {
      if(!destination.has(key))destination.set(key,{date,model,effort,speed,inputTokens:0,cacheReadTokens:0,cacheCreationTokens:0,outputTokens:0,reasoningOutputTokens:0,totalTokens:0});
      const row=destination.get(key);
      TOKEN_ROW.forEach((field,i)=>{row[field]+=values[i];});
    }
  }
  return [[...profiles.values()],[...tools.values()]];
}

// Buffered readline(limit) over a file descriptor.
export class LineReader {
  constructor(fd) {this.fd=fd;this.buffer=Buffer.alloc(0);this.position=0;this.ended=false;}
  fill() {
    const chunk=Buffer.allocUnsafe(1<<20);
    const count=fs.readSync(this.fd,chunk,0,chunk.length,null);
    if(count===0)this.ended=true;
    this.buffer=chunk.subarray(0,count);
    this.position=0;
  }
  readline(limit) {
    const parts=[];
    let total=0;
    while(total<limit) {
      if(this.position>=this.buffer.length) {
        if(this.ended)break;
        this.fill();
        if(this.ended)break;
      }
      const end=Math.min(this.buffer.length,this.position+limit-total);
      const newline=this.buffer.indexOf(10,this.position);
      if(newline!==-1&&newline<end) {
        parts.push(this.buffer.subarray(this.position,newline+1));
        total+=newline+1-this.position;
        this.position=newline+1;
        break;
      }
      parts.push(this.buffer.subarray(this.position,end));
      total+=end-this.position;
      this.position=end;
    }
    return parts.length===1?parts[0]:Buffer.concat(parts,total);
  }
}
export function openForReading(file) {
  const fd=fs.openSync(file,'r');
  if(fs.fstatSync(fd).isDirectory()) {
    fs.closeSync(fd);
    throw Object.assign(new Error(`Is a directory: '${file}'`),{code:'EISDIR'});
  }
  return fd;
}

function* fileEvents(file,readBudget,limits) {
  const fd=openForReading(file);
  try {
    const reader=new LineReader(fd);
    let skipping=false;
    for(;;) {
      readBudget.check();
      const line=reader.readline(limits.maxLineBytes+1);
      if(!line.length)break;
      readBudget.charge(line.length,!skipping);
      if(skipping||line.length>limits.maxLineBytes) {
        skipping=line.at(-1)!==10;
        continue;
      }
      const text=decodeUtf8(line);
      let row;
      try {row=pyLoads(text);}
      catch(error) {if(error instanceof ValueError)continue;throw error;}
      if(isDict(row))yield row;
    }
  } finally {fs.closeSync(fd);}
}

function summarizeSessions(sessions,cutoff,cache,lineages,readBudget,limits) {
  const profiles=new Map(),tools=new Map(),retained=new Map(),seen=new Map(),hourTotals=new Map();
  for(const identity of [...sessions.keys()].sort(compareText)) {
    const {file,info}=sessions.get(identity);
    const root=lineages.get(identity);
    if(!seen.has(root))seen.set(root,new Set());
    const [rows,calls]=summarize(cache?cache.events(file,info):fileEvents(file,readBudget,limits),cutoff,
      {retained,seen:seen.get(root),hourTotals,readBudget});
    for(const row of rows) {
      const key=JSON.stringify([row.date,row.model,row.effort,row.speed]);
      if(!profiles.has(key))profiles.set(key,row);
      else for(const field of TOKEN_ROW)profiles.get(key)[field]+=row[field];
    }
    for(const row of calls) {
      const key=[row.date,row.category,row.tool,row.namespace];
      const id=JSON.stringify(key);
      const saved=tools.get(id);
      if(saved)saved.count+=row.count;
      else tools.set(id,{key,count:row.count});
    }
  }
  return {profiles,tools,retained,hourTotals};
}

const windows=process.platform==='win32';
const realpath=windows?fs.realpathSync.native:fs.realpathSync;
const permissionDenied=error=>error?.code==='EACCES'||error?.code==='EPERM';
function listDirectory(directory) {
  // Keep the file system's own order, as os.scandir does.
  const handle=fs.opendirSync(directory);
  const entries=[];
  try {for(let entry;(entry=handle.readSync())!==null;)entries.push(entry);}
  finally {handle.closeSync();}
  return entries;
}
// Path.rglob('*.jsonl') from Python 3.9: files of a folder, then its real subfolders.
function* sessionFiles(start) {
  try {if(!fs.statSync(start).isDirectory())return;}
  catch {return;}
  function* walk(directory) {
    let entries;
    try {entries=listDirectory(directory);}
    catch(error) {if(permissionDenied(error))return;throw error;}
    for(const entry of entries) {
      const name=windows?entry.name.toLowerCase():entry.name;
      if(name.endsWith('.jsonl'))yield path.join(directory,entry.name);
    }
    for(const entry of entries)if(entry.isDirectory())yield* walk(path.join(directory,entry.name));
  }
  yield* walk(start);
}
function within(file,root) {
  const fold=text=>windows?text.toLowerCase():text;
  const base=root.endsWith(path.sep)?root:root+path.sep;
  return fold(file).startsWith(fold(base));
}

function collect(folder,options,{retryCache=true,cacheBudget=null,readBudget=null}={}) {
  const {limits,now,inventorySalt:salt,cacheDirectory,cacheScanBudget,cacheClass}=options;
  readBudget??=new ReadBudget({limits,clock:options.clock});
  readBudget.check();
  const root=realpath(folder);
  const cutoff=BigInt((now??new Date()).getTime())*1000n-8n*86400n*1000000n;
  const candidates=[];
  for(const name of ['sessions','archived_sessions']) {
    for(const file of sessionFiles(path.join(root,name))) {
      readBudget.check();
      candidates.push(file);
      if(candidates.length>limits.maxFiles)throw new ValueError('Too many files');
    }
  }
  const sessions=new Map(),lineages=new Map(),selectedMetadata=new Map();
  const lineage=identity=>{
    if(!lineages.has(identity))lineages.set(identity,identity);
    while(lineages.get(identity)!==identity) {
      lineages.set(identity,lineages.get(lineages.get(identity)));
      identity=lineages.get(identity);
    }
    return identity;
  };
  const inventory={status:'ok',keys:new Set(),parents:new Set()};
  for(const file of candidates) {
    readBudget.check();
    if(fs.lstatSync(file).isSymbolicLink()||!within(realpath(file),root)) {
      inventory.status='incomplete';
      continue;
    }
    const info=fs.statSync(file,{bigint:true});
    const fd=openForReading(file);
    let first;
    try {first=new LineReader(fd).readline(limits.firstLineBytes);}
    finally {fs.closeSync(fd);}
    readBudget.charge(first.length);
    let meta;
    if(first.length>=limits.firstLineBytes&&first.at(-1)!==10) {
      // Longer than the earlier 1,000,000 character limit allows, so unparseable as before.
      meta={};
    } else {
      // A complete line with invalid UTF-8 still fails the whole read, as before.
      const text=decodeUtf8(first);
      try {meta=pyLoads(text);}
      catch(error) {if(!(error instanceof ValueError))throw error;meta={};}
    }
    const payload=isDict(meta)&&get(meta,'type')==='session_meta'?get(meta,'payload'):null;
    let identity=isDict(payload)?get(payload,'id'):null;
    if(typeof identity!=='string'||!identity)inventory.status='incomplete';
    if(pyTruthy(salt)) {
      const metadata=inventoryMetadata(meta,salt);
      if(metadata) {
        for(const key of metadata.keys)inventory.keys.add(key);
        for(const key of metadata.parents)inventory.parents.add(key);
      } else inventory.status='incomplete';
    }
    identity=typeof identity==='string'&&identity?identity:file;
    if(!sessions.has(identity)||info.size>sessions.get(identity).info.size) {
      sessions.set(identity,{file,info});
      selectedMetadata.set(identity,isDict(payload)?payload:{});
    }
  }
  for(const [identity,payload] of selectedMetadata) {
    readBudget.check();
    lineage(identity);
    for(const parent of [get(payload,'forked_from_id'),get(payload,'parent_thread_id')]) {
      if(typeof parent==='string'&&parent) {
        const target=lineage(parent);
        lineages.set(lineage(identity),target);
      }
    }
  }
  const budget=cacheBudget??cacheScanBudget??limits.maxTotalBytes;
  const cache=pyTruthy(cacheDirectory)?new cacheClass(cacheDirectory,budget,{limits}):null;
  if(cache)cache.readBudget=readBudget;
  let completed=false;
  let summary;
  try {
    summary=summarizeSessions(sessions,cutoff,cache,new Map([...sessions.keys()].map(identity=>[identity,lineage(identity)])),readBudget,limits);
    completed=true;
  } finally {
    cache?.close({completed});
  }
  if(cache?.pending) {
    // Rebuild metadata and inventory after a transient file change. A
    // second attempt shares the original byte budget and never returns
    // an incomplete first-pass total as a successful report.
    if(retryCache&&cache.remaining>0)return collect(folder,options,{retryCache:false,cacheBudget:cache.remaining,readBudget});
    throw new ValueError('Private Codex cache warming; complete report unavailable');
  }
  const {profiles,tools,retained,hourTotals}=summary;
  const result={status:'ok',profiles:[...profiles.values()],tokenProfiles:[...retained.values()],
    hourTotals:[...hourTotals.keys()].sort(compareText).map(date=>({date,hours:hourTotals.get(date)})),
    tools:[...tools.values()].sort((a,b)=>compareTuples(a.key,b.key))
      .map(({key:[date,category,tool,namespace],count})=>({date,category,tool,namespace,count})),
    scope:'Recent saved Codex logs only'};
  if(pyTruthy(salt))result.inventory={status:inventory.status,keys:[...inventory.keys].sort(compareText),parents:[...inventory.parents].sort(compareText)};
  readBudget.check();
  return result;
}

export async function collectSettings(codexFolder,{cacheDirectory=null,now=new Date(),inventorySalt=null,cacheScanBudget=null,
  limits={},clock,cacheClass=SettingsCache,readBudget=null}={}) {
  return collect(codexFolder,{cacheDirectory,now,inventorySalt,cacheScanBudget,limits:readerLimits(limits),clock,cacheClass},{readBudget});
}

export async function main(argv=process.argv.slice(2),options={}) {
  const [folder,cacheDirectory=null]=argv;
  if(!folder)throw new ValueError('Usage: read-settings.mjs <codexFolder> [cacheDirectory]');
  const result=await collectSettings(folder,{...options,cacheDirectory});
  // Python refuses NaN and infinity in the printed report.
  process.stdout.write(pyDumps(result,{allowNan:false})+'\n');
}

const invoked=(()=>{
  try {return Boolean(process.argv[1])&&import.meta.url===pathToFileURL(fs.realpathSync(process.argv[1])).href;}
  catch {return false;}
})();
if(invoked) {
  main().catch(error=>{
    process.stderr.write(`${error?.name??'Error'}: ${error?.message??error}\n`);
    process.exitCode=1;
  });
}
