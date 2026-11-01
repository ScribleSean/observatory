import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {withFolder} from './helpers.mjs';
import {isProtectedFolder,PROTECTED_IN_HOME} from '../lib/protected-folders.mjs';
import {repositoryRoot} from '../scripts/read-projects.mjs';
import {signingIdentity,SIGNING_NAME,installMacApp,paths} from '../scripts/setup.mjs';

const home='/Users/someone';

test('Documents, Desktop, Downloads and the other guarded folders are protected',{skip:process.platform==='win32' && 'macOS folders and POSIX paths'},()=>{
  for(const name of PROTECTED_IN_HOME) {
    assert.ok(isProtectedFolder(path.join(home,name),home),name);
    assert.ok(isProtectedFolder(path.join(home,name,'project','src'),home),name);
  }
  assert.ok(isProtectedFolder('/Users/someone/documents/x',home));
  assert.ok(isProtectedFolder('/Volumes/USB/work',home));
  for(const safe of ['/Users/someone/Developer/app','/Users/someone/.claude/projects','/Users/someone/DocumentsArchive','/Users/someone',
    '/Users/someone/Library/Application Support/Observatory','/opt/homebrew/bin'])assert.equal(isProtectedFolder(safe,home),false,safe);
  assert.equal(isProtectedFolder('relative/Documents',home),false);
});

test('project names never look for .git inside a protected folder',()=>withFolder(async folder=>{
  const inside=path.join(folder,'Documents','notes','deep');
  await fs.mkdir(path.join(folder,'Documents','notes','.git'),{recursive:true});
  await fs.mkdir(inside,{recursive:true});
  assert.equal(repositoryRoot(inside,folder),null);
  const open=path.join(folder,'Developer','app','src');
  await fs.mkdir(path.join(folder,'Developer','app','.git'),{recursive:true});
  await fs.mkdir(open,{recursive:true});
  assert.equal(repositoryRoot(open,folder),path.join(folder,'Developer','app'));
}));

test('signing makes one local identity and reuses it on later runs',()=>withFolder(async folder=>{
  const calls=[];
  const run=async(file,args)=>{
    calls.push([path.basename(file),args[0]]);
    if(file==='/usr/bin/security' && args[0]==='list-keychains' && args.length===3)return {stdout:'    "/Users/someone/Library/Keychains/login.keychain-db"\n'};
    return {stdout:''};
  };
  const first=await signingIdentity(folder,{run});
  assert.equal(first.name,SIGNING_NAME);
  assert.equal(path.dirname(first.keychain),path.join(folder,'private-signing'));
  const made=calls.map(call=>call.join(' '));
  assert.ok(made.includes('security create-keychain') && made.includes('security import') && made.includes('openssl req'));
  assert.ok(!made.some(call=>call.startsWith('security add-trusted-cert')),'trust settings stay untouched');
  if(process.platform!=='win32') {
    assert.equal((await fs.stat(path.join(folder,'private-signing'))).mode & 0o777,0o700);
    assert.equal((await fs.stat(path.join(folder,'private-signing','keychain-password'))).mode & 0o777,0o600);
  }
  await fs.writeFile(first.keychain,'keychain');
  calls.length=0;
  const second=await signingIdentity(folder,{run});
  assert.deepEqual(second,first);
  assert.deepEqual(calls,[['security','unlock-keychain']]);
  assert.deepEqual((await fs.readdir(path.join(folder,'private-signing'))).sort(),['keychain-password','observatory-signing.keychain-db']);
}));

test('the Mac app is signed with the local identity when there is one',()=>withFolder(async folder=>{
  const target=paths('darwin',folder,folder);
  const signs=[];
  const run=async(file,args)=>{
    if(file==='/usr/bin/xcrun')await fs.writeFile(args.at(-1),'app',{mode:0o755});
    else if(args[0]!=='--verify')signs.push(args.slice(0,-1));
  };
  await installMacApp(target,'{}\n',{run,stop:async()=>{},signing:{name:SIGNING_NAME,keychain:'/k/observatory-signing.keychain-db'}});
  assert.deepEqual(signs,[['--force','--sign',SIGNING_NAME,'--keychain','/k/observatory-signing.keychain-db']]);
}));

test('the Claude limits call loads no user hooks, plugins or MCP servers',async()=>{
  const {USAGE_ARGUMENTS}=await import('../scripts/claude-usage-command.mjs');
  const at=USAGE_ARGUMENTS.indexOf('--setting-sources');
  assert.ok(at>0 && USAGE_ARGUMENTS[at+1]==='project');
  assert.ok(USAGE_ARGUMENTS.includes('--strict-mcp-config'));
  assert.ok(!USAGE_ARGUMENTS.includes('--bare'),'bare mode drops the subscription sign-in /usage needs');
});
