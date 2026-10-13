import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile,writeFile,mkdir,readdir,symlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPeerPayload} from './peer-payload.mjs';
import {createPeerRecord,acceptPeerState,readPeerState,publishLocalPayload} from './peer-store.mjs';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const now=Date.parse('2026-09-09T13:00:00.000Z');
const config={host:'Windows',codexHosts:['Windows'],pairId:'a'.repeat(64),deviceId:'b'.repeat(64),comparisonId:'c'.repeat(64)};
const payload=()=>createPeerPayload({collectedAt:'2026-09-09T12:59:00.000Z',activity:{status:'not-connected'},
  codex:[{host:'Windows',status:'not-connected'}],dictation:[{source:'Wispr Flow',status:'not-connected'}]},config);
const record=sequence=>createPeerRecord(payload(),config,sequence,now);
async function fixture(t) {
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-peer-store-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));return runtime;
}

test('private state commits payload and watermark together outside dashboard files',async t=>{
  const runtime=await fixture(t);
  assert.equal(await readPeerState(runtime,config,now),null);
  assert.equal((await acceptPeerState(runtime,record(1),config,now)).action,'replace');
  const stored=await readPeerState(runtime,config,now);
  assert.deepEqual(stored,record(1));
  assert.deepEqual(await readdir(runtime),['private-repair','private-sync']);
  assert.deepEqual(await readdir(path.join(runtime,'private-sync')),['state.sqlite']);
  if(process.platform!=='win32') {
    assert.equal((await stat(path.join(runtime,'private-sync'))).mode&0o077,0);
    assert.equal((await stat(path.join(runtime,'private-sync/state.sqlite'))).mode&0o077,0);
  }
});
test('duplicate and reordered transfers preserve the newer bytes',async t=>{
  const runtime=await fixture(t),file=path.join(runtime,'private-sync/state.sqlite');
  await acceptPeerState(runtime,record(2),config,now);const before=await readFile(file);
  assert.equal((await acceptPeerState(runtime,record(2),config,now)).reason,'duplicate');
  assert.equal((await acceptPeerState(runtime,record(1),config,now)).reason,'older');
  assert.deepEqual(await readFile(file),before);
  await acceptPeerState(runtime,record(3),config,now);
  assert.equal((await readPeerState(runtime,config,now)).revision.sequence,3);
});
test('tampered content and wrong pairing cannot replace a valid state',async t=>{
  const runtime=await fixture(t);await acceptPeerState(runtime,record(1),config,now);
  const bad=record(2);bad.payload.dictation[0].status='unavailable';
  await assert.rejects(acceptPeerState(runtime,bad,config,now));
  await assert.rejects(acceptPeerState(runtime,record(2),{...config,pairId:'d'.repeat(64)},now));
  assert.equal((await readPeerState(runtime,config,now)).revision.sequence,1);
});
test('busy transaction times out without touching prior data',async t=>{
  const runtime=await fixture(t);await acceptPeerState(runtime,record(1),config,now);
  const blocker=new DatabaseSync(path.join(runtime,'private-sync/state.sqlite'));
  blocker.exec('BEGIN IMMEDIATE');
  try{await assert.rejects(acceptPeerState(runtime,record(2),config,now),/locked/);}
  finally{blocker.exec('ROLLBACK');blocker.close();}
  assert.equal((await readPeerState(runtime,config,now)).revision.sequence,1);
});
test('corrupt saved state is not treated as a first pairing',async t=>{
  const runtime=await fixture(t);await acceptPeerState(runtime,record(1),config,now);
  const file=path.join(runtime,'private-sync/state.sqlite');await writeFile(file,'{"corrupt":true}');
  await assert.rejects(readPeerState(runtime,config,now));
  await assert.rejects(acceptPeerState(runtime,record(2),config,now));
  assert.equal(await readFile(file,'utf8'),'{"corrupt":true}');
  assert.deepEqual(await readdir(path.join(runtime,'private-sync')),['state.sqlite']);
});

test('killed writer releases its lock and rolls back an unfinished update',async t=>{
  const runtime=await fixture(t);await acceptPeerState(runtime,record(1),config,now);
  const code="import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]); db.exec('PRAGMA cache_size=1; BEGIN IMMEDIATE'); db.prepare('UPDATE peer_state SET record=?').run('x'.repeat(500000)); process.stdout.write('ready'); setInterval(()=>{},1000);";
  const child=spawn(process.execPath,['--input-type=module','-e',code,path.join(runtime,'private-sync/state.sqlite')],{stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');});
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Writer exited before readiness');})]);
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  assert.equal((await readPeerState(runtime,config,now)).revision.sequence,1);
  await acceptPeerState(runtime,record(2),config,now);
  assert.equal((await readPeerState(runtime,config,now)).revision.sequence,2);
});

test('local and peer slots do not overwrite each other',async t=>{
  const runtime=await fixture(t);
  await acceptPeerState(runtime,record(1),config,now,'local');
  await acceptPeerState(runtime,record(2),config,now,'peer');
  assert.equal((await readPeerState(runtime,config,now,'local')).revision.sequence,1);
  assert.equal((await readPeerState(runtime,config,now,'peer')).revision.sequence,2);
  await assert.rejects(readPeerState(runtime,config,now,'../../other'));
});
test('linked private directory is refused without modifying its target',async t=>{
  const runtime=await fixture(t),other=await fixture(t);
  await symlink(other,path.join(runtime,'private-sync'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(acceptPeerState(runtime,record(1),config,now));
  assert.deepEqual(await readdir(other),[]);
});

test('local publication allocates durable sequences without altering the peer slot',async t=>{
  const runtime=await fixture(t);
  await acceptPeerState(runtime,record(7),config,now);
  assert.equal((await publishLocalPayload(runtime,payload(),config,now)).revision.sequence,1);
  assert.equal((await publishLocalPayload(runtime,payload(),config,now)).revision.sequence,2);
  assert.equal((await readPeerState(runtime,config,now,'local')).revision.sequence,2);
  assert.equal((await readPeerState(runtime,config,now)).revision.sequence,7);
});

test('regressing local snapshots leave the committed sequence intact',async t=>{
  const runtime=await fixture(t);
  await publishLocalPayload(runtime,payload(),config,now);
  const old=payload();old.collectedAt='2026-09-09T12:58:00.000Z';
  await assert.rejects(publishLocalPayload(runtime,old,config,now));
  assert.equal((await readPeerState(runtime,config,now,'local')).revision.sequence,1);
  assert.equal((await publishLocalPayload(runtime,payload(),config,now)).revision.sequence,2);
});

test('local sequence overflow fails closed without resetting the generation',async t=>{
  const runtime=await fixture(t);
  await acceptPeerState(runtime,record(Number.MAX_SAFE_INTEGER),config,now,'local');
  await assert.rejects(publishLocalPayload(runtime,payload(),config,now),/sequence exhausted/);
  assert.equal((await readPeerState(runtime,config,now,'local')).revision.sequence,Number.MAX_SAFE_INTEGER);
});

test('independent publishers allocate distinct sequences', {timeout:45000},async t=>{
  const runtime=await fixture(t);
  await publishLocalPayload(runtime,payload(),config,now);
  const moduleUrl=new URL('./peer-store.mjs',import.meta.url).href;
  const code=`import {publishLocalPayload} from ${JSON.stringify(moduleUrl)};
    const record=await publishLocalPayload(process.argv[1],${JSON.stringify(payload())},${JSON.stringify(config)},${now});
    process.stdout.write(String(record.revision.sequence));`;
  const sequences=await Promise.all(Array.from({length:4},async()=>{
    const child=spawn(process.execPath,['--input-type=module','-e',code,runtime],{stdio:['ignore','pipe','pipe']});
    let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);
    t.after(()=>{if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');});
    const [exitCode]=await once(child,'close');assert.equal(exitCode,0,errors);return Number(output);
  }));
  assert.deepEqual(sequences.sort((a,b)=>a-b),[2,3,4,5]);
  assert.equal((await readPeerState(runtime,config,now,'local')).revision.sequence,5);
});
