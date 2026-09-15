import {readdirSync,lstatSync,realpathSync,mkdtempSync,cpSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {authenticateInstallationReceipt} from './signed-receipt.mjs';
import {readReceiptFile} from './verify-candidate.mjs';
import {verifyInstallation} from './verify-installation.mjs';

// Call through trusted code after bounded extraction. Caller holds installation
// exclusion and supplies the independent installed receipt and pinned public key.
// No candidate code runs here, and the current installation is never modified.
export function stageUpdatePayload(extracted,installed,previousReceipt,publicKey) {
  const previous=verifyInstallation(installed,previousReceipt);
  if(typeof extracted!=='string' || !path.isAbsolute(extracted) || path.resolve(extracted)!==extracted || realpathSync(extracted)!==extracted)
    throw Error('Canonical extracted directory required');
  for(let current=extracted;;current=path.dirname(current)) {
    const stat=lstatSync(current);
    if(!stat.isDirectory() || stat.isSymbolicLink())throw Error('Unlinked extracted directory required');
    if(path.dirname(current)===current)break;
  }
  if(readdirSync(extracted).sort().join('\n')!=='installation-envelope.json\npayload')
    throw Error('Unexpected update package entries');
  const envelopePath=path.join(extracted,'installation-envelope.json');
  const receipt=authenticateInstallationReceipt(readReceiptFile(envelopePath),publicKey,previous.buildNumber);
  const payload=path.join(extracted,'payload');
  const identity=verifyInstallation(payload,receipt);
  const parent=path.dirname(installed),relative=path.relative(extracted,parent);
  if(relative==='' || (!path.isAbsolute(relative) && relative!=='..' && !relative.startsWith('..'+path.sep)))
    throw Error('Installation parent must be outside the extracted package');
  const staged=mkdtempSync(path.join(parent,'.observatory-candidate-'));
  try {
    cpSync(payload,staged,{recursive:true,dereference:false,force:false,errorOnExist:true});
    verifyInstallation(staged,receipt);
    return Object.freeze({staged,envelopePath,...identity});
  } catch(error) {
    throw Object.assign(new Error('Update staging failed. Candidate retained for inspection.',{cause:error}),{staged});
  }
}

// Internal command for the installed runtime. The caller must hold installation
// exclusion and obtain the previous receipt and key from trusted local state.
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2);
    if(args.length!==4)throw Error('Invalid staging arguments');
    const previous=JSON.parse(readReceiptFile(args[2]).toString('utf8'));
    const result=stageUpdatePayload(args[0],args[1],previous,args[3]);
    console.log(JSON.stringify({schema:1,status:'payload-staged',...result}));
  } catch {
    console.error('Update staging failed. No update was activated.');
    process.exitCode=1;
  }
}
