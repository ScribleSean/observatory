import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,sign} from 'node:crypto';
import assert from 'node:assert/strict';
import {stageUpdateHelper} from './stage-update-helper.mjs';
import {installationReceiptSigningBytes} from './signed-receipt.mjs';
import {verifyInstallation} from './verify-installation.mjs';

if(process.platform!=='win32' || process.env.GITHUB_ACTIONS!=='true' || process.env.RUNNER_ENVIRONMENT!=='github-hosted')
  throw Error('Disposable hosted Windows runner required');
const [installed,staged,receiptPath,output]=process.argv.slice(2);
if(process.argv.length!==6 || ![installed,staged,receiptPath,output].every(value=>path.isAbsolute(value)))
  throw Error('Absolute fixture paths required');
const previous=JSON.parse(readFileSync(receiptPath,'utf8'));
const candidate={...previous,buildNumber:previous.buildNumber+1};
verifyInstallation(staged,candidate);
const keys=generateKeyPairSync('ed25519');
const publicKey=keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
const envelope=path.join(output,'synthetic-update-envelope.json');
writeFileSync(envelope,JSON.stringify({receipt:candidate,
  signature:sign(null,installationReceiptSigningBytes(candidate),keys.privateKey).toString('base64')}),{flag:'wx'});
const helper=stageUpdateHelper(installed,previous,output);
const result=spawnSync(path.join(helper.helper,'WorkspaceObservatory.exe'),
  ['--test-update-install',installed,staged,receiptPath,envelope,publicKey,String(previous.buildNumber)],
  // Do not kill the transaction helper on a subprocess timeout.
  {encoding:'utf8',maxBuffer:16384,windowsHide:true});
assert.equal(result.status,0,result.stderr || String(result.error));
const response=JSON.parse(result.stdout);
assert.equal(response.status,'installed-relaunched-and-stopped');
assert.equal(response.SourceRevision,candidate.sourceRevision);
assert.ok(existsSync(path.join(response.Recovery,'previous','WorkspaceObservatory.exe')));
verifyInstallation(installed,candidate);
console.log('PASS: verified external helper replaces a complete installation, preserves recovery, confirms normal dashboard readiness and quits gracefully. Synthetic signer only.');
