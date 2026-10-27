import {spawn} from '../lib/cycle-processes.mjs';
import {lstat} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const lines={five_hour:/^Current session: (\d{1,3})% used(?: · resets (.+))?$/m,seven_day:/^Current week \(all models\): (\d{1,3})% used(?: · resets (.+))?$/m};

function offsetMinutes(instant,timeZone) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',
    hour:'numeric',minute:'numeric',second:'numeric'}).formatToParts(new Date(instant)).map(part=>[part.type,Number(part.value)]));
  return (Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second)-Math.floor(instant/1000)*1000)/60000;
}

// Accept both ICU date separators.
export function parseResetTime(text,now=Date.now()) {
  const match=/^([A-Z][a-z]{2}) (\d{1,2})(?:, (\d{4}))?(?: at |, )(\d{1,2})(?::(\d{2}))?[ \u202f]?(am|pm|AM|PM) \(([A-Za-z0-9_+/-]{1,64})\)$/.exec(text ?? '');
  if(!match)return null;
  const month=months.indexOf(match[1]),day=Number(match[2]),minute=Number(match[5] ?? 0),zone=match[7];
  let hour=Number(match[4]);
  if(month<0 || day<1 || day>31 || hour<1 || hour>12 || minute>59)return null;
  hour=hour%12+(match[6].toLowerCase()==='pm'?12:0);
  try {
    const calendar=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'numeric',day:'numeric'});
    // A date without a year is in the current year of its printed time zone because Claude Code prints the year otherwise.
    const year=match[3]===undefined?Number(calendar.formatToParts(new Date(now)).find(part=>part.type==='year').value):Number(match[3]);
    let instant=Date.UTC(year,month,day,hour,minute);
    for(let pass=0;pass<2;pass++)instant=Date.UTC(year,month,day,hour,minute)-offsetMinutes(instant,zone)*60000;
    const date=Object.fromEntries(calendar.formatToParts(new Date(instant)).map(part=>[part.type,Number(part.value)]));
    if(date.year!==year || date.month!==month+1 || date.day!==day)return null;
    if(instant>now-86400000 && instant<now+9*86400000)return Math.round(instant/1000);
  } catch {return null;}
  return null;
}

export function parseClaudeUsage(envelope,now=Date.now()) {
  if(!envelope || typeof envelope!=='object' || envelope.is_error!==false || envelope.num_turns!==0 || envelope.total_cost_usd!==0 ||
    envelope.local_command!=='usage' || typeof envelope.result!=='string' || envelope.result.length>20000)return null;
  const rate_limits={};
  for(const [name,pattern] of Object.entries(lines)) {
    const match=pattern.exec(envelope.result);
    if(!match)continue;
    const used=Number(match[1]),resets=parseResetTime(match[2],now);
    if(used>100 || resets===null || resets<=Math.floor(now/1000))continue;
    rate_limits[name]={used_percentage:used,resets_at:resets};
  }
  return Object.keys(rate_limits).length?{rate_limits}:null;
}

export async function findClaude(environment=process.env,platform=process.platform) {
  const names=platform==='win32'?['claude.exe']:['claude'];
  const folders=[...(environment.PATH ?? '').split(path.delimiter),path.join(homedir(),'.local/bin'),path.join(homedir(),'.claude/local'),
    ...(platform==='win32'?[]:['/opt/homebrew/bin','/usr/local/bin'])].filter(folder=>path.isAbsolute(folder));
  for(const folder of folders)for(const name of names) {
    const file=path.join(folder,name);
    try {if((await lstat(file)).isDirectory())continue;return file;}catch{}
  }
  return null;
}

const keep={
  posix:['HOME','USER','LOGNAME','SHELL','PATH','TMPDIR','LANG','LC_ALL','CLAUDE_CONFIG_DIR'],
  win32:['SystemRoot','SystemDrive','USERPROFILE','HOMEDRIVE','HOMEPATH','USERNAME','APPDATA','LOCALAPPDATA','TEMP','TMP','PATH','Path','PATHEXT','COMSPEC','CLAUDE_CONFIG_DIR'],
};

// A collector started from
// another Claude session inherits that session's variables, and passing them
// on made the command hang.
export function usageEnvironment(source=process.env,platform=process.platform) {
  const result={};
  for(const name of platform==='win32'?keep.win32:keep.posix)if(typeof source[name]==='string')result[name]=source[name];
  return result;
}

function forceStop(child,platform) {
  try {
    if(platform==='win32' && child.pid)spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true}).on('error',()=>{}).unref();
    else child.kill('SIGKILL');
  } catch {}
}

function runBounded(executable,args,{cwd,timeoutMs,environment,platform}) {
  return new Promise(resolve=>{
    let output='',bytes=0,done=false,child;
    const finish=ending=>{
      if(done)return;done=true;clearTimeout(timer);
      if(ending!=='read' && child) {forceStop(child,platform);child.stdout?.destroy();child.unref();}
      resolve({output:ending==='read'?output:null,ending});
    };
    const timer=setTimeout(()=>finish('timed-out'),timeoutMs);
    try {child=spawn(executable,args,{cwd,env:environment,stdio:['ignore','pipe','ignore'],windowsHide:true});}
    catch {finish('failed');return;}
    child.once('error',()=>finish('failed'));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',text=>{output+=text;bytes+=Buffer.byteLength(text);if(bytes>1024*1024)finish('failed');});
    child.once('close',(code,signal)=>finish(code===0 && !signal?'read':'failed'));
  });
}

export async function readClaudeUsage({cwd,now=Date.now(),find=findClaude,timeoutMs=15000,environment=usageEnvironment(),platform=process.platform}={}) {
  if(typeof cwd!=='string' || !path.isAbsolute(cwd))return {status:'failed',usage:null};
  try {
    const executable=await find();
    if(!executable)return {status:'not-found',usage:null};
    const {output,ending}=await runBounded(executable,['-p','/usage','--output-format','json','--no-session-persistence'],{cwd,timeoutMs,environment,platform});
    if(ending!=='read')return {status:ending,usage:null};
    let usage=null;
    try {usage=parseClaudeUsage(JSON.parse(output),now);}catch {}
    return {status:usage?'read':'unrecognized',usage};
  } catch {return {status:'failed',usage:null};}
}

