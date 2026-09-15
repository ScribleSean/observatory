import {readFileSync,writeFileSync,existsSync,mkdirSync,readdirSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,sign} from 'node:crypto';
import assert from 'node:assert/strict';
import {stageUpdateHelper} from './stage-update-helper.mjs';
import {installationReceiptSigningBytes} from './signed-receipt.mjs';
import {verifyInstallation} from './verify-installation.mjs';
import {prepareUpdatePayload} from './prepare-update-payload.mjs';
import {stageUpdatePayload} from './stage-update-payload.mjs';

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
const prepared=path.join(output,'signed-update-directory');
prepareUpdatePayload(staged,envelope,publicKey,previous.buildNumber,prepared);
const archive=path.join(output,'signed-update.zip');
const compressed=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
  ['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./create-update-archive.ps1',import.meta.url)),
    '-Directory',prepared,'-Archive',archive],{encoding:'utf8',timeout:120000,maxBuffer:16384,windowsHide:true});
assert.equal(compressed.status,0,compressed.stderr || String(compressed.error));
const expanded=path.join(output,'signed-update-extracted');mkdirSync(expanded);
const extracted=spawnSync(path.join(installed,'WorkspaceObservatory.exe'),
  ['--test-update-extraction',archive,expanded],{encoding:'utf8',timeout:120000,maxBuffer:16384,windowsHide:true});
assert.equal(extracted.status,0,extracted.stderr || String(extracted.error));
const entries=readdirSync(expanded);
assert.equal(entries.length,1);
assert.match(entries[0],/^\.observatory-stage-[a-f0-9]{32}$/);
const ready=stageUpdatePayload(path.join(expanded,entries[0]),installed,previous,publicKey);
assert.equal(ready.sourceRevision,candidate.sourceRevision);
assert.deepEqual(readFileSync(ready.envelopePath),readFileSync(envelope));
console.log(`PASS: complete signed update wrapper ZIP and native extraction verified; ${statSync(archive).size} archive bytes. Synthetic receipt signer only.`);
const helper=stageUpdateHelper(installed,previous,output);
const result=spawnSync(path.join(helper.helper,'WorkspaceObservatory.exe'),
  ['--test-update-install',installed,ready.staged,receiptPath,ready.envelopePath,publicKey,String(previous.buildNumber)],
  // Do not kill the transaction helper on a subprocess timeout.
  {encoding:'utf8',maxBuffer:16384,windowsHide:true});
assert.equal(result.status,0,result.stderr || String(result.error));
const response=JSON.parse(result.stdout);
assert.equal(response.status,'installed-relaunched-and-stopped');
assert.equal(response.SourceRevision,candidate.sourceRevision);
assert.ok(existsSync(path.join(response.Recovery,'previous','WorkspaceObservatory.exe')));
verifyInstallation(installed,candidate);
console.log('PASS: verified external helper replaces a complete installation, preserves recovery, confirms normal dashboard readiness and quits gracefully. Synthetic signer only.');
