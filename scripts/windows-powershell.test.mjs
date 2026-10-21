import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {windowsPowerShellEnvironment,windowsPowerShellFileArguments} from './windows-powershell.mjs';

test('PowerShell file arguments include a process execution policy and preserve script arguments',()=>{
  const script='C:/fixture/synthetic.ps1';
  const expected=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script];
  assert.deepEqual(windowsPowerShellFileArguments(script),expected);
  assert.deepEqual(windowsPowerShellFileArguments(script,'-Directory','C:/fixture','-Diagnostic'),
    [...expected,'-Directory','C:/fixture','-Diagnostic']);
});

test('PowerShell file execution overrides an inherited Restricted process policy',
  {skip:process.platform!=='win32'},async t=>{
    const directory=await mkdtemp(path.join(tmpdir(),'observatory-powershell-policy-'));
    t.after(()=>rm(directory,{recursive:true,force:true}));
    const script=path.join(directory,'synthetic.ps1');
    const line='synthetic-policy-check-ok';
    await writeFile(script,`Write-Output '${line}'\n`);
    const executable=path.join(process.env.SystemRoot || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    const options={env:{...windowsPowerShellEnvironment(),PSExecutionPolicyPreference:'Restricted'},
      encoding:'utf8',timeout:15000,windowsHide:true};
    const control=spawnSync(executable,['-NoProfile','-NonInteractive','-File',script],options);
    const bypass=spawnSync(executable,windowsPowerShellFileArguments(script),options);
    assert.ifError(bypass.error);
    assert.equal(bypass.status,0,bypass.stderr);
    assert.equal(bypass.stdout.trim(),line);
    assert.ifError(control.error);
    if(control.stdout.includes(line)) {
      t.skip('The runner did not honour the inherited Restricted process policy');
      return;
    }
    assert.notEqual(control.status,0);
    assert.equal(control.stdout.includes(line),false);
  });

test('Windows PowerShell gets only its own built-in module path without changing parent environment',()=>{
  const input={SystemRoot:'D:\\Windows',PSModulePath:'PowerShell7',psmodulepath:'another override',KEEP:'unchanged'};
  const copy={...input},result=windowsPowerShellEnvironment(input);
  assert.deepEqual(input,copy);
  assert.equal(result.PSModulePath,'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
  assert.equal(result.KEEP,'unchanged');
  assert.deepEqual(Object.keys(result).filter(key=>key.toLowerCase()==='psmodulepath'),['PSModulePath']);
  assert.equal(windowsPowerShellEnvironment({systemroot:'E:\\Windows'}).PSModulePath,'E:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
});
