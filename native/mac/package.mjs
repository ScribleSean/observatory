import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync,mkdtempSync,cpSync,symlinkSync,existsSync,realpathSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {sourceState} from '../source-state.mjs';
import {inspectMacPackage,verifyMacPackage} from './inspect-package.mjs';
import {describeArtifact,recordVerifiedZip} from './release-record.mjs';

if(process.platform!=='darwin')throw Error('Mac packaging requires macOS');
const root=fileURLToPath(new URL('../..',import.meta.url));
const option=name=>{const at=process.argv.indexOf(name);return at>=0?process.argv[at+1]:null;};
const bundle=option('--bundle'),output=option('--output');
if(!bundle || !output || !path.isAbsolute(bundle) || !path.isAbsolute(output))throw Error('Use --bundle ABSOLUTE_APP --output ABSOLUTE_NEW_DIRECTORY');
const source=sourceState(root);
if(source.dirty)throw Error('Commit reviewed changes before creating a distribution');
const buildRoots=[root,realpathSync(root),homedir(),tmpdir(),path.dirname(bundle),path.dirname(realpathSync(bundle))];
const manifest=inspectMacPackage(bundle,{revision:source.revision,buildRoots});
const binary=app=>path.join(app,'Contents/MacOS/WorkspaceObservatory');
const check=app=>{
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'inherit',timeout:30000});
  for(const flag of ['--self-test','--test-quota-archive','--test-collector','--test-web','--test-lifecycle'])
    execFileSync(binary(app),[flag],{stdio:'inherit',timeout:40000});
};
check(bundle);
mkdirSync(output,{mode:0o755});
const stage=mkdtempSync(path.join(tmpdir(),'observatory-distribution-'));
const contents=path.join(stage,'contents');
mkdirSync(contents);
const app=path.join(contents,'Workspace Observatory.app');
execFileSync('/usr/bin/ditto',['--norsrc','--noextattr','--noacl',bundle,app],{stdio:'inherit'});
verifyMacPackage(app,manifest,{buildRoots});
cpSync(path.join(root,'native/mac/INSTALL.txt'),path.join(contents,'Read me.txt'));
symlinkSync('/Applications',path.join(contents,'Applications'));
const name=`Workspace-Observatory-${manifest.version}-macos-arm64`;
const zip=path.join(output,name+'.zip');
execFileSync('/usr/bin/ditto',['-c','-k','--norsrc','--noextattr','--noacl','--keepParent',app,zip],{stdio:'inherit',timeout:120000});
const extracted=path.join(stage,'zip-check');
mkdirSync(extracted);
execFileSync('/usr/bin/ditto',['-x','-k',zip,extracted],{stdio:'inherit',timeout:120000});
const extractedApp=path.join(extracted,'Workspace Observatory.app');
verifyMacPackage(extractedApp,manifest,{buildRoots});
check(extractedApp);
const zipArtifact=recordVerifiedZip(output,manifest,zip);
cpSync(path.join(root,'native/mac/INSTALL.txt'),path.join(output,'INSTALL.txt'),{errorOnExist:true,force:false});
console.log('ZIP verified. Independent manifest, checksum and verification receipt saved.');
if(process.argv.includes('--zip-only')) {
  // No image has been created or mounted in this explicitly selected mode.
  rmSync(stage,{recursive:true});
  console.log(JSON.stringify({output,artifacts:[zipArtifact],unpackedBytes:manifest.bytes,
    zipVerification:'passed',dmgVerification:'not-requested',temporaryCopiesRemoved:true}));
  process.exit(0);
}
const dmg=path.join(output,name+'.dmg');
try {
  // hdiutil can remain inside AuthorizationCopyRights after SIGTERM. Creation
  // has not attached our image, so bound this child without touching any mounts.
  // Leave source-volume ownership unchanged. 'off' can attempt a source remount.
  execFileSync('/usr/bin/hdiutil',['create','-srcfolder',contents,'-volname','Workspace Observatory',
    '-format','UDZO','-fs','HFS+','-nospotlight','-srcowners','any',dmg],
  {stdio:'inherit',timeout:120000,killSignal:'SIGKILL'});
} catch(error) {
  console.error('DMG creation failed. The verified ZIP and its receipt remain available; any DMG file is unverified. Temporary copies are preserved.');
  throw error;
}
execFileSync('/usr/bin/hdiutil',['verify',dmg],{stdio:'inherit',timeout:120000});
const mount=path.join(stage,'dmg-check');
mkdirSync(mount);
let mounted=false;
try {
  execFileSync('/usr/bin/hdiutil',['attach',dmg,'-readonly','-nobrowse','-mountpoint',mount],{stdio:'inherit',timeout:60000});
  mounted=true;
  verifyMacPackage(path.join(mount,'Workspace Observatory.app'),manifest,{buildRoots});
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',path.join(mount,'Workspace Observatory.app')],{stdio:'inherit',timeout:30000});
} finally {
  if(mounted || existsSync(path.join(mount,'Workspace Observatory.app')))
    execFileSync('/usr/bin/hdiutil',['detach',mount],{stdio:'inherit',timeout:30000});
}
const artifacts=[zipArtifact,describeArtifact(dmg)];
writeFileSync(path.join(output,'SHA256SUMS.txt'),artifacts.map(asset=>`${asset.sha256}  ${asset.filename}\n`).join(''),{flag:'wx'});
writeFileSync(path.join(output,'release-info.json'),JSON.stringify({platform:manifest.platform,version:manifest.version,
  sourceRevision:manifest.sourceRevision,signing:manifest.signing,unpackedBytes:manifest.bytes,
  checks:['source-clean','privacy-scan','full-file-manifest','nested-signatures','zip-roundtrip','relocated-collector','relocated-webkit','relocated-window-lifecycle','dmg-integrity','mounted-dmg-manifest'],artifacts},null,2)+'\n',{flag:'wx'});
// All mounts have detached successfully. Only this invocation's generated copies
// are removed; the distribution directory and input app remain untouched.
rmSync(stage,{recursive:true});
console.log(JSON.stringify({output,artifacts,unpackedBytes:manifest.bytes,verification:'passed',temporaryCopiesRemoved:true}));
