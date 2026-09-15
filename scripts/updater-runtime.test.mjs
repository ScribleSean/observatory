import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

test('selective updater preparation verifies real archive and preserves existing output',{
  skip:process.platform!=='win32' || !process.env.OBSERVATORY_TEST_WINSPARKLE_ARCHIVE
    ?'Requires Windows and the explicitly supplied pinned WinSparkle archive':false,
},t=>{
  const root=mkdtempSync(path.join(tmpdir(),'observatory-updater-runtime-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const script=fileURLToPath(new URL('../native/windows/prepare-updater-runtime.ps1',import.meta.url));
  const pin=JSON.parse(readFileSync(new URL('../native/windows/updater-tool.json',import.meta.url)));
  const archive=process.env.OBSERVATORY_TEST_WINSPARKLE_ARCHIVE;
  assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'),pin.sha256);
  const output=path.join(root,'verified runtime');
  const run=(source,destination)=>spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-NonInteractive','-File',script,'-Archive',source,'-Destination',destination],
    {encoding:'utf8',timeout:30000,maxBuffer:8192,windowsHide:true});
  const valid=run(archive,output);
  assert.equal(valid.status,0,valid.stderr || String(valid.error));
  assert.deepEqual(readdirSync(output).sort(),['COPYING','COPYING.expat','WinSparkle.dll']);
  const dll=readFileSync(path.join(output,'WinSparkle.dll'));
  assert.equal(dll.length,pin.runtime.bytes);
  assert.equal(createHash('sha256').update(dll).digest('hex'),pin.runtime.sha256);
  assert.match(readFileSync(path.join(output,'COPYING'),'utf8'),/Vaclav Slavik/);
  assert.match(readFileSync(path.join(output,'COPYING.expat'),'utf8'),/Expat maintainers/);
  assert.notEqual(run(archive,output).status,0);
  assert.deepEqual(readFileSync(path.join(output,'WinSparkle.dll')),dll);
  const bad=path.join(root,'changed.zip'),refused=path.join(root,'refused');
  writeFileSync(bad,'Synthetic corrupt archive');
  assert.notEqual(run(bad,refused).status,0);
  assert.equal(existsSync(refused),false);
  assert.notEqual(run(archive,'relative-output').status,0);
});
