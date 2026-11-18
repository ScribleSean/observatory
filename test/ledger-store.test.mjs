// The ledger history's private store (scripts/ledger-store.mjs) and the collection that fills it, from
// fictional transcripts and a throwaway git repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {withFolder,testConfig} from './helpers.mjs';
import {claudeAssistant,claudePrompt,claudeTitle,writeClaude,makeRepo,git} from './ledger-fixtures.mjs';
import {openLedgerStore,historyPlan,datesToBuild,gapKnownFrom,writeHistory,historyRow,recheckOnMain,keepGrokDays,applyOnMain,rebuildFrom} from '../scripts/ledger-store.mjs';
import {buildLedgerHistory,addDays} from '../scripts/ledger-history.mjs';
import {readLedgerSources,claude} from '../scripts/sources/index.mjs';
import {memoryCache} from '../scripts/sources/parse-cache.mjs';
import {buildSnapshot} from '../scripts/collect.mjs';
import {serializeSnapshot} from '../scripts/snapshot-size.mjs';
import {cleanLedgerHistory,REDERIVE_DAYS,SESSION_DAYS,ONMAIN_RECHECK_DAYS} from '../lib/r2-shape.mjs';
import {dayKey} from '../scripts/read-projects.mjs';
import {TIME_ZONE} from '../lib/timezone.mjs';

const DAY=86400000,HOUR=3600000,MIN=60000;
const NOW=Date.parse('2026-11-18T17:00:00Z');
const TODAY=dayKey(NOW,TIME_ZONE);
const opus=(key,at)=>({key,at,model:'claude-opus-5-5',values:[1000,10000,500,2000],agent:null});
const record=(id,at,overrides={})=>({id,title:'Mend the fence',first:at,last:at,requests:[opus(`${id}-r`,at)],agents:[],writes:[],branches:[],runs:[],
  rateLimits:[],typed:[],unknownTokens:false,live:null,repo:'/fictional/code/fence',gitRepo:'/fictional/code/fence',origin:'interactive',task:'build',...overrides});

test('the store is private and its plan backfills a new tool, rebuilds the window and fills a gap',()=>withFolder(async folder=>{
  const db=await openLedgerStore(folder);
  try {
    if(process.platform!=='win32')assert.equal((await stat(path.join(folder,'private-history'))).mode & 0o077,0);
    const plan=historyPlan(db,{tools:['claude','codex'],now:NOW,timeZone:TIME_ZONE});
    assert.deepEqual(plan.extra,{claude:{since:0,from:null},codex:{since:0,from:null}});
    assert.equal(plan.rebuild.length,REDERIVE_DAYS);
    assert.equal(plan.rebuild.at(-1),TODAY);
    const built=buildLedgerHistory({tools:[{source:claude,sessions:[record('a',NOW-HOUR)],dates:plan.rebuild}],joined:{shipped:new Map(),unread:new Set()},timeZone:TIME_ZONE,titles:true});
    writeHistory(db,{...built,backfilled:['claude']});
    assert.deepEqual(historyPlan(db,{tools:['claude'],now:NOW,timeZone:TIME_ZONE}).extra,{},'backfilled and current');
    // Twenty days later the collector comes back: the days in between are read from where it stopped.
    const later=NOW+20*DAY;
    const gap=historyPlan(db,{tools:['claude'],now:later,timeZone:TIME_ZONE}).extra.claude;
    assert.equal(gap.from,addDays(TODAY,1));
    assert.ok(gap.since<=Date.parse(`${gap.from}T00:00:00Z`)-14*HOUR,'read from before that date starts anywhere');
    const dates=datesToBuild({today:dayKey(later,TIME_ZONE),sessions:[],from:gap.from,timeZone:TIME_ZONE});
    assert.equal(dates[0],gap.from);
    // A gap that could not be read is held: its days are written, but it is read again next time.
    writeHistory(db,{...buildLedgerHistory({tools:[{source:claude,sessions:[],dates:[dayKey(later,TIME_ZONE)]}],joined:null,timeZone:TIME_ZONE,titles:true}),held:['claude']});
    assert.equal(historyPlan(db,{tools:['claude'],now:later,timeZone:TIME_ZONE}).extra.claude.from,gap.from);
    // A backfill builds from the first request it finds.
    const old=NOW-25*DAY;
    assert.equal(datesToBuild({today:TODAY,sessions:[record('b',old)],from:null,timeZone:TIME_ZONE})[0],dayKey(old,TIME_ZONE));
  } finally {db.close();}
}));

test('the snapshot row freezes old days, lists sessions for SESSION_DAYS, and reads an unread tool as unavailable',()=>withFolder(async folder=>{
  const db=await openLedgerStore(folder);
  try {
    const first=addDays(TODAY,-(SESSION_DAYS+9));
    const sessions=Array.from({length:SESSION_DAYS+10},(_,index)=>record(`s${index}`,Date.parse(`${addDays(first,index)}T17:00:00Z`)));
    const dates=Array.from({length:SESSION_DAYS+10},(_,index)=>addDays(first,index));
    writeHistory(db,{...buildLedgerHistory({tools:[{source:claude,sessions,dates}],joined:{shipped:new Map(),unread:new Set()},timeZone:TIME_ZONE,titles:true}),backfilled:['claude']});
    const row=historyRow(db,{host:'Mac',now:NOW,timeZone:TIME_ZONE,titles:false,unread:['codex']});
    const clean=cleanLedgerHistory(row,{titles:false});
    assert.equal(clean.firstDate,first);
    assert.equal(clean.sessionsFrom,addDays(TODAY,-(SESSION_DAYS-1)));
    const claudeDays=clean.days.filter(day=>day.tool==='claude');
    assert.equal(claudeDays[0].sessions.length,0,'older days keep totals');
    assert.equal(claudeDays[0].other.count,1,'and a compact row');
    assert.equal(claudeDays.at(-1).sessions.length,1);
    assert.equal(claudeDays.at(-1).sessions[0].title,null);
    assert.ok(claudeDays.filter(day=>day.frozen).every(day=>day.date<rebuildFrom(TODAY)));
    assert.equal(claudeDays.filter(day=>!day.frozen).length,REDERIVE_DAYS);
    const codexDays=clean.days.filter(day=>day.tool==='codex');
    assert.equal(codexDays.length,REDERIVE_DAYS);
    assert.ok(codexDays.every(day=>day.status==='unavailable' && day.apiUsd===null),'a tool that could not be read is Unknown, not 0');
  } finally {db.close();}
}));

test('a gap that could not be read is Unknown in the row, never a known 0',()=>withFolder(async folder=>{
  const db=await openLedgerStore(folder);
  try {
    // A day 20 days back was kept, then the collector stopped. It came back, but the gap read failed, so only the
    // rebuild window was written and the tool was held.
    const old=addDays(TODAY,-20);
    writeHistory(db,{...buildLedgerHistory({tools:[{source:claude,sessions:[record('a',Date.parse(`${old}T17:00:00Z`))],dates:[old]}],joined:{shipped:new Map(),unread:new Set()},timeZone:TIME_ZONE,titles:true}),backfilled:['claude']});
    const rebuild=historyPlan(db,{tools:['claude'],now:NOW,timeZone:TIME_ZONE}).rebuild;
    writeHistory(db,{...buildLedgerHistory({tools:[{source:claude,sessions:[],dates:rebuild}],joined:{shipped:new Map(),unread:new Set()},timeZone:TIME_ZONE,titles:true}),held:['claude']});
    const days=cleanLedgerHistory(historyRow(db,{host:'Mac',now:NOW,timeZone:TIME_ZONE,titles:true}),{titles:true}).days;
    const gap=[addDays(TODAY,-19),addDays(TODAY,-18),addDays(TODAY,-17),addDays(TODAY,-16),addDays(TODAY,-15),addDays(TODAY,-14)];
    assert.deepEqual(days.filter(day=>day.status==='unavailable').map(day=>day.date),gap);
    assert.ok(days.filter(day=>gap.includes(day.date)).every(day=>day.apiUsd===null && day.sessionCount===null));
    assert.equal(days.length,21,'the kept day, six Unknown days and the 14 rebuilt');
    assert.equal(days.find(day=>day.date===addDays(TODAY,-13)).apiUsd,0,'a rebuilt day with nothing in it is still a known 0');
  } finally {db.close();}
}));

test('a gap longer than the transcripts kept is Unknown before the first request found',()=>{
  const from=addDays(TODAY,-41);
  const firstFound=Date.parse(`${addDays(TODAY,-30)}T17:00:00Z`);
  assert.equal(gapKnownFrom({today:TODAY,sessions:[record('a',firstFound)],from,timeZone:TIME_ZONE}),addDays(TODAY,-30));
  assert.equal(gapKnownFrom({today:TODAY,sessions:[record('b',Date.parse(`${addDays(TODAY,-45)}T17:00:00Z`))],from,timeZone:TIME_ZONE}),null,'a transcript from before the gap covers it');
  assert.equal(gapKnownFrom({today:TODAY,sessions:[],from,timeZone:TIME_ZONE}),addDays(TODAY,-13),'nothing found: the gap up to the rebuild window is Unknown');
  assert.equal(gapKnownFrom({today:TODAY,sessions:[],from:null,timeZone:TIME_ZONE}),null,'a backfill starts at its first request');
  const dates=datesToBuild({today:TODAY,sessions:[record('a',firstFound)],from,timeZone:TIME_ZONE});
  const {days}=buildLedgerHistory({tools:[{source:claude,sessions:[record('a',firstFound)],dates,unknownBefore:addDays(TODAY,-30)}],joined:{shipped:new Map(),unread:new Set()},timeZone:TIME_ZONE,titles:true});
  assert.equal(days.length,42);
  assert.equal(days.filter(day=>day.status==='unavailable').length,11,'days 41 to 31 back');
  assert.equal(days.find(day=>day.date===addDays(TODAY,-31)).apiUsd,null);
  assert.equal(days.find(day=>day.date===addDays(TODAY,-30)).sessionCount,1);
  assert.equal(days.find(day=>day.date===addDays(TODAY,-29)).apiUsd,0,'after the first request, a quiet day is a known 0');
});

test('a merge made after the rebuild window turns old commits into commits on main',()=>withFolder(async folder=>{
  const repo=path.join(folder,'fence');
  const old=NOW-20*DAY,date=dayKey(old,TIME_ZONE);
  await makeRepo(repo,old-HOUR);
  git(repo,['checkout','-qb','feature/gate']);
  await writeFile(path.join(repo,'gate.txt'),'gate\n');
  git(repo,['add','.']);
  git(repo,['commit','-qm','Add a gate'],old);
  const sha=git(repo,['rev-parse','HEAD']);
  const db=await openLedgerStore(folder);
  try {
    const s=record('fence',old-MIN,{writes:[{repo,at:old-MIN}]});
    const joined={shipped:new Map([[`claude:fence`,{commits:[{repo,sha,at:old,onMain:false,merge:false}],branches:[]}]]),unread:new Set()};
    writeHistory(db,buildLedgerHistory({tools:[{source:claude,sessions:[s],dates:[date]}],joined,timeZone:TIME_ZONE,titles:true}));
    const before=historyRow(db,{host:'Mac',now:NOW,timeZone:TIME_ZONE,titles:true}).days[0];
    assert.deepEqual([before.frozen,before.ship.commits,before.ship.onMain],[true,1,0]);
    assert.equal(await recheckOnMain(db,{today:TODAY}),0,'nothing reached main yet');
    git(repo,['checkout','-q','main']);
    git(repo,['merge','-q','--no-ff','-m','Merge the gate','feature/gate'],NOW-HOUR);
    assert.equal(await recheckOnMain(db,{today:TODAY}),1);
    const after=historyRow(db,{host:'Mac',now:NOW,timeZone:TIME_ZONE,titles:true}).days[0];
    assert.deepEqual([after.ship.onMain,after.repos[0].onMain,after.sessions[0].ship[0].onMain],[1,1,1]);
    // Past ONMAIN_RECHECK_DAYS a day is no longer checked.
    assert.equal(await recheckOnMain(db,{today:addDays(date,ONMAIN_RECHECK_DAYS+1)}),0);
    // A repository that is gone, or a deadline already passed, changes nothing.
    assert.equal(await recheckOnMain(db,{today:TODAY,deadline:0}),0);
  } finally {db.close();}
}));

test('a day stored with a repository name the snapshot refuses still loads, with that repository as other',()=>withFolder(async folder=>{
  const db=await openLedgerStore(folder);
  try {
    const date=addDays(TODAY,-1);
    const ship=(repo,commits)=>({repo,apiUsd:0,commits,onMain:0,merges:0});
    const session={id:'aaaaaaaaaaaa',title:null,origin:'interactive',task:'build',repo:"Sean's app",firstAt:`${date}T15:00:00.000Z`,lastAt:`${date}T16:00:00.000Z`,
      apiUsd:2.5,tokens:{input:1,output:1,cacheRead:1,cacheWrite:1},models:[],kinds:[],ship:[ship('app (old)',2),ship('a,b',1),ship('fence',4)]};
    const day={date,tool:'claude',status:'ok',apiUsd:2.5,sessionCount:1,subagents:0,tokens:{input:1,output:1,cacheRead:1,cacheWrite:1},models:[],kinds:[],origins:[],
      repos:[ship('app (old)',2),ship('a,b',1),ship('fence',4)],ship:{commits:7,onMain:0,merges:0},sessions:[session],other:null};
    writeHistory(db,{days:[day],commits:[]});
    const clean=cleanLedgerHistory(historyRow(db,{host:'Mac',now:NOW,timeZone:TIME_ZONE,titles:true}),{titles:true});
    assert.equal(clean.status,'ok');
    const kept=clean.days.find(entry=>entry.date===date);
    assert.deepEqual(kept.repos,[ship('other',3),ship('fence',4)]);
    assert.deepEqual(kept.sessions[0].ship,[ship('other',3),ship('fence',4)]);
    assert.equal(kept.sessions[0].repo,null);
    assert.equal(kept.apiUsd,2.5);
  } finally {db.close();}
}));

test('applyOnMain keeps Unknown values Unknown',()=>{
  const day={sessions:[{id:'aaaaaaaaaaaa',ship:[{repo:'fence',commits:2,onMain:null,merges:0}]},{id:'bbbbbbbbbbbb',ship:[{repo:'fence',commits:1,onMain:0,merges:0}]}],
    repos:[{repo:'fence',onMain:null}],ship:{onMain:null}};
  applyOnMain(day,[{session:'bbbbbbbbbbbb',repo_name:'fence',on_main:1},{session:'aaaaaaaaaaaa',repo_name:'fence',on_main:1}]);
  assert.deepEqual([day.sessions[0].ship[0].onMain,day.sessions[1].ship[0].onMain,day.repos[0].onMain,day.ship.onMain],[null,1,null,null]);
});

test('Grok request counts are kept for good, a day keeps its larger count, and a missing count is not stored',()=>withFolder(async folder=>{
  const db=await openLedgerStore(folder);
  try {
    assert.deepEqual(keepGrokDays(db,[{date:'2026-11-01',count:4},{date:'2026-11-02',count:9}]),[{date:'2026-11-01',count:4},{date:'2026-11-02',count:9}]);
    // Two weeks later the log no longer holds 11-01, and its first day is cut short.
    assert.deepEqual(keepGrokDays(db,[{date:'2026-11-02',count:3},{date:'2026-11-15',count:12},{date:'2026-11-16',count:null},{date:'bad',count:1}]),
      [{date:'2026-11-01',count:4},{date:'2026-11-02',count:9},{date:'2026-11-15',count:12}]);
  } finally {db.close();}
}));

// A collection over fictional Claude Code transcripts, with readers like the real ones.
function readersFor(home,config,cache=memoryCache()) {
  return {
    ledger:async(now,{since=null}={})=>readLedgerSources({config,home,env:{},platform:'linux',cache,since:since ?? now.getTime()-15*DAY}),
    claudeLimits:async()=>({status:'not-connected',windows:[]}),
    grokLimits:async()=>({status:'ok',provider:'Grok',scope:'account',checkedAt:new Date(NOW).toISOString(),windows:[],
      requests:{timeZone:TIME_ZONE,checkedAt:new Date(NOW).toISOString(),days:[{date:TODAY,count:7}]}}),
  };
}

test('a collection backfills from transcripts, writes a history row the cleaner accepts, and keeps paths and commit ids out',()=>withFolder(async folder=>{
  const home=path.join(folder,'home'),data=path.join(folder,'data');
  await mkdir(data,{recursive:true,mode:0o700});
  const repo=path.join(home,'code','fence');
  await makeRepo(repo,NOW-30*DAY);
  const old=NOW-25*DAY,recent=NOW-2*HOUR;
  const cwd=repo;
  await writeClaude(home,'-code-fence','old-session',[claudeTitle('Mend the fence'),claudePrompt({at:old,cwd}),
    claudeAssistant({id:'o1',at:old+MIN,cwd,stop:'end_turn',tools:[['t1','Edit',{file_path:path.join(repo,'post.txt'),old_string:'a',new_string:'b'}]]})]);
  await writeFile(path.join(repo,'post.txt'),'post\n');
  git(repo,['add','.']);
  git(repo,['commit','-qm','Set a post'],old+2*MIN);
  await writeClaude(home,'-code-fence','new-session',[claudeTitle('Paint the fence'),claudePrompt({at:recent,cwd}),claudeAssistant({id:'n1',at:recent+MIN,cwd,stop:'end_turn'})]);
  const config=testConfig(data,{sources:{claudeCode:true,grokLimits:true},sessions:{titles:true,roles:{'mend':'Builder'}},engines:{claude:'auto',codex:'off',grok:'auto'}});
  const db=await openLedgerStore(data);
  try {
    const readers=readersFor(home,config);
    const {data:snapshot}=await buildSnapshot(config,readers,{now:new Date(NOW),ledgerStore:db});
    const [row]=snapshot.ledgerHistory;
    assert.equal(row.status,'ok');
    assert.deepEqual(cleanLedgerHistory(row,{titles:true}),row,'the cleaner accepts the row as it is');
    assert.equal(row.firstDate,dayKey(old,TIME_ZONE),'the backfill reaches the oldest transcript');
    assert.equal(row.days.at(-1).date,TODAY);
    const oldDay=row.days.find(day=>day.date===row.firstDate);
    assert.deepEqual([oldDay.frozen,oldDay.sessionCount,oldDay.ship.commits,oldDay.ship.onMain],[true,1,1,1]);
    assert.equal(oldDay.sessions[0].title,'Mend the fence');
    assert.equal(row.days.at(-1).sessions[0].title,'Paint the fence');
    assert.ok(row.days.filter(day=>day.date>row.firstDate && day.date<TODAY).every(day=>day.apiUsd===0),'quiet days in between are known zeros');
    // The settings echo and Grok's kept days.
    assert.deepEqual(snapshot.configEcho.roleAliases,{mend:'Builder'});
    assert.equal(snapshot.configEcho.engines.codex,'off');
    assert.deepEqual(snapshot.grokLimits.requests.days,[{date:TODAY,count:7}]);
    // Nothing private leaves: no path, prompt or commit id.
    const text=serializeSnapshot(snapshot).text;
    const sha=git(repo,['rev-parse','HEAD']);
    for(const secret of [folder,home,'Make the button blue',sha,sha.slice(0,12),'.claude'])assert.ok(!text.includes(secret),`no ${secret}`);
    // The second collection reads only the usual window.
    assert.deepEqual(historyPlan(db,{tools:['claude'],now:NOW+HOUR,timeZone:TIME_ZONE}).extra,{});
    const asked=[];
    const again=await buildSnapshot(config,{...readers,ledger:async(now,options={})=>{asked.push(options);return readers.ledger(now,options);}},{now:new Date(NOW+HOUR),ledgerStore:db});
    assert.equal(asked.length,1,'no backfill read');
    assert.equal(again.data.ledgerHistory[0].firstDate,row.firstDate,'frozen days stay');
    // Titles off: none in the history.
    const off=await buildSnapshot({...config,sessions:{titles:false,roles:{}}},readers,{now:new Date(NOW+2*HOUR),ledgerStore:db});
    assert.ok(off.data.ledgerHistory[0].days.flatMap(day=>day.sessions).every(session=>session.title===null));
    // Without a store the history reads unavailable, and with every source off, not connected.
    const none=await buildSnapshot(config,readers,{now:new Date(NOW)});
    assert.equal(none.data.ledgerHistory[0].status,'unavailable');
    const offAll=await buildSnapshot({...config,sources:{}},readers,{now:new Date(NOW),ledgerStore:db});
    assert.equal(offAll.data.ledgerHistory[0].status,'not-connected');
  } finally {db.close();}
}));

test('a collection that fills a gap older than the transcripts kept marks the days before the first one found Unknown',()=>withFolder(async folder=>{
  const home=path.join(folder,'home'),data=path.join(folder,'data');
  await mkdir(data,{recursive:true,mode:0o700});
  const cwd=path.join(home,'code','fence');
  await mkdir(cwd,{recursive:true});
  const kept=addDays(TODAY,-40),firstLeft=NOW-25*DAY;
  await writeClaude(home,'-code-fence','left-session',[claudeTitle('Mend the fence'),claudePrompt({at:firstLeft,cwd}),claudeAssistant({id:'l1',at:firstLeft+MIN,cwd,stop:'end_turn'})]);
  const config=testConfig(data,{sources:{claudeCode:true},sessions:{titles:true,roles:{}},engines:{claude:'auto',codex:'off',grok:'off'}});
  const db=await openLedgerStore(data);
  try {
    // The collector last ran 40 days ago. Claude Code has since deleted the transcripts older than 25 days.
    writeHistory(db,{...buildLedgerHistory({tools:[{source:claude,sessions:[record('a',Date.parse(`${kept}T17:00:00Z`))],dates:[kept]}],joined:{shipped:new Map(),unread:new Set()},timeZone:TIME_ZONE,titles:true}),backfilled:['claude']});
    const {data:snapshot}=await buildSnapshot(config,readersFor(home,config),{now:new Date(NOW),ledgerStore:db});
    const days=snapshot.ledgerHistory[0].days;
    assert.equal(days.find(day=>day.date===kept).sessionCount,1);
    const unknown=days.filter(day=>day.status==='unavailable').map(day=>day.date);
    assert.equal(unknown.length,14,'39 to 26 days back');
    assert.equal(unknown[0],addDays(TODAY,-39));
    assert.equal(unknown.at(-1),addDays(TODAY,-26));
    assert.equal(days.find(day=>day.date===dayKey(firstLeft,TIME_ZONE)).sessionCount,1);
    assert.equal(days.find(day=>day.date===addDays(TODAY,-24)).apiUsd,0);
  } finally {db.close();}
}));
