import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,mkdir,chmod,writeFile,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {privateSyncDirectory} from './peer-directory.mjs';
import {fileURLToPath} from 'node:url';
import {windowsPowerShellEnvironment} from './windows-powershell.mjs';

async function fixture(t) {
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-private-acl-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));return runtime;
}
function grantEveryoneScript(file,{writeGrant=true,wrongOwner=false,wrongInheritance=false}={}) {
  const literal="'"+file.replaceAll("'","''")+"'";
  // Persist only the DACL. Directory Set-Acl can require SeSecurityPrivilege.
  return `$ErrorActionPreference='Stop'; $file=${literal}; $item=Get-Item -LiteralPath $file;
    $before=$item.GetAccessControl();
    $owner=${wrongOwner ? "'S-1-1-0'" : '$before.GetOwner([Security.Principal.SecurityIdentifier]).Value'};
    $protected=${wrongInheritance ? '-not ' : ''}$before.AreAccessRulesProtected;
    $acl=$item.GetAccessControl([Security.AccessControl.AccessControlSections]::Access);
    $sid=New-Object Security.Principal.SecurityIdentifier('S-1-1-0');
    $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'Read','Allow');
    ${writeGrant ? '$acl.AddAccessRule($rule); $item.SetAccessControl($acl);' : ''}
    $saved=(Get-Item -LiteralPath $file).GetAccessControl();
    $grants=@($saved.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]) | Where-Object {
      $_.IdentityReference.Value -eq $sid.Value -and $_.AccessControlType -eq $rule.AccessControlType -and
      $_.FileSystemRights -eq $rule.FileSystemRights -and $_.InheritanceFlags -eq $rule.InheritanceFlags -and
      $_.PropagationFlags -eq $rule.PropagationFlags
    });
    if($grants.Count -ne 1) { throw 'Synthetic broad grant was not written' }
    if($saved.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $owner -or
      $saved.AreAccessRulesProtected -ne $protected) { throw 'Synthetic broad grant changed owner or inheritance' }
    'verified'
  `;
}
function runGrantEveryone(input) {
  const executable=path.join(process.env.SystemRoot || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  // One command prevents stdin from executing later statements after a throw.
  const command=`& { try {
    ${input}
    exit 0
  } catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
  } }`;
  return spawnSync(executable,['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',timeout:15000,env:windowsPowerShellEnvironment()});
}
function grantEveryone(file) {
  const result=runGrantEveryone(grantEveryoneScript(file));
  assert.ifError(result.error);
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout.trim(),'verified');
}
// Change only expected values or suppress a synthetic DACL write, never the owner or privileges.
/** @type {[string, {writeGrant?: boolean, wrongOwner?: boolean, wrongInheritance?: boolean}, RegExp][]} */
const invalidGrantCases = [
  ['ACE',{writeGrant:false},/Synthetic broad grant was not written/],
  ['owner',{wrongOwner:true},/Synthetic broad grant changed owner or inheritance/],
  ['inheritance',{wrongInheritance:true},/Synthetic broad grant changed owner or inheritance/]
];
for(const [check,control,message] of invalidGrantCases) {
  test(`Windows broad-grant helper fails closed on ${check} readback`,
    {skip:process.platform!=='win32'},async t=>{
      const runtime=await fixture(t),directory=await privateSyncDirectory(runtime,true);
      // Blank lines separate stdin commands. A failed check must stop later statements too.
      const input=grantEveryoneScript(directory,control).replaceAll('\n','\n\n');
      const result=runGrantEveryone(input);
      assert.ifError(result.error);
      assert.match(result.stderr,message);
      assert.equal(result.status,1,`status=${result.status}, stdout=${JSON.stringify(result.stdout)}\n${result.stderr}`);
      assert.doesNotMatch(result.stdout,/verified/);
    });
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
test('Windows ACL inspection distinguishes a vanished child from unsafe permissions',
  {skip:process.platform!=='win32'},async t=>{
    const runtime=await fixture(t),directory=await privateSyncDirectory(runtime,true);
    const file=path.join(directory,'journal');await writeFile(file,'synthetic');
    const literal=value=>"'"+value.replaceAll("'","''")+"'";
    const script=fileURLToPath(new URL('./private-sync-acl.ps1',import.meta.url));
    const input=`$ErrorActionPreference='Stop'; $vanishing=${literal(file)};
      function Get-Acl { param([string]$LiteralPath)
        if($LiteralPath -eq $vanishing) { Remove-Item -LiteralPath $LiteralPath }
        Microsoft.PowerShell.Security\\Get-Acl -LiteralPath $LiteralPath
      }
      & ${literal(script)} -Directory ${literal(directory)}
      exit $LASTEXITCODE
    `;
    const executable=path.join(process.env.SystemRoot || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    assert.throws(()=>execFileSync(executable,['-NoProfile','-NonInteractive','-Command','-'],
      {input,encoding:'utf8',timeout:15000,env:windowsPowerShellEnvironment()}),error=>error.status===2);
    assert.equal(await privateSyncDirectory(runtime),directory);
    grantEveryone(directory);
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

// Independent Darwin readback, not the Python verifier's own ACL adapter.
function darwinTool(executable,args) {
  assert.equal(process.platform,'darwin');
  return execFileSync(executable,args,{encoding:'utf8',timeout:15000,maxBuffer:16384,
    shell:false,stdio:['ignore','pipe','pipe'],env:{...process.env,LC_ALL:'C'}});
}
async function darwinAccess(file) {
  const info=await lstat(file);
  const lines=darwinTool('/bin/ls',['-lde',file]).trimEnd().split('\n');
  assert.ok(lines[0],'Expected native metadata readback');
  const acl=lines.slice(1).map(line=>{
    assert.match(line,/^\s*\d+: /,'Unexpected native ACL readback');
    return line.replace(/^\s*\d+: /,'');
  });
  return {dev:info.dev,ino:info.ino,uid:info.uid,gid:info.gid,mode:info.mode,nlink:info.nlink,acl};
}
for(const [target,right] of [['directory','list'],['file','read'],['ancestor','delete_child']]) {
  test(`Darwin extended ${right} grant on ${target} is rejected without repair`,
    {skip:process.platform!=='darwin',timeout:120000},async t=>{
      const runtime=await fixture(t),directory=await privateSyncDirectory(runtime,true);
      const file=path.join(directory,'pairing.json');await writeFile(file,'{}',{mode:0o600});
      // A real positive excludes unrelated ancestry or runtime failures.
      assert.equal(await privateSyncDirectory(runtime),directory);
      const files=[runtime,directory,file],modes=[0o700,0o700,0o600];
      const before=await Promise.all(files.map(darwinAccess));
      for(const [index,info] of before.entries()) {
        assert.equal(info.uid,process.getuid());
        assert.equal(info.mode&0o7777,modes[index],'Fixture must remain owner-only');
      }
      const index=target==='ancestor'?0:target==='directory'?1:2;
      const grant=`group:everyone allow ${right}`;
      assert.equal(before[index].acl.includes(grant),false);
      // Add exactly one effective ACE on an owned object, never an OS ancestor.
      darwinTool('/bin/chmod',['+a',grant,files[index]]);
      const granted=await Promise.all(files.map(darwinAccess));
      assert.equal(granted[index].acl.filter(ace=>ace===grant).length,1,
        'The actual foreign extended grant must be independently visible');
      assert.deepEqual(granted[index].acl.filter(ace=>ace!==grant).sort(),[...before[index].acl].sort());
      for(const [position,info] of granted.entries()) {
        assert.equal(info.mode&0o7777,modes[position],'ACL addition must not widen POSIX mode');
        assert.deepEqual({...info,acl:before[position].acl},before[position]);
        if(position!==index)assert.deepEqual(info.acl,before[position].acl);
      }
      for(const create of [false,true]) {
        await assert.rejects(privateSyncDirectory(runtime,create),
          {message:'Private path access-control verification failed'});
        assert.deepEqual(await Promise.all(files.map(darwinAccess)),granted,
          'Refusal must not remove grants, replace objects or repair owner/mode');
      }
      // fixture(t) removes only this newly owned tree, with the ACE still set.
    });
}
