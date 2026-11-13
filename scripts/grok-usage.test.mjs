import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sliceName,cleanWeeklyUsage,countRequests,readGrokUsage} from './grok-usage.mjs';
import {ENGINE_OFF_MS} from '../lib/freshness.mjs';

const now=Date.parse('2026-11-12T23:00:00Z');
const base32=text=>{
  const alphabet='abcdefghijklmnopqrstuvwxyz234567';
  let bits=0,value=0,out='';
  for(const byte of Buffer.from(text)) {
    value=(value<<8)|byte;bits+=8;
    while(bits>=5) {out+=alphabet[(value>>>(bits-5))&31];bits-=5;}
  }
  return bits?out+alphabet[(value<<(5-bits))&31]:out;
};
const weekly=(usage,{readAtMs=now-2*3600000,expiresAtMs=now+22*3600000}={})=>({schemaVersion:2,value:{kind:'present',
  reading:{usage:{percentUsed:46.1,nextResetMs:now+4*86400000,hasNonZeroIncludedLimit:true,unifiedPlanName:'Premium',...usage},readAtMs},expiresAtMs}});

async function appFolder(files) {
  const root=await mkdtemp(path.join(tmpdir(),'grok-usage-'));
  await mkdir(path.join(root,'sand-client-persistence'));
  for(const [key,body] of Object.entries(files))
    await writeFile(path.join(root,'sand-client-persistence',base32(key)+'.blob'),typeof body==='string'?body:JSON.stringify(body));
  return root;
}

test('slice names decode from base32', () => {
  assert.equal(sliceName(base32('sand.client.slice.account.x.weekly-usage.cache')+'.blob'),'sand.client.slice.account.x.weekly-usage.cache');
  assert.equal(sliceName('not base32!.blob'),null);
  assert.equal(sliceName('abc.json'),null);
});

test('a cached weekly reading becomes one weekly window with the share left', () => {
  const reading=cleanWeeklyUsage(weekly({}));
  assert.equal(reading.plan,'premium');
  assert.equal(reading.checkedAt,new Date(now-2*3600000).toISOString());
  assert.equal(reading.validUntil,new Date(now+22*3600000).toISOString());
  assert.deepEqual(reading.windows,[{bucket:'grok',window:'weekly',durationMinutes:10080,remainingPercent:53.9,
    resetsAt:new Date(now+4*86400000).toISOString(),checkedAt:reading.checkedAt}]);
});

test('no included limit means no window and no made-up percent', () => {
  assert.deepEqual(cleanWeeklyUsage(weekly({hasNonZeroIncludedLimit:false})).windows,[]);
  assert.deepEqual(cleanWeeklyUsage(weekly({percentUsed:140})).windows,[]);
});

test('the app\'s expiry is capped at the engine off threshold', () => {
  const readAtMs=now-3600000;
  const reading=cleanWeeklyUsage(weekly({},{readAtMs,expiresAtMs:readAtMs+10*ENGINE_OFF_MS}));
  assert.equal(Date.parse(reading.validUntil),readAtMs+ENGINE_OFF_MS);
});

test('anything that is not a present reading is ignored', () => {
  assert.equal(cleanWeeklyUsage({schemaVersion:1,value:{}}),null);
  assert.equal(cleanWeeklyUsage({schemaVersion:2,value:{kind:'absent'}}),null);
  assert.equal(cleanWeeklyUsage(null),null);
});

test('requests count per local day over two weeks and keep nothing else', () => {
  const lines=[
    {at:'2026-11-12T17:16:32-0500',task:'private text'},
    {at:'2026-11-12T03:00:00Z'},
    {at:'2026-11-11T12:00:00Z'},
    {at:'2026-10-01T12:00:00Z'},
    {at:'not a time'},
  ].map(row=>JSON.stringify(row)).join('\n')+'\nnot json\n';
  assert.deepEqual(countRequests(lines,{now,timeZone:'America/New_York'}),
    [{date:'2026-11-11',count:2},{date:'2026-11-12',count:1}]);
});

test('the newest weekly reading in the folder wins, and other slices are skipped', async () => {
  const root=await appFolder({
    'sand.client.slice.account.a.weekly-usage.cache':weekly({percentUsed:10},{readAtMs:now-5*3600000}),
    'sand.client.slice.account.b.weekly-usage.cache':weekly({percentUsed:30},{readAtMs:now-3600000}),
    'sand.client.slice.account.b.roster.last-roster':{secret:'never read'},
    'sand.client.slice.account.c.weekly-usage.cache':'{broken',
  });
  try {
    const source=await readGrokUsage({appFolder:root,now,timeZone:'UTC'});
    assert.equal(source.status,'ok');
    assert.equal(source.windows[0].remainingPercent,70);
    assert.equal(JSON.stringify(source).includes('never read'),false);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('a request log alone gives usage with no window', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'grok-log-'));
  const log=path.join(root,'sent.jsonl');
  await writeFile(log,JSON.stringify({at:new Date(now-3600000).toISOString()})+'\n');
  try {
    const source=await readGrokUsage({requestLog:log,now,timeZone:'UTC'});
    assert.equal(source.status,'ok');
    assert.deepEqual(source.windows,[]);
    assert.deepEqual(source.requests,{timeZone:'UTC',checkedAt:new Date(now).toISOString(),days:[{date:'2026-11-12',count:1}]});
    const missing=await readGrokUsage({requestLog:path.join(root,'none.jsonl'),now,timeZone:'UTC'});
    assert.equal(missing.status,'unavailable','a wrong log path is not zero requests');
    assert.equal(missing.requests,undefined);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('nothing configured is no source; nothing readable is unavailable', async () => {
  assert.equal((await readGrokUsage({now,timeZone:'UTC'})).status,'not-connected');
  assert.equal((await readGrokUsage({appFolder:'/nonexistent/grok',now,timeZone:'UTC'})).status,'unavailable');
});

test('a cache reading older than a day stops counting, but a live log still shows requests', async () => {
  const old=now-2*86400000;
  const root=await appFolder({'sand.client.slice.account.a.weekly-usage.cache':weekly({},{readAtMs:old,expiresAtMs:old+3600000})});
  const log=path.join(root,'sent.jsonl');
  await writeFile(log,JSON.stringify({at:new Date(now-60000).toISOString()})+'\n');
  try {
    const both=await readGrokUsage({appFolder:root,requestLog:log,now,timeZone:'UTC'});
    assert.deepEqual(both.windows,[]);
    assert.deepEqual(both.requests.days,[{date:'2026-11-12',count:1}]);
    const alone=await readGrokUsage({appFolder:root,now,timeZone:'UTC'});
    assert.equal(alone.status,'stale');
    assert.equal(alone.checkedAt,new Date(old).toISOString());
  } finally {await rm(root,{recursive:true,force:true});}
});

test('a linked or oversized cache file is not read', async () => {
  const root=await appFolder({});
  const outside=path.join(root,'outside.json');
  await writeFile(outside,JSON.stringify(weekly({})));
  const folder=path.join(root,'sand-client-persistence');
  await symlink(outside,path.join(folder,base32('sand.client.slice.account.a.weekly-usage.cache')+'.blob'));
  await writeFile(path.join(folder,base32('sand.client.slice.account.b.weekly-usage.cache')+'.blob'),JSON.stringify(weekly({}))+' '.repeat(70000));
  try {
    assert.equal((await readGrokUsage({appFolder:root,now,timeZone:'UTC'})).status,'unavailable');
  } finally {await rm(root,{recursive:true,force:true});}
});

test('a log with lines but no times is not read as zero requests', async () => {
  assert.equal(countRequests('{"ts":"2026-11-12T10:00:00Z"}\nnot json\n',{now,timeZone:'UTC'}),null);
  assert.deepEqual(countRequests('',{now,timeZone:'UTC'}),[],'an empty log is a real zero');
  const root=await mkdtemp(path.join(tmpdir(),'grok-log-'));
  const log=path.join(root,'other.jsonl');
  await writeFile(log,'{"ts":"2026-11-12T10:00:00Z"}\n');
  try {assert.equal((await readGrokUsage({requestLog:log,now,timeZone:'UTC'})).status,'unavailable');}
  finally {await rm(root,{recursive:true,force:true});}
});

test('a cache past the app\'s expiry gives way to a live log at once', async () => {
  const readAtMs=now-2*3600000;
  const root=await appFolder({'sand.client.slice.account.a.weekly-usage.cache':weekly({},{readAtMs,expiresAtMs:readAtMs+1800000})});
  const log=path.join(root,'sent.jsonl');
  await writeFile(log,JSON.stringify({at:new Date(now-60000).toISOString()})+'\n');
  try {
    const both=await readGrokUsage({appFolder:root,requestLog:log,now,timeZone:'UTC'});
    assert.deepEqual(both.windows,[]);
    assert.deepEqual(both.requests.days,[{date:'2026-11-12',count:1}]);
    const alone=await readGrokUsage({appFolder:root,now,timeZone:'UTC'});
    assert.equal(alone.windows.length,1,'with no log the expired reading stays, to read Unknown and later Off');
  } finally {await rm(root,{recursive:true,force:true});}
});
