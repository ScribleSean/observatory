import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {planLegacyMacSources,assessMacMigration} from './mac-migration-plan.mjs';
const home='/fictional-home';
const config={macCodexHome:home+'/.codex',windowsHost:'private-windows',ubuntuHost:'private-ubuntu',
  codexExecutable:'/private/client',receiptDirectory:'/private/receipts',localModelResults:'/private/models',dictation:{mac:true,windows:true}};
test('mapping preserves selected sources but never claims migration is ready',()=>{
  const plan=planLegacyMacSources(config,home);
  assert.equal(plan.status,'review-required');assert.ok(Object.values(plan.sources).every(Boolean));
  assert.deepEqual(plan.coverageChanges,[]);
  assert.ok(plan.requiredChecks.includes('saved-history-archive-and-visibility'));
  assert.ok(!JSON.stringify(plan).includes('private'));assert.ok(!JSON.stringify(plan).includes(home));
});
test('optional absent sources stay disabled and custom log locations block automatic mapping',()=>{
  const plan=planLegacyMacSources({macCodexHome:'/another/.codex',windowsHost:'windows',ubuntuHost:'ubuntu'},home);
  assert.equal(plan.status,'unsupported');assert.ok(plan.blockers.includes('custom-or-missing-mac-codex-home'));
  for(const key of ['wispr','quota','receipts','benchmarks'])assert.equal(plan.sources[key],false);
});
test('invalid source choices cannot become an executable migration plan',()=>{
  const plan=planLegacyMacSources({...config,receiptDirectory:42,dictation:{mac:'yes'},ubuntuHost:'bad;command'},home);
  assert.equal(plan.status,'unsupported');assert.equal(plan.blockers.length,3);
});
test('assessment leaves configuration bytes and directory inventory unchanged',async t=>{
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-migration-plan-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  const file=path.join(runtime,'local.config.json'),bytes=JSON.stringify(config);
  await writeFile(file,bytes);const before=await readdir(runtime);
  assert.equal((await assessMacMigration(runtime,{home})).status,'review-required');
  assert.equal(await readFile(file,'utf8'),bytes);assert.deepEqual(await readdir(runtime),before);
  await writeFile(path.join(runtime,'collector.config.json'),'{}');
  assert.deepEqual(await assessMacMigration(runtime,{home}),{version:1,status:'native-config-present'});
});
