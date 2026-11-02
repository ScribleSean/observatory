import {spawn} from '../lib/cycle-processes.mjs';
import {access,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {isProtectedFolder} from '../lib/protected-folders.mjs';
import path from 'node:path';

const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const lines={five_hour:/^Current session: (\d{1,3})% used(?: · resets (.+))?$/m,seven_day:/^Current week \(all models\): (\d{1,3})% used(?: · resets (.+))?$/m};

function offsetMinutes(instant,timeZone) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',
    hour:'numeric',minute:'numeric',second:'numeric'}).formatToParts(new Date(instant)).map(part=>[part.type,Number(part.value)]));
  return (Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second)-Math.floor(instant/1000)*1000)/60000;
}

function wallTime(instant,timeZone) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',
    hour:'numeric',minute:'numeric'}).formatToParts(new Date(instant)).map(part=>[part.type,Number(part.value)]));
  return Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute);
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
    // Offsets run from -12h to +14h, so the zone's offset 15h before and 13h after the wall time
    // brackets any change. When clocks go back, a wall time in the repeated hour matches two
    // instants, and the reading would be an hour off, so refuse it.
    const wall=Date.UTC(year,month,day,hour,minute);
    if(new Date(wall).getUTCDate()!==day)return null;
    const matches=[...new Set([wall-15*3600000,wall+13*3600000].map(guess=>wall-offsetMinutes(guess,zone)*60000))]
      .filter(candidate=>wallTime(candidate,zone)===wall);
    if(matches.length!==1)return null;
    const instant=matches[0];
    if(instant>now-86400000 && instant<now+9*86400000)return Math.round(instant/1000);
  } catch {return null;}
  return null;
}

export function parseClaudeUsage(envelope,now=Date.now()) {
  if(!envelope || typeof envelope!=='object' || envelope.is_error!==false || envelope.num_turns!==0 || envelope.total_cost_usd!==0 ||
    envelope.local_command!=='usage' || typeof envelope.result!=='string' || envelope.result.length>20000)return null;
  const rate_limits={},notReported=[];
  for(const [name,pattern] of Object.entries(lines)) {
    const match=pattern.exec(envelope.result);
    // Claude Code leaves a line out when the account has no such limit right now.
    if(!match) {notReported.push(name);continue;}
    const used=Number(match[1]),resets=parseResetTime(match[2],now);
    if(used>100 || resets===null || resets<=Math.floor(now/1000))continue;
    rate_limits[name]={used_percentage:used,resets_at:resets};
  }
  return Object.keys(rate_limits).length?{rate_limits,notReported}:null;
}

// Without a subscription sign-in, /usage prints the session cost summary instead of plan limits.
export const signedOut=envelope=>envelope?.is_error===false && envelope.local_command==='usage' && typeof envelope.result==='string' &&
  /^Total cost: /m.test(envelope.result) && !Object.values(lines).some(pattern=>pattern.test(envelope.result));

// On Windows only the installers' own folders are searched, not PATH, because a claude.exe in a
// folder another program added to PATH would otherwise run every five minutes.
export async function findClaude(environment=process.env,platform=process.platform,home=homedir()) {
  let candidates;
  if(platform==='win32') {
    const local=environment.LOCALAPPDATA;
    candidates=[path.win32.join(home,'.local','bin','claude.exe'),
      ...(typeof local==='string' && path.win32.isAbsolute(local)?[path.win32.join(local,'Microsoft','WinGet','Links','claude.exe')]:[])];
  } else {
    candidates=[...(environment.PATH ?? '').split(path.delimiter),path.join(home,'.local/bin'),path.join(home,'.claude/local'),'/opt/homebrew/bin','/usr/local/bin']
      .filter(folder=>path.isAbsolute(folder) && !isProtectedFolder(folder)).map(folder=>path.join(folder,'claude'));
  }
  for(const file of candidates) {
    try {
      if(!(await stat(file)).isFile())continue;
      if(platform!=='win32')await access(file,constants.X_OK);
      return file;
    } catch {}
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

// Only the project settings of the empty limits folder load, so the user's own hooks,
// plugins and MCP servers do not run under Observatory's name every five minutes.
export const USAGE_ARGUMENTS=Object.freeze(['-p','/usage','--output-format','json','--no-session-persistence','--setting-sources','project','--strict-mcp-config']);

export async function readClaudeUsage({cwd,now=Date.now(),find=findClaude,timeoutMs=15000,environment=usageEnvironment(),platform=process.platform}={}) {
  if(typeof cwd!=='string' || !path.isAbsolute(cwd))return {status:'failed',usage:null};
  try {
    const executable=await find();
    if(!executable)return {status:'not-found',usage:null};
    const {output,ending}=await runBounded(executable,USAGE_ARGUMENTS,{cwd,timeoutMs,environment,platform});
    if(ending!=='read')return {status:ending,usage:null};
    let usage=null,envelope=null;
    try {envelope=JSON.parse(output);usage=parseClaudeUsage(envelope,now);}catch {}
    return {status:usage?'read':signedOut(envelope)?'signed-out':'unrecognized',usage};
  } catch {return {status:'failed',usage:null};}
}

