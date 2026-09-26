import test from 'node:test';
import assert from 'node:assert/strict';
import {tokensFromSettings,windowsCollectorConfig} from './windows-snapshot.mjs';

const profile={date:'2026-09-08',model:'gpt-test',effort:'high',speed:'standard',inputTokens:10,
  cacheReadTokens:20,cacheCreationTokens:0,outputTokens:5,reasoningOutputTokens:3,totalTokens:35};
test('Windows token view reuses saved counters without counting reasoning twice',()=>{
  const result=tokensFromSettings({profiles:[profile,{...profile,effort:'medium'}],tools:[]},'Windows');
  assert.equal(result.days[0].totalTokens,70);
  assert.equal(result.days[0].models.length,1);
  assert.equal(result.days[0].outputTokens,10);
  assert.equal(result.days[0].reasoningOutputTokens,6);
  assert.equal(result.host,'Windows');
});
test('Windows saved counters fail closed and drop unapproved fields',()=>{
  assert.throws(()=>tokensFromSettings({profiles:[{...profile,totalTokens:99}],tools:[]},'Windows'));
  assert.throws(()=>tokensFromSettings({profiles:[{...profile,inputTokens:null}],tools:[]},'Windows'));
  const clean=tokensFromSettings({profiles:[{...profile,prompt:'private'}],tools:[],secret:'private'},'Windows');
  assert.ok(!JSON.stringify(clean).includes('private'));
});
test('WSL collection is optional and settings reject command-like distro names',()=>{
  assert.equal(windowsCollectorConfig().wslDistribution,null);
  assert.equal(windowsCollectorConfig().claude,false);
  assert.equal(windowsCollectorConfig().antigravity,false);
  assert.equal(windowsCollectorConfig({antigravity:true}).antigravity,true);
  assert.throws(()=>windowsCollectorConfig({antigravity:'true'}));
  assert.equal(windowsCollectorConfig({claude:true}).claude,true);
  assert.throws(()=>windowsCollectorConfig({claude:'true'}));
  assert.equal(windowsCollectorConfig({wslDistribution:'Ubuntu-24.04'}).wslDistribution,'Ubuntu-24.04');
  assert.throws(()=>windowsCollectorConfig({wslDistribution:'Ubuntu; whoami'}));
  assert.throws(()=>windowsCollectorConfig({wispr:'true'}));
  assert.equal(windowsCollectorConfig({activity:false}).activity,false);
  assert.equal(windowsCollectorConfig().typewhisper,undefined);
  assert.equal(windowsCollectorConfig({typewhisper:true}).typewhisper,undefined);
  assert.throws(()=>windowsCollectorConfig({typewhisper:1}));
});
