import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execPython} from './test-python.mjs';

const script='scripts/read-claude-usage.py';
const event=(id,requestId,usage,{timestamp='2026-09-25T04:30:00Z',model='claude-sonnet-4-20250514',type='assistant'}={})=>JSON.stringify({type,timestamp,requestId,message:{role:'assistant',id,model,usage,content:'PRIVATE'}})+'\n';
const usage=(input_tokens,cache_read_input_tokens,cache_creation_input_tokens,output_tokens)=>({input_tokens,cache_read_input_tokens,cache_creation_input_tokens,output_tokens});
function read(root){return JSON.parse(execPython([script,root]).toString());}
async function fixture(action){const root=await mkdtemp(path.join(tmpdir(),'observatory-claude-'));try{await action(root);}finally{await rm(root,{recursive:true,force:true});}}
async function log(root,name,body){const file=path.join(root,'projects','a',name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,body);return file;}

test('keeps the final monotone streamed snapshot and separately counts cache categories',async()=>fixture(async root=>{
  await log(root,'one.jsonl',event('m1','r1',usage(1,0,0,2))+event('m1','r1',usage(4,8,16,1093)));
  const data=read(root);assert.equal(data.status,'ok');assert.deepEqual(data.days[0].models[0],{model:'claude-sonnet-4-20250514',inputTokens:4,cacheReadTokens:8,cacheCreationTokens:16,outputTokens:1093,totalTokens:1121,requestCount:1});
}));
test('requires Claude assistant envelopes, rejects malformed nonblank lines, and assigns midnight streams to their first day',async()=>fixture(async root=>{
  await log(root,'one.jsonl',event('m1','r1',usage(1,0,0,2),{type:'system'}));assert.equal(read(root).status,'unavailable');
  await rm(path.join(root,'projects'),{recursive:true});await log(root,'one.jsonl','{bad json}\n');assert.equal(read(root).status,'unavailable');
  await rm(path.join(root,'projects'),{recursive:true});await log(root,'one.jsonl',event('m1','r1',usage(1,0,0,2),{timestamp:'2026-09-25T03:59:59Z'})+event('m1','r1',usage(2,0,0,3),{timestamp:'2026-09-25T04:00:01Z'}));
  assert.equal(read(root).days[0].date,'2026-09-24');
}));
test('deduplicates copied logs, keeps separate identities, and retains old dates',async()=>fixture(async root=>{
  const first=event('m1','r1',usage(1,2,3,4),{timestamp:'2024-01-01T03:00:00Z'});await log(root,'one.jsonl',first+event('m2','r2',usage(5,0,0,6),{timestamp:'2024-01-01T03:00:00Z'}));await log(root,'nested/copy.jsonl',first);
  const data=read(root);assert.equal(data.days.length,1);assert.equal(data.days[0].requestCount,2);assert.equal(data.days[0].totalTokens,21);assert.equal(data.days[0].date,'2023-12-31');
}));
test('fails closed for absent assistant usage, malformed identity, invalid counters, and incomparable snapshots',async()=>fixture(async root=>{
  await log(root,'empty.jsonl','{}\n');assert.equal(read(root).status,'unavailable');
  await log(root,'bad.jsonl',event('m','',usage(1,0,0,1)));assert.equal(read(root).status,'unavailable');
  await rm(path.join(root,'projects'),{recursive:true});await log(root,'bad.jsonl',event('m','r',usage(-1,0,0,1)));assert.equal(read(root).status,'unavailable');
  await rm(path.join(root,'projects'),{recursive:true});await log(root,'bad.jsonl',event('m','r',usage(2,0,0,1))+event('m','r',usage(1,1,0,1)));assert.equal(read(root).status,'unavailable');
  await rm(path.join(root,'projects'),{recursive:true});await log(root,'bad.jsonl',event('m','r',usage(2**53,0,0,1)));assert.equal(read(root).status,'unavailable');
  await rm(path.join(root,'projects'),{recursive:true});await log(root,'bad.jsonl',event('m','r',usage(1,0,0,1))+event('m','r',usage(2,0,0,2),{model:'claude-opus-4-1-20250805'}));assert.equal(read(root).status,'unavailable');
}));
test('reports missing projects as not-found and refuses symlinked logs without leaking content',async()=>fixture(async root=>{
  assert.equal(read(root).status,'not-found');const outside=path.join(root,'outside.jsonl');await writeFile(outside,event('m','r',usage(1,0,0,1)));const linked=path.join(root,'projects','a','linked.jsonl');await mkdir(path.dirname(linked),{recursive:true});await symlink(outside,linked);
  const output=JSON.stringify(read(root));assert.equal(JSON.parse(output).status,'unavailable');assert.ok(!output.includes('PRIVATE'));assert.ok(!output.includes('outside'));
}));
test('reports a missing root as unavailable',()=>assert.equal(read('/definitely-not-an-observatory-claude-root').status,'unavailable'));
