import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyInstallation,replaceVerifiedInstallation} from '../native/windows/verify-installation.mjs';
import {verifyManifest} from '../native/windows/verify-manifest.mjs';
const hash=data=>createHash('sha256').update(data).digest('hex');
function fixture(t) {
  const root=realpathSync(mkdtempSync(path.join(tmpdir(),'observatory-installation-test-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const make=(name,revision,build)=>{
    const folder=path.join(root,name);mkdirSync(folder);
    const data=Buffer.from('Synthetic executable '+build);
    const manifest=Buffer.from(JSON.stringify({schema:1,platform:'win-x64',sourceRevision:revision,
      sourceDirty:false,totalBytes:data.length,files:[{path:'WorkspaceObservatory.exe',bytes:data.length,sha256:hash(data)}]}));
    const owner=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(`[Owner]\r\nProduct=WorkspaceObservatorySetup\r\nRevision=${revision}\r\n`,'utf16le')]);
    const uninstaller=Buffer.from('Synthetic uninstaller '+build);
    for(const [file,bytes] of Object.entries({'WorkspaceObservatory.exe':data,'package-manifest.json':manifest,
      'installer-owner.ini':owner,'Uninstall.exe':uninstaller}))writeFileSync(path.join(folder,file),bytes);
    return {folder,receipt:{sourceRevision:revision,buildNumber:build,manifestSha256:hash(manifest),ownerSha256:hash(owner),uninstallerSha256:hash(uninstaller)}};
  };
  return {root,old:make('installed','a'.repeat(40),7),next:make('staged','b'.repeat(40),8)};
}
test('real manifest verification accepts receipt-bound NSIS extras without weakening packaged verification',t=>{
  const f=fixture(t);
  assert.deepEqual(verifyInstallation(f.old.folder,f.old.receipt),{sourceRevision:'a'.repeat(40),buildNumber:7});
  assert.throws(()=>verifyManifest(f.old.folder),/inventory mismatch/);
  assert.throws(()=>verifyManifest(f.old.folder,{installerFiles:[{path:'arbitrary.txt',bytes:1,sha256:'a'.repeat(64)}]}));
});
test('actual manifest and ownership verifier is used before and after replacement',t=>{
  const f=fixture(t);
  const result=replaceVerifiedInstallation({installed:f.old.folder,staged:f.next.folder,
    previousReceipt:f.old.receipt,candidateReceipt:f.next.receipt});
  assert.equal(verifyInstallation(f.old.folder,f.next.receipt).buildNumber,8);
  assert.equal(verifyInstallation(result.previous,f.old.receipt).buildNumber,7);
});
test('changed uninstaller, owner and manifest fail before replacement',t=>{
  const f=fixture(t);
  for(const name of ['Uninstall.exe','installer-owner.ini','package-manifest.json']) {
    const file=path.join(f.next.folder,name),saved=readFileSync(file);
    writeFileSync(file,'changed');
    assert.throws(()=>replaceVerifiedInstallation({installed:f.old.folder,staged:f.next.folder,
      previousReceipt:f.old.receipt,candidateReceipt:f.next.receipt}),/receipt mismatch/);
    assert.equal(verifyInstallation(f.old.folder,f.old.receipt).buildNumber,7);
    writeFileSync(file,saved);
  }
});
test('payload mutations and extra files are rejected despite matching metadata receipts',t=>{
  const f=fixture(t);
  writeFileSync(path.join(f.next.folder,'WorkspaceObservatory.exe'),'changed');
  assert.throws(()=>verifyInstallation(f.next.folder,f.next.receipt));
  writeFileSync(path.join(f.old.folder,'unrelated.txt'),'preserve');
  assert.throws(()=>verifyInstallation(f.old.folder,f.old.receipt),/inventory mismatch/);
});
test('wrong product ownership is refused even with its matching digest',t=>{
  const f=fixture(t),owner=Buffer.from(`[Owner]\nProduct=OtherApp\nRevision=${f.next.receipt.sourceRevision}\n`);
  writeFileSync(path.join(f.next.folder,'installer-owner.ini'),owner);
  assert.throws(()=>verifyInstallation(f.next.folder,{...f.next.receipt,ownerSha256:hash(owner)}),/ownership mismatch/);
});
