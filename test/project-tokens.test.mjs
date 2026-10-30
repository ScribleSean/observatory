import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {collectProjectTokens,projectName,sessionHash} from '../scripts/read-projects.mjs';
import {buildProjectTokens,cleanProjectTokens,MAX_PROJECTS,MAX_SESSIONS} from '../scripts/project-tokens.mjs';
import {buildSnapshot} from '../scripts/collect.mjs';
import {combine} from '../lib/combine.mjs';
import {projectsView} from '../lib/view-projects.mjs';
import {withFolder,testConfig,ownSnapshot} from './helpers.mjs';

const now=new Date('2026-10-21T17:00:00Z');
const timeZone='America/New_York';
const home='/Users/fixture';
const repo=`${home}/Developer/demo-app`;
const SECRETS=['PLANTED-PROMPT','PLANTED-TITLE','PLANTED-REPLY','sk-planted-key','/Users/fixture','feature-branch-x','session-main-0001','codex-thread-0001','PLANTED-INSTRUCTIONS'];

const usage=(input,output,read=0,write=0)=>({input_tokens:input,output_tokens:output,cache_read_input_tokens:read,cache_creation_input_tokens:write});
const assistant=({id,request,at,sessionId,cwd,side,model='claude-opus-5-5',tokens})=>({type:'assistant',timestamp:at,sessionId,cwd,requestId:request,
  ...(side===undefined?{}:{isSidechain:side}),message:{id,role:'assistant',model,usage:tokens,content:[{type:'text',text:'PLANTED-REPLY sk-planted-key'}]}});
const lines=rows=>rows.map(row=>JSON.stringify(row)).join('\n')+'\n';

async function claudeFixture(folder) {
  const project=path.join(folder,'.claude','projects','-Users-fixture-Developer-demo-app');
  await mkdir(path.join(project,'session-main-0001','subagents'),{recursive:true});
  await writeFile(path.join(project,'session-main-0001.jsonl'),lines([
    {type:'custom-title',customTitle:'PLANTED-TITLE',sessionId:'session-main-0001'},
    {type:'user',timestamp:'2026-10-21T13:00:00Z',sessionId:'session-main-0001',cwd:repo,message:{role:'user',content:'PLANTED-PROMPT'}},
    // Yesterday in New York: left out.
    assistant({id:'m0',request:'r0',at:'2026-10-21T03:00:00Z',sessionId:'session-main-0001',cwd:repo,side:false,tokens:usage(999,999)}),
    assistant({id:'m1',request:'r1',at:'2026-10-21T13:02:00Z',sessionId:'session-main-0001',cwd:repo,side:false,tokens:usage(100,50,800,50)}),
    // The same request written again while streaming counts once, at its largest.
    assistant({id:'m1',request:'r1',at:'2026-10-21T13:02:01Z',sessionId:'session-main-0001',cwd:repo,side:false,tokens:usage(100,60,800,50)}),
    assistant({id:'m2',request:'r2',at:'2026-10-21T14:40:00Z',sessionId:'session-main-0001',cwd:repo,side:false,tokens:usage(10,30)}),
  // A last line still being written is skipped until the next cycle.
  ])+'{"type":"assistant","usage":');
  await writeFile(path.join(project,'session-main-0001','subagents','agent-a1.jsonl'),lines([
    assistant({id:'s1',request:'q1',at:'2026-10-21T14:00:00Z',sessionId:'session-main-0001',cwd:`${repo}/.claude/worktrees/feature-branch-x`,side:true,tokens:usage(500,500)}),
  ]));
  // A worktree session with no subagent marker: its subagent share is Unknown.
  await writeFile(path.join(project,'session-tree-0002.jsonl'),lines([
    assistant({id:'t1',request:'u1',at:'2026-10-21T15:00:00Z',sessionId:'session-tree-0002',cwd:`${repo}/.claude/worktrees/feature-branch-x`,tokens:usage(200,100)}),
    assistant({id:'t2',request:'u2',at:'2026-10-21T15:30:00Z',sessionId:'session-tree-0002',cwd:`${home}/Developer/other-tool`,side:false,model:'claude-unpriced-9',tokens:usage(5,5)}),
  ]));
}

async function codexFixture(folder) {
  const day=path.join(folder,'.codex','sessions','2026','10','21');
  await mkdir(day,{recursive:true});
  const meta=(id,extra={})=>({type:'session_meta',timestamp:'2026-10-21T16:00:00Z',payload:{id,cwd:`${home}/Developer/.worktrees/demo-codex-task`,
    base_instructions:{text:'PLANTED-INSTRUCTIONS'},git:{branch:'feature-branch-x',repository_url:'git@github.com:fixture/demo-app.git'},...extra}});
  const turn={type:'turn_context',timestamp:'2026-10-21T16:00:01Z',payload:{model:'gpt-5.6',cwd:`${home}/Developer/.worktrees/demo-codex-task`}};
  const count=(at,total,last)=>({type:'event_msg',timestamp:at,payload:{type:'token_count',info:{total_token_usage:total,last_token_usage:last}}});
  const t=(input,cached,output)=>({input_tokens:input,cached_input_tokens:cached,output_tokens:output,reasoning_output_tokens:0,total_tokens:input+output});
  await writeFile(path.join(day,'rollout-a.jsonl'),lines([meta('codex-thread-0001'),turn,
    {type:'response_item',payload:{type:'message',content:'PLANTED-PROMPT'}},
    count('2026-10-21T16:01:00Z',t(1000,600,100),t(1000,600,100)),
    count('2026-10-21T16:01:01Z',t(1000,600,100),t(1000,600,100)),
    count('2026-10-21T16:20:00Z',t(3000,2000,300),t(2000,1400,200))]));
  await writeFile(path.join(day,'rollout-b.jsonl'),lines([meta('codex-child-0002',{parent_thread_id:'codex-thread-0001'}),turn,
    count('2026-10-21T16:30:00Z',t(400,0,100),t(400,0,100))]));
}

async function fixture(folder,{claude=true,codex=true}={}) {
  if(claude)await claudeFixture(folder);
  if(codex)await codexFixture(folder);
  return collectProjectTokens({claudeFolder:claude?path.join(folder,'.claude'):null,codexFolder:codex?path.join(folder,'.codex'):null,now,timeZone,home});
}

test('folder names map to their repository, worktrees included, and nothing else of the path is kept',()=>{
  assert.equal(projectName(`${repo}/.claude/worktrees/feature-branch-x`,home),'demo-app');
  assert.equal(projectName(`${home}/Developer/.worktrees/demo-codex-task`,home,'https://github.com/fixture/demo-app.git'),'demo-app');
  assert.equal(projectName(`${home}/Developer/.worktrees/demo-codex-task`,home),'demo-codex-task');
  assert.equal(projectName('C:\\Users\\fixture\\Developer\\demo-app\\.claude\\worktrees\\x',''),'demo-app');
  assert.equal(projectName('/private/tmp/claude-501/scratchpad',home),'temp');
  assert.equal(projectName(home,home),'~');
  assert.equal(projectName('relative/demo',home),null);
  assert.equal(projectName(undefined,home),null);
});

test('today by project: sessions, subagent share, worktrees, and no paths, prompts or titles',async()=>withFolder(async folder=>{
  const raw=await fixture(folder);
  const row=buildProjectTokens(raw,'Mac',now);
  const text=JSON.stringify(row);
  for(const secret of SECRETS)assert.ok(!text.includes(secret),secret);
  assert.equal(row.status,'ok');
  assert.equal(row.date,'2026-10-21');
  assert.deepEqual(row.providers,['claude','codex']);
  const demo=row.projects.find(project=>project.name==='demo-app');
  assert.equal(row.projects[0],demo,'largest project first');
  const main=demo.sessions.find(session=>session.id===sessionHash('claude','session-main-0001'));
  // 100+60+800+50 and 10+30 from the main thread, 1000 from the subagent.
  assert.equal(main.totalTokens,2050);
  assert.equal(main.subagentTokens,1000);
  assert.equal(main.start,'2026-10-21T13:02:00.000Z');
  assert.equal(main.end,'2026-10-21T14:40:00.000Z');
  const tree=demo.sessions.find(session=>session.id===sessionHash('claude','session-tree-0002'));
  assert.equal(tree.totalTokens,300);
  assert.equal(tree.subagentTokens,null,'no marker is Unknown, not zero');
  const codex=demo.sessions.find(session=>session.provider==='codex');
  assert.equal(codex.id,sessionHash('codex','codex-thread-0001'));
  // 1100 and 2200 from the parent, 500 from its subagent, repeats counted once.
  assert.equal(codex.totalTokens,3800);
  assert.equal(codex.subagentTokens,500);
  assert.equal(demo.subagentTokens,null,'a project with one Unknown session has an Unknown subagent total');
  assert.equal(demo.totalTokens,2050+300+3800);
  assert.ok(demo.usd>0);
  const other=row.projects.find(project=>project.name==='other-tool');
  assert.equal(other.usd,null,'an unpriced model is Unknown cost, not free');
}));

test('the view shows shares and keeps Unknown apart from zero',async()=>withFolder(async folder=>{
  const row=buildProjectTokens(await fixture(folder),'Mac',now);
  const [device]=projectsView({timezone:timeZone,projectTokens:[row]},{host:'Mac',now:now.getTime()});
  assert.equal(device.status,'ok');
  const sessions=device.projects[0].sessions;
  assert.ok(sessions.some(session=>Math.abs(session.subagentShare-1000/2050)<1e-9));
  assert.ok(sessions.some(session=>session.subagentShare===null));
  const tomorrow=projectsView({timezone:timeZone,projectTokens:[row]},{host:'Mac',now:now.getTime()+86400000});
  assert.equal(tomorrow[0].status,'unknown','yesterday is not shown as today');
}));

test('a failed provider makes the whole day Unknown rather than a smaller number',async()=>withFolder(async folder=>{
  await claudeFixture(folder);
  const raw=await collectProjectTokens({claudeFolder:path.join(folder,'.claude'),codexFolder:path.join(folder,'missing'),now,timeZone,home});
  assert.equal(raw.providers.codex.status,'unavailable');
  const row=buildProjectTokens(raw,'Mac',now);
  assert.equal(row.status,'unavailable');
  assert.equal(projectsView({timezone:timeZone,projectTokens:[row]},{host:'Mac',now:now.getTime()})[0].status,'unknown');
}));

test('a day with no requests is no records, which is the only zero',async()=>withFolder(async folder=>{
  await mkdir(path.join(folder,'.claude','projects'),{recursive:true});
  const row=buildProjectTokens(await collectProjectTokens({claudeFolder:path.join(folder,'.claude'),now,timeZone,home}),'Mac',now);
  assert.equal(row.status,'ok');
  assert.deepEqual(row.projects,[]);
  assert.equal(projectsView({timezone:timeZone,projectTokens:[row]},{host:'Mac',now:now.getTime()})[0].status,'no-records');
}));

test('rows are capped, and the rest of the projects keep their tokens',()=>{
  const session=(index,tokens)=>({provider:'claude',id:sessionHash('claude',String(index)),start:now.toISOString(),end:now.toISOString(),subagentTokens:0,
    models:[{model:'claude-opus-5-5',inputTokens:tokens,cacheReadTokens:0,cacheCreationTokens:0,outputTokens:0,totalTokens:tokens}]});
  const sessions=[];
  for(let index=0;index<MAX_PROJECTS+5;index++)sessions.push({...session(index,1000-index),project:`p${index}`});
  for(let index=0;index<MAX_SESSIONS+3;index++)sessions.push({...session(100+index,5000),project:'big'});
  const row=buildProjectTokens({date:'2026-10-21',providers:{claude:{status:'ok',sessions}}},'Mac',now);
  assert.equal(row.projects.length,MAX_PROJECTS);
  assert.equal(row.projects[0].name,'big');
  assert.equal(row.projects[0].sessions.length,MAX_SESSIONS);
  assert.equal(row.projects[0].sessionCount,MAX_SESSIONS+3);
  assert.equal(row.projects[0].totalTokens,5000*(MAX_SESSIONS+3));
  assert.equal(row.other.sessionCount,6);
  assert.equal(row.other.totalTokens,[19,20,21,22,23,24].reduce((total,index)=>total+1000-index,0));
});

test('settings decide which logs are read for today by project',async()=>{
  const asked=[];
  const readers={projects:async sources=>{asked.push(sources);return {date:'2026-10-21',providers:{}};}};
  const off=await buildSnapshot(testConfig('/unused',{sources:{screenTime:false,codex:false,codexLimits:false,claudeCode:false,claudeLimits:false}}),readers,{now});
  assert.equal(asked.length,0);
  assert.equal(off.data.projectTokens[0].status,'not-connected');
  await buildSnapshot(testConfig('/unused',{sources:{screenTime:false,codex:true,codexLimits:false,claudeCode:false,claudeLimits:false}}),
    {...readers,codex:async()=>{throw Error('off in this test');}},{now});
  assert.deepEqual(asked,[{claude:false,codex:true}]);
});

test('combine checks a pulled row like a local read and keeps computers apart',async()=>withFolder(async folder=>{
  const row=buildProjectTokens(await fixture(folder),'Mac',now);
  const planted={...row,cwd:'/Users/fixture/Developer/demo-app',projects:row.projects.map(project=>({...project,path:'/Users/fixture',title:'PLANTED-TITLE'}))};
  const pc={host:'Windows',status:'ok',checkedAt:now.toISOString(),date:'2026-10-21',providers:['claude'],
    projects:[{name:'demo-app',totalTokens:10,subagentTokens:0,usd:null,sessionCount:1,sessions:[{id:'not-a-hash',provider:'claude'}]}],other:null};
  const combined=combine([
    {host:'Mac',snapshot:ownSnapshot('Mac',now.getTime(),snapshot=>({...snapshot,timezone:timeZone,projectTokens:[planted]}))},
    {host:'Windows',snapshot:ownSnapshot('Windows',now.getTime(),snapshot=>({...snapshot,timezone:timeZone,projectTokens:[pc]}))},
  ],{now:now.getTime()});
  const text=JSON.stringify(combined);
  for(const secret of SECRETS)assert.ok(!text.includes(secret),secret);
  assert.deepEqual(combined.view.projectTokens.map(row=>[row.host,row.status]),[['Mac','ok'],['Windows','unavailable']]);
  const devices=projectsView(combined.view,{host:'All',now:now.getTime()});
  assert.deepEqual(devices.map(device=>[device.host,device.status]),[['Mac','ok'],['Windows','unknown']]);
  assert.throws(()=>cleanProjectTokens({...row,projects:[{...row.projects[0],totalTokens:1}]}),/Invalid project tokens/);
}));
