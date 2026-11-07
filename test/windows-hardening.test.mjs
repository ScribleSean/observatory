import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertPrivateWindowsFolder,windowsAclMessage,windowsAclProblem} from '../lib/private-folder.mjs';
import {sshProgram} from '../scripts/hub-transport.mjs';
import {findClaude} from '../scripts/claude-usage-command.mjs';

const me='S-1-5-21-1111111111-2222222222-3333333333-1001';
const other='S-1-5-21-1111111111-2222222222-3333333333-1002';
const own=`O:${me}G:${me}D:`;

test('a Windows folder only you, SYSTEM and Administrators can change is private', () => {
  assert.equal(windowsAclProblem(`${own}PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;${me})`,me),null);
  // Another local account or group that may only read, such as a sandbox group, is allowed.
  assert.equal(windowsAclProblem(`${own}AI(A;OICIID;0x1200a9;;;${other})(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;${me})`,me),null);
  assert.equal(windowsAclProblem(`O:BAG:SYD:(A;OICI;FA;;;${me})(A;OICIIO;FA;;;CO)(D;;FA;;;WD)`,me),null);
  assert.equal(windowsAclProblem(`O:${me}D:(A;;FA;;;${me})`,me),null);
  assert.equal(windowsAclProblem(`${own}(A;;FA;;;${me})S:AI`,me),null);
});

test('a Windows folder others can change or anyone can read is refused', () => {
  for(const [entry,account] of [[`(A;OICI;0x1301bf;;;${other})`,other],[`(A;OICI;FW;;;${other})`,other],[`(A;;CCDC;;;${other})`,other],
    [`(A;OICIIO;GW;;;${other})`,other],['(A;OICI;FR;;;WD)','S-1-1-0'],['(A;OICI;0x1200a9;;;AU)','S-1-5-11'],['(A;OICI;0x1200a9;;;BU)','S-1-5-32-545'],
    ['(A;OICIIO;0x1301bf;;;IU)','S-1-5-4'],['(A;;FR;;;S-1-1-0)','S-1-1-0'],[`(OA;;FA;;;${other})`,other],
    // Domain Users and This Organization are broad groups even though Windows has no short name for them here.
    ['(A;;FR;;;S-1-5-21-1111111111-2222222222-3333333333-513)','S-1-5-21-1111111111-2222222222-3333333333-513'],['(A;;FR;;;S-1-5-15)','S-1-5-15']])
    assert.deepEqual(windowsAclProblem(`${own}(A;OICI;FA;;;${me})${entry}`,me),{reason:'access',accounts:[account]},entry);
  for(const entry of [`(A;;ZZ;;;${me})`,'(A;;FA;;;XX)'])
    assert.deepEqual(windowsAclProblem(`${own}(A;OICI;FA;;;${me})${entry}`,me),{reason:'access',accounts:[]},entry);
  assert.deepEqual(windowsAclProblem(`${own}(A;;FR;;;AU)(A;;FA;;;${me})(A;;FA;;;${other})(A;;FR;;;S-1-5-11)`,me),{reason:'access',accounts:['S-1-5-11',other]});
  // Inherited entries are dropped by /inheritance:r, so the hint does not name them.
  assert.deepEqual(windowsAclProblem(`${own}(A;OICIID;0x1301bf;;;${other})(A;ID;FR;;;BU)(A;OICI;FA;;;${me})`,me),{reason:'access',accounts:[]});
  assert.equal(windowsAclProblem(`${own}NO_ACCESS_CONTROL`,me).reason,'access');
  assert.equal(windowsAclProblem(`O:${me}G:${me}`,me).reason,'access');
  // An entry with nested parentheses cannot be read, so the rest of the list is not trusted either.
  assert.equal(windowsAclProblem(`${own}(XA;;FA;;;${other};(x))(A;;FA;;;WD)`,me).reason,'access');
  // A DACL marker inside a condition is not mistaken for the start of the list.
  assert.equal(windowsAclProblem(`${own}(XA;;FA;;;WD;(@User.X=="D:S:"))`,me).reason,'access');
  assert.equal(windowsAclProblem(`O:${other}G:${other}D:(A;;FA;;;${me})`,me).reason,'owner');
  assert.equal(windowsAclProblem(undefined,me).reason,'unreadable');
  assert.equal(windowsAclProblem(`${own}(A;;FA;;;${me})`,undefined).reason,'unreadable');
});

test('refusals name the folder and a command that fixes it', async () => {
  const folder='D:\\Observatory';
  const message=windowsAclMessage({reason:'access',accounts:['S-1-5-11',other]},folder,me);
  assert.equal(message,`Unsafe D:\\Observatory: other accounts have access. Fix with: icacls "D:\\Observatory" /inheritance:r /remove *S-1-5-11 *${other} `+
    `/grant:r "*${me}:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"`);
  assert.match(windowsAclMessage({reason:'access',accounts:[]},folder,me),/\/inheritance:r \/grant:r /);
  assert.match(windowsAclMessage({reason:'owner',accounts:[]},folder,me),/Fix with: takeown \/f "D:\\Observatory"$/);
  await assert.rejects(assertPrivateWindowsFolder(folder,async()=>({sddl:`${own}(A;;FA;;;${me})(A;;FR;;;AU)(A;;FW;;;${other})`,userSid:me})),{message});
  await assert.rejects(assertPrivateWindowsFolder(folder,async()=>{throw Error('SystemRoot is not set\nmore');}),
    {message:'Unsafe D:\\Observatory: its access rules could not be read (SystemRoot is not set)'});
  await assertPrivateWindowsFolder(folder,async()=>({sddl:`${own}(A;;FA;;;${me})`,userSid:me}));
});

test('Windows runs ssh and scp from the OpenSSH folders, never from PATH', async () => {
  const environment={SystemRoot:'C:\\Windows',ProgramFiles:'C:\\Program Files',PATH:'C:\\Tools'};
  const seen=[];
  const only=allowed=>async file=>{seen.push(file);return file===allowed;};
  assert.equal(await sshProgram('ssh','win32',environment,only('C:\\Windows\\System32\\OpenSSH\\ssh.exe')),'C:\\Windows\\System32\\OpenSSH\\ssh.exe');
  assert.equal(await sshProgram('scp','win32',environment,only('C:\\Program Files\\OpenSSH\\scp.exe')),'C:\\Program Files\\OpenSSH\\scp.exe');
  await assert.rejects(sshProgram('ssh','win32',environment,async()=>false),{message:'ssh.exe not found. Add the OpenSSH Client in Settings, System, Optional features'});
  await assert.rejects(sshProgram('ssh','win32',{SystemRoot:'Windows',PATH:'C:\\Tools'},only('C:\\Tools\\ssh.exe')),/not found/);
  assert.ok(seen.every(file=>!file.startsWith('C:\\Tools') && path.win32.isAbsolute(file)));
  assert.equal(await sshProgram('ssh','darwin'),'/usr/bin/ssh');
});

const repo=fileURLToPath(new URL('..',import.meta.url));

test('Windows looks for claude.exe in the installers\' folders, not on PATH', async t => {
  const before=await readdir(repo);
  const root=await mkdtemp(path.join(tmpdir(),'observatory-claude-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  // Elsewhere these Windows-style paths are plain relative names, so work inside the temporary folder.
  const cwd=process.cwd();
  process.chdir(root);
  t.after(()=>process.chdir(cwd));
  const home=path.join(root,'home'),local=path.join(root,'local'),onPath=path.join(root,'tools');
  await mkdir(onPath,{recursive:true});
  await writeFile(path.join(onPath,'claude.exe'),'');
  assert.equal(await findClaude({PATH:onPath,LOCALAPPDATA:local},'win32',home),null);
  const linked=path.win32.join(local,'Microsoft','WinGet','Links','claude.exe');
  await mkdir(path.dirname(linked),{recursive:true});
  await writeFile(linked,'');
  assert.equal(await findClaude({PATH:onPath,LOCALAPPDATA:local},'win32',home),linked);
  const installed=path.win32.join(home,'.local','bin','claude.exe');
  await mkdir(installed,{recursive:true});
  assert.equal(await findClaude({PATH:onPath,LOCALAPPDATA:local},'win32',home),linked,'a folder named claude.exe is skipped');
  await rm(installed,{recursive:true});
  await mkdir(path.dirname(installed),{recursive:true});
  await writeFile(installed,'');
  assert.equal(await findClaude({PATH:onPath,LOCALAPPDATA:local},'win32',home),installed);
  assert.deepEqual((await readdir(repo)).filter(name=>!before.includes(name)),[],'nothing is written into the repo');
});

test('elsewhere findClaude skips files it cannot run', {skip:process.platform==='win32' && 'Requires POSIX file modes'}, async t => {
  const root=await mkdtemp(path.join(tmpdir(),'observatory-claude-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const first=path.join(root,'a'),second=path.join(root,'b');
  await mkdir(first);await mkdir(second);
  await writeFile(path.join(first,'claude'),'',{mode:0o600});
  await writeFile(path.join(second,'claude'),'',{mode:0o700});
  assert.equal(await findClaude({PATH:[first,second].join(path.delimiter)},'linux',path.join(root,'home')),path.join(second,'claude'));
});
