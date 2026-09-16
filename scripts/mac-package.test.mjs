import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {inspectMacPackage,verifyMacPackage} from '../native/mac/inspect-package.mjs';
import {recordVerifiedZip} from '../native/mac/release-record.mjs';
import {createHash} from 'node:crypto';

test('DMG creation leaves source ownership unchanged and bounds the child',()=>{
  const source=readFileSync(new URL('../native/mac/package.mjs',import.meta.url),'utf8');
  assert.match(source,/'-srcowners','any'/);
  assert.doesNotMatch(source,/'-srcowners','(?:off|on)'/);
  assert.match(source,/timeout:120000,killSignal:'SIGKILL'/);
});

function fixture(run) {
  const folder=mkdtempSync(path.join(tmpdir(),'observatory-mac-package-'));
  const bundle=path.join(folder,'Workspace Observatory.app'),revision='a'.repeat(40);
  const files=['Contents/MacOS/WorkspaceObservatory','Contents/Info.plist',
    'Contents/Resources/LICENSE','Contents/Resources/THIRD-PARTY-NOTICES.md',
    'Contents/Resources/Web/index.html','Contents/Resources/Web/assets/third-party-licenses.txt',
    'Contents/Resources/Runtime/node/bin/node','Contents/Resources/Runtime/node/LICENSE',
    'Contents/Resources/Runtime/python/bin/python3.13','Contents/Resources/Runtime/python/licenses/LICENSE.cpython.txt',
    'Contents/Resources/Collector/scripts/run-collector.py','Contents/Resources/Collector/scripts/collect-mac.mjs',
    'Contents/_CodeSignature/CodeResources'];
  for(const name of files) {
    mkdirSync(path.dirname(path.join(bundle,name)),{recursive:true});
    writeFileSync(path.join(bundle,name),'fixture');
  }
  const info=path.join(bundle,'Contents/Resources/build-info.json');
  writeFileSync(info,JSON.stringify({sourceRevision:revision,sourceDirty:false,version:'0.3.0'}));
  try{run({bundle,revision,info});}finally{rmSync(folder,{recursive:true,force:true});}
}

test('Mac package manifest covers exact content and detects changed or added files',()=>{
  fixture(({bundle,revision})=>{
    const manifest=inspectMacPackage(bundle,{revision});
    assert.equal(manifest.fileCount,14);
    assert.deepEqual(verifyMacPackage(bundle,manifest),manifest);
    const file=path.join(bundle,'Contents/Resources/LICENSE'),original=readFileSync(file);
    writeFileSync(file,'changed');assert.throws(()=>verifyMacPackage(bundle,manifest),/does not match/);
    writeFileSync(file,original);
    writeFileSync(path.join(bundle,'extra.txt'),'extra');
    assert.throws(()=>verifyMacPackage(bundle,manifest),/does not match/);
  });
});

test('Mac packages require clean matching source and distribution notices',()=>{
  fixture(({bundle,revision,info})=>{
    assert.throws(()=>inspectMacPackage(bundle,{revision:'b'.repeat(40)}),/matching clean-source/);
    writeFileSync(info,JSON.stringify({sourceRevision:revision,sourceDirty:true,version:'0.3.0'}));
    assert.throws(()=>inspectMacPackage(bundle),/clean-source/);
    writeFileSync(info,JSON.stringify({sourceRevision:revision,sourceDirty:false,version:'0.3.0'}));
    rmSync(path.join(bundle,'Contents/Resources/LICENSE'));
    assert.throws(()=>inspectMacPackage(bundle),/Required package file missing/);
  });
});

test('Mac package inspection rejects private filenames and encoded build paths',()=>{
  fixture(({bundle})=>{
    const privateFile=path.join(bundle,'usage.json');writeFileSync(privateFile,'{}');
    assert.throws(()=>inspectMacPackage(bundle),/Private/);rmSync(privateFile);
    writeFileSync(path.join(bundle,'Contents/Resources/LICENSE'),Buffer.from('/fixture/private/build','utf16le'));
    assert.throws(()=>inspectMacPackage(bundle,{buildRoots:['/fixture/private/build']}),/Build path/);
  });
});

test('Mac package inspection rejects private quota and repair directories and journal fragments',()=>{
  fixture(({bundle})=>{
    const resources=path.join(bundle,'Contents/Resources');
    for(const name of ['private-quota','private-repair']) {
      const directory=path.join(resources,name);
      mkdirSync(directory);
      writeFileSync(path.join(directory,'orphan.txt'),'synthetic private canary');
      assert.throws(()=>inspectMacPackage(bundle),/Private/);
      rmSync(directory,{recursive:true});
    }
    const journal=path.join(resources,'state.sqlite-journal');
    writeFileSync(journal,'synthetic private canary');
    assert.throws(()=>inspectMacPackage(bundle),/Private/);
  });
});

test('Mac package links must remain inside the app and match the manifest', {skip:process.platform==='win32'},()=>{
  fixture(({bundle})=>{
    const link=path.join(bundle,'Contents/Resources/Runtime/python/bin/python3');
    symlinkSync('python3.13',link);
    const manifest=inspectMacPackage(bundle);
    assert.equal(manifest.symlinks.length,1);
    rmSync(link);assert.throws(()=>verifyMacPackage(bundle,manifest),/does not match/);
    symlinkSync(process.execPath,link);assert.throws(()=>inspectMacPackage(bundle),/escapes/);
  });
});

test('independent ZIP receipts contain exact hashes, exclude DMG claims and refuse overwrite',()=>{
  fixture(({bundle})=>{
    const output=path.dirname(bundle),zip=path.join(output,'fixture.zip');
    const bytes=Buffer.from('synthetic archive');
    writeFileSync(zip,bytes);
    const manifest=inspectMacPackage(bundle);
    const artifact=recordVerifiedZip(output,manifest,zip);
    assert.equal(artifact.sha256,createHash('sha256').update(bytes).digest('hex'));
    assert.equal(artifact.bytes,bytes.length);
    assert.equal(artifact.filename,'fixture.zip');
    const receipt=JSON.parse(readFileSync(path.join(output,'zip-verification.json'),'utf8'));
    assert.deepEqual(receipt.artifacts,[artifact]);
    assert.equal(receipt.checks.some(check=>check.includes('dmg')),false);
    assert.match(receipt.scope,/ZIP only/);
    assert.equal(readFileSync(path.join(output,'zip-SHA256SUMS.txt'),'utf8'),`${artifact.sha256}  fixture.zip\n`);
    assert.deepEqual(JSON.parse(readFileSync(path.join(output,'app-manifest.json'),'utf8')),manifest);
    assert.throws(()=>recordVerifiedZip(output,manifest,zip),/EEXIST/);
  });
});

test('Mac packages with Sparkle require its runtime and retained license',()=>{
  fixture(({bundle,info})=>{
    writeFileSync(info,JSON.stringify({...JSON.parse(readFileSync(info)),updaterVersion:'2.10.0'}));
    assert.throws(()=>inspectMacPackage(bundle),/Required Sparkle file missing/);
    const paths=['Contents/Frameworks/Sparkle.framework/Versions/B/Sparkle',
      'Contents/Frameworks/Sparkle.framework/Versions/B/Autoupdate',
      'Contents/Frameworks/Sparkle.framework/Versions/B/Resources/Info.plist',
      'Contents/Resources/Sparkle-LICENSE.txt'];
    for(const name of paths) {
      mkdirSync(path.dirname(path.join(bundle,name)),{recursive:true});
      writeFileSync(path.join(bundle,name),'synthetic Sparkle');
    }
    const manifest=inspectMacPackage(bundle);
    assert.deepEqual(verifyMacPackage(bundle,manifest),manifest);
    rmSync(path.join(bundle,paths[3]));
    assert.throws(()=>inspectMacPackage(bundle),/Required Sparkle file missing/);
    writeFileSync(path.join(bundle,paths[3]),'synthetic Sparkle');
    rmSync(path.join(bundle,paths[1]));
    assert.throws(()=>inspectMacPackage(bundle),/Required Sparkle file missing/);
  });
});
