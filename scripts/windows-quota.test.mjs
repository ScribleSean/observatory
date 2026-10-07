import test from 'node:test';
import assert from 'node:assert/strict';
import {findWindowsQuotaClient,readWindowsQuotaSnapshot} from './windows-quota.mjs';
import {windowsCollectorConfig} from './windows-snapshot.mjs';

test('native account source does not discover or start WSL',async()=>{
  const client=await findWindowsQuotaClient(null,{findNative:async()=>'/fake/codex',run:()=>{throw Error('Unexpected WSL');}});
  assert.deepEqual(client,{executable:'/fake/codex',prefix:[]});
});
test('retired WSL account choices never launch a process or select a native identity',async()=>{
  for(const distribution of ['Ubuntu','Ubuntu-24.04','Ubuntu; command',true,'']) {
    let calls=0;
    const reader=async()=>{calls++;return {stdout:'/home/fixture\n'};};
    await assert.rejects(findWindowsQuotaClient(distribution,{run:reader,findNative:reader}),/retired|Invalid/);
    assert.equal(calls,0);
  }
});
test('native invocation retains the account reader protocol and privacy options',async()=>{
  let invocation;
  const client={executable:'C:/fixture/codex.exe',prefix:[]};
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
  assert.deepEqual(invocation,[client.executable,['app-server'],{windowsHide:true,stdio:['pipe','pipe','ignore']}]);
});
test('a retained WSL client descriptor is rejected before the account reader runs',()=>{
  let calls=0;
  assert.throws(()=>readWindowsQuotaSnapshot({executable:'C:\\Windows\\System32\\wsl.exe',prefix:[]},'a'.repeat(64),{
    read:()=>{calls++;},spawnProcess:()=>{calls++;},
  }),/retired/);
  assert.equal(calls,0);
});
test('legacy WSL account settings disable polling without clearing the saved identity choice',()=>{
  const defaults=windowsCollectorConfig();
  assert.equal(defaults.quota,false);assert.equal(defaults.quotaWslDistribution,null);
  const raw={quota:true,quotaWslDistribution:'Ubuntu',wslDistribution:null,codex:false};
  const selected=windowsCollectorConfig(raw);
  assert.equal(selected.quota,false);
  assert.equal(selected.quotaWslDistribution,'Ubuntu');assert.equal(selected.codex,false);
  assert.equal(raw.quota,true);assert.equal(raw.quotaWslDistribution,'Ubuntu');
  assert.equal(windowsCollectorConfig({quota:true}).quota,true);
  for(const value of [true,1,'','-Ubuntu','Ubuntu;whoami'])assert.throws(()=>windowsCollectorConfig({quotaWslDistribution:value}));
});
