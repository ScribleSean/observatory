import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,realpath,rm,readdir,readFile,symlink,writeFile} from 'node:fs/promises';
import {testRuntimeBase} from './test-runtime-base.mjs';
import path from 'node:path';
import {collectQuota,findCodexExecutable} from './collect-quota.mjs';
import {readQuotaArchive,readQuotaState} from './quota-store.mjs';

const runtimeBase=await testRuntimeBase('collect-quota');
after(()=>rm(runtimeBase,{recursive:true,force:true}));
const now=Date.parse('2026-09-09T12:00:00Z');
const posixOnly={skip:process.platform==='win32' && 'Requires POSIX executable permissions and symbolic links'};
const emptyCandidates={platform:'darwin',appCandidates:[],toolCandidates:[]};
async function executable(runtime,name='codex') {
  const file=path.join(runtime,name);
  await writeFile(file,'#!/bin/sh\nexit 0\n',{mode:0o700});
  return file;
}
test('quota discovery uses a validated configured executable without changing configuration',posixOnly,async()=>fixture(async runtime=>{
  const target=await executable(runtime),link=path.join(runtime,'codex-link');
  await symlink(target,link);
  const file=path.join(runtime,'local.config.json'),original=Buffer.from(JSON.stringify({codexExecutable:link}));
  await writeFile(file,original);
  assert.equal(await findCodexExecutable({runtime,...emptyCandidates}),await realpath(target));
  assert.deepEqual(await readFile(file),original);
}));
for(const kind of ['app','tool'])test(`quota discovery prefers configuration over the ${kind} candidate`,posixOnly,async()=>fixture(async runtime=>{
  const configured=await executable(runtime),preferred=await executable(runtime,kind),other=await executable(runtime,'other');
  await writeFile(path.join(runtime,'local.config.json'),JSON.stringify({codexExecutable:configured}));
  const options=kind==='app'?{appCandidates:[preferred,other],toolCandidates:[other]}:
    {appCandidates:[path.join(runtime,'missing-app')],toolCandidates:[preferred,other]};
  assert.equal(await findCodexExecutable({runtime,platform:'darwin',...options}),await realpath(configured));
}));
test('quota discovery prefers app candidates over tools without configuration',posixOnly,async()=>fixture(async runtime=>{
  const app=await executable(runtime,'app'),tool=await executable(runtime,'tool');
  assert.equal(await findCodexExecutable({runtime,platform:'darwin',appCandidates:[app],toolCandidates:[tool]}),await realpath(app));
}));
test('quota discovery falls through to app candidates after refusing configuration',posixOnly,async()=>fixture(async runtime=>{
  const app=await executable(runtime,'app');
  await writeFile(path.join(runtime,'local.config.json'),JSON.stringify({codexExecutable:'relative/codex'}));
  assert.equal(await findCodexExecutable({runtime,platform:'darwin',appCandidates:[app],toolCandidates:[]}),await realpath(app));
}));
const refusedValues={
  relative:async()=> 'relative/codex',
  missing:async runtime=>path.join(runtime,'missing'),
  'non-executable':async runtime=>{const file=path.join(runtime,'codex');await writeFile(file,'synthetic',{mode:0o600});return file;},
  directory:async runtime=>{const file=path.join(runtime,'directory');await mkdir(file);return file;},
  'directory symlink':async runtime=>{const file=path.join(runtime,'link');await symlink(runtime,file);return file;},
  newline:async runtime=>path.join(runtime,'codex\n'),
  control:async runtime=>path.join(runtime,'codex\x01'),
  delete:async runtime=>path.join(runtime,'codex\x7f'),
  oversized:async runtime=>path.join(runtime,'x'.repeat(4097)),
  'non-string':async()=>42
};
for(const [name,value] of Object.entries(refusedValues))test(`quota discovery refuses configured ${name}`,posixOnly,async()=>fixture(async runtime=>{
  await writeFile(path.join(runtime,'local.config.json'),JSON.stringify({codexExecutable:await value(runtime)}));
  await assert.rejects(findCodexExecutable({runtime,...emptyCandidates}),{message:'Installed Codex client unavailable'});
}));
for(const kind of ['symlink','array','oversized','malformed','directory','missing','undefined','null','empty'])
  test(`quota discovery refuses ${kind} configuration without a candidate`,posixOnly,async()=>fixture(async runtime=>{
    const file=path.join(runtime,'local.config.json'),target=await executable(runtime);
    if(kind==='symlink') {
      const config=path.join(runtime,'config.json');
      await writeFile(config,JSON.stringify({codexExecutable:target}));await symlink(config,file);
    } else if(kind==='directory')await mkdir(file);
    else if(kind!=='missing')await writeFile(file,kind==='array'?'[]':kind==='oversized'?' '.repeat(65537):
      kind==='malformed'?'{':JSON.stringify(kind==='undefined'?{}:{codexExecutable:kind==='null'?null:''}));
    await assert.rejects(findCodexExecutable({runtime,...emptyCandidates}),{message:'Installed Codex client unavailable'});
  }));
test('refused configured client is unavailable without reading a snapshot',posixOnly,async()=>fixture(async runtime=>{
  await writeFile(path.join(runtime,'local.config.json'),JSON.stringify({codexExecutable:'relative/codex'}));
  let calls=0;
  const result=await collectQuota(runtime,{enabled:true,clock:()=>now,
    resolveExecutable:()=>findCodexExecutable({runtime,...emptyCandidates}),
    readSnapshot:async()=>{calls++;throw Error('Should not run');}});
  assert.equal(result.status,'unavailable');assert.equal(calls,0);
}));
test('quota discovery does not consult configuration without an absolute runtime',posixOnly,async()=>fixture(async runtime=>{
  await writeFile(path.join(runtime,'local.config.json'),JSON.stringify({codexExecutable:await executable(runtime)}));
  for(const runtime of [undefined,'relative',42])
    await assert.rejects(findCodexExecutable({runtime,...emptyCandidates}),{message:'Installed Codex client unavailable'});
}));
test('collector opt-out preserves the archive without polling or fabricating records',async()=>fixture(async runtime=>{
  const scope='a'.repeat(64);
  let calls=0;
  const options={enabled:true,clock:()=>now,resolveExecutable:async()=>'/fake/codex',readSnapshot:async()=>{
    calls++;
    return {scope,status:'ok',checkedAt:new Date(now).toISOString(),
      windows:[{bucket:'codex',window:'primary',remainingPercent:75}],
      accountUsage:{status:'ok',checkedAt:new Date(now).toISOString(),
        dailyUsageBuckets:[{startDate:'2026-09-09',tokens:123}]}};
  }};
  await collectQuota(runtime,options);
  const kinds=['observation','daily','poll'];
  const saved=await Promise.all(kinds.map(kind=>readQuotaArchive(runtime,{scope,kind})));
  for(const page of saved)assert.equal(page.records.length,1);
  for(const offset of [1,3600000]) {
    const result=await collectQuota(runtime,{...options,enabled:false,clock:()=>now+offset});
    assert.equal(result.status,'not-connected');assert.deepEqual(result.history,[]);
    assert.equal(calls,1);
    assert.deepEqual(await Promise.all(kinds.map(kind=>readQuotaArchive(runtime,{scope,kind}))),saved);
  }
  const state=await readQuotaState(runtime,now+3600000);
  assert.equal(state.history.status,'not-connected');
  assert.equal(state.nextAttemptAt,now+300000);
}));

test('opt-out during a poll discards its late result but preserves earlier archive records',async()=>fixture(async runtime=>{
  const scope='a'.repeat(64);
  const options={enabled:true,clock:()=>now,resolveExecutable:async()=>'/fake/codex',readSnapshot:async()=>({
    scope,status:'ok',checkedAt:new Date(now).toISOString(),
    windows:[{bucket:'codex',window:'primary',remainingPercent:75}]})};
  await collectQuota(runtime,options);
  const before=await readQuotaArchive(runtime,{scope,kind:'observation'});
  const result=await collectQuota(runtime,{...options,clock:()=>now+300001,isEnabled:async()=>false,
    readSnapshot:async()=>({scope,status:'ok',checkedAt:new Date(now+300001).toISOString(),
      windows:[{bucket:'codex',window:'primary',remainingPercent:70}]})});
  assert.equal(result.status,'not-connected');
  assert.deepEqual(await readQuotaArchive(runtime,{scope,kind:'observation'}),before);
  assert.equal((await readQuotaArchive(runtime,{scope,kind:'poll'})).records.length,1);
}));
test('collected pace uses retained observations and cannot survive an account switch',async()=>fixture(async runtime=>{
  let result;
  for(let i=0;i<=12;i++) {
    const at=now+i*300000;
    result=await collectQuota(runtime,{enabled:true,clock:()=>at,resolveExecutable:async()=>'/fake/codex',
      readSnapshot:async()=>({scope:'a'.repeat(64),status:'ok',checkedAt:new Date(at).toISOString(),
        windows:[{bucket:'codex',window:'primary',remainingPercent:74-i*2,durationMinutes:300,
          resetsAt:new Date(now+5*3600000).toISOString()}]})});
  }
  assert.equal(result.pace[0].percentagePointsPerHour,24);
  assert.equal(result.pace[0].remainingMinutes,125);
  const switched=await collectQuota(runtime,{enabled:true,clock:()=>now+3900000,resolveExecutable:async()=>'/fake/codex',
    readSnapshot:async()=>({scope:'b'.repeat(64),status:'ok',checkedAt:new Date(now+3900000).toISOString(),
      windows:[{bucket:'codex',window:'primary',remainingPercent:50,durationMinutes:300,
        resetsAt:new Date(now+5*3600000).toISOString()}]})});
  assert.equal(switched.pace[0].status,'insufficient-history');
  assert.equal(switched.history.length,1);
}));
async function fixture(action) {const runtime=await realpath(await mkdtemp(path.join(runtimeBase,'observatory-quota-collection-')));try{await action(runtime);}finally{await rm(runtime,{recursive:true,force:true});}}
test('daily history refresh is hourly while limits retain independent observations',async()=>fixture(async runtime=>{
  const scope='a'.repeat(64), requests=[];
  let latest;
  for(const offset of [0,300000,3300000,3600000]) {
    const at=now+offset;
    latest=await collectQuota(runtime,{enabled:true,clock:()=>at,resolveExecutable:async()=>'/fake/codex',
      readSnapshot:async(file,salt,{dailyUsageScope})=>{
        requests.push(dailyUsageScope);
        return {scope,status:'ok',checkedAt:new Date(at).toISOString(),
          windows:[{bucket:'codex',window:'primary',remainingPercent:75}],
          ...(dailyUsageScope===scope?{}:{accountUsage:{status:'ok',checkedAt:new Date(at).toISOString(),
            dailyUsageBuckets:[{startDate:'2026-09-09',tokens:offset===0?12:18}]}})};
      }});
    assert.equal(latest.accountUsageCheckedAt,new Date(offset<3600000?now:at).toISOString());
    assert.equal(latest.dailyUsageBuckets[0].tokens,offset<3600000?12:18);
    assert.equal(latest.checkedAt,new Date(at).toISOString());
    assert.equal(JSON.stringify(latest).includes(scope),false);
  }
  assert.deepEqual(requests,[null,scope,scope,null]);
  assert.equal(latest.history.length,4);
}));
test('failed daily refresh preserves its timestamp and remains due on the next allowed read',async()=>fixture(async runtime=>{
  const scope='a'.repeat(64);
  for(const offset of [0,3600000,3900000]) {
    const at=now+offset;
    const result=await collectQuota(runtime,{enabled:true,clock:()=>at,resolveExecutable:async()=>'/fake/codex',
      readSnapshot:async(file,salt,{dailyUsageScope})=>{
        assert.equal(dailyUsageScope,null);
        return {scope,status:'ok',checkedAt:new Date(at).toISOString(),windows:[{bucket:'codex',window:'primary',remainingPercent:75}],
          accountUsage:offset===0?{status:'ok',checkedAt:new Date(at).toISOString(),dailyUsageBuckets:[{startDate:'2026-09-09',tokens:12}]}:{status:'unavailable'}};
      }});
    assert.equal(result.accountUsageCheckedAt,new Date(now).toISOString());
    assert.equal(result.dailyUsageBuckets[0].tokens,12);
  }
}));
test('disabled quota never discovers clients or creates a private store',async()=>fixture(async runtime=>{
  const result=await collectQuota(runtime,{resolveExecutable:()=>{throw Error('Should not run');}});
  assert.equal(result.status,'not-connected');assert.deepEqual(await readdir(runtime),[]);
}));
test('quota collection survives restart, respects cooldown, and excludes account keys',async()=>fixture(async runtime=>{
  let calls=0;
  const options={enabled:true,clock:()=>now,resolveExecutable:async()=>'/fake/codex',readSnapshot:async()=>{
    calls++;return {scope:'a'.repeat(64),status:'ok',checkedAt:new Date(now).toISOString(),
      windows:[{bucket:'codex',window:'primary',remainingPercent:75}],email:'PRIVATE'};
  }};
  const first=await collectQuota(runtime,options);
  const cached=await collectQuota(runtime,options);
  assert.equal(calls,1);assert.equal(first.status,'ok');assert.equal(cached.status,'ok');
  assert.equal(first.pace[0].status,'insufficient-history');
  assert.equal(cached.checkedAt,first.checkedAt);
  assert.deepEqual(cached.history,first.history);
  assert.equal(cached.history.length,1);assert.equal(cached.scope,'account');
  assert.equal(JSON.stringify(cached).includes('aaaaaa'),false);assert.equal(JSON.stringify(cached).includes('PRIVATE'),false);
  await collectQuota(runtime,{enabled:false,clock:()=>now});
  const reenabled=await collectQuota(runtime,{...options,readSnapshot:async()=>{throw Error('Offline');}});
  assert.equal(reenabled.status,'unavailable');assert.deepEqual(reenabled.history,[]);
  assert.equal(reenabled.latestReadStatus,'waiting');assert.equal(calls,1);
  assert.equal(reenabled.nextAttemptAt,first.nextAttemptAt);
}));
test('successful cached samples age out and failed polls remain stale even with recent history',async()=>fixture(async runtime=>{
  const options={enabled:true,clock:()=>now,resolveExecutable:async()=>'/fake/codex',readSnapshot:async()=>({
    scope:'a'.repeat(64),status:'ok',checkedAt:new Date(now-600000).toISOString(),
    windows:[{bucket:'codex',window:'primary',remainingPercent:75}]})};
  const old=await collectQuota(runtime,options);
  assert.equal(old.status,'stale');assert.equal(old.latestReadStatus,'ok');
  assert.equal(old.pace[0].status,'stale');
  assert.equal(old.checkedAt,new Date(now-600000).toISOString());
  const fresh=await collectQuota(runtime,{...options,clock:()=>now+300001,readSnapshot:async()=>({
    scope:'a'.repeat(64),status:'ok',checkedAt:new Date(now+300001).toISOString(),
    windows:[{bucket:'codex',window:'primary',remainingPercent:70}]})});
  assert.equal(fresh.status,'ok');
  const failed=await collectQuota(runtime,{...options,clock:()=>now+600002,readSnapshot:async()=>{throw Error('Offline');}});
  assert.equal(failed.status,'stale');assert.equal(failed.latestReadStatus,'unavailable');
  assert.equal(failed.checkedAt,fresh.checkedAt);
  assert.deepEqual(failed.history,fresh.history);
}));
test('failed reads persist retry deadlines without inventing usage',async()=>fixture(async runtime=>{
  let calls=0;
  const options={enabled:true,clock:()=>now,resolveExecutable:async()=>'/fake/codex',readSnapshot:async()=>{calls++;throw Object.assign(Error('PRIVATE'),{status:'rate-limited'});}};
  const result=await collectQuota(runtime,options);
  await collectQuota(runtime,options);
  assert.equal(calls,1);assert.equal(result.latestReadStatus,'rate-limited');assert.deepEqual(result.windows,[]);
  assert.ok(Date.parse(result.nextAttemptAt)>now);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
}));
test('a newly observed account clears the prior account history even if its quota request fails',async()=>fixture(async runtime=>{
  await collectQuota(runtime,{enabled:true,clock:()=>now,resolveExecutable:async()=>'/fake/codex',
    readSnapshot:async()=>({scope:'a'.repeat(64),status:'ok',checkedAt:new Date(now).toISOString(),
      windows:[{bucket:'codex',window:'primary',remainingPercent:75}],
      accountUsage:{status:'ok',checkedAt:new Date(now).toISOString(),dailyUsageBuckets:[{startDate:'2026-09-09',tokens:12}]}})});
  const result=await collectQuota(runtime,{enabled:true,clock:()=>now+300001,resolveExecutable:async()=>'/fake/codex',
    readSnapshot:async()=>{throw Object.assign(Error('PRIVATE'),{scope:'b'.repeat(64),status:'rate-limited'});}});
  assert.deepEqual(result.windows,[]);
  assert.deepEqual(result.history,[]);
  assert.deepEqual(result.dailyUsageBuckets,[]);
  assert.equal(result.latestReadStatus,'rate-limited');
  assert.equal(result.scope,'account');
  assert.equal(JSON.stringify(result).includes('bbbbbb'),false);
}));
