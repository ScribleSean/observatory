import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile,writeFile,mkdir,readdir,symlink,lstat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {testRuntimeBase} from './test-runtime-base.mjs';
import {privateCollectorDirectory} from './peer-directory.mjs';
import {initializeDeviceIdentity,readDeviceIdentity} from './peer-device-identity.mjs';
import {deviceIdentitySetupStatus,prepareDeviceIdentity} from './peer-identity-setup.mjs';

const base=await testRuntimeBase('peer-identity-setup');
after(()=>rm(base,{recursive:true,force:true}));
const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'/usr/bin/openssl';
test('explicit repair preserves only eligible damaged identities',{skip:!existsSync(openssl)},async t=>{
  const root=await realpath(await mkdtemp(path.join(base,'setup-')));
  const key=path.join(root,'test.key'),cert=path.join(root,'test.pem');
  execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-keyout',key,
    '-out',cert,'-days','1','-subj','/CN=Observatory synthetic identity'],{stdio:'ignore',timeout:15000});
  const identity={version:1,key:await readFile(key,'utf8'),cert:await readFile(cert,'utf8')};
  for(const kind of ['empty folder','empty file','truncated JSON','invalid UTF-8','invalid identity','newer version','unusable identity','extra file','valid identity','existing pairing','symbolic link','linked file','oversized file']) {
    await t.test(kind,{skip:process.platform==='win32' && ['symbolic link','linked file'].includes(kind)},async()=>{
      const runtime=await mkdtemp(path.join(root,'runtime-'));
      const folder=path.join(runtime,'private-device-identity');
      if(kind==='valid identity')await initializeDeviceIdentity(runtime,identity);
      else if(kind==='symbolic link') {
        const target=await mkdtemp(path.join(root,'target-'));
        await symlink(target,folder);
      } else {
        await privateCollectorDirectory(runtime,'private-device-identity',true);
        const bodies={'empty file':'','truncated JSON':'{"version":1,"key":"','invalid UTF-8':Buffer.from([0x7b,0xff,0xfe]),
          'invalid identity':'{}','newer version':JSON.stringify({...identity,version:2}),
          'unusable identity':JSON.stringify({version:1,key:'synthetic',cert:'synthetic'}),'oversized file':'x'.repeat(32769)};
        if(Object.hasOwn(bodies,kind))await writeFile(path.join(folder,'identity.json'),bodies[kind],{mode:0o600});
        if(kind==='extra file') {
          await writeFile(path.join(folder,'identity.json'),'',{mode:0o600});
          await writeFile(path.join(folder,'extra'),'synthetic retained content',{mode:0o600});
        }
        if(kind==='linked file')await symlink(key,path.join(folder,'identity.json'));
      }
      if(kind==='existing pairing')await mkdir(path.join(runtime,'private-sync'),{mode:0o700});
      const original=await lstat(folder),entries=await readdir(folder);
      const contents=new Map();
      for(const name of entries)contents.set(name,await readFile(path.join(folder,name)));
      const repairable=['empty folder','empty file','truncated JSON','invalid UTF-8'].includes(kind);
      const expected=kind==='valid identity'?'identity-ready':repairable?'identity-required':'identity-recovery-required';
      assert.deepEqual(await deviceIdentitySetupStatus(runtime),{status:expected});
      assert.deepEqual((await readdir(runtime)).filter(name=>name.includes('-damaged-')),[]);
      let generated=0;
      const options={storage:'restricted-file',generate:async()=>{generated++;return identity;}};
      if(repairable || kind==='valid identity')assert.deepEqual(await prepareDeviceIdentity(runtime,options),{status:'identity-ready'});
      else await assert.rejects(prepareDeviceIdentity(runtime,options));
      assert.equal(generated,repairable?1:0);
      const damaged=(await readdir(runtime)).filter(name=>/^private-device-identity-damaged-[a-f0-9]{32}$/.test(name));
      assert.equal(damaged.length,repairable?1:0);
      const retained=repairable?path.join(runtime,damaged[0]):folder;
      assert.equal((await lstat(retained)).ino,original.ino);
      assert.deepEqual(await readdir(retained),entries);
      for(const [name,content] of contents)assert.deepEqual(await readFile(path.join(retained,name)),content);
      if(repairable)assert.ok(await readDeviceIdentity(runtime));
      if(kind==='existing pairing')assert.deepEqual(await readdir(path.join(runtime,'private-sync')),[]);
    });
  }
});
