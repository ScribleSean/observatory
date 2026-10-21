// What are my agents doing: read-only status from files other tools already keep.
// - Claude Code: ~/.claude/sessions/<pid>.json, one small record per running session.
//   Only status, session name, project folder name and times are kept. The .key
//   files beside them, transcripts and messages are never opened.
// - codex-job: ~/.local/state/codex-jobs. Status comes from file names alone:
//   <id>.running while a job runs, <id>.md once it has finished. File contents
//   (the final messages) are never opened.
import {lstat,readdir,readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

export const MAX_SESSIONS=40;
export const MAX_JOBS=20;
export const RECENT_MS=24*3600000;
const MAX_RECORD_BYTES=64*1024;
const STATUS={busy:'working',working:'working',running:'working',idle:'idle',waiting:'waiting','needs-input':'waiting',
  'waiting-for-input':'waiting',blocked:'waiting',permission:'waiting'};

// oxlint-disable-next-line no-control-regex -- control characters are removed from names on purpose
const control=/[\u0000-\u001f\u007f\u2028\u2029]/g;
export function cleanName(value,limit=80) {
  if(typeof value!=='string')return null;
  const text=value.replace(control,' ').replace(/\s+/g,' ').trim();
  if(!text)return null;
  return text.length>limit?text.slice(0,limit-1)+'…':text;
}

const stamp=value=>{
  const at=typeof value==='number'?value:Date.parse(value);
  return Number.isFinite(at) && at>0?new Date(at).toISOString():null;
};

export const processAlive=pid=>{
  if(!Number.isSafeInteger(pid) || pid<=0)return false;
  try {process.kill(pid,0);return true;}
  catch(error) {return error.code==='EPERM';}
};

async function smallFile(file) {
  const info=await lstat(file);
  if(!info.isFile() || info.size>MAX_RECORD_BYTES)throw Error('Unexpected session record');
  return readFile(file,'utf8');
}

// One Claude Code session record to the few fields Observatory shows.
export function claudeSession(record,{alive,now=Date.now()}) {
  if(!record || typeof record!=='object' || Array.isArray(record))return null;
  const updatedAt=stamp(record.statusUpdatedAt ?? record.updatedAt);
  const startedAt=stamp(record.startedAt);
  const raw=typeof record.status==='string'?record.status.toLowerCase():'';
  // A session whose process has gone is done, whatever its last status said.
  const status=alive?STATUS[raw] ?? 'unknown':'done';
  const cwd=typeof record.cwd==='string'?record.cwd:'';
  // The folder's own name only. Claude worktrees are named after their project.
  const parts=cwd.split(/[\\/]+/).filter(Boolean);
  const worktree=parts.lastIndexOf('worktrees');
  const project=cleanName(worktree>1 && parts[worktree-1]==='.claude'?parts[worktree-2]:parts.at(-1),40);
  if(!alive && !(now-Date.parse(updatedAt ?? startedAt ?? '')<RECENT_MS))return null;
  return {tool:'claude-code',status,name:cleanName(record.name),project,startedAt,updatedAt,
    ...(typeof record.entrypoint==='string' && /^[a-z-]{1,32}$/.test(record.entrypoint)?{via:record.entrypoint}:{})};
}

export async function readClaudeSessions(folder,{now=Date.now(),alive=processAlive}={}) {
  let names;
  try {names=await readdir(folder);}
  catch(error) {if(error.code==='ENOENT')return {status:'not-found',sessions:[]};throw error;}
  const sessions=[];
  for(const name of names) {
    const match=/^(\d{1,10})\.json$/.exec(name);
    if(!match)continue;
    try {
      const record=JSON.parse(await smallFile(path.join(folder,name)));
      const pid=Number(match[1]);
      const session=claudeSession(record,{alive:Number(record.pid)===pid && alive(pid),now});
      if(session)sessions.push(session);
    } catch {}
  }
  const order={waiting:0,working:1,idle:2,unknown:3,done:4};
  sessions.sort((a,b)=>order[a.status]-order[b.status] || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return {status:'ok',sessions:sessions.slice(0,MAX_SESSIONS)};
}

// <yyyymmdd>-<hhmmss>-<project>-<pid>
const JOB=/^(\d{8})-(\d{6})-([A-Za-z0-9._-]{1,64})-(\d{1,10})$/;

export function jobFromId(id) {
  const match=JOB.exec(id);
  if(!match)return null;
  const [,date,time,project,pid]=match;
  const local=`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T${time.slice(0,2)}:${time.slice(2,4)}:${time.slice(4,6)}`;
  return {project,pid:Number(pid),startedAt:stamp(new Date(local).getTime())};
}

export async function readCodexJobs(folder,{now=Date.now(),alive=processAlive}={}) {
  let entries;
  try {entries=await readdir(folder,{withFileTypes:true});}
  catch(error) {if(error.code==='ENOENT')return {status:'not-found',jobs:[]};throw error;}
  const byId=new Map();
  for(const entry of entries) {
    if(!entry.isFile())continue;
    const match=/^(.+)\.(running|md)$/.exec(entry.name);
    if(!match)continue;
    const job=byId.get(match[1]) ?? {id:match[1]};
    job[match[2]]=entry.name;
    byId.set(match[1],job);
  }
  const jobs=[];
  for(const {id,running,md} of byId.values()) {
    const parsed=jobFromId(id);
    if(!parsed)continue;
    let finishedAt=null;
    if(md)try {finishedAt=stamp((await lstat(path.join(folder,md))).mtimeMs);}catch {}
    // A marker whose process has gone without a final message stopped early.
    const status=md?'done':running && alive(parsed.pid)?'working':'stopped';
    const last=Date.parse(finishedAt ?? parsed.startedAt ?? '');
    if(status!=='working' && !(now-last<RECENT_MS))continue;
    jobs.push({tool:'codex',status,project:parsed.project,startedAt:parsed.startedAt,finishedAt});
  }
  // Running jobs first, then the most recent.
  jobs.sort((a,b)=>(b.status==='working')-(a.status==='working') || String(b.finishedAt ?? b.startedAt).localeCompare(String(a.finishedAt ?? a.startedAt)));
  return {status:'ok',jobs:jobs.slice(0,MAX_JOBS)};
}

export function defaultAgentFolders(home=homedir(),environment=process.env) {
  const claude=environment.CLAUDE_CONFIG_DIR && path.isAbsolute(environment.CLAUDE_CONFIG_DIR)?environment.CLAUDE_CONFIG_DIR:path.join(home,'.claude');
  return {claudeSessions:path.join(claude,'sessions'),codexJobs:path.join(home,'.local','state','codex-jobs')};
}

export async function readAgents({folders=defaultAgentFolders(),now=Date.now(),alive=processAlive}={}) {
  const [claude,codex]=await Promise.all([
    readClaudeSessions(folders.claudeSessions,{now,alive}).catch(()=>({status:'unavailable',sessions:[]})),
    readCodexJobs(folders.codexJobs,{now,alive}).catch(()=>({status:'unavailable',jobs:[]})),
  ]);
  return {claudeStatus:claude.status,codexStatus:codex.status,sessions:claude.sessions,jobs:codex.jobs};
}
