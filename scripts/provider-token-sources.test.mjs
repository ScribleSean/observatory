import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {attachProviderTokenSources,cleanClaudeTokenSource,unavailableClaudeTokenSource} from './provider-token-sources.mjs';
import {pythonTestCommand} from './test-python.mjs';

const counters={inputTokens:5,cacheReadTokens:2,cacheCreationTokens:0,outputTokens:3,totalTokens:10,requestCount:1};
const report={provider:'claude-code',status:'ok',days:[{date:'2026-09-24',...counters,models:[{model:'claude-sonnet-4-20250514',...counters,privateId:'PRIVATE'}]}]};

test('Claude records are sanitized, internally reconciled, and sorted',()=>{
  const source=cleanClaudeTokenSource(report,'Mac','2026-09-25T00:00:00Z');
  assert.equal(source.provider,'claude-code');
  assert.equal(source.scope,'Recorded Claude Code requests');
  assert.ok(!JSON.stringify(source).includes('PRIVATE'));
  assert.equal(source.days[0].models[0].model,'claude-sonnet-4-20250514');
  assert.equal(cleanClaudeTokenSource({provider:'claude-code',status:'ok',days:[{...report.days[0],models:[{...report.days[0].models[0],model:'claude-opus-5-5'}]}]},'Windows').days[0].models[0].model,'claude-opus-5-5');
  assert.equal(cleanClaudeTokenSource({provider:'claude-code',status:'ok',days:[{...report.days[0],models:[{...report.days[0].models[0],model:'claude-private-model'}]}]},'Windows').days[0].models[0].model,'unknown');
  assert.throws(()=>cleanClaudeTokenSource({days:[{...report.days[0],totalTokens:11}]},'Mac'));
  assert.throws(()=>cleanClaudeTokenSource({...report,status:'unavailable'},'Mac'));
  assert.throws(()=>cleanClaudeTokenSource({days:[report.days[0],report.days[0]]},'Mac'));
  assert.throws(()=>cleanClaudeTokenSource({provider:'claude-code',status:'ok',days:[{...report.days[0],models:[report.days[0].models[0],{...report.days[0].models[0],model:'private'}]}]},'Mac'));
});

test('distinct private model names share one reconciled unknown bucket beside known models',()=>{
  const models=[
    {model:'claude-private-beta',inputTokens:7,cacheReadTokens:11,cacheCreationTokens:13,outputTokens:17,totalTokens:48,requestCount:2},
    {model:'claude-sonnet-4-20250514',...counters},
    {model:'claude-private-alpha',...counters},
  ];
  const raw={provider:'claude-code',status:'ok',days:[{date:'2026-09-24',inputTokens:17,cacheReadTokens:15,cacheCreationTokens:13,outputTokens:23,totalTokens:68,requestCount:4,models}]};
  const source=cleanClaudeTokenSource(raw,'Windows','2026-09-25T00:00:00Z');
  assert.deepEqual(source.days[0].models,[
    {model:'claude-sonnet-4-20250514',...counters},
    {model:'unknown',inputTokens:12,cacheReadTokens:13,cacheCreationTokens:13,outputTokens:20,totalTokens:58,requestCount:3},
  ]);
  assert.equal(source.days[0].totalTokens,68);
  assert.equal(source.days[0].requestCount,4);
  assert.ok(!JSON.stringify(source).includes('claude-private'));
  assert.deepEqual(cleanClaudeTokenSource({...raw,days:[{...raw.days[0],models:[...models].reverse()}]},'Windows',source.checkedAt),source);
  assert.deepEqual(cleanClaudeTokenSource(source,'Windows',source.checkedAt),source);
});

test('duplicate raw model identities and invalid arithmetic remain rejected',()=>{
  for(const model of ['claude-private-alpha','claude-sonnet-4-20250514']) {
    const doubled=Object.fromEntries(Object.entries(counters).map(([key,value])=>[key,value*2]));
    const raw={provider:'claude-code',status:'ok',days:[{date:'2026-09-24',...doubled,models:[{model,...counters},{model,...counters}]}]};
    assert.throws(()=>cleanClaudeTokenSource(raw,'Windows'),/Duplicate Claude model/);
  }
  for(const change of [{inputTokens:-1},{requestCount:1.5},{totalTokens:11}]) {
    const raw={...report,days:[{...report.days[0],models:[{...report.days[0].models[0],...change}]}]};
    assert.throws(()=>cleanClaudeTokenSource(raw,'Windows'),/Invalid Claude token record/);
  }
  const mismatched={...report,days:[{...report.days[0],requestCount:2}]};
  assert.throws(()=>cleanClaudeTokenSource(mismatched,'Windows'),/Inconsistent Claude day/);
});

test('unknown bucket merging rejects token and request count overflow',()=>{
  for(const key of ['inputTokens','requestCount']) {
    const large={inputTokens:0,cacheReadTokens:0,cacheCreationTokens:0,outputTokens:0,totalTokens:0,requestCount:0,[key]:Number.MAX_SAFE_INTEGER};
    const small={inputTokens:0,cacheReadTokens:0,cacheCreationTokens:0,outputTokens:0,totalTokens:0,requestCount:0,[key]:1};
    if(key==='inputTokens') {large.totalTokens=large.inputTokens;small.totalTokens=small.inputTokens;}
    const raw={provider:'claude-code',status:'ok',days:[{date:'2026-09-24',...large,models:[{model:'claude-private-alpha',...large},{model:'claude-private-beta',...small}]}]};
    assert.throws(()=>cleanClaudeTokenSource(raw,'Windows'),/Claude counter overflow/);
  }
});

test('disabled source is not counted and enabled failure is Unknown, not zero',()=>{
  const disabled=unavailableClaudeTokenSource('Mac','2026-09-25T00:00:00Z','not-connected');
  assert.deepEqual(disabled.days,undefined);
  const result={data:{},status:{sourcesRead:2,sourcesConfigured:2,state:'ok'}};
  result.peer={payload:{codex:[{host:'Mac'}]}};
  attachProviderTokenSources(result,[disabled,unavailableClaudeTokenSource('Windows','2026-09-25T00:00:00Z')]);
  assert.equal(result.status.sourcesConfigured,3);
  assert.equal(result.status.sourcesRead,2);
  assert.equal(result.status.state,'partial');
  assert.equal(result.peer.payload.providerTokenSources,undefined);
});

test('collector Python invocation passes the Claude root as its explicit argument',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'observatory-claude-integration-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'projects','fixture','usage.jsonl');
  await mkdir(path.dirname(file),{recursive:true});
  await writeFile(file,JSON.stringify({type:'assistant',timestamp:'2026-09-25T04:30:00Z',requestId:'r1',message:{role:'assistant',id:'m1',model:'claude-opus-5-5',usage:{input_tokens:1,cache_read_input_tokens:2,cache_creation_input_tokens:3,output_tokens:4},content:'PRIVATE'}})+'\n');
  const reader=await readFile(new URL('./read-claude-usage.py',import.meta.url),'utf8');
  const command=pythonTestCommand(['-I','-',root]);
  const run=spawnSync(command.executable,command.args,{cwd:path.resolve('.'),input:reader,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const source=cleanClaudeTokenSource(JSON.parse(run.stdout),'Mac');
  assert.equal(source.days[0].totalTokens,10);
  assert.equal(source.days[0].models[0].model,'claude-opus-5-5');
  assert.ok(!JSON.stringify(source).includes('PRIVATE'));
});
