import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {withFolder} from './helpers.mjs';
import {isProtectedFolder,PROTECTED_IN_HOME} from '../lib/protected-folders.mjs';
import {repositoryRoot} from '../scripts/read-projects.mjs';
import {signingIdentity,SIGNING_NAME,installMacApp,paths} from '../scripts/setup.mjs';

const home='/Users/someone';

test('Documents, Desktop, Downloads and the other guarded folders are protected',()=>{
  for(const name of PROTECTED_IN_HOME) {
    assert.ok(isProtectedFolder(path.posix.join(home,name),home,'darwin'),name);
    assert.ok(isProtectedFolder(path.posix.join(home,name,'project','src'),home,'darwin'),name);
  }
  assert.ok(isProtectedFolder('/Users/someone/documents/x',home,'darwin'));
  assert.ok(isProtectedFolder('/Volumes/USB/work',home,'darwin'));
  for(const safe of ['/Users/someone/Developer/app','/Users/someone/.claude/projects','/Users/someone/DocumentsArchive','/Users/someone',
    '/Users/someone/Library/Application Support/Observatory','/opt/homebrew/bin'])assert.equal(isProtectedFolder(safe,home,'darwin'),false,safe);
  assert.equal(isProtectedFolder('relative/Documents',home,'darwin'),false);
  assert.equal(isProtectedFolder('/Users/someone/Documents/x',home,'win32'),false,'only macOS guards Documents');
});

test('project names never look for .git inside a protected folder',{skip:process.platform==='win32' && 'macOS paths'},()=>withFolder(async folder=>{
  const inside=path.join(folder,'Documents','notes','deep');
  await fs.mkdir(path.join(folder,'Documents','notes','.git'),{recursive:true});
  await fs.mkdir(inside,{recursive:true});
  assert.equal(repositoryRoot(inside,folder,'darwin'),null);
  assert.equal(repositoryRoot(inside,folder,'linux'),path.join(folder,'Documents','notes'));
  const open=path.join(folder,'Developer','app','src');
  await fs.mkdir(path.join(folder,'Developer','app','.git'),{recursive:true});
  await fs.mkdir(open,{recursive:true});
  assert.equal(repositoryRoot(open,folder,'darwin'),path.join(folder,'Developer','app'));
}));

const fakeSecurity=({failImport=false}={})=>{
  const calls=[];let list=['/Users/someone/Library/Keychains/login.keychain-db'];
  const run=async(file,args)=>{
    calls.push([path.basename(file),args[0]]);
    if(file==='/usr/bin/security' && args[0]==='list-keychains') {
      if(args.includes('-s'))list=args.slice(args.indexOf('-s')+1);
      return {stdout:list.map(item=>`    "${item}"`).join('\n')+'\n'};
    }
    if(file==='/usr/bin/security' && args[0]==='create-keychain') {list=[...list,args.at(-1)];await fs.writeFile(args.at(-1),'keychain');}
    if(file==='/usr/bin/security' && args[0]==='import' && failImport)throw Error('import failed');
    if(file==='/usr/bin/security' && args[0]==='find-identity')return {stdout:`  1) ABCDEF "${SIGNING_NAME}"\n     1 identities found\n`};
    return {stdout:''};
  };
  return {run,calls,list:()=>list};
};

test('signing makes one local identity and reuses it on later runs',()=>withFolder(async folder=>{
  const security=fakeSecurity();
  const first=await signingIdentity(folder,{run:security.run});
  assert.equal(first.name,SIGNING_NAME);
  assert.equal(path.dirname(first.keychain),path.join(folder,'private-signing'));
  const made=security.calls.map(call=>call.join(' '));
  assert.ok(made.includes('security create-keychain') && made.includes('security import') && made.includes('openssl req'));
  assert.ok(!made.some(call=>call.startsWith('security add-trusted-cert')),'trust settings stay untouched');
  assert.deepEqual(security.list(),['/Users/someone/Library/Keychains/login.keychain-db'],'the search list is unchanged');
  if(process.platform!=='win32') {
    assert.equal((await fs.stat(path.join(folder,'private-signing'))).mode & 0o777,0o700);
    assert.equal((await fs.stat(path.join(folder,'private-signing','keychain-password'))).mode & 0o777,0o600);
  }
  security.calls.length=0;
  const second=await signingIdentity(folder,{run:security.run});
  assert.deepEqual(second,first);
  assert.deepEqual(security.calls,[['security','unlock-keychain'],['security','find-identity']]);
  assert.deepEqual((await fs.readdir(path.join(folder,'private-signing'))).sort(),['keychain-password','observatory-signing.keychain-db']);
}));

test('a failed identity leaves nothing that a later run would trust',()=>withFolder(async folder=>{
  const broken=fakeSecurity({failImport:true});
  await assert.rejects(signingIdentity(folder,{run:broken.run}),/import failed/);
  assert.deepEqual(await fs.readdir(path.join(folder,'private-signing')),[]);
  assert.deepEqual(broken.list(),['/Users/someone/Library/Keychains/login.keychain-db']);
  const fixed=fakeSecurity();
  assert.equal((await signingIdentity(folder,{run:fixed.run})).name,SIGNING_NAME);
  assert.ok(fixed.calls.some(call=>call.join(' ')==='security create-keychain'));
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

test('a build falls back to an ad hoc signature when the local identity fails',()=>withFolder(async folder=>{
  const target=paths('darwin',folder,folder);
  const signs=[],lines=[];
  const run=async(file,args)=>{
    if(file==='/usr/bin/xcrun')return fs.writeFile(args.at(-1),'app',{mode:0o755});
    if(args[0]==='--verify')return;
    signs.push(args[2]);
    if(args[2]===SIGNING_NAME)throw Error('identity unusable');
  };
  await installMacApp(target,'{}\n',{run,stop:async()=>{},log:line=>lines.push(line),signing:{name:SIGNING_NAME,keychain:'/k/x.keychain-db'}});
  assert.deepEqual(signs,[SIGNING_NAME,'-']);
  assert.equal(lines.length,1);
}));
