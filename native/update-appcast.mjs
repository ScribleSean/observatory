import {createHash,createPublicKey,verify} from 'node:crypto';
import {parseReleaseVersion} from './release-version.mjs';

const repository='https://github.com/ScribleSean/workspace-observatory';
const platforms=['macos-arm64','windows-x64'];
function base64(value,bytes) {
  if(typeof value!=='string' || Buffer.from(value,'base64').length!==bytes ||
    Buffer.from(value,'base64').toString('base64')!==value)throw Error('Invalid update signing metadata');
  return Buffer.from(value,'base64');
}

// Artifact bytes must come from the independently verified packaging output.
// Public keys must come from trusted release configuration, not the manifest.
// This checks signatures and metadata, not package contents or OS signatures.
export function buildUpdateAppcasts(release,artifacts,publicKeys,previousBuild) {
  if(!release || typeof release.version!=='string' || !/^[a-f0-9]{40}$/.test(release.sourceRevision))
    throw Error('Invalid release identity');
  const {version,buildNumber}=parseReleaseVersion(`<Version>${release.version}</Version><ObservatoryBuildNumber>${release.buildNumber}</ObservatoryBuildNumber>`);
  if(!Number.isSafeInteger(previousBuild) || previousBuild<0 || buildNumber<=previousBuild)
    throw Error('Update build must advance');
  if(typeof release.publishedAt!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(release.publishedAt) ||
    !Number.isFinite(Date.parse(release.publishedAt)) || new Date(release.publishedAt).toISOString()!==release.publishedAt)
    throw Error('Invalid release timestamp');
  if(!Array.isArray(artifacts) || artifacts.length!==2 ||
    platforms.some(platform=>artifacts.filter(a=>a?.platform===platform).length!==1))
    throw Error('Both release platforms are required exactly once');
  const tag=`v${version}-build.${buildNumber}`;
  const result={};
  for(const platform of platforms) {
    const artifact=artifacts.find(a=>a.platform===platform);
    const suffix=platform==='macos-arm64'?'macos-arm64.zip':'windows-x64-setup.exe';
    const filename=`Workspace-Observatory-${version}-${suffix}`;
    const url=`${repository}/releases/download/${tag}/${filename}`;
    if(artifact.sourceRevision!==release.sourceRevision || artifact.version!==version ||
      artifact.buildNumber!==buildNumber || artifact.url!==url ||
      !Buffer.isBuffer(artifact.data) || artifact.data.length===0 ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      createHash('sha256').update(artifact.data).digest('hex')!==artifact.sha256)
      throw Error('Release artifact identity or digest mismatch');
    const key=createPublicKey({key:Buffer.concat([
      Buffer.from('302a300506032b6570032100','hex'),base64(publicKeys?.[platform],32),
    ]),format:'der',type:'spki'});
    if(!verify(null,artifact.data,key,base64(artifact.edSignature,64)))throw Error('Invalid update signature');
    const os=platform==='macos-arm64'?'macos':'windows-x64';
    const minimum=platform==='macos-arm64'?'14.0.0':'10.0.0';
    result[platform]=`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Workspace Observatory updates</title>
    <link>${repository}</link>
    <description>Verified desktop release downloads</description>
    <item>
      <title>Workspace Observatory ${version}</title>
      <sparkle:version>${buildNumber}</sparkle:version>
      <sparkle:shortVersionString>${version}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>${minimum}</sparkle:minimumSystemVersion>
      <pubDate>${new Date(release.publishedAt).toUTCString()}</pubDate>
      <enclosure url="${url}" sparkle:os="${os}" sparkle:edSignature="${artifact.edSignature}" length="${artifact.data.length}" type="application/octet-stream" />
    </item>
  </channel>
</rss>
`;
  }
  return result;
}
