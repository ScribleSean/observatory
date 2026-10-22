import assert from 'node:assert/strict';
import test from 'node:test';
import {lstat,mkdtemp,readFile,readdir,rm,symlink,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {realpathSync} from 'node:fs';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {parseLimitsConsentMarker,claudeLimitsConsent,attachClaudeLimits,claudeLimitsSource,extractClaudeLimits,mergeClaudeLimits,readClaudeLimits,recordClaudeLimits} from './claude-limits.mjs';

import {setLimitsConsent,clearLimitsConsent,limitsConsentStatus} from './claude-limits-consent.mjs';

const run=promisify(execFile);
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

test('cost extraction validates bounds and rounds to cents without inventing missing values', () => {
  for(const usd of [0,1.236,10000]) {
    const sessionCost={usd:Math.round(usd*100)/100,observedAt:seconds};
    assert.deepEqual(extractClaudeLimits({cost:{total_cost_usd:usd}},now),{observedAt:seconds,windows:{},sessionCost});
    assert.deepEqual(extractClaudeLimits({...input(),cost:{total_cost_usd:usd}},now).sessionCost,sessionCost);
  }
  for(const cost of [undefined,null,{},'bad',{total_cost_usd:'1'},{total_cost_usd:NaN},
    {total_cost_usd:Infinity},{total_cost_usd:-1},{total_cost_usd:10000.01}]) {
    assert.equal(extractClaudeLimits({cost},now),null);
    assert.deepEqual(extractClaudeLimits({...input(),cost},now),extractClaudeLimits(input(),now));
  }
});

test('stored costs are sanitized independently of windows and determine the newest observation', () => {
  const record=extractClaudeLimits(input(),now);
  const cost={usd:1.236,observedAt:seconds+60,private:'synthetic'};
  assert.deepEqual(mergeClaudeLimits({...record,sessionCost:cost},null,now),
    {...record,observedAt:seconds+60,sessionCost:{usd:1.24,observedAt:seconds+60}});
  assert.deepEqual(mergeClaudeLimits({sessionCost:cost},null,now),
    {observedAt:seconds+60,windows:{},sessionCost:{usd:1.24,observedAt:seconds+60}});
  for(const sessionCost of [null,[],{usd:'1',observedAt:seconds},{usd:NaN,observedAt:seconds},
    {usd:-1,observedAt:seconds},{usd:10000.01,observedAt:seconds},
    ...[0,-1,seconds+61,seconds+0.5,Number.MAX_SAFE_INTEGER+1,'1'].map(observedAt=>({usd:1,observedAt}))]) {
    assert.deepEqual(mergeClaudeLimits({...record,sessionCost},null,now),record);
    assert.equal(mergeClaudeLimits({windows:{},sessionCost},null,now),null);
  }
});

test('cost freshness and consent do not change window status or checked time', () => {
  const record=extractClaudeLimits({...input(),cost:{total_cost_usd:2.34}},now);
  for(const age of [599,600,601]) {
    const source=claudeLimitsSource(record,{enabled:true,now:now+age*1000});
    const {sessionCost,...windowSource}=source;
    assert.deepEqual(windowSource,claudeLimitsSource(extractClaudeLimits(input(),now),{enabled:true,now:now+age*1000}));
    if(age===599)assert.deepEqual(sessionCost,{usd:2.34,observedAt:new Date(now).toISOString()});
    else assert.equal(Object.hasOwn(source,'sessionCost'),false);
  }
  assert.deepEqual(claudeLimitsSource(record,{enabled:false,now}),
    {provider:'Claude Code',scope:'account',status:'not-connected',windows:[]});
  const later=now+4*86400000;
  const cost={usd:0,observedAt:later/1000};
  assert.deepEqual(claudeLimitsSource({...record,sessionCost:cost},{enabled:true,now:later}),
    {provider:'Claude Code',scope:'account',status:'unavailable',windows:[],sessionCost:{usd:0,observedAt:new Date(later).toISOString()}});
  const source=claudeLimitsSource({...record,sessionCost:{usd:1,observedAt:seconds+600}},{enabled:true,now:now+600000});
  assert.equal(source.status,'stale');
  assert.equal(source.checkedAt,new Date(now).toISOString());
  assert.equal(source.sessionCost.usd,1);
});

test('cost merges use newest observation with next winning ties and absence preserving the cost', () => {
  const record=(usd,at)=>extractClaudeLimits({cost:{total_cost_usd:usd}},at);
  const first=record(3,now),later=record(1,now+1000);
  assert.deepEqual(mergeClaudeLimits(first,later,now+1000),later);
  assert.deepEqual(mergeClaudeLimits(later,first,now+1000),later);
  assert.deepEqual(mergeClaudeLimits(first,record(2,now),now),record(2,now));
  const windows=extractClaudeLimits(input(),now+1000);
  assert.deepEqual(mergeClaudeLimits(first,windows,now+1000),{...windows,sessionCost:first.sessionCost});
  assert.equal(Object.hasOwn(mergeClaudeLimits(windows,windows,now+1000),'sessionCost'),false);
});

test('usage readings after a stored cost preserve the cost and cannot inject a replacement', async t => {
  const {parseClaudeUsage}=await import('./claude-usage-command.mjs');
  const usage=parseClaudeUsage({is_error:false,num_turns:0,total_cost_usd:0,duration_api_ms:0,local_command:'usage',type:'result',
    result:'Current session: 30% used · resets Mar 10 at 5pm (UTC)'},now);
  assert.ok(usage);
  for(const extra of [{},{cost:{total_cost_usd:99}}]) {
    const runtime=await folder(t);
    const saved=await recordClaudeLimits(runtime,{...input(),cost:{total_cost_usd:1.23}},now);
    await writeFile(path.join(runtime,'claude-limits/consent.json'),consentText);
    const source=await readClaudeLimits(runtime,{now:now+1000,readUsage:async()=>({status:'read',usage:{...usage,...extra}})});
    const stored=JSON.parse(await readFile(path.join(runtime,'claude-limits/limits.json'),'utf8'));
    assert.deepEqual(stored.sessionCost,saved.sessionCost);
    assert.equal(stored.windows.five_hour.usedPercentage,30);
    assert.deepEqual(source.sessionCost,{usd:1.23,observedAt:new Date(now).toISOString()});
  }
});

test('explicit consent writes exactly its timestamp', async t => {
  const runtime=await folder(t),file=path.join(runtime,'claude-limits/consent.json');
  const none={given:false,consentMarker:false};
  assert.deepEqual(await clearLimitsConsent({runtime}),none);
  for(const consent of [undefined,false,1,'true'])await assert.rejects(setLimitsConsent({runtime,consent}),/consent/);
  assert.deepEqual(await readdir(runtime),[]);
  await assert.rejects(setLimitsConsent({runtime:'relative',consent:true}),/Absolute/);
  assert.deepEqual(await setLimitsConsent({runtime,consent:true,now:new Date(now)}),{given:true,consentMarker:true});
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{consent:true,givenAt:new Date(now).toISOString()});
  assert.deepEqual(await clearLimitsConsent({runtime}),{given:false,consentMarker:false});
});

test('invalid consent markers do not grant consent', async t => {
  const runtime=await folder(t),directory=path.join(runtime,'claude-limits');
  await mkdir(directory);
  const file=path.join(directory,'consent.json');
  for(const text of ['{"consent":false}','{bad','[]','null','{"consent":"true"}',
    '{"consent":true}',
    '{"consent":true,"givenAt":"2026-10-14T00:00:00.000Z","extra":1}',
    '{"consent":true,"consent":true,"givenAt":"2026-10-14T00:00:00.000Z"}',
    '{"givenAt":"2026-10-14T00:00:00.000Z","consent":false,"consent":true}',
    '{"consent":true,"conse\\u006et":true,"givenAt":"2026-10-14T00:00:00.000Z"}',
    '{"givenAt":{"x":":"},"consent":true,"givenAt":"2026-10-14T00:00:00.000Z"}',
    '{"consent":true,"givenAt":"a\\":\\"","givenAt":"2026-10-14T00:00:00.000Z"}',
    ...['2026-13-01T00:00:00.000Z','2026-02-30T00:00:00.000Z','2026-10-14',1,'a,b:c{}','a"b\\c',
      null,{},[]].map(givenAt=>JSON.stringify({consent:true,givenAt})),
    ...[false,1,'true'].map(consent=>JSON.stringify({consent,givenAt:'2026-10-14T00:00:00.000Z'})),
    '﻿'+consentText,consentText.padEnd(4097,' ')]) {
    await writeFile(file,text);
    assert.deepEqual(await claudeLimitsConsent(runtime),{given:false,consentMarker:false},text);
    let runs=0;
    assert.equal((await readClaudeLimits(runtime,{now,readUsage:async()=>{runs++;return {status:'failed',usage:null};}})).status,'not-connected');
    assert.equal(runs,0);
  }
  await writeFile(file,(' \t\r\n'+consentText+'\n').padEnd(4096,' '));
  assert.equal((await limitsConsentStatus({runtime})).given,true);
  assert.deepEqual(await claudeLimitsConsent(null),{given:false,consentMarker:false});
});

test('linked consent is ignored and cannot be cleared', {skip:process.platform==='win32' && 'Requires POSIX file link semantics'}, async t => {
  const runtime=await folder(t),target=path.join(await folder(t),'marker.json');
  await mkdir(path.join(runtime,'claude-limits'));
  await writeFile(target,consentText);
  const file=path.join(runtime,'claude-limits/consent.json');
  await symlink(target,file);
  assert.equal((await limitsConsentStatus({runtime})).given,false);
  await assert.rejects(clearLimitsConsent({runtime}),/plain file/);
  assert.equal((await lstat(file)).isSymbolicLink(),true);
  assert.equal(await readFile(target,'utf8'),consentText);
});

test('a directory consent marker is ignored and cannot be cleared', async t => {
  const runtime=await folder(t),file=path.join(runtime,'claude-limits/consent.json');
  await mkdir(file,{recursive:true});
  assert.equal((await limitsConsentStatus({runtime})).given,false);
  await assert.rejects(clearLimitsConsent({runtime}),/plain file/);
  assert.equal((await lstat(file)).isDirectory(),true);
});

test('consent CLI requires consent and supports set status and clear', async t => {
  const runtime=await folder(t),script=fileURLToPath(new URL('./claude-limits-consent.mjs',import.meta.url));
  const invoke=(...args)=>run(process.execPath,[script,...args],{env:{...process.env,OBSERVATORY_RUNTIME:runtime}});
  await assert.rejects(invoke('set','--runtime',runtime),error=>error.code===2 && error.stderr.trim().split('\n').length===1);
  assert.deepEqual(await readdir(runtime),[]);
  assert.equal(JSON.parse((await invoke('set','--runtime',runtime,'--consent')).stdout).given,true);
  assert.equal(JSON.parse((await invoke('status')).stdout).given,true);
  assert.equal(JSON.parse((await invoke('clear')).stdout).given,false);
  assert.equal(JSON.parse((await invoke('status')).stdout).given,false);
  await mkdir(path.join(runtime,'claude-limits/consent.json'));
  await assert.rejects(invoke('clear'),error=>error.code===1 && !error.stderr.includes(runtime));
  for(const args of [['unknown'],['set','--consent','--runtime','relative'],['status','--unknown'],['status','--runtime']])
    await assert.rejects(invoke(...args),error=>error.code===2);
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


test('a linked limits folder cannot grant consent or run usage', {skip:process.platform==='win32' && 'Requires POSIX file link semantics'}, async t => {
  const runtime=await folder(t),target=await folder(t);
  await writeFile(path.join(target,'consent.json'),JSON.stringify({consent:true,givenAt:new Date(now).toISOString()}));
  await symlink(target,path.join(runtime,'claude-limits'));
  assert.deepEqual(await claudeLimitsConsent(runtime),{given:false,consentMarker:false});
  let runs=0;
  const source=await readClaudeLimits(runtime,{now,readUsage:async()=>{runs++;return {status:'read',usage:input()};}});
  assert.deepEqual(source,{provider:'Claude Code',scope:'account',status:'not-connected',windows:[]});
  assert.equal(runs,0);
});

test('invalid runtimes and missing or plain file limits folders cannot grant consent', async t => {
  const missing=await folder(t),file=await folder(t);
  await writeFile(path.join(file,'claude-limits'),'{}');
  for(const runtime of [undefined,null,42,{},'',path.relative(process.cwd(),missing),missing,file]) {
    assert.deepEqual(await claudeLimitsConsent(runtime),{given:false,consentMarker:false});
    let runs=0;
    const source=await readClaudeLimits(runtime,{now,readUsage:async()=>{runs++;return {status:'read',usage:input()};}});
    assert.equal(source.status,'not-connected');
    assert.equal(runs,0);
  }
});

test('consent replaced by a link is no longer honoured',{skip:process.platform==='win32' && 'Requires POSIX file link semantics'},async t=>{
  const runtime=await folder(t),target=path.join(await folder(t),'consent.json');
  await setLimitsConsent({runtime,consent:true});
  assert.equal((await claudeLimitsConsent(runtime)).given,true);
  const file=path.join(runtime,'claude-limits/consent.json');
  await writeFile(target,consentText);
  await rm(file);
  await symlink(target,file);
  assert.equal((await claudeLimitsConsent(runtime)).given,false);
});

test('consent swapped for a link after lstat is refused',{skip:process.platform==='win32' && 'Requires POSIX file link semantics'},async t=>{
  const runtime=await folder(t),target=path.join(await folder(t),'consent.json');
  await setLimitsConsent({runtime,consent:true});
  await writeFile(target,consentText);
  const file=path.join(runtime,'claude-limits/consent.json'),original=fs.lstat;
  let swapped=false;
  const mocked=t.mock.method(fs,'lstat',async (...args)=>{
    const info=await original(...args);
    if(args[0]===file && !swapped) {
      swapped=true;
      await rm(file);
      await symlink(target,file);
    }
    return info;
  });
  syncBuiltinESMExports();
  try {
    assert.equal((await claudeLimitsConsent(runtime)).given,false);
    assert.equal(swapped,true);
  } finally {mocked.mock.restore();syncBuiltinESMExports();}
});

test('plain marker size bounds include the exact limit',async t=>{
  const runtime=await folder(t),directory=path.join(runtime,'claude-limits');
  await mkdir(directory);
  for(const [name,limit,content,read] of [
    ['consent.json',4096,consentText,async()=>(await claudeLimitsConsent(runtime)).given]]) {
    const file=path.join(directory,name);
    await writeFile(file,content.padEnd(limit,' '));
    assert.equal(await read(),true);
    await writeFile(file,content.padEnd(limit+1,' '));
    assert.equal(await read(),false);
  }
});

test('consent parser accepts canonical dates and escaped member names',()=>{
  for(const givenAt of ['0001-01-01T00:00:00.000Z','9999-12-31T23:59:59.999Z','2024-02-29T12:34:56.789Z'])
    assert.equal(parseLimitsConsentMarker(JSON.stringify({givenAt,consent:true})),true);
  assert.equal(parseLimitsConsentMarker(JSON.stringify({consent:true,givenAt:'0000-12-31T23:59:59.999Z'})),false);
  assert.equal(parseLimitsConsentMarker('{"consent":true,"givenAt":"2026-10-14T00:00:00.000\\u005a"}'),true);
  for(const givenAt of ['2026-10-14T24:00:00.000Z','2026-10-14T00:00:60.000Z'])
    assert.equal(parseLimitsConsentMarker(JSON.stringify({consent:true,givenAt})),false);
  assert.equal(parseLimitsConsentMarker('{"conse\\u006et":true,"givenAt":"2026-10-14T00:00:00.000Z"}'),true);
});

async function hardLink(t,file,second) {
  try {await fs.link(file,second);return true;}
  catch(error) {
    if(process.platform==='win32' && ['EPERM','ENOTSUP'].includes(error.code)) {t.skip(`Hard links unavailable: ${error.code}`);return false;}
    throw error;
  }
}

test('hard-linked consent is refused until its second name is removed',async t=>{
  const runtime=await folder(t),file=path.join(runtime,'claude-limits/consent.json'),second=path.join(runtime,'second.json');
  await setLimitsConsent({runtime,consent:true,now:new Date(now)});
  if(!await hardLink(t,file,second))return;
  assert.deepEqual(await claudeLimitsConsent(runtime),{given:false,consentMarker:false});
  await fs.unlink(second);
  assert.deepEqual(await claudeLimitsConsent(runtime),{given:true,consentMarker:true});
});

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

test('a hard link created after lstat is refused by the opened handle check',async t=>{
  const runtime=await folder(t),file=path.join(runtime,'claude-limits/consent.json'),second=path.join(runtime,'second.json');
  await setLimitsConsent({runtime,consent:true,now:new Date(now)});
  if(!await hardLink(t,file,second))return;
  await fs.unlink(second);
  const original=fs.lstat;
  let linked=false;
  const mocked=t.mock.method(fs,'lstat',async (...args)=>{
    const info=await original(...args);
    if(args[0]===file && !linked) {await fs.link(file,second);linked=true;}
    return info;
  });
  syncBuiltinESMExports();
  try {
    assert.deepEqual(await claudeLimitsConsent(runtime),{given:false,consentMarker:false});
    assert.equal(linked,true);
  } finally {mocked.mock.restore();syncBuiltinESMExports();}
});

for(const kind of ['unchanged','symbolic link','different folder'])
  test(`consent folder recheck with ${kind}`,{skip:(kind==='symbolic link' && process.platform==='win32') && 'Requires POSIX file link semantics'},async t=>{
    const runtime=await folder(t),directory=path.join(runtime,'claude-limits'),replacement=path.join(runtime,'replacement');
    await mkdir(directory);
    await writeFile(path.join(directory,'consent.json'),consentText);
    if(kind!=='unchanged')await fs.cp(directory,replacement,{recursive:true});
    let called=false;
    const afterRead=async()=>{
      called=true;
      if(kind==='unchanged')return;
      await fs.rename(directory,path.join(runtime,'original'));
      if(kind==='symbolic link')await symlink(replacement,directory);
      else await fs.rename(replacement,directory);
    };
    assert.deepEqual(await claudeLimitsConsent(runtime,{afterRead}),kind==='unchanged'?{given:true,consentMarker:true}:{given:false,consentMarker:false});
    assert.equal(called,true);
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
