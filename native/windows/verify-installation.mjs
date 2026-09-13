import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {verifyManifest} from './verify-manifest.mjs';
import {replacePayload} from './replace-payload.mjs';
import {authenticateInstallationReceipt} from './signed-receipt.mjs';

const digest=data=>createHash('sha256').update(data).digest('hex');
function readRegular(root,name,limit) {
  const file=path.join(root,name),stat=lstatSync(file);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.size>limit)throw Error('Unsafe installation metadata');
  return readFileSync(file);
}

// The candidate receipt must be authenticated independently of these files.
// Comparing a package to a receipt stored inside that same package is not trust.
export function verifyInstallation(root,receipt) {
  if(typeof root!=='string' || !path.isAbsolute(root) || path.resolve(root)!==realpathSync(root))
    throw Error('Canonical installation required');
  for(let current=root;;current=path.dirname(current)) {
    const info=lstatSync(current);
    if(!info.isDirectory() || info.isSymbolicLink())throw Error('Linked installation refused');
    if(path.dirname(current)===current)break;
  }
  if(!receipt || !/^[a-f0-9]{40}$/.test(receipt.sourceRevision) ||
    !Number.isSafeInteger(receipt.buildNumber) || receipt.buildNumber<1 ||
    ['manifestSha256','ownerSha256','uninstallerSha256'].some(key=>!/^[a-f0-9]{64}$/.test(receipt[key])))
    throw Error('Invalid trusted installation receipt');
  const manifest=readRegular(root,'package-manifest.json',4_000_000);
  const owner=readRegular(root,'installer-owner.ini',4096);
  const uninstaller=readRegular(root,'Uninstall.exe',20_000_000);
  if(digest(manifest)!==receipt.manifestSha256 || digest(owner)!==receipt.ownerSha256 ||
    digest(uninstaller)!==receipt.uninstallerSha256)throw Error('Installation receipt mismatch');
  const text=owner[0]===0xff && owner[1]===0xfe?owner.subarray(2).toString('utf16le'):owner.toString('utf8');
  const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
  if(lines.length!==3 || lines[0]!=='[Owner]' || lines[1]!=='Product=WorkspaceObservatorySetup' ||
    lines[2]!==`Revision=${receipt.sourceRevision}`)throw Error('Installer ownership mismatch');
  const verified=verifyManifest(root,{installerFiles:[
    {path:'Uninstall.exe',bytes:uninstaller.length,sha256:receipt.uninstallerSha256},
    {path:'installer-owner.ini',bytes:owner.length,sha256:receipt.ownerSha256},
  ]});
  if(verified.sourceRevision!==receipt.sourceRevision)throw Error('Installation revision mismatch');
  return {sourceRevision:receipt.sourceRevision,buildNumber:receipt.buildNumber};
}

// Caller still owns shutdown, both locks, authenticated receipt selection,
// registration preservation and relaunch. No installer subprocess is executed.
export function replaceVerifiedInstallation({installed,staged,previousReceipt,candidateReceipt}) {
  return replacePayload({installed,staged,verify:(root,kind)=>
    verifyInstallation(root,kind==='previous'?previousReceipt:candidateReceipt)});
}

// The installed receipt and public key must already be trusted locally.
// Authenticate the downloaded receipt before any replacement operation begins.
export function replaceSignedInstallation({installed,staged,previousReceipt,candidateEnvelope,trustedPublicKey}) {
  const previous=verifyInstallation(installed,previousReceipt);
  const candidateReceipt=authenticateInstallationReceipt(candidateEnvelope,trustedPublicKey,previous.buildNumber);
  return replaceVerifiedInstallation({installed,staged,previousReceipt,candidateReceipt});
}
