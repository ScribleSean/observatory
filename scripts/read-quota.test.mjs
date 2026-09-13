import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanQuota,cleanAccountUsage,readAccountSnapshot} from './read-quota.mjs';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createHmac} from 'node:crypto';
test('quota adapter preserves separate buckets and drops account and credit details', () => {
  const result=cleanQuota({accountId:'PRIVATE',credits:{secret:'PRIVATE'},rateLimitsByLimitId:{codex:{primary:{usedPercent:25,windowDurationMins:300,resetsAt:1800000000}},example:{secondary:{usedPercent:80,windowDurationMins:10080}}}});
  assert.equal(result.windows.length,2); assert.equal(result.windows[0].remainingPercent,75);
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});
test('retired Spark and Bengal-fox allowances are omitted without removing other limits',()=>{
  const bucket={primary:{usedPercent:25}};
  const result=cleanQuota({rateLimitsByLimitId:{codex:bucket,codex_bengalfox:bucket,spark:bucket,CODEX_SPARK:bucket}});
  assert.deepEqual(result.windows.map(row=>row.bucket),['codex']);
});
test('invalid quota values stay unavailable', () => {
  assert.equal(cleanQuota({rateLimits:{primary:{usedPercent:'25'}}}).status,'unavailable');
  assert.equal(cleanQuota({rateLimits:{primary:{usedPercent:101}}}).windows.length,0);
});
test('account token adapter allowlists metrics and preserves missing days', () => {
  const value=cleanAccountUsage({email:'PRIVATE',summary:{lifetimeTokens:10,peakDailyTokens:null,secret:'PRIVATE'},
    dailyUsageBuckets:[{startDate:'2026-09-01',tokens:0,prompt:'PRIVATE'},{startDate:'2026-09-03',tokens:10}]});
  assert.equal(value.scope,'account');
  assert.equal(value.status,'ok');
  assert.equal(value.summary.peakDailyTokens,null);
  assert.deepEqual(value.dailyUsageBuckets,[{startDate:'2026-09-01',tokens:0},{startDate:'2026-09-03',tokens:10}]);
  assert.equal(JSON.stringify(value).includes('PRIVATE'),false);
});
test('account token adapter rejects malformed values without inventing zero', () => {
  const value=cleanAccountUsage({summary:{lifetimeTokens:-1,peakDailyTokens:'10'},dailyUsageBuckets:[
    {startDate:'2026-02-30',tokens:5},{startDate:'2026-01-01',tokens:Infinity},{startDate:'PRIVATE',tokens:1},null]});
  assert.equal(value.status,'unavailable');
  assert.deepEqual(value.dailyUsageBuckets,[]);
  assert.equal(value.summary.lifetimeTokens,null);
  assert.throws(()=>cleanAccountUsage(null));
  assert.throws(()=>cleanQuota(null));
  assert.throws(()=>cleanQuota({rateLimitsByLimitId:[]}));
  assert.equal(cleanAccountUsage({summary:{longestRunningTurnSec:3.25}}).summary.longestRunningTurnSec,3.25);
});
test('account daily buckets replace duplicates and sort without cross-device sums', () => {
  const value=cleanAccountUsage({dailyUsageBuckets:[{startDate:'2026-09-03',tokens:4},
    {startDate:'2026-09-01',tokens:1},{startDate:'2026-09-03',tokens:6}]});
  assert.deepEqual(value.dailyUsageBuckets,[{startDate:'2026-09-01',tokens:1},{startDate:'2026-09-03',tokens:6}]);
});

function fakeClient(reply) {
  const child=new EventEmitter();child.stdout=new PassThrough();
  const methods=[];let input='',closed=false;
  child.stdin=new Writable({write(chunk,encoding,done) {
    input+=chunk.toString();let end;
    while((end=input.indexOf('\n'))>=0) {
      const row=JSON.parse(input.slice(0,end));input=input.slice(end+1);methods.push(row.method);
      const answer=reply(row,methods);
      if(answer!==undefined)setImmediate(()=>child.stdout.write(JSON.stringify({id:row.id,...answer})+'\n'));
    }
    done();
  }});
  child.kill=()=>{if(!closed){closed=true;setImmediate(()=>{child.stdout.end();child.emit('close',0);});}return true;};
  return {spawnProcess:()=>child,methods,isClosed:()=>closed};
}
const normalReply=row=>{
  if(row.method==='initialize')return {result:{}};
  if(row.method==='account/read')return {result:{account:{type:'chatgpt',id:'PRIVATE-ID',email:'PRIVATE'}}};
  if(row.method==='account/rateLimits/read')return {result:{rateLimits:{primary:{usedPercent:25}}}};
  if(row.method==='account/usage/read')return {result:{dailyUsageBuckets:[{startDate:'2026-09-09',tokens:12}]}};
};
test('one client performs only metadata reads, verifies identity twice, and closes before returning',async()=>{
  const client=fakeClient(normalReply);
  const result=await readAccountSnapshot('/fake/codex','a'.repeat(64),client);
  assert.equal(result.status,'ok');assert.equal(result.accountUsage.dailyUsageBuckets[0].tokens,12);
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal(client.isClosed(),true);
  assert.deepEqual(client.methods,['initialize','initialized','account/read','account/rateLimits/read','account/usage/read','account/read']);
});
test('older client token API failure does not discard valid quota windows',async()=>{
  const client=fakeClient(row=>row.method==='account/usage/read'?{error:{code:-32601,message:'PRIVATE'}}:normalReply(row));
  const result=await readAccountSnapshot('/fake/codex','a'.repeat(64),client);
  assert.equal(result.status,'ok');assert.equal(result.accountUsage.status,'unsupported');
});
test('limits-only reads skip daily usage only for the same verified account',async()=>{
  const salt='a'.repeat(64);
  const scope=createHmac('sha256',Buffer.from(salt,'hex')).update('codex-account:PRIVATE-ID').digest('hex');
  for(const dailyUsageScope of [scope,'b'.repeat(64),null]) {
    const client=fakeClient(normalReply);
    const result=await readAccountSnapshot('/fake/codex',salt,{...client,dailyUsageScope});
    assert.equal(result.status,'ok');
    assert.equal(client.methods.includes('account/usage/read'),dailyUsageScope!==scope);
    assert.equal(Object.hasOwn(result,'accountUsage'),dailyUsageScope!==scope);
    assert.equal(client.methods.filter(method=>method==='account/read').length,2);
    assert.equal(client.isClosed(),true);
  }
  assert.throws(()=>readAccountSnapshot('/fake/codex',salt,{dailyUsageScope:'invalid'}),/Invalid daily usage scope/);
});
test('limits-only account switches during a request fail closed',async()=>{
  const salt='a'.repeat(64);
  const scope=createHmac('sha256',Buffer.from(salt,'hex')).update('codex-account:PRIVATE-ID').digest('hex');
  let accounts=0;
  const client=fakeClient(row=>row.method==='account/read' && ++accounts>1 ?
    {result:{account:{type:'chatgpt',id:'OTHER'}}}:normalReply(row));
  await assert.rejects(readAccountSnapshot('/fake/codex',salt,{...client,dailyUsageScope:scope}),error=>error.status==='needs-auth');
  assert.equal(client.methods.includes('account/usage/read'),false);
  assert.equal(client.isClosed(),true);
});
test('sign-out and an account switch cannot return mixed account readings',async()=>{
  for(const signedOut of [false,true]) {
    let accounts=0;
    const client=fakeClient(row=>{
      if(row.method==='account/read' && ++accounts>1)return {result:{account:signedOut?null:{type:'chatgpt',id:'OTHER'}}};
      return normalReply(row);
    });
    await assert.rejects(readAccountSnapshot('/fake/codex','a'.repeat(64),client),error=>error.status==='needs-auth');
    assert.equal(client.isClosed(),true);
  }
});
test('a hung client times out and closes without exposing its output',async()=>{
  const client=fakeClient(()=>undefined);
  await assert.rejects(readAccountSnapshot('/fake/codex','a'.repeat(64),{...client,timeoutMs:10}),/unavailable/);
  assert.equal(client.isClosed(),true);
});
test('synchronous launch errors expose only an allowlisted diagnostic stage',async()=>{
  for(const [code,stage] of [['EACCES','launch-permission-denied'],['EPERM','launch-permission-denied'],['ENOENT','launch-not-found'],['PRIVATE','launch']]) {
    await assert.rejects(readAccountSnapshot('/PRIVATE/client','a'.repeat(64),{spawnProcess:()=>{
      throw Object.assign(Error('PRIVATE account and path'),{code,path:'/PRIVATE/client'});
    }}),error=>{
      assert.equal(error.status,'unavailable');assert.equal(error.stage,stage);
      assert.ok(!JSON.stringify(error).includes('PRIVATE'));assert.ok(!error.message.includes('PRIVATE'));
      return true;
    });
  }
});
test('asynchronous launch refusal retains its stage and closes the failed client',async()=>{
  const client=fakeClient(()=>undefined);
  const original=client.spawnProcess;
  client.spawnProcess=()=>{
    const child=original();
    setImmediate(()=>child.emit('error',Object.assign(Error('PRIVATE'),{code:'EACCES'})));
    return child;
  };
  await assert.rejects(readAccountSnapshot('/PRIVATE/client','a'.repeat(64),client),error=>{
    assert.equal(error.stage,'launch-permission-denied');assert.equal(error.status,'unavailable');
    assert.ok(!JSON.stringify(error).includes('PRIVATE'));return true;
  });
  assert.equal(client.isClosed(),true);
});
test('a failed usage read preserves the observed opaque account scope for invalidation',async()=>{
  const client=fakeClient(row=>row.method==='account/rateLimits/read'?{error:{code:429,message:'PRIVATE'}}:normalReply(row));
  const salt='a'.repeat(64);
  const scope=createHmac('sha256',Buffer.from(salt,'hex')).update('codex-account:PRIVATE-ID').digest('hex');
  await assert.rejects(readAccountSnapshot('/fake/codex',salt,client),error=>{
    assert.equal(error.status,'rate-limited');
    assert.equal(error.scope,scope);
    assert.equal(JSON.stringify(error).includes('PRIVATE'),false);
    return true;
  });
  assert.equal(client.isClosed(),true);
});
