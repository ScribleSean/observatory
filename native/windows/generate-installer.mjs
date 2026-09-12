import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {verifyManifest} from './verify-manifest.mjs';
import {sourceState} from '../source-state.mjs';
import {desktopReleaseVersion} from '../release-version.mjs';

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

export function generateInstaller(packageRoot,output,{testIdentity=false}={}) {
  if(!path.isAbsolute(output) || existsSync(output))throw Error('A new absolute installer work directory is required');
  const manifest=verifyManifest(packageRoot,{allowDirty:testIdentity});
  const installerSource=sourceState(fileURLToPath(new URL('../..',import.meta.url)));
  if(!testIdentity && (installerSource.dirty || installerSource.revision!==manifest.sourceRevision))
    throw Error('Release installer source must be clean and match the package revision');
  for(const required of ['WorkspaceObservatory.exe','Runtime/node.exe','LICENSE'])
    if(!manifest.files.some(file=>file.path===required))throw Error('Missing application component');
  const {version}=desktopReleaseVersion();
  const name=testIdentity?'Workspace Observatory Installer Test':'Workspace Observatory';
  const setupId=testIdentity?'WorkspaceObservatoryInstallerTest':'WorkspaceObservatorySetup';
  const installerName=`Workspace-Observatory-${version}-windows-x64${testIdentity?'-TEST':''}-setup.exe`;
  const artifacts=path.join(output,'artifacts');
  const values={APP_NAME:name,SETUP_ID:setupId,APP_VERSION:version,SOURCE_REVISION:manifest.sourceRevision,
    STARTUP_NAME:testIdentity?'WorkspaceObservatoryInstallerTest':'WorkspaceObservatory',
    UNINSTALL_KEY:`Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${setupId}`,
    INSTALLER_OUTPUT:path.join(artifacts,installerName),APP_ICON:fileURLToPath(new URL('telescope.ico',import.meta.url)),
    APP_LICENSE:path.join(packageRoot,'LICENSE')};
  const lists=payloadLists(manifest,packageRoot);
  mkdirSync(output,{recursive:false});
  mkdirSync(artifacts);
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
  writeFileSync(path.join(artifacts,'installer-build.json'),JSON.stringify({schema:1,version,testIdentity,installerName,installerSource,
    sourceRevision:manifest.sourceRevision,sourceDirty:manifest.sourceDirty,
    packageManifestSha256:createHash('sha256').update(readFileSync(path.join(packageRoot,'package-manifest.json'))).digest('hex')},null,2)+'\n');
  return {installerName,testIdentity,sourceRevision:manifest.sourceRevision};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  console.log(JSON.stringify(generateInstaller(process.argv[2],process.argv[3],{testIdentity:process.argv.includes('--test-identity')})));
