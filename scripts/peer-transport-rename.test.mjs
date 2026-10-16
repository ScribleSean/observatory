import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {registerHooks} from 'node:module';
import {mkdtemp,mkdir,realpath,rm,writeFile,readFile,stat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {renameWindowsTransport,renameNames} from './peer-transport-rename.mjs';
import {appNames} from '../native/app-names.mjs';
import {privateSyncDirectory,privateCollectorDirectory} from './peer-directory.mjs';
import {readPairing,validatePairing} from './peer-pairing.mjs';
import {complementaryWindowsPairing,setupPairing} from './peer-setup.mjs';
import {ensureWindowsPairing} from './peer-setup-endpoint.mjs';
import {sshPeerExchange,sshMigrationReceipt} from './peer-transport.mjs';
import {createPeerPayload} from './peer-payload.mjs';
import {publishLocalPayload,acceptPeerState,readPeerState} from './peer-store.mjs';
import {writeRepairConsent} from './peer-repair-consent.mjs';

const fields=['remoteNode','remoteScript','remoteRuntime'];
const windowsPaths=name=>({remoteNode:`C:\\Users\\Example\\AppData\\Local\\Programs\\${name}\\Runtime\\node.exe`,
  remoteScript:`C:\\Users\\Example\\AppData\\Local\\Programs\\${name}\\Collector\\scripts\\peer-exchange.mjs`,
  remoteRuntime:`C:\\Users\\Example\\AppData\\Local\\${name}`});
const receipt=()=>({schema:1,windowsAppRunning:false,ssh:{from:windowsPaths(appNames.legacy.productName),to:windowsPaths(appNames.visible.productName)}});
const transport=()=>({kind:'ssh-windows',hostAlias:'synthetic-host',...Object.fromEntries(
  Object.entries(receipt().ssh.from).map(([key,value])=>[key,value.replaceAll('\\','/')]))});
const pair=()=>{
  const side=(host,id)=>({pairId:'a'.repeat(64),deviceId:id.repeat(64),comparisonId:'d'.repeat(64),host,codexHosts:[host]});
  return {version:1,local:{...side('Mac','b'),comparisonSalt:'e'.repeat(64)},peer:side('Windows','c'),transport:transport()};
};
const file=(runtime,name='pairing.json')=>path.join(runtime,'private-sync',name);
const write=(runtime,value,name)=>writeFile(file(runtime,name),JSON.stringify(value),{mode:0o600});
async function fixture(t,name='Observatory') {
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'transport-rename-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const runtime=path.join(root,name);await mkdir(runtime,{mode:0o700});
  await privateSyncDirectory(runtime,true);await write(runtime,pair());
  return runtime;
}
const run=(runtime,options={})=>renameWindowsTransport({runtime,runningProcesses:()=>'',fetchReceipt:async()=>receipt(),...options});
async function snapshot(runtime) {
  const result={};
  for(const name of ['pairing.json','setup.pending.json']) {
    try {result[name]={bytes:await readFile(file(runtime,name)),mtime:(await stat(file(runtime,name),{bigint:true})).mtimeNs};}
    catch(error) {if(error.code!=='ENOENT')throw error;}
  }
  return result;
}
async function refuses(runtime,options={},pattern) {
  const before=await snapshot(runtime);
  await assert.rejects(run(runtime,options),pattern);
  assert.deepEqual(await snapshot(runtime),before);
}

// The rename helper runs on the Mac only.
const mac={skip:process.platform==='win32'};
test('collector name literals equal the shared app names',()=>{
  assert.deepEqual(renameNames,{visibleDataFolder:appNames.visible.dataFolder,legacyDataFolder:appNames.legacy.dataFolder,
    visibleProductName:appNames.visible.productName,legacyProductName:appNames.legacy.productName});
});

test('rename preserves identity and bidirectional exchange and keeps the setup retry guard',mac,async t=>{
  const mac=await fixture(t),windows=await fixture(t,'Windows'),raw=pair();
  const remote=complementaryWindowsPairing(raw);await write(windows,remote);
  // Select Windows only in the endpoint under test. Filesystem checks still run on this Mac.
  const endpointURL=new URL('./peer-exchange.mjs?synthetic-windows-rename',import.meta.url).href;
  const hooks=registerHooks({load(url,context,nextLoad) {
    const loaded=nextLoad(url,context);
    if(url!==endpointURL)return loaded;
    const source=loaded.source.toString();
    const hostSelection="process.platform==='darwin'?'Mac':process.platform==='win32'?'Windows':null";
    assert.ok(source.includes(hostSelection));
    return {...loaded,source:source.replace(hostSelection,"'Windows'")};
  }});
  let exchangePeerRequest;
  try {({exchangePeerRequest}=await import(endpointURL));}finally {hooks.deregister();}
  const now=Date.now();
  const payload=config=>createPeerPayload({collectedAt:new Date(now).toISOString(),activity:{status:'not-connected'},
    codex:[{host:config.host,status:'not-connected'}],dictation:[{source:'Wispr Flow',status:'not-connected'}]},config);
  async function exchange(expected) {
    const macPair=await readPairing(mac),winPair=await readPairing(windows);
    const local=await publishLocalPayload(mac,payload(macPair.local),macPair.local,now);
    const peer=await publishLocalPayload(windows,payload(winPair.local),winPair.local,now);
    const result=await sshPeerExchange(macPair.transport,local,async(args,input)=>{
      const command=Buffer.from(args.at(-1).split(' ').at(-1),'base64').toString('utf16le');
      for(const key of fields)assert.ok(command.includes(expected[key]),key);
      assert.equal(args.at(-2),'synthetic-host');
      return JSON.stringify(await exchangePeerRequest(windows,JSON.parse(input),now));
    });
    await acceptPeerState(mac,result,macPair.peer,now);
    assert.deepEqual(await readPeerState(windows,winPair.peer,now),local);
    assert.deepEqual(await readPeerState(mac,macPair.peer,now),peer);
    assert.equal(macPair.peer.pairId,winPair.local.pairId);
    assert.equal(macPair.local.pairId,raw.local.pairId);
  }
  await exchange(raw.transport);
  await write(mac,raw,'setup.pending.json');
  assert.deepEqual(await run(mac),{state:'updated',fields});
  const updated=JSON.parse(await readFile(file(mac),'utf8'));
  const {transport:oldTarget,...oldRest}=raw,{transport:newTarget,...newRest}=updated;
  assert.ok(isDeepStrictEqual(oldRest,newRest));
  assert.deepEqual(JSON.parse(await readFile(file(mac,'setup.pending.json'),'utf8')),updated);
  assert.equal((await stat(file(mac))).mode&0o777,0o600);
  await exchange(newTarget);
  assert.deepEqual(await setupPairing(mac,{transport:newTarget},async(target,value)=>{
    assert.deepEqual(target,newTarget);
    return ensureWindowsPairing(windows,{version:1,pairing:value},'win32');
  },'darwin'),{status:'paired'});
  await refuses(mac,{fetchReceipt:async()=>receipt(),runningProcesses:()=>'/Applications/Observatory.app/Contents/MacOS/WorkspaceObservatory'},/Quit/);
  await assert.rejects(setupPairing(mac,{transport:oldTarget},async()=>assert.fail('Must not send'),'darwin'),
    {message:'Retry requires the original setup target'});
  const before=await snapshot(mac);
  assert.deepEqual(await run(mac),{state:'unchanged',reason:'already-updated'});
  assert.deepEqual(await snapshot(mac),before);
});

test('repair fields and backslash separator style survive',mac,async t=>{
  const runtime=await fixture(t),raw=pair();
  raw.transport={...raw.transport,...receipt().ssh.from};
  raw.repair={mac:'1'.repeat(64),windows:'2'.repeat(64)};
  await privateCollectorDirectory(runtime,'private-repair',true);
  await writeRepairConsent(runtime,raw.repair.mac);await write(runtime,raw);
  await run(runtime);
  const updated=JSON.parse(await readFile(file(runtime),'utf8'));
  assert.deepEqual(updated,{...raw,transport:{...raw.transport,...receipt().ssh.to}});
});

test('process guards never write pairing bytes or mtimes',mac,async t=>{
  const runtime=await fixture(t);
  for(const line of ['/tmp/WorkspaceObservatory --fixture','/tmp/Workspace Observatory.app/Contents/helper',
    '/tmp/Observatory.app/Contents/helper','node /tmp/claude-statusline-bridge.mjs'])
    await refuses(runtime,{runningProcesses:()=>line,fetchReceipt:()=>assert.fail('Must not fetch')},/Quit/);
  await refuses(runtime,{fetchReceipt:async()=>({...receipt(),windowsAppRunning:true})});
  await refuses(runtime,{fetchReceipt:async()=>{throw Error('The PC migration record was not found.');}},/record was not found/);
});

test('partial, custom and malformed records refuse without writing',mac,async t=>{
  const runtime=await fixture(t);
  for(const count of [1,2]) {
    const raw=pair();for(const key of fields.slice(0,count))raw.transport[key]=receipt().ssh.to[key];
    await write(runtime,raw);await refuses(runtime,{},/The saved Windows paths do not match the PC migration record. Pairing repair is needed./);
  }
  await write(runtime,{...pair(),transport:{...transport(),remoteNode:'C:/Apps/node.exe',remoteScript:'C:/Apps/peer-exchange.mjs',remoteRuntime:'C:/Apps/data'}});
  await refuses(runtime,{},/Pairing repair is needed/);
  await write(runtime,pair());
  const malformed=[null,[],{}, {...receipt(),schema:2},{...receipt(),windowsAppRunning:undefined},
    {...receipt(),ssh:{...receipt().ssh,extra:true}}];
  for(const side of ['from','to'])for(const changes of [{extra:true},{remoteNode:'C:/bad.exe'},
    {remoteScript:'C:/other.mjs'},{remoteRuntime:'C:/../data'},{remoteRuntime:'relative'}])
    malformed.push({...receipt(),ssh:{...receipt().ssh,[side]:{...receipt().ssh[side],...changes}}});
  for(const record of malformed)await refuses(runtime,{fetchReceipt:async()=>record});
});

test('legacy and noncanonical runtimes and differing pending pairing refuse',mac,async t=>{
  const legacy=await fixture(t,appNames.legacy.dataFolder);await refuses(legacy,{},/Canonical/);
  const runtime=await fixture(t);
  await refuses(runtime+'/',{},/Canonical/);
  const link=path.join(path.dirname(runtime),'alias');await symlink(runtime,link);
  await refuses(link,{},/Canonical/);
  await write(runtime,{...pair(),transport:{...transport(),hostAlias:'different'}},'setup.pending.json');
  await refuses(runtime,{},/Conflicting pending/);
});

test('TLS and absent pairing return not-ssh without fetching',mac,async t=>{
  const runtime=await fixture(t);
  await write(runtime,{...validatePairing(pair()),transport:{kind:'tls',address:'100.64.0.2',port:43128}});
  const before=await snapshot(runtime);
  assert.deepEqual(await run(runtime,{fetchReceipt:()=>assert.fail('Must not fetch')}),{state:'unchanged',reason:'not-ssh'});
  assert.deepEqual(await snapshot(runtime),before);
  const empty=path.join(path.dirname(runtime),'empty','Observatory');await mkdir(empty,{recursive:true,mode:0o700});
  assert.deepEqual(await run(empty,{fetchReceipt:()=>assert.fail('Must not fetch')}),{state:'unchanged',reason:'not-ssh'});
});


test('real receipt helper fetches once and updated layouts never fetch again',mac,async t=>{
  const runtime=await fixture(t);
  let calls=0;
  const fakeInvoke=async()=>{calls++;return JSON.stringify({running:false,record:receipt()});};
  const options={fetchReceipt:transport=>sshMigrationReceipt(transport,fakeInvoke)};
  assert.deepEqual(await run(runtime,options),{state:'updated',fields});
  assert.equal(calls,1);
  calls=0;
  assert.deepEqual(await run(runtime,options),{state:'unchanged',reason:'already-updated'});
  assert.equal(calls,0);
  const updated=JSON.parse(await readFile(file(runtime),'utf8'));
  for(const separator of ['/',String.fromCharCode(92)]) {
    for(const key of fields)updated.transport[key]=updated.transport[key].replaceAll('/',separator)
      .replaceAll('Programs','PROGRAMS').replaceAll('Observatory','OBSERVATORY');
    await write(runtime,updated);
    assert.deepEqual(await run(runtime,options),{state:'unchanged',reason:'already-updated'});
    assert.equal(calls,0);
  }
});

test('interrupted atomic writes resume without changing pair identity',mac,async t=>{
  const runtime=await fixture(t),original=pair();
  await write(runtime,original,'setup.pending.json');
  const fetchReceipt=transport=>sshMigrationReceipt(transport,async()=>JSON.stringify({running:false,record:receipt()}));
  await assert.rejects(run(runtime,{fetchReceipt,hooks:{afterFirstWrite:()=>{throw Error('synthetic crash');}}}),/synthetic crash/);
  const updated=JSON.parse(await readFile(file(runtime,'setup.pending.json'),'utf8'));
  assert.deepEqual(JSON.parse(await readFile(file(runtime),'utf8')),original);
  assert.notDeepEqual(updated.transport,original.transport);
  assert.deepEqual(await run(runtime,{fetchReceipt}),{state:'updated',fields});
  assert.deepEqual(JSON.parse(await readFile(file(runtime),'utf8')),updated);
  assert.deepEqual(JSON.parse(await readFile(file(runtime,'setup.pending.json'),'utf8')),updated);
  assert.deepEqual({...updated,transport:original.transport},original);
  // The active file can also be the one that already holds the new transport.
  await write(runtime,original,'setup.pending.json');
  assert.deepEqual(await run(runtime,{fetchReceipt}),{state:'updated',fields});
  assert.deepEqual(JSON.parse(await readFile(file(runtime,'setup.pending.json'),'utf8')),updated);
  const different={...original,local:{...original.local,deviceId:'f'.repeat(64)}};
  await write(runtime,different,'setup.pending.json');
  await refuses(runtime,{fetchReceipt:()=>assert.fail('Must not fetch')},/Conflicting pending/);
  const partial={...original,transport:{...original.transport,remoteRuntime:updated.transport.remoteRuntime}};
  await write(runtime,partial,'setup.pending.json');
  await refuses(runtime,{fetchReceipt:()=>assert.fail('Must not fetch')},/Conflicting pending/);
});
