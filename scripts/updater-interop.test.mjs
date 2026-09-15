import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildUpdateAppcasts} from '../native/update-appcast.mjs';

const tool=process.env.OBSERVATORY_TEST_WINSPARKLE_TOOL;
test('official WinSparkle and the feed renderer agree on signatures and reject changed bytes',{
  skip:!tool?'Set OBSERVATORY_TEST_WINSPARKLE_TOOL to a verified upstream tool':false,
},()=>{
  assert.ok(path.isAbsolute(tool));
  const root=mkdtempSync(path.join(tmpdir(),'observatory-signing-test-'));
  const file=path.join(root,'synthetic-update.bin');
  const keyFile=path.join(root,'disposable-test.key');
  const bytes=Buffer.from('Synthetic Observatory interoperability fixture. Not an application.');
  const run=args=>{
    const result=spawnSync(tool,args,{encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:16384});
    assert.ifError(result.error);
    return result;
  };
  try {
    writeFileSync(file,bytes,{flag:'wx',mode:0o600});
    const {publicKey,privateKey}=generateKeyPairSync('ed25519');
    const publicRaw=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
    const signature=sign(null,bytes,privateKey).toString('base64');
    const verifyArgs=['verify','--public-key',publicRaw,'--signature',signature,file];
    assert.equal(run(verifyArgs).status,0,'Upstream accepts Node Ed25519 signature');
    writeFileSync(file,Buffer.concat([bytes,Buffer.from('changed')]));
    assert.notEqual(run(verifyArgs).status,0,'Upstream rejects modified bytes');
    writeFileSync(file,bytes);

    // These keys exist only in this temporary test directory and are never used
    // for a production feed, imported into a keychain or printed to test logs.
    const generated=run(['generate-key','--file',keyFile]);
    assert.equal(generated.status,0,'Upstream test key generation succeeds');
    const upstreamPublic=generated.stdout.match(/Public key:\s*([A-Za-z0-9+/]{43}=)/)?.[1];
    assert.ok(upstreamPublic,'Upstream returned a public verification key');
    const signed=run(['sign','--private-key-file',keyFile,file]);
    assert.equal(signed.status,0,'Upstream signing succeeds');
    const upstreamSignature=signed.stdout.trim();
    const release={version:'0.3.2',buildNumber:8,sourceRevision:'a'.repeat(40),publishedAt:'2026-09-13T00:00:00.000Z'};
    const artifacts=['macos-arm64','windows-x64'].map(platform=>({...release,platform,data:bytes,
      sha256:createHash('sha256').update(bytes).digest('hex'),edSignature:upstreamSignature,
      url:`https://github.com/ScribleSean/observatory/releases/download/v0.3.2-build.8/Workspace-Observatory-0.3.2-${platform==='macos-arm64'?'macos-arm64.zip':'windows-x64-update.zip'}`}));
    const keys={'macos-arm64':upstreamPublic,'windows-x64':upstreamPublic};
    assert.equal(Object.keys(buildUpdateAppcasts(release,artifacts,keys,7)).length,2);
    artifacts[0].data=Buffer.from('Changed but rehashed fixture');
    artifacts[0].sha256=createHash('sha256').update(artifacts[0].data).digest('hex');
    assert.throws(()=>buildUpdateAppcasts(release,artifacts,keys,7),/Invalid update signature/);
  } finally {
    // Only the unique test directory created above is removed.
    rmSync(root,{recursive:true,force:true});
  }
});
