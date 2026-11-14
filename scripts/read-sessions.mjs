// Finds live Claude Code and Codex sessions on this computer from process metadata only:
// the executable name, the process's working folder and git's answer about that folder.
// Arguments, environment variables and prompts are never read. Paths stay inside this reader.
import {readlink} from 'node:fs/promises';
import {promisify} from 'node:util';
import path from 'node:path';
import {execFile} from '../lib/cycle-processes.mjs';
import {sessionIdentity,cleanSessions} from '../lib/same-repo.mjs';

const run=promisify(execFile);
export const AGENT_PROCESSES=new Set(['claude','codex']);
const MAX_FOLDERS=60;
// The whole read gets this long. Folders are asked a few at a time, so one slow disk cannot hold up a collection.
const BUDGET_MS=20000;
const AT_ONCE=6;

// `ps -axo pid=,ppid=,comm=` lines. The executable name is the last part of comm, matched
// exactly and with case, so the Claude desktop app (Claude) is not a session (claude).
export function parseProcesses(text) {
  const rows=[];
  for(const line of String(text).split('\n')) {
    const match=/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if(match)rows.push({pid:Number(match[1]),ppid:Number(match[2]),name:path.posix.basename(match[3])});
  }
  return rows;
}

// A helper an agent starts for itself (a codex process under a claude one, say) is not another session.
// rootPid ends the walk: what it started counts as a session even when an agent started rootPid (a test run by an agent).
export function agentSessions(rows,ownPid=null,rootPid=null) {
  const byPid=new Map(rows.map(row=>[row.pid,row]));
  const agents=rows.filter(row=>AGENT_PROCESSES.has(row.name));
  // Walk up through any shell or wrapper: an agent below another agent is that agent's helper.
  // Anything below this reader is Observatory's own probe (its Codex limits check), not a session.
  const underAgent=row=>{
    for(let parent=byPid.get(row.ppid),steps=0;parent && parent.pid!==rootPid && steps<64;parent=byPid.get(parent.ppid),steps++)
      if(AGENT_PROCESSES.has(parent.name) || parent.pid===ownPid)return true;
    return false;
  };
  return agents.filter(row=>!underAgent(row)).map(({pid,name})=>({pid,engine:name}));
}

// `lsof -Fpn` output: a p line with the pid, then the n line with its working folder.
export function parseLsof(text) {
  const result=new Map();
  let pid=null;
  for(const line of String(text).split('\n')) {
    if(line.startsWith('p'))pid=Number(line.slice(1));
    else if(line.startsWith('n') && pid!==null)result.set(pid,line.slice(1));
  }
  return result;
}

async function workingFolders(pids,platform,exec) {
  if(!pids.length)return new Map();
  if(platform==='mac') {
    let stdout='';
    try {({stdout}=await exec('lsof',['-a','-d','cwd','-Fpn','-p',pids.join(',')],{timeout:10000}));}
    catch(error) {stdout=error.stdout??'';}
    return parseLsof(stdout);
  }
  const found=new Map();
  for(const pid of pids)try {found.set(pid,await readlink(`/proc/${pid}/cwd`));} catch {}
  return found;
}

async function gitFacts(folder,exec) {
  // GIT_DIR and similar variables would answer for another repository, so none are passed on.
  const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),GIT_OPTIONAL_LOCKS:'0'};
  const git=args=>exec('git',['-c','core.fsmonitor=false','-C',folder,...args],{timeout:5000,env}).then(({stdout})=>stdout.trim(),()=>'');
  const [paths,branch,remote]=await Promise.all([
    git(['rev-parse','--path-format=absolute','--show-toplevel','--git-common-dir']),
    git(['symbolic-ref','--short','-q','HEAD']),
    git(['config','--get','remote.origin.url']),
  ]);
  const [toplevel,commonDir]=paths.split('\n');
  return toplevel && commonDir?{toplevel,commonDir,branch,remote}:null;
}

// Runs work over items a few at a time and stops starting new ones once the deadline has passed.
async function eachLimited(items,limit,deadline,work) {
  let next=0;
  const lane=async()=>{while(next<items.length && Date.now()<deadline)await work(items[next++]);};
  await Promise.all(Array.from({length:Math.min(limit,items.length)},lane));
}

export async function readSessions({host,platform,exec=run,list=null,now=new Date(),ownPid=process.pid,rootPid=null,budgetMs=BUDGET_MS}={}) {
  const checkedAt=now.toISOString();
  if(platform!=='mac' && platform!=='linux')return {host,status:'unavailable',checkedAt,reason:'unsupported',sessions:[]};
  const deadline=Date.now()+budgetMs;
  try {
    const text=list?await list():(await exec('ps',['-axo','pid=,ppid=,comm='],{timeout:10000,maxBuffer:8_000_000})).stdout;
    const agents=agentSessions(parseProcesses(text),ownPid,rootPid);
    const folders=await workingFolders(agents.map(row=>row.pid),platform,exec);
    const wanted=[...new Set(agents.map(agent=>folders.get(agent.pid)).filter(Boolean))].slice(0,MAX_FOLDERS);
    const cache=new Map(),sessions=[];
    await eachLimited(wanted,AT_ONCE,deadline,async folder=>{cache.set(folder,await gitFacts(folder,exec));});
    // A list cut short could hide an overlap, so it reads as unavailable instead of as a quiet "nothing found".
    if(cache.size<wanted.length)return {host,status:'unavailable',checkedAt,reason:'slow',sessions:[]};
    for(const agent of agents) {
      const facts=cache.get(folders.get(agent.pid));
      if(facts)sessions.push({engine:agent.engine,...sessionIdentity({host,...facts})});
    }
    return {host,status:'ok',checkedAt,sessions:cleanSessions(sessions)};
  } catch {return {host,status:'unavailable',checkedAt,sessions:[]};}
}
