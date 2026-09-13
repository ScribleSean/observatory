import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile,writeFile,chmod,unlink,link,symlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {initializeDeviceIdentity,readDeviceIdentity,validateDeviceIdentity} from './peer-device-identity.mjs';

const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'/usr/bin/openssl';
test('protected device identity storage',{skip:!existsSync(openssl)},async t=>{
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-identity-test-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const key=path.join(root,'test.key'),cert=path.join(root,'test.pem');
  execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-keyout',key,
    '-out',cert,'-days','1','-subj','/CN=Observatory synthetic identity'],{stdio:'ignore',timeout:15000});
  const identity={version:1,key:await readFile(key,'utf8'),cert:await readFile(cert,'utf8')};
  const runtime=()=>mkdtemp(path.join(root,'runtime-'));
  await t.test('explicit creation persists the same validated identity and refuses replacement',async()=>{
    const directory=await runtime();
    assert.equal(await readDeviceIdentity(directory),null);
    const saved=await initializeDeviceIdentity(directory,identity);
    assert.deepEqual(await readDeviceIdentity(directory),saved);
    await assert.rejects(initializeDeviceIdentity(directory,identity));
    assert.deepEqual(await readDeviceIdentity(directory),saved);
  });
  await t.test('concurrent initialization has one winner',async()=>{
    const directory=await runtime();
    const results=await Promise.allSettled([initializeDeviceIdentity(directory,identity),initializeDeviceIdentity(directory,identity)]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.ok(await readDeviceIdentity(directory));
  });
  await t.test('missing and corrupt files require recovery without overwrite',async()=>{
    const directory=await runtime();await initializeDeviceIdentity(directory,identity);
    const file=path.join(directory,'private-device-identity','identity.json');
    await writeFile(file,'{');
    await assert.rejects(readDeviceIdentity(directory));
    await assert.rejects(initializeDeviceIdentity(directory,identity));
    assert.equal(await readFile(file,'utf8'),'{');
    await unlink(file);
    await assert.rejects(readDeviceIdentity(directory));
    await assert.rejects(initializeDeviceIdentity(directory,identity));
  });
  await t.test('linked files are rejected',async()=>{
    const directory=await runtime();await initializeDeviceIdentity(directory,identity);
    const file=path.join(directory,'private-device-identity','identity.json');
    await link(file,path.join(root,'linked-identity'));
    await assert.rejects(readDeviceIdentity(directory));
  });
  await t.test('POSIX broad permissions and symlinks are rejected',{skip:process.platform==='win32'},async()=>{
    const directory=await runtime();await initializeDeviceIdentity(directory,identity);
    const file=path.join(directory,'private-device-identity','identity.json');
    await chmod(file,0o644);await assert.rejects(readDeviceIdentity(directory));
    await unlink(file);await symlink(key,file);await assert.rejects(readDeviceIdentity(directory));
  });
  await t.test('invalid identity fields fail before creating private state',async()=>{
    const directory=await runtime();
    for(const changes of [{version:2},{key:'private-invalid'},{cert:'invalid'},{extra:true}]) {
      assert.throws(()=>validateDeviceIdentity({...identity,...changes}),
        {message:'Device identity unavailable. Explicit recovery is required.'});
      await assert.rejects(initializeDeviceIdentity(directory,{...identity,...changes}));
    }
    assert.equal(await readDeviceIdentity(directory),null);
  });
  await t.test('a different private key cannot be stored with the certificate',()=>{
    const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    assert.throws(()=>validateDeviceIdentity({...identity,
      key:privateKey.export({type:'pkcs8',format:'pem'}).toString()}));
  });
});
