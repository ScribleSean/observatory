import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile,rm,lstat,symlink,chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {publishMacMigrationConfig} from './mac-migration-config.mjs';
import {planLegacyMacSources} from './mac-migration-plan.mjs';
const options={skip:process.platform!=='darwin'};
async function fixture(t){
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-migration-write-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const home='/fictional-home';
  const bytes=JSON.stringify({macCodexHome:home+'/.codex',windowsHost:'windows',ubuntuHost:'ubuntu',dictation:{mac:true}});
  await writeFile(root+'/local.config.json',bytes,{mode:0o600});
  return {root,bytes,args:{home,expectedLegacySha256:createHash('sha256').update(bytes).digest('hex'),sources:planLegacyMacSources(JSON.parse(bytes),home).sources}};
}
test('migration publishes complete owner-only settings without changing legacy bytes',options,async t=>{
  const {root,bytes,args}=await fixture(t),result=await publishMacMigrationConfig(root,args);
  assert.equal(result.activated,true);assert.equal(await readFile(root+'/local.config.json','utf8'),bytes);
  assert.deepEqual(JSON.parse(await readFile(root+'/collector.config.json')),args.sources);
  assert.equal((await lstat(root+'/collector.config.json')).mode&0o777,0o600);
  assert.equal(await readFile(result.staged,'utf8'),await readFile(root+'/collector.config.json','utf8'));
  await assert.rejects(publishMacMigrationConfig(root,args),/already exists/);
});
test('stale bytes and changed source choices never activate',options,async t=>{
  const {root,args}=await fixture(t);
  await assert.rejects(publishMacMigrationConfig(root,{...args,sources:{...args.sources,quota:true}}),/mapping changed/);
  await writeFile(root+'/local.config.json','{}');
  await assert.rejects(publishMacMigrationConfig(root,args),/Stale/);
  await assert.rejects(lstat(root+'/collector.config.json'),{code:'ENOENT'});
});
test('existing linked native target and linked legacy input are refused',options,async t=>{
  const {root,args}=await fixture(t);
  await writeFile(root+'/unrelated','preserve');
  await symlink(root+'/unrelated',root+'/collector.config.json');
  await assert.rejects(publishMacMigrationConfig(root,args),/already exists/);
  assert.equal(await readFile(root+'/unrelated','utf8'),'preserve');
  const other=await fixture(t);
  await rm(other.root+'/local.config.json');await symlink(root+'/unrelated',other.root+'/local.config.json');
  await assert.rejects(publishMacMigrationConfig(other.root,other.args),/Invalid legacy/);
});
test('broad runtime permissions are rejected, not repaired silently',options,async t=>{
  const {root,args}=await fixture(t);await chmod(root,0o755);
  await assert.rejects(publishMacMigrationConfig(root,args),/Owner-only/);
  assert.equal((await lstat(root)).mode&0o777,0o755);
});
