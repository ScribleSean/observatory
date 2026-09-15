import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {buildUpdateAppcasts} from '../native/update-appcast.mjs';

function fixture() {
  const release={version:'0.3.2',buildNumber:8,sourceRevision:'a'.repeat(40),publishedAt:'2026-09-13T00:00:00.000Z'};
  const publicKeys={};
  const artifacts=['macos-arm64','windows-x64'].map(platform=>{
    const {publicKey,privateKey}=generateKeyPairSync('ed25519');
    publicKeys[platform]=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
    const data=Buffer.from(`Synthetic ${platform} package. Not an installer.`);
    const suffix=platform==='macos-arm64'?'macos-arm64.zip':'windows-x64-update.zip';
    return {...release,platform,data,sha256:createHash('sha256').update(data).digest('hex'),
      edSignature:sign(null,data,privateKey).toString('base64'),
      url:`https://github.com/ScribleSean/observatory/releases/download/v0.3.2-build.8/Workspace-Observatory-0.3.2-${suffix}`};
  });
  return {release,artifacts,publicKeys};
}
const render=f=>buildUpdateAppcasts(f.release,f.artifacts,f.publicKeys,7);
test('both appcasts use one increasing build and distinct signed platform artifacts',()=>{
  const f=fixture(),feeds=render(f);
  assert.deepEqual(Object.keys(feeds),['macos-arm64','windows-x64']);
  for(const [platform,xml] of Object.entries(feeds)) {
    assert.match(xml,/<sparkle:version>8<\/sparkle:version>/);
    assert.match(xml,/<sparkle:shortVersionString>0.3.2<\/sparkle:shortVersionString>/);
    assert.ok(xml.includes(f.artifacts.find(a=>a.platform===platform).edSignature));
    assert.doesNotMatch(xml,/installerArguments|privateKey|sourceRevision/);
  }
  assert.match(feeds['macos-arm64'],/sparkle:os="macos"/);
  assert.match(feeds['windows-x64'],/sparkle:os="windows-x64"/);
  assert.match(feeds['windows-x64'],/windows-x64-update\.zip/);
  assert.doesNotMatch(feeds['windows-x64'],/setup\.exe/);
});
test('a correctly signed first-install EXE is not an update target',()=>{
  const f=fixture();
  // The digest and signature remain valid for these bytes. Only the route changes.
  f.artifacts[1].url=f.artifacts[1].url.replace('windows-x64-update.zip','windows-x64-setup.exe');
  assert.throws(()=>render(f),/identity or digest mismatch/);
});
test('modified bytes, forged signatures, wrong keys and missing signatures fail closed',()=>{
  for(const mutate of [
    f=>f.artifacts[0].data[0]++,
    f=>{f.artifacts[0].edSignature=Buffer.alloc(64).toString('base64');},
    f=>{f.publicKeys['macos-arm64']=f.publicKeys['windows-x64'];},
    f=>{delete f.artifacts[0].edSignature;},
    f=>{f.publicKeys['macos-arm64']+='\n';},
  ]) {const f=fixture();mutate(f);assert.throws(()=>render(f));}
});
test('mixed revisions, versions, platforms and mutable or foreign URLs are rejected',()=>{
  for(const mutate of [
    f=>{f.artifacts.pop();},f=>{f.artifacts[1]=f.artifacts[0];},
    f=>{f.artifacts[0].sourceRevision='b'.repeat(40);},
    f=>{f.artifacts[0].buildNumber=9;},f=>{f.artifacts[0].version='0.3.1';},
    f=>{f.artifacts[0].url=f.artifacts[0].url.replace('v0.3.2-build.8','latest');},
    f=>{f.artifacts[0].url=f.artifacts[0].url.replace('https:','http:');},
    f=>{f.artifacts[0].url+='?token=private';},
    f=>{f.release.version='0.3.2</title>';},
    f=>{f.release.publishedAt='2026-02-30T00:00:00.000Z';},
  ]) {const f=fixture();mutate(f);assert.throws(()=>render(f));}
});
test('stale releases and invalid previous-build evidence are rejected',()=>{
  const f=fixture();
  for(const previous of [8,9,-1,NaN,undefined,'7'])
    assert.throws(()=>buildUpdateAppcasts(f.release,f.artifacts,f.publicKeys,previous));
});
