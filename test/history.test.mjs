import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readdir,readFile,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {buildSnapshot,collect} from '../scripts/collect.mjs';
import {collectClaudeUsage} from '../scripts/read-claude-usage.mjs';
import {openTokenStore,keepTokenDays} from '../scripts/token-store.mjs';
import {combine} from '../lib/combine.mjs';
import {activityView} from '../lib/view-activity.mjs';
import {tokensView} from '../lib/view-tokens.mjs';
import {withFolder,testConfig} from './helpers.mjs';

const DAY=86400000;
const usage=(input,output)=>({input_tokens:input,cache_read_input_tokens:0,cache_creation_input_tokens:0,output_tokens:output});
const reply=(id,timestamp,values)=>JSON.stringify({type:'assistant',timestamp,requestId:`r-${id}`,
  message:{role:'assistant',id:`m-${id}`,model:'claude-sonnet-4-20250514',usage:values,content:'synthetic'}})+'\n';
const quiet={screenTime:false,codex:false,codexLimits:false,claudeCode:true,claudeLimits:false};

async function folderBytes(folder) {
  let total=0;
  for(const entry of await readdir(folder,{withFileTypes:true})) {
    const full=path.join(folder,entry.name);
    total+=entry.isDirectory()?await folderBytes(full):(await stat(full)).size;
  }
  return total;
}

test('a day whose Claude Code logs were deleted keeps its tokens from the saved daily totals',t=>withFolder(async folder=>{
  const claude=path.join(folder,'claude'),data=path.join(folder,'data');
  await mkdir(path.join(claude,'projects','fictional'),{recursive:true});
  const old=path.join(claude,'projects','fictional','old.jsonl');
  await writeFile(old,reply('a','2026-09-20T15:00:00Z',usage(1000,200)));
  await writeFile(path.join(claude,'projects','fictional','new.jsonl'),reply('b','2026-10-20T15:00:00Z',usage(300,40)));
  const config=testConfig(data,{sources:quiet});
  const readers={claudeCode:()=>collectClaudeUsage(claude)};
  const run=async(at,keep)=>{
    const store=keep?await openTokenStore(data):null;
    try {
      const {data:snapshot}=await buildSnapshot(config,readers,{now:new Date(at),keepDays:store?(engine,days)=>keepTokenDays(store,engine,days):null});
      return Object.fromEntries(snapshot.providerTokenSources[0].days.map(day=>[day.date,day.totalTokens]));
    } finally {store?.close();}
  };
  const before=await run('2026-10-21T12:00:00Z',true);
  assert.deepEqual(before,{'2026-09-20':1200,'2026-10-20':340});
  await rm(old);
  const withoutStore=await run('2026-10-21T12:05:00Z',false);
  const withStore=await run('2026-10-21T12:05:00Z',true);
  t.diagnostic(`before deletion: ${JSON.stringify(before)}`);
  t.diagnostic(`after deletion, logs only: ${JSON.stringify(withoutStore)}`);
  t.diagnostic(`after deletion, with saved totals: ${JSON.stringify(withStore)}`);
  assert.deepEqual(withoutStore,{'2026-10-20':340});
  assert.deepEqual(withStore,before);
}));

test('a saved day is replaced only by a count at least as large, and prices follow the current table',()=>withFolder(async folder=>{
  const store=await openTokenStore(folder);
  try {
    const model=(totalTokens,apiEstimate)=>({model:'claude-sonnet-4-20250514',inputTokens:totalTokens,cacheReadTokens:0,cacheCreationTokens:0,outputTokens:0,totalTokens,requestCount:1,...(apiEstimate?{apiEstimate}:{})});
    const day=(date,totalTokens)=>({date,inputTokens:totalTokens,cacheReadTokens:0,cacheCreationTokens:0,outputTokens:0,totalTokens,requestCount:1,
      models:[model(totalTokens,{usd:999})],apiEstimate:{usd:999}});
    keepTokenDays(store,'claude',[day('2026-10-01',100),day('2026-10-02',50)]);
    const kept=keepTokenDays(store,'claude',[day('2026-10-01',40),day('2026-10-02',80)]);
    assert.deepEqual(kept.map(row=>[row.date,row.totalTokens]),[['2026-10-01',100],['2026-10-02',80]]);
    assert.ok(kept.every(row=>row.apiEstimate.usd!==999 && row.models[0].apiEstimate.usd!==999));
    assert.deepEqual(keepTokenDays(store,'codex',[]),[]);
    assert.throws(()=>keepTokenDays(store,'other',[]),/Unknown token engine/);
  } finally {store.close();}
}));

const at=index=>new Date(Date.parse('2025-10-01T21:00:00Z')+index*7*DAY);
const dateOf=time=>new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(time);
const counts=n=>({inputTokens:n,cacheReadTokens:20*n,cacheCreationTokens:2*n,outputTokens:3*n});
const total=n=>26*n;
function claudeRaw(now) {
  const days=[];
  // Claude Code keeps 30 days of transcripts, so each run sees only the last 30 days.
  for(let back=29;back>=0;back--) {
    const date=dateOf(new Date(now-back*DAY));
    const models=[['claude-opus-4-1-20250805',900],['claude-sonnet-4-20250514',400]].map(([model,n])=>({model,...counts(n),totalTokens:total(n),requestCount:5}));
    const hours=Array(24).fill(0);hours[14]=total(900);hours[15]=total(400);
    days.push({date,...counts(1300),totalTokens:total(1300),requestCount:10,models,hours});
  }
  return {provider:'claude-code',status:'ok',days};
}
function codexRaw(now) {
  const rows=[];
  for(let back=29;back>=0;back--) {
    const date=dateOf(new Date(now-back*DAY));
    for(const [model,n] of [['gpt-5.1-codex',700],['gpt-5.1-codex-mini',200]])
      rows.push({date,model,effort:'high',speed:'standard',...counts(n),reasoningOutputTokens:n,totalTokens:total(n)});
  }
  return {profiles:rows,tools:[],tokenProfiles:rows};
}
function screenRaw(now) {
  const start=new Date(now-7*DAY).toISOString(),end=new Date(now).toISOString();
  const intervals=[];
  for(let back=6;back>=0;back--) {
    const day=dateOf(new Date(now-back*DAY));
    intervals.push({start:`${day}T13:00:00.000Z`,end:`${day}T17:00:00.000Z`,category:'Editors',app:'VS Code'},
      {start:`${day}T17:00:00.000Z`,end:`${day}T19:00:00.000Z`,category:'Browser',app:'Safari'});
  }
  return {start,end,intervals,trackingIntervals:intervals.map(({start,end})=>({start,end}))};
}

test('a year of simulated daily history keeps the data folder under 2 MB and drops nothing',{timeout:120000},t=>withFolder(async folder=>{
  const config=testConfig(folder,{sources:{screenTime:true,codex:true,codexLimits:false,claudeCode:true,claudeLimits:false}});
  const weeks=53;
  for(let index=0;index<weeks;index++) {
    const now=at(index).getTime();
    await collect(config,{now:()=>at(index),readers:{
      screenTime:async()=>screenRaw(now),
      codex:async()=>codexRaw(now),
      claudeCode:async()=>claudeRaw(now),
    }});
  }
  const snapshot=JSON.parse(await readFile(path.join(folder,'public','local','usage.json'),'utf8'));
  const first=dateOf(new Date(at(0).getTime()-29*DAY)),last=dateOf(at(weeks-1));
  const span=Math.round((Date.parse(last)-Date.parse(first))/DAY)+1;
  const claude=snapshot.providerTokenSources[0].days,codex=snapshot.tokens[0].days;
  const screen=snapshot.activityHistory.find(row=>row.host==='Mac').days;
  const bytes=await folderBytes(folder);
  t.diagnostic(`${weeks} weekly runs, ${first} to ${last}: Claude Code ${claude.length} days, Codex ${codex.length} days, screen time ${screen.length} days`);
  t.diagnostic(`data folder ${bytes} bytes (${(bytes/1048576).toFixed(2)} MB)`);
  assert.equal(claude.length,span);
  assert.equal(codex.length,span);
  assert.equal(claude[0].date,first);
  assert.ok(claude.every(day=>day.totalTokens===total(1300)));
  assert.ok(screen.length>=weeks*7);
  assert.ok(bytes<2*1048576,`${bytes} bytes`);
  const combined=combine([{host:'Mac',snapshot}],{now:at(weeks-1).getTime()});
  const all=tokensView(combined.view,{host:'Mac',period:'all',now:at(weeks-1).getTime()});
  assert.equal(all.claude.totals.total,span*total(1300));
  assert.equal(all.claude.since,first);
  const seconds=screen.reduce((sum,day)=>sum+day.seconds,0);
  assert.ok(seconds>=weeks*7*6*3600);
  assert.equal(activityView(combined.view,{host:'Mac',period:'all',now:at(weeks-1).getTime()}).total,seconds);
}));
