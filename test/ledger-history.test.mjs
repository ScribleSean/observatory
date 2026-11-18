// The ledger history's days (scripts/ledger-history.mjs), from fictional session records.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLedgerHistory,addDays,datesFrom,emptyDay} from '../scripts/ledger-history.mjs';
import {snapshotDay,foldSessions} from '../scripts/ledger-store.mjs';
import {claude,codex} from '../scripts/sources/index.mjs';
import {cleanLedgerHistory,LEDGER_HISTORY_SCHEMA,SESSION_DAY_TOP,MAX_SESSION_MODELS} from '../lib/r2-shape.mjs';

const TZ='America/New_York';
// Noon in New York on 2026-11-10.
const NOON=Date.parse('2026-11-10T17:00:00Z');
const HOUR=3600000,MIN=60000;
const opus=(key,at,agent=null,values=[1000,10000,500,2000])=>({key,at,model:'claude-opus-5-5',values,agent});

let counter=0;
function session(overrides={}) {
  const id=overrides.id ?? `history-${++counter}`;
  return {id,title:'Prune the hedges',first:NOON,last:NOON+HOUR,requests:[opus(`${id}-1`,NOON)],agents:[],writes:[],branches:[],runs:[],
    rateLimits:[],typed:[],unknownTokens:false,live:null,repo:'/fictional/code/hedge',gitRepo:'/fictional/code/hedge',origin:'interactive',task:'build',...overrides};
}
const noJoin={shipped:new Map(),unread:new Set()};
const build=(sessions,{dates=['2026-11-10'],joined=noJoin,titles=true,source=claude}={})=>buildLedgerHistory({tools:[{source,sessions,dates}],joined,timeZone:TZ,titles});
const wrap=(days,host='Mac')=>({host,status:'ok',checkedAt:new Date(NOON).toISOString(),schema:LEDGER_HISTORY_SCHEMA,timeZone:TZ,
  firstDate:days[0]?.date ?? null,sessionsFrom:days[0]?.date ?? null,days});

test('dates step as calendar dates across month ends and clock changes',()=>{
  assert.equal(addDays('2026-10-31',1),'2026-11-01');
  assert.equal(addDays('2026-03-08',1),'2026-03-09');
  assert.equal(addDays('2027-01-01',-1),'2026-12-31');
  assert.deepEqual(datesFrom('2026-10-30','2026-11-02'),['2026-10-30','2026-10-31','2026-11-01','2026-11-02']);
});

test('a session that runs past midnight counts on each day it was active, and its subagents on the day they started',()=>{
  const late=NOON+11.5*HOUR; // 23:30 in New York
  const s=session({agents:[{key:'a1',kind:'review'}],requests:[opus('m1',late),opus('m2',late+20*MIN,'a1'),opus('m3',late+50*MIN,'a1')]});
  const {days}=build([s],{dates:['2026-11-10','2026-11-11']});
  const [first,second]=days;
  assert.deepEqual([first.date,second.date],['2026-11-10','2026-11-11']);
  assert.equal(first.sessionCount,1);assert.equal(second.sessionCount,1);
  assert.equal(first.sessions[0].id,second.sessions[0].id,'the same hashed id joins the days into one session');
  assert.equal(first.subagents,1,'the subagent started before midnight');
  assert.equal(second.subagents,0);
  assert.deepEqual(first.kinds.map(kind=>[kind.kind,kind.subagents]).sort(),[['main',0],['review',1]]);
  assert.deepEqual(second.kinds.map(kind=>kind.kind),['review']);
  assert.ok(Math.abs(first.apiUsd+second.apiUsd-(first.sessions[0].apiUsd+second.sessions[0].apiUsd))<1e-9);
});

test('a day with nothing in it is a known zero, and a day only the session could not price is Unknown',()=>{
  const {days}=build([session({unknownTokens:true})],{dates:['2026-11-09','2026-11-10']});
  assert.deepEqual(days[0],emptyDay('claude','2026-11-09'));
  assert.equal(days[1].apiUsd,null,'one session with unreadable tokens makes the day Unknown');
  assert.equal(days[1].sessions[0].apiUsd,null);
  const unpriced=build([session({requests:[{key:'x',at:NOON,model:'claude-future-9',values:[1,1,1,1],agent:null}]}),session()]).days[0];
  assert.equal(unpriced.apiUsd,null,'an unpriced model is Unknown, never 0');
  assert.equal(unpriced.models.find(model=>model.model==='claude-future-9').apiUsd,null);
});

test('spend splits by model, kind, origin and repository, and a request a fork copied counts once',()=>{
  const shared=opus('shared',NOON);
  const {days:[day]}=build([
    session({id:'parent',first:NOON-HOUR,requests:[shared]}),
    session({id:'fork',first:NOON,requests:[shared,opus('own',NOON+MIN)],origin:'headless',task:'review',repo:'/fictional/code/orchard',gitRepo:'/fictional/code/orchard'}),
    session({origin:null,repo:'/fictional/notes',gitRepo:null,requests:[{key:'h',at:NOON,model:'claude-haiku-5-5',values:[10,10,10,10],agent:null}]}),
  ]);
  assert.equal(day.tokens.output,2*2000+10);
  assert.deepEqual(day.origins.map(row=>[row.origin,row.sessions]).sort(),[['headless',1],['interactive',1],['unknown',1]]);
  assert.deepEqual(day.repos.map(row=>row.repo).sort(),['hedge','orchard'],'a working folder that is not a git repository names no repository');
  assert.deepEqual(day.models.map(row=>row.model),['claude-opus-5-5','claude-haiku-5-5']);
  const total=day.sessions.reduce((sum,row)=>sum+row.apiUsd,0);
  assert.ok(Math.abs(total-day.apiUsd)<1e-6,'the sessions add up to the day');
  const fork=day.sessions.find(row=>row.origin==='headless');
  assert.equal(fork.task,'review');
  assert.equal(fork.repo,'orchard');
});

test('shipped work: commits by commit time, merges counted once a day, Unknown where git could not read',()=>{
  const repo='/fictional/code/hedge',other='/fictional/code/quarry';
  const a=session({id:'a',writes:[{repo,at:NOON}]}),b=session({id:'b',writes:[{repo,at:NOON},{repo:other,at:NOON}]});
  const shipped=new Map([
    ['claude:a',{commits:[{repo,sha:'c1',at:NOON+MIN,onMain:true,merge:false},{repo,sha:'c2',at:NOON+2*MIN,onMain:false,merge:false},
      {repo,sha:'m1',at:NOON+3*MIN,onMain:true,merge:true,mergedTip:'c2'}],branches:[{repo,name:'feature/trim',at:NOON-MIN,tip:'c2'}]}],
    ['claude:b',{commits:[{repo,sha:'c3',at:NOON+4*MIN,onMain:null,merge:false}],branches:[]}],
  ]);
  const {days:[day],commits}=build([a,b],{joined:{shipped,unread:new Set([other])}});
  const first=day.sessions.find(row=>row.ship.some(part=>part.commits===2));
  assert.deepEqual(first.ship,[{repo:'hedge',apiUsd:first.apiUsd,commits:2,onMain:1,merges:1}],'the merge and the branch it brought in are one change');
  const second=day.sessions.find(row=>row!==first);
  assert.deepEqual(second.ship.find(part=>part.repo==='quarry'),{repo:'quarry',apiUsd:0,commits:null,onMain:null,merges:null});
  assert.equal(second.ship.find(part=>part.repo==='hedge').onMain,null,'no default branch: on main is Unknown');
  assert.deepEqual(day.ship,{commits:null,onMain:null,merges:null},'a total with an Unknown part is Unknown');
  assert.deepEqual(commits.map(commit=>commit.sha).sort(),['c1','c2','c3'],'merge commits are not counted as commits');
  assert.ok(commits.every(commit=>commit.tool==='claude' && commit.date==='2026-11-10' && /^[0-9a-f]{12}$/.test(commit.session)));
  // With everything readable the day adds up.
  const clean=build([a],{joined:{shipped:new Map([['claude:a',shipped.get('claude:a')]]),unread:new Set()}}).days[0];
  assert.deepEqual(clean.ship,{commits:2,onMain:1,merges:1});
  assert.deepEqual(clean.repos[0],{repo:'hedge',apiUsd:clean.apiUsd,commits:2,onMain:1,merges:1});
  // The join failing makes every written repository Unknown, and a session that wrote nothing still shipped 0.
  const failed=build([a,session({id:'quiet'})],{joined:null}).days[0];
  assert.equal(failed.sessions.find(row=>row.ship.length).ship[0].commits,null);
  assert.deepEqual(failed.sessions.find(row=>!row.ship.length).ship,[]);
});

test('a repository folder name the snapshot refuses is counted as other, so its commits count and the day stays readable',()=>{
  const odd='/fictional/code/app (old)',comma='/fictional/code/a,b';
  const s=session({id:'odd',gitRepo:odd,repo:odd,writes:[{repo:odd,at:NOON},{repo:comma,at:NOON}]});
  const shipped=new Map([['claude:odd',{commits:[{repo:odd,sha:'c1',at:NOON+MIN,onMain:true,merge:false},{repo:comma,sha:'c2',at:NOON+2*MIN,onMain:false,merge:false}],branches:[]}]]);
  const {days:[day],commits}=build([s],{joined:{shipped,unread:new Set()}});
  assert.equal(day.sessions[0].repo,null,'the folder it ran in is dropped');
  assert.deepEqual(day.sessions[0].ship,[{repo:'other',apiUsd:0,commits:2,onMain:1,merges:0}]);
  assert.deepEqual(day.ship,{commits:2,onMain:1,merges:0});
  assert.deepEqual(commits.map(commit=>commit.repoName),['other','other']);
  const clean=cleanLedgerHistory(wrap([snapshotDay(day,{listSessions:true,titles:true,frozen:false})]),{titles:true});
  assert.deepEqual(clean.days[0].repos,[{repo:'other',apiUsd:0,commits:2,onMain:1,merges:0}]);
});

test('titles stay only while titles are on, and no path, prompt or commit id is in a day',()=>{
  const repo='/fictional/secret-folder/hedge';
  const s=session({repo,writes:[{repo,at:NOON}]});
  const joined={shipped:new Map([[`claude:${s.id}`,{commits:[{repo,sha:'deadbeefcafe0123',at:NOON+MIN,onMain:true,merge:false}],branches:[]}]]),unread:new Set()};
  const on=build([s],{joined}).days[0];
  assert.equal(on.sessions[0].title,'Prune the hedges');
  const off=build([s],{joined,titles:false}).days[0];
  assert.equal(off.sessions[0].title,null);
  const text=JSON.stringify(off);
  for(const secret of ['secret-folder','deadbeef','Prune','/fictional'])assert.ok(!text.includes(secret),secret);
});

test('the snapshot lists the largest sessions, folds the rest into compact rows, and caps each session',()=>{
  const sessions=Array.from({length:SESSION_DAY_TOP+5},(_,index)=>session({id:`many-${index}`,
    requests:[opus(`r-${index}`,NOON,null,[10,10,10,10*(index+1)]),
      ...['claude-haiku-5-5','claude-sonnet-5-5','claude-opus-4-8','claude-fable-5'].map((model,at)=>({key:`x-${index}-${at}`,at:NOON,model,values:[1,1,1,1],agent:null}))]}));
  const {days:[day]}=build(sessions);
  const shaped=snapshotDay(day,{listSessions:true,titles:true,frozen:false});
  assert.equal(shaped.sessions.length,SESSION_DAY_TOP);
  assert.equal(shaped.other.count,5);
  assert.equal(shaped.other.rows.length,5);
  assert.ok(shaped.sessions.every(row=>row.models.length<=MAX_SESSION_MODELS));
  assert.ok(shaped.sessions[0].models.some(row=>row.model==='other'));
  const listed=shaped.sessions.reduce((sum,row)=>sum+row.apiUsd,0)+shaped.other.apiUsd;
  assert.ok(Math.abs(listed-shaped.apiUsd)<1e-6,'listed and other add up to the day');
  const old=snapshotDay(day,{listSessions:false,titles:true,frozen:true});
  assert.deepEqual([old.sessions.length,old.other.count,old.frozen],[0,SESSION_DAY_TOP+5,true]);
  assert.equal(cleanLedgerHistory(wrap([shaped]),{titles:true}).days[0].sessions.length,SESSION_DAY_TOP);
  assert.equal(foldSessions({other:null},[]),null);
});

test('codex days carry tool codex, and a cleaned row with titles off has no titles',()=>{
  const {days}=build([session({requests:[{key:'g',at:NOON,model:'gpt-6-astra',values:[10,0,0,10],agent:null}]})],{source:codex});
  assert.equal(days[0].tool,'codex');
  const shaped=days.map(day=>snapshotDay(day,{listSessions:true,titles:true,frozen:false}));
  assert.equal(cleanLedgerHistory(wrap(shaped),{titles:false}).days[0].sessions[0].title,null);
});

test('a tampered history row is refused: out of order, a path for a repository, too many sessions',()=>{
  const {days}=build([session()],{dates:['2026-11-09','2026-11-10']});
  const shaped=days.map(day=>snapshotDay(day,{listSessions:true,titles:true,frozen:false}));
  assert.ok(cleanLedgerHistory(wrap(shaped),{titles:true}));
  assert.throws(()=>cleanLedgerHistory(wrap([...shaped].reverse()),{titles:true}));
  const pathRepo=structuredClone(shaped);pathRepo[1].repos[0].repo='/Users/someone/hedge';
  const cleanPath=cleanLedgerHistory(wrap(pathRepo),{titles:true});
  assert.equal(cleanPath.days[1].repos[0].repo,'other','a path for a repository is counted as other, never kept');
  assert.ok(!JSON.stringify(cleanPath).includes('someone'));
  const sessionRepo=structuredClone(shaped);sessionRepo[1].sessions[0].repo='../hedge';
  assert.equal(cleanLedgerHistory(wrap(sessionRepo),{titles:true}).days[1].sessions[0].repo,null,'a session repository that is not a folder name is dropped');
  const crowded=structuredClone(shaped);crowded[1].sessions=Array.from({length:SESSION_DAY_TOP+1},(_,index)=>({...shaped[1].sessions[0],id:index.toString(16).padStart(12,'0')}));
  crowded[1].sessionCount=SESSION_DAY_TOP+1;
  assert.throws(()=>cleanLedgerHistory(wrap(crowded),{titles:true}));
  const extra=structuredClone(shaped);extra[1].sessions[0].prompt='Make the button blue';
  assert.ok(!JSON.stringify(cleanLedgerHistory(wrap(extra),{titles:true})).includes('button'),'unknown fields are dropped');
  assert.deepEqual(cleanLedgerHistory({host:'Mac',status:'not-connected'},{titles:true}).days,[]);
  assert.throws(()=>cleanLedgerHistory({host:'Mac',status:'bogus'},{titles:true}));
});
