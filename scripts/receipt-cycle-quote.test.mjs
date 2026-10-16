import test from 'node:test';
import assert from 'node:assert/strict';
import {quote} from '../native/windows/powershell-quote.mjs';

test('PowerShell literals double ASCII and all smart single quotes',()=>{
  for(const mark of ["'",'\u2018','\u2019','\u201a','\u201b']) {
    const value=`C:\\Users\\Example${mark}s Folder\\archive.zip`;
    assert.equal(quote(value),`'C:\\Users\\Example${mark}${mark}s Folder\\archive.zip'`);
  }
  assert.equal(quote('plain path'),"'plain path'");
  assert.equal(quote(''),"''");
});
