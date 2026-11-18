// Builds this computer's LedgerRow (lib/ledger-shape.mjs) from the source adapters' session records,
// the limit readings and the live process list. Nothing here keeps a path, command or prompt: sessions
// leave as a hashed id, the tool's title, counts, model ids and repository folder names.
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {rates} from './api-estimate.mjs';
import {LEDGER_TOP} from '../lib/ledger-shape.mjs';
import {TIME_ZONE} from '../lib/timezone.mjs';
import {dayKey} from './read-projects.mjs';
import {joinCommits} from './ledger-commits.mjs';
import {isWorkKind} from './ledger-kinds.mjs';
import {TOOL_CATEGORIES} from './sources/activity.mjs';

export const WEEK_MS=7*24*3600000;
export const SLOT_MS=15*60000; // freshness-exempt: the fan-out timeline's slot width
// Running and state, from the transcript and the process list:
// - running: a live process of this tool was seen in the session's repository (the most recently
//   active session there takes it), or the transcript moved in the last RUNNING_MS.
// - state, while running: 'idle' once nothing was written for IDLE_MS, else 'waiting' when the last
//   turn ended (the model stopped with end_turn) and no tool call is still waiting for its result,
//   else 'working'.
// - ratePerHour: the apiUsd of the last RATE_MS, scaled to an hour.
export const RUNNING_MS=5*60000;
export const IDLE_MS=15*60000; // freshness-exempt: a session counts as idle after this, not a reading's age
export const RATE_MS=30*60000;
// A session that hit a limit and went on by itself (no typed prompt) at least RESUME_GAP_MS later
// resumed on its own. AUTO_RESUME_SPAN_MS of its spend from then counts as autoResumeUsd.
export const RESUME_GAP_MS=5*60000;
export const AUTO_RESUME_SPAN_MS=30*60000;
const MAX_REPOS=8;

const ledgerId=(tool,id)=>createHash('sha256').update(`${tool}:${id}`).digest('hex').slice(0,12);
const iso=ms=>new Date(ms).toISOString();
const rateOf=model=>Object.hasOwn(rates,model)?rates[model]:null;
const priceAt=(model,values)=>{const rate=rateOf(model);return rate?values.reduce((sum,value,index)=>sum+value*rate[index],0)/1e6:null;};
// Sums that stay Unknown when any part is.
const knownSum=values=>values.some(value=>value===null)?null:values.reduce((a,b)=>a+b,0);
const round=value=>value===null?null:Math.round(value*1e6)/1e6;
const byUsd=(a,b)=>(b.apiUsd ?? -1)-(a.apiUsd ?? -1);

// The weekly window for a tool: from its limit reading when there is one, else the last 7 days.
export function periodsFor(source,limits,now) {
  const reset=source.weeklyReset(limits ?? {});
  const known=reset!==null && reset>now && reset<=now+WEEK_MS+3600000;
  const end=known?reset:now,start=end-WEEK_MS;
  return [{key:'current',start,end,windowKnown:known},{key:'previous',start:start-WEEK_MS,end:start,windowKnown:known}];
}

// The smallest model a tool runs: the cheapest priced model of its family.
export function smallModelOf(source) {
  return Object.keys(rates).filter(model=>source.modelFamily.test(model)).sort((a,b)=>rates[a][3]-rates[b][3] || a.localeCompare(b))[0] ?? null;
}

// Requests with each one's price, keeping only the largest copy of each request key across sessions
// (a fork carries its parent's requests). A tie goes to the session that started first.
function priced(sessions) {
  const best=new Map();
  for(const session of sessions)for(const request of session.requests) {
    const total=request.values.reduce((a,b)=>a+b,0),prior=best.get(request.key);
    if(!prior || prior.total<total || (prior.total===total && (session.first ?? 0)<(prior.session.first ?? 0)))best.set(request.key,{total,session,request});
  }
  const kept=new Map(sessions.map(session=>[session,[]]));
  for(const {session,request} of best.values())kept.get(session).push({...request,usd:priceAt(request.model,request.values)});
  for(const list of kept.values())list.sort((a,b)=>a.at-b.at);
  return kept;
}

function autoResumes(session,requests) {
  if(!Array.isArray(session.rateLimits))return null;
  const found=new Set();
  for(const hit of session.rateLimits) {
    const next=requests.find(request=>request.at>hit);
    if(!next || next.at-hit<RESUME_GAP_MS)continue;
    if(session.typed.some(at=>at>hit && at<=next.at+1000))continue;
    found.add(next.at);
  }
  return [...found].map(at=>({at,usd:knownSum(requests.filter(request=>request.at>=at && request.at<at+AUTO_RESUME_SPAN_MS).map(request=>request.usd))}));
}

function liveMatches(source,sessions,live) {
  const matched=new Set();
  if(live?.status!=='ok' || !Array.isArray(live.sessions))return matched;
  for(const process of live.sessions.filter(row=>row?.engine===source.id && typeof row.repo==='string')) {
    const candidates=sessions.filter(session=>!matched.has(session) && session.repo && path.basename(session.repo).toLowerCase()===process.repo.toLowerCase());
    const latest=candidates.sort((a,b)=>(b.live?.last ?? b.last ?? 0)-(a.live?.last ?? a.last ?? 0))[0];
    if(latest)matched.add(latest);
  }
  return matched;
}

// The folder name of the git repository a session ran in, or null. Never a path, never the home folder, and never
// a working folder that is not a repository: only a name the resolver found a repository for leaves this computer.
function repoName(dir) {
  if(typeof dir!=='string' || !path.isAbsolute(dir) || path.resolve(dir)===path.resolve(os.homedir()))return null;
  const name=path.basename(dir);
  return name && name!=='.' && name!=='..' && name.length<=64?name:null;
}

function sessionRow(source,session,requests,period,ctx) {
  const inPeriod=requests.filter(request=>request.at>=period.start && request.at<period.end);
  if(!inPeriod.length)return null;
  const tokens={input:0,output:0,cacheRead:0,cacheWrite:0};
  const models=new Map(),groups=new Map(),agents=new Map();
  for(const request of inPeriod) {
    const [input,cacheRead,cacheWrite,output]=request.values;
    tokens.input+=input;tokens.cacheRead+=cacheRead;tokens.cacheWrite+=cacheWrite;tokens.output+=output;
    const model=models.get(request.model) ?? {model:request.model,usd:[],outputTokens:0};
    model.usd.push(request.usd);model.outputTokens+=output;models.set(request.model,model);
    const kind=request.agent?ctx.kinds.get(request.agent) ?? 'other':'main';
    const groupKey=`${kind}\0${request.model}`;
    const group=groups.get(groupKey) ?? {kind,model:request.model,agents:new Set(),usd:[],requests:[]};
    if(request.agent)group.agents.add(request.agent);
    group.usd.push(request.usd);group.requests.push(request);groups.set(groupKey,group);
    if(request.agent) {
      const span=agents.get(request.agent) ?? {first:request.at,last:request.at};
      span.first=Math.min(span.first,request.at);span.last=Math.max(span.last,request.at);agents.set(request.agent,span);
    }
  }
  const apiUsd=session.unknownTokens?null:round(knownSum(inPeriod.map(request=>request.usd)));
  const subagents=[...ctx.agentStarts].filter(([agent,first])=>ctx.ownAgents.has(agent) && first>=period.start && first<period.end).length;
  const kinds=[...groups.values()].map(group=>({kind:group.kind,model:group.model,subagents:group.agents.size,
    apiUsd:session.unknownTokens?null:round(knownSum(group.usd))})).sort(byUsd);
  const fanout=[];
  if(subagents>0) {
    const slots=new Map();
    for(const {first,last} of agents.values())
      for(let slot=Math.floor(first/SLOT_MS)*SLOT_MS;slot<=last;slot+=SLOT_MS)slots.set(slot,(slots.get(slot) ?? 0)+1);
    for(const [slot,count] of [...slots].sort((a,b)=>a[0]-b[0]))fanout.push({at:iso(slot),count});
  }
  // Signals.
  const runs=session.runs.filter(run=>run.at>=period.start && run.at<period.end).sort((a,b)=>b.count-a.count);
  const search=[...groups.values()].filter(group=>(group.kind==='search' || group.kind==='research') && group.model===ctx.topModel).flatMap(group=>group.requests);
  const small=rateOf(ctx.smallModel);
  const resumes=ctx.resumes===null?null:ctx.resumes.filter(resume=>resume.at>=period.start && resume.at<period.end);
  const signals={longestRetry:runs[0]?.count ?? 0,retryTool:TOOL_CATEGORIES.includes(runs[0]?.category)?runs[0].category:null,
    autoResumeUsd:resumes===null?null:round(knownSum(resumes.map(resume=>resume.usd))),
    searchOnTopModelUsd:ctx.topModel===null?null:round(knownSum(search.map(request=>request.usd))),
    searchOnSmallModelUsd:ctx.topModel===null || !small?null:round(knownSum(search.map(request=>priceAt(ctx.smallModel,request.values))))};
  // Shipped, from the commit join. A merged branch is one change: the merge commit and the branch it
  // brought in count once, as a merge, and merge commits are not counted again as commits.
  const joined=ctx.shipped;
  const allCommits=(joined?.commits ?? []).filter(commit=>commit.at>=period.start && commit.at<period.end);
  const commits=allCommits.filter(commit=>!commit.merge);
  const branches=(joined?.branches ?? []).filter(branch=>branch.at>=period.start && branch.at<period.end);
  const written=new Map();
  for(const write of session.writes)if(write.at>=period.start && write.at<period.end)written.set(write.repo,(written.get(write.repo) ?? 0)+1);
  const unreadable=[...written.keys()].some(repo=>ctx.unreadRepos.has(repo));
  const repos=[...new Set([...allCommits.map(commit=>commit.repo),...[...written].sort((a,b)=>b[1]-a[1]).map(([repo])=>repo)])]
    .map(repo=>path.basename(repo)).filter(name=>name && name!=='.' && name!=='..').slice(0,MAX_REPOS);
  const units=new Set([...allCommits.filter(commit=>commit.merge).map(commit=>`${commit.repo}\0${commit.mergedTip ?? commit.sha}`),
    ...branches.map(branch=>`${branch.repo}\0${branch.tip ?? branch.name}`)]);
  const merges=units.size;
  const shipped={estimated:true,commits:unreadable?null:commits.length,
    onMain:unreadable || commits.some(commit=>commit.onMain===null)?null:commits.filter(commit=>commit.onMain).length,
    merges:unreadable?null:merges,prsOpen:null,repos};
  // Live state, current period only.
  const current=period.key==='current';
  // The session's own thread and its subagents: a subagent still working keeps the session working.
  const lastAt=Math.max(session.live?.last ?? -Infinity,session.last ?? -Infinity,inPeriod.at(-1).at);
  const agentBusy=[...agents.values()].some(span=>ctx.now-span.last<=RUNNING_MS);
  const running=current && (ctx.matched || ctx.now-lastAt<=RUNNING_MS);
  let state=null;
  if(running) {
    const ended=session.live?.stop==='end_turn' && session.live?.pending===0 && session.live?.lastRole!=='user';
    state=ctx.now-lastAt>IDLE_MS?'idle':ended && !agentBusy?'waiting':'working';
  }
  const recent=requests.filter(request=>request.at>=ctx.now-RATE_MS && request.at<=ctx.now);
  return {id:ledgerId(source.id,session.id),title:session.title ?? null,
    origin:session.origin==='headless' || session.origin==='interactive'?session.origin:null,task:isWorkKind(session.task)?session.task:null,repo:repoName(session.gitRepo),startedAt:iso(inPeriod[0].at),lastActiveAt:iso(inPeriod.at(-1).at),
    running,state,ratePerHour:running && !session.unknownTokens?round(knownSum(recent.map(request=>request.usd))*3600000/RATE_MS):null,
    tokens,apiUsd,
    models:[...models.values()].map(model=>({model:model.model,apiUsd:session.unknownTokens?null:round(knownSum(model.usd)),outputTokens:model.outputTokens}))
      .sort((a,b)=>byUsd(a,b) || b.outputTokens-a.outputTokens),
    subagents,kinds,fanout,shipped,signals,
    // Kept for the period's day totals, removed before the row leaves.
    _requests:inPeriod,_commits:commits};
}

function otherOf(rows) {
  if(!rows.length)return null;
  const known=rows.map(row=>row.shipped);
  return {count:rows.length,apiUsd:round(knownSum(rows.map(row=>row.apiUsd))),subagents:rows.reduce((sum,row)=>sum+row.subagents,0),
    shipped:{estimated:true,commits:knownSum(known.map(row=>row.commits)),onMain:knownSum(known.map(row=>row.onMain)),
      merges:knownSum(known.map(row=>row.merges)),prsOpen:null,repos:[...new Set(known.flatMap(row=>row.repos))].slice(0,MAX_REPOS)}};
}

// The calendar dates (in the snapshot's time zone) from the period's start to its last moment so far.
// Dates are stepped as dates, not in hours, so a day that has only just begun or a day that is 23 or
// 25 hours long is never skipped.
export function periodDates(start,end,timeZone) {
  if(!(end>start))return [];
  const first=dayKey(start,timeZone),last=dayKey(end-1,timeZone),dates=[];
  for(let date=first;date<=last && dates.length<64;) {
    dates.push(date);
    const next=new Date(`${date}T12:00:00Z`);next.setUTCDate(next.getUTCDate()+1);
    date=next.toISOString().slice(0,10);
  }
  return dates;
}

function daysOf(period,rows,unknownSessions,now,timeZone) {
  const dates=periodDates(period.start,Math.min(period.end,now),timeZone);
  const usd=new Map(dates.map(date=>[date,[]])),onMain=new Map(dates.map(date=>[date,[]]));
  for(const row of rows) {
    for(const request of row._requests)usd.get(dayKey(request.at,timeZone))?.push(unknownSessions.has(row)?null:request.usd);
    for(const commit of row._commits)onMain.get(dayKey(commit.at,timeZone))?.push(row.shipped.onMain===null?null:commit.onMain?1:0);
  }
  return dates.map(date=>({date,apiUsd:round(knownSum(usd.get(date))),onMain:knownSum(onMain.get(date))}));
}

function topModelOf(requests) {
  const used=[...new Set(requests.map(request=>request.model))].filter(model=>rateOf(model));
  return used.sort((a,b)=>rates[b][3]-rates[a][3] || a.localeCompare(b))[0] ?? null;
}

// read: the result of scripts/sources/index.mjs readLedgerSources. limits: {claudeLimits, quota}.
// live: this computer's readSessions row. git and cache are passed through to the commit join.
export async function buildLedger({host,read,limits={},live=null,now=Date.now(),timeZone=TIME_ZONE,git,cache=null,join=joinCommits,deadline=Infinity}) {
  const collectedAt=iso(now);
  const plans=read.tools.map(tool=>({tool,periods:periodsFor(tool.source,limits,now)}));
  const since=Math.min(...plans.flatMap(plan=>plan.periods.map(period=>period.start)),now);
  const everyone=plans.flatMap(({tool})=>tool.status==='ok'?tool.sessions.map(session=>({key:`${tool.source.id}:${session.id}`,writes:session.writes,branches:session.branches})):[]);
  let joined={shipped:new Map(),unread:new Set(),stats:null},joinFailed=false;
  try {joined=await join(everyone,{since,until:now,...(git?{git}:{}),cache,deadline});} catch {joinFailed=true;}
  const tools=[];
  for(const {tool,periods} of plans) {
    const {source}=tool;
    if(tool.status!=='ok') {tools.push({tool:source.id,name:source.name,limitEngine:source.limitEngine,status:'unavailable',periods:[]});continue;}
    const pricedRequests=priced(tool.sessions);
    const matched=liveMatches(source,tool.sessions,live);
    const smallModel=smallModelOf(source);
    const out=[];
    for(const period of periods) {
      const all=tool.sessions.flatMap(session=>pricedRequests.get(session).filter(request=>request.at>=period.start && request.at<period.end));
      const topModel=topModelOf(all);
      const rows=[],unknownSessions=new Set();
      for(const session of tool.sessions) {
        const requests=pricedRequests.get(session);
        const key=`${source.id}:${session.id}`;
        const agentStarts=new Map();
        for(const request of requests)if(request.agent && !agentStarts.has(request.agent))agentStarts.set(request.agent,request.at);
        const shipped=joined.shipped.get(key);
        const ctx={now,topModel,smallModel,kinds:new Map(session.agents.map(agent=>[agent.key,agent.kind])),
          agentStarts,ownAgents:new Set(agentStarts.keys()),matched:matched.has(session),
          resumes:source.autoResume?autoResumes(session,requests):null,
          shipped:joinFailed?null:shipped ?? {commits:[],branches:[]},
          unreadRepos:joinFailed?new Set(session.writes.map(write=>write.repo)):joined.unread};
        const row=sessionRow(source,session,requests,period,ctx);
        if(!row)continue;
        if(session.unknownTokens)unknownSessions.add(row);
        rows.push(row);
      }
      rows.sort((a,b)=>byUsd(a,b) || b.lastActiveAt.localeCompare(a.lastActiveAt));
      const days=daysOf(period,rows,unknownSessions,now,timeZone);
      const strip=({_requests,_commits,...row})=>row;
      out.push({key:period.key,start:iso(period.start),end:iso(period.end),windowKnown:period.windowKnown,
        apiUsd:round(knownSum(rows.map(row=>row.apiUsd))),sessionCount:rows.length,
        sessions:rows.slice(0,LEDGER_TOP).map(strip),other:otherOf(rows.slice(LEDGER_TOP)),days});
    }
    tools.push({tool:source.id,name:source.name,limitEngine:source.limitEngine,status:'ok',periods:out});
  }
  const status=tools.length && tools.every(tool=>tool.status!=='ok')?'unavailable':'ok';
  return {row:{host,status,collectedAt,tools},stats:joined.stats};
}
