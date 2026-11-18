// Fictional Claude Code and Codex transcripts for the ledger tests. Nothing here comes from real use.
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

export const iso=ms=>new Date(ms).toISOString();
export const jsonl=events=>events.map(event=>JSON.stringify(event)).join('\n')+'\n';

export function claudeAssistant({id,at,model='claude-opus-5-5',usage=[10,100,5,20],cwd,tools=[],stop='tool_use',agentId=null,error=null}) {
  const [input,cacheRead,cacheWrite,output]=usage;
  return {type:'assistant',timestamp:iso(at),cwd,sessionId:'s',isSidechain:Boolean(agentId),...(agentId?{agentId}:{}),...(error?{error}:{}),
    message:{id,model,stop_reason:stop,usage:{input_tokens:input,cache_read_input_tokens:cacheRead,cache_creation_input_tokens:cacheWrite,output_tokens:output},
      content:tools.map(([toolId,name,input])=>({type:'tool_use',id:toolId,name,input}))}};
}
export const claudeResult=({at,cwd,results})=>({type:'user',timestamp:iso(at),cwd,message:{role:'user',
  content:results.map(([toolId,failed])=>({type:'tool_result',tool_use_id:toolId,content:failed?'Error: no such file':'ok',...(failed?{is_error:true}:{})}))}});
export const claudePrompt=({at,cwd,origin='human'})=>({type:'user',timestamp:iso(at),cwd,turnOrigin:origin,message:{role:'user',content:'Make the button blue'}});
export const claudeTitle=title=>({type:'custom-title',customTitle:title,sessionId:'s'});

export async function writeClaude(home,project,sessionId,events,{subagents=[]}={}) {
  const folder=path.join(home,'.claude','projects',project);
  await mkdir(folder,{recursive:true});
  const file=path.join(folder,`${sessionId}.jsonl`);
  await writeFile(file,jsonl(events));
  for(const {id,meta,events:agentEvents} of subagents) {
    const sub=path.join(folder,sessionId,'subagents');
    await mkdir(sub,{recursive:true});
    await writeFile(path.join(sub,`agent-${id}.jsonl`),jsonl(agentEvents));
    if(meta)await writeFile(path.join(sub,`agent-${id}.meta.json`),JSON.stringify(meta));
  }
  return file;
}
export const appendEvents=(file,events)=>appendFile(file,jsonl(events));

export function codexToken(at,total,last) {
  const usage=([input,cached,output])=>({input_tokens:input,cached_input_tokens:cached,output_tokens:output,reasoning_output_tokens:0,total_tokens:input+output});
  return {type:'event_msg',timestamp:iso(at),payload:{type:'token_count',info:{total_token_usage:usage(total),last_token_usage:usage(last)}}};
}
export async function writeCodex(home,threadId,events,{day='2026/11/10'}={}) {
  const folder=path.join(home,'.codex','sessions',...day.split('/'));
  await mkdir(folder,{recursive:true});
  const file=path.join(folder,`rollout-2026-11-10T10-00-00-${threadId}.jsonl`);
  await writeFile(file,jsonl(events));
  return file;
}

// A tiny git repository with commits at known times.
export function git(repo,args,at=null) {
  const when=at===null?{}:{GIT_AUTHOR_DATE:`@${Math.floor(at/1000)} +0000`,GIT_COMMITTER_DATE:`@${Math.floor(at/1000)} +0000`};
  const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),
    GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.invalid',...when};
  return execFileSync('git',['-C',repo,'-c','commit.gpgsign=false','-c','init.defaultBranch=main',...args],{env,encoding:'utf8'}).trim();
}
export async function makeRepo(repo,at) {
  await mkdir(repo,{recursive:true});
  git(repo,['init','-q','-b','main']);
  await writeFile(path.join(repo,'README.md'),'start\n');
  git(repo,['add','.']);
  git(repo,['commit','-qm','Start'],at);
}
export async function commitFile(repo,name,at,message='Change') {
  await writeFile(path.join(repo,name),`${message} ${at}\n`);
  git(repo,['add','.']);
  git(repo,['commit','-qm',message],at);
  return git(repo,['rev-parse','HEAD']);
}

// A year of fictional ledger history for one computer (lib/r2-shape.mjs), heavy but realistic: every day
// Claude Code lists SESSION_DAY_TOP sessions and folds 40 more into compact rows, and Codex lists 6. Each
// session uses 3 models, 4 work kinds and 2 repositories. For the size checks only, so the numbers need
// not add up. (Two tools that each list SESSION_DAY_TOP sessions at the widest breakdowns every day for
// MIN_SESSION_DAYS days do not fit LEDGER_HISTORY_BUDGET.)
export async function yearOfLedgerHistory(host,now,{days=365,tools=['claude','codex'],extraSessions=40,listed={claude:30,codex:6},models:modelCount=3,kinds:kindCount=4,repos:repoCount=2}={}) {
  const {LEDGER_HISTORY_SCHEMA,SESSION_DAY_TOP,MAX_SESSION_MODELS,MAX_SESSION_KINDS,MAX_SESSION_REPOS,MAX_DAY_REPOS}=await import('../lib/r2-shape.mjs');
  const width=(count,max)=>Math.min(count,max);
  const hex=seed=>seed.toString(16).padStart(12,'0');
  const models=['claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5','claude-fable-5'];
  const kinds=['main','build','review','search','research'];
  const repos=['lantern','orchard','tidepool','quarry','kestrel','meadow','harbor','ember','willow','cobble','fern','slate'];
  const tokens=seed=>({input:1000+seed,output:20000+seed,cacheRead:900000+seed,cacheWrite:30000+seed});
  const ship=(repo,seed)=>({repo,apiUsd:12.345678+seed%7,commits:seed%9,onMain:seed%5,merges:seed%2});
  const out=[];
  for(let back=days-1;back>=0;back--) {
    const date=new Date(now-back*86400000).toISOString().slice(0,10);
    for(const tool of tools) {
      const sessions=Array.from({length:Math.min(SESSION_DAY_TOP,listed[tool] ?? SESSION_DAY_TOP)},(_,index)=>{
        const seed=back*1000+index;
        return {id:hex(seed+(tool==='codex'?500000:0)),title:`Builder: Fictional project ${index}`,origin:'interactive',task:'build',repo:repos[index%repos.length],
          firstAt:new Date(now-back*86400000-5*3600000).toISOString(),lastAt:new Date(now-back*86400000-3600000).toISOString(),apiUsd:40.123456+index,tokens:tokens(seed),
          models:models.slice(0,width(modelCount,MAX_SESSION_MODELS)).map(model=>({model,apiUsd:10.123456,outputTokens:5000+seed%100})),
          kinds:kinds.slice(0,width(kindCount,MAX_SESSION_KINDS)).map(kind=>({kind,apiUsd:8.123456,subagents:index%6})),
          ship:repos.slice(0,width(repoCount,MAX_SESSION_REPOS)).map((repo,at)=>ship(repo,seed+at))};
      });
      out.push({date,tool,status:'ok',frozen:back>=14,apiUsd:2400.123456,sessionCount:sessions.length+extraSessions,subagents:300,tokens:tokens(back),
        models:models.map(model=>({model,apiUsd:600.123456,outputTokens:150000})),
        kinds:['main','build','review','search','research','design','test','write','other'].map(kind=>({kind,apiUsd:200.123456,subagents:20})),
        origins:[{origin:'interactive',apiUsd:2000.123456,sessions:50},{origin:'headless',apiUsd:400.123456,sessions:20}],
        repos:repos.slice(0,MAX_DAY_REPOS).map((repo,at)=>ship(repo,back+at)),
        ship:{commits:120,onMain:80,merges:9},sessions,
        other:{count:extraSessions,apiUsd:300.123456,subagents:40,ship:{commits:20,onMain:10,merges:1},
          rows:Array.from({length:extraSessions},(_,index)=>[hex(back*1000+700+index),1.234567,index%3,index%2])}});
    }
  }
  return {host,status:'ok',checkedAt:new Date(now).toISOString(),schema:LEDGER_HISTORY_SCHEMA,timeZone:'America/New_York',
    firstDate:out[0].date,sessionsFrom:out[0].date,days:out};
}
