import assert from 'node:assert/strict';
import test from 'node:test';
import {gzipSync} from 'node:zlib';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildExport,decodeExport,describeExport,encodeExport,exportToFile,inspectFile,validateExport} from './observatory-file.mjs';

const now=new Date('2026-03-10T15:00:00Z');
const snapshot=()=>({
  schema:2,timezone:'UTC',collectedAt:'2026-03-10T14:58:00.000Z',deviceNames:{Mac:'Studio'},
  activity:[{host:'Mac',status:'ok',days:[{date:'2026-03-10',seconds:60}]}],
  activityHistory:[
    {host:'Mac',status:'ok',days:[{date:'2026-03-10',seconds:3600,categories:{Editor:1800,Browser:1800},hours:[0,60]},{date:'2026-03-09',seconds:1200}]},
    {host:'Windows',status:'ok',days:[{date:'2026-03-10',seconds:900}]},
    {host:'Combined',status:'ok',days:[{date:'2026-03-10',seconds:4000}]},
    {host:'Ubuntu',status:'ok',days:[{date:'2026-03-10',seconds:5}]}],
  tokens:[{host:'Mac',status:'ok',days:[{date:'2026-03-10',totalTokens:100,models:[{model:'synthetic-model',totalTokens:100,inferred:false}],apiEstimate:{usd:0.5,checked:'2026-01-01'}}]},
    {host:'Windows',status:'unavailable',days:[{date:'2026-03-10',totalTokens:7}]}],
  combinedTokens:{host:'All',status:'ok',verification:{status:'verified'},days:[{date:'2026-03-10',totalTokens:140}]},
  providerTokenSources:[{provider:'claude-code',host:'Mac',status:'ok',days:[{date:'2026-03-10',totalTokens:70,requestCount:3}]}],
  dictation:[{host:'Mac',source:'Wispr Flow',status:'ok',days:[{date:'2026-03-10',words:12,audioSeconds:4}]}],
  quota:{status:'ok',checkedAt:'2026-03-10T14:57:00.000Z',windows:[{bucket:'codex',window:'primary',durationMinutes:300,remainingPercent:81,resetsAt:'2026-03-10T18:00:00.000Z',accountId:'must-not-export'}],
    history:[{checkedAt:'2026-03-10T14:00:00.000Z',windows:[{bucket:'codex',window:'primary',remainingPercent:90,resetsAt:'2026-03-10T18:00:00.000Z'}]}],
    dailyUsageBuckets:[{startDate:'2026-03-09',tokens:55}]},
  claudeLimits:{status:'stale',checkedAt:'2026-03-10T13:00:00.000Z',windows:[{bucket:'claude',window:'five_hour',durationMinutes:300,remainingPercent:64,resetsAt:'2026-03-10T17:00:00.000Z'}]},
  // Fields that must never reach an export.
  pairing:{secret:'synthetic-secret'},comparisonSalt:'synthetic-salt',peer:{payload:{key:'synthetic-key'}},agents:[{title:'synthetic title'}],
});
async function folder(t) {
  const root=realpathSync(await mkdtemp(path.join(tmpdir(),'observatory-file-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  return root;
}

test('an export keeps every record with the device it came from', () => {
  const document=buildExport(snapshot(),{device:'Mac',appVersion:'0.0.0-test',now});
  assert.deepEqual(document.devices,[{id:'Mac',platform:'macOS',name:'Studio'},{id:'Windows',platform:'Windows',name:null}]);
  assert.deepEqual(document.records.map(item=>[item.kind,item.provider,item.device,item.days.length]),[
    ['activity','activitywatch','Mac',2],['tokens','codex','Mac',1],['tokens','claude-code','Mac',1],['dictation','Wispr Flow','Mac',1],
    ['activity','activitywatch','Windows',1]]);
  assert.deepEqual(document.records[0].days.map(day=>day.date),['2026-03-09','2026-03-10']);
  assert.equal(document.records[0].days[1].categories.Editor,1800);
});

test('combined rows stay separate, need verification and a source that was not read is left out', () => {
  const document=buildExport(snapshot(),{device:'Mac',now});
  assert.deepEqual(document.combined.map(item=>[item.kind,item.days[0].date]),[['activity','2026-03-10'],['tokens','2026-03-10']]);
  assert.equal(document.records.some(item=>item.device==='Windows' && item.kind==='tokens'),false);
  assert.equal(JSON.stringify(document).includes('Ubuntu'),false);
  const unverified=snapshot();unverified.combinedTokens.verification.status='unverified';
  assert.deepEqual(buildExport(unverified,{device:'Mac',now}).combined.map(item=>item.kind),['activity']);
});

test('limits are account readings and carry only the listed fields', () => {
  const document=buildExport(snapshot(),{device:'Mac',now});
  assert.deepEqual(document.limits.map(item=>[item.provider,item.windows.length,item.history.length,item.dailyTokens.length]),[['codex',1,1,1],['claude-code',1,0,0]]);
  assert.deepEqual(Object.keys(document.limits[0].windows[0]),['bucket','window','durationMinutes','remainingPercent','resetsAt']);
});

test('private fields, long text and control characters never reach an export', () => {
  const text=JSON.stringify(buildExport(snapshot(),{device:'Mac',now}));
  for(const word of ['synthetic-secret','synthetic-salt','synthetic-key','synthetic title','must-not-export','pairing','comparisonSalt'])assert.equal(text.includes(word),false,word);
  const long=snapshot();long.tokens[0].days[0].note='x'.repeat(81);
  assert.throws(()=>buildExport(long,{device:'Mac',now}),/Invalid text/);
  const control=snapshot();control.tokens[0].days[0].note='a\u0000b';
  assert.throws(()=>buildExport(control,{device:'Mac',now}),/Invalid text/);
  assert.throws(()=>buildExport(snapshot(),{device:'Ubuntu',now}),/Mac or Windows/);
});

test('a file round-trips, is compressed and describes itself without values', () => {
  const document=buildExport(snapshot(),{device:'Mac',appVersion:'0.0.0-test',now});
  const bytes=encodeExport(document);
  assert.equal(bytes[0],0x1f);assert.equal(bytes[1],0x8b);
  assert.deepEqual(decodeExport(bytes),validateExport(document));
  const summary=describeExport(document);
  assert.deepEqual(summary.devices,['Studio (macOS)','Windows']);
  assert.deepEqual(summary.records[0],{kind:'activity',provider:'activitywatch',device:'Mac',from:'2026-03-09',to:'2026-03-10',days:2});
  assert.doesNotMatch(JSON.stringify(summary),/3600|1800|"totalTokens"|"seconds"/);
});

test('damaged, foreign, future-version and malformed files are refused', () => {
  const good=buildExport(snapshot(),{device:'Mac',now});
  const pack=value=>gzipSync(Buffer.from(JSON.stringify(value)));
  assert.throws(()=>decodeExport(Buffer.from('this is not gzip data at all, sorry')),/Not an Observatory file/);
  assert.throws(()=>decodeExport(gzipSync(Buffer.from('{not json'))),/damaged/);
  assert.throws(()=>decodeExport(pack({format:'something-else',version:1})),/Not an Observatory file/);
  assert.throws(()=>decodeExport(pack({...good,version:2})),/version 2/);
  assert.throws(()=>decodeExport(pack({...good,devices:[{id:'Linux',platform:'Linux',name:null}]})),/Invalid device/);
  assert.throws(()=>decodeExport(pack({...good,devices:[...good.devices,good.devices[0]]})),/listed twice/);
  assert.throws(()=>decodeExport(pack({...good,records:[{...good.records[0],device:'Linux'}]})),/Invalid record/);
  assert.throws(()=>decodeExport(pack({...good,records:[good.records[0],good.records[0]]})),/listed twice/);
  assert.throws(()=>decodeExport(pack({...good,records:[{...good.records[0],days:[{date:'2026-13-45'}]}]})),/Invalid day/);
  assert.throws(()=>decodeExport(pack({...good,records:[{...good.records[0],days:[{date:'2026-03-10',note:'y'.repeat(200)}]}]})),/Invalid text/);
  assert.deepEqual(Object.keys(decodeExport(pack({...good,extra:{secret:'x'}}))).includes('extra'),false);
});

test('export writes one file, refuses to overwrite and inspect reads it back', async t => {
  const runtime=await folder(t),target=await folder(t);
  await mkdir(path.join(runtime,'public/local'),{recursive:true});
  await writeFile(path.join(runtime,'public/local/usage.json'),JSON.stringify(snapshot()));
  const out=path.join(target,'history.observatory');
  const result=await exportToFile({runtime,out,device:'Mac',appVersion:'0.0.0-test',now});
  assert.equal(result.devices.length,2);
  assert.deepEqual((await inspectFile(out)).records.length,5);
  const before=await readFile(out);
  await assert.rejects(exportToFile({runtime,out,device:'Mac',now}),/already exists/);
  assert.deepEqual(await readFile(out),before);
  await assert.rejects(exportToFile({runtime,out:path.join(target,'history.json'),device:'Mac',now}),/\.observatory/);
  await assert.rejects(exportToFile({runtime:'relative',out,device:'Mac',now}),/Absolute/);
});
