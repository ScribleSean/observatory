import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir,mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {combine} from '../lib/combine.mjs';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {ownSnapshot} from './helpers.mjs';
import {openTokenStore,keepTokenDays} from '../scripts/token-store.mjs';
import {openHistory,recordReadings} from '../scripts/limit-history.mjs';

const run=promisify(execFile);
// A port nothing listens on, so the dashboard check is skipped whatever else runs on this machine.
const closedPort=await new Promise((resolve,reject)=>{
  const server=createServer().once('error',reject).listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(()=>resolve(port));});
});
const script=path.resolve('scripts/harness/parity-check.mjs');
const now=Date.now();

async function check(folder,mutate=()=>{},{prepare=async()=>{},args=[]}={}) {
  const data=path.join(folder,'data'),local=path.join(data,'public','local');
  await mkdir(local,{recursive:true});
  const mac=ownSnapshot('Mac',now),pc=ownSnapshot('Windows',now);
  await writeFile(path.join(local,'usage.json'),JSON.stringify(mac));
  const combined=combine([{host:'Mac',snapshot:mac},{host:'Windows',snapshot:pc}],{now,generatedBy:'Mac'});
  mutate(combined);
  await writeFile(path.join(local,'combined.json'),JSON.stringify(combined));
  const file=path.join(folder,'observatory.config.json');
  await writeFile(file,JSON.stringify({dataFolder:data,sources:{screenTime:true,codex:true,codexLimits:true,claudeCode:true,claudeLimits:true},dashboard:{port:closedPort}}));
  await prepare(data);
  const snapshotOf=async()=>JSON.stringify([(await readdir(data,{recursive:true})).sort(),await Promise.all(['private-history/tokens.sqlite','private-limits/history.sqlite'].map(file=>readFile(path.join(data,file),'base64').catch(()=>null))),await readFile(path.join(local,'combined.json'),'utf8'),await readFile(path.join(local,'usage.json'),'utf8')]);
  const before=await snapshotOf();
  let out,code=0;
  try {out=(await run(process.execPath,['--no-warnings',script,'--json',...args],{env:{...process.env,OBSERVATORY_CONFIG:file,PARITY_CHECK_AS_MAC:'1'}})).stdout;}
  catch(error) {out=error.stdout;code=error.code;}
  assert.equal(await snapshotOf(),before,'the check added, removed or changed a file');
  return {code,results:Object.fromEntries(JSON.parse(out).results.map(row=>[row.id,row]))};
}
const withTemp=async action=>{const folder=await mkdtemp(path.join(tmpdir(),'observatory-parity-'));try {return await action(folder);}finally {await rm(folder,{recursive:true,force:true});}};

test('the parity check passes on synthetic two-computer data and changes nothing',()=>withTemp(async folder=>{
  const {code,results}=await check(folder);
  for(const id of ['own snapshot usage.json','combined view lists both computers','both computers fresh','Both sum labeled and equal to its parts','sources on as on the Mac'])
    assert.equal(results[id]?.status,'PASS',`${id}: ${results[id]?.detail}`);
  assert.equal(results['tray app, Start menu entry, login entry'].status,'SKIP');
  assert.equal(code,0);
}));

test('the parity check fails when the Both sum loses its label',()=>withTemp(async folder=>{
  const {code,results}=await check(folder,combined=>{combined.glance.both.label='total';});
  assert.match(results['Both sum labeled and equal to its parts'].detail,/label is "total"/);
  assert.equal(code,1);
}));

test('the parity check fails when the Both sum stops matching its parts',()=>withTemp(async folder=>{
  const {code,results}=await check(folder,combined=>{combined.glance.both.tokens+=1;});
  assert.match(results['Both sum labeled and equal to its parts'].detail,/is not the sum/);
  assert.equal(code,1);
}));

test('the parity check fails when combined.json is old',()=>withTemp(async folder=>{
  const old=new Date(now-3*86400000).toISOString();
  const {code,results}=await check(folder,combined=>{combined.generatedAt=old;});
  assert.equal(results['both computers fresh'].status,'FAIL');
  assert.equal(code,1);
}));

const dayAgo=days=>new Date(now-days*86400000).toISOString().slice(0,10);
const saveDays=dates=>async data=>{
  const db=await openTokenStore(data);
  try {keepTokenDays(db,'claude',dates.map(date=>({date,totalTokens:1200})));}
  finally {db.close();}
};

test('saved daily totals that reach past 30 days pass, and the store is left as it was',()=>withTemp(async folder=>{
  const {results}=await check(folder,undefined,{prepare:saveDays([dayAgo(40),dayAgo(1)])});
  assert.equal(results['daily token history kept'].status,'PASS',results['daily token history kept'].detail);
  assert.match(results['daily token history kept'].detail,/claude 2 days/);
}));

test('saved daily totals younger than 30 days cannot prove anything yet, so they are skipped',()=>withTemp(async folder=>{
  const {code,results}=await check(folder,undefined,{prepare:saveDays([dayAgo(3),dayAgo(1)])});
  assert.equal(results['daily token history kept'].status,'SKIP');
  assert.equal(code,0);
}));

test('no saved totals yet is a skip, and a store that cannot be read is a failure',()=>withTemp(async folder=>{
  assert.equal((await check(path.join(folder,'none'))).results['daily token history kept'].status,'SKIP');
  const broken=async data=>{
    await mkdir(path.join(data,'private-history'),{recursive:true});
    await writeFile(path.join(data,'private-history','tokens.sqlite'),'not a database');
  };
  const {code,results}=await check(path.join(folder,'broken'),undefined,{prepare:broken});
  assert.equal(results['daily token history kept'].status,'FAIL');
  assert.equal(code,1);
}));

test('limit history counts its readings and tells imported older history apart',()=>withTemp(async folder=>{
  const reading=(observedAt,source)=>({provider:'claude',window:'weekly',observedAt,observer:'Mac',remaining:60,resetsAt:null,durationMinutes:null,source});
  const save=readings=>async data=>{
    const db=await openHistory(data);
    try {recordReadings(db,readings);}
    finally {db.close();}
  };
  const live=await check(path.join(folder,'live'),undefined,{prepare:save([reading(now-3600000,'collector')])});
  assert.equal(live.results['limit history kept'].status,'PASS');
  assert.match(live.results['limit history kept'].detail,/1 readings .* 0 from older history/);
  assert.equal(live.results['older history imported'].status,'SKIP');
  const imported=await check(path.join(folder,'imported'),undefined,{prepare:save([reading(now-3600000,'collector'),reading(now-90*86400000,'snapshot 2026-08-01'),reading(now-80*86400000,'codex archive')])});
  assert.match(imported.results['limit history kept'].detail,/3 readings .* 2 from older history/);
  assert.equal(imported.results['older history imported'].status,'PASS');
  const empty=await check(path.join(folder,'empty'),undefined,{prepare:save([])});
  assert.equal(empty.results['limit history kept'].status,'FAIL');
}));

test('--expect compares the checkout with the commit it is given',()=>withTemp(async folder=>{
  const head=(await run('git',['rev-parse','HEAD'])).stdout.trim();
  assert.equal((await check(path.join(folder,'same'),undefined,{args:['--expect',head.slice(0,7)]})).results.revision.status,'PASS');
  const other=await check(path.join(folder,'other'),undefined,{args:['--expect','0000000']});
  assert.equal(other.results.revision.status,'FAIL');
  assert.equal(other.code,1);
}));

test('a computer whose tokens are unknown makes Both unknown, and a number there fails',()=>withTemp(async folder=>{
  const unknown=combined=>{combined.glance.today[1].tokens=null;combined.glance.both.tokens=null;};
  assert.equal((await check(path.join(folder,'unknown'),unknown)).results['Both sum labeled and equal to its parts'].status,'PASS');
  const wrong=await check(path.join(folder,'wrong'),combined=>{combined.glance.today[1].tokens=null;});
  assert.match(wrong.results['Both sum labeled and equal to its parts'].detail,/is not the sum/);
  const one=await check(path.join(folder,'one'),combined=>{combined.glance.today.pop();});
  assert.match(one.results['Both sum labeled and equal to its parts'].detail,/1 per-computer rows/);
}));

test('one computer in the combined file, or an old own snapshot, fails',()=>withTemp(async folder=>{
  const alone=await check(path.join(folder,'alone'),combined=>{combined.devices.pop();});
  assert.equal(alone.results['combined view lists both computers'].status,'FAIL');
  const stale=await check(path.join(folder,'stale'),combined=>{combined.devices[1].collectedAt=new Date(now-3*3600000).toISOString();});
  assert.match(stale.results['both computers fresh'].detail,/Windows/);
}));
