import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile,writeFile,readdir,lstat,symlink,link,mkdir,open,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readPairingStatus,writePairingStatus,readPairingStatusFile} from './peer-pairing-status.mjs';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';
import {initializeDeviceIdentity} from './peer-device-identity.mjs';
import {privateSyncDirectory} from './peer-directory.mjs';
import {revokePairing} from './peer-revocation.mjs';
import {preparePairingRepair} from './peer-repair.mjs';
import {createPeerPayload} from './peer-payload.mjs';
import {publishLocalPayload,acceptPeerState} from './peer-store.mjs';
import {createTrustedSyncService} from './peer-tls-service.mjs';

const status=state=>({version:1,state});
async function fixture(t) {
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-pairing-status-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));return runtime;
}
async function paired(t) {
  const runtime=await fixture(t),remote=await fixture(t),pairs=createPairingConfigurations();
  await initializePairing(runtime,pairs.Mac);await initializePairing(remote,pairs.Windows);
  return {runtime,remote,pairs};
}
test('missing and empty pairing folders are unpaired, leftover state needs repair',async t=>{
  const runtime=await fixture(t);
  assert.deepEqual(await readPairingStatus(runtime),status('unpaired'));
  await privateSyncDirectory(runtime,true);
  assert.deepEqual(await readPairingStatus(runtime),status('unpaired'));
  await writeFile(path.join(runtime,'private-sync/leftover'),'synthetic',{mode:0o600});
  assert.deepEqual(await readPairingStatus(runtime),status('unavailable'));
});
test('pairing without a verified record is establishing trust even with a listener',async t=>{
  const {runtime,pairs}=await paired(t);
  assert.deepEqual(await readPairingStatus(runtime),status('establishing-trust'));
  let written;const complete=new Promise(resolve=>written=resolve);
  const service=createTrustedSyncService(runtime,{writeStatus:async location=>{try {await writePairingStatus(location);}finally{written();}},read:async()=>({pairing:{...pairs.Mac,
    localEndpoint:{kind:'tls',address:'10.0.0.2',port:43128}},trust:{version:1}}),
    start:async()=>({isListening:()=>true,close:async()=>{}}),schedule:()=>1,unschedule:()=>{}});
  try {
    assert.deepEqual(await service.run({action:'status'}),{status:'sync-listening'});
    await complete;
    assert.deepEqual(await readPairingStatusFile(runtime),status('establishing-trust'));
  } finally {await service.cancel();}
});
test('TLS pairing with no trust file is establishing trust',async t=>{
  const runtime=await fixture(t),key=path.join(runtime,'synthetic.key'),cert=path.join(runtime,'synthetic.pem');
  const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'/usr/bin/openssl';
  execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-keyout',key,
    '-out',cert,'-days','1','-subj','/CN=Synthetic status test'],{stdio:'ignore',timeout:15000});
  await initializeDeviceIdentity(runtime,{version:1,key:await readFile(key,'utf8'),cert:await readFile(cert,'utf8')});
  const pair=createPairingConfigurations()[process.platform==='win32'?'Windows':'Mac'];
  await initializePairing(runtime,{...pair,transport:{kind:'tls',address:'10.0.0.2',port:43128}});
  assert.deepEqual(await readPairingStatus(runtime),status('establishing-trust'));
});
for(const [offset,expected] of [[0,'active-sync'],[-600000,'active-sync'],[-660000,'sync-stale'],[60000,'active-sync'],[61000,'sync-stale']]) {
  test(`verified observation offset ${offset} is ${expected}`,async t=>{
    const {runtime,remote,pairs}=await paired(t),now=Date.now(),collected=now+offset;
    const payload=createPeerPayload({collectedAt:new Date(collected).toISOString(),activity:{status:'not-connected'},
      codex:[{host:'Windows',status:'not-connected'}],dictation:[{source:'Wispr Flow',status:'not-connected'}]},pairs.Windows.local);
    const record=await publishLocalPayload(remote,payload,pairs.Windows.local,collected);
    await acceptPeerState(runtime,record,pairs.Mac.peer,collected);
    assert.deepEqual(await readPairingStatus(runtime,now),status(expected));
  });
}
test('revocation, repair and corrupt configuration remain distinct',async t=>{
  const {runtime}=await paired(t);
  await revokePairing(runtime);
  assert.deepEqual(await readPairingStatus(runtime),status('revoked'));
  await preparePairingRepair(runtime);
  assert.deepEqual(await readPairingStatus(runtime),status('unpaired'));
  const other=await paired(t);
  await writeFile(path.join(other.runtime,'private-sync/pairing.json'),'{');
  assert.deepEqual(await readPairingStatus(other.runtime),status('unavailable'));
});
test('status writes exact bounded fields with private permissions',async t=>{
  const runtime=await fixture(t),now=Date.now(),name=path.join(runtime,'pairing-status.json');
  assert.deepEqual(await writePairingStatus(runtime,now),status('unpaired'));
  assert.deepEqual(JSON.parse(await readFile(name,'utf8')),{version:1,state:'unpaired',checkedAt:new Date(now).toISOString()});
  if(process.platform!=='win32')assert.equal((await lstat(name)).mode&0o777,0o600);
  assert.deepEqual(await readPairingStatusFile(runtime,now),status('unpaired'));
  await writePairingStatus(runtime,now+1000);
  assert.equal(JSON.parse(await readFile(name,'utf8')).checkedAt,new Date(now+1000).toISOString());
});
for(const kind of ['link','hardlink','oversized','directory'])test(`writer refuses ${kind} and leaves no temporary file`,async t=>{
  const runtime=await fixture(t),name=path.join(runtime,'pairing-status.json'),target=path.join(runtime,'sentinel');
  await writeFile(target,'unchanged');
  if(kind==='link')await symlink(target,name);
  if(kind==='hardlink')await link(target,name);
  if(kind==='oversized')await writeFile(name,'x'.repeat(1025));
  if(kind==='directory')await mkdir(name);
  await assert.rejects(writePairingStatus(runtime));
  assert.equal(await readFile(target,'utf8'),'unchanged');
  if(kind==='link')assert.ok((await lstat(name)).isSymbolicLink());
  assert.deepEqual((await readdir(runtime)).filter(name=>name.endsWith('.tmp')),[]);
  assert.deepEqual(await readPairingStatusFile(runtime),status('unavailable'));
});
for(const kind of ['missing','extra','unknown','old','future','invalid-time'])test(`status file rejects ${kind}`,async t=>{
  const runtime=await fixture(t),now=Date.now();
  const value={version:1,state:'active-sync',checkedAt:new Date(now).toISOString()};
  if(kind==='extra')value.extra=true;
  if(kind==='unknown')value.state='connected';
  if(kind==='old')value.checkedAt=new Date(now-120001).toISOString();
  if(kind==='future')value.checkedAt=new Date(now+60001).toISOString();
  if(kind==='invalid-time')value.checkedAt='Unknown';
  if(kind!=='missing')await writeFile(path.join(runtime,'pairing-status.json'),JSON.stringify(value),{mode:0o600});
  assert.deepEqual(await readPairingStatusFile(runtime,now),status('unavailable'));
});
test('CLI prints only the state and refuses relative paths and extra arguments',async t=>{
  const runtime=await fixture(t),script=fileURLToPath(new URL('./peer-pairing-status.mjs',import.meta.url));
  const run=args=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
  const valid=run(['--runtime',runtime]);
  assert.equal(valid.status,0);assert.equal(valid.stdout,'{"version":1,"state":"unpaired"}\n');assert.equal(valid.stderr,'');
  for(const args of [['--runtime','.'],['--runtime',runtime,'extra']]) {
    const invalid=run(args);assert.equal(invalid.status,1);assert.equal(invalid.stdout,'');
    assert.equal(invalid.stderr,'Pairing status unavailable.\n');
  }
});

test('a repair consent fence makes an old pairing unavailable',async t=>{
  const {runtime}=await paired(t),name=path.join(runtime,'private-sync/pairing.json');
  const old=await readFile(name);
  await preparePairingRepair(runtime);
  await privateSyncDirectory(runtime,true);
  await writeFile(name,old,{mode:0o600});
  assert.deepEqual(await readPairingStatus(runtime),status('unavailable'));
});


test('a flush failure removes the exclusive temporary file and preserves the target',async t=>{
  const runtime=await fixture(t),name=path.join(runtime,'pairing-status.json');
  await writePairingStatus(runtime);
  const before=await readFile(name),handle=await open(name,'r');
  const prototype=Object.getPrototypeOf(handle);
  await handle.close();
  const mocked=t.mock.method(prototype,'sync',async()=>{throw Error('Synthetic flush failure');});
  try {
    await assert.rejects(writePairingStatus(runtime),/Synthetic flush failure/);
    assert.deepEqual(await readFile(name),before);
    assert.deepEqual((await readdir(runtime)).filter(name=>name.endsWith('.tmp')),[]);
  } finally {mocked.mock.restore();}
});

for(const mode of [0o640,0o620,0o604,0o602])test(`status reader refuses permission ${mode.toString(8)}`,{skip:process.platform==='win32'},async t=>{
  const runtime=await fixture(t),now=Date.now();await writePairingStatus(runtime,now);
  await chmod(path.join(runtime,'pairing-status.json'),mode);
  assert.deepEqual(await readPairingStatusFile(runtime,now),status('unavailable'));
});
test('status reader refuses another owner',{skip:process.platform==='win32'},async t=>{
  const runtime=await fixture(t),now=Date.now();await writePairingStatus(runtime,now);
  const uid=process.getuid();t.mock.method(process,'getuid',()=>uid+1);
  assert.deepEqual(await readPairingStatusFile(runtime,now),status('unavailable'));
});
