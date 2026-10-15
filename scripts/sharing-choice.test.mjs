import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,realpath,rm,lstat,readFile,writeFile,symlink,chmod,unlink,mkdir,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {chooseSharing,applySharingChoice,readSharingChoice,clearSharingChoice,markSharingChoiceApplied} from './sharing-choice.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {createPairingConfigurations,initializePairing,readPairing} from './peer-pairing.mjs';
import {readQuotaState,updateQuotaState} from './quota-store.mjs';
import {readProviderTokenState,updateProviderTokenSource} from './provider-token-store.mjs';
import {quotaSharingControl} from './quota-sharing-control.mjs';
import {providerTokenSharingControl} from './provider-token-sharing-control.mjs';
import {cleanClaudeTokenSource} from './provider-token-sources.mjs';
import {revokePairing} from './peer-revocation.mjs';
import {attachQuotaSync} from './quota-sync.mjs';
import {collectProviderTokenSources} from './provider-token-sync.mjs';
const now=Date.now(),channels=['codex-limits','claude-code-tokens'];
const filename=runtime=>path.join(runtime,'private-sync/sharing-choice.json');
async function fixture(t,paired=true) {
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-choice-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  const pair=createPairingConfigurations().Mac;
  if(paired)await initializePairing(runtime,pair);
  return {runtime,pair};
}
async function quota(runtime,at=now) {
  const state=await readQuotaState(runtime,at);
  await updateQuotaState(runtime,{revision:state.revision,scope:'a'.repeat(64),
    observation:{status:'ok',checkedAt:new Date(at).toISOString(),windows:[{bucket:'codex',window:'primary',remainingPercent:60}]}},at);
}
function source(at=now) {
  const counts={inputTokens:2,cacheReadTokens:3,cacheCreationTokens:4,outputTokens:5,totalTokens:14,requestCount:1};
  return cleanClaudeTokenSource({provider:'claude-code',status:'ok',days:[{date:'2026-09-25',...counts,
    models:[{model:'claude-sonnet-4',...counts}]}]},'Mac',new Date(at).toISOString());
}
async function controls(runtime) {
  for(const [control,reasons] of [[quotaSharingControl,['ready','account-unavailable','pairing-unavailable']],
    [providerTokenSharingControl,['ready','source-unavailable','pairing-unavailable']]]) {
    const status=await control(runtime,{action:'status'},now);
    assert.deepEqual(Object.keys(status).sort(),['canEnable','enabled','reason','token','version']);
    assert.ok(reasons.includes(status.reason));
  }
}
for(const paired of [false,true])test(`missing intent with pairing ${paired} only checks the intent path`,async t=>{
  const {runtime}=await fixture(t,paired);
  await withPeerStateLock(runtime,async()=>{
    const before=await readdir(runtime,{recursive:true});
    const stat=t.mock.method(fs,'lstat');
    syncBuiltinESMExports();
    try {
      await markSharingChoiceApplied(runtime,'codex-limits');
      assert.deepEqual(stat.mock.calls.map(call=>call.arguments),[[filename(runtime)]]);
    } finally {stat.mock.restore();syncBuiltinESMExports();}
    assert.deepEqual(await readdir(runtime,{recursive:true}),before);
  });
});
test('marking an existing choice applies only the requested channel',async t=>{
  const {runtime}=await fixture(t);
  await chooseSharing(runtime,{enabled:true});
  const intent=JSON.parse(await readFile(filename(runtime),'utf8'));
  for(const channel of channels) {
    await withPeerStateLock(runtime,()=>markSharingChoiceApplied(runtime,channel));
    intent.applied[channel]=true;
    assert.deepEqual(JSON.parse(await readFile(filename(runtime),'utf8')),intent);
  }
});
test('choice requires an active pairing and boolean consent',async t=>{
  const {runtime}=await fixture(t,false);
  await assert.rejects(chooseSharing(runtime,{enabled:true}));
  await assert.rejects(lstat(filename(runtime)),{code:'ENOENT'});
  await assert.rejects(chooseSharing(runtime,{enabled:'true'}));
});
test('each channel waits for its reading and applies once, preserving a later manual disable',async t=>{
  const {runtime,pair}=await fixture(t);
  await chooseSharing(runtime,{enabled:true});
  for(const channel of channels)assert.deepEqual(await applySharingChoice(runtime,channel,now),{status:'waiting-for-reading'});
  assert.deepEqual(await readSharingChoice(runtime,now),{version:1,chosen:true,channels:{'codex-limits':'waiting-for-reading','claude-code-tokens':'waiting-for-reading'}});
  await assert.rejects(lstat(path.join(runtime,'private-quota')),{code:'ENOENT'});
  assert.equal(await readProviderTokenState(runtime,now),null);
  await controls(runtime);
  for(const channel of channels) {
    if(channel==='codex-limits')await quota(runtime);else await updateProviderTokenSource(runtime,source(),now);
    assert.deepEqual(await applySharingChoice(runtime,channel,now),{status:'applied'});
    assert.equal((await readSharingChoice(runtime,now)).channels[channel],'on');
    if(channel==='codex-limits') {
      assert.equal((await readQuotaState(runtime,now)).sharing.pairingId,pair.local.pairId);
      assert.equal((await readSharingChoice(runtime,now)).channels['claude-code-tokens'],'waiting-for-reading');
    }
    await controls(runtime);
    await chooseSharing(runtime,{enabled:true});
    assert.deepEqual(await applySharingChoice(runtime,channel,now),{status:'already-applied'});
    const control=channel==='codex-limits'?quotaSharingControl:providerTokenSharingControl;
    const disabled=await control(runtime,{action:'disable'},now);
    assert.deepEqual(Object.keys(disabled).sort(),['canEnable','enabled','reason','token','version']);
    assert.equal(disabled.reason,'ready');
    assert.deepEqual(await applySharingChoice(runtime,channel,now),{status:'already-applied'});
    assert.equal((await readSharingChoice(runtime,now)).channels[channel],'off');
    await controls(runtime);
  }
});
test('old readings wait and a different pairing intent is ignored',async t=>{
  const {runtime}=await fixture(t);
  await chooseSharing(runtime,{enabled:true});await quota(runtime,now-600001);
  await updateProviderTokenSource(runtime,source(now-600001),now);
  for(const channel of channels)assert.equal((await applySharingChoice(runtime,channel,now)).status,'waiting-for-reading');
  const intent=JSON.parse(await readFile(filename(runtime),'utf8'));intent.pairId='f'.repeat(64);
  await writeFile(filename(runtime),JSON.stringify(intent));
  for(const channel of channels)assert.equal((await applySharingChoice(runtime,channel,now)).status,'none');
  assert.equal((await readSharingChoice(runtime,now)).chosen,false);await controls(runtime);
});
for(const revoke of [false,true])test(`${revoke?'revocation':'choosing false'} disables both stores and clears intent`,async t=>{
  const {runtime}=await fixture(t);
  await chooseSharing(runtime,{enabled:true});await quota(runtime);await updateProviderTokenSource(runtime,source(),now);
  for(const channel of channels)await applySharingChoice(runtime,channel,now);
  if(revoke)await revokePairing(runtime);else await chooseSharing(runtime,{enabled:false});
  assert.equal((await readQuotaState(runtime,now)).sharing.enabled,false);
  const db=new DatabaseSync(path.join(runtime,'private-sync/provider-tokens.sqlite'));
  try {assert.equal(JSON.parse(db.prepare('SELECT record FROM provider_token_state').get().record).generation,null);}finally{db.close();}
  await assert.rejects(lstat(filename(runtime)),{code:'ENOENT'});
  assert.equal((await readSharingChoice(runtime,now)).chosen,false);
  await clearSharingChoice(runtime);await controls(runtime);
});
for(const kind of ['corrupt','oversized','linked','hardlinked','group-readable'])test(`${kind} intent fails closed and apply leaves it intact`,
  {skip:kind==='group-readable' && process.platform==='win32'},async t=>{
  const {runtime}=await fixture(t);await chooseSharing(runtime,{enabled:true});await quota(runtime);
  const file=filename(runtime);
  if(kind==='linked') {
    const target=path.join(runtime,'target');await writeFile(target,'synthetic',{mode:0o600});await unlink(file);await symlink(target,file);
  } else if(kind==='hardlinked') {
    const {link}=await import('node:fs/promises');await link(file,path.join(runtime,'other'));
  } else if(kind==='group-readable')await chmod(file,0o640);
  else await writeFile(file,kind==='corrupt'?'{':'x'.repeat(1025));
  const before=await lstat(file);
  assert.equal((await applySharingChoice(runtime,'codex-limits',now)).status,'none');
  const status=await readSharingChoice(runtime,now);
  assert.deepEqual(status,{version:1,chosen:false,channels:{'codex-limits':'unavailable','claude-code-tokens':'unavailable'}});
  assert.equal((await lstat(file)).ino,before.ino);
  assert.equal((await readQuotaState(runtime,now)).sharing.enabled,false);
  if(kind==='linked')await assert.rejects(clearSharingChoice(runtime));
});
test('collection hooks apply consent and preserve local results with corrupt intent',async t=>{
  for(const corrupt of [false,true]) {
    const {runtime}=await fixture(t);await chooseSharing(runtime,{enabled:true});await quota(runtime,Date.now());
    if(corrupt)await writeFile(filename(runtime),'{');
    const input={data:{quota:{status:'ok'}}};
    assert.equal(await attachQuotaSync(runtime,input,{enabled:true}),input);
    assert.equal(input.quotaSync.status,corrupt?'disabled':'passive');
    const local=source();
    const collected=await collectProviderTokenSources(runtime,local,{clock:()=>now});
    assert.equal(collected.status,corrupt?'disabled':'passive');assert.deepEqual(collected.sources,[local]);
    assert.equal((await readQuotaState(runtime,now)).sharing.enabled,!corrupt);
    assert.equal(Boolean((await readProviderTokenState(runtime,now)).generation),!corrupt);
  }
});
test('CLI status is bounded and rejects extra keys with one generic error',async t=>{
  const {runtime}=await fixture(t);
  const run=input=>spawnSync(process.execPath,['scripts/sharing-choice.mjs','--runtime',runtime],
    {input,encoding:'utf8',timeout:15000,env:{...process.env,NODE_NO_WARNINGS:'1'}});
  const status=run('{"action":"status"}');assert.equal(status.status,0);assert.equal(JSON.parse(status.stdout).chosen,false);
  for(const input of ['{"action":"status","extra":true}','{"action":"choose","enabled":"true"}','x'.repeat(1025),Buffer.from([0xff])]) {
    const invalid=run(input);assert.equal(invalid.status,1);assert.equal(invalid.stdout,'');assert.equal(invalid.stderr,'Sharing choice unavailable.\n');
  }
});
test('existing sharing is marked applied without rotating either generation',async t=>{
  const {runtime}=await fixture(t);await quota(runtime);await updateProviderTokenSource(runtime,source(),now);
  for(const control of [quotaSharingControl,providerTokenSharingControl]) {
    const status=await control(runtime,{action:'status'},now);
    await control(runtime,{action:'enable',token:status.token},now);
  }
  const quotaBefore=await readQuotaState(runtime,now),providerBefore=await readProviderTokenState(runtime,now);
  await chooseSharing(runtime,{enabled:true});
  for(const channel of channels)assert.equal((await applySharingChoice(runtime,channel,now)).status,'applied');
  assert.equal((await readQuotaState(runtime,now)).sharing.generation,quotaBefore.sharing.generation);
  assert.equal((await readProviderTokenState(runtime,now)).generation,providerBefore.generation);
});
test('an explicit choice can replace corrupt content and clear refuses a non-file',async t=>{
  const {runtime}=await fixture(t);await chooseSharing(runtime,{enabled:true});
  await writeFile(filename(runtime),'{');await chooseSharing(runtime,{enabled:true});
  assert.equal((await readSharingChoice(runtime,now)).chosen,true);
  await clearSharingChoice(runtime);
  const {mkdir}=await import('node:fs/promises');await mkdir(filename(runtime),{mode:0o700});
  await assert.rejects(clearSharingChoice(runtime));
});
test('provider cleanup failure keeps revocation fenced and reports failure',async t=>{
  const {runtime}=await fixture(t);await chooseSharing(runtime,{enabled:true});
  await updateProviderTokenSource(runtime,source(),now);
  await writeFile(path.join(runtime,'private-sync/provider-tokens.sqlite'),'synthetic corrupt database');
  await assert.rejects(revokePairing(runtime));
  assert.ok((await lstat(path.join(runtime,'private-sync/revoked'))).isFile());
  assert.equal((await applySharingChoice(runtime,'codex-limits',now)).status,'none');
});
test('a throwing apply store path does not abort quota collection',async t=>{
  const {runtime}=await fixture(t);await chooseSharing(runtime,{enabled:true});await quota(runtime);
  await writeFile(path.join(runtime,'private-quota/state.sqlite'),'synthetic corrupt database');
  await assert.rejects(applySharingChoice(runtime,'codex-limits',now));
  const input={data:{quota:{status:'ok'}}};
  assert.equal(await attachQuotaSync(runtime,input,{enabled:true}),input);
  assert.equal(input.quotaSync.status,'unavailable');assert.equal(input.data.quota.status,'ok');
});

for(const channel of channels)test(`manual disable before a reading keeps ${channel} off`,async t=>{
  const {runtime}=await fixture(t);
  await chooseSharing(runtime,{enabled:true});
  const control=channel==='codex-limits'?quotaSharingControl:providerTokenSharingControl;
  assert.deepEqual(await control(runtime,{action:'disable'},now),{version:1,enabled:false,canEnable:false,
    reason:channel==='codex-limits'?'account-unavailable':'source-unavailable',token:null});
  await quota(runtime);await updateProviderTokenSource(runtime,source(),now);
  for(const current of channels)assert.equal((await applySharingChoice(runtime,current,now)).status,current===channel?'already-applied':'applied');
  const status=await readSharingChoice(runtime,now);
  for(const current of channels)assert.equal(status.channels[current],current===channel?'off':'on');
});
test('choosing off disables both channels with corrupt pairing',async t=>{
  const {runtime}=await fixture(t);
  await chooseSharing(runtime,{enabled:true});await quota(runtime);await updateProviderTokenSource(runtime,source(),now);
  for(const channel of channels)await applySharingChoice(runtime,channel,now);
  await writeFile(path.join(runtime,'private-sync/pairing.json'),'{');
  await chooseSharing(runtime,{enabled:false});
  assert.equal((await readQuotaState(runtime,now)).sharing.enabled,false);
  const db=new DatabaseSync(path.join(runtime,'private-sync/provider-tokens.sqlite'));
  try {assert.equal(JSON.parse(db.prepare('SELECT record FROM provider_token_state').get().record).generation,null);}finally{db.close();}
  await assert.rejects(lstat(filename(runtime)),{code:'ENOENT'});
});
test('failed intent rename removes its temporary file',async t=>{
  const {runtime}=await fixture(t);await mkdir(filename(runtime),{mode:0o700});
  await assert.rejects(chooseSharing(runtime,{enabled:true}));
  assert.deepEqual((await readdir(path.dirname(filename(runtime)))).filter(name=>name.endsWith('.pending')),[]);
});
for(const channel of channels)test(`invalid intent never blocks ${channel} disable`,async t=>{
  const {runtime}=await fixture(t);await chooseSharing(runtime,{enabled:true});
  await quota(runtime);await updateProviderTokenSource(runtime,source(),now);
  for(const current of channels)await applySharingChoice(runtime,current,now);
  await writeFile(filename(runtime),'{');
  const control=channel==='codex-limits'?quotaSharingControl:providerTokenSharingControl;
  assert.equal((await control(runtime,{action:'disable'},now)).enabled,false);
  assert.equal(await readFile(filename(runtime),'utf8'),'{');
});
test('quota collection applies the caller clock to a synthetic reading',async t=>{
  const {runtime}=await fixture(t),at=Date.UTC(2020,0,1);
  await chooseSharing(runtime,{enabled:true});await quota(runtime,at);
  await attachQuotaSync(runtime,{data:{quota:{status:'ok'}}},{enabled:true,clock:()=>at});
  assert.equal((await readQuotaState(runtime,at)).sharing.enabled,true);
});

for(const channel of channels)for(const clearFails of [false,true])test(`${channel} disable handles a failed intent write with clear failure ${clearFails}`,async t=>{
  const {runtime}=await fixture(t);
  await quota(runtime);await updateProviderTokenSource(runtime,source(),now);
  const control=channel==='codex-limits'?quotaSharingControl:providerTokenSharingControl;
  const status=await control(runtime,{action:'status'},now);
  await control(runtime,{action:'enable',token:status.token},now);
  await chooseSharing(runtime,{enabled:true});
  const rename=fs.rename,unlink=fs.unlink;
  let failures=0;
  const renameMock=t.mock.method(fs,'rename',async(from,to)=>{
    if(to===filename(runtime) && failures++===0)throw Error('Synthetic rename failure');
    return rename(from,to);
  });
  const unlinkMock=t.mock.method(fs,'unlink',async file=>{
    if(clearFails && file===filename(runtime))throw Error('Synthetic unlink failure');
    return unlink(file);
  });
  syncBuiltinESMExports();
  try {
    if(clearFails)await assert.rejects(control(runtime,{action:'disable'},now),/Synthetic unlink failure/);
    else assert.equal((await control(runtime,{action:'disable'},now)).enabled,false);
    assert.equal(failures,1);
  } finally {renameMock.mock.restore();unlinkMock.mock.restore();syncBuiltinESMExports();}
  assert.equal((await control(runtime,{action:'status'},now)).enabled,clearFails);
  await quota(runtime,now+1);await updateProviderTokenSource(runtime,source(now+1),now+1);
  if(!clearFails) {
    assert.equal((await applySharingChoice(runtime,channel,now+1)).status,'none');
    assert.equal((await control(runtime,{action:'status'},now+1)).enabled,false);
  }
});

for(const offChannel of [null,...channels])test(`failed choice removal preserves both channels with prior off ${offChannel}`,async t=>{
  const {runtime}=await fixture(t);
  await quota(runtime);await updateProviderTokenSource(runtime,source(),now);
  for(const control of [quotaSharingControl,providerTokenSharingControl]) {
    const status=await control(runtime,{action:'status'},now);
    await control(runtime,{action:'enable',token:status.token},now);
  }
  await chooseSharing(runtime,{enabled:true});
  if(offChannel)await (offChannel==='codex-limits'?quotaSharingControl:providerTokenSharingControl)(runtime,{action:'disable'},now);
  const before=await readSharingChoice(runtime,now),unlink=fs.unlink;
  let failures=0;
  const mocked=t.mock.method(fs,'unlink',async file=>{
    if(file===filename(runtime) && failures++===0)throw Error('Synthetic unlink failure');
    return unlink(file);
  });
  syncBuiltinESMExports();
  try {await assert.rejects(chooseSharing(runtime,{enabled:false}),/Synthetic unlink failure/);}
  finally {mocked.mock.restore();syncBuiltinESMExports();}
  assert.equal(failures,1);
  assert.deepEqual(await readSharingChoice(runtime,now),before);
  await quota(runtime,now+1);await updateProviderTokenSource(runtime,source(now+1),now+1);
  for(const channel of channels)assert.equal((await applySharingChoice(runtime,channel,now+1)).status,channel===offChannel?'already-applied':'applied');
  assert.deepEqual((await readSharingChoice(runtime,now+1)).channels,before.channels);
});

test('mark verifies the intent directory once before writing and once after rename',async t=>{
  const {runtime}=await fixture(t);
  await chooseSharing(runtime,{enabled:true});
  const mocked=t.mock.method(fs,'realpath');
  syncBuiltinESMExports();
  const checks=()=>mocked.mock.calls.filter(call=>call.arguments[0]===path.dirname(filename(runtime))).length;
  try {
    await withPeerStateLock(runtime,async()=>{
      await readPairing(runtime);
      const pairingChecks=checks();
      await markSharingChoiceApplied(runtime,'codex-limits');
      // Each verification resolves the directory before and after its ACL check.
      assert.equal(checks()-pairingChecks,pairingChecks+4);
    });
  } finally {mocked.mock.restore();syncBuiltinESMExports();}
});
