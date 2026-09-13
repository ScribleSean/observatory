import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {execPython} from './test-python.mjs';

test('Windows Python preparation rejects unsafe paths, bad hashes and mismatched notices',()=>{
  execPython([fileURLToPath(new URL('../native/windows/test_prepare_python.py',import.meta.url))],{timeout:15000,stdio:'pipe'});
});
