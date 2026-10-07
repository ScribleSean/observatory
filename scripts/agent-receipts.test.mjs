import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {cleanReceipts,readAgentReceipts} from './agent-receipts.mjs';
import {fileSymlinkOrSkip} from './test-file-symlink.mjs';
const receipt={conversationId:'private-conversation',requestedModel:'gemini-test',status:'SUCCESS',usage:{total_tokens:42},role:'PRIVATE ROLE'};
async function fixture(t){const dir=await mkdtemp(path.join(os.tmpdir(),'receipt-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('role is allowlisted, strict booleans do not mislabel unknown work',()=>{
  for(const isSubagent of ['false',false,1,undefined]) {
    const [row]=cleanReceipts([{value:{...receipt,isSubagent},modified:1}]);
    assert.equal(row.role,'Unknown');assert.ok(!JSON.stringify(row).includes('PRIVATE'));
  }
  assert.equal(cleanReceipts([{value:{...receipt,isSubagent:true},modified:1}])[0].role,'Subagent');
  assert.equal(cleanReceipts([{value:{...receipt,role:'Coordinator'},modified:1}])[0].role,'Coordinator');
});
test('same-time cumulative snapshots have a deterministic filename tie break',()=>{
  const rows=[{value:receipt,modified:1,name:'a.usage.json'},{value:{...receipt,usage:{total_tokens:84}},modified:1,name:'b.usage.json'}];
  assert.deepEqual(cleanReceipts(rows),cleanReceipts([...rows].reverse()));
  assert.equal(cleanReceipts(rows)[0].total,84);
});
test('discovers arbitrary top-level receipt names, not subfolders',async t=>{
  const dir=await fixture(t);
  await writeFile(path.join(dir,'custom.usage.json'),JSON.stringify(receipt));
  await mkdir(path.join(dir,'nested'));
  await writeFile(path.join(dir,'nested','hidden.usage.json'),JSON.stringify({...receipt,conversationId:'other'}));
  const result=await readAgentReceipts(dir);
  assert.equal(result.source.status,'ok');assert.equal(result.agents.length,1);
  assert.ok(!JSON.stringify(result).includes('private-conversation'));
});
test('malformed records and oversized files produce partial coverage',async t=>{
  const dir=await fixture(t);
  await writeFile(path.join(dir,'good.usage.json'),JSON.stringify(receipt));
  await writeFile(path.join(dir,'bad.usage.json'),'{PRIVATE');
  await writeFile(path.join(dir,'invalid.usage.json'),'null');
  await writeFile(path.join(dir,'huge.usage.json'),'x'.repeat(1024*1024+1));
  const result=await readAgentReceipts(dir);
  assert.equal(result.source.status,'partial');assert.equal(result.source.skipped,3);assert.equal(result.agents.length,1);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('file symlink receipts produce partial coverage',async t=>{
  const dir=await fixture(t);
  await writeFile(path.join(dir,'good.usage.json'),JSON.stringify(receipt));
  if(!await fileSymlinkOrSkip(t,path.join(dir,'good.usage.json'),path.join(dir,'link.usage.json')))return;
  const result=await readAgentReceipts(dir);
  assert.equal(result.source.status,'partial');assert.equal(result.source.skipped,1);assert.equal(result.agents.length,1);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('missing and symlink directories are unavailable, empty directories are readable',async t=>{
  const dir=await fixture(t);
  assert.equal((await readAgentReceipts(dir)).source.status,'ok');
  assert.equal((await readAgentReceipts(path.join(dir,'missing'))).source.status,'unavailable');
  await symlink(dir,path.join(dir,'link'),process.platform==='win32'?'junction':'dir');
  assert.equal((await readAgentReceipts(path.join(dir,'link'))).source.status,'unavailable');
});
test('receipt count is bounded with explicit partial coverage',async t=>{
  const dir=await fixture(t);
  await Promise.all(Array.from({length:129},(_,i)=>writeFile(path.join(dir,`${i}.usage.json`),JSON.stringify({...receipt,conversationId:String(i)}))));
  const result=await readAgentReceipts(dir);
  assert.equal(result.source.status,'partial');assert.equal(result.source.limited,true);assert.equal(result.agents.length,128);
});
