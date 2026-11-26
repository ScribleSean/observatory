import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {archiveReadings,readingsOf,TODAY_EVERY_MS} from '../scripts/raw-archive.mjs';
import {archivedSnapshots} from '../scripts/tick.mjs';
import {withFolder,testConfig} from './helpers.mjs';

const T0=Date.parse('2026-11-26T12:00:00Z');
const snapshot=(today,{points=[],limits='ok'}={})=>({schema:2,collectedAt:new Date(T0).toISOString(),device:{host:'Mac',name:'Mac'},
  providerTokenSources:[{host:'Mac',provider:'claude-code',status:'ok',days:[{date:'2026-11-25',totalTokens:500},{date:'2026-11-26',totalTokens:today}]}],
  limitHistory:[{host:'Mac',status:'ok',points}],claudeLimits:{status:limits,windows:[]},
  tokens:[{host:'Windows',status:'not-connected'}]});
const lines=async root=>{
  const out=[];
  for(const host of await readdir(root,{withFileTypes:true}))if(host.isDirectory())
    for(const year of await readdir(path.join(root,host.name)))
      for(const file of await readdir(path.join(root,host.name,year)))
        out.push(...(await readFile(path.join(root,host.name,year,file),'utf8')).trim().split('\n').map(line=>JSON.parse(line)));
  return out;
};

test('with no archive folder nothing is written',()=>withFolder(async folder=>{
  assert.equal(await archiveReadings(testConfig(folder),[{host:'Mac',snapshot:snapshot(1)}],{now:T0,timeZone:'UTC'}),null);
}));

test('every reading is appended with its day, and only another computer\'s rows are left out',()=>{
  const keys=readingsOf(snapshot(1),'Mac').map(item=>item.key);
  assert.ok(keys.includes('providerTokenSources|claude-code|2026-11-26') && keys.includes('claudeLimits||row'));
  assert.ok(!keys.some(key=>key.startsWith('tokens|')),'a row about another computer is not this computer\'s reading');
});

test('readings are appended for good: changed parts only, today at most hourly, a finished day and each point once',()=>withFolder(async folder=>{
  const root=path.join(folder,'archive');
  const config={...testConfig(folder),archive:{folder:root}};
  const point=(t,r)=>({t,r,p:'claude',w:'five_hour'});
  const write=(value,now)=>archiveReadings(config,[{host:'Mac',snapshot:value}],{now,timeZone:'UTC'});
  const first=await write(snapshot(100,{points:[point('2026-11-26T11:00:00Z',10)]}),T0);
  assert.ok(first>0);
  assert.equal(await write(snapshot(100,{points:[point('2026-11-26T11:00:00Z',10)]}),T0+60000),0,'nothing changed, nothing written');
  // Today changed a minute later: held until an hour has passed. A new point is written at once.
  assert.equal(await write(snapshot(150,{points:[point('2026-11-26T11:00:00Z',10),point('2026-11-26T12:01:00Z',12)]}),T0+120000),1);
  assert.equal(await write(snapshot(180),T0+TODAY_EVERY_MS),1,'today is written again after an hour');
  // The next day, the finished day's final value is written at once.
  const next=T0+12*3600000;
  const tomorrow={...snapshot(200),providerTokenSources:[{host:'Mac',provider:'claude-code',status:'ok',days:[{date:'2026-11-26',totalTokens:210}]}]};
  assert.ok(await write(tomorrow,next)>=1);
  const all=await lines(root);
  const today=all.filter(line=>line.section==='providerTokenSources' && line.date==='2026-11-26').map(line=>line.value.totalTokens);
  assert.deepEqual(today,[100,180,210],'the last line for a day is its final value');
  assert.equal(all.filter(line=>line.kind==='point').length,2,'each point once');
  assert.ok(all.every(line=>line.v===1 && line.host==='Mac' && typeof line.archivedAt==='string'));
  // Earlier lines are never rewritten: the first day's file still starts with the first reading.
  const firstFile=(await readFile(path.join(root,'Mac','2026','2026-11-26.jsonl'),'utf8')).split('\n')[0];
  assert.equal(JSON.parse(firstFile).archivedAt,new Date(T0).toISOString());
  assert.ok((await readFile(path.join(root,'Mac','2026','2026-11-27.jsonl'),'utf8')).length>0,'a new day starts a new file');
  assert.match(await readFile(path.join(root,'README.md'),'utf8'),/never deletes/);
}));

test('a lost index writes some readings twice and loses none, and an existing README is kept',()=>withFolder(async folder=>{
  const root=path.join(folder,'archive');
  await mkdir(root,{recursive:true});
  await writeFile(path.join(root,'README.md'),'mine');
  const config={...testConfig(folder),archive:{folder:root}};
  await archiveReadings(config,[{host:'Mac',snapshot:snapshot(1)}],{now:T0,timeZone:'UTC'});
  const count=(await lines(root)).length;
  await writeFile(path.join(folder,'private-archive','index.json'),'broken');
  await archiveReadings(config,[{host:'Mac',snapshot:snapshot(1)}],{now:T0+1000,timeZone:'UTC'});
  assert.equal((await lines(root)).length,2*count);
  assert.equal(await readFile(path.join(root,'README.md'),'utf8'),'mine');
}));

test('the hub keeps the snapshots it read this tick, never an old copy of a computer it did not reach',()=>{
  const config={host:'Mac',role:'hub'};
  const combined={hub:{spokes:[{host:'Windows',pull:'ok'},{host:'Linux',pull:'off'}]},snapshots:{Windows:{a:1},Linux:{b:2}}};
  assert.deepEqual(archivedSnapshots(config,{own:1},combined).map(item=>item.host),['Mac','Windows']);
  assert.deepEqual(archivedSnapshots({host:'Linux',role:'spoke'},{own:1},combined).map(item=>item.host),['Linux']);
});
