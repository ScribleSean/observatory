import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,utimes} from 'node:fs/promises';
import path from 'node:path';
import {readAgents,claudeSession,jobFromId,cleanName} from '../scripts/read-agents.mjs';
import {combine,agentSummary} from '../lib/combine.mjs';
import {withFolder,ownSnapshot} from './helpers.mjs';

const now=Date.parse('2026-10-21T17:00:00Z');
const record=(pid,status,extra={})=>({pid,sessionId:'PRIVATE-SESSION-ID',cwd:'/Users/someone/Developer/observatory/.claude/worktrees/hub-x',
  name:'Hub rebuild',status,startedAt:now-3600000,statusUpdatedAt:now-60000,messagingSocketPath:'/tmp/PRIVATE.sock',
  entrypoint:'claude-desktop',...extra});

async function fixture(folder) {
  const sessions=path.join(folder,'claude','sessions'),jobs=path.join(folder,'codex-jobs');
  await mkdir(sessions,{recursive:true});await mkdir(jobs,{recursive:true});
  await writeFile(path.join(sessions,'101.json'),JSON.stringify(record(101,'busy')));
  await writeFile(path.join(sessions,'102.json'),JSON.stringify(record(102,'waiting',{cwd:'C:\\Users\\a\\Developer\\portfolio',name:'Fix\nlayout'})));
  await writeFile(path.join(sessions,'103.json'),JSON.stringify(record(103,'idle')));
  await writeFile(path.join(sessions,'104.json'),JSON.stringify(record(104,'busy',{statusUpdatedAt:now-3*86400000})));
  await writeFile(path.join(sessions,'101.SECRET.key'),'PRIVATE-KEY');
  await writeFile(path.join(sessions,'notes.json'),'{"name":"not a session"}');
  await writeFile(path.join(jobs,'20261021-160000-observatory-201.running'),'');
  await writeFile(path.join(jobs,'20261021-150000-tools-202.md'),'PRIVATE FINAL MESSAGE');
  await writeFile(path.join(jobs,'20261021-140000-gone-203.running'),'');
  await writeFile(path.join(jobs,'20261001-140000-old-204.md'),'PRIVATE OLD MESSAGE');
  const old=new Date(now-20*86400000);await utimes(path.join(jobs,'20261001-140000-old-204.md'),old,old);
  return {claudeSessions:sessions,codexJobs:jobs};
}

test('session and job status come from state files, never their contents',()=>withFolder(async folder=>{
  const folders=await fixture(folder);
  const alive=pid=>[101,102,103,201].includes(pid);
  const result=await readAgents({folders,now,alive});
  assert.deepEqual(result.sessions.map(s=>[s.status,s.project]),[['waiting','portfolio'],['working','observatory'],['idle','observatory']]);
  assert.equal(result.sessions[0].name,'Fix layout');
  assert.deepEqual(result.jobs.map(j=>[j.status,j.project]),[['working','observatory'],['done','tools'],['stopped','gone']]);
  const text=JSON.stringify(result);
  for(const secret of ['PRIVATE','SECRET','/Users/someone','.sock','sessionId'])assert.ok(!text.includes(secret),secret);
}));

test('a session whose process has gone is done, and old ones drop out',()=>{
  assert.equal(claudeSession(record(1,'busy'),{alive:false,now}).status,'done');
  assert.equal(claudeSession(record(1,'busy',{statusUpdatedAt:now-2*86400000}),{alive:false,now}),null);
  assert.equal(claudeSession(record(1,'strange'),{alive:true,now}).status,'unknown');
});

test('missing folders are reported, not treated as zero agents',()=>withFolder(async folder=>{
  const result=await readAgents({folders:{claudeSessions:path.join(folder,'none'),codexJobs:path.join(folder,'none')},now});
  assert.equal(result.claudeStatus,'not-found');
  assert.equal(result.codexStatus,'not-found');
}));

test('names are cleaned and bounded, job ids parsed',()=>{
  assert.equal(cleanName('a\u0007b\u2028c'),'a b c');
  assert.equal(cleanName('x'.repeat(200)).length,80);
  assert.equal(jobFromId('20261021-131440-observatory-53873').project,'observatory');
  assert.equal(jobFromId('bad name'),null);
});

test('the glance block lists waiting and working agents per computer',()=>{
  const at=new Date(now).toISOString();
  const agents=(host,sessions,jobs=[])=>ownSnapshot(host,now,s=>({...s,agentActivity:[{host,status:'ok',checkedAt:at,claudeStatus:'ok',codexStatus:'ok',sessions,jobs}]}));
  const mac=agents('Mac',[{tool:'claude-code',status:'waiting',project:'portfolio',name:'Fix layout'},{tool:'claude-code',status:'idle',project:'x'}],
    [{tool:'codex',status:'working',project:'observatory'}]);
  const pc=agents('Windows',[{tool:'claude-code',status:'working',project:'observatory'}]);
  const combined=combine([{host:'Mac',snapshot:mac},{host:'Windows',snapshot:pc}],{now});
  assert.equal(combined.glance.waiting,1);
  assert.equal(combined.glance.working,2);
  assert.ok(combined.glance.lines.includes('Agents'));
  assert.ok(combined.glance.lines.some(line=>line.includes('portfolio · Fix layout · waiting on you')));
  assert.ok(combined.glance.lines.some(line=>line.includes('1 Codex job running')));
});

test('agents on a stale computer are shown with their time and not counted as current',()=>{
  const old=new Date(now-3600000).toISOString();
  const pc=ownSnapshot('Windows',now,s=>({...s,agentActivity:[{host:'Windows',status:'ok',checkedAt:old,sessions:[{status:'working',project:'p'}],jobs:[]}]}));
  const [summary]=agentSummary([{host:'Windows',name:'PC',rows:{agentActivity:pc.agentActivity}}],now);
  assert.equal(summary.stale,true);
  const combined=combine([{host:'Windows',snapshot:pc}],{now});
  assert.equal(combined.glance.working,0);
  assert.ok(combined.glance.lines.some(line=>line.includes('as of')));
});

test('a long session name is shortened in the menu',()=>{
  const at=new Date(now).toISOString();
  const mac=ownSnapshot('Mac',now,s=>({...s,agentActivity:[{host:'Mac',status:'ok',checkedAt:at,claudeStatus:'ok',codexStatus:'ok',
    sessions:[{tool:'claude-code',status:'working',project:'observatory',name:'x'.repeat(80)}],jobs:[]}]}));
  const line=combine([{host:'Mac',snapshot:mac}],{now}).glance.lines.find(row=>row.includes('observatory ·'));
  assert.ok(line.length<=70,line);
  assert.ok(line.includes('…'));
});
