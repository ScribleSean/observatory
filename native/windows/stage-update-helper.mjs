import {lstatSync,realpathSync,mkdtempSync,cpSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyInstallation} from './verify-installation.mjs';
import {readReceiptFile} from './verify-candidate.mjs';

export function stageUpdateHelper(installed,previousReceipt,parent) {
  const identity=verifyInstallation(installed,previousReceipt);
  if(typeof parent!=='string' || !path.isAbsolute(parent) || path.resolve(parent)!==realpathSync(parent))
    throw Error('Canonical helper parent required');
  for(let current=parent;;current=path.dirname(current)) {
    const stat=lstatSync(current);
    if(!stat.isDirectory() || stat.isSymbolicLink())throw Error('Unlinked helper parent required');
    if(path.dirname(current)===current)break;
  }
  const relative=path.relative(installed,parent);
  if(relative==='' || (!path.isAbsolute(relative) && relative!=='..' && !relative.startsWith('..'+path.sep)))
    throw Error('Helper must be outside the installed payload');
  const helper=mkdtempSync(path.join(parent,'.observatory-helper-'));
  try {
    cpSync(installed,helper,{recursive:true,dereference:false,errorOnExist:true,force:false});
    const copied=verifyInstallation(helper,previousReceipt);
    if(copied.sourceRevision!==identity.sourceRevision || copied.buildNumber!==identity.buildNumber)
      throw Error('Helper identity changed');
    return Object.freeze({helper,...copied});
  } catch(error) {
    throw Object.assign(new Error('Helper staging failed. Retained for inspection.',{cause:error}),{helper});
  }
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2);
    if(args.length!==3)throw Error('Invalid helper staging arguments');
    const previous=JSON.parse(readReceiptFile(args[1]).toString('utf8'));
    const result=stageUpdateHelper(args[0],previous,args[2]);
    console.log(JSON.stringify({schema:1,status:'helper-staged',...result}));
  } catch {
    console.error('Helper staging failed. No update was activated.');
    process.exitCode=1;
  }
}
