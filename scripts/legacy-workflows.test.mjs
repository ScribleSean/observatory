import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink,mkdir,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {collectLegacyWorkflows,cleanLocalModel,attachWorkflows} from './legacy-workflows.mjs';
async function fixture(t,config) {
  const dir=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-workflows-')));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  if(config!==undefined)await writeFile(path.join(dir,'local.config.json'),JSON.stringify(config));
  return dir;
}
test('fresh installations never discover workflow sources',async t=>{
  const dir=await fixture(t);
  const fail=()=>{throw Error('Must not read');};
  const result=await collectLegacyWorkflows(dir,{receipts:fail,benchmark:fail});
  assert.equal(result.agentSource.status,'not-connected');assert.equal(result.localModel.status,'not-connected');
});
test('legacy sources retain sanitized metrics without exporting paths or raw receipts',async t=>{
  const dir=await fixture(t,{receiptDirectory:'/private/receipts',ubuntuHost:'test-host',localModelResults:'/private/benchmarks'});
  const result=await collectLegacyWorkflows(dir,{receipts:async folder=>{
    assert.equal(folder,'/private/receipts');return {agents:[{id:'review-1',total:42}],source:{status:'ok'}};
  },benchmark:async(host,folder)=>{
    assert.equal(host,'test-host');assert.equal(folder,'/private/benchmarks');
    return {records:[{model:'test-model',status:'complete',recordedAt:'2026-09-12T12:00:00Z',output:17,prompt:'PRIVATE',path:folder}]};
  }});
  assert.equal(result.agents[0].total,42);assert.equal(result.localModel.records[0].output,17);
  assert.ok(!/PRIVATE|private\/|test-host/.test(JSON.stringify(result)));
});
test('a failed benchmark read does not discard agent receipts',async t=>{
  const dir=await fixture(t,{receiptDirectory:'/receipts',ubuntuHost:'test-host',localModelResults:'/benchmarks'});
  const result=await collectLegacyWorkflows(dir,{receipts:async()=>({agents:[{id:'review-1'}],source:{status:'partial'}}),benchmark:()=>{throw Error('PRIVATE');}});
  assert.equal(result.agents.length,1);assert.equal(result.agentSource.status,'partial');assert.equal(result.localModel.status,'unavailable');
});
test('invalid source settings are rejected before invoking any reader',async t=>{
  const dir=await fixture(t,{receiptDirectory:'/receipts',ubuntuHost:'bad;host',localModelResults:'/benchmarks'});
  let called=false;
  await assert.rejects(collectLegacyWorkflows(dir,{receipts:async()=>{called=true;}}));assert.equal(called,false);
});
test('linked configuration is not followed',{skip:process.platform==='win32'},async t=>{
  const dir=await fixture(t);
  await writeFile(path.join(dir,'target'),'{}');await symlink(path.join(dir,'target'),path.join(dir,'local.config.json'));
  await assert.rejects(collectLegacyWorkflows(dir));
});
test('benchmark projection is bounded and strips invalid values',()=>{
  assert.throws(()=>cleanLocalModel({records:Array(2001).fill({})}));
  assert.throws(()=>cleanLocalModel({records:[null]}));
  const row=cleanLocalModel({records:[{model:'private model text',seconds:Infinity,input:-1,output:'4',recordedAt:42}]}).records[0];
  assert.equal(row.model,'unknown');for(const key of ['seconds','input','output','recordedAt'])assert.equal(row[key],null);
});
test('workflow status counts remain separate and peer output is untouched',()=>{
  const result={data:{quota:{status:'ok'}},peer:{payload:{version:1}},status:{sourcesRead:1,sourcesConfigured:1,state:'ok'}};
  attachWorkflows(result,{agents:[],agentSource:{status:'ok'},localModel:{host:'Ubuntu',status:'unavailable'}});
  assert.equal(result.status.sourcesRead,2);assert.equal(result.status.sourcesConfigured,3);assert.equal(result.status.state,'partial');
  assert.deepEqual(result.peer,{payload:{version:1}});assert.equal(result.data.quota.status,'ok');
});
test('native Mac collection retains real sanitized receipt output during migration',{skip:process.platform!=='darwin'},async t=>{
  const dir=await fixture(t);
  const receipts=path.join(dir,'receipts');await mkdir(receipts);
  await writeFile(path.join(dir,'local.config.json'),JSON.stringify({receiptDirectory:receipts}));
  await writeFile(path.join(dir,'collector.config.json'),JSON.stringify({activity:false,codex:false,wispr:false,typewhisper:false,quota:false}));
  await writeFile(path.join(receipts,'fixture.usage.json'),JSON.stringify({conversationId:'PRIVATE',requestedModel:'test-model',status:'SUCCESS',usage:{total_tokens:42},prompt:'PRIVATE'}));
  const {collectMac}=await import('./collect-mac.mjs');
  await collectMac(dir,'/unused-python');
  const serialized=await readFile(path.join(dir,'public/local/usage.json'),'utf8');
  const snapshot=JSON.parse(serialized);
  assert.equal(snapshot.agents[0].total,42);assert.equal(snapshot.agentSource.status,'ok');
  assert.equal(snapshot.localModel.status,'not-connected');assert.ok(!serialized.includes('PRIVATE'));assert.ok(!serialized.includes(receipts));
});
