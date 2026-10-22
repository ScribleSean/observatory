import test from 'node:test';
import assert from 'node:assert/strict';
import {findWindowsQuotaClient,readWindowsQuotaSnapshot} from './windows-quota.mjs';

test('native account source uses the discovered Windows client only',async()=>{
  const client=await findWindowsQuotaClient({findNative:async()=>'/fake/codex'});
  assert.deepEqual(client,{executable:'/fake/codex',prefix:[]});
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
test('a malformed client descriptor is rejected before the account reader runs',()=>{
  let calls=0;
  for(const client of [null,{executable:'C:/fixture/codex.exe',prefix:['-d','fixture']},{executable:7,prefix:[]},{executable:'C:/fixture/codex.exe'}])
    assert.throws(()=>readWindowsQuotaSnapshot(client,'a'.repeat(64),{
      read:()=>{calls++;},spawnProcess:()=>{calls++;},
    }),/Invalid account client/);
  assert.equal(calls,0);
});
test('a configured Codex path is used without searching',async()=>{
  const client=await findWindowsQuotaClient({configured:'C:\\Tools\\codex.exe',findNative:async()=>{throw Error('should not search');}});
  assert.deepEqual(client,{executable:'C:\\Tools\\codex.exe',prefix:[]});
});
