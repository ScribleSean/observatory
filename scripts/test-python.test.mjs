import test from 'node:test';
import assert from 'node:assert/strict';
import {pythonTestCommand} from './test-python.mjs';

test('candidate Python uses the exact absolute executable without launcher flags',()=>{
  for(const [platform,executable] of [['win32','C:/Candidate With Spaces/python.exe'],['darwin','/tmp/candidate/python3']]) {
    assert.deepEqual(pythonTestCommand(['-c','pass'],{OBSERVATORY_TEST_PYTHON:executable},platform),
      {executable,args:['-B','-X','utf8','-c','pass']});
  }
});
test('Python test selection rejects empty and relative overrides',()=>{
  for(const platform of ['win32','darwin'])for(const value of ['', 'python', '../python'])
    assert.throws(()=>pythonTestCommand([],{OBSERVATORY_TEST_PYTHON:value},platform),/absolute executable/);
});
test('default Windows tests keep the system launcher and version selector',()=>{
  assert.deepEqual(pythonTestCommand([],{SystemRoot:'C:/Windows'},'win32'),
    {executable:'C:\\Windows\\py.exe',args:['-3','-B','-X','utf8']});
});
