// The ledger's source adapters, one per coding tool. Adding a tool (Gemini CLI, Cursor) is one new
// file that exports an object of this shape and one line in SOURCES:
//
//   id              ToolId, also the snapshot's `tool`.
//   name            Display name.
//   limitEngine     The forecast engine whose limits this tool spends, or null.
//   configKey       The `sources` setting that turns it on.
//   modelFamily     Model ids this tool runs, for its smallest-model price.
//   autoResume      True when its transcripts say when a limit was hit, so autoResumeUsd is readable.
//   folder(env, home)               Where its transcripts are, or null.
//   weeklyReset({claudeLimits, quota})  The weekly limit's reset time in ms, or null.
//   readSessions(folder, {since, cache, home, platform, deadline, maxFiles})  SessionRecord[].
//
// A SessionRecord holds the tool's raw session id (hashed before it leaves the collector), title,
// first and last activity, requests {key, at, model, values: [input, cacheRead, cacheWrite, output],
// agent}, agents {key, kind}, writes {repo, at}, branches {repo, name, at}, retry runs {at, count,
// category}, rate limit and typed prompt times, the live turn state and the repository it ran in.
// Also `origin` ('headless' for a run with no one typing, 'interactive', or null when unknown) and `task`,
// the WorkKind of its first prompt (null when unknown). Only the kind is kept, never the prompt.
// Paths stay inside the collector.
import path from 'node:path';
import {readClaudeSessions,STATE_VERSION as CLAUDE_VERSION} from './claude.mjs';
import {readCodexSessions,STATE_VERSION as CODEX_VERSION} from './codex.mjs';
import {openParseCache} from './parse-cache.mjs';
import {MAX_FILES,BACKFILL_MAX_FILES} from './common.mjs';

const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const folderFrom=(variable,fallback)=>(env,home)=>{
  const configured=env[variable];
  if(configured)return path.isAbsolute(configured)?configured:null;
  return home?path.join(home,fallback):null;
};
const resetMs=window=>{const at=Date.parse(window?.resetsAt);return Number.isFinite(at)?at:null;};
const WEEK_MINUTES=7*24*60;

export const claude={id:'claude',name:'Claude Code',limitEngine:'claude',configKey:'claudeCode',modelFamily:/^claude-/,autoResume:true,
  folder:folderFrom('CLAUDE_CONFIG_DIR','.claude'),
  weeklyReset:({claudeLimits})=>resetMs((object(claudeLimits) && Array.isArray(claudeLimits.windows)?claudeLimits.windows:[])
    .find(window=>window?.window==='seven_day')),
  readSessions:readClaudeSessions};

export const codex={id:'codex',name:'Codex',limitEngine:'codex',configKey:'codex',modelFamily:/^gpt-/,autoResume:false,
  folder:folderFrom('CODEX_HOME','.codex'),
  weeklyReset:({quota})=>{
    const windows=(object(quota) && Array.isArray(quota.windows)?quota.windows:[]).filter(window=>window?.durationMinutes===WEEK_MINUTES);
    return resetMs(windows.find(window=>window.bucket==='codex') ?? windows[0]);
  },
  readSessions:readCodexSessions};

export const SOURCES=Object.freeze([claude,codex]);
// The cache's own format, then each adapter's state. Version 2 added the file id and fingerprint.
export const CACHE_VERSION=`ledger-2-${CLAUDE_VERSION}-${CODEX_VERSION}`;

// Reads every enabled tool. A tool that fails or runs out of time is 'unavailable', and the cache
// keeps what was read so the next collection goes further. `since` is a time, or an object of times by
// tool id, which reads only the tools it names (the ledger history's backfill, scripts/ledger-store.mjs).
export async function readLedgerSources({config,env=process.env,home,cacheFile=null,since,deadline=Infinity,platform=process.platform,sources=SOURCES,cache=null,saveCache=true}) {
  const store=cache ?? await openParseCache(cacheFile,CACHE_VERSION);
  const tools=[];
  for(const source of sources) {
    if(!config.sources?.[source.configKey])continue;
    const from=object(since)?since[source.id]:since;
    if(object(since) && typeof from!=='number')continue;
    const folder=source.folder(env,home);
    if(!folder) {tools.push({source,status:'unavailable',sessions:[]});continue;}
    const maxFiles=from===0?BACKFILL_MAX_FILES:MAX_FILES;
    try {tools.push({source,status:'ok',sessions:await source.readSessions(folder,{since:from,cache:store,home,platform,deadline,maxFiles})});}
    catch(error) {tools.push({source,status:'unavailable',reason:error?.reason ?? 'failed',sessions:[]});}
  }
  if(saveCache)try {await store.save();} catch {}
  return {tools,cache:store,cacheStats:store.stats()};
}
