import test from 'node:test';
import assert from 'node:assert/strict';
import {attachProviderTokenSources,cleanClaudeTokenSource,unavailableClaudeTokenSource} from './provider-token-sources.mjs';

const counters={inputTokens:5,cacheReadTokens:2,cacheCreationTokens:0,outputTokens:3,totalTokens:10,requestCount:1};
const report={days:[{date:'2026-09-24',...counters,models:[{model:'claude-sonnet-4-5',...counters,privateId:'PRIVATE'}]}]};

test('Claude records are sanitized, internally reconciled, and sorted',()=>{
  const source=cleanClaudeTokenSource(report,'Mac','2026-09-25T00:00:00Z');
  assert.equal(source.provider,'claude-code');
  assert.equal(source.scope,'Recorded Claude Code requests');
  assert.ok(!JSON.stringify(source).includes('PRIVATE'));
  assert.equal(source.days[0].models[0].model,'claude-sonnet-4-5');
  assert.equal(cleanClaudeTokenSource({days:[{...report.days[0],models:[{...report.days[0].models[0],model:'raw-private-model'}]}]},'Windows').days[0].models[0].model,'unknown');
  assert.throws(()=>cleanClaudeTokenSource({days:[{...report.days[0],totalTokens:11}]},'Mac'));
  assert.throws(()=>cleanClaudeTokenSource({days:[report.days[0],report.days[0]]},'Mac'));
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
