import {readFileSync,readdirSync,lstatSync,mkdirSync,copyFileSync,writeFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyManifest} from './verify-manifest.mjs';
import {sourceState} from '../source-state.mjs';
import {desktopReleaseVersion} from '../release-version.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function directory(folder) {
  const stat=lstatSync(folder);
  if(!stat.isDirectory() || stat.isSymbolicLink())throw Error('Expected an unlinked artifact directory');
  return folder;
}
function file(filename) {
  const stat=lstatSync(filename);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.size===0)throw Error('Expected a nonempty unlinked artifact file');
  return readFileSync(filename);
}

// Called only after the package, TEST lifecycle and ordinary staging gates pass.
// Stage an explicit allowlist, never installer work files or installed copies.
export function retainCandidate(release,output,{revision,dirty,version,buildNumber}) {
  if(!path.isAbsolute(release) || !path.isAbsolute(output) || dirty!==false ||
    !/^[a-f0-9]{40}$/.test(revision) || !/^\d+\.\d+\.\d+$/.test(version) ||
    !Number.isSafeInteger(buildNumber) || buildNumber<1)throw Error('Invalid clean retention identity');
  // The new directory does not exist yet. Resolve its parent before following any links while staging.
  output=path.join(realpathSync(path.dirname(output)),path.basename(output));
  const relative=path.relative(realpathSync(release),output);
  if(relative!=='..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative))
    throw Error('Retention output must be outside the original release directory');
  const children=readdirSync(directory(release));
  const folders=prefix=>children.filter(name=>name.startsWith(prefix)).map(name=>directory(path.join(release,name)));
  const candidates=folders('candidate-');
  if(candidates.length!==1)throw Error('Expected exactly one original candidate');
  const app=directory(path.join(candidates[0],'Workspace Observatory'));
  const manifest=verifyManifest(app);
  const manifestBytes=file(path.join(app,'package-manifest.json'));
  if(manifest.sourceRevision!==revision)throw Error('Candidate source revision mismatch');
  const receipts=folders('installer-').map(folder=>{
    const artifacts=directory(path.join(folder,'artifacts'));
    const bytes=file(path.join(artifacts,'installer-build.json'));
    return {artifacts,bytes,build:JSON.parse(bytes)};
  });
  const ordinary=receipts.filter(({build})=>build.testIdentity===false);
  const tests=receipts.filter(({build})=>build.testIdentity===true);
  if(receipts.length!==2 || ordinary.length!==1 || tests.length!==1)
    throw Error('Expected exactly one ordinary and one TEST installer receipt');
  const receiptKeys=['schema','version','buildNumber','testIdentity','installerName','installerSource',
    'sourceRevision','sourceDirty','packageManifestSha256','updateEnvelopeSha256'].sort();
  for(const {build} of receipts) {
    const name=`Workspace-Observatory-${version}-windows-x64${build.testIdentity?'-TEST':''}-setup.exe`;
    if(JSON.stringify(Object.keys(build).sort())!==JSON.stringify(receiptKeys) || build.schema!==1 ||
      build.version!==version || build.buildNumber!==buildNumber || build.installerName!==name ||
      build.sourceRevision!==revision || build.sourceDirty!==false ||
      JSON.stringify(Object.keys(build.installerSource??{}).sort())!==JSON.stringify(['dirty','revision']) ||
      build.installerSource.revision!==revision || build.installerSource.dirty!==false ||
      build.packageManifestSha256!==digest(manifestBytes) || build.updateEnvelopeSha256!==null)
      throw Error('Installer receipt does not match the clean unsigned candidate');
  }
  const {artifacts,bytes,build}=ordinary[0];
  const installer=file(path.join(artifacts,build.installerName));
  const checksum=file(path.join(artifacts,build.installerName+'.sha256'));
  if(checksum.toString('utf8').trim()!==`${digest(installer)}  ${build.installerName}`)
    throw Error('Ordinary installer checksum mismatch');
  const license=file(path.join(artifacts,'NSIS-LICENSE.txt'));

  // Refuse an existing destination instead of mixing outputs from different runs.
  mkdirSync(output);
  const retainedInstaller=path.join(output,'installer'),retainedPackage=path.join(output,'package');
  mkdirSync(retainedInstaller);mkdirSync(retainedPackage);
  for(const [name,contents] of [[build.installerName,installer],[build.installerName+'.sha256',checksum],
    ['installer-build.json',bytes],['NSIS-LICENSE.txt',license]])
    writeFileSync(path.join(retainedInstaller,name),contents,{flag:'wx'});
  for(const entry of manifest.files) {
    const destination=path.join(retainedPackage,entry.path);
    mkdirSync(path.dirname(destination),{recursive:true});
    copyFileSync(path.join(app,entry.path),destination);
  }
  writeFileSync(path.join(retainedPackage,'package-manifest.json'),manifestBytes,{flag:'wx'});
  verifyManifest(retainedPackage);
  return {version,buildNumber,sourceRevision:revision};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [release,output,expectedRevision,...extra]=process.argv.slice(2);
  const source=sourceState(fileURLToPath(new URL('../..',import.meta.url)));
  if(extra.length || source.revision!==expectedRevision)throw Error('Retention must match the workflow source revision');
  console.log(JSON.stringify(retainCandidate(release,output,{...source,...desktopReleaseVersion()})));
}
