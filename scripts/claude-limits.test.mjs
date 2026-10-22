import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,readdir,rm,symlink,writeFile,mkdir} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {attachClaudeLimits,claudeLimitsSource,extractClaudeLimits,mergeClaudeLimits,readClaudeLimits,recordClaudeLimits} from './claude-limits.mjs';

import {setLimitsConsent} from './claude-limits-consent.mjs';


const now=Date.parse('2026-03-10T15:00:00Z'),seconds=now/1000;
const input=(five=23.5,seven=41.2)=>({session_id:'synthetic',cwd:'/synthetic/project',transcript_path:'/synthetic/transcript.jsonl',
  model:{display_name:'Synthetic'},rate_limits:{
    five_hour:{used_percentage:five,resets_at:seconds+7200},seven_day:{used_percentage:seven,resets_at:seconds+3*86400}}});
async function folder(t) {
  const root=realpathSync(await mkdtemp(path.join(tmpdir(),'observatory-claude-limits-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  return root;
}

const consentText=JSON.stringify({consent:true,givenAt:'2026-10-14T00:00:00.000Z'});

test('extraction keeps only percentages and reset times', () => {
  const record=extractClaudeLimits(input(),now);
  assert.deepEqual(record,{observedAt:seconds,windows:{
    five_hour:{usedPercentage:23.5,resetsAt:seconds+7200,observedAt:seconds},
    seven_day:{usedPercentage:41.2,resetsAt:seconds+3*86400,observedAt:seconds}}});
  assert.doesNotMatch(JSON.stringify(record),/synthetic|project|transcript/i);
});

test('missing, malformed and impossible readings are rejected', () => {
  for(const value of [null,{},{rate_limits:null},{rate_limits:{}},{rate_limits:{five_hour:{used_percentage:'23',resets_at:seconds+60}}},
    {rate_limits:{five_hour:{used_percentage:120,resets_at:seconds+60}}},{rate_limits:{five_hour:{used_percentage:-1,resets_at:seconds+60}}},
    {rate_limits:{five_hour:{used_percentage:10,resets_at:seconds-60}}},{rate_limits:{five_hour:{used_percentage:10,resets_at:seconds+30*86400}}},
    {rate_limits:{five_hour:{used_percentage:Number.NaN,resets_at:seconds+60}}}])
    assert.equal(extractClaudeLimits(value,now),null);
  const partial=extractClaudeLimits({rate_limits:{seven_day:{used_percentage:5,resets_at:seconds+60}}},now);
  assert.deepEqual(Object.keys(partial.windows),['seven_day']);
});

test('several sessions keep the higher reading within one reset period', () => {
  const first=extractClaudeLimits(input(40,10),now);
  const lower=extractClaudeLimits(input(35,12),now+60000);
  const merged=mergeClaudeLimits(first,lower,now+60000);
  assert.equal(merged.windows.five_hour.usedPercentage,40);
  // The kept higher value keeps its original observation time.
  assert.equal(merged.windows.five_hour.observedAt,seconds);
  assert.equal(merged.windows.seven_day.usedPercentage,12);
  const later=input(2,12);later.rate_limits.five_hour.resets_at=seconds+7200+18000;
  assert.equal(mergeClaudeLimits(merged,extractClaudeLimits(later,now+120000),now+120000).windows.five_hour.usedPercentage,2);
  assert.deepEqual(mergeClaudeLimits({windows:'bad'},first,now),first);
  assert.equal(mergeClaudeLimits(first,null,now).windows.five_hour.usedPercentage,40);
});

test('the snapshot source separates off, missing, current, old and reset readings', () => {
  const record=extractClaudeLimits(input(),now);
  assert.deepEqual(claudeLimitsSource(record,{enabled:false,now}),{provider:'Claude Code',scope:'account',status:'not-connected',windows:[]});
  assert.equal(claudeLimitsSource(null,{enabled:true,now}).status,'unavailable');
  const current=claudeLimitsSource(record,{enabled:true,now:now+60000});
  assert.equal(current.status,'ok');
  assert.equal(current.checkedAt,'2026-03-10T15:00:00.000Z');
  assert.deepEqual(current.windows,[
    {bucket:'claude',window:'five_hour',durationMinutes:300,checkedAt:'2026-03-10T15:00:00.000Z',remainingPercent:76.5,resetsAt:'2026-03-10T17:00:00.000Z'},
    {bucket:'claude',window:'seven_day',durationMinutes:10080,checkedAt:'2026-03-10T15:00:00.000Z',remainingPercent:58.8,resetsAt:'2026-03-13T15:00:00.000Z'}]);
  assert.equal(claudeLimitsSource(record,{enabled:true,now:now+30*60000}).status,'stale');
  const afterReset=claudeLimitsSource(record,{enabled:true,now:now+3*3600000});
  assert.deepEqual(afterReset.windows.map(window=>window.window),['seven_day']);
  assert.equal(claudeLimitsSource(record,{enabled:true,now:now+10*86400000}).status,'unavailable');
  assert.equal(claudeLimitsSource({observedAt:seconds+9999,windows:{five_hour:{usedPercentage:1,resetsAt:seconds+99999,observedAt:seconds+9999}}},{enabled:true,now}).status,'unavailable');
});

test('recording writes one small private file and reading needs the install marker', async t => {
  const runtime=await folder(t);
  assert.equal(await recordClaudeLimits(runtime,{rate_limits:{}},now),null);
  await recordClaudeLimits(runtime,input(),now);
  assert.deepEqual(await readdir(path.join(runtime,'claude-limits')),['limits.json']);
  assert.doesNotMatch(await readFile(path.join(runtime,'claude-limits/limits.json'),'utf8'),/synthetic|project|transcript/i);
  assert.equal((await readClaudeLimits(runtime,{now})).status,'not-connected');
  await writeFile(path.join(runtime,'claude-limits/consent.json'),consentText);
  // Tests never start the real Claude Code command.
  const source=await readClaudeLimits(runtime,{now:now+1000,readUsage:async()=>({status:'unrecognized',usage:null})});
  assert.equal(source.status,'ok');
  const result={data:{}};attachClaudeLimits(result,source);
  assert.equal(result.data.claudeLimits.windows.length,2);
});

test('a linked folder or file is refused', {skip:process.platform==='win32' && 'Requires POSIX file link semantics'}, async t => {
  const runtime=await folder(t),elsewhere=await folder(t);
  await symlink(elsewhere,path.join(runtime,'claude-limits'));
  await assert.rejects(recordClaudeLimits(runtime,input(),now),/Unsafe/);
  const second=await folder(t);
  await mkdir(path.join(second,'claude-limits'));
  await writeFile(path.join(elsewhere,'marker.json'),consentText);
  await symlink(path.join(elsewhere,'marker.json'),path.join(second,'claude-limits/consent.json'));
  assert.equal((await readClaudeLimits(second,{now})).status,'not-connected');
});

test('reproduces the stale reading after the usage command from build 41', async t => {
  const earlier=now-40*60000;
  for(const outcome of ['read','not-found','failed','timed-out','unrecognized','throws']) {
    const runtime=await folder(t);
    const saved=await recordClaudeLimits(runtime,input(),earlier);
    await setLimitsConsent({runtime,consent:true,now:new Date(earlier)});
    const readUsage=async()=>{
      if(outcome==='throws')throw Error('synthetic private failure');
      return {status:outcome,usage:outcome==='read'?input():null};
    };
    const source=await readClaudeLimits(runtime,{now,readUsage});
    const expected=claudeLimitsSource(saved,{enabled:true,now});
    const checkedAt=new Date(outcome==='read'?now:earlier).toISOString();
    assert.deepEqual(source,{...expected,
      windows:expected.windows.map(window=>({...window,checkedAt})),
      status:outcome==='read'?'ok':'stale',checkedAt,
      usageCommand:outcome==='throws'?'failed':outcome});
  }
});

test('invalid usage results fail without exposing details or inventing a reading', async t => {
  const runtime=await folder(t);
  await setLimitsConsent({runtime,consent:true,now:new Date(now)});
  for(const result of [null,undefined,'synthetic',[],{},input(),{status:'/synthetic/private',usage:null},
    {status:'not-found',usage:input()}]) {
    assert.deepEqual(await readClaudeLimits(runtime,{now,readUsage:async()=>result}),
      {provider:'Claude Code',scope:'account',status:'unavailable',windows:[],usageCommand:'failed'});
  }
  // A reading the store cannot use counts as not recognized.
  for(const usage of [{},'synthetic',null])assert.deepEqual(await readClaudeLimits(runtime,{now,readUsage:async()=>({status:'read',usage})}),
    {provider:'Claude Code',scope:'account',status:'unavailable',windows:[],usageCommand:'unrecognized'});
  for(const status of ['not-found','failed','timed-out','unrecognized']) {
    assert.deepEqual(await readClaudeLimits(runtime,{now,readUsage:async()=>({status,usage:null})}),
      {provider:'Claude Code',scope:'account',status:'unavailable',windows:[],usageCommand:status});
  }
});

test('a recording error reports failed without exposing the error or command details', async t => {
  const runtime=await folder(t);
  await setLimitsConsent({runtime,consent:true,now:new Date(now)});
  await mkdir(path.join(runtime,'claude-limits/limits.json'));
  assert.deepEqual(await readClaudeLimits(runtime,{now,readUsage:async()=>({status:'read',usage:input()})}),
    {provider:'Claude Code',scope:'account',status:'unavailable',windows:[],usageCommand:'failed'});
});

async function hardLink(t,file,second) {
  try {await fs.link(file,second);return true;}
  catch(error) {
    if(process.platform==='win32' && ['EPERM','ENOTSUP'].includes(error.code)) {t.skip(`Hard links unavailable: ${error.code}`);return false;}
    throw error;
  }
}

test('hard-linked stored limits are refused',async t=>{
  const runtime=await folder(t),directory=path.join(runtime,'claude-limits');
  await recordClaudeLimits(runtime,input(),now);
  await writeFile(path.join(directory,'consent.json'),consentText);
  const second=path.join(runtime,'second.json');
  if(!await hardLink(t,path.join(directory,'limits.json'),second))return;
  const options={now,readUsage:async()=>({status:'unrecognized',usage:null})};
  assert.deepEqual(await readClaudeLimits(runtime,options),
    {provider:'Claude Code',scope:'account',status:'unavailable',windows:[],usageCommand:'unrecognized'});
  await fs.unlink(second);
  assert.equal((await readClaudeLimits(runtime,options)).windows.length,2);
});

test('merged windows publish their own observation times', () => {
  const first = extractClaudeLimits(input(), now - 30 * 60000);
  const partial = input();
  delete partial.rate_limits.seven_day;
  const merged = mergeClaudeLimits(first, extractClaudeLimits(partial, now), now);
  const source = claudeLimitsSource(merged, { enabled: true, now });
  assert.equal(source.status, 'ok');
  assert.equal(source.checkedAt, new Date(now).toISOString());
  assert.deepEqual(source.windows.map(row => row.checkedAt),
    [new Date(now).toISOString(), new Date(now - 30 * 60000).toISOString()]);
});
