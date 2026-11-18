import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import {glanceView,GLANCE_SCHEMA} from '../lib/glance-view.mjs';
import {worded} from '../lib/forecast.mjs';
import {combine} from '../lib/combine.mjs';
import {writeGlance} from '../scripts/tick.mjs';
import {ownSnapshot,withFolder,testConfig} from './helpers.mjs';

// Tue Nov 17 2026, 1:40 PM in Los Angeles. Every name below is made up.
const now=Date.parse('2026-11-17T21:40:00Z');
const timeZone='America/Los_Angeles';
const H=3600000;
const iso=at=>new Date(at).toISOString();
const claudeWeek=now+43*H,codexWeek=now+5*24*H;

function session(id,title,running,ratePerHour) {
  return {id,title,startedAt:iso(now-2*H),lastActiveAt:iso(now-60000),running,state:running?'working':null,ratePerHour,
    tokens:{input:null,output:null,cacheRead:null,cacheWrite:null},apiUsd:null,models:[],subagents:0,kinds:[],fanout:[],
    shipped:{estimated:true,commits:null,onMain:null,merges:null,prsOpen:null,repos:[]},
    signals:{longestRetry:null,retryTool:null,autoResumeUsd:null,searchOnTopModelUsd:null,searchOnSmallModelUsd:null}};
}

function ledgerRow(host,tool,engine,end,apiUsd,sessions,collectedAt) {
  return {host,status:'ok',collectedAt:iso(collectedAt),tools:[{tool,name:{claude:'Claude Code',codex:'Codex'}[tool],limitEngine:engine,periods:[
    {key:'current',start:iso(end-7*24*H),end:iso(end),windowKnown:true,apiUsd,sessionCount:sessions.length,sessions,other:null,days:[]}]}]};
}

// The forecast as the hub stores it (lib/forecast.mjs), worded once in Los Angeles time.
function stored(status) {
  const context={now,timeZone};
  const window=(engine,name,id,remaining,resetsAt,extra={})=>({engine,name,window:id,windowId:id,durationMinutes:id==='weekly'?10080:300,remaining,resetsAt:iso(resetsAt),status:'room',
    runoutAt:null,earliestAt:null,latestAt:null,ratePerHour:0.4,leftAtReset:20,confidence:'high',...extra});
  const runs=status==='runs-out'?{status:'runs-out',runoutAt:'2026-11-19T01:00:00Z',earliestAt:'2026-11-18T23:00:00Z',latestAt:'2026-11-19T03:00:00Z'}:{};
  const windows=[window('claude','Claude Code','5-hour',59,now+2.5*H),window('claude','Claude Code','weekly',36,claudeWeek,runs),
    window('codex','Codex','5-hour',88,now+2*H),window('codex','Codex','weekly',81,codexWeek)];
  const engines=[{...windows[1],name:'Claude',at:runs.runoutAt ?? null,measured:true},{...windows[3],name:'Codex',at:null,measured:true}];
  return {schema:'observatory-forecast/1',asOf:iso(now),timeZone,
    engines:engines.map(engine=>worded(engine,engine.name,context)),
    windows:windows.map(row=>worded(row,row.engine==='claude'?'Claude':'Codex',context)),
    scarce:{engine:'claude',name:'Claude',remaining:36,status,window:'weekly',windowId:'weekly'},
    sentence:status==='runs-out'?'Claude may run out Wed 3–7 PM. Codex has room.':'Claude and Codex have room.',menu:'Claude 36%'};
}

// A combined snapshot as scripts/hub.mjs writes it, cut to what the glance reads.
function fixture({age=0,status='runs-out',ledger=true,forecast=true}={}) {
  const readAt=now-age-2*60000;
  const row=(provider,name,window,remaining,resetsAt,extra={})=>({provider,name,window,bucket:provider,windowId:window,remaining,note:'',
    low:remaining!==null && remaining<=15,spent:remaining!==null && remaining<=0.5,stale:age>0,checkedAt:iso(readAt),resetsAt:iso(resetsAt),...extra});
  return {schema:'observatory-combined/1',generatedAt:iso(now-age),
    devices:[{host:'Mac',name:'Studio Mac'},{host:'Windows',name:'Desk PC'}],
    view:{timezone:timeZone,
      claudeLimits:{status:'ok',windows:[{bucket:'claude',window:'weekly',durationMinutes:10080},{bucket:'claude',window:'5-hour',durationMinutes:300}]},
      quota:{status:'ok',windows:[{bucket:'codex',window:'weekly',durationMinutes:10080},{bucket:'codex',window:'5-hour',durationMinutes:300}]},
      ledger:ledger?[
      ledgerRow('Mac','claude','claude',claudeWeek,640,[session('a1','Trip ideas',true,6.4),session('a2',null,true,3.2),session('a3','Old notes',false,null)],now-age-60000),
      ledgerRow('Windows','codex','codex',codexWeek,100,[session('b1','Watering plan',true,1.9),session('b2','Daily quiz',true,0.5)],now-age-90000),
    ]:undefined},
    glance:{
      forecast:forecast?stored(status):{schema:'observatory-forecast/1',asOf:iso(now-age),timeZone,engines:[],windows:[],scarce:null,sentence:'Claude has no current reading.',menu:null},
      limits:[
        row('claude','Claude Code','5-hour',59,now+2.5*H),
        row('claude','Claude Code','weekly',36,claudeWeek),
        row('codex','Codex','5-hour',88,now+2*H),
        row('codex','Codex','weekly',81,codexWeek),
        {provider:'grok',name:'Grok',window:'',remaining:null,note:'Not connected',stale:false},
        row('codex','Codex','monthly',null,now,{absent:'Not reported'}),
      ]}};
}

test('the glance leads with the scarcer limit and shows its percent while it runs out before the reset', () => {
  const view=glanceView(fixture(),{now,timeZone});
  assert.equal(view.schema,GLANCE_SCHEMA);
  assert.equal(view.stale,false);
  assert.equal(view.updated,'Updated 1:40 PM');
  assert.deepEqual(view.bar,{percent:64,ring:0.64,showPercent:true,text:'64%'});
  assert.deepEqual(view.headline,{engine:'claude',text:'Claude may run out Wed 3–7 PM',tone:'runs-out',
    used:'64% of the week used',resets:'Resets Thu 8:45 AM',fraction:0.64});
  // Every other window, any engine, without the headline one, a source that is not set up, or a limit the provider lacks.
  assert.deepEqual(view.limits.map(row=>[row.name,row.percent,row.resets,row.tone]),[
    ['Claude 5-hour','41%','Tue 4:15 PM','normal'],
    ['Codex 5-hour','12%','Tue 3:45 PM','normal'],
    ['Codex weekly','19%','Sun 1:45 PM','normal'],
  ]);
  assert.equal(view.limits[0].fraction,0.41);
});

test('running now lists the fastest sessions across computers as a share of each tool limit', () => {
  const {running}=glanceView(fixture(),{now,timeZone});
  // 64% of the Claude week over $640 is 0.1% per dollar, and 19% of the Codex week over $100 is 0.19%.
  assert.equal(running.title,'Running now');
  assert.equal(running.count,4);
  assert.equal(running.ratePerHour,1.4);
  assert.equal(running.summary,'4 sessions, 1.4% per hour');
  assert.deepEqual(running.sessions,[
    {title:'Trip ideas',machine:'Studio Mac',ratePerHour:0.6,rate:'0.6%/h'},
    {title:'Watering plan',machine:'Desk PC',ratePerHour:0.4,rate:'0.4%/h'},
    {title:'Untitled session',machine:'Studio Mac',ratePerHour:0.3,rate:'0.3%/h'},
  ]);
  const hidden=glanceView(fixture(),{now,timeZone,settings:{titles:false}});
  // The same names the Week page gives (lib/ledger-join.mjs sessionLabel).
  assert.deepEqual(hidden.running.sessions.map(row=>row.title),['Untitled session','Untitled session','Untitled session']);
});

test('with room before the reset the bar shows the ring alone', () => {
  const view=glanceView(fixture({status:'room'}),{now,timeZone});
  assert.deepEqual(view.bar,{percent:64,ring:0.64,showPercent:false,text:null});
  assert.equal(view.headline.text,'Claude has room');
});

test('Unknown stays Unknown: no forecast, no pace and no ledger never become zero', () => {
  const combined=fixture({forecast:false});
  combined.view.ledger[1].tools[0].periods[0].apiUsd=null;
  const view=glanceView(combined,{now,timeZone});
  assert.equal(view.headline.engine,null);
  assert.equal(view.headline.text,'Claude has no current reading.');
  assert.equal(view.headline.used,'Used: Unknown');
  assert.deepEqual(view.bar,{percent:null,ring:null,showPercent:false,text:null});
  assert.equal(view.limits.length,4);
  // One session with an Unknown pace makes the total Unknown, not smaller.
  assert.equal(view.running.ratePerHour,null);
  assert.equal(view.running.summary,'4 sessions');
  // With no stored window forecast the share of the week is not known, so every pace is Unknown: nothing is worked out again here.
  assert.deepEqual(view.running.sessions.map(row=>row.rate),['Unknown','Unknown','Unknown']);
  const known=glanceView(fixture(),{now,timeZone});
  assert.deepEqual(known.running.sessions.map(row=>row.rate),['0.6%/h','0.4%/h','0.3%/h']);
  const none=glanceView(fixture({ledger:false}),{now,timeZone});
  assert.equal(none.running,null);
  assert.equal(glanceView(fixture(),{now,timeZone}).collecting,false);
  const empty=glanceView(null,{now,timeZone});
  assert.equal(empty.collecting,true,'a first run reads Collecting in both apps, not Unknown');
  assert.equal(empty.updated,'Updated: Unknown');
  assert.equal(empty.headline.text,'Unknown');
  assert.deepEqual(empty.limits,[]);
  assert.equal(empty.stale,true);
});

test('a computer whose ledger could not be read makes every pace Unknown, and so does a week that is only a guess', () => {
  const lost=fixture();
  lost.view.ledger.push({host:'Laptop',status:'unavailable'});
  const view=glanceView(lost,{now,timeZone});
  assert.equal(view.running.count,4);
  assert.equal(view.running.ratePerHour,null);
  assert.ok(view.running.sessions.every(row=>row.rate==='Unknown'));
  const guessed=fixture();
  guessed.view.ledger[0].tools[0].periods[0].windowKnown=false;
  const rates=glanceView(guessed,{now,timeZone}).running.sessions;
  assert.deepEqual(rates.map(row=>[row.machine,row.rate]),[['Desk PC','0.4%/h'],['Desk PC','<0.1%/h'],['Studio Mac','Unknown']]);
});

test('an old snapshot shows no percent, no ring and no running sessions', () => {
  const view=glanceView(fixture({age:20*60000}),{now,timeZone});
  assert.equal(view.stale,true);
  assert.deepEqual(view.bar,{percent:null,ring:null,showPercent:false,text:null});
  assert.equal(view.headline.used,'Used: Unknown');
  assert.ok(view.limits.every(row=>row.percent==='Unknown' && row.fraction===null && row.tone==='muted'));
  assert.equal(view.running,null);
  assert.equal(view.updated,'Updated 1:20 PM');
});

test('off engines read Off and the top flag keeps its subject apart', () => {
  const combined=fixture();
  Object.assign(combined.glance.limits[2],{remaining:null,stale:true,off:true});
  const view=glanceView(combined,{now,timeZone,flags:[
    {subject:'Trip ideas',text:'Trip ideas repeated one failing test run 14 times.'},{text:'Second flag.'},{text:''}]});
  assert.equal(view.limits.find(row=>row.name==='Codex 5-hour').percent,'Off');
  assert.deepEqual(view.flag,{count:2,subject:'Trip ideas',text:'repeated one failing test run 14 times.'});
  assert.equal(glanceView(combined,{now,timeZone,flags:[]}).flag,null);
});

test('a real combined snapshot gives a glance the apps can draw', () => {
  const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)}],{now});
  const view=JSON.parse(JSON.stringify(glanceView(combined,{now,timeZone})));
  assert.equal(view.schema,GLANCE_SCHEMA);
  assert.equal(view.stale,false);
  assert.equal(typeof view.headline.text,'string');
  assert.ok(view.limits.length>0);
  for(const row of view.limits) {
    assert.match(row.name,/^\S+ \S/);
    assert.ok(row.fraction===null || (row.fraction>=0 && row.fraction<=1));
  }
  // The sample ledger has one session running on the Mac.
  assert.equal(view.running.count,1);
  assert.deepEqual(view.running.sessions.map(row=>[row.title,row.machine]),[['Dashboard redesign','Test Mac']]);
  assert.equal(view.flag,null);
});

test('the tick writes glance.json, and removes it when the glance cannot be made', async () => {
  await withFolder(async folder=>{
    const config=testConfig(folder);
    const combined=fixture();
    assert.equal(await writeGlance(config,combined,{now,flags:async()=>[{text:'A flag.'}]}),'ok');
    const file=path.join(folder,'public','local','glance.json');
    const written=JSON.parse(await readFile(file,'utf8'));
    assert.deepEqual(written,JSON.parse(JSON.stringify(glanceView(combined,{now,timeZone,flags:[{text:'A flag.'}]}))));
    // glance.accent in the settings file reaches glance.json, and only the Mac reads it.
    assert.equal(written.icon.accent,false);
    assert.equal(await writeGlance({...config,glance:{accent:true}},combined,{now,flags:async()=>null}),'ok');
    assert.equal(JSON.parse(await readFile(file,'utf8')).icon.accent,true);
    await writeFile(file,'{"schema":"older"}');
    assert.equal(await writeGlance(config,combined,{now,flags:async()=>{throw Error('flags broke');}}),'flags broke');
    await assert.rejects(access(file),{code:'ENOENT'});
  });
});
