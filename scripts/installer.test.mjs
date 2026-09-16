import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,existsSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {nsisLiteral,payloadLists,validateInstallerEnvelope,generateInstaller} from '../native/windows/generate-installer.mjs';
import {desktopReleaseVersion} from '../native/release-version.mjs';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {installationReceiptSigningBytes} from '../native/windows/signed-receipt.mjs';

test('installer generator retains authenticated receipt input and isolates test provisioning',t=>{
  const root=realpathSync(mkdtempSync(path.join(tmpdir(),'observatory-installer-envelope-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const app=path.join(root,'app');mkdirSync(app);mkdirSync(path.join(app,'Runtime'));
  const data=Buffer.from('Synthetic package bytes'),digest=value=>createHash('sha256').update(value).digest('hex');
  const files=['LICENSE','Runtime/node.exe','WorkspaceObservatory.exe'].map(file=>{
    writeFileSync(path.join(app,file),data);return {path:file,bytes:data.length,sha256:digest(data)};
  });
  const manifest=Buffer.from(JSON.stringify({schema:1,platform:'win-x64',sourceRevision:'a'.repeat(40),sourceDirty:true,
    totalBytes:files.length*data.length,files}));
  writeFileSync(path.join(app,'package-manifest.json'),manifest);
  const {buildNumber}=desktopReleaseVersion(),keys=generateKeyPairSync('ed25519');
  const publicKey=keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
  const receipt={schema:1,product:'WorkspaceObservatorySetup',platform:'windows-x64',sourceRevision:'a'.repeat(40),buildNumber,
    manifestSha256:digest(manifest),ownerSha256:'b'.repeat(64),uninstallerSha256:'c'.repeat(64)};
  const envelope=Buffer.from(JSON.stringify({receipt,signature:sign(null,installationReceiptSigningBytes(receipt),keys.privateKey).toString('base64')}));
  const input=path.join(root,'envelope.json'),output=path.join(root,'generated');writeFileSync(input,envelope);
  generateInstaller(app,output,{testIdentity:true,installationEnvelope:input,updatePublicKey:publicKey});
  assert.deepEqual(readFileSync(path.join(output,'installer-update-envelope.json')),envelope);
  assert.match(readFileSync(path.join(output,'metadata.nsh'),'utf8'),/!define UPDATE_DATA_NAME "Workspace Observatory Installer Test"/);
  const build=JSON.parse(readFileSync(path.join(output,'artifacts/installer-build.json')));
  assert.equal(build.updateEnvelopeSha256,digest(envelope));
  const rejected=path.join(root,'rejected');
  assert.throws(()=>generateInstaller(app,rejected,{testIdentity:true,installationEnvelope:input}),/together/);
  assert.equal(existsSync(rejected),false);
});

test('installer envelope binds signer, package manifest, source and release build',()=>{
  const keys=generateKeyPairSync('ed25519');
  const publicKey=keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
  const manifest={sourceRevision:'a'.repeat(40)},bytes=Buffer.from(JSON.stringify(manifest));
  const receipt={schema:1,product:'WorkspaceObservatorySetup',platform:'windows-x64',sourceRevision:manifest.sourceRevision,
    buildNumber:24,manifestSha256:createHash('sha256').update(bytes).digest('hex'),ownerSha256:'b'.repeat(64),uninstallerSha256:'c'.repeat(64)};
  const envelope=Buffer.from(JSON.stringify({receipt,signature:sign(null,installationReceiptSigningBytes(receipt),keys.privateKey).toString('base64')}));
  assert.deepEqual(validateInstallerEnvelope(envelope,publicKey,manifest,bytes,24),receipt);
  assert.throws(()=>validateInstallerEnvelope(envelope,publicKey,manifest,bytes,25),/does not match/);
  assert.throws(()=>validateInstallerEnvelope(envelope,publicKey,{sourceRevision:'d'.repeat(40)},bytes,24),/does not match/);
  assert.throws(()=>validateInstallerEnvelope(envelope,publicKey,manifest,Buffer.from('changed'),24),/does not match/);
  const wrong=generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
  assert.throws(()=>validateInstallerEnvelope(envelope,wrong,manifest,bytes,24),/signature/);
});

test('installer values escape NSIS expansion and reject line injection',()=>{
  assert.equal(nsisLiteral('C:\\Build $name\\"quoted"'),'C:\\Build $$name\\$\\"quoted$\\"');
  assert.throws(()=>nsisLiteral('value\nFile other'));
  assert.throws(()=>nsisLiteral('value\0other'));
});
test('payload commands name individual files and remove deepest empty folders first',()=>{
  const lists=payloadLists({files:[{path:'Runtime/python/tzdata/file.txt'},{path:'LICENSE'}]},'C:/candidate');
  assert.ok(lists.install.includes('"/oname=file.txt"'));
  assert.ok(lists.uninstall.includes('Delete "$INSTDIR\\Runtime\\python\\tzdata\\file.txt"'));
  assert.ok(lists.uninstall.includes('Delete "$INSTDIR\\package-manifest.json"'));
  assert.equal(lists.directories.split('\n')[0],'RMDir "$INSTDIR\\Runtime\\python\\tzdata"');
  assert.ok(!/\/r\b|\*/i.test(lists.uninstall+lists.directories));
  assert.ok(lists.checks.includes('Call un.NoLinkedPath'));
  assert.throws(()=>payloadLists({files:[{path:'Uninstall.exe'}]},'C:/candidate'));
});
test('installer is per-user, source startup is opt-in and uninstall has ownership gates',()=>{
  const script=readFileSync(new URL('../native/windows/installer.nsi',import.meta.url),'utf8');
  assert.match(script,/RequestExecutionLevel user/);
  assert.match(script,/StrCmp \$INSTDIR \$1 0 wrong_owner/);
  assert.match(script,/ReadINIStr \$0 .* "Revision"/);
  assert.match(script,/EnumRegValue \$0 HKCU/);
  assert.doesNotMatch(script,/RMDir\s+\/r\b|Delete\s+.*\*|WriteReg\w+ HKLM|Reboot\b/);
  assert.doesNotMatch(script,/WriteReg\w+ .*CurrentVersion\\Run"/);
  assert.match(script,/ReadRegStr .*CurrentVersion\\Run"/);
  assert.match(script,/Call un\.CheckRunning/);
  assert.match(script,/Saved collection data/);
});
