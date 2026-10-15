import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';

export function describeArtifact(file) {
  return {filename:path.basename(file),bytes:statSync(file).size,
    sha256:createHash('sha256').update(readFileSync(file)).digest('hex')};
}

export function recordVerifiedZip(output,manifest,zip) {
  const artifact=describeArtifact(zip);
  writeFileSync(path.join(output,'app-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  writeFileSync(path.join(output,'zip-SHA256SUMS.txt'),`${artifact.sha256}  ${artifact.filename}\n`,{flag:'wx'});
  writeFileSync(path.join(output,'zip-verification.json'),JSON.stringify({
    platform:manifest.platform,version:manifest.version,sourceRevision:manifest.sourceRevision,
    signing:manifest.signing,unpackedBytes:manifest.bytes,
    checks:['source-clean','privacy-scan','full-file-manifest','nested-signatures','zip-roundtrip','relocated-collector','relocated-webkit','relocated-window-lifecycle'],
    scope:'ZIP only. Does not establish DMG verification, clean-machine installation or notarization.',
    artifacts:[artifact],
  },null,2)+'\n',{flag:'wx'});
  return artifact;
}
