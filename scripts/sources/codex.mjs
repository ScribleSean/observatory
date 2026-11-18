// Codex: <home>/sessions and <home>/archived_sessions hold rollout-<time>-<thread id>.jsonl. A thread
// with a parent is a subagent of that parent. Thread names come from <home>/session_index.jsonl.
import path from 'node:path';
import {readLines} from './jsonl.mjs';
import {codexTurn,modelName} from './usage.mjs';
import {addWrite,hashKey,patchFiles,retryState,retryCall,retryResult,retryRuns,shellWrites,repositoryResolver} from './activity.mjs';
import {workKind} from '../ledger-kinds.mjs';
import {MAX_FILES,walkFiles,eachLimited,cleanTitle,parseWithCache,notePrompt} from './common.mjs';

const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const THREAD=/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const KEEP=['"session_meta"','"turn_context"','"event_msg"','"function_call','"custom_tool_call'];

export const STATE_VERSION=2;

function newState(id) {
  return {id,parent:null,kind:null,cwd:null,model:'unknown',first:null,last:null,started:false,copiedFrom:null,prior:null,
    invalid:false,turns:[],totals:[],stop:null,lastRole:null,...retryState(),writes:{},branches:[],typed:[],origin:null,task:null,prompted:false};
}

const json=text=>{try {return JSON.parse(text);} catch {return null;}};
const literal=(text,key)=>{
  const match=new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`).exec(text);
  return match?json(match[1]):null;
};

// Shell commands and patches in one tool call, as [{command, workdir}] and patch bodies.
function callWork(name,payload) {
  const raw=payload.arguments ?? payload.input ?? '';
  const text=typeof raw==='string'?raw:JSON.stringify(raw);
  const args=typeof raw==='string'?json(raw):raw;
  const commands=[],patches=[];
  const tool=String(name ?? '');
  if(tool==='apply_patch' || tool.endsWith('.apply_patch'))patches.push(object(args) && typeof args.input==='string'?args.input:text);
  else if(object(args) && (tool==='exec_command' || tool==='shell' || tool==='container.exec')) {
    const command=Array.isArray(args.command)?String(args.command.at(-1)):args.cmd ?? args.command;
    if(typeof command==='string')commands.push({command,workdir:typeof args.workdir==='string'?args.workdir:null});
  } else if(tool==='exec') {
    // The code tool: JavaScript that calls tools.exec_command({...}) and tools.apply_patch(...).
    for(const match of text.matchAll(/exec_command\(\s*(\{[^\n]*?\})\s*\)/g)) {
      const call=json(match[1]);
      const command=object(call)?call.cmd:literal(match[1],'cmd');
      if(typeof command==='string')commands.push({command,workdir:object(call) && typeof call.workdir==='string'?call.workdir:literal(match[1],'workdir')});
    }
    if(text.includes('apply_patch'))patches.push(text);
  }
  return {commands,patches};
}

const failedOutput=output=>{
  const text=typeof output==='string'?output:JSON.stringify(output ?? '');
  const parsed=json(text);
  const code=object(parsed) && object(parsed.metadata)?parsed.metadata.exit_code:null;
  if(Number.isInteger(code))return code!==0;
  const match=/(?:exit code|exited with code|Process exited with code)[:\s]+(-?\d+)/i.exec(text);
  return match?Number(match[1])!==0:false;
};

export function codexEvent(state,event,{resolve,home}) {
  const payload=object(event.payload)?event.payload:{};
  const at=Date.parse(event.timestamp);
  if(event.type==='session_meta') {
    // A later session_meta is a parent's, copied in by a fork.
    if(state.started) {if(state.copiedFrom===null)state.copiedFrom=typeof payload.id==='string'?payload.id.toLowerCase():'';return;}
    state.started=true;
    if(typeof payload.id==='string' && payload.id)state.id=payload.id.toLowerCase();
    if(typeof payload.cwd==='string')state.cwd=payload.cwd;
    if(payload.source==='exec' || payload.originator==='codex_exec')state.origin='headless';
    else if(typeof payload.source==='string' && payload.source || typeof payload.originator==='string' && payload.originator)state.origin='interactive';
    const parent=typeof payload.parent_thread_id==='string' && payload.parent_thread_id?payload.parent_thread_id.toLowerCase():null;
    const source=object(payload.source)?payload.source:null;
    const spawned=object(source?.subagent)?source.subagent:null;
    const spawn=object(spawned?.thread_spawn)?spawned.thread_spawn:spawned;
    state.parent=parent ?? (typeof spawn?.parent_thread_id==='string'?spawn.parent_thread_id.toLowerCase():null);
    if(state.parent || spawned || payload.thread_source==='subagent') {
      const role=payload.agent_role ?? spawn?.agent_role ?? (typeof spawned==='string'?spawned:null);
      state.kind=workKind(role,payload.agent_nickname ?? spawn?.agent_nickname ?? null);
    }
    return;
  }
  if(!Number.isFinite(at))return;
  state.first=state.first===null?at:Math.min(state.first,at);
  state.last=state.last===null?at:Math.max(state.last,at);
  if(event.type==='turn_context') {
    state.model=modelName(payload.model);
    if(typeof payload.cwd==='string')state.cwd=payload.cwd;
    return;
  }
  if(event.type==='event_msg') {
    if(payload.type==='task_started') {state.stop=null;state.lastRole='assistant';}
    else if(payload.type==='task_complete' || payload.type==='turn_aborted') {state.stop='end_turn';state.lastRole='assistant';}
    else if(payload.type==='user_message') {state.typed.push(at);state.lastRole='user';state.stop=null;notePrompt(state,payload.message);}
    else if(payload.type==='item_completed' && object(payload.item) && payload.item.type==='UserMessage' && Array.isArray(payload.item.content))
      notePrompt(state,payload.item.content.filter(part=>object(part) && part.type==='text' && typeof part.text==='string' && !part.text.trimStart().startsWith('<') && !part.text.startsWith('# AGENTS.md')).map(part=>part.text).join('\n'));
    if(payload.type!=='token_count' || !object(payload.info))return;
    const total=payload.info.total_token_usage,last=payload.info.last_token_usage;
    if(!object(total))return;
    const running=hashKey(JSON.stringify(total));
    if(running===state.prior)return;
    state.prior=running;
    if(!state.totals.includes(running))state.totals.push(running);
    if(!object(last)) {if(Object.values(total).some(value=>typeof value==='number' && value>0))state.invalid=true;return;}
    const values=codexTurn(last);
    if(values==='invalid') {state.invalid=true;return;}
    if(values==='empty')return;
    state.turns.push([at,state.model,...values,running]);
    return;
  }
  if(event.type!=='response_item')return;
  if(['function_call','custom_tool_call','local_shell_call'].includes(payload.type)) {
    state.lastRole='assistant';
    const input=payload.arguments ?? payload.input ?? payload.action ?? null;
    retryCall(state,payload.call_id,payload.name ?? payload.type,input);
    const cwd=state.cwd;
    const {commands,patches}=callWork(payload.name,payload);
    for(const {command,workdir} of commands) {
      const base=workdir && cwd?path.resolve(cwd,workdir):workdir ?? cwd;
      const {dirs,branches}=shellWrites(command,base,home);
      for(const dir of dirs)addWrite(state,resolve(dir),at);
      for(const branch of branches) {const repo=resolve(branch.dir);if(repo)state.branches.push([repo,branch.name,at]);}
    }
    for(const patch of patches)for(const file of patchFiles(patch)) {
      const full=cwd?path.resolve(cwd,file):path.isAbsolute(file)?file:null;
      if(full)addWrite(state,resolve(path.dirname(full)),at);
    }
    return;
  }
  if(['function_call_output','custom_tool_call_output'].includes(payload.type))
    retryResult(state,payload.call_id,failedOutput(payload.output),at);
}

const parseFile=(file,info,{cache,resolve,home})=>parseWithCache(file,info,{cache,keep:KEEP,
  fresh:()=>newState(THREAD.exec(file)?.[1].toLowerCase() ?? path.basename(file,'.jsonl')),
  each:(state,event)=>codexEvent(state,event,{resolve,home})});

async function threadNames(folder) {
  const names=new Map();
  await readLines(path.join(folder,'session_index.jsonl'),{keep:['"thread_name"']},event=>{
    if(typeof event.id==='string' && typeof event.thread_name==='string')names.set(event.id.toLowerCase(),event.thread_name);
  });
  return names;
}

export async function readCodexSessions(folder,{since,cache,home,platform=process.platform,deadline=Infinity,concurrency=8,maxFiles=MAX_FILES}) {
  const resolve=repositoryResolver(home,platform);
  // Only rollouts written in the read window count toward the file cap. Older ones are kept by thread
  // id only, so a fork can still find its parent.
  const recent=[],byThread=new Map();
  for(const name of ['sessions','archived_sessions']) {
    const older=[];
    const found=await walkFiles(path.join(folder,name),{since,match:name=>name.endsWith('.jsonl'),maxFiles,older});
    recent.push(...found);
    for(const entry of [...found,...older].sort((a,b)=>a.file.localeCompare(b.file))) {
      const thread=THREAD.exec(entry.file)?.[1].toLowerCase();
      if(thread && !byThread.has(thread))byThread.set(thread,entry);
    }
  }
  const states=[];
  await eachLimited(recent,concurrency,deadline,async ({file,info})=>{states.push(await parseFile(file,info,{cache,resolve,home}));});
  // A fork's copied lines are its parent's running totals. The parent is read for them even when it is old.
  const parentTotals=new Map();
  for(const state of states) {
    if(state.copiedFrom===null || parentTotals.has(state.copiedFrom))continue;
    const entry=byThread.get(state.copiedFrom);
    parentTotals.set(state.copiedFrom,entry?new Set((await parseFile(entry.file,entry.info,{cache,resolve,home})).totals):null);
  }
  const names=await threadNames(folder).catch(()=>new Map());
  const sessions=new Map(),seen=new Set(),kept=new Map();
  for(const state of states.sort((a,b)=>(a.first ?? 0)-(b.first ?? 0))) {
    const id=state.parent ?? state.id;
    let row=sessions.get(id);
    if(!row) {row={id,main:null,parts:[],unknown:false};sessions.set(id,row);}
    if(!state.parent)row.main=state;
    row.parts.push(state);
    const copies=state.copiedFrom===null?new Set():parentTotals.get(state.copiedFrom);
    // Copies whose parent log is gone cannot be told apart, so the session's tokens are Unknown.
    if(copies===null || state.invalid)row.unknown=true;
    kept.set(state,state.turns.filter(turn=>{
      if(copies?.has(turn[6]))return false;
      const identity=`${turn[0]}\0${turn[6]}`;
      if(seen.has(identity))return false;
      seen.add(identity);
      return true;
    }));
  }
  return [...sessions.values()].map(row=>toRecord(row,names,resolve,kept));
}

function toRecord({id,main,parts,unknown},names,resolve,kept) {
  const requests=[],agents=[],writes=[],branches=[],runs=[];
  for(const state of parts) {
    const agent=state.parent?state.id:null;
    if(agent)agents.push({key:agent,kind:state.kind ?? 'other'});
    kept.get(state).forEach(([at,model,input,cacheRead,cacheWrite,output,running],index)=>requests.push({key:`${state.id}:${index}:${running}`,at,model,values:[input,cacheRead,cacheWrite,output],agent}));
    for(const [repo,seconds] of Object.entries(state.writes))for(const second of seconds)writes.push({repo,at:second*1000});
    for(const [repo,name,at] of state.branches)branches.push({repo,name,at});
    runs.push(...retryRuns(state));
  }
  const lasts=parts.map(state=>state.last).filter(Number.isFinite),firsts=parts.map(state=>state.first).filter(Number.isFinite);
  return {id,title:cleanTitle(names.get(id) ?? null),first:firsts.length?Math.min(...firsts):null,last:lasts.length?Math.max(...lasts):null,
    requests,agents,writes,branches,runs,unknownTokens:unknown,rateLimits:null,typed:main?[...main.typed]:[],
    live:main?{last:main.last,stop:main.stop,lastRole:main.lastRole,pending:Object.keys(main.pend).length}:null,
    // repo matches a live process by its folder and stays in memory. gitRepo is set only for a resolved git repository.
    repo:main?.cwd?resolve(main.cwd) ?? main.cwd:null,gitRepo:main?.cwd?resolve(main.cwd) ?? null:null,
    origin:main?.origin ?? null,task:main?.task ?? null};
}
