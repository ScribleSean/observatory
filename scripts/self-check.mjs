// Runs after every hub tick: lib/self-check.mjs lists what reads Unknown or stale on a computer that is on, and
// each problem that lasts files one ticket (scripts/queue-ticket.mjs) where `selfCheck.tickets` in the settings says.
// With no tickets setting the problems are only kept in the private state file.
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeJsonAtomic} from '../lib/atomic-file.mjs';
import {privateFolder} from '../lib/private-folder.mjs';
import {findProblems,METRICS,ACCOUNT_METRICS,UNMATCHED} from '../lib/self-check.mjs';
import {HOSTS} from '../lib/combine.mjs';

// A problem must last this long before it is filed, so one slow read is not a ticket.
export const PERSIST_MS=30*60000;
// A problem still there this long after its ticket is filed again, unless the queue still has it open.
export const REFILE_MS=24*60*60000;
export const TICKET_TIMEOUT_MS=90_000;
// All tickets of one run together stop here, so filing never holds the tick near its deadline.
export const FILING_BUDGET_MS=120_000;
const STATE_FILE='state.json';
const SCRIPT=fileURLToPath(new URL('./queue-ticket.mjs',import.meta.url));

const run=(file,args,timeout)=>new Promise(resolve=>{
  execFile(file,args,{timeout,killSignal:'SIGTERM'},(error,stdout)=>resolve({code:error?(error.code ?? 1):0,stdout:String(stdout ?? '')}));
});

// A ticket is read by whoever works the queue, and part of a problem comes from another computer's snapshot.
// So a ticket holds only words chosen here: a status from this list, a metric from lib/self-check.mjs, the
// machine's name from this computer's own settings, and a time this computer formats.
export const STATUSES=Object.freeze(['missing','stale','unavailable','unknown','not-connected','refused','unmatched','hidden']);
export const MAX_FIELD=80;
const LABELS=new Map([['snapshot','Snapshot'],[UNMATCHED.key,UNMATCHED.label],['claude-model','Claude Code model'],['claude-effort','Claude Code effort'],['claude-speed','Claude Code speed'],
  ...[...METRICS,...ACCOUNT_METRICS].map(({key,label})=>[key,label])]);
const PLATFORM_HOST={mac:'Mac',windows:'Windows',linux:'Linux'};
/** Short, single-line text with no table or markup characters. */
// oxlint-disable-next-line no-control-regex -- removing control characters is the point
export const cleanField=(text,max=MAX_FIELD)=>String(text ?? '').replace(/[|\r\n\t`<>[\]]+/g,' ').replace(/[\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim().slice(0,max);

/** The machine's name as this computer's settings give it, never as the other computer reported it. */
export function machineName(config,host) {
  if(host===config.host)return cleanField(config.device?.name ?? host,40) || host;
  const spoke=(config.hub?.spokes ?? []).find(item=>PLATFORM_HOST[item.platform]===host);
  return cleanField(spoke?.name ?? host,40) || host;
}

/** The ticket for a problem, or null when the problem names a computer or metric this version does not know. */
export function ticketFor(problem,config) {
  if(!HOSTS.includes(problem.host) || !LABELS.has(problem.metric))return null;
  const label=LABELS.get(problem.metric),machine=machineName(config,problem.host);
  const status=STATUSES.includes(problem.status)?problem.status:'unexpected';
  const at=Date.parse(problem.since);
  const since=Number.isFinite(at)?` since the ${new Date(at).toISOString().slice(0,16).replace('T',' ')} UTC read`:'';
  if(problem.metric===UNMATCHED.key)return {key:`${problem.host}/${problem.metric}`,label,machine,
    job:status==='hidden'
      ?`Observatory self-check: most browser time on ${machine} in the last week has no page title, so no my-apps rule can match it${since}. ActivityWatch's window watcher has exclude_title on (aw-watcher-window.toml). Ask the owner whether to turn it off, or to use a URL watcher (docs/SCREEN-TIME.md).`
      :`Observatory self-check: most browser time on ${machine} in the last week matched no my-apps rule${since}. Add rules for the sites in use to activity.apps in its observatory.config.json, or install a URL watcher if page titles are not enough (docs/SCREEN-TIME.md).`,
    doneWhen:`Observatory's self-check no longer lists ${label} on ${machine}`};
  return {key:`${problem.host}/${problem.metric}`,label,machine,
    job:`Observatory self-check: ${label} on ${machine} reads ${status}${since}. Find the first place it goes wrong and fix it there, with a test.`,
    doneWhen:`Observatory's self-check no longer lists ${label} on ${machine}`};
}

// A lock written in JavaScript runs with this Node, so it works on every system. Any other program runs as it is.
const lockCommand=(lock,args)=>/\.[cm]?js$/i.test(lock)?[process.execPath,[lock,...args]]:[lock,args];

/** Files one ticket through the settings' queue file and lock. Returns {result: 'filed' | 'open' | 'busy' | 'failed'}. */
export async function fileTicket(tickets,ticket,{exec=run,timeout=TICKET_TIMEOUT_MS}={}) {
  const args=[SCRIPT,tickets.file,JSON.stringify({ticket,engine:tickets.engine}),...(tickets.commit?['--commit']:[])];
  if(tickets.lock) {
    // A held lock means another writer is busy: try again on the next tick instead of waiting inside this one.
    const status=await exec(...lockCommand(tickets.lock,['status']),Math.min(10_000,timeout));
    if(status.code!==0 || status.stdout.trim()!=='free')return {result:'busy'};
  }
  const outcome=tickets.lock?await exec(...lockCommand(tickets.lock,['run','observatory-self-check','--',process.execPath,...args]),timeout)
    :await exec(process.execPath,args,timeout);
  const line=outcome.stdout.trim().split('\n').reverse().find(text=>text.startsWith('{'));
  try {return JSON.parse(line);} catch {return {result:'failed'};}
}

async function readState(file) {
  try {
    const value=JSON.parse(await readFile(file,'utf8'));
    return value?.version===1 && value.problems && typeof value.problems==='object'?value:{version:1,problems:{}};
  } catch {return {version:1,problems:{}};}
}

export async function runSelfCheck(config,combined,{now=Date.now(),file=fileTicket,budget=FILING_BUDGET_MS,clock=Date.now}={}) {
  const started=clock();
  const folder=await privateFolder(config.dataFolder,'private-self-check');
  const stateFile=path.join(folder,STATE_FILE);
  const state=await readState(stateFile);
  const at=new Date(now).toISOString();
  const problems=findProblems(combined);
  const next={};
  const filed=[];
  for(const problem of problems) {
    const old=state.problems[problem.key];
    const entry={...problem,firstSeen:old?.firstSeen ?? at,lastSeen:at,filedAt:old?.filedAt ?? null,row:old?.row ?? null};
    next[problem.key]=entry;
    const tickets=config.selfCheck?.tickets;
    const lasted=now-Date.parse(entry.firstSeen)>=PERSIST_MS;
    const due=!entry.filedAt || now-Date.parse(entry.filedAt)>=REFILE_MS;
    const ticket=ticketFor(problem,config);
    if(!tickets || !lasted || !due || !ticket)continue;
    const left=budget-(clock()-started);
    // Out of time: the rest are filed on a later tick, since they stay in the state file unfiled.
    if(left<=0)continue;
    let outcome;
    try {outcome=await file(tickets,ticket,{timeout:Math.min(TICKET_TIMEOUT_MS,left)});} catch {outcome={result:'failed'};}
    if(outcome?.result==='filed' || outcome?.result==='open') {
      entry.filedAt=at;
      entry.row=outcome.row ?? null;
      filed.push({key:problem.key,result:outcome.result,row:entry.row});
    }
  }
  // A problem that is gone is dropped, so it is filed afresh if it comes back.
  const resolved=Object.keys(state.problems).filter(key=>!next[key]);
  await writeJsonAtomic(stateFile,{version:1,checkedAt:at,problems:next});
  return {problems:problems.map(problem=>problem.key),filed,resolved};
}
