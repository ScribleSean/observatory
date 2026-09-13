import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,mkdir,chmod,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {privateSyncDirectory} from './peer-directory.mjs';
import {fileURLToPath} from 'node:url';

async function fixture(t) {
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-private-acl-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));return runtime;
}
function grantEveryone(file) {
  const executable=path.join(process.env.SystemRoot || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const literal="'"+file.replaceAll("'","''")+"'";
  const input=`$ErrorActionPreference='Stop'; $file=${literal}; $acl=Get-Acl -LiteralPath $file;
    $sid=New-Object Security.Principal.SecurityIdentifier('S-1-1-0');
    $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'Read','Allow');
    $acl.AddAccessRule($rule); Set-Acl -LiteralPath $file -AclObject $acl;`;
  execFileSync(executable,['-NoProfile','-NonInteractive','-Command','-'],{input,encoding:'utf8',timeout:15000});
}
test('private directory is created with verified permissions and can be reused',async t=>{
  const runtime=await fixture(t),directory=await privateSyncDirectory(runtime,true);
  assert.equal(directory,path.join(runtime,'private-sync'));
  await writeFile(path.join(directory,'pairing.json'),'{}',{mode:0o600});
  assert.equal(await privateSyncDirectory(runtime),directory);
});
test('an existing broadly accessible directory is rejected, not silently repaired',async t=>{
  const runtime=await fixture(t),directory=path.join(runtime,'private-sync');
  if(process.platform==='win32') {await privateSyncDirectory(runtime,true);grantEveryone(directory);}
  else {await mkdir(directory);await chmod(directory,0o755);}
  await assert.rejects(privateSyncDirectory(runtime,true));
  await assert.rejects(privateSyncDirectory(runtime,false));
});
test('Windows file-level broad grants are rejected despite a private parent',
  {skip:process.platform!=='win32'},async t=>{
    const runtime=await fixture(t),directory=await privateSyncDirectory(runtime,true);
    const file=path.join(directory,'pairing.json');await writeFile(file,'{}');grantEveryone(file);
    await assert.rejects(privateSyncDirectory(runtime));
  });
test('Windows ACL verification ignores incompatible inherited modules',
  {skip:process.platform!=='win32'},async t=>{
    const runtime=await fixture(t),modules=path.join(runtime,'modules');
    const module=path.join(modules,'Microsoft.PowerShell.Security');
    await mkdir(module,{recursive:true});
    await writeFile(path.join(module,'Microsoft.PowerShell.Security.psd1'),
      "@{RootModule='fixture.psm1';ModuleVersion='1.0';FunctionsToExport=@('Get-Acl')}\n");
    await writeFile(path.join(module,'fixture.psm1'),
      "function Get-Acl { throw 'Synthetic incompatible module' }\nExport-ModuleMember -Function Get-Acl\n");
    const before=process.env.PSModulePath;
    process.env.PSModulePath=modules;
    try {
      const directory=await privateSyncDirectory(runtime,true);
      const executable=path.join(process.env.SystemRoot || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
      const script=fileURLToPath(new URL('./private-sync-acl.ps1',import.meta.url));
      // Control reproduces the former inherited-environment failure.
      assert.throws(()=>execFileSync(executable,['-NoProfile','-NonInteractive','-File',script,'-Directory',directory],
        {env:{...process.env},stdio:'pipe',timeout:15000}));
      assert.equal(await privateSyncDirectory(runtime),directory);
      assert.equal(process.env.PSModulePath,modules);
    } finally {
      if(before===undefined)delete process.env.PSModulePath;else process.env.PSModulePath=before;
    }
  });
