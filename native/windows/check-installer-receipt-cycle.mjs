import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync,cpSync,rmSync,realpathSync} from 'node:fs';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {generateInstaller} from './generate-installer.mjs';
import {desktopReleaseVersion} from '../release-version.mjs';
import {installationReceiptSigningBytes,authenticateInstallationReceipt} from './signed-receipt.mjs';
import {verifyInstallation} from './verify-installation.mjs';

if(process.platform!=='win32')throw Error('Windows test host required');
const archive=process.argv[2],asset=JSON.parse(readFileSync(new URL('installer-tool.json',import.meta.url)));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
if(!archive || !path.isAbsolute(archive) || digest(readFileSync(archive))!==asset.sha256)throw Error('Pinned NSIS archive required');
const name='Workspace Observatory Installer Test';
const installed=path.join(process.env.LOCALAPPDATA,'Programs',name);
const data=path.join(process.env.LOCALAPPDATA,name);
const shortcuts=path.join(process.env.APPDATA,'Microsoft/Windows/Start Menu/Programs',name);
for(const location of [installed,data,shortcuts])if(existsSync(location))throw Error('Existing test state must be inspected: '+location);
const run=(exe,args,options={})=>{
  const result=spawnSync(exe,args,{encoding:'utf8',timeout:120000,maxBuffer:1024*1024,windowsHide:true,...options});
  assert.equal(result.status,0,result.stdout+result.stderr+String(result.error??''));
  return result.stdout;
};
const ps=code=>run('powershell.exe',['-NoProfile','-Command',code]);
ps("if (Test-Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WorkspaceObservatoryInstallerTest') { throw 'Existing test registration' }");
const scratch=realpathSync(mkdtempSync(path.join(tmpdir(),'observatory-full-receipt-cycle-')));
const quote=text=>"'"+text.replaceAll("'","''")+"'";
ps(`Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(path.join(scratch,'compiler'))}`);
const compiler=path.join(scratch,'compiler','nsis-3.12','makensis.exe');
const app=path.join(scratch,'payload');mkdirSync(app);mkdirSync(path.join(app,'Runtime'));
const bytes=Buffer.from('Synthetic inert payload. Never execute.');
const files=['LICENSE','Runtime/node.exe','WorkspaceObservatory.exe'].map(file=>{
  writeFileSync(path.join(app,file),bytes);return {path:file,bytes:bytes.length,sha256:digest(bytes)};
});
const manifest=Buffer.from(JSON.stringify({schema:1,platform:'win-x64',sourceRevision:'a'.repeat(40),sourceDirty:false,
  totalBytes:bytes.length*files.length,files}));
writeFileSync(path.join(app,'package-manifest.json'),manifest);
const compile=(folder,envelope,publicKey)=>{
  generateInstaller(app,folder,{testIdentity:true,installationEnvelope:envelope,updatePublicKey:publicKey});
  run(compiler,['/NOCONFIG','/WX','/V2','installer.nsi'],{cwd:folder});
  const build=JSON.parse(readFileSync(path.join(folder,'artifacts','installer-build.json')));
  return path.join(folder,'artifacts',build.installerName);
};
let generation=0;
const uninstall=()=>{
  const copy=path.join(scratch,`uninstall-${++generation}.exe`);
  cpSync(path.join(installed,'Uninstall.exe'),copy);
  // NSIS requires _?= to be last and unquoted, including a directory with spaces.
  run(copy,['/S','_?='+installed],{windowsVerbatimArguments:true});
  assert.equal(existsSync(installed),false);
  assert.equal(existsSync(shortcuts),false);
};
const first=compile(path.join(scratch,'first'),null,null);
run(first,['/S']);
const owner=readFileSync(path.join(installed,'installer-owner.ini'));
const uninstaller=readFileSync(path.join(installed,'Uninstall.exe'));
const receipt={schema:1,product:'WorkspaceObservatorySetup',platform:'windows-x64',sourceRevision:'a'.repeat(40),
  buildNumber:desktopReleaseVersion().buildNumber,manifestSha256:digest(manifest),ownerSha256:digest(owner),uninstallerSha256:digest(uninstaller)};
const keys=generateKeyPairSync('ed25519');
const publicKey=keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
const envelope=Buffer.from(JSON.stringify({receipt,signature:sign(null,installationReceiptSigningBytes(receipt),keys.privateKey).toString('base64')}));
const envelopeFile=path.join(scratch,'envelope.json');writeFileSync(envelopeFile,envelope);
uninstall();
const second=compile(path.join(scratch,'second'),envelopeFile,publicKey);
run(second,['/S']);
assert.deepEqual(readFileSync(path.join(installed,'installer-owner.ini')),owner);
assert.deepEqual(readFileSync(path.join(installed,'Uninstall.exe')),uninstaller);
assert.deepEqual(readFileSync(path.join(installed,'package-manifest.json')),manifest);
for(const file of files)assert.equal(digest(readFileSync(path.join(installed,file.path))),file.sha256);
const provisioned=readFileSync(path.join(data,'updates','installed-envelope.json'));
assert.deepEqual(provisioned,envelope);
assert.deepEqual(authenticateInstallationReceipt(provisioned,publicKey,0),receipt);
// The fixture must never become eligible for production activation.
assert.throws(()=>verifyInstallation(realpathSync(installed),receipt),/ownership mismatch/);
uninstall();
assert.deepEqual(readFileSync(path.join(data,'updates','installed-envelope.json')),envelope);
rmSync(data,{recursive:true});
ps("if (Test-Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WorkspaceObservatoryInstallerTest') { throw 'Test registration remained' }");
console.log(JSON.stringify({status:'passed',ownerSha256:receipt.ownerSha256,uninstallerSha256:receipt.uninstallerSha256,
  evidence:scratch,scope:'Full TEST-identity template, synthetic payload. Production identity remains rejected.'}));
