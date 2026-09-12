import {readFileSync} from 'node:fs';

// One checked-in version source for both app builds and installer names.
// Build numbers must advance for releases, even when the display version stays.
export function parseReleaseVersion(xml) {
  if(typeof xml!=='string' || xml.length>4096)throw Error('Invalid desktop release version');
  const version=[...xml.matchAll(/<Version>([^<]+)<\/Version>/g)];
  const build=[...xml.matchAll(/<ObservatoryBuildNumber>([^<]+)<\/ObservatoryBuildNumber>/g)];
  if(version.length!==1 || build.length!==1 ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version[0][1]) ||
    !/^[1-9]\d*$/.test(build[0][1]))throw Error('Invalid desktop release version');
  const parts=[...version[0][1].split('.').map(Number),Number(build[0][1])];
  if(parts.some(part=>!Number.isSafeInteger(part)||part>65534))throw Error('Desktop version component out of range');
  return {version:version[0][1],buildNumber:parts[3],fileVersion:parts.join('.')};
}

export const desktopReleaseVersion=()=>parseReleaseVersion(readFileSync(new URL('Release.props',import.meta.url),'utf8'));
