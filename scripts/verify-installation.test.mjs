import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {verifyInstallation,replaceVerifiedInstallation,replaceSignedInstallation} from '../native/windows/verify-installation.mjs';
import {installationReceiptSigningBytes,authenticateInstallationReceipt} from '../native/windows/signed-receipt.mjs';
import {verifyManifest} from '../native/windows/verify-manifest.mjs';
import {prepareInstallationReceipt,writeInstallationSigningRequest} from '../native/windows/prepare-installation-receipt.mjs';
import {stageUpdateHelper} from '../native/windows/stage-update-helper.mjs';
import {prepareUpdatePayload} from '../native/windows/prepare-update-payload.mjs';
import {stageUpdatePayload} from '../native/windows/stage-update-payload.mjs';
const hash=data=>createHash('sha256').update(data).digest('hex');
function fixture(t) {
  const root=realpathSync(mkdtempSync(path.join(tmpdir(),'observatory-installation-test-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const make=(name,revision,build)=>{
    const folder=path.join(root,name);mkdirSync(folder);
    const data=Buffer.from('Synthetic executable '+build);
    const manifest=Buffer.from(JSON.stringify({schema:1,platform:'win-x64',sourceRevision:revision,
      sourceDirty:false,totalBytes:data.length,files:[{path:'WorkspaceObservatory.exe',bytes:data.length,sha256:hash(data)}]}));
    const owner=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(`[Owner]\r\nProduct=WorkspaceObservatorySetup\r\nRevision=${revision}\r\n`,'utf16le')]);
    const uninstaller=Buffer.from('Synthetic uninstaller '+build);
    for(const [file,bytes] of Object.entries({'WorkspaceObservatory.exe':data,'package-manifest.json':manifest,
      'installer-owner.ini':owner,'Uninstall.exe':uninstaller}))writeFileSync(path.join(folder,file),bytes);
    return {folder,receipt:{sourceRevision:revision,buildNumber:build,manifestSha256:hash(manifest),ownerSha256:hash(owner),uninstallerSha256:hash(uninstaller)}};
  };
  return {root,old:make('installed','a'.repeat(40),7),next:make('staged','b'.repeat(40),8)};
}
test('real manifest verification accepts receipt-bound NSIS extras without weakening packaged verification',t=>{
  const f=fixture(t);
  assert.deepEqual(verifyInstallation(f.old.folder,f.old.receipt),{sourceRevision:'a'.repeat(40),buildNumber:7});
  assert.throws(()=>verifyManifest(f.old.folder),/inventory mismatch/);
  assert.throws(()=>verifyManifest(f.old.folder,{installerFiles:[{path:'arbitrary.txt',bytes:1,sha256:'a'.repeat(64)}]}));
});
test('actual manifest and ownership verifier is used before and after replacement',t=>{
  const f=fixture(t);
  const result=replaceVerifiedInstallation({installed:f.old.folder,staged:f.next.folder,
    previousReceipt:f.old.receipt,candidateReceipt:f.next.receipt});
  assert.equal(verifyInstallation(f.old.folder,f.next.receipt).buildNumber,8);
  assert.equal(verifyInstallation(result.previous,f.old.receipt).buildNumber,7);
  assert.deepEqual(JSON.parse(readFileSync(path.join(result.recovery,'previous-receipt.json'))),f.old.receipt);
  assert.deepEqual(JSON.parse(readFileSync(path.join(result.recovery,'candidate-receipt.json'))),f.next.receipt);
});
test('changed uninstaller, owner and manifest fail before replacement',t=>{
  const f=fixture(t);
  for(const name of ['Uninstall.exe','installer-owner.ini','package-manifest.json']) {
    const file=path.join(f.next.folder,name),saved=readFileSync(file);
    writeFileSync(file,'changed');
    assert.throws(()=>replaceVerifiedInstallation({installed:f.old.folder,staged:f.next.folder,
      previousReceipt:f.old.receipt,candidateReceipt:f.next.receipt}),/receipt mismatch/);
    assert.equal(verifyInstallation(f.old.folder,f.old.receipt).buildNumber,7);
    writeFileSync(file,saved);
  }
});
test('payload mutations and extra files are rejected despite matching metadata receipts',t=>{
  const f=fixture(t);
  writeFileSync(path.join(f.next.folder,'WorkspaceObservatory.exe'),'changed');
  assert.throws(()=>verifyInstallation(f.next.folder,f.next.receipt));
  writeFileSync(path.join(f.old.folder,'unrelated.txt'),'preserve');
  assert.throws(()=>verifyInstallation(f.old.folder,f.old.receipt),/inventory mismatch/);
});
test('wrong product ownership is refused even with its matching digest',t=>{
  const f=fixture(t),owner=Buffer.from(`[Owner]\nProduct=OtherApp\nRevision=${f.next.receipt.sourceRevision}\n`);
  writeFileSync(path.join(f.next.folder,'installer-owner.ini'),owner);
  assert.throws(()=>verifyInstallation(f.next.folder,{...f.next.receipt,ownerSha256:hash(owner)}),/ownership mismatch/);
});

function signer() {
  const keys=generateKeyPairSync('ed25519');
  return {
    publicKey:keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64'),
    envelope(receipt) {
      const body={schema:1,product:'WorkspaceObservatorySetup',platform:'windows-x64',...receipt};
      return Buffer.from(JSON.stringify({receipt:body,
        signature:sign(null,installationReceiptSigningBytes(body),keys.privateKey).toString('base64')}));
    },
  };
}
function buildFor(receipt) {
  return {schema:1,buildNumber:receipt.buildNumber,testIdentity:false,sourceDirty:false,
    sourceRevision:receipt.sourceRevision,packageManifestSha256:receipt.manifestSha256,
    installerSource:{dirty:false,revision:receipt.sourceRevision}};
}
test('update directory contains independently verified payload and exact signed envelope',t=>{
  const f=fixture(t),release=signer(),envelope=path.join(f.root,'signed.json');
  const bytes=release.envelope(f.next.receipt);writeFileSync(envelope,bytes);
  const output=path.join(f.root,'update');
  const result=prepareUpdatePayload(f.next.folder,envelope,release.publicKey,7,output);
  assert.equal(result.prepared,'verified-update-directory');
  assert.equal(result.buildNumber,8);
  assert.deepEqual(readFileSync(path.join(output,'installation-envelope.json')),bytes);
  assert.equal(verifyInstallation(path.join(output,'payload'),f.next.receipt).buildNumber,8);
  assert.equal(verifyInstallation(f.next.folder,f.next.receipt).buildNumber,8);
  assert.throws(()=>prepareUpdatePayload(f.next.folder,envelope,release.publicKey,7,output),/EEXIST/);
});
test('update preparation rejects untrusted, stale, tampered and nested payloads',t=>{
  const f=fixture(t),release=signer(),envelope=path.join(f.root,'signed.json');
  writeFileSync(envelope,release.envelope(f.next.receipt));
  const output=path.join(f.root,'update');
  assert.throws(()=>prepareUpdatePayload(f.next.folder,envelope,signer().publicKey,7,output),/signature/);
  assert.throws(()=>prepareUpdatePayload(f.next.folder,envelope,release.publicKey,8,output),/advance/);
  assert.throws(()=>prepareUpdatePayload(f.next.folder,envelope,release.publicKey,7,path.join(f.next.folder,'update')),/outside/);
  writeFileSync(path.join(f.next.folder,'WorkspaceObservatory.exe'),'Changed synthetic payload');
  assert.throws(()=>prepareUpdatePayload(f.next.folder,envelope,release.publicKey,7,output));
  assert.throws(()=>readFileSync(path.join(output,'installation-envelope.json')),/ENOENT/);
});
test('update preparation command preserves payload and refuses extra arguments',t=>{
  const f=fixture(t),release=signer(),envelope=path.join(f.root,'signed.json');
  writeFileSync(envelope,release.envelope(f.next.receipt));
  const output=path.join(f.root,'update-cli');
  const args=[fileURLToPath(new URL('../native/windows/prepare-update-payload.mjs',import.meta.url)),
    f.next.folder,envelope,release.publicKey,'7',output];
  const rejected=spawnSync(process.execPath,[...args,'unexpected'],{encoding:'utf8',timeout:10000});
  assert.notEqual(rejected.status,0);
  const result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).sourceRevision,f.next.receipt.sourceRevision);
  assert.equal(verifyInstallation(f.next.folder,f.next.receipt).buildNumber,8);
});
test('authenticated update wrapper stages a separate sibling without changing installed bytes',t=>{
  const f=fixture(t),release=signer(),envelope=path.join(f.root,'signed.json');
  writeFileSync(envelope,release.envelope(f.next.receipt));
  const output=path.join(f.root,'update');
  prepareUpdatePayload(f.next.folder,envelope,release.publicKey,7,output);
  const result=stageUpdatePayload(output,f.old.folder,f.old.receipt,release.publicKey);
  assert.equal(path.dirname(result.staged),path.dirname(f.old.folder));
  assert.equal(verifyInstallation(result.staged,f.next.receipt).buildNumber,8);
  assert.equal(verifyInstallation(f.old.folder,f.old.receipt).buildNumber,7);
  assert.equal(result.envelopePath,path.join(output,'installation-envelope.json'));
  assert.notEqual(stageUpdatePayload(output,f.old.folder,f.old.receipt,release.publicKey).staged,result.staged);
});
test('update wrapper rejects wrong signer, extra files and altered payload before staging',t=>{
  const f=fixture(t),release=signer(),envelope=path.join(f.root,'signed.json');
  writeFileSync(envelope,release.envelope(f.next.receipt));
  const output=path.join(f.root,'update');
  prepareUpdatePayload(f.next.folder,envelope,release.publicKey,7,output);
  assert.throws(()=>stageUpdatePayload(output,f.old.folder,f.old.receipt,signer().publicKey),/signature/);
  writeFileSync(path.join(output,'unrelated.txt'),'Synthetic private extra');
  assert.throws(()=>stageUpdatePayload(output,f.old.folder,f.old.receipt,release.publicKey),/entries/);
  rmSync(path.join(output,'unrelated.txt'));
  writeFileSync(path.join(output,'payload','WorkspaceObservatory.exe'),'Changed');
  assert.throws(()=>stageUpdatePayload(output,f.old.folder,f.old.receipt,release.publicKey));
  assert.equal(verifyInstallation(f.old.folder,f.old.receipt).buildNumber,7);
});
test('signed update directory survives ZIP, real native bounded extraction and sibling staging',{
  skip:process.platform!=='win32' || !process.env.OBSERVATORY_TEST_UPDATE_EXTRACTOR
    ?'Requires Windows and an explicitly supplied trusted native extractor':false,
},t=>{
  const f=fixture(t),release=signer(),envelope=path.join(f.root,'signed.json');
  const extractor=process.env.OBSERVATORY_TEST_UPDATE_EXTRACTOR;
  assert.ok(path.isAbsolute(extractor));
  writeFileSync(envelope,release.envelope(f.next.receipt));
  const prepared=path.join(f.root,'prepared'),expanded=path.join(f.root,'expanded');
  prepareUpdatePayload(f.next.folder,envelope,release.publicKey,7,prepared);
  mkdirSync(expanded);
  const script=path.join(f.root,'roundtrip.ps1');
  writeFileSync(script,`param([string]$Source,[string]$Archive,[string]$Extractor,[string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($Source,$Archive)
$arguments='--test-update-extraction "'+$Archive+'" "'+$Destination+'"'
$process=Start-Process -FilePath $Extractor -ArgumentList $arguments -Wait -PassThru
exit $process.ExitCode
`);
  const result=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-NonInteractive','-File',script,'-Source',prepared,'-Archive',path.join(f.root,'update.zip'),
      '-Extractor',extractor,'-Destination',expanded],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr || String(result.error));
  const children=readdirSync(expanded);
  assert.equal(children.length,1);
  assert.match(children[0],/^\.observatory-stage-[a-f0-9]{32}$/);
  const staged=stageUpdatePayload(path.join(expanded,children[0]),f.old.folder,f.old.receipt,release.publicKey);
  assert.equal(verifyInstallation(staged.staged,f.next.receipt).buildNumber,8);
  assert.equal(verifyInstallation(f.old.folder,f.old.receipt).buildNumber,7);
  assert.deepEqual(readFileSync(staged.envelopePath),readFileSync(envelope));
});
test('release preparation binds controlled installer output to clean build metadata and existing signer',t=>{
  const f=fixture(t),release=signer();
  const receipt=prepareInstallationReceipt(f.next.folder,buildFor(f.next.receipt));
  assert.deepEqual(receipt,{schema:1,product:'WorkspaceObservatorySetup',platform:'windows-x64',...f.next.receipt});
  assert.ok(Object.isFrozen(receipt));
  assert.deepEqual(authenticateInstallationReceipt(release.envelope(receipt),release.publicKey,7),receipt);
  assert.equal(verifyInstallation(f.next.folder,receipt).buildNumber,8);
});
test('receipt preparation rejects test builds, missing build identity and manifest provenance mismatch',t=>{
  const f=fixture(t),good=buildFor(f.next.receipt);
  for(const patch of [{testIdentity:true},{sourceDirty:true},{buildNumber:undefined},{buildNumber:0},
    {buildNumber:1.5},{sourceRevision:'c'.repeat(40)},{packageManifestSha256:'c'.repeat(64)},
    {installerSource:{dirty:true,revision:good.sourceRevision}}])
    assert.throws(()=>prepareInstallationReceipt(f.next.folder,{...good,...patch}));
  assert.equal(verifyInstallation(f.next.folder,f.next.receipt).buildNumber,8);
});
test('receipt preparation refuses modified payload and unrelated extras before signing',t=>{
  const f=fixture(t),good=buildFor(f.next.receipt);
  writeFileSync(path.join(f.next.folder,'unrelated.txt'),'Synthetic extra');
  assert.throws(()=>prepareInstallationReceipt(f.next.folder,good),/inventory mismatch/);
  writeFileSync(path.join(f.old.folder,'WorkspaceObservatory.exe'),'Tampered synthetic executable');
  assert.throws(()=>prepareInstallationReceipt(f.old.folder,buildFor(f.old.receipt)));
});
test('signing request writes exact canonical bytes without overwriting existing output or changing staging',t=>{
  const f=fixture(t),output=path.join(f.root,'signing-request');
  const receipt=writeInstallationSigningRequest(f.next.folder,buildFor(f.next.receipt),output);
  assert.deepEqual(JSON.parse(readFileSync(path.join(output,'installation-receipt.json'))),receipt);
  assert.deepEqual(readFileSync(path.join(output,'installation-receipt.signing-bytes')),installationReceiptSigningBytes(receipt));
  assert.throws(()=>writeInstallationSigningRequest(f.next.folder,buildFor(f.next.receipt),output),/EEXIST/);
  assert.throws(()=>writeInstallationSigningRequest(f.next.folder,buildFor(f.next.receipt),path.join(f.next.folder,'request')),/outside/);
  assert.equal(verifyInstallation(f.next.folder,f.next.receipt).buildNumber,8);
});
test('release receipt command emits unsigned output and rejects repeated invocation',t=>{
  const f=fixture(t),metadata=path.join(f.root,'installer-build.json'),output=path.join(f.root,'cli-output');
  writeFileSync(metadata,JSON.stringify(buildFor(f.next.receipt)));
  const args=[fileURLToPath(new URL('../native/windows/prepare-installation-receipt.mjs',import.meta.url)),f.next.folder,metadata,output];
  const run=()=>spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000});
  const first=run();
  assert.equal(first.status,0,first.stderr);
  assert.equal(JSON.parse(first.stdout).prepared,'unsigned-installation-receipt');
  assert.notEqual(run().status,0);
  assert.equal(verifyInstallation(f.next.folder,f.next.receipt).buildNumber,8);
});
test('signed receipt gates the real replacement and preserves a verified rollback payload',t=>{
  const f=fixture(t),release=signer();
  const envelope=release.envelope(f.next.receipt);
  const result=replaceSignedInstallation({installed:f.old.folder,staged:f.next.folder,
    previousReceipt:f.old.receipt,candidateEnvelope:envelope,trustedPublicKey:release.publicKey});
  assert.equal(verifyInstallation(f.old.folder,f.next.receipt).buildNumber,8);
  assert.equal(verifyInstallation(result.previous,f.old.receipt).buildNumber,7);
  const retained=readFileSync(path.join(result.recovery,'candidate-envelope.json'));
  assert.deepEqual(retained,envelope);
  const authenticated=authenticateInstallationReceipt(retained,release.publicKey,7);
  assert.equal(verifyInstallation(f.old.folder,authenticated).buildNumber,8);
  const previous=JSON.parse(readFileSync(path.join(result.recovery,'previous-receipt.json')));
  assert.equal(verifyInstallation(result.previous,previous).buildNumber,7);
});
test('wrong signer, altered hashes, replay and malformed envelopes leave both payloads intact',t=>{
  const f=fixture(t),release=signer(),attacker=signer();
  const good=release.envelope(f.next.receipt);
  const alter=edit=>{const value=JSON.parse(good);edit(value);return Buffer.from(JSON.stringify(value));};
  const candidates=[
    attacker.envelope(f.next.receipt),
    alter(x=>{x.receipt.manifestSha256='c'.repeat(64);}),
    alter(x=>{x.receipt.buildNumber=9;}),
    alter(x=>{x.receipt.platform='macos-arm64';}),
    alter(x=>{x.publicKey=attacker.publicKey;}),
    alter(x=>{x.receipt.extra='ignored';}),
    alter(x=>{x.signature+='\n';}),
    release.envelope({...f.next.receipt,buildNumber:7}),
    release.envelope({...f.next.receipt,buildNumber:6}),
    Buffer.alloc(8193),Buffer.from('null'),Buffer.from('{'),
  ];
  for(const candidateEnvelope of candidates) {
    assert.throws(()=>replaceSignedInstallation({installed:f.old.folder,staged:f.next.folder,
      previousReceipt:f.old.receipt,candidateEnvelope,trustedPublicKey:release.publicKey}));
    assert.equal(verifyInstallation(f.old.folder,f.old.receipt).buildNumber,7);
    assert.equal(verifyInstallation(f.next.folder,f.next.receipt).buildNumber,8);
  }
});
test('valid signature cannot authorize bytes different from the signed manifest',t=>{
  const f=fixture(t),release=signer(),candidateEnvelope=release.envelope(f.next.receipt);
  writeFileSync(path.join(f.next.folder,'WorkspaceObservatory.exe'),'tampered payload');
  assert.throws(()=>replaceSignedInstallation({installed:f.old.folder,staged:f.next.folder,
    previousReceipt:f.old.receipt,candidateEnvelope,trustedPublicKey:release.publicKey}));
  assert.equal(verifyInstallation(f.old.folder,f.old.receipt).buildNumber,7);
});
test('receipt verification rejects invalid trust configuration and freezes authenticated fields',t=>{
  const f=fixture(t),release=signer(),envelope=release.envelope(f.next.receipt);
  for(const key of ['',release.publicKey+'\n','x'.repeat(44)])
    assert.throws(()=>authenticateInstallationReceipt(envelope,key,7));
  for(const build of [-1,NaN,Infinity,7.5,'7'])
    assert.throws(()=>authenticateInstallationReceipt(envelope,release.publicKey,build));
  const receipt=authenticateInstallationReceipt(envelope,release.publicKey,7);
  assert.ok(Object.isFrozen(receipt));
  assert.equal(receipt.buildNumber,8);
});

test('candidate CLI authenticates and checks extracted inventory without replacement',t=>{
  const f=fixture(t),release=signer(),envelope=path.join(f.root,'receipt.json');
  writeFileSync(envelope,release.envelope(f.next.receipt));
  const entry=fileURLToPath(new URL('../native/windows/verify-candidate.mjs',import.meta.url));
  const run=(key=release.publicKey,build='7')=>spawnSync(process.execPath,
    [entry,f.next.folder,envelope,key,build],{encoding:'utf8',timeout:10000});
  const good=run();
  assert.equal(good.status,0,good.stderr);
  assert.deepEqual(JSON.parse(good.stdout),{schema:1,status:'verified',sourceRevision:f.next.receipt.sourceRevision,
    buildNumber:8,manifestSha256:f.next.receipt.manifestSha256});
  for(const result of [run(signer().publicKey),run(release.publicKey,'8'),run(release.publicKey,'7.0')]) {
    assert.notEqual(result.status,0);
    assert.equal(result.stdout,'');
  }
  writeFileSync(path.join(f.next.folder,'WorkspaceObservatory.exe'),'tampered');
  assert.notEqual(run().status,0);
  writeFileSync(envelope,Buffer.alloc(8193));
  assert.notEqual(run().status,0);
  assert.equal(verifyInstallation(f.old.folder,f.old.receipt).buildNumber,7);
});

test('helper staging copies verified installed code outside the live payload',t=>{
  const f=fixture(t);
  const result=stageUpdateHelper(f.old.folder,f.old.receipt,f.root);
  assert.notEqual(result.helper,f.old.folder);
  assert.equal(path.dirname(result.helper),f.root);
  assert.equal(verifyInstallation(result.helper,f.old.receipt).buildNumber,7);
  assert.equal(verifyInstallation(f.old.folder,f.old.receipt).buildNumber,7);
  writeFileSync(path.join(result.helper,'WorkspaceObservatory.exe'),'Changed copied fixture');
  assert.equal(verifyInstallation(f.old.folder,f.old.receipt).buildNumber,7);
  const second=stageUpdateHelper(f.old.folder,f.old.receipt,f.root);
  assert.notEqual(second.helper,result.helper);
  assert.equal(readFileSync(path.join(result.helper,'WorkspaceObservatory.exe'),'utf8'),'Changed copied fixture');
});

test('helper staging refuses untrusted payloads and a destination inside the installation',t=>{
  const f=fixture(t);
  assert.throws(()=>stageUpdateHelper(f.old.folder,f.old.receipt,f.old.folder),/outside/);
  assert.throws(()=>stageUpdateHelper(f.old.folder,f.next.receipt,f.root),/receipt mismatch/);
  writeFileSync(path.join(f.old.folder,'usage.json'),'Synthetic private data');
  assert.throws(()=>stageUpdateHelper(f.old.folder,f.old.receipt,f.root));
  assert.equal(readFileSync(path.join(f.old.folder,'usage.json'),'utf8'),'Synthetic private data');
});

test('external replacement command authenticates again and retains recovery evidence',t=>{
  const f=fixture(t),release=signer();
  const previous=path.join(f.root,'previous.json'),candidate=path.join(f.root,'candidate.json');
  writeFileSync(previous,JSON.stringify(f.old.receipt));
  writeFileSync(candidate,release.envelope(f.next.receipt));
  const entry=fileURLToPath(new URL('../native/windows/apply-update.mjs',import.meta.url));
  const run=key=>spawnSync(process.execPath,[entry,f.old.folder,f.next.folder,previous,candidate,key],
    {encoding:'utf8',timeout:10000});
  assert.equal(run(signer().publicKey).status,1);
  assert.equal(verifyInstallation(f.old.folder,f.old.receipt).buildNumber,7);
  const result=run(release.publicKey);
  assert.equal(result.status,0,result.stderr);
  const response=JSON.parse(result.stdout);
  assert.equal(response.status,'payload-replaced');
  assert.equal(verifyInstallation(response.installed,f.next.receipt).buildNumber,8);
  assert.equal(verifyInstallation(response.previous,f.old.receipt).buildNumber,7);
  assert.deepEqual(readFileSync(path.join(response.recovery,'candidate-envelope.json')),readFileSync(candidate));
});
