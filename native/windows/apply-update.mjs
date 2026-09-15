import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readReceiptFile} from './verify-candidate.mjs';
import {replaceSignedInstallation} from './verify-installation.mjs';

// Internal entry point for the trusted external native helper. That caller
// must hold UpdateSession and exclude other writers until this process exits.
// Receipt path and key originate in trusted local configuration, not a feed.
export function applyUpdate(installed,staged,previousReceiptPath,candidateEnvelopePath,trustedPublicKey) {
  const runtime=fileURLToPath(new URL('..',import.meta.url));
  for(const root of [installed,staged]) {
    if(typeof root!=='string' || !path.isAbsolute(root))throw Error('Absolute payload paths required');
    for(const active of [runtime,process.execPath]) {
      const relative=path.relative(root,active);
      if(relative==='' || (!path.isAbsolute(relative) && relative!=='..' && !relative.startsWith('..'+path.sep)))
        throw Error('Replacement helper must execute outside both payloads');
    }
  }
  const previousReceipt=JSON.parse(readReceiptFile(previousReceiptPath).toString('utf8'));
  const candidateEnvelope=readReceiptFile(candidateEnvelopePath);
  const result=replaceSignedInstallation({installed,staged,previousReceipt,candidateEnvelope,trustedPublicKey});
  return {schema:1,status:'payload-replaced',...result};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if(process.argv.length!==7)throw Error('Invalid replacement arguments');
    console.log(JSON.stringify(applyUpdate(...process.argv.slice(2))));
  } catch(error) {
    console.error(JSON.stringify({schema:1,status:'replacement-failed',
      recovery:error.recovery??null,restored:error.restored===true}));
    process.exitCode=1;
  }
}
