import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {forbiddenPackageName} from './package-content.mjs';

// Restrict release names to literal, portable Windows paths. In particular, do
// not allow script interpolation, wildcards, device names or alternate streams.
export function validPackagePath(value) {
  return typeof value==='string' && value.length>0 && value.length<220 &&
    value.split('/').every(part=>/^[A-Za-z0-9_][A-Za-z0-9_. +\-]*$/.test(part) &&
      !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) &&
      !forbiddenPackageName(part));
}

export function verifyManifest(root,{allowDirty=false,installerFiles=[]}={}) {
  if(!path.isAbsolute(root) || lstatSync(root).isSymbolicLink())throw Error('An absolute, unlinked package directory is required');
  const manifestPath=path.join(root,'package-manifest.json');
  if(!lstatSync(manifestPath).isFile() || lstatSync(manifestPath).isSymbolicLink())throw Error('Invalid package manifest');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  if(manifest.schema!==1 || manifest.platform!=='win-x64' || !/^[a-f0-9]{40}$/.test(manifest.sourceRevision) ||
    typeof manifest.sourceDirty!=='boolean' || (!allowDirty && manifest.sourceDirty) ||
    !Array.isArray(manifest.files) || manifest.files.length===0)throw Error('Invalid or unreleased package manifest');
  const expected=new Map();
  let total=0;
  for(const file of manifest.files) {
    if(!validPackagePath(file.path) || file.path.toLowerCase()==='package-manifest.json' ||
      expected.has(file.path.toLowerCase()) || !Number.isSafeInteger(file.bytes) || file.bytes<0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid manifest file entry');
    expected.set(file.path.toLowerCase(),file);
    total+=file.bytes;
  }
  if(!Number.isSafeInteger(total) || total!==manifest.totalBytes)throw Error('Manifest byte total mismatch');
  // Installed copies have exactly two NSIS-generated files outside the package
  // manifest. Only a separately verified receipt may provide their digests.
  if(!Array.isArray(installerFiles) || (installerFiles.length!==0 && installerFiles.length!==2))
    throw Error('Invalid installer receipt');
  for(const file of installerFiles) {
    if(!['Uninstall.exe','installer-owner.ini'].includes(file?.path) || expected.has(file.path.toLowerCase()) ||
      !Number.isSafeInteger(file.bytes) || file.bytes<1 || !/^[a-f0-9]{64}$/.test(file.sha256))
      throw Error('Invalid installer receipt');
    expected.set(file.path.toLowerCase(),file);
  }
  const seen=new Set();
  function visit(folder) {
    for(const name of readdirSync(folder)) {
      const absolute=path.join(folder,name);
      const relative=path.relative(root,absolute).split(path.sep).join('/');
      const stat=lstatSync(absolute);
      if(stat.isSymbolicLink() || !validPackagePath(relative))throw Error('Unexpected package path');
      if(stat.isDirectory()){visit(absolute);continue;}
      if(relative==='package-manifest.json')continue;
      const file=expected.get(relative.toLowerCase());
      if(!stat.isFile() || !file || file.path!==relative || seen.has(relative.toLowerCase()) || stat.size!==file.bytes)
        throw Error('Package file inventory mismatch');
      if(createHash('sha256').update(readFileSync(absolute)).digest('hex')!==file.sha256)throw Error('Package file checksum mismatch');
      seen.add(relative.toLowerCase());
    }
  }
  visit(root);
  if(seen.size!==expected.size)throw Error('Package files are missing');
  return manifest;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const manifest=verifyManifest(process.argv[2],{allowDirty:process.argv.includes('--allow-dirty')});
  console.log(JSON.stringify({manifestVerification:'passed',files:manifest.files.length,sourceRevision:manifest.sourceRevision,sourceDirty:manifest.sourceDirty}));
}
