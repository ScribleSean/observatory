// On Windows the data folder must not let other accounts change it, and the tests keep their data
// folders under the temporary folder. A user's %TEMP% can be writable by other accounts (Codex's
// Windows sandbox adds its groups there), so the test run gets one temporary folder of its own,
// locked the way the app's refusal message says, and every test process uses it through TEMP and TMP.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

if(process.platform==='win32' && !process.env.OBSERVATORY_TEST_TEMP) {
  const system32=path.win32.join(process.env.SystemRoot ?? 'C:\\Windows','System32');
  const user=/"(S-1-[0-9-]+)"\s*$/.exec(execFileSync(path.win32.join(system32,'whoami.exe'),['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}))?.[1];
  if(!user)throw Error('Could not read the current user SID for the test temporary folder');
  const folder=mkdtempSync(path.join(tmpdir(),'observatory-tests-'));
  execFileSync(path.win32.join(system32,'icacls.exe'),[folder,'/inheritance:r','/grant:r',
    `*${user}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F'],{stdio:'ignore',windowsHide:true});
  process.env.OBSERVATORY_TEST_TEMP=folder;
  process.env.TEMP=folder;
  process.env.TMP=folder;
  // Test processes started from this one inherit the folder; only the process that made it removes it.
  process.on('exit',()=>{try {rmSync(folder,{recursive:true,force:true,maxRetries:3});} catch {}});
}
