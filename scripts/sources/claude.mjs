// Claude Code: <config>/projects/<folder>/<session id>.jsonl, with each subagent in
// <session id>/subagents/agent-<id>.jsonl beside an agent-<id>.meta.json that names its type and task.
import fs from 'node:fs/promises';
import path from 'node:path';
import {claudeRequest} from './usage.mjs';
import {FILE_TOOLS,addWrite,retryState,retryCall,retryResult,retryRuns,shellWrites,repositoryResolver} from './activity.mjs';
import {workKind} from '../ledger-kinds.mjs';
import {walkFiles,eachLimited,cleanTitle,parseWithCache,notePrompt} from './common.mjs';

const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
// Lines the adapter reads. Attachments, request copies and file history are skipped unparsed.
const KEEP=['"type":"assistant"','"type":"user"','"type":"custom-title"','"type":"summary"','"type":"system"'];
// A user line this long holds a tool's output (a file read, say). Its ids and error flags are read
// from its first and last 64 KB without parsing it.
const RESULT_IDS=/"tool_use_id":"([^"]{1,128})"/g;

export const STATE_VERSION=2;

function newState(agent) {
  return {agent,title:null,first:null,last:null,req:{},stop:null,lastRole:null,cwd:null,
    ...retryState(),writes:{},branches:[],rl:[],typed:[],origin:null,task:null,prompted:false};
}

const typedPrompt=event=>{
  if(event.isMeta===true || event.isSidechain===true)return false;
  if(typeof event.turnOrigin==='string')return event.turnOrigin==='human';
  if(event.promptSource!==undefined)return false;
  const content=event.message?.content;
  return typeof content==='string' && !content.trimStart().startsWith('<');
};

// Folds one event into a file's state. Kept small and JSON-only so the parse cache can store it.
export function claudeEvent(state,event,{resolve,home}) {
  const at=Date.parse(event.timestamp);
  if(event.type==='custom-title' && typeof event.customTitle==='string') {state.title=event.customTitle;return;}
  if(event.type==='summary' && typeof event.summary==='string' && state.title===null) {state.summaryTitle=event.summary;return;}
  if(!Number.isFinite(at))return;
  state.first=state.first===null?at:Math.min(state.first,at);
  state.last=state.last===null?at:Math.max(state.last,at);
  if(typeof event.cwd==='string')state.cwd=event.cwd;
  if(state.origin===null && typeof event.entrypoint==='string' && event.entrypoint)
    state.origin=event.entrypoint.startsWith('sdk')?'headless':'interactive';
  if(event.type==='assistant' && object(event.message)) {
    if(event.error==='rate_limit')state.rl.push(at);
    const request=claudeRequest(event);
    if(request==='invalid' || request?.invalid)state.invalid=true;
    else if(object(request)) {
      const prior=state.req[request.id];
      const agent=state.agent ?? (event.isSidechain===true && typeof event.agentId==='string'?event.agentId:null);
      if(!prior || prior[2]+prior[3]+prior[4]+prior[5]<request.total)
        state.req[request.id]=[prior?Math.min(prior[0],at):at,request.model,...request.values,agent];
    }
    if(typeof event.message.stop_reason==='string')state.stop=event.message.stop_reason;
    state.lastRole='assistant';
    const cwd=typeof event.cwd==='string'?event.cwd:state.cwd;
    for(const block of Array.isArray(event.message.content)?event.message.content:[]) {
      if(!object(block) || block.type!=='tool_use' || !object(block.input))continue;
      retryCall(state,block.id,block.name,block.input);
      const field=FILE_TOOLS[block.name];
      if(field && typeof block.input[field]==='string' && path.isAbsolute(block.input[field]))
        addWrite(state,resolve(path.dirname(block.input[field])),at);
      else if(block.name==='Bash' && typeof block.input.command==='string') {
        const {dirs,branches}=shellWrites(block.input.command,cwd,home);
        for(const dir of dirs)addWrite(state,resolve(dir),at);
        for(const branch of branches) {const repo=resolve(branch.dir);if(repo)state.branches.push([repo,branch.name,at]);}
      }
    }
    return;
  }
  if(event.type==='user' && object(event.message)) {
    state.lastRole='user';
    const content=event.message.content;
    if(typedPrompt(event))state.typed.push(at);
    if(event.isMeta!==true && event.isSidechain!==true && state.agent===null && state.prompted!==true)
      notePrompt(state,typeof content==='string'?content:Array.isArray(content)
        ?content.filter(block=>object(block) && block.type==='text' && typeof block.text==='string' && !block.text.trimStart().startsWith('<')).map(block=>block.text).join('\n'):null);
    if(Array.isArray(content))for(const block of content)
      if(object(block) && block.type==='tool_result')retryResult(state,block.tool_use_id,block.is_error===true,at);
  }
}

// A user line too long to parse: its tool results all count as answered, and as failed only when
// the error flag is in the part that was read.
function bigLine(state,text) {
  if(!text.includes('"type":"user"'))return;
  const at=Date.parse(/"timestamp":"([^"]+)"/.exec(text)?.[1]);
  const failed=text.includes('"is_error":true');
  for(const match of text.matchAll(RESULT_IDS))retryResult(state,match[1],failed,Number.isFinite(at)?at:state.last);
}

async function readMeta(file) {
  try {
    const raw=JSON.parse(await fs.readFile(file,'utf8'));
    return object(raw)?{kind:workKind(raw.agentType,raw.description)}:{kind:'other'};
  } catch {return {kind:'other'};}
}

const parseFile=(file,info,{cache,resolve,home,agent})=>parseWithCache(file,info,{cache,keep:KEEP,fresh:()=>newState(agent),
  each:(state,event)=>claudeEvent(state,event,{resolve,home}),big:bigLine});

// Every session with a file written at or after `since`, with its subagents.
export async function readClaudeSessions(folder,{since,cache,home,platform=process.platform,deadline=Infinity,concurrency=8}) {
  const resolve=repositoryResolver(home,platform);
  const files=await walkFiles(path.join(folder,'projects'),{since,match:name=>name.endsWith('.jsonl')});
  const sessions=new Map();
  const sessionOf=id=>{
    let row=sessions.get(id);
    if(!row) {row={id,main:null,agents:[]};sessions.set(id,row);}
    return row;
  };
  await eachLimited(files,concurrency,deadline,async ({file,info})=>{
    const inSubagents=path.basename(path.dirname(file))==='subagents';
    const name=path.basename(file,'.jsonl');
    if(inSubagents) {
      const owner=path.basename(path.dirname(path.dirname(file)));
      const agent=name.replace(/^agent-/,'');
      const metaFile=path.join(path.dirname(file),`${name}.meta.json`);
      const metaKey=`meta:${metaFile}`;
      let meta=cache.get(metaKey);
      if(!object(meta)) {meta=await readMeta(metaFile);cache.set(metaKey,meta);}
      else cache.set(metaKey,meta);
      const state=await parseFile(file,info,{cache,resolve,home,agent});
      sessionOf(owner).agents.push({agent,kind:meta.kind,state});
    } else {
      const state=await parseFile(file,info,{cache,resolve,home,agent:null});
      sessionOf(name).main=state;
    }
  });
  return [...sessions.values()].map(row=>toRecord(row,resolve));
}

// One session record in the shape every adapter returns (see scripts/sources/index.mjs).
function toRecord({id,main,agents},resolve) {
  const states=[...(main?[main]:[]),...agents.map(entry=>entry.state)];
  const requests=[];
  for(const state of states)for(const [key,[at,model,input,cacheRead,cacheWrite,output,agent]] of Object.entries(state.req))
    requests.push({key,at,model,values:[input,cacheRead,cacheWrite,output],agent});
  const agentRows=new Map(agents.map(entry=>[entry.agent,{key:entry.agent,kind:entry.kind}]));
  // Older transcripts kept subagent turns in the main file, marked by agentId. Their task is unknown.
  for(const request of requests)if(request.agent && !agentRows.has(request.agent))agentRows.set(request.agent,{key:request.agent,kind:'other'});
  const writes=[],branches=[],runs=[];
  for(const state of states) {
    for(const [repo,seconds] of Object.entries(state.writes))for(const second of seconds)writes.push({repo,at:second*1000});
    for(const [repo,name,at] of state.branches)branches.push({repo,name,at});
    runs.push(...retryRuns(state));
  }
  const lasts=states.map(state=>state.last).filter(Number.isFinite);
  const firsts=states.map(state=>state.first).filter(Number.isFinite);
  return {id,title:cleanTitle(main?.title ?? main?.summaryTitle ?? null),
    first:firsts.length?Math.min(...firsts):null,last:lasts.length?Math.max(...lasts):null,
    requests,agents:[...agentRows.values()],writes,branches,runs,unknownTokens:states.some(state=>state.invalid===true),
    rateLimits:main?[...main.rl]:[],typed:main?[...main.typed]:[],
    live:main?{last:main.last,stop:main.stop,lastRole:main.lastRole,pending:Object.keys(main.pend).length}:null,
    repo:main?.cwd?resolve(main.cwd) ?? main.cwd:null,
    origin:main?.origin ?? null,task:main?.task ?? null};
}
