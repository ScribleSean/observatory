// Builds the ledger history's days (lib/r2-shape.mjs LedgerDay) from the source adapters' session records
// and the commit join. One record per tool and date, holding every session that was active that day.
// scripts/ledger-store.mjs keeps them, and shapes the snapshot's trimmed copy from them.
//
// Nothing here keeps a path, command or prompt in a day: sessions leave as a hashed id, the tool's title
// (only while titles are on), counts, model ids and repository folder names. The commit ids and repository
// paths the store needs to check commits on main again come back separately, in `commits`, and never
// enter a snapshot.
import path from 'node:path';
import {priced,ledgerId,repoName,knownSum,round} from './ledger.mjs';
import {dayKey} from './read-projects.mjs';
import {isWorkKind} from './ledger-kinds.mjs';
import {isRepoName} from '../lib/r2-shape.mjs';

const byUsd=(a,b)=>(b.apiUsd ?? -1)-(a.apiUsd ?? -1);

// Calendar dates, stepped as dates so a 23 or 25 hour day is never skipped.
export function addDays(date,count) {
  const day=new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate()+count);
  return day.toISOString().slice(0,10);
}
export function datesFrom(first,last) {
  const dates=[];
  for(let date=first;date<=last;date=addDays(date,1))dates.push(date);
  return dates;
}
// A time no later than the start of `date` in any time zone, for reading transcripts written since then.
export const dateFloorMs=date=>Date.parse(`${date}T00:00:00Z`)-15*3600000;

const emptyTokens=()=>({input:0,output:0,cacheRead:0,cacheWrite:0});
// A repository's folder name, as the snapshot keeps it. A name the snapshot's rule refuses (brackets, commas,
// over 64 characters) counts as 'other', so its commits still count and the history stays readable.
const folder=repo=>{const name=path.basename(repo);return !name || name==='.' || name==='..'?null:isRepoName(name)?name:'other';};
// The folder a session ran in, or null when its name fails the same rule.
const ranIn=gitRepo=>{const name=repoName(gitRepo);return isRepoName(name)?name:null;};
// A merged branch is one change: a merge commit and the branch it brought in count once.
const mergeUnits=(commits,branches)=>new Set([...commits.filter(commit=>commit.merge).map(commit=>`${commit.repo}\0${commit.mergedTip ?? commit.sha}`),
  ...branches.map(branch=>`${branch.repo}\0${branch.tip ?? branch.name}`)]);

// One session's part of one day, with the merge units it made (kept apart, to count each change once a day).
function sessionDay(source,session,part,{titles}) {
  const requests=part.requests.sort((a,b)=>a.at-b.at);
  const tokens=emptyTokens(),models=new Map(),kinds=new Map();
  for(const request of requests) {
    const [input,cacheRead,cacheWrite,output]=request.values;
    tokens.input+=input;tokens.cacheRead+=cacheRead;tokens.cacheWrite+=cacheWrite;tokens.output+=output;
    const model=models.get(request.model) ?? {model:request.model,usd:[],outputTokens:0};
    model.usd.push(request.usd);model.outputTokens+=output;models.set(request.model,model);
    const kind=request.agent?part.kindOf.get(request.agent) ?? 'other':'main';
    const group=kinds.get(kind) ?? {kind,usd:[],subagents:0};
    group.usd.push(request.usd);kinds.set(kind,group);
  }
  for(const agent of part.started) {
    const kind=part.kindOf.get(agent) ?? 'other';
    const group=kinds.get(kind) ?? {kind,usd:[],subagents:0};
    group.subagents++;kinds.set(kind,group);
  }
  const unknown=session.unknownTokens===true;
  const usd=values=>unknown?null:round(knownSum(values));
  const apiUsd=usd(requests.map(request=>request.usd));
  const repo=ranIn(session.gitRepo);
  // Shipped, per repository folder. A repository written in that day that git could not read is Unknown.
  const ship=new Map();
  const entry=name=>{
    if(!ship.has(name))ship.set(name,{repo:name,apiUsd:name===repo?apiUsd:0,commits:0,onMain:0,merges:0,units:new Set()});
    return ship.get(name);
  };
  for(const commit of part.commits.filter(commit=>!commit.merge)) {
    const name=folder(commit.repo);if(!name)continue;
    const row=entry(name);
    row.commits++;
    if(row.onMain!==null)row.onMain=commit.onMain===null?null:row.onMain+(commit.onMain?1:0);
  }
  for(const unit of mergeUnits(part.commits,part.branches)) {
    const name=folder(unit.split('\0')[0]);if(!name)continue;
    entry(name).units.add(unit);
  }
  for(const written of part.unread) {
    const name=folder(written);if(!name)continue;
    Object.assign(entry(name),{commits:null,onMain:null,merges:null});
  }
  const units=new Set();
  const ships=[...ship.values()].map(({units:own,...row})=>{
    for(const unit of own)units.add(unit);
    return {...row,merges:row.merges===null?null:own.size};
  }).sort((a,b)=>(b.commits ?? -1)-(a.commits ?? -1) || byUsd(a,b) || a.repo.localeCompare(b.repo));
  const times=[...requests.map(request=>request.at),...part.commits.map(commit=>commit.at)];
  return {row:{id:ledgerId(source.id,session.id),title:titles?session.title ?? null:null,
    origin:session.origin==='headless' || session.origin==='interactive'?session.origin:null,
    task:isWorkKind(session.task)?session.task:null,repo,
    firstAt:new Date(Math.min(...times)).toISOString(),lastAt:new Date(Math.max(...times)).toISOString(),
    apiUsd,tokens,
    models:[...models.values()].map(model=>({model:model.model,apiUsd:usd(model.usd),outputTokens:model.outputTokens}))
      .sort((a,b)=>byUsd(a,b) || b.outputTokens-a.outputTokens || a.model.localeCompare(b.model)),
    kinds:[...kinds.values()].map(group=>({kind:group.kind,apiUsd:usd(group.usd),subagents:group.subagents})).sort((a,b)=>byUsd(a,b) || a.kind.localeCompare(b.kind)),
    ship:ships},units,subagents:part.started.length};
}

// A day with nothing recorded is a known zero, not Unknown.
export function emptyDay(tool,date) {
  return {date,tool,status:'ok',apiUsd:0,sessionCount:0,subagents:0,tokens:emptyTokens(),models:[],kinds:[],origins:[],repos:[],
    ship:{commits:0,onMain:0,merges:0},sessions:[],other:null};
}

const sumOr=(values)=>knownSum(values);

function dayRecord(tool,date,parts) {
  if(!parts.length)return emptyDay(tool,date);
  const sessions=parts.map(part=>part.row);
  const models=new Map(),kinds=new Map(),origins=new Map(),repos=new Map(),units=new Set();
  const tokens=emptyTokens();
  for(const {row,units:own} of parts) {
    for(const key of Object.keys(tokens))tokens[key]+=row.tokens[key];
    for(const model of row.models) {
      const kept=models.get(model.model) ?? {model:model.model,usd:[],outputTokens:0};
      kept.usd.push(model.apiUsd);kept.outputTokens+=model.outputTokens;models.set(model.model,kept);
    }
    for(const kind of row.kinds) {
      const kept=kinds.get(kind.kind) ?? {kind:kind.kind,usd:[],subagents:0};
      kept.usd.push(kind.apiUsd);kept.subagents+=kind.subagents;kinds.set(kind.kind,kept);
    }
    const origin=row.origin ?? 'unknown';
    const kept=origins.get(origin) ?? {origin,usd:[],sessions:0};
    kept.usd.push(row.apiUsd);kept.sessions++;origins.set(origin,kept);
    const repoOf=name=>{
      if(!repos.has(name))repos.set(name,{repo:name,usd:[],commits:[],onMain:[],units:new Set(),merges:[]});
      return repos.get(name);
    };
    if(row.repo)repoOf(row.repo).usd.push(row.apiUsd);
    for(const ship of row.ship) {
      const repo=repoOf(ship.repo);
      repo.commits.push(ship.commits);repo.onMain.push(ship.onMain);
      if(ship.merges===null)repo.merges.push(null);
    }
    for(const unit of own) {
      units.add(unit);
      const name=folder(unit.split('\0')[0]);
      if(name)repoOf(name).units.add(unit);
    }
  }
  const ships=sessions.flatMap(row=>row.ship);
  const shipUnknown=ships.some(ship=>ship.merges===null);
  return {date,tool,status:'ok',
    apiUsd:round(sumOr(sessions.map(row=>row.apiUsd))),sessionCount:sessions.length,
    subagents:parts.reduce((sum,part)=>sum+part.subagents,0),tokens,
    models:[...models.values()].map(model=>({model:model.model,apiUsd:round(sumOr(model.usd)),outputTokens:model.outputTokens}))
      .sort((a,b)=>byUsd(a,b) || b.outputTokens-a.outputTokens || a.model.localeCompare(b.model)),
    kinds:[...kinds.values()].map(kind=>({kind:kind.kind,apiUsd:round(sumOr(kind.usd)),subagents:kind.subagents})).sort((a,b)=>byUsd(a,b) || a.kind.localeCompare(b.kind)),
    origins:[...origins.values()].map(origin=>({origin:origin.origin,apiUsd:round(sumOr(origin.usd)),sessions:origin.sessions})).sort((a,b)=>byUsd(a,b) || a.origin.localeCompare(b.origin)),
    repos:[...repos.values()].map(repo=>({repo:repo.repo,apiUsd:round(sumOr(repo.usd)),commits:sumOr(repo.commits),onMain:sumOr(repo.onMain),
      merges:repo.merges.length?null:repo.units.size})).sort((a,b)=>byUsd(a,b) || (b.commits ?? -1)-(a.commits ?? -1) || a.repo.localeCompare(b.repo)),
    ship:{commits:sumOr(ships.map(ship=>ship.commits)),onMain:sumOr(ships.map(ship=>ship.onMain)),merges:shipUnknown?null:units.size},
    sessions:sessions.sort((a,b)=>byUsd(a,b) || b.lastAt.localeCompare(a.lastAt) || a.id.localeCompare(b.id)),other:null};
}

/**
 * Days for each tool on the dates asked for.
 * @param {{tools: {source: object, sessions: object[], dates: string[]}[], joined: {shipped: Map, unread: Set} | null,
 *   timeZone: string, titles: boolean}} input  joined null: the commit join failed, so shipped work is Unknown where anything was written.
 * @returns {{days: object[], commits: {tool: string, date: string, session: string, repo: string, repoName: string, sha: string, onMain: boolean | null}[]}}
 */
export function buildLedgerHistory({tools,joined,timeZone,titles}) {
  const days=[],commits=[];
  for(const {source,sessions,dates} of tools) {
    const wanted=new Set(dates);
    const byDate=new Map(dates.map(date=>[date,[]]));
    const pricedRequests=priced(sessions);
    for(const session of sessions) {
      const key=`${source.id}:${session.id}`;
      const requests=pricedRequests.get(session);
      const shipped=joined?joined.shipped.get(key) ?? {commits:[],branches:[]}:{commits:[],branches:[]};
      const unreadRepos=joined?joined.unread:null;
      const kindOf=new Map(session.agents.map(agent=>[agent.key,agent.kind]));
      const parts=new Map();
      const part=date=>{
        if(!parts.has(date))parts.set(date,{requests:[],commits:[],branches:[],started:[],unread:new Set(),kindOf});
        return parts.get(date);
      };
      const seen=new Set();
      for(const request of requests) {
        const date=dayKey(request.at,timeZone);
        if(request.agent && !seen.has(request.agent)) {
          seen.add(request.agent);
          if(wanted.has(date))part(date).started.push(request.agent);
        }
        if(wanted.has(date))part(date).requests.push(request);
      }
      for(const commit of shipped.commits) {const date=dayKey(commit.at,timeZone);if(wanted.has(date))part(date).commits.push(commit);}
      for(const branch of shipped.branches) {const date=dayKey(branch.at,timeZone);if(wanted.has(date))part(date).branches.push(branch);}
      for(const write of session.writes) {
        const date=dayKey(write.at,timeZone);
        if(!parts.has(date))continue;
        if(!unreadRepos || unreadRepos.has(write.repo))part(date).unread.add(write.repo);
      }
      for(const [date,own] of parts) {
        if(!own.requests.length && !own.commits.length)continue;
        const built=sessionDay(source,session,own,{titles});
        byDate.get(date).push(built);
        for(const commit of own.commits.filter(commit=>!commit.merge)) {
          const name=folder(commit.repo);
          if(name && typeof commit.sha==='string')commits.push({tool:source.id,date,session:built.row.id,repo:commit.repo,repoName:name,sha:commit.sha,onMain:commit.onMain});
        }
      }
    }
    for(const date of dates)days.push(dayRecord(source.id,date,byDate.get(date)));
  }
  return {days,commits};
}
