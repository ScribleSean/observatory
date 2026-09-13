import test from 'node:test';
import assert from 'node:assert/strict';
import {findWindowsQuotaClient,readWindowsQuotaSnapshot} from './windows-quota.mjs';
import {windowsCollectorConfig} from './windows-snapshot.mjs';

test('native account source does not discover or start WSL',async()=>{
  const client=await findWindowsQuotaClient(null,{findNative:async()=>'/fake/codex',run:()=>{throw Error('Unexpected WSL');}});
  assert.deepEqual(client,{executable:'/fake/codex',prefix:[]});
});
test('explicit WSL account source finds a client without shell expansion or credential reads',async()=>{
  const calls=[];
  const client=await findWindowsQuotaClient('Ubuntu',{systemRoot:'C:/Windows',findNative:()=>{throw Error('No native fallback');},
    run:async(file,args,options)=>{calls.push({file,args,options});return {stdout:args.includes('HOME')?'/home/fixture\n':''};}});
  assert.equal(calls.length,2);
  assert.deepEqual(calls[0].args,['--distribution','Ubuntu','--exec','/usr/bin/printenv','HOME']);
  assert.deepEqual(calls[1].args,['--distribution','Ubuntu','--exec','/usr/bin/test','-x','/home/fixture/.local/bin/codex']);
  assert.deepEqual(client.prefix,['--distribution','Ubuntu','--exec','/usr/bin/timeout','--kill-after=2s','20s','/home/fixture/.local/bin/codex']);
  assert.ok(calls.every(call=>call.options.timeout===10000 && call.options.maxBuffer===4096));
});
test('invalid WSL source or home fails closed, and missing clients never select a different account source',async()=>{
  await assert.rejects(findWindowsQuotaClient('Ubuntu; command'),/Invalid/);
  await assert.rejects(findWindowsQuotaClient('Ubuntu',{run:async()=>({stdout:'/home/fixture; command'})}),/Unsupported/);
  let calls=0;
  await assert.rejects(findWindowsQuotaClient('Ubuntu',{findNative:()=>{throw Error('Must not fall back');},run:async()=>{
    if(calls++===0)return {stdout:'/home/fixture\n'};throw Error('Missing');
  }}),/Selected WSL Codex client unavailable/);
  assert.equal(calls,4);
});
test('WSL invocation retains the account reader protocol and privacy options',async()=>{
  let invocation;
  const client={executable:'C:\\Windows\\System32\\wsl.exe',prefix:['--distribution','Ubuntu','--exec','/usr/bin/timeout','--kill-after=2s','20s','/home/fixture/.local/bin/codex']};
  const result=await readWindowsQuotaSnapshot(client,'a'.repeat(64),{
    dailyUsageScope:'b'.repeat(64),
    read:async(file,salt,options)=>{
      assert.equal(salt,'a'.repeat(64));
      assert.equal(options.dailyUsageScope,'b'.repeat(64));
      options.spawnProcess(file,['app-server'],{windowsHide:true,stdio:['pipe','pipe','ignore']});
      return {status:'ok'};
    },spawnProcess:(...args)=>{invocation=args;},
  });
  assert.equal(result.status,'ok');
  assert.deepEqual(invocation,[client.executable,[...client.prefix,'app-server'],{windowsHide:true,stdio:['pipe','pipe','ignore']}]);
});
test('account WSL choice is explicit and independent from saved-log collection',()=>{
  const defaults=windowsCollectorConfig();
  assert.equal(defaults.quota,false);assert.equal(defaults.quotaWslDistribution,null);
  const selected=windowsCollectorConfig({quota:true,quotaWslDistribution:'Ubuntu',wslDistribution:null,codex:false});
  assert.equal(selected.quotaWslDistribution,'Ubuntu');assert.equal(selected.wslDistribution,null);assert.equal(selected.codex,false);
  for(const value of [true,1,'','-Ubuntu','Ubuntu;whoami'])assert.throws(()=>windowsCollectorConfig({quotaWslDistribution:value}));
});
