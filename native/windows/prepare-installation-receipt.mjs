import {readFileSync,lstatSync,realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {verifyInstallation} from './verify-installation.mjs';
import {installationReceiptSigningBytes} from './signed-receipt.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

// Release tooling only. The caller must run its independently verified installer
// in a controlled staging environment, not point this at a downloaded directory.
// build comes from that trusted build pipeline, never from the staged payload.
// The result is unsigned and does not confer trust until the release signer
// approves these exact bytes. This function never accesses signing keys.
export function prepareInstallationReceipt(root,build) {
  if(!build || build.schema!==1 || build.testIdentity!==false || build.sourceDirty!==false ||
    !Number.isSafeInteger(build.buildNumber) || build.buildNumber<1 ||
    typeof build.sourceRevision!=='string' || !/^[a-f0-9]{40}$/.test(build.sourceRevision) ||
    !/^[a-f0-9]{64}$/.test(build.packageManifestSha256 ?? '') ||
    build.installerSource?.dirty!==false || build.installerSource?.revision!==build.sourceRevision)
    throw Error('Trusted clean installer build metadata required');
  if(typeof root!=='string' || !path.isAbsolute(root) || path.resolve(root)!==realpathSync(root))
    throw Error('Canonical staged installation required');
  for(let current=root;;current=path.dirname(current)) {
    const stat=lstatSync(current);
    if(!stat.isDirectory() || stat.isSymbolicLink())throw Error('Linked staging directory refused');
    if(path.dirname(current)===current)break;
  }
  const hashFile=(name,limit)=>{
    const file=path.join(root,name),stat=lstatSync(file);
    if(!stat.isFile() || stat.isSymbolicLink() || stat.size<1 || stat.size>limit)
      throw Error('Invalid staged installation metadata');
    return digest(readFileSync(file));
  };
  const manifestSha256=hashFile('package-manifest.json',4_000_000);
  if(manifestSha256!==build.packageManifestSha256)throw Error('Staged manifest differs from trusted build');
  const receipt={schema:1,product:'WorkspaceObservatorySetup',platform:'windows-x64',
    sourceRevision:build.sourceRevision,buildNumber:build.buildNumber,manifestSha256,
    ownerSha256:hashFile('installer-owner.ini',4096),uninstallerSha256:hashFile('Uninstall.exe',20_000_000)};
  // Reuse the actual updater's full file inventory and owner verification.
  verifyInstallation(root,receipt);
  installationReceiptSigningBytes(receipt);
  return Object.freeze(receipt);
}

export function writeInstallationSigningRequest(root,build,output) {
  if(typeof output!=='string' || !path.isAbsolute(output) || path.resolve(output)!==output ||
    realpathSync(path.dirname(output))!==path.dirname(output))throw Error('Canonical new signing output directory required');
  const relative=path.relative(root,output);
  if(!relative || (!relative.startsWith('..'+path.sep) && !path.isAbsolute(relative)))
    throw Error('Signing output must be outside the staged installation');
  const receipt=prepareInstallationReceipt(root,build);
  mkdirSync(output,{mode:0o700});
  writeFileSync(path.join(output,'installation-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  writeFileSync(path.join(output,'installation-receipt.signing-bytes'),installationReceiptSigningBytes(receipt),{flag:'wx',mode:0o600});
  return receipt;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==5)throw Error('Expected staged installation, trusted installer-build.json and new output directory');
  const metadata=process.argv[3],stat=lstatSync(metadata);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.size>65536)throw Error('Invalid installer build metadata file');
  const build=JSON.parse(readFileSync(metadata,'utf8'));
  const receipt=writeInstallationSigningRequest(process.argv[2],build,process.argv[4]);
  console.log(JSON.stringify({prepared:'unsigned-installation-receipt',sourceRevision:receipt.sourceRevision,buildNumber:receipt.buildNumber}));
}
