import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLedger,periodsFor,smallModelOf,periodDates,WEEK_MS,IDLE_MS} from '../scripts/ledger.mjs';
import {claude,codex} from '../scripts/sources/index.mjs';
import {workKind} from '../scripts/ledger-kinds.mjs';
import {ledgerFlags,flagText,MAX_FLAGS,FANOUT_MIN_SUBAGENTS,RETRY_MIN} from '../lib/ledger-flags.mjs';
import {cleanLedgerRow,titleHash} from '../scripts/snapshot-clean.mjs';
import {titleSalt} from '../lib/private-folder.mjs';
import {weekView,weekFeed} from '../lib/view-week.mjs';
import {stat,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fitLedger} from '../scripts/snapshot-size.mjs';
import {LEDGER_TOP,WORK_KINDS} from '../lib/ledger-shape.mjs';
import {buildSnapshot} from '../scripts/collect.mjs';
import {combine} from '../lib/combine.mjs';
import {parseConfig} from '../lib/config.mjs';
import {testConfig,ownSnapshot,withFolder} from './helpers.mjs';
import {makeRepo} from './ledger-fixtures.mjs';

const NOW=Date.parse('2026-11-12T18:00:00Z');
const MIN=60000;
const byJson=(a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b));
const RESET=NOW+2*86400000;
const claudeLimits={status:'ok',windows:[{bucket:'claude',window:'seven_day',durationMinutes:10080,remainingPercent:40,resetsAt:new Date(RESET).toISOString()}]};
const noJoin=async()=>({shipped:new Map(),unread:new Set(),stats:null});

let counter=0;
function session(overrides={}) {
  const id=overrides.id ?? `session-${++counter}`;
  return {id,title:'Water the ferns',first:NOW-3*3600000,last:NOW-2*3600000,
    requests:[{key:`${id}-1`,at:NOW-3*3600000,model:'claude-opus-5-5',values:[1000,10000,500,2000],agent:null}],
    agents:[],writes:[],branches:[],runs:[],rateLimits:[],typed:[],unknownTokens:false,
    live:{last:NOW-2*3600000,stop:'end_turn',lastRole:'assistant',pending:0},repo:'/home/fern/code/ferns',...overrides};
}
const readOf=(sessions,source=claude)=>({tools:[{source,status:'ok',sessions}]});
const build=(sessions,options={})=>buildLedger({host:'Mac',read:readOf(sessions,options.source),limits:{claudeLimits},now:NOW,join:noJoin,...options});
const current=row=>row.tools[0].periods.find(period=>period.key==='current');

test('periods come from the weekly reset, else the last 7 days with windowKnown false',()=>{
  const [now,before]=periodsFor(claude,{claudeLimits},NOW);
  assert.deepEqual([now.start,now.end,now.windowKnown],[RESET-WEEK_MS,RESET,true]);
  assert.deepEqual([before.start,before.end],[RESET-2*WEEK_MS,RESET-WEEK_MS]);
  const [guess]=periodsFor(claude,{},NOW);
  assert.deepEqual([guess.start,guess.end,guess.windowKnown],[NOW-WEEK_MS,NOW,false]);
  const quota={windows:[{bucket:'codex',window:'secondary',durationMinutes:10080,resetsAt:new Date(RESET).toISOString()},
    {bucket:'codex',window:'primary',durationMinutes:300,resetsAt:new Date(NOW+3600000).toISOString()}]};
  assert.equal(periodsFor(codex,{quota},NOW)[0].end,RESET);
  assert.equal(periodsFor(claude,{claudeLimits:{windows:[{window:'seven_day',resetsAt:new Date(NOW-1000).toISOString()}]}},NOW)[0].windowKnown,false,'a passed reset is not a window');
});

test('a session row prices its requests, splits kinds by model and lists subagent fan-out',async()=>{
  const s=session({agents:[{key:'a1',kind:'search'},{key:'a2',kind:'review'}],requests:[
    {key:'m1',at:NOW-60*MIN,model:'claude-opus-5-5',values:[100,1000,0,200],agent:null},
    {key:'m2',at:NOW-50*MIN,model:'claude-opus-5-5',values:[100,1000,0,200],agent:'a1'},
    {key:'m3',at:NOW-40*MIN,model:'claude-haiku-5-5',values:[100,1000,0,200],agent:'a2'}]});
  const {row}=await build([s]);
  const [listed]=current(row).sessions;
  assert.match(listed.id,/^[0-9a-f]{12}$/);
  assert.equal(listed.subagents,2);
  assert.deepEqual(listed.tokens,{input:300,output:600,cacheRead:3000,cacheWrite:0});
  assert.deepEqual(listed.kinds.map(part=>[part.kind,part.model,part.subagents]).sort(byJson),
    [['main','claude-opus-5-5',0],['review','claude-haiku-5-5',1],['search','claude-opus-5-5',1]].sort(byJson));
  assert.ok(listed.kinds.every(part=>WORK_KINDS.includes(part.kind)));
  assert.ok(listed.fanout.length>=1 && listed.fanout.every(point=>point.count>=1));
  // The search subagent ran on the top model this week. Priced at the small model it costs less.
  assert.ok(listed.signals.searchOnTopModelUsd>listed.signals.searchOnSmallModelUsd);
  assert.equal(smallModelOf(claude),'claude-haiku-5-5');
  assert.equal(listed.signals.autoResumeUsd,0);
});

test('a request a fork copied is counted once',async()=>{
  const shared={key:'shared',at:NOW-60*MIN,model:'claude-opus-5-5',values:[100,0,0,100],agent:null};
  const {row}=await build([session({id:'parent',first:NOW-70*MIN,requests:[shared]}),session({id:'fork',first:NOW-30*MIN,requests:[shared,{...shared,key:'own'}]})]);
  const sessions=current(row).sessions;
  assert.equal(sessions.reduce((sum,row)=>sum+row.tokens.output,0),200);
});

test('Unknown stays Unknown: an unpriced model, a fork without its parent, a Codex limit hit',async()=>{
  const {row}=await build([session({requests:[{key:'x',at:NOW-MIN,model:'claude-future-9',values:[1,1,1,1],agent:null}]}),session()]);
  const period=current(row);
  assert.equal(period.apiUsd,null);
  assert.equal(period.sessions.find(listed=>listed.models[0].model==='claude-future-9').apiUsd,null);
  assert.ok(period.days.some(day=>day.apiUsd===null));
  const forked=await build([session({unknownTokens:true})]);
  assert.equal(current(forked.row).sessions[0].apiUsd,null);
  const fromCodex=await build([session({rateLimits:null,requests:[{key:'c',at:NOW-MIN,model:'gpt-6-sol',values:[1,1,0,1],agent:null}]})],{source:codex});
  assert.equal(current(fromCodex.row).sessions[0].signals.autoResumeUsd,null);
  const failed=await build([session({writes:[{repo:'/home/fern/code/ferns',at:NOW-3*3600000}]})],{join:async()=>{throw Error('git');}});
  assert.equal(current(failed.row).sessions[0].shipped.commits,null);
});

test('at most LEDGER_TOP sessions are listed and the rest are summed in other',async()=>{
  const many=Array.from({length:LEDGER_TOP+3},(_,index)=>session({requests:[{key:`k${index}`,at:NOW-MIN*(index+1),model:'claude-sonnet-5-5',values:[10,0,0,10*(index+1)],agent:null}]}));
  const period=current((await build(many)).row);
  assert.equal(period.sessions.length,LEDGER_TOP);
  assert.equal(period.sessionCount,LEDGER_TOP+3);
  assert.equal(period.other.count,3);
  assert.ok(Math.abs(period.apiUsd-(period.sessions.reduce((sum,row)=>sum+row.apiUsd,0)+period.other.apiUsd))<1e-6);
});

test('running and state: working, waiting and idle',async()=>{
  const working=session({last:NOW-MIN,live:{last:NOW-MIN,stop:'tool_use',lastRole:'assistant',pending:1}});
  const waiting=session({last:NOW-2*MIN,live:{last:NOW-2*MIN,stop:'end_turn',lastRole:'assistant',pending:0}});
  const gone=session({last:NOW-3*3600000,live:{last:NOW-3*3600000,stop:'end_turn',lastRole:'assistant',pending:0},repo:'/home/fern/code/moss'});
  const live={status:'ok',sessions:[{engine:'claude',repo:'moss'}]};
  const {row}=await build([working,waiting,gone],{live});
  const states=current(row).sessions.map(listed=>[listed.running,listed.state]).sort(byJson);
  assert.deepEqual(states,[[true,'idle'],[true,'waiting'],[true,'working']].sort(byJson));
  assert.ok(IDLE_MS>5*MIN);
  const previous=row.tools[0].periods.find(period=>period.key==='previous');
  assert.ok(previous.sessions.every(listed=>!listed.running && listed.state===null));
});

test('auto-resume counts spend after a limit hit only when nobody typed',async()=>{
  const hit=NOW-5*3600000;
  const requests=[{key:'r1',at:hit+3600000,model:'claude-opus-5-5',values:[0,0,0,100000],agent:null}];
  const own=await build([session({rateLimits:[hit],typed:[],requests})]);
  assert.ok(current(own.row).sessions[0].signals.autoResumeUsd>0);
  const typed=await build([session({rateLimits:[hit],typed:[hit+3000000],requests})]);
  assert.equal(current(typed.row).sessions[0].signals.autoResumeUsd,0);
});

test('work kinds come from the agent type, then the task',()=>{
  assert.equal(workKind('Explore','anything'),'search');
  assert.equal(workKind('Plan','anything'),'design');
  assert.equal(workKind('general-purpose','Review the parser change'),'review');
  assert.equal(workKind('general-purpose','Audit the hook'),'review');
  assert.equal(workKind('general-purpose','Run the suite on the server'),'test');
  assert.equal(workKind('general-purpose','Investigate the slow start'),'research');
  assert.equal(workKind('general-purpose','Find where titles are read'),'search');
  assert.equal(workKind('general-purpose','Draft the release notes'),'write');
  assert.equal(workKind('general-purpose','Fix the tray icon'),'build');
  assert.equal(workKind(null,'Lunch'),'other');
});

test('flags: fan-out without a merge, model fit, retry loop and auto-resume, ranked and capped',()=>{
  const base={title:'Rake leaves',apiUsd:40,subagents:0,shipped:{merges:1},signals:{}};
  const period={apiUsd:100,sessions:[
    {...base,id:'aaaaaaaaaaaa',subagents:FANOUT_MIN_SUBAGENTS,shipped:{merges:0}},
    {...base,id:'bbbbbbbbbbbb',signals:{searchOnTopModelUsd:30,searchOnSmallModelUsd:1}},
    {...base,id:'cccccccccccc',signals:{longestRetry:RETRY_MIN,retryTool:'Shell'}},
    {...base,id:'dddddddddddd',signals:{autoResumeUsd:12}},
    {...base,id:'eeeeeeeeeeee',title:null,signals:{autoResumeUsd:3}},
    {...base,id:'ffffffffffff',subagents:FANOUT_MIN_SUBAGENTS,shipped:{merges:null}},
  ]};
  const flags=ledgerFlags(period,50);
  assert.equal(flags.length,MAX_FLAGS);
  assert.deepEqual(flags.map(flag=>flag.kind),['fanout','model-fit','auto-resume','auto-resume']);
  assert.equal(flags[0].values.share,20);
  assert.equal(flagText(flags[0]),'Rake leaves fanned out to 15 subagents and took 20% of the week. No branch merged.');
  assert.match(flagText(flags[3]),/^A session went on by itself/);
  assert.match(flagText({kind:'retry-loop',sessionId:'c',values:{title:'Rake leaves',count:5,tool:'Shell'}}),/retried one Shell call 5 times/);
  assert.deepEqual(ledgerFlags({apiUsd:null,sessions:[]},null),[]);
});

test('privacy: titles hash away when off, repository names cannot be paths, and the row holds no path',async()=>{
  const s=session({writes:[{repo:'/home/fern/code/ferns',at:NOW-3*3600000}]});
  const {row}=await build([s],{join:async sessions=>({unread:new Set(),stats:null,shipped:new Map([[sessions[0].key,
    {commits:[{repo:'/home/fern/code/ferns',sha:'abc',at:NOW-170*MIN,onMain:true,merge:false}],branches:[]}]])})});
  const text=JSON.stringify(row);
  assert.ok(!text.includes('/home/fern'),'no absolute path leaves the collector');
  assert.deepEqual(current(row).sessions[0].shipped.repos,['ferns']);
  assert.equal(current(row).sessions[0].shipped.onMain,1);
  const off=cleanLedgerRow(row,{titles:false});
  const listed=current(off).sessions[0];
  assert.equal(listed.title,null);
  assert.match(listed.titleHash,/^[0-9a-f]{12}$/);
  assert.ok(!JSON.stringify(off).includes('Water the ferns'));
  assert.equal(current(cleanLedgerRow(row)).sessions[0].title,'Water the ferns');
  const tampered=structuredClone(row);
  current(tampered).sessions[0].shipped.repos=['/etc/passwd','ferns','../up'];
  assert.deepEqual(current(cleanLedgerRow(tampered)).sessions[0].shipped.repos,['ferns']);
  current(tampered).sessions[0].kinds[0].kind='mystery';
  assert.throws(()=>cleanLedgerRow(tampered));
});

test('the snapshot carries this computer\'s ledger row and the other computer as not connected',async()=>withFolder(async folder=>{
  const read=readOf([session()]);
  const readers={ledger:async()=>read,claudeLimits:async()=>claudeLimits};
  const config=testConfig(folder,{sources:{claudeCode:true},sessions:{titles:false}});
  const {data}=await buildSnapshot(config,readers,{now:new Date(NOW)});
  assert.equal(data.ledger.length,2);
  assert.equal(data.ledger[0].status,'ok');
  assert.equal(current(data.ledger[0]).sessions[0].title,null);
  assert.equal(current(data.ledger[0]).sessions[0].titleHash,titleHash('Water the ferns',await titleSalt(folder)),'hashed with this install\'s salt');
  assert.deepEqual(data.ledger[1],{host:'Windows',status:'not-connected'});
  const off=await buildSnapshot(testConfig('/unused',{sources:{}}),readers,{now:new Date(NOW)});
  assert.deepEqual(off.data.ledger[0],{host:'Mac',status:'not-connected'});
}));

test('the title hash is keyed with a random secret kept once per install in the private folder',async()=>withFolder(async folder=>{
  const salt=await titleSalt(folder);
  assert.match(salt,/^[0-9a-f]{64}$/);
  assert.equal(await titleSalt(folder),salt,'the same secret every time');
  const file=path.join(folder,'private-ledger','title-salt');
  assert.equal((await readFile(file,'utf8')).trim(),salt);
  if(process.platform!=='win32')assert.equal((await stat(file)).mode & 0o077,0);
  assert.notEqual(titleHash('Fix tests',salt),titleHash('Fix tests','another install'));
  assert.equal(titleHash('Fix tests',salt),titleHash('Fix tests',salt));
}));

test('the hub applies its own titles setting to every computer, keeps a hash it receives, and shows it as a short label',async()=>{
  const {row}=await build([session()]);
  const mac=ownSnapshot('Mac',NOW,snapshot=>({...snapshot,ledger:[row,{host:'Windows',status:'not-connected'}]}));
  // The other computer keeps titles on and sends them.
  const pc=ownSnapshot('Windows',NOW,snapshot=>({...snapshot,ledger:[{...row,host:'Windows'}]}));
  const salt='a'.repeat(64);
  const hidden=combine([{host:'Mac',snapshot:mac},{host:'Windows',snapshot:pc}],{now:NOW,titles:false,salt});
  const text=JSON.stringify(hidden);
  assert.ok(!text.includes('Water the ferns'),'no title from any computer in the combined file');
  const sessions=hidden.view.ledger.map(entry=>current(entry).sessions[0]);
  assert.ok(sessions.every(listed=>listed.title===null && listed.titleHash===titleHash('Water the ferns',salt)));
  // A computer with titles off sends only the hash. A hub with titles on keeps it.
  const pcOff=ownSnapshot('Windows',NOW,snapshot=>({...snapshot,ledger:[cleanLedgerRow({...row,host:'Windows'},{titles:false,salt:'b'.repeat(64)})]}));
  const shown=combine([{host:'Mac',snapshot:mac},{host:'Windows',snapshot:pcOff}],{now:NOW});
  const windows=current(shown.view.ledger.find(entry=>entry.host==='Windows')).sessions[0];
  assert.equal(windows.title,null);
  assert.equal(windows.titleHash,titleHash('Water the ferns','b'.repeat(64)));
  assert.equal(current(shown.view.ledger.find(entry=>entry.host==='Mac')).sessions[0].title,'Water the ferns');
  // Week shows a hashed session as a short stable label, not "Untitled session".
  const view=weekView({timezone:'UTC',week:weekFeed({...shown,generatedAt:new Date(NOW).toISOString()})},{now:NOW});
  const titles=view.table.rows.map(listed=>listed.title);
  assert.ok(titles.includes(`Session ${windows.titleHash.slice(0,4)}`),titles.join(', '));
  assert.ok(!titles.includes('Untitled session'));
});

test('combine keeps each computer\'s ledger row as it is',async()=>{
  const {row}=await build([session()]);
  const mac=ownSnapshot('Mac',NOW,snapshot=>({...snapshot,ledger:[row,{host:'Windows',status:'not-connected'}]}));
  const pc=ownSnapshot('Windows',NOW,snapshot=>({...snapshot,ledger:[{...row,host:'Windows'}]}));
  const view=combine([{host:'Mac',snapshot:mac},{host:'Windows',snapshot:pc}],{now:NOW}).view;
  assert.deepEqual(view.ledger.map(entry=>[entry.host,entry.status]),[['Mac','ok'],['Windows','ok']]);
  const alone=combine([{host:'Mac',snapshot:mac}],{now:NOW}).view;
  assert.deepEqual(alone.ledger.map(entry=>[entry.host,entry.status]),[['Mac','ok'],['Windows','not-connected']]);
});

test('an oversized ledger drops fan-out timelines first',()=>{
  const point={at:new Date(NOW).toISOString(),count:3};
  const data={ledger:[{host:'Mac',status:'ok',collectedAt:new Date(NOW).toISOString(),tools:[{periods:[{sessions:[{fanout:Array(5000).fill(point)}]}]}]}]};
  fitLedger(data,{budget:10000});
  assert.deepEqual(data.ledger[0].tools[0].periods[0].sessions[0].fanout,[]);
  fitLedger(data,{budget:10});
  assert.equal(data.ledger[0].status,'unavailable');
});

test('sessions.titles defaults to true and must be a boolean',()=>{
  const options={platform:'darwin',environment:{}};
  assert.equal(parseConfig({},options).sessions.titles,true);
  assert.equal(parseConfig({sessions:{titles:false}},options).sessions.titles,false);
  assert.throws(()=>parseConfig({sessions:{titles:'no'}},options),/sessions.titles/);
});

test('a request just after midnight counts on the new day, even on the day the clocks change',async()=>{
  const sumDays=period=>period.days.reduce((sum,day)=>sum+day.apiUsd,0);
  // UTC: now 00:20, one request at 00:15, the week starting at a later minute of the hour.
  const now=Date.parse('2026-11-12T00:20:00Z');
  const limits={claudeLimits:{status:'ok',windows:[{bucket:'claude',window:'seven_day',durationMinutes:10080,remainingPercent:40,resetsAt:'2026-11-14T15:45:00Z'}]}};
  const late=session({first:now-5*MIN,last:now-5*MIN,requests:[{key:'late',at:now-5*MIN,model:'claude-opus-5-5',values:[1000,0,0,1000],agent:null}]});
  const utc=current((await buildLedger({host:'Mac',read:readOf([late]),limits,now,timeZone:'UTC',join:noJoin})).row);
  assert.equal(utc.days.at(-1).date,'2026-11-12');
  assert.ok(utc.days.at(-1).apiUsd>0);
  assert.ok(Math.abs(sumDays(utc)-utc.apiUsd)<1e-9,'every request is on some day');
  // New York, the day after summer time ends (Nov 1 has 25 hours): now 00:20 Nov 2, a request at 00:15
  // and one late on Nov 1.
  const zone='America/New_York',nyNow=Date.parse('2026-11-02T05:20:00Z');
  const nyLimits={claudeLimits:{status:'ok',windows:[{bucket:'claude',window:'seven_day',durationMinutes:10080,remainingPercent:40,resetsAt:'2026-11-04T20:45:00Z'}]}};
  const requests=[{key:'n1',at:Date.parse('2026-11-02T04:30:00Z'),model:'claude-opus-5-5',values:[1000,0,0,1000],agent:null},
    {key:'n2',at:nyNow-5*MIN,model:'claude-opus-5-5',values:[1000,0,0,2000],agent:null}];
  const ny=current((await buildLedger({host:'Mac',read:readOf([session({first:requests[0].at,last:requests[1].at,requests})]),limits:nyLimits,now:nyNow,timeZone:zone,join:noJoin})).row);
  const dates=ny.days.map(day=>day.date);
  assert.deepEqual(dates,['2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01','2026-11-02']);
  assert.ok(ny.days.find(day=>day.date==='2026-11-01').apiUsd>0);
  assert.ok(ny.days.find(day=>day.date==='2026-11-02').apiUsd>0);
  assert.ok(Math.abs(sumDays(ny)-ny.apiUsd)<1e-9);
  assert.deepEqual(periodDates(Date.parse('2027-03-13T12:00:00Z'),Date.parse('2027-03-15T05:00:00Z'),zone),['2027-03-13','2027-03-14','2027-03-15']);
});

test('the collector saves what it read before the commit join, and gives the join a deadline',async()=>withFolder(async folder=>{
  const events=[];
  const cache={save:async()=>{events.push('save');},get:()=>{events.push('git');return undefined;},set:()=>{}};
  const repo=path.join(folder,'meadow');
  await makeRepo(repo,NOW-3600000);
  const read={...readOf([session({writes:[{repo,at:NOW-3*3600000}]})]),cache};
  const config=testConfig(folder,{sources:{claudeCode:true}});
  await buildSnapshot(config,{ledger:async()=>read,claudeLimits:async()=>claudeLimits},{now:new Date(NOW)});
  assert.equal(events[0],'save','the read is saved before git is asked');
  assert.ok(events.includes('git'));
  assert.equal(events.at(-1),'save','and again after, with what git said');
  let seen=null;
  await buildLedger({host:'Mac',read:readOf([session()]),limits:{claudeLimits},now:NOW,deadline:NOW+5,join:async(sessions,options)=>{seen=options.deadline;return noJoin();}});
  assert.equal(seen,NOW+5);
}));

test('a merged branch is one change: its merge commit and the branch count once, and the merge is not a commit',async()=>{
  const repo='/fictional/code/hedge';
  const shipped={commits:[{repo,sha:'c1',at:NOW-170*MIN,onMain:true,merge:false},{repo,sha:'m1',at:NOW-160*MIN,onMain:true,merge:true,mergedTip:'c1'}],
    branches:[{repo,name:'feature/trim',at:NOW-175*MIN,tip:'c1'}]};
  const {row}=await build([session({writes:[{repo,at:NOW-3*3600000}]})],{join:async sessions=>({unread:new Set(),stats:null,shipped:new Map([[sessions[0].key,shipped]])})});
  const listed=current(row).sessions[0].shipped;
  assert.deepEqual([listed.merges,listed.commits,listed.onMain],[1,1,1]);
  // Another branch merged by the same session is a second change.
  const two={...shipped,branches:[...shipped.branches,{repo,name:'feature/edge',at:NOW-175*MIN,tip:'c7'}]};
  const again=await build([session({writes:[{repo,at:NOW-3*3600000}]})],{join:async sessions=>({unread:new Set(),stats:null,shipped:new Map([[sessions[0].key,two]])})});
  assert.equal(current(again.row).sessions[0].shipped.merges,2);
});

test('a session row carries its origin, task and repository, and a tampered row is refused or cleaned',async()=>{
  const {row}=await build([session({origin:'headless',task:'review'}),session({origin:'bogus',task:'mystery',repo:os.homedir()})]);
  const [listed,odd]=current(row).sessions;
  assert.deepEqual([listed.origin,listed.task,listed.repo],['headless','review','ferns']);
  assert.deepEqual([odd.origin,odd.task,odd.repo],[null,null,null],'an unknown origin or task and the home folder are not kept');
  assert.ok(!JSON.stringify(row).includes('/home/fern'));
  const clean=cleanLedgerRow(row,{titles:false});
  assert.deepEqual([current(clean).sessions[0].origin,current(clean).sessions[0].task,current(clean).sessions[0].repo],['headless','review','ferns']);
  const old=structuredClone(row);
  for(const entry of current(old).sessions){delete entry.origin;delete entry.task;delete entry.repo;}
  assert.deepEqual([current(cleanLedgerRow(old)).sessions[0].origin,current(cleanLedgerRow(old)).sessions[0].task],[null,null],'a row from an older collector is accepted');
  const bad=structuredClone(row);
  current(bad).sessions[0].origin='bogus';
  assert.throws(()=>cleanLedgerRow(bad));
  const worse=structuredClone(row);
  current(worse).sessions[0].task='mystery';
  assert.throws(()=>cleanLedgerRow(worse));
  const path=structuredClone(row);
  current(path).sessions[0].repo='/etc/passwd';
  assert.equal(current(cleanLedgerRow(path)).sessions[0].repo,null);
});
