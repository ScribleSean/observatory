import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
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
    assert.equal(data.schema,2);assert.ok(data.tokens.every(source=>source.status==='not-connected'));
    assert.ok(data.activity.every(source=>source.status==='not-connected'));
    assert.equal(data.combinedTokens.status,'unavailable');
    assert.deepEqual((await readdir(runtime)).sort(),['collector.config.json','public']);
    const status=JSON.parse(await readFile(path.join(runtime,'public/local/collector.json'),'utf8'));
    assert.equal(status.state,'partial');assert.equal(status.snapshotAt,data.collectedAt);
  });

test('native Windows TypeWhisper opt-in reads fictional aggregates and opt-out removes only projection',
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
    const enabled=await collect();
    const source=enabled.dictation.find(row=>row.source==='TypeWhisper');
    assert.equal(source.status,'ok');assert.equal(source.days[0].words,12);
    assert.ok(!JSON.stringify(enabled).includes('PRIVATE'));
    config.typewhisper=false;
    assert.equal((await collect()).dictation.find(row=>row.source==='TypeWhisper').status,'not-connected');
    assert.equal(await readFile(file,'utf8'),fixture);
  });
