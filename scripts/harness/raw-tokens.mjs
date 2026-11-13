// Counts Claude Code and Codex tokens per local day straight from the raw logs, with no code
// shared with the readers, so the dashboard's numbers can be checked against it.
// It prints JSON only: per provider and day, total, cache reads and the rest. No text from the logs.
// Runs as a plain script on any computer, also fed on standard input over ssh:
//   node raw-tokens.mjs <timeZone> <days> [cutoffISO] [home]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [timeZone='UTC',daysText='8',cutoffText='',homeArg='']=process.argv.slice(2);
const cutoff=cutoffText?Date.parse(cutoffText):Date.now();
const since=cutoff-Number(daysText)*86400000;
const home=homeArg||os.homedir();
const day=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
const dateOf=at=>day.format(new Date(at));

function* files(root,pattern) {
  let entries;
  try {entries=fs.readdirSync(root,{withFileTypes:true});}catch {return;}
  for(const entry of entries) {
    const full=path.join(root,entry.name);
    if(entry.isDirectory())yield* files(full,pattern);
    else if(entry.isFile() && pattern.test(entry.name)) {
      try {if(fs.statSync(full).mtimeMs>=since)yield full;}catch {}
    }
  }
}

function add(days,date,total,cache) {
  const row=days[date] ??= {total:0,cacheRead:0,other:0};
  row.total+=total;row.cacheRead+=cache;row.other+=total-cache;
}

function lines(file) {
  try {return fs.readFileSync(file,'utf8').split('\n');}catch {return [];}
}

function claude() {
  const days={};
  const seen=new Set();
  for(const file of files(path.join(home,'.claude','projects'),/\.jsonl$/)) {
    for(const line of lines(file)) {
      if(!line.includes('"usage"'))continue;
      let event;try {event=JSON.parse(line);}catch {continue;}
      const usage=event?.message?.usage;
      if(event?.type!=='assistant' || !usage)continue;
      const at=Date.parse(event.timestamp);
      if(!(at>=since && at<=cutoff))continue;
      const key=`${event.message.id}|${event.requestId}`;
      if(seen.has(key))continue;
      seen.add(key);
      const n=name=>Number.isFinite(usage[name])?usage[name]:0;
      const cache=n('cache_read_input_tokens');
      add(days,dateOf(at),n('input_tokens')+cache+n('cache_creation_input_tokens')+n('output_tokens'),cache);
    }
  }
  return days;
}

function codex() {
  const days={};
  const root=process.env.CODEX_HOME||path.join(home,'.codex');
  for(const folder of ['sessions','archived_sessions']) {
    for(const file of files(path.join(root,folder),/^rollout-.*\.jsonl$/)) {
      let last=null;
      for(const line of lines(file)) {
        if(!line.includes('"token_count"'))continue;
        let event;try {event=JSON.parse(line);}catch {continue;}
        const total=event?.payload?.info?.total_token_usage;
        if(event?.payload?.type!=='token_count' || !total)continue;
        const at=Date.parse(event.timestamp);
        const now={total:total.total_tokens??0,cache:total.cached_input_tokens??0};
        if(last && now.total>=last.total && at>=since && at<=cutoff)
          add(days,dateOf(at),now.total-last.total,now.cache-last.cache);
        else if(!last && at>=since && at<=cutoff) add(days,dateOf(at),now.total,now.cache);
        if(at<=cutoff)last=now;
      }
    }
  }
  return days;
}

console.log(JSON.stringify({platform:process.platform,timeZone,cutoff:new Date(cutoff).toISOString(),claude:claude(),codex:codex()}));
