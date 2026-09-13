import test from 'node:test';
import assert from 'node:assert/strict';
import {windowsPowerShellEnvironment} from './windows-powershell.mjs';

test('Windows PowerShell gets only its own built-in module path without changing parent environment',()=>{
  const input={SystemRoot:'D:\\Windows',PSModulePath:'PowerShell7',psmodulepath:'another override',KEEP:'unchanged'};
  const copy={...input},result=windowsPowerShellEnvironment(input);
  assert.deepEqual(input,copy);
  assert.equal(result.PSModulePath,'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
  assert.equal(result.KEEP,'unchanged');
  assert.deepEqual(Object.keys(result).filter(key=>key.toLowerCase()==='psmodulepath'),['PSModulePath']);
  assert.equal(windowsPowerShellEnvironment({systemroot:'E:\\Windows'}).PSModulePath,'E:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
});
