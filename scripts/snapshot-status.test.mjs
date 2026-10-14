import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {sampleSnapshot} from '../lib/sample-snapshot.mjs';
import {snapshotStatus,readSnapshotStatus} from './snapshot-status.mjs';

const sample=()=>sampleSnapshot(Date.UTC(2026,9,14,12));
const script=fileURLToPath(new URL('./snapshot-status.mjs',import.meta.url));
const cli=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
async function temporary(t) {
  const folder=await mkdtemp(path.join(tmpdir(),'snapshot-status-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  return folder;
}

test('fictional sample exposes statuses and structural counts',()=>{
  const snapshot=sample(),result=snapshotStatus(snapshot);
  for(const name of ['activity','tokens','settings','dictation','providerTokenSources']) {
    assert.deepEqual(result.rows[name].map(row=>row.host),['Mac','Windows']);
    assert.deepEqual(result.rows[name].map(row=>row.status),snapshot[name].map(row=>row.status));
  }
  assert.equal(result.rows.dictation[1].refusal,'private-folder-refused');
  assert.equal(result.rows.dictation[1].days,null);
  assert.equal(result.rows.tokens[0].days,40);
  for(const name of ['quota','peerQuota','claudeLimits'])assert.deepEqual(result.limits[name].windows,snapshot[name].windows.map(row=>row.window));
  assert.equal(result.limits.claudeLimits.sessionCost,'present');
  assert.equal(result.limits.quota.sessionCost,'absent');
  assert.deepEqual(result.combinedTokens,{status:'ok',verification:'verified'});
  assert.equal(result.pricesCheckedOn,snapshot.prices?.checkedOn ?? null);
  assert.ok(result.keys.includes('tokens[].days[].hours'));
  assert.ok(result.keys.includes('claudeLimits.sessionCost.usd'));
  assert.deepEqual(result.keys,[...new Set(result.keys)].sort());
  assert.deepEqual(result.counts,{rows:10,keys:result.keys.length});
});

test('fictional values never escape into output',()=>{
  const snapshot=sample();
  snapshot.deviceNames={Mac:'Synthetic Desk'};
  snapshot.models={'synthetic-model-987':{tokens:987654321}};
  // Keep the structural key count distinct from the sample's usage numbers.
  snapshot.probeFixture={};
  const result=snapshotStatus(snapshot),serialized=JSON.stringify(result);
  const allowed=new Set(['Mac','Windows','Combined','Ubuntu','verified',snapshot.prices.checkedOn]);
  for(const rows of Object.values(result.rows))for(const row of rows)for(const key of ['status','refusal'])if(row[key])allowed.add(row[key]);
  for(const limit of Object.values(result.limits)) {
    allowed.add(limit.status);
    for(const window of limit.windows)allowed.add(window);
  }
  const numbers=new Set(),strings=new Set();
  function walk(value,onValue) {
    if(value && typeof value==='object')for(const entry of Object.values(value))walk(entry,onValue);
    else onValue(value);
  }
  walk(snapshot,value=>{
    if(typeof value==='string' && value.length>=4 && !allowed.has(value))strings.add(value);
    if(typeof value==='number' && !(Number.isInteger(value) && value<50))numbers.add(value);
  });
  for(const value of strings)assert.ok(!serialized.includes(JSON.stringify(value)),'Unexpected snapshot string');
  walk(result,value=>{if(typeof value==='number')assert.ok(!numbers.has(value),'Unexpected snapshot number');});
  assert.ok(!serialized.includes('Synthetic Desk'));
  assert.ok(!serialized.includes('synthetic-model-987'));
  assert.ok(result.keys.includes('models.<key>.tokens'));
  assert.ok(!result.keys.some(key=>/Safari|Browser|deviceNames\.Mac/.test(key)));
  assert.ok(result.keys.includes('deviceNames.<key>'));
});

test('unknown fields are sanitized and missing arrays are omitted',()=>{
  const result=snapshotStatus({tokens:[{host:'Synthetic Desk',status:'bad /path',refusal:123,days:0},null],
    quota:{status:99,usageCommand:'bad command',windows:[{window:'five_hour'},{window:'x2-y'},null,{window:'/secret'}]},
    combinedTokens:null,prices:{checkedOn:'2026-10-14T12:00:00Z'}});
  assert.deepEqual(result.rows,{tokens:[{host:'other',status:'other',refusal:'other',days:null},{host:'other',status:'other',days:null}]});
  assert.deepEqual(result.limits.quota,{status:'other',usageCommand:'other',windows:['five_hour','x2-y','other','other'],sessionCost:'absent'});
  assert.deepEqual(result.combinedTokens,{status:'other',verification:'other'});
  assert.equal(result.pricesCheckedOn,null);
  assert.deepEqual(snapshotStatus({}).counts,{rows:0,keys:0});
  for(const value of [null,[],1,'secret'])assert.throws(()=>snapshotStatus(value),/^Error: Snapshot unavailable$/);
});

test('key paths collapse arrays, sanitize keys and stop at twelve levels',()=>{
  const snapshot={items:[{valid:1,'2026-10-14':2},{valid:3,'model-name':4}],empty:[]};
  let cursor=snapshot;
  for(let index=0;index<20;index++)cursor=cursor.child={};
  const {keys}=snapshotStatus(snapshot);
  assert.ok(keys.includes('items[].valid'));
  assert.equal(keys.filter(key=>key==='items[].<key>').length,1);
  assert.ok(keys.includes('empty[]'));
  assert.ok(keys.includes(Array(12).fill('child').join('.')));
  assert.ok(!keys.includes(Array(13).fill('child').join('.')));
});

test('absolute file and runtime reads return the same safe JSON',async t=>{
  const runtime=await temporary(t),folder=path.join(runtime,'public','local'),file=path.join(folder,'usage.json');
  await mkdir(folder,{recursive:true});
  const snapshot=sample();
  await writeFile(file,JSON.stringify(snapshot));
  const expected=snapshotStatus(snapshot);
  assert.deepEqual(await readSnapshotStatus({runtime}),expected);
  assert.deepEqual(await readSnapshotStatus({file}),expected);
  for(const args of [['--file',file],['--runtime',runtime]]) {
    const result=cli(...args);
    assert.equal(result.status,0);
    assert.equal(result.stderr,'');
    assert.deepEqual(JSON.parse(result.stdout),expected);
  }
});

test('unsafe or invalid files fail without exposing paths or parser text',async t=>{
  const folder=await temporary(t),file=path.join(folder,'fixture.json'),link=path.join(folder,'link.json');
  await writeFile(file,'{}');
  await symlink(file,link);
  for(const target of [link,path.join(folder,'missing.json'),folder]) {
    await assert.rejects(readSnapshotStatus({file:target}),/^Error: Snapshot unavailable$/);
    const result=cli('--file',target);
    assert.equal(result.status,1);
    assert.equal(result.stdout,'');
    assert.equal(result.stderr,'Snapshot unavailable\n');
    assert.ok(!result.stderr.includes(folder));
  }
  for(const content of ['{"secret path":','[]','null','123','"secret"',' '.repeat(16000001)]) {
    await writeFile(file,content);
    await assert.rejects(readSnapshotStatus({file}),/^Error: Snapshot unavailable$/);
    const result=cli('--file',file);
    assert.equal(result.status,1);
    assert.equal(result.stderr,'Snapshot unavailable\n');
    assert.equal(result.stdout,'');
  }
  await writeFile(file,'{}'+' '.repeat(15999998));
  assert.deepEqual(await readSnapshotStatus({file}),snapshotStatus({}));
});

test('usage errors exit two and exported reader rejects relative paths',async()=>{
  for(const args of [[],['--file'],['--file','relative'],['--runtime','relative'],['--unknown','/tmp'],['--file','/tmp','--runtime','/tmp']]) {
    const result=cli(...args);
    assert.equal(result.status,2);
    assert.equal(result.stdout,'');
    assert.match(result.stderr,/^Usage: [^\n]+\n$/);
  }
  for(const options of [{},{file:'relative'},{runtime:'relative'},{file:'/tmp/file',runtime:'relative'}]) {
    await assert.rejects(readSnapshotStatus(options),/^Error: Snapshot unavailable$/);
  }
});
