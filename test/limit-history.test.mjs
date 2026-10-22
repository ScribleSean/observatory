import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {openHistory,readingsFrom,recordReadings,compactHistory,cleanHistoryPoints} from '../scripts/limit-history.mjs';
import {importHistory,snapshotReadings} from '../scripts/import-history.mjs';
import {withFolder,testConfig} from './helpers.mjs';

const now=Date.parse('2026-10-21T17:00:00Z');
const iso=offset=>new Date(now+offset).toISOString();
const claude=(checkedAt,remaining)=>({status:'ok',checkedAt,windows:[{bucket:'claude',window:'five_hour',durationMinutes:300,remainingPercent:remaining,resetsAt:iso(3600000)}]});

test('only real readings with a real time are kept',()=>{
  const rows=readingsFrom({status:'ok',checkedAt:iso(0),windows:[
    {window:'five_hour',remainingPercent:64,resetsAt:iso(1000),durationMinutes:300},
    {window:'seven_day',remainingPercent:null},
    {window:'bad window!',remainingPercent:50},
    {window:'x',remainingPercent:140},
  ]},{provider:'claude',observer:'Mac',source:'live'});
  assert.deepEqual(rows.map(row=>[row.window,row.remaining]),[['five_hour',64]]);
  assert.equal(rows[0].observedAt,now);
  assert.deepEqual(readingsFrom({status:'unavailable',windows:[{window:'a',remainingPercent:1}]},{provider:'claude',observer:'Mac',source:'live'}),[]);
  const own=readingsFrom({status:'ok',checkedAt:iso(0),windows:[{window:'a',remainingPercent:5,checkedAt:iso(-60000)}]},{provider:'codex',observer:'Mac',source:'live'});
  assert.equal(own[0].observedAt,now-60000);
});

test('recording is idempotent and keeps the first source of each reading',()=>withFolder(async folder=>{
  const db=await openHistory(folder);
  try {
    const rows=readingsFrom(claude(iso(0),64),{provider:'claude',observer:'Mac',source:'snapshot usage.json'});
    assert.equal(recordReadings(db,rows),1);
    assert.equal(recordReadings(db,rows),0);
    assert.equal(recordReadings(db,readingsFrom(claude(iso(0),64),{provider:'claude',observer:'Mac',source:'live'})),0);
    assert.equal(recordReadings(db,readingsFrom(claude(iso(0),64),{provider:'claude',observer:'Windows',source:'live'})),1);
    const [point]=compactHistory(db,{now,observer:'Mac'});
    assert.equal(point.s,'snapshot usage.json');
  } finally {db.close();}
}));

test('the compact history keeps real readings only and thins older ones',()=>withFolder(async folder=>{
  const db=await openHistory(folder);
  try {
    const rows=[];
    for(let t=now-40*86400000;t<=now;t+=300000)rows.push(...readingsFrom(claude(new Date(t).toISOString(),50),{provider:'claude',observer:'Mac',source:'live'}));
    recordReadings(db,rows);
    const points=compactHistory(db,{now,observer:'Mac'});
    const recent=points.filter(point=>now-Date.parse(point.t)<=2*86400000).length;
    const month=points.filter(point=>{const age=now-Date.parse(point.t);return age>2*86400000 && age<=30*86400000;}).length;
    assert.equal(recent,577);
    assert.ok(month>=27*24 && month<=29*24,String(month));
    assert.ok(points.length<rows.length/5);
    const stored=new Set(rows.map(row=>new Date(row.observedAt).toISOString()));
    assert.ok(points.every(point=>stored.has(point.t)),'every point is a stored reading');
  } finally {db.close();}
}));

test('history points from another computer are checked field by field',()=>{
  const clean=cleanHistoryPoints([
    {p:'claude',w:'five_hour',o:'Windows',t:iso(0),r:60,x:iso(1000),d:300,prompt:'PRIVATE'},
    {p:'claude',w:'five_hour',o:'Mac',t:iso(0),r:60},
    {p:'other',w:'x',o:'Windows',t:iso(0),r:1},
    null,
    {p:'codex',w:'primary',o:'Windows',t:'not a time',r:1},
  ],'Windows');
  assert.equal(clean.length,1);
  assert.ok(!JSON.stringify(clean).includes('PRIVATE'));
});

async function oldAppData(folder) {
  const quota=path.join(folder,'private-quota');
  await mkdir(quota,{recursive:true});
  const db=new DatabaseSync(path.join(quota,'state.sqlite'));
  db.exec("CREATE TABLE quota_archive (id INTEGER PRIMARY KEY, scope TEXT NOT NULL, kind TEXT NOT NULL, observed_at INTEGER NOT NULL, record TEXT NOT NULL)");
  const add=(t,r)=>db.prepare("INSERT INTO quota_archive(scope,kind,observed_at,record) VALUES ('s','observation',?,?)").run(t,JSON.stringify({checkedAt:new Date(t).toISOString(),
    windows:[{bucket:'codex',window:'primary',remainingPercent:r,durationMinutes:300,resetsAt:new Date(t+3600000).toISOString()}]}));
  add(now-86400000,90);add(now-3600000,40);
  db.prepare("INSERT INTO quota_archive(scope,kind,observed_at,record) VALUES ('s','poll',?,'{}')").run(now);
  db.close();
  const local=path.join(folder,'public','local');
  await mkdir(local,{recursive:true});
  await writeFile(path.join(local,'usage.before-hub.json'),JSON.stringify({claudeLimits:claude(iso(-7200000),70),
    quota:{status:'ok',checkedAt:iso(-1800000),windows:[{window:'primary',remainingPercent:35,durationMinutes:300}],history:[{checkedAt:iso(-3600000),windows:[{window:'primary',remainingPercent:40}]}]},
    peerQuota:{host:'Windows',quota:{status:'ok',checkedAt:iso(-600000),windows:[{window:'primary',remainingPercent:33}]}}}));
  const archive=path.join(folder,'MigrationArchives','snapshot-abc');
  await mkdir(archive,{recursive:true});
  await writeFile(path.join(archive,'snapshot.json'),JSON.stringify({claudeLimits:claude(iso(-5*86400000),88)}));
  await writeFile(path.join(archive,'receipt.json'),'{"not":"a snapshot"}');
}

test('importing old app history keeps times and sources, and running it again adds nothing',()=>withFolder(async folder=>{
  await oldAppData(folder);
  const config=testConfig(folder);
  const first=await importHistory(config);
  const total=first.reduce((sum,row)=>sum+row.added,0);
  assert.equal(total,6);
  const again=await importHistory(config);
  assert.equal(again.reduce((sum,row)=>sum+row.added,0),0);
  const db=await openHistory(folder);
  try {
    const points=compactHistory(db,{now});
    const pc=points.filter(point=>point.o==='Windows');
    assert.deepEqual(pc.map(point=>[point.p,point.r]),[['codex',33]]);
    assert.ok(pc[0].s.includes('shared from Windows'));
    const claudePoints=points.filter(point=>point.p==='claude').map(point=>[point.t,point.r,point.s]);
    assert.deepEqual(claudePoints,[[iso(-5*86400000),88,'snapshot MigrationArchives/snapshot-abc/snapshot.json'],[iso(-7200000),70,'snapshot public/local/usage.before-hub.json']]);
    assert.ok(points.filter(point=>point.p==='codex' && point.o==='Mac').every(point=>point.s==='codex archive' || point.s?.startsWith('snapshot')));
  } finally {db.close();}
}));

test('a snapshot without limits adds nothing',()=>{
  assert.deepEqual(snapshotReadings({activity:[]},{observer:'Mac',label:'x'}),[]);
  assert.deepEqual(snapshotReadings(null,{observer:'Mac',label:'x'}),[]);
});
