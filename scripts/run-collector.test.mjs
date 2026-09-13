import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
// This runner uses POSIX process groups and flock. Windows uses Collector.cs,
// whose contracts are exercised by the native Windows build and live checks.
const test=(name,fn)=>nodeTest(name,{skip:process.platform==='win32'?'POSIX runner only; Windows uses the native collector':false},fn);
const reader=path.resolve('scripts/run-collector.py');
const code=`import importlib.util,sys\ns=importlib.util.spec_from_file_location('runner',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nprint(m.run_collection(sys.argv[2],sys.argv[3],300,float(sys.argv[4])))`;
const success=`require('fs').writeFileSync('public/local/usage.json',JSON.stringify({collectedAt:new Date().toISOString(),activity:[{status:'ok'}],tokens:[],settings:[]}));`;
async function fixture(t,script) {
  const root=await mkdtemp(path.join(tmpdir(),'dashboard-runner-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'scripts'));
  await writeFile(path.join(root,'scripts/collect-dashboard.mjs'),`import {createRequire} from 'node:module';const require=createRequire(import.meta.url);${script}`);
  return root;
}
const run=(root,timeout=5)=>execFileSync('python3',['-c',code,reader,root,process.execPath,String(timeout)],{encoding:'utf8'}).trim();
const status=root=>readFile(path.join(root,'public/local/collector.json'),'utf8').then(JSON.parse);

test('runner publishes only safe status metadata after a successful collection',async t=>{
  const root=await fixture(t,`console.log('PRIVATE OUTPUT');console.error('SECRET');${success}`);
  assert.equal(run(root),'ok');const s=await status(root);
  assert.equal(s.intervalSeconds,300);assert.equal(s.sourcesRead,1);assert.equal(s.state,'ok');
  assert.ok(!JSON.stringify(s).includes('PRIVATE'));assert.ok(!JSON.stringify(s).includes('SECRET'));assert.ok(!JSON.stringify(s).includes(root));
});
test('failure preserves the preceding snapshot and records no error text',async t=>{
  const root=await fixture(t,`throw Error('SECRET')`);
  await mkdir(path.join(root,'public/local'),{recursive:true});
  await writeFile(path.join(root,'public/local/usage.json'),'previous snapshot');
  assert.equal(run(root),'failed');assert.equal(await readFile(path.join(root,'public/local/usage.json'),'utf8'),'previous snapshot');
  assert.equal((await status(root)).state,'failed');
});
test('partial agent receipt coverage prevents an all-sources-success status',async t=>{
  const root=await fixture(t,success.replace("settings:[]","settings:[],agentSource:{status:'partial'}"));
  assert.equal(run(root),'partial');
  const s=await status(root);
  assert.equal(s.sourcesRead,1);assert.equal(s.sourcesConfigured,2);
});
test('a timed-out reader is stopped and the operating-system lock is released',async t=>{
  const root=await fixture(t,`setInterval(()=>{},1000);`);
  assert.equal(run(root,0.1),'failed');
  await writeFile(path.join(root,'scripts/collect-dashboard.mjs'),`import {createRequire} from 'node:module';const require=createRequire(import.meta.url);${success}`);
  assert.equal(run(root),'ok');
});
test('overlapping collection is skipped without replacing running status',async t=>{
  const root=await fixture(t,`setTimeout(()=>{${success}},800);`);
  const child=spawn('python3',['-c',code,reader,root,process.execPath,'5']);
  const finished=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  for(let i=0;i<100;i++) {
    if(await status(root).then(s=>s.state==='running').catch(()=>false))break;
    await new Promise(r=>setTimeout(r,10));
  }
  assert.equal((await status(root)).state,'running');assert.equal(run(root),'busy');assert.equal((await status(root)).state,'running');
  assert.equal(await finished,0);assert.equal((await status(root)).state,'ok');
});

test('packaged runner keeps writable state separate from the bundled script',async t=>{
  const bundle=await fixture(t,'');
  const runtime=await fixture(t,'');
  const entry=path.join(bundle,'scripts','collect-mac.mjs');
  await writeFile(entry,`import fs from 'node:fs';if(process.env.OBSERVATORY_RUNTIME!==process.cwd() || !process.env.OBSERVATORY_PYTHON.startsWith('/'))throw Error('Invalid packaged environment');fs.writeFileSync('public/local/usage.json',JSON.stringify({collectedAt:new Date().toISOString(),activity:[{status:'ok'}]}));`);
  const output=JSON.parse(execFileSync('python3',[reader,'--node',process.execPath,'--runtime',runtime,'--collector',entry,'--interval','300'],{encoding:'utf8'}));
  assert.equal(output.collection,'ok');assert.equal((await status(runtime)).state,'ok');
  await assert.rejects(status(bundle));
});

test('allowance-only runner keeps full collection status and timestamps unchanged',async t=>{
  const root=await fixture(t,'');
  await mkdir(path.join(root,'public/local'),{recursive:true});
  const previous={collectedAt:'2026-01-01T00:00:00Z',activity:[{status:'stale'}],quota:{status:'ok',checkedAt:'2026-01-01T00:00:00Z'}};
  await writeFile(path.join(root,'public/local/usage.json'),JSON.stringify(previous));
  await writeFile(path.join(root,'public/local/collector.json'),'preserved full status');
  const entry=path.join(root,'scripts/collect-mac.mjs');
  await writeFile(entry,"if(!process.argv.includes('--quota-only'))throw Error('Wrong mode');");
  const result=JSON.parse(execFileSync('python3',[reader,'--node',process.execPath,'--runtime',root,'--collector',entry,'--quota-only'],{encoding:'utf8'}));
  assert.equal(result.collection,'ok');
  assert.equal(await readFile(path.join(root,'public/local/collector.json'),'utf8'),'preserved full status');
  assert.deepEqual(JSON.parse(await readFile(path.join(root,'public/local/usage.json'),'utf8')),previous);
  const attempt=JSON.parse(await readFile(path.join(root,'public/local/allowance-collector.json'),'utf8'));
  assert.equal(attempt.sourcesConfigured,1);assert.equal(attempt.sourcesRead,1);
  assert.equal(attempt.snapshotAt,previous.collectedAt);
});

test('failed allowance-only child reports separately and preserves previous data',async t=>{
  const root=await fixture(t,'');
  await mkdir(path.join(root,'public/local'),{recursive:true});
  await writeFile(path.join(root,'public/local/collector.json'),'full status');
  await writeFile(path.join(root,'public/local/usage.json'),'saved data');
  const entry=path.join(root,'scripts/collect-mac.mjs');
  await writeFile(entry,"throw Error('PRIVATE');");
  assert.throws(()=>execFileSync('python3',[reader,'--node',process.execPath,'--runtime',root,'--collector',entry,'--quota-only'],{encoding:'utf8'}));
  const attempt=await readFile(path.join(root,'public/local/allowance-collector.json'),'utf8');
  assert.equal(JSON.parse(attempt).state,'failed');assert.equal(attempt.includes('PRIVATE'),false);
  assert.equal(await readFile(path.join(root,'public/local/collector.json'),'utf8'),'full status');
  assert.equal(await readFile(path.join(root,'public/local/usage.json'),'utf8'),'saved data');
});
