import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {verifyManifest} from './verify-manifest.mjs';
import {sourceState} from '../source-state.mjs';
import {desktopReleaseVersion} from '../release-version.mjs';
import {authenticateInstallationReceipt} from './signed-receipt.mjs';
import {readReceiptFile} from './verify-candidate.mjs';

export function validateInstallerEnvelope(bytes,publicKey,manifest,manifestBytes,buildNumber) {
  const receipt=authenticateInstallationReceipt(bytes,publicKey,0);
  if(receipt.sourceRevision!==manifest.sourceRevision || receipt.buildNumber!==buildNumber ||
    receipt.manifestSha256!==createHash('sha256').update(manifestBytes).digest('hex'))
    throw Error('Installer receipt does not match the verified package and release build');
  return receipt;
}

export function nsisLiteral(value) {
  if(typeof value!=='string' || /[\r\n\0]/.test(value))throw Error('Invalid installer literal');
  return value.replaceAll('$',()=>'$$').replaceAll('"',()=>'$\\"');
}

export function payloadLists(manifest,packageRoot) {
  const files=[...manifest.files.map(row=>row.path),'package-manifest.json'];
  if(files.some(file=>/^(uninstall\.exe|installer-owner\.ini)$/i.test(file)))throw Error('Reserved installer file');
  const directories=new Set();
  for(const file of files) {
    let parent=path.posix.dirname(file);
    while(parent!=='.'){directories.add(parent);parent=path.posix.dirname(parent);}
  }
  const slash=value=>value.replaceAll('/','\\');
  const install=files.map(file=>{
    const parent=path.posix.dirname(file);
    return `SetOutPath "$INSTDIR${parent==='.'?'':'\\'+slash(parent)}"\nIfErrors install_failed\n`+
      `File "/oname=${path.posix.basename(file)}" "${nsisLiteral(path.join(packageRoot,...file.split('/')))}"\nIfErrors install_failed`;
  }).join('\n');
  const uninstall=files.map(file=>`Delete "$INSTDIR\\${slash(file)}"\nIfErrors uninstall_failed`).join('\n');
  const sorted=[...directories].sort((a,b)=>b.split('/').length-a.split('/').length||a.localeCompare(b));
  return {install,uninstall,
    checks:sorted.map(dir=>`Push "$INSTDIR\\${slash(dir)}"\nCall un.NoLinkedPath`).join('\n'),
    directories:sorted.map(dir=>`RMDir "$INSTDIR\\${slash(dir)}"`).join('\n')};
}

export function generateInstaller(packageRoot,output,{testIdentity=false,installationEnvelope=null,updatePublicKey=null}={}) {
  if(!path.isAbsolute(output) || existsSync(output))throw Error('A new absolute installer work directory is required');
  const manifest=verifyManifest(packageRoot,{allowDirty:testIdentity});
  const installerSource=sourceState(fileURLToPath(new URL('../..',import.meta.url)));
  if(!testIdentity && (installerSource.dirty || installerSource.revision!==manifest.sourceRevision))
    throw Error('Release installer source must be clean and match the package revision');
  for(const required of ['WorkspaceObservatory.exe','Runtime/node.exe','LICENSE'])
    if(!manifest.files.some(file=>file.path===required))throw Error('Missing application component');
  const {version,buildNumber}=desktopReleaseVersion();
  if(Boolean(installationEnvelope)!==Boolean(updatePublicKey))throw Error('Receipt envelope and trusted public key must be supplied together');
  const envelope=installationEnvelope?readReceiptFile(installationEnvelope):null;
  if(envelope)validateInstallerEnvelope(envelope,updatePublicKey,manifest,readFileSync(path.join(packageRoot,'package-manifest.json')),buildNumber);
  const name=testIdentity?'Workspace Observatory Installer Test':'Workspace Observatory';
  const setupId=testIdentity?'WorkspaceObservatoryInstallerTest':'WorkspaceObservatorySetup';
  const installerName=`Workspace-Observatory-${version}-windows-x64${testIdentity?'-TEST':''}-setup.exe`;
  const artifacts=path.join(output,'artifacts');
  const values={APP_NAME:name,SETUP_ID:setupId,APP_VERSION:version,SOURCE_REVISION:manifest.sourceRevision,
    STARTUP_NAME:testIdentity?'WorkspaceObservatoryInstallerTest':'WorkspaceObservatory',
    UNINSTALL_KEY:`Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${setupId}`,
    INSTALLER_OUTPUT:path.join(artifacts,installerName),APP_ICON:fileURLToPath(new URL('telescope.ico',import.meta.url)),
    APP_LICENSE:path.join(packageRoot,'LICENSE')};
  if(envelope) {
    values.UPDATE_ENVELOPE=path.join(output,'installer-update-envelope.json');
    values.UPDATE_DATA_NAME=name;
  }
  const lists=payloadLists(manifest,packageRoot);
  mkdirSync(output,{recursive:false});
  mkdirSync(artifacts);
  if(envelope)writeFileSync(values.UPDATE_ENVELOPE,envelope,{flag:'wx'});
  copyFileSync(new URL('installer.nsi',import.meta.url),path.join(output,'installer.nsi'));
  writeFileSync(path.join(output,'metadata.nsh'),Object.entries(values).map(([key,value])=>`!define ${key} "${nsisLiteral(value)}"`).join('\n')+'\n');
  for(const [name,contents] of Object.entries({'install-files.nsh':lists.install,'uninstall-files.nsh':lists.uninstall,
    'check-uninstall-paths.nsh':lists.checks,'remove-empty-folders.nsh':lists.directories}))writeFileSync(path.join(output,name),contents+'\n');
  const strings=['DisplayName','DisplayVersion','Publisher','InstallLocation','DisplayIcon','UninstallString','QuietUninstallString'];
  const numbers=['NoModify','NoRepair'];
  const remove=[...strings,...numbers].map((key,index)=>
    `ClearErrors\n${numbers.includes(key)?'ReadRegDWORD':'ReadRegStr'} $0 HKCU "\${UNINSTALL_KEY}" "${key}"\nIfErrors registration_${index}\n`+
    `DeleteRegValue HKCU "\${UNINSTALL_KEY}" "${key}"\nIfErrors uninstall_failed\nregistration_${index}:`).join('\n')+
    '\nClearErrors\nDeleteRegKey /ifempty HKCU "${UNINSTALL_KEY}"\nClearErrors\n';
  writeFileSync(path.join(output,'remove-registration.nsh'),remove);
  writeFileSync(path.join(artifacts,'installer-build.json'),JSON.stringify({schema:1,version,buildNumber,testIdentity,installerName,installerSource,
    sourceRevision:manifest.sourceRevision,sourceDirty:manifest.sourceDirty,
    packageManifestSha256:createHash('sha256').update(readFileSync(path.join(packageRoot,'package-manifest.json'))).digest('hex'),
    updateEnvelopeSha256:envelope?createHash('sha256').update(envelope).digest('hex'):null},null,2)+'\n');
  return {installerName,testIdentity,sourceRevision:manifest.sourceRevision};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),testIdentity=args[2]==='--test-identity';
  const remaining=args.slice(testIdentity?3:2);
  if(args.length<2 || (remaining.length!==0 && (remaining.length!==3 || remaining[0]!=='--update-envelope')))
    throw Error('Invalid installer generation arguments');
  console.log(JSON.stringify(generateInstaller(args[0],args[1],{testIdentity,
    installationEnvelope:remaining[1]??null,updatePublicKey:remaining[2]??null})));
}
