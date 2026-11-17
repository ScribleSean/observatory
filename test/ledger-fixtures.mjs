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
