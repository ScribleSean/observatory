import {appNames} from '../native/app-names.mjs';
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
  assert.match(readFileSync(path.join(output,'metadata.nsh'),'utf8'),new RegExp(`!define UPDATE_DATA_NAME "${appNames.visible.windowsTestName}"`));
  const metadata=readFileSync(path.join(output,'metadata.nsh'),'utf8');
  assert.ok(metadata.includes(`!define APP_NAME "${appNames.visible.windowsTestName}"`));
  assert.ok(metadata.includes(`!define PUBLISHER "${appNames.visible.publisher}"`));
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
test('installer writes registration after payload, envelope and shortcut success',()=>{
  const script=readFileSync(new URL('../native/windows/installer.nsi',import.meta.url),'utf8');
  const install=script.match(/^Section "Install"\r?\n([\s\S]*?)^SectionEnd/m)?.[1];
  assert.ok(install);
  const writes=[...install.matchAll(/^\s*WriteReg(?:Str|DWORD) HKCU "\$\{UNINSTALL_KEY\}"[^\r\n]*/gm)];
  const locations=writes.filter(write=>/"InstallLocation"/.test(write[0]));
  assert.equal(locations.length,1);
  assert.match(locations[0][0],/"InstallLocation" "\$INSTDIR"\s*$/);
  const payload=install.indexOf('!include "install-files.nsh"');
  const envelope=install.indexOf('!ifdef UPDATE_ENVELOPE');
  const envelopeEnd=install.indexOf('!endif',envelope);
  const shortcut=install.indexOf('CreateShortcut ');
  const shortcutCheck=install.indexOf('IfErrors install_failed',shortcut);
  assert.ok(payload>=0 && envelope>payload && envelopeEnd>envelope);
  assert.ok(shortcut>envelopeEnd && shortcutCheck>shortcut);
  for(const write of writes)assert.ok(write.index>shortcutCheck);
});
test('installer refuses folders before checking uninstall command and subkeys',()=>{
  const script=readFileSync(new URL('../native/windows/installer.nsi',import.meta.url),'utf8');
  const init=script.match(/^Function \.onInit\r?\n([\s\S]*?)^FunctionEnd/m)?.[1];
  assert.ok(init);
  const folders=[
    'System::Call \'kernel32::GetFileAttributesW(w "$INSTDIR") i .r0\'',
    'IntCmp $0 -1 check_shortcuts existing_install existing_install',
    'check_shortcuts:',
    'System::Call \'kernel32::GetFileAttributesW(w "$SMPROGRAMS\\${APP_NAME}") i .r0\'',
    'IntCmp $0 -1 check_registration existing_install existing_install',
    'check_registration:'
  ];
  assert.ok(init.includes(folders.join('\n  ')));
  assert.match(init,/check_registration:\s+ClearErrors\s+ReadRegStr \$0 HKCU "\$\{UNINSTALL_KEY\}" "UninstallString"\s+StrCmp \$0 "" registration_subkeys existing_install/);
  assert.match(init,/registration_subkeys:\s+ClearErrors\s+EnumRegKey \$0 HKCU "\$\{UNINSTALL_KEY\}" 0\s+IfErrors new_install existing_install/);
  assert.match(init,/existing_install:\s+MessageBox [^\r\n]+\s+SetErrorLevel 14\s+Quit\s+new_install:\s*$/);
  assert.doesNotMatch(init,/EnumRegValue|DeleteReg(?:Key|Value)/);
});
test('installer is per-user, source startup is opt-in and uninstall has ownership gates',()=>{
  const script=readFileSync(new URL('../native/windows/installer.nsi',import.meta.url),'utf8');
  assert.match(script,/RequestExecutionLevel user/);
  assert.match(script,/StrCmp \$INSTDIR \$1 0 wrong_owner/);
  assert.match(script,/ReadINIStr \$0 .* "Revision"/);
  assert.match(script,/EnumRegKey \$0 HKCU/);
  assert.doesNotMatch(script,/RMDir\s+\/r\b|Delete\s+.*\*|WriteReg\w+ HKLM|Reboot\b/);
  assert.doesNotMatch(script,/WriteReg\w+ .*CurrentVersion\\Run"/);
  assert.match(script,/ReadRegStr .*CurrentVersion\\Run"/);
  assert.match(script,/Call un\.CheckRunning/);
  assert.match(script,/Saved collection data/);
});
