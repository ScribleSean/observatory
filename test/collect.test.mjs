import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {collect,buildSnapshot,runPowerShellFile} from '../scripts/collect.mjs';
import {tick} from '../scripts/tick.mjs';
import {withFolder,testConfig} from './helpers.mjs';

const at=new Date('2026-10-21T17:00:00Z');
const activity={host:'Mac',status:'ok',start:'2026-10-21T04:00:00.000Z',end:'2026-10-21T17:00:00.000Z',days:[]};
const readers={
  screenTime:async()=>({...activity}),
  codex:async()=>({profiles:[],tools:[],tokenProfiles:[],hourTotals:[]}),
  codexLimits:async()=>({status:'ok',provider:'Codex',scope:'account',checkedAt:at.toISOString(),windows:[{bucket:'codex',window:'primary',durationMinutes:300,remainingPercent:80,resetsAt:'2099-01-01T00:00:00Z'}]}),
  claudeCode:async()=>({status:'ok',days:[]}),
  claudeLimits:async()=>{throw Error('no CLI');},
};

for(const failure of ['process not found','expired cycle']) {
  test(`Windows reader timeout tolerates taskkill failure: ${failure}`,async t=>{
    t.mock.timers.enable({apis:['setTimeout']});
    const child=new EventEmitter();
    child.pid=1234;
    child.stdout=new PassThrough();
    const calls=[];
    const pending=runPowerShellFile('/fictional/reader.ps1',{
      spawnProcess:()=>child,
      exec:(file,args,options,callback)=>{
        calls.push({file,args});
        if(failure==='expired cycle')throw Error('Cycle deadline exceeded');
        queueMicrotask(()=>callback(Object.assign(Error('ERROR: The process "1234" not found.'),{code:128})));
      },
    });
    const rejected=assert.rejects(pending,/Screen time reader timeout/);
    t.mock.timers.tick(60000);
    await rejected;
    assert.equal(calls.length,1);
    assert.equal(path.basename(calls[0].file),'taskkill.exe');
    assert.deepEqual(calls[0].args,['/PID','1234','/T','/F']);
  });
}

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
  let release,started;
  const slow=new Promise(resolve=>{release=resolve;});
  const holding=new Promise(resolve=>{started=resolve;});
  const first=tick(config,{collectStep:async cfg=>{started();await slow;return collect(cfg,{readers,now:()=>at});}});
  await holding;
  const second=await tick(config,{collectStep:()=>{throw Error('should not run');}});
  assert.equal(second.busy,true);
  release();
  const done=await first;
  assert.equal(done.busy,false);
  assert.equal(done.value.collect,'ok');
  const combined=JSON.parse(await readFile(path.join(folder,'public','local','combined.json'),'utf8'));
  assert.equal(combined.glance.today[0].host,'Mac');
  assert.ok(combined.glance.limits.some(row=>row.provider==='codex' && row.remaining===80 && row.stale));
}));

test('a failed collection still writes combined.json from what is there',()=>withFolder(async folder=>{
  const outcome=await tick(testConfig(folder),{collectStep:()=>{throw Error('reader crashed');}});
  assert.equal(outcome.value.collect,'reader crashed');
  const combined=JSON.parse(await readFile(path.join(folder,'public','local','combined.json'),'utf8'));
  assert.equal(combined.glance.today[0].missing,true);
}));

test('the old app snapshot is copied aside once before the first write',()=>withFolder(async folder=>{
  const {mkdir,writeFile}=await import('node:fs/promises');
  const local=path.join(folder,'public','local');
  await mkdir(local,{recursive:true,mode:0o700});
  await writeFile(path.join(local,'usage.json'),JSON.stringify({schema:2,collectedAt:'2026-10-20T00:00:00Z',activityHistory:[]}));
  await collect(testConfig(folder),{readers,now:()=>at});
  const backup=JSON.parse(await readFile(path.join(local,'usage.before-hub.json'),'utf8'));
  assert.equal(backup.collectedAt,'2026-10-20T00:00:00Z');
  await collect(testConfig(folder),{readers,now:()=>at});
  assert.equal(JSON.parse(await readFile(path.join(local,'usage.before-hub.json'),'utf8')).collectedAt,'2026-10-20T00:00:00Z');
}));
