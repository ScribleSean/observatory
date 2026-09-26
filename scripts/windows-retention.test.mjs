import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,existsSync,rmSync,cpSync,symlinkSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {retainCandidate} from '../native/windows/retain-candidate.mjs';
import {verifyManifest} from '../native/windows/verify-manifest.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root=realpathSync(mkdtempSync(path.join(tmpdir(),'observatory-retention-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const release=path.join(root,'release'),output=path.join(root,'retained');
  const app=path.join(release,'candidate-one','Workspace Observatory');
  mkdirSync(path.join(app,'Runtime'),{recursive:true});
  const expected={revision:'a'.repeat(40),dirty:false,version:'0.3.13',buildNumber:34};
  const payload=Buffer.from('Synthetic inert package bytes');
  const files=['WorkspaceObservatory.exe','Runtime/node.exe','LICENSE'].map(name=>{
    writeFileSync(path.join(app,name),payload);return {path:name,bytes:payload.length,sha256:digest(payload)};
  });
  const manifest={schema:1,platform:'win-x64',sourceRevision:expected.revision,sourceDirty:false,
    totalBytes:payload.length*files.length,files};
  const manifestBytes=Buffer.from(JSON.stringify(manifest));
  writeFileSync(path.join(app,'package-manifest.json'),manifestBytes);
  const receipts={};
  for(const testIdentity of [false,true]) {
    const identity=testIdentity?'test':'ordinary';
    const artifacts=path.join(release,`installer-${identity}`,'artifacts');
    mkdirSync(artifacts,{recursive:true});
    const installerName=`Workspace-Observatory-${expected.version}-windows-x64${testIdentity?'-TEST':''}-setup.exe`;
    const build={schema:1,version:expected.version,buildNumber:expected.buildNumber,testIdentity,installerName,
      installerSource:{revision:expected.revision,dirty:false},sourceRevision:expected.revision,sourceDirty:false,
      packageManifestSha256:digest(manifestBytes),updateEnvelopeSha256:null};
    const receipt=path.join(artifacts,'installer-build.json');
    const save=()=>writeFileSync(receipt,JSON.stringify(build));save();
    const installer=path.join(artifacts,installerName),bytes=Buffer.from(`Synthetic inert ${identity} installer`);
    writeFileSync(installer,bytes);
    writeFileSync(installer+'.sha256',`${digest(bytes)}  ${installerName}\r\n`);
    writeFileSync(path.join(artifacts,'NSIS-LICENSE.txt'),'Synthetic license');
    receipts[identity]={artifacts,build,receipt,save,installer};
  }
  return {root,release,output,app,expected,manifest,manifestBytes,...receipts,
    run:()=>retainCandidate(release,output,expected)};
}
function rejectsWithoutOutput(f,pattern) {
  assert.throws(f.run,pattern);
  assert.equal(existsSync(f.output),false);
}

test('retention preserves the original identity and stages only the independent package and ordinary allowlist',t=>{
  const f=fixture(t);
  writeFileSync(path.join(f.release,'installer-ordinary','metadata.nsh'),'Synthetic private build path');
  writeFileSync(path.join(f.ordinary.artifacts,'extra.log'),'Synthetic log');
  writeFileSync(path.join(f.release,'candidate-one','windows-update.zip'),'Synthetic installed archive');
  assert.deepEqual(f.run(),{version:f.expected.version,buildNumber:34,sourceRevision:f.expected.revision});
  const retained=path.join(f.output,'installer'),packaged=path.join(f.output,'package');
  assert.deepEqual(readdirSync(f.output).sort(),['installer','package']);
  assert.deepEqual(readdirSync(retained).sort(),[
    f.ordinary.build.installerName,f.ordinary.build.installerName+'.sha256','installer-build.json','NSIS-LICENSE.txt'].sort());
  for(const name of readdirSync(retained))assert.deepEqual(readFileSync(path.join(retained,name)),readFileSync(path.join(f.ordinary.artifacts,name)));
  assert.deepEqual(verifyManifest(packaged),f.manifest);
  assert.deepEqual(verifyManifest(f.app),f.manifest);
  assert.deepEqual(readFileSync(path.join(f.app,'package-manifest.json')),f.manifestBytes);
  assert.deepEqual(readFileSync(path.join(packaged,'package-manifest.json')),f.manifestBytes);
});

test('missing and ambiguous candidates or installer identities fail before staging',t=>{
  for(const mutate of [
    f=>rmSync(path.dirname(f.app),{recursive:true}),
    f=>cpSync(path.dirname(f.app),path.join(f.release,'candidate-two'),{recursive:true}),
    f=>rmSync(path.dirname(f.ordinary.artifacts),{recursive:true}),
    f=>rmSync(path.dirname(f.test.artifacts),{recursive:true}),
    f=>cpSync(path.dirname(f.ordinary.artifacts),path.join(f.release,'installer-duplicate'),{recursive:true}),
    f=>{f.ordinary.build.testIdentity=true;f.ordinary.save();}
  ]) {const f=fixture(t);mutate(f);rejectsWithoutOutput(f,/Expected exactly one/);}
});

test('both receipts must bind the clean full source revision, version, build and exact manifest bytes',t=>{
  for(const identity of ['ordinary','test'])for(const mutate of [
    b=>{b.sourceRevision='b'.repeat(40);},b=>{b.sourceDirty=true;},
    b=>{b.installerSource.revision='b'.repeat(40);},b=>{b.installerSource.dirty=true;},
    b=>{b.version='0.3.14';},b=>{b.buildNumber=35;},b=>{b.packageManifestSha256='c'.repeat(64);},
    b=>{b.installerName='../outside.exe';},b=>{b.extra='Synthetic unexpected content';},
    b=>{b.updateEnvelopeSha256='d'.repeat(64);}
  ]) {
    const f=fixture(t);mutate(f[identity].build);f[identity].save();
    rejectsWithoutOutput(f,/Installer receipt does not match/);
  }
  const f=fixture(t);
  writeFileSync(path.join(f.app,'package-manifest.json'),JSON.stringify(f.manifest,null,2));
  rejectsWithoutOutput(f,/Installer receipt does not match/);
});

test('changed, missing or extra candidate files are rejected by the post-lifecycle manifest check',t=>{
  for(const mutate of [
    f=>writeFileSync(path.join(f.app,'LICENSE'),'Changed bytes'),
    f=>rmSync(path.join(f.app,'LICENSE')),
    f=>writeFileSync(path.join(f.app,'unexpected.txt'),'Extra bytes')
  ]) {const f=fixture(t);mutate(f);rejectsWithoutOutput(f,/Package file/);}
});

test('ordinary installer hashes and required allowlisted files must survive the lifecycle',t=>{
  for(const mutate of [
    f=>writeFileSync(f.ordinary.installer,'Changed installer'),
    f=>writeFileSync(f.ordinary.installer+'.sha256',`${'a'.repeat(64)}  other.exe\n`),
    f=>rmSync(f.ordinary.installer+'.sha256'),
    f=>rmSync(path.join(f.ordinary.artifacts,'NSIS-LICENSE.txt'))
  ]) {const f=fixture(t);mutate(f);rejectsWithoutOutput(f,/checksum mismatch|ENOENT/);}
});

test('linked artifact directories and linked package files cannot enter retention',t=>{
  const f=fixture(t);
  symlinkSync(path.dirname(f.ordinary.artifacts),path.join(f.release,'installer-linked'),process.platform==='win32'?'junction':'dir');
  rejectsWithoutOutput(f,/unlinked artifact directory/);
  const g=fixture(t);
  symlinkSync(path.join(g.app,'Runtime'),path.join(g.app,'linked'),process.platform==='win32'?'junction':'dir');
  rejectsWithoutOutput(g,/Unexpected package path/);
});

test('linked output ancestors cannot stage inside or change the original package',t=>{
  for(const nested of [false,true]) {
    const f=fixture(t),alias=path.join(f.root,'outside-alias');
    symlinkSync(nested?path.dirname(f.app):f.app,alias,process.platform==='win32'?'junction':'dir');
    const output=nested?path.join(alias,'Workspace Observatory','retained'):path.join(alias,'retained');
    const inventory=readdirSync(f.app).sort();
    assert.throws(()=>retainCandidate(f.release,output,f.expected),/outside the original/);
    assert.equal(existsSync(path.join(f.app,'retained')),false);
    assert.deepEqual(readdirSync(f.app).sort(),inventory);
    assert.deepEqual(verifyManifest(f.app),f.manifest);
    assert.deepEqual(readFileSync(path.join(f.app,'package-manifest.json')),f.manifestBytes);
  }
});

test('retention refuses dirty expectations, wrong source and unsafe or previously used destinations',t=>{
  for(const mutate of [f=>{f.expected.dirty=true;},f=>{f.expected.revision='short';},f=>{f.expected.revision='b'.repeat(40);}]) {
    const f=fixture(t);mutate(f);rejectsWithoutOutput(f,/Invalid clean retention identity|Candidate source revision mismatch/);
  }
  const f=fixture(t);mkdirSync(f.output);writeFileSync(path.join(f.output,'sentinel'),'keep');
  assert.throws(f.run,/EEXIST/);assert.equal(readFileSync(path.join(f.output,'sentinel'),'utf8'),'keep');
  assert.throws(()=>retainCandidate(f.release,path.join(f.app,'retained'),f.expected),/outside the original/);
  assert.deepEqual(verifyManifest(f.app),f.manifest);
});

test('CLI rejects a workflow revision that differs from the checked-out source before writing',t=>{
  const f=fixture(t);
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../native/windows/retain-candidate.mjs',import.meta.url)),
    f.release,f.output,'0'.repeat(40)],{encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Retention must match the workflow source revision/);
  assert.equal(existsSync(f.output),false);
});
