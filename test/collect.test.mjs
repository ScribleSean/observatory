import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {collect,buildSnapshot} from '../scripts/collect.mjs';
import {tick} from '../scripts/tick.mjs';
import {withFolder,testConfig} from './helpers.mjs';

const at=new Date('2026-10-21T17:00:00Z');
const activity={host:'Mac',status:'ok',start:'2026-10-21T04:00:00.000Z',end:'2026-10-21T17:00:00.000Z',days:[]};
const readers={
  screenTime:async()=>({...activity}),
  codex:async()=>({profiles:[],tools:[],tokenProfiles:[],hourTotals:[]}),
  codexLimits:async()=>({status:'ok',provider:'Codex',scope:'account',checkedAt:at.toISOString(),windows:[{bucket:'codex',window:'primary',durationMinutes:300,remainingPercent:80,resetsAt:'2026-10-21T19:00:00Z'}]}),
  claudeCode:async()=>({status:'ok',days:[]}),
  claudeLimits:async()=>{throw Error('no CLI');},
};

test('only sources set to true are read, and a failed read is Unknown',async()=>{
  const called=[];
  const spy=Object.fromEntries(Object.entries(readers).map(([key,read])=>[key,()=>{called.push(key);return read();}]));
  const config=testConfig('/unused',{sources:{screenTime:false,codex:true,codexLimits:true,claudeCode:false,claudeLimits:true}});
  const {data,status}=await buildSnapshot(config,spy,{now:at});
  assert.deepEqual(called.sort((a,b)=>a.localeCompare(b)),['claudeLimits','codex','codexLimits']);
  assert.equal(data.activity[0].status,'not-connected');
  assert.equal(data.providerTokenSources[0].status,'not-connected');
  assert.equal(data.claudeLimits.status,'unavailable');
  assert.equal(data.quota.status,'ok');
  assert.equal(data.device.host,'Mac');
  assert.equal(status.state,'partial');
});

test('a snapshot holds rows about this computer only',async()=>{
  const {data}=await buildSnapshot(testConfig('/unused'),readers,{now:at});
  assert.deepEqual(data.activity.map(row=>row.host),['Mac','Windows']);
  assert.equal(data.activity[1].status,'not-connected');
  assert.ok(data.activityHistory.every(row=>row.host==='Mac'));
  assert.ok(!JSON.stringify(data).includes('intervals'));
});

test('collect writes usage.json and a status record',()=>withFolder(async folder=>{
  const config=testConfig(folder);
  await collect(config,{readers,now:()=>at});
  const local=path.join(folder,'public','local');
  const snapshot=JSON.parse(await readFile(path.join(local,'usage.json'),'utf8'));
  assert.equal(snapshot.collectedAt,at.toISOString());
  const record=JSON.parse(await readFile(path.join(local,'collector.json'),'utf8'));
  assert.equal(record.snapshotAt,at.toISOString());
}));

test('tick collects, then combines, and refuses to run twice at once',()=>withFolder(async folder=>{
  const config=testConfig(folder);
  let release;
  const slow=new Promise(resolve=>{release=resolve;});
  const first=tick(config,{collectStep:async cfg=>{await slow;return collect(cfg,{readers,now:()=>at});}});
  await new Promise(resolve=>setTimeout(resolve,50));
  const second=await tick(config,{collectStep:()=>{throw Error('should not run');}});
  assert.equal(second.busy,true);
  release();
  const done=await first;
  assert.equal(done.busy,false);
  assert.equal(done.value.collect,'ok');
  const combined=JSON.parse(await readFile(path.join(folder,'public','local','combined.json'),'utf8'));
  assert.equal(combined.glance.today[0].host,'Mac');
  // The fixed reading time is in the past, so it is shown with its age, not as current.
  assert.ok(combined.glance.limits.some(row=>row.provider==='codex' && row.remaining===80 && row.stale));
}));

test('a failed collection still writes combined.json from what is there',()=>withFolder(async folder=>{
  const outcome=await tick(testConfig(folder),{collectStep:()=>{throw Error('reader crashed');}});
  assert.equal(outcome.value.collect,'reader crashed');
  const combined=JSON.parse(await readFile(path.join(folder,'public','local','combined.json'),'utf8'));
  assert.equal(combined.glance.today[0].missing,true);
}));
