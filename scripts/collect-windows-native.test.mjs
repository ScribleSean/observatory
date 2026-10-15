import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {collectWindows} from './collect-windows.mjs';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

test('native Windows entry point preserves standalone collection without peer configuration',
  {skip:process.platform!=='win32'},async t=>{
    const runtime=await mkdtemp(path.join(tmpdir(),'observatory-windows-peer-test-'));
    t.after(()=>rm(runtime,{recursive:true,force:true}));
    await writeFile(path.join(runtime,'collector.config.json'),JSON.stringify({activity:false,codex:false,wispr:false,wslDistribution:null}));
    const output=execFileSync(process.execPath,[fileURLToPath(new URL('./collect-windows.mjs',import.meta.url))],
      {env:{...process.env,OBSERVATORY_RUNTIME:runtime},encoding:'utf8',timeout:20000});
    assert.deepEqual(JSON.parse(output),{state:'partial',sourcesRead:0,sourcesConfigured:0});
    const data=JSON.parse(await readFile(path.join(runtime,'public/local/usage.json'),'utf8'));
    assert.equal(Object.hasOwn(data,'deviceNames'),false);
    assert.equal(data.schema,2);assert.ok(data.tokens.every(source=>source.status==='not-connected'));
    assert.ok(data.activity.every(source=>source.status==='not-connected'));
    assert.equal(data.combinedTokens.status,'unavailable');
    assert.deepEqual((await readdir(runtime)).sort(),['collector.config.json','public']);
    const status=JSON.parse(await readFile(path.join(runtime,'public/local/collector.json'),'utf8'));
    assert.equal(status.state,'partial');assert.equal(status.snapshotAt,data.collectedAt);
  });

test('native Windows ignores retired source settings and preserves source files',
  {skip:process.platform!=='win32'},async t=>{
    const root=await mkdtemp(path.join(tmpdir(),'observatory-windows-dictation-test-'));
    t.after(()=>rm(root,{recursive:true,force:true}));
    const runtime=path.join(root,'runtime'),home=path.join(root,'home');
    await mkdir(runtime);await mkdir(home);
    const file=path.join(home,'AppData/Local/TypeWhisper-UserData/Data/usage-statistics.json');
    await mkdir(path.dirname(file),{recursive:true});
    const fixture=JSON.stringify({version:1,days:[{day:'2026-09-09T00:00:00',transcriptionCount:2,
      totalWords:12,totalDurationSeconds:7,modelCounts:{},transcript:'PRIVATE'}]});
    await writeFile(file,fixture);
    const config={activity:false,codex:false,wispr:false,typewhisper:true,quota:false};
    const env={...process.env,USERPROFILE:home,OBSERVATORY_RUNTIME:runtime};
    // Refuse the fixture run unless the child really resolves the fictional home.
    assert.equal(path.resolve(execFileSync(process.execPath,['-p',"require('node:os').homedir()"],
      {env,encoding:'utf8'}).trim()),path.resolve(home));
    const collect=async()=>{
      await writeFile(path.join(runtime,'collector.config.json'),JSON.stringify(config));
      execFileSync(process.execPath,[fileURLToPath(new URL('./collect-windows.mjs',import.meta.url))],
        {env,encoding:'utf8',timeout:20000});
      return JSON.parse(await readFile(path.join(runtime,'public/local/usage.json'),'utf8'));
    };
    await writeFile(path.join(runtime,'device.json'),JSON.stringify({name:' Fixture PC '}));
    const enabled=await collect();
    assert.deepEqual(enabled.deviceNames,{Windows:'Fixture PC'});
    await writeFile(path.join(runtime,'device.json'),JSON.stringify({name:'invalid/name'}));
    assert.equal(Object.hasOwn(await collect(),'deviceNames'),false);
    const source=enabled.dictation.find(row=>row.source==='TypeWhisper');
    assert.equal(source,undefined);
    assert.ok(!JSON.stringify(enabled).includes('PRIVATE'));
    config.typewhisper=false;
    assert.equal((await collect()).dictation.find(row=>row.source==='TypeWhisper'),undefined);
    assert.equal(await readFile(file,'utf8'),fixture);
  });

test('Windows Claude reading time precedes the fixture reader',
  {skip:process.platform!=='win32'},async t=>{
    const runtime=await mkdtemp(path.join(tmpdir(),'observatory-windows-reading-time-'));
    t.after(()=>rm(runtime,{recursive:true,force:true}));
    const claude=path.join(runtime,'fixture-claude'),marker=path.join(runtime,'reader-start.json');
    const project=path.join(claude,'projects','fixture');
    await mkdir(project,{recursive:true});
    // One synthetic request, so the reader reports ok and the row has a reading time.
    await writeFile(path.join(project,'requests.jsonl'),JSON.stringify({type:'assistant',timestamp:'2026-09-25T04:30:00Z',
      requestId:'r1',message:{role:'assistant',id:'m1',model:'claude-sonnet-4-20250514',
        usage:{input_tokens:1,cache_read_input_tokens:2,cache_creation_input_tokens:3,output_tokens:4}}})+'\n');
    await writeFile(path.join(runtime,'collector.config.json'),JSON.stringify({
      activity:false,codex:false,claude:true,wispr:false,quota:false}));
    const prior=process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR=claude;
    t.after(()=>{if(prior===undefined)delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=prior;});
    const originalReadFile=fs.readFile;
    t.mock.method(fs,'readFile',async(file,...args)=>{
      const source=await originalReadFile(file,...args);
      if(file===fileURLToPath(new URL('./read-claude-usage.py',import.meta.url)))return `import time, json
with open(${JSON.stringify(marker)}, 'w') as marker:
    json.dump(time.time() * 1000, marker)
time.sleep(0.02)
`+source;
      return source;
    });
    syncBuiltinESMExports();
    t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
    const before=Date.now(),result=await collectWindows(runtime);
    const source=result.data.providerTokenSources[0];
    assert.equal(source.status,'ok');
    const checkedAt=Date.parse(source.checkedAt),readerAt=JSON.parse(await readFile(marker,'utf8'));
    const collector=JSON.parse(await readFile(path.join(runtime,'public/local/collector.json'),'utf8'));
    assert.ok(before<=Date.parse(collector.startedAt));
    assert.ok(Date.parse(collector.startedAt)<=Date.parse(result.data.collectedAt));
    assert.ok(Date.parse(result.data.collectedAt)<=checkedAt);
    assert.ok(checkedAt<=readerAt,'Claude reading time must precede the fixture reader');
  });
