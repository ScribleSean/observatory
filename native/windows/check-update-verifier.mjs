import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,cpSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import assert from 'node:assert/strict';
import {installationReceiptSigningBytes} from './signed-receipt.mjs';

const executable=process.argv[2];
if(process.platform!=='win32' || !executable || !path.isAbsolute(executable))throw Error('Windows package executable required');
const root=realpathSync(mkdtempSync(path.join(tmpdir(),'observatory-native-update-test-')));
try {
  const staged=path.join(root,'synthetic candidate');mkdirSync(staged);
  const revision='a'.repeat(40),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  // Public build bytes provide real version resources. This copied payload is never launched.
  const payload=readFileSync(executable);
  const manifest=Buffer.from(JSON.stringify({schema:1,platform:'win-x64',sourceRevision:revision,sourceDirty:false,
    totalBytes:payload.length,files:[{path:'WorkspaceObservatory.exe',bytes:payload.length,sha256:hash(payload)}]}));
  const owner=Buffer.from(`[Owner]\nProduct=WorkspaceObservatorySetup\nRevision=${revision}\n`);
  const uninstaller=Buffer.from('Fictional uninstaller. Never execute.');
  for(const [name,bytes] of Object.entries({'WorkspaceObservatory.exe':payload,'package-manifest.json':manifest,
    'installer-owner.ini':owner,'Uninstall.exe':uninstaller}))writeFileSync(path.join(staged,name),bytes);
  const keys=generateKeyPairSync('ed25519');
  const publicKey=keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
  const receipt={schema:1,product:'WorkspaceObservatorySetup',platform:'windows-x64',sourceRevision:revision,
    buildNumber:8,manifestSha256:hash(manifest),ownerSha256:hash(owner),uninstallerSha256:hash(uninstaller)};
  const envelope=path.join(root,'signed receipt.json');
  writeFileSync(envelope,JSON.stringify({receipt,signature:sign(null,installationReceiptSigningBytes(receipt),keys.privateKey).toString('base64')}));
  const run=(key=publicKey,previous='7')=>spawnSync(executable,['--test-update-candidate',staged,envelope,key,previous],
    {encoding:'utf8',timeout:20000,maxBuffer:16384,windowsHide:true,
      env:{...process.env,NODE_OPTIONS:'--require=observatory-must-not-load-this-module'}});
  const good=run();
  assert.equal(good.status,0,good.stderr || String(good.error));
  assert.deepEqual(JSON.parse(good.stdout),{status:'verified',sourceRevision:revision,buildNumber:8});
  const other=generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
  for(const result of [run(other),run(publicKey,'8')])assert.equal(result.status,1,result.stderr);
  if(process.env.GITHUB_ACTIONS==='true' && process.env.RUNNER_ENVIRONMENT==='github-hosted') {
    const installed=path.join(root,'synthetic installed');
    cpSync(staged,installed,{recursive:true});
    const oldUninstaller=Buffer.from('Fictional previous uninstaller. Never execute.');
    writeFileSync(path.join(installed,'Uninstall.exe'),oldUninstaller);
    const previous=path.join(root,'previous receipt.json');
    writeFileSync(previous,JSON.stringify({...receipt,buildNumber:7,uninstallerSha256:hash(oldUninstaller)}));
    const activated=spawnSync(executable,['--test-update-activation',installed,staged,previous,envelope,publicKey,'7'],
      {encoding:'utf8',timeout:30000,maxBuffer:16384,windowsHide:true});
    assert.equal(activated.status,0,activated.stderr || String(activated.error));
    assert.deepEqual(JSON.parse(activated.stdout),{status:'payload-replaced',sourceRevision:revision});
    assert.deepEqual(readFileSync(path.join(installed,'Uninstall.exe')),uninstaller);
    const recoveries=readdirSync(root).filter(name=>name.startsWith('.observatory-update-'));
    assert.equal(recoveries.length,1);
    assert.deepEqual(readFileSync(path.join(root,recoveries[0],'previous','Uninstall.exe')),oldUninstaller);
    // Restore only the synthetic staged fixture for the remaining rejection check.
    cpSync(installed,staged,{recursive:true});
    console.log('PASS: external native activation holds update session and replaces synthetic payload with previous files retained. No app relaunched.');
  } else console.log('SKIP: native activation test requires a disposable hosted Windows runner.');
  writeFileSync(path.join(staged,'WorkspaceObservatory.exe'),'Changed synthetic payload');
  assert.equal(run().status,1);
  assert.deepEqual(readFileSync(path.join(staged,'package-manifest.json')),manifest);
  assert.deepEqual(readFileSync(path.join(staged,'installer-owner.ini')),owner);
  console.log('PASS: packaged native verifier accepts signed inventory and rejects wrong keys, stale builds and changed bytes. Node loader override removed.');
} finally { rmSync(root,{recursive:true,force:true}); }
