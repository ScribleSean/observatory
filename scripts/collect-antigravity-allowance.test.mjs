import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {findAntigravityExecutable,collectConfiguredAntigravityAllowance,attachProviderAllowances} from './collect-antigravity-allowance.mjs';
import {collectMac} from './collect-mac.mjs';

const at='2026-09-25T12:00:00.000Z',clock=()=>Date.parse(at);
const source=()=>({provider:'antigravity',host:'Mac',status:'ok',checkedAt:at,scope:'Provider-reported allowance',
  windows:[{bucket:'poolA',window:'5h',remainingPercent:75,durationMinutes:300,resetsAt:'2026-09-25T17:00:00Z'}]});
async function directory(t) {
  const folder=await mkdtemp(path.join(tmpdir(),'observatory-provider-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));return folder;
}

test('disabled collection performs no executable discovery, invocation, or consent recheck',async()=>{
  const fail=()=>assert.fail('Disabled source performed work');
  const result=await collectConfiguredAntigravityAllowance({host:'Mac',clock,resolveExecutable:fail,read:fail,isEnabled:fail});
  assert.equal(result.status,'not-connected');assert.deepEqual(result.windows,[]);
});

test('Windows enabled source returns unsupported without executable discovery',async()=>{
  const fail=()=>assert.fail('Windows source performed work');
  const result=await collectConfiguredAntigravityAllowance({enabled:true,host:'Windows',clock,resolveExecutable:fail,read:fail});
  assert.equal(result.status,'unsupported');assert.equal(result.host,'Windows');
});
test('collection rechecks consent before discovery and again before provider execution',async()=>{
  const fail=()=>assert.fail('Disabled source performed work');
  const alreadyOff=await collectConfiguredAntigravityAllowance({enabled:true,host:'Mac',clock,
    isEnabled:async()=>false,resolveExecutable:fail,read:fail});
  assert.equal(alreadyOff.status,'not-connected');
  let enabled=true,discoveries=0;
  const switchedOff=await collectConfiguredAntigravityAllowance({enabled:true,host:'Mac',clock,
    isEnabled:async()=>enabled,resolveExecutable:async()=>{discoveries++;enabled=false;return '/synthetic';},read:fail});
  assert.equal(discoveries,1);assert.equal(switchedOff.status,'not-connected');
});

test('a configured Mac source passes only the resolved path and observation metadata',async()=>{
  const calls=[];
  const result=await collectConfiguredAntigravityAllowance({enabled:true,host:'Mac',clock,resolveExecutable:async()=>'/synthetic/agy',
    read:async options=>{calls.push(options);return source();}});
  assert.deepEqual(calls,[{executable:'/synthetic/agy',host:'Mac',checkedAt:at}]);
  assert.deepEqual(result,source());
});

test('missing clients and failed reads stay unavailable without leaking diagnostics',async()=>{
  for(const resolveExecutable of [async()=>null,async()=>{throw Error('PRIVATE path');}]) {
    const result=await collectConfiguredAntigravityAllowance({enabled:true,host:'Mac',clock,resolveExecutable,read:()=>assert.fail('Must not read')});
    assert.equal(result.status,'unavailable');assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  }
  const result=await collectConfiguredAntigravityAllowance({enabled:true,host:'Mac',clock,resolveExecutable:async()=>'/synthetic',read:()=>{throw Error('PRIVATE auth');}});
  assert.equal(result.status,'unavailable');assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});

test('disabling the source while a read runs discards the completed observation',async()=>{
  let enabled=true,reads=0;
  const result=await collectConfiguredAntigravityAllowance({enabled:true,host:'Mac',clock,resolveExecutable:async()=>'/synthetic',
    read:async()=>{reads++;enabled=false;return source();},isEnabled:async()=>enabled});
  assert.equal(reads,1);
  assert.equal(result.status,'not-connected');assert.deepEqual(result.windows,[]);
});

test('executable resolution checks the known installation without executing it',{skip:process.platform==='win32'},async t=>{
  const home=await directory(t),bin=path.join(home,'.local/bin');await mkdir(bin,{recursive:true});
  const target=path.join(home,'synthetic-cli');await writeFile(target,'not a runnable provider client',{mode:0o700});
  await symlink(target,path.join(bin,'agy'));
  assert.equal(await findAntigravityExecutable({platform:'darwin',home,searchPath:''}),await realpath(target));
  assert.equal(await findAntigravityExecutable({platform:'win32',home,searchPath:''}),null);
  assert.equal(await findAntigravityExecutable({platform:'darwin',home:'relative',searchPath:''}),null);
});

test('attachment preserves Codex observations and excludes provider data from peer payloads',()=>{
  const quota={provider:'Codex',windows:[{bucket:'codex',remainingPercent:10}]};
  const tokens=[{host:'Mac',status:'ok',days:[{totalTokens:99}]}];
  const result={data:{quota,tokens},status:{sourcesRead:2,sourcesConfigured:2,state:'ok'},peer:{payload:{codex:tokens}}};
  attachProviderAllowances(result,[source()]);
  assert.equal(result.data.quota,quota);assert.equal(result.data.tokens,tokens);
  assert.equal(result.peer.payload.providerAllowances,undefined);
  assert.equal(result.status.sourcesRead,3);assert.equal(result.status.sourcesConfigured,3);
  assert.equal(result.data.providerAllowances[0].windows[0].remainingPercent,75);
});

test('a failed optional source affects source health without filling in zero limits',()=>{
  const result={data:{},status:{sourcesRead:2,sourcesConfigured:2,state:'ok'}};
  attachProviderAllowances(result,[{...source(),status:'unavailable',windows:[]}]);
  assert.equal(result.status.state,'partial');assert.equal(result.status.sourcesRead,2);assert.equal(result.status.sourcesConfigured,3);
  const disabled={data:{},status:{sourcesRead:2,sourcesConfigured:2,state:'ok'}};
  attachProviderAllowances(disabled,[{...source(),status:'not-connected',windows:[]}]);
  assert.equal(disabled.status.sourcesConfigured,2);assert.equal(disabled.status.state,'ok');
});

test('full Mac collection attaches the provider after other merges and quota-only refresh preserves its age',{skip:process.platform!=='darwin'},async t=>{
  const root=await directory(t);
  await writeFile(path.join(root,'collector.config.json'),JSON.stringify({activity:false,codex:false,claude:false,wispr:false,quota:false,antigravity:true}));
  let reads=0;
  const result=await collectMac(root,'/usr/bin/python3',null,{readAntigravity:async options=>{
    assert.equal(options.enabled,true);assert.equal(options.host,'Mac');assert.equal(await options.isEnabled(),true);reads++;return source();
  }});
  assert.equal(reads,1);assert.equal(result.data.quota.status,'not-connected');
  assert.equal(result.data.providerAllowances[0].checkedAt,at);
  const saved=JSON.parse(await readFile(path.join(root,'public/local/usage.json'),'utf8'));
  assert.equal(saved.providerAllowances[0].status,'ok');
  await collectMac(root,'/usr/bin/python3',null,{quotaOnly:true,readAntigravity:()=>assert.fail('Fast Codex refresh must not poll this provider')});
  const refreshed=JSON.parse(await readFile(path.join(root,'public/local/usage.json'),'utf8'));
  assert.deepEqual(refreshed.providerAllowances,saved.providerAllowances);
  assert.equal(refreshed.collectedAt,saved.collectedAt);
});
