import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildUpdateAppcasts} from '../native/update-appcast.mjs';

const tool=process.env.OBSERVATORY_TEST_SPARKLE_TOOL;
test('official Sparkle signing agrees with Node and rejects altered synthetic archives',{
  skip:process.platform!=='darwin'||!tool?'Requires macOS and an explicitly supplied verified Sparkle tool':false,
},()=>{
  assert.ok(path.isAbsolute(tool));
  const root=mkdtempSync(path.join(tmpdir(),'observatory-sparkle-interop-'));
  const file=path.join(root,'synthetic-update.bin'),keyFile=path.join(root,'disposable.key');
  const bytes=Buffer.from('Synthetic Observatory signing fixture, not an application.');
  // Sparkle 2.10 accepts a base64-encoded 32-byte seed through --ed-key-file.
  // Always supply that argument. Never access the login Keychain or real keys.
  const run=args=>{
    const result=spawnSync(tool,['--ed-key-file',keyFile,...args],{
      encoding:'utf8',timeout:15000,maxBuffer:16384,
    });
    assert.ifError(result.error);
    return result;
  };
  try {
    const {publicKey,privateKey}=generateKeyPairSync('ed25519');
    const seed=Buffer.from(privateKey.export({format:'jwk'}).d,'base64url');
    assert.equal(seed.length,32);
    writeFileSync(keyFile,seed.toString('base64'),{flag:'wx',mode:0o600});
    writeFileSync(file,bytes,{flag:'wx',mode:0o600});
    const expected=sign(null,bytes,privateKey).toString('base64');
    const signed=run(['-p',file]);
    assert.equal(signed.status,0,'Sparkle signs using the explicit disposable key');
    assert.equal(signed.stdout.trim(),expected,'Sparkle and Node produce the same signature');
    assert.equal(run(['--verify',file,expected]).status,0);
    writeFileSync(file,Buffer.concat([bytes,Buffer.from('changed')]));
    assert.notEqual(run(['--verify',file,expected]).status,0,'Sparkle rejects changed archive bytes');

    const release={version:'0.3.2',buildNumber:8,sourceRevision:'a'.repeat(40),publishedAt:'2026-09-13T00:00:00.000Z'};
    const artifacts=['macos-arm64','windows-x64'].map(platform=>({...release,platform,data:bytes,
      sha256:createHash('sha256').update(bytes).digest('hex'),edSignature:signed.stdout.trim(),
      url:`https://github.com/ScribleSean/observatory/releases/download/v0.3.2-build.8/Workspace-Observatory-0.3.2-${platform==='macos-arm64'?'macos-arm64.zip':'windows-x64-setup.exe'}`}));
    const publicRaw=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
    assert.equal(Object.keys(buildUpdateAppcasts(release,artifacts,{
      'macos-arm64':publicRaw,'windows-x64':publicRaw,
    },7)).length,2);
  } finally {
    // Delete only this test's unique synthetic directory, including its test key.
    rmSync(root,{recursive:true,force:true});
  }
});
