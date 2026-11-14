import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,appendFile,symlink,stat,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {driftFromLines,driftRow,collectModelDrift,readModelDriftRoots} from '../scripts/read-model-drift.mjs';
import {driftView,lastDays,runLabel,binOf,histogramMedian,MIN_REPLIES,MODEL_NAME} from '../lib/drift.mjs';
import {sampleDriftRow} from '../lib/sample-drift.mjs';
import {combine} from '../lib/combine.mjs';
import {ownSnapshot} from './helpers.mjs';

const SECRET='private-prompt-marker';
const readFileText=async file=>(await import('node:fs/promises')).readFile(file,'utf8');
const line=value=>JSON.stringify(value);
const user=(at,text=SECRET)=>line({type:'user',timestamp:at,cwd:`/Users/someone/${SECRET}`,message:{role:'user',content:text}});
const reply=(at,{id='msg_1',model='claude-opus-5-5',output=300,thinkingMs,effort='high',text=SECRET}={})=>line({type:'assistant',timestamp:at,
  cwd:`/Users/someone/${SECRET}`,effort,...(thinkingMs===undefined?{}:{thinkingDurationMs:thinkingMs}),
  message:{id,model,usage:{output_tokens:output},content:[{type:'text',text}]}});
const retry=at=>line({type:'system',subtype:'api_error',timestamp:at,retryAttempt:1,error:{message:SECRET}});

test('a transcript becomes per-model daily numbers and keeps no text',()=>{
  const days=driftFromLines([
    user('2026-11-10T10:00:00Z'),
    reply('2026-11-10T10:00:04Z',{thinkingMs:3000,output:120}),
    reply('2026-11-10T10:00:06Z',{output:350}),
    retry('2026-11-10T10:00:07Z'),
    line({type:'assistant',timestamp:'2026-11-10T10:00:08Z',isApiErrorMessage:true,message:{model:'<synthetic>',content:[{type:'text',text:SECRET}]}}),
    user('2026-11-10T10:01:00Z'),
    reply('2026-11-10T10:01:10Z',{id:'msg_2',model:'claude-sonnet-5-5',output:40,effort:'medium'}),
  ],{timeZone:'UTC'});
  const opus=days['2026-11-10']['claude-opus-5-5'];
  assert.equal(opus.replies,1,'two lines of one message are one reply');
  assert.equal(opus.retries,2,'a retry line and an error reply both count, against the last model');
  assert.deepEqual(opus.outputTokens,{[binOf(350)]:1},'the largest output count of a message is kept');
  assert.deepEqual(opus.thinking,{[binOf(3)]:1});
  assert.deepEqual(opus.replySeconds,{[binOf(6)]:1},'time runs from the request to the last line of the reply');
  assert.deepEqual(opus.efforts,{high:1});
  assert.equal(days['2026-11-10']['claude-sonnet-5-5'].replies,1);
  const row=driftRow(days,{now:new Date('2026-11-12T00:00:00Z'),timeZone:'UTC'});
  assert.ok(!JSON.stringify(row).includes(SECRET));
  assert.ok(!JSON.stringify(row).includes('/Users/'));
});

test('a reply long after its request counts as a reply but not as time spent',()=>{
  const days=driftFromLines([user('2026-11-10T10:00:00Z'),reply('2026-11-10T11:00:00Z')],{timeZone:'UTC'});
  const stats=days['2026-11-10']['claude-opus-5-5'];
  assert.equal(stats.replies,1);
  assert.deepEqual(stats.replySeconds,{});
});

const day=(date,{replies=60,thinking=4,retries=0,effort={high:replies}}={})=>({date,models:[{model:'claude-opus-5-5',replies,retries,
  thinking:[binOf(thinking),replies],replySeconds:[binOf(8),replies],outputTokens:[binOf(500),replies],
  efforts:{low:0,medium:0,high:0,xhigh:0,max:0,other:0,unset:0,...effort}}]});

test('a day far from the model\'s normal is flagged, a steady month is not',()=>{
  const dates=lastDays('2026-11-30',30);
  const steady=dates.map(date=>day(date));
  const [calm]=driftView([{status:'ok',days:steady}],{dates});
  assert.deepEqual(calm.flags,[]);
  const changed=dates.map(date=>day(date,date==='2026-11-30'?{thinking:1.5}:{}));
  const [model]=driftView([{status:'ok',days:changed}],{dates});
  assert.deepEqual(model.flags.map(flag=>[flag.date,flag.metric,flag.direction]),[['2026-11-30','thinking','down']]);
  assert.equal(model.flags[0].effort,null,'effort did not change');
  const point=model.series.thinking.at(-1);
  assert.ok(point.flagged && point.value<point.low);
});

test('a quiet day is never judged, and a changed effort is named next to a flag',()=>{
  const dates=lastDays('2026-11-30',30);
  const quiet=dates.map(date=>day(date,date==='2026-11-30'?{replies:MIN_REPLIES-1,thinking:0.5}:{}));
  const [model]=driftView([{status:'ok',days:quiet}],{dates});
  assert.equal(model.series.thinking.at(-1).value,null);
  assert.deepEqual(model.flags,[]);
  const effort=dates.map(date=>day(date,date==='2026-11-30'?{thinking:12,effort:{max:60}}:{}));
  const [shifted]=driftView([{status:'ok',days:effort}],{dates});
  assert.equal(shifted.flags[0].effort.now.name,'max');
  assert.equal(shifted.flags[0].effort.before.name,'high');
});

test('retries per 100 replies are flagged on a bad day',()=>{
  const dates=lastDays('2026-11-30',30);
  const rows=dates.map(date=>day(date,date==='2026-11-20'?{retries:12}:{}));
  const [model]=driftView([{status:'ok',days:rows}],{dates});
  assert.deepEqual(model.flags.map(flag=>[flag.date,flag.metric]),[['2026-11-20','retries']]);
});

test('two computers add up before the median is taken',()=>{
  const dates=lastDays('2026-11-30',1);
  const [model]=driftView([{status:'ok',days:[day('2026-11-30',{replies:10})]},{status:'ok',days:[day('2026-11-30',{replies:15})]}],{dates});
  assert.equal(model.replies,25);
  assert.notEqual(model.series.thinking[0].value,null,'25 replies together pass the bar 10 and 15 alone do not');
  assert.equal(histogramMedian(new Map([[binOf(2),3],[binOf(9),1]])).value>1.5,true);
});

test('the fictional sample tells its story: a recent drop, a retry day and an effort day',()=>{
  const dates=lastDays('2026-11-30',45);
  const [opus,sonnet]=driftView([sampleDriftRow('Mac',{dates,checkedAt:'2026-11-30T12:00:00Z'})],{dates:dates.slice(-30)});
  assert.equal(opus.model,'claude-opus-5-5');
  const flagged=metric=>opus.flags.filter(flag=>flag.metric===metric).map(flag=>flag.date);
  assert.ok(flagged('thinking').includes('2026-11-30'));
  assert.ok(opus.flags.some(flag=>flag.effort?.now.name==='max'));
  assert.ok(sonnet.flags.some(flag=>flag.metric==='retries' && flag.date==='2026-11-21'));
});

test('combined drift rows keep numbers and model names only',()=>{
  const now=Date.parse('2026-11-30T17:00:00Z');
  const peer=ownSnapshot('Windows',now);
  const expected=combine([{host:'Windows',snapshot:peer}],{now});
  assert.ok(expected.view.modelDrift.length>0);
  const plant=value=>{
    if(Array.isArray(value))value.forEach(plant);
    else if(value && typeof value==='object') {for(const nested of Object.values(value))plant(nested);value.prompt=SECRET;}
  };
  plant(peer.modelDrift);
  const combined=combine([{host:'Windows',snapshot:peer}],{now});
  assert.deepEqual(combined.view.modelDrift,expected.view.modelDrift);
  assert.ok(!JSON.stringify(combined).includes(SECRET));
});

test('a model name this version does not know drops that entry, not the whole computer',()=>{
  const now=Date.parse('2026-11-30T17:00:00Z');
  const peer=ownSnapshot('Windows',now);
  const expected=combine([{host:'Windows',snapshot:peer}],{now});
  const day=peer.modelDrift[0].days.at(-1);
  day.models.push({...day.models[0],model:'claude-newfamily-9'},{...day.models[0],model:`proxy/${SECRET}`});
  const combined=combine([{host:'Windows',snapshot:peer}],{now});
  assert.equal(combined.devices[0].error,undefined);
  assert.deepEqual(combined.view.modelDrift,expected.view.modelDrift);
  assert.deepEqual(combined.view.tokens,expected.view.tokens);
  assert.ok(!JSON.stringify(combined).includes('newfamily') && !JSON.stringify(combined).includes(SECRET));
});

test('a run of flagged days is labelled by its first and last day',()=>{
  assert.equal(runLabel('2026-11-03','2026-11-03'),'Nov 3');
  assert.equal(runLabel('2026-11-03','2026-11-05'),'Nov 3–5');
  assert.equal(runLabel('2026-10-30','2026-11-02'),'Oct 30–Nov 2');
  assert.equal(runLabel('2026-12-31','2027-01-01'),'Dec 31–Jan 1');
});

test('the folder reader walks projects, reuses its cache and skips links',async()=>{
  const home=await mkdtemp(path.join(tmpdir(),'drift-'));
  try {
    const folder=path.join(home,'.claude','projects','some-project');
    await mkdir(folder,{recursive:true});
    const file=path.join(folder,'session.jsonl');
    await writeFile(file,[user('2026-11-10T10:00:00Z'),reply('2026-11-10T10:00:05Z')].join('\n')+'\n');
    const cache=path.join(home,'cache');
    await mkdir(cache);
    // A linked file and a linked folder, both pointing outside projects, must not be counted.
    const outside=path.join(home,'outside');
    await mkdir(outside);
    await writeFile(path.join(outside,'other.jsonl'),[user('2026-11-10T11:00:00Z'),reply('2026-11-10T11:00:05Z',{id:'msg_out'})].join('\n')+'\n');
    await symlink(path.join(outside,'other.jsonl'),path.join(folder,'linked.jsonl'));
    await symlink(outside,path.join(home,'.claude','projects','linked-folder'));
    // A whole-second modified time, so it can be set again exactly.
    const stamp=new Date(Math.floor(Date.now()/1000)*1000);
    await utimes(file,stamp,stamp);
    const first=await collectModelDrift(path.join(home,'.claude'),{cacheDirectory:cache,timeZone:'UTC'});
    assert.equal(first.days['2026-11-10']['claude-opus-5-5'].replies,1);
    // Same size and modified time, different content: the cached numbers are used, so the file was not read again.
    const size=(await stat(file)).size;
    await writeFile(file,(await readFileText(file)).replace('claude-opus-5-5','claude-opus-5-6'));
    await utimes(file,stamp,stamp);
    assert.equal((await stat(file)).size,size);
    const cached=await collectModelDrift(path.join(home,'.claude'),{cacheDirectory:cache,timeZone:'UTC'});
    assert.deepEqual(cached.days,first.days);
    await writeFile(file,(await readFileText(file)).replace('claude-opus-5-6','claude-opus-5-5'));
    await appendFile(file,[user('2026-11-10T10:02:00Z'),reply('2026-11-10T10:02:05Z',{id:'msg_9'})].join('\n')+'\n');
    const second=await collectModelDrift(path.join(home,'.claude'),{cacheDirectory:cache,timeZone:'UTC'});
    assert.equal(second.days['2026-11-10']['claude-opus-5-5'].replies,2,'a grown file is read again');
    const missing=await readModelDriftRoots([{claudeFolder:path.join(home,'absent')}]);
    assert.equal(missing.status,'not-found');
    assert.equal((await readModelDriftRoots([{unreadable:true}])).status,'unavailable');
  } finally {await rm(home,{recursive:true,force:true});}
});

test('collect adds a drift row only while Claude Code is turned on',async()=>{
  const {buildSnapshot}=await import('../scripts/collect.mjs');
  const {testConfig}=await import('./helpers.mjs');
  const at=new Date('2026-11-30T12:00:00Z');
  const days=[day('2026-11-30')];
  const readers={claudeCode:async()=>({status:'ok',days:[]}),modelDrift:async()=>({status:'ok',days}),claudeLimits:async()=>{throw Error('none');}};
  const config=testConfig('/unused',{sources:{claudeCode:true}});
  const on=await buildSnapshot(config,readers,{now:at});
  assert.deepEqual(on.data.modelDrift,[{host:'Mac',status:'ok',checkedAt:at.toISOString(),days}]);
  const off=await buildSnapshot(testConfig('/unused',{sources:{claudeCode:false}}),readers,{now:at});
  assert.equal(off.data.modelDrift[0].status,'not-connected');
  const failing=await buildSnapshot(config,{...readers,modelDrift:async()=>{throw Error('unreadable');}},{now:at});
  assert.equal(failing.data.modelDrift[0].status,'unavailable');
});

test('the normal is taken from calendar days, so busy days long ago do not judge today',()=>{
  const dates=lastDays('2026-11-30',90);
  const rows=dates.map(date=>date<'2026-09-20' || date==='2026-11-30'?day(date,date==='2026-11-30'?{thinking:1}:{}):null).filter(Boolean);
  const [model]=driftView([{status:'ok',days:rows}],{dates:dates.slice(-30)});
  assert.equal(model.series.thinking.at(-1).center,null);
  assert.deepEqual(model.flags,[]);
});

test('old files are skipped and a set over the size cap is unavailable, not partial',async()=>{
  const home=await mkdtemp(path.join(tmpdir(),'drift-'));
  try {
    const folder=path.join(home,'.claude','projects','p');
    await mkdir(folder,{recursive:true});
    const fresh=path.join(folder,'fresh.jsonl'),old=path.join(folder,'old.jsonl');
    await writeFile(fresh,[user('2026-11-10T10:00:00Z'),reply('2026-11-10T10:00:05Z')].join('\n')+'\n');
    await writeFile(old,[user('2026-08-01T10:00:00Z'),reply('2026-08-01T10:00:05Z',{id:'msg_old'})].join('\n')+'\n');
    const {utimes}=await import('node:fs/promises');
    await utimes(old,new Date('2026-08-01T12:00:00Z'),new Date('2026-08-01T12:00:00Z'));
    const now=new Date('2026-11-12T00:00:00Z');
    await utimes(fresh,now,now);
    const result=await collectModelDrift(path.join(home,'.claude'),{timeZone:'UTC',now});
    assert.deepEqual(Object.keys(result.days),['2026-11-10']);
    const capped=await collectModelDrift(path.join(home,'.claude'),{timeZone:'UTC',now,maxBytes:10});
    assert.equal(capped.status,'unavailable');
  } finally {await rm(home,{recursive:true,force:true});}
});

test('an oversized line is dropped while reading, the lines around it are kept',async()=>{
  const {boundedLines}=await import('../scripts/read-model-drift.mjs');
  const {Readable}=await import('node:stream');
  const chunks=['short one\nhuge-','x'.repeat(50),'-tail\r\nlast',' line'].map(text=>Buffer.from(text));
  const lines=[];
  for await(const line of boundedLines(Readable.from(chunks),20))lines.push(line);
  assert.deepEqual(lines,['short one','last line']);
});

test('one retry on a quiet day is not drift',()=>{
  const dates=lastDays('2026-11-30',30);
  const rows=dates.map(date=>day(date,date==='2026-11-30'?{replies:20,retries:1}:{}));
  const [model]=driftView([{status:'ok',days:rows}],{dates});
  assert.deepEqual(model.flags,[]);
});

test('a dated name joins its alias, and names outside the Claude families are not counted',()=>{
  const dates=lastDays('2026-11-30',1);
  const named=(model,replies)=>({date:'2026-11-30',models:[{...day('2026-11-30',{replies}).models[0],model}]});
  const models=driftView([{status:'ok',days:[named('claude-sonnet-4-5',10)]},{status:'ok',days:[named('claude-sonnet-4-5-20250929',15)]}],{dates});
  assert.deepEqual(models.map(entry=>[entry.model,entry.replies]),[['claude-sonnet-4-5',25]]);
  for(const name of ['claude-opus-5-5','claude-3-5-sonnet-20241022','claude-fable-5-1'])assert.ok(MODEL_NAME.test(name),name);
  for(const name of ['claude-acme-merger-project-x.internal','claude-opus-5-5-client','<synthetic>'])assert.ok(!MODEL_NAME.test(name),name);
});

test('a call made after a tool result is timed from that tool result, not from the prompt',()=>{
  const toolResult=at=>line({type:'user',timestamp:at,message:{role:'user',content:[{type:'tool_result',content:SECRET}]}});
  const days=driftFromLines([
    user('2026-11-10T10:00:00Z'),
    reply('2026-11-10T10:00:05Z',{id:'msg_a'}),
    toolResult('2026-11-10T10:01:05Z'),
    reply('2026-11-10T10:01:09Z',{id:'msg_b'}),
  ],{timeZone:'UTC'});
  assert.deepEqual(days['2026-11-10']['claude-opus-5-5'].replySeconds,{[binOf(5)]:1,[binOf(4)]:1},'5 s and 4 s, never the 69 s that includes the tool run');
});
