import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {collectMac} from './collect-mac.mjs';
import {collectWindows} from './collect-windows.mjs';
import {execPython} from './test-python.mjs';

test('native collector publishes a separate Claude reading and counts its health once',
  {skip:!['darwin','win32'].includes(process.platform)},async t=>{
    const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-provider-collector-')));
    t.after(()=>rm(runtime,{recursive:true,force:true}));
    const claude=path.join(runtime,'fixture-claude');
    const project=path.join(claude,'projects','fixture');
    await mkdir(project,{recursive:true});
    await writeFile(path.join(project,'requests.jsonl'),JSON.stringify({type:'assistant',timestamp:'2026-09-25T04:30:00Z',
      requestId:'r1',message:{role:'assistant',id:'m1',model:'claude-sonnet-4-20250514',
        usage:{input_tokens:1,cache_read_input_tokens:2,cache_creation_input_tokens:3,output_tokens:4},content:'PRIVATE'}})+'\n');
    const config={activity:false,codex:false,claude:true,antigravity:false,wispr:false,quota:false};
    await writeFile(path.join(runtime,'collector.config.json'),JSON.stringify(config),{mode:0o600});
    const prior=process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR=claude;
    t.after(()=>{if(prior===undefined)delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=prior;});
    const python=execPython(['-c','import sys; print(sys.executable)']).toString().trim();
    const collect=process.platform==='darwin'?collectMac:collectWindows;
    const result=await collect(runtime,python);
    assert.equal(result.providerTokenSync.status,'disabled');
    assert.equal(result.data.providerTokenSources.length,1);
    assert.equal(result.data.providerTokenSources[0].days[0].totalTokens,10);
    assert.equal(result.data.providerTokenSources[0].host,process.platform==='darwin'?'Mac':'Windows');
    assert.ok(result.data.tokens.every(source=>source.status==='not-connected'));
    assert.equal(result.status.sourcesConfigured,1);assert.equal(result.status.sourcesRead,1);
    const snapshot=JSON.parse(await readFile(path.join(runtime,'public/local/usage.json'),'utf8'));
    assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
    assert.equal(snapshot.providerTokenSources[0].days[0].requestCount,1);
    await writeFile(path.join(runtime,'collector.config.json'),JSON.stringify({...config,claude:false}),{mode:0o600});
    await rm(claude,{recursive:true});
    const disabled=await collect(runtime,python);
    assert.equal(disabled.status.sourcesConfigured,0);
    assert.equal(disabled.data.providerTokenSources[0].status,'not-connected');
  });
