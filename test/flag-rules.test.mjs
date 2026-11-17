import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionFlags,snapshotFlags,FANOUT_MIN_SUBAGENTS,FANOUT_MIN_SHARE,MODEL_FIT_MIN_SHARE,MODEL_FIT_MIN_SAVED_USD,RETRY_MIN,AUTO_RESUME_MIN_SHARE,AUTO_RESUME_MIN_USD} from '../lib/ledger-flags.mjs';
import {weekView,joined} from '../lib/view-week.mjs';
import {sampleLedger} from '../lib/sample-ledger.mjs';
import {combine} from '../lib/combine.mjs';
import {summaryOf} from '../lib/summary.mjs';
import {ownSnapshot} from './helpers.mjs';

const base={subagents:0,shipped:{merges:0},signals:{},kinds:[]};
const kinds=flags=>flags.map(flag=>flag.kind);
const none=()=>null;

test('fan-out needs enough subagents, enough share, and no merge',()=>{
  const ok={...base,subagents:FANOUT_MIN_SUBAGENTS};
  assert.deepEqual(sessionFlags(ok,{share:FANOUT_MIN_SHARE,shareOf:none}),[{kind:'fanout',tone:'warn',values:{subagents:FANOUT_MIN_SUBAGENTS,share:FANOUT_MIN_SHARE,merged:false}}]);
  assert.deepEqual(sessionFlags({...ok,subagents:FANOUT_MIN_SUBAGENTS-1},{share:50,shareOf:none}),[]);
  assert.deepEqual(sessionFlags(ok,{share:FANOUT_MIN_SHARE-0.1,shareOf:none}),[]);
  assert.deepEqual(sessionFlags(ok,{share:null,shareOf:none}),[]);
  assert.deepEqual(sessionFlags({...ok,shipped:{merges:1}},{share:50,shareOf:none}),[]);
  assert.deepEqual(sessionFlags({...ok,shipped:{merges:null}},{share:50,shareOf:none}),[],'an unknown merge count is not a flag');
});

test('model fit uses the window share, and dollars only when the share is unknown',()=>{
  const search=(top,small)=>({...base,kinds:[{kind:'search',model:'claude-opus-5-5',apiUsd:top,subagents:7}],signals:{searchOnTopModelUsd:top,searchOnSmallModelUsd:small}});
  const [flag]=sessionFlags(search(30,10),{share:null,shareOf:usd=>usd/20});
  assert.deepEqual([flag.kind,flag.tone,flag.values.model,flag.values.subagents,flag.values.saved],['model-fit','note','claude-opus-5-5',7,1]);
  assert.deepEqual(sessionFlags(search(30,10),{share:null,shareOf:usd=>usd/20.1}),[],'just under the share');
  assert.deepEqual(sessionFlags(search(100,10),{share:null,shareOf:()=>MODEL_FIT_MIN_SHARE-0.01}),[],'dollars do not count when the share is known');
  assert.equal(kinds(sessionFlags(search(MODEL_FIT_MIN_SAVED_USD+1,1),{share:null,shareOf:none})).join(),'model-fit');
  assert.deepEqual(sessionFlags(search(MODEL_FIT_MIN_SAVED_USD,1),{share:null,shareOf:none}),[]);
});

test('a retry loop starts at the minimum run',()=>{
  const loop=count=>({...base,signals:{longestRetry:count,retryTool:'Shell'}});
  assert.deepEqual(sessionFlags(loop(RETRY_MIN),{share:null,shareOf:none}),[{kind:'retry-loop',tone:'warn',values:{count:RETRY_MIN,tool:'Shell'}}]);
  assert.deepEqual(sessionFlags(loop(RETRY_MIN-1),{share:null,shareOf:none}),[]);
});

test('auto-resume uses the window share, and dollars only when the share is unknown',()=>{
  const resumed=usd=>({...base,signals:{autoResumeUsd:usd}});
  assert.deepEqual(sessionFlags(resumed(4),{share:null,shareOf:usd=>usd/4}),[{kind:'auto-resume',tone:'warn',values:{share:AUTO_RESUME_MIN_SHARE,usd:4}}]);
  assert.deepEqual(sessionFlags(resumed(4),{share:null,shareOf:usd=>usd/4.1}),[]);
  assert.deepEqual(sessionFlags(resumed(100),{share:null,shareOf:()=>0.5}),[]);
  assert.equal(sessionFlags(resumed(AUTO_RESUME_MIN_USD),{share:null,shareOf:none}).length,1);
  assert.deepEqual(sessionFlags(resumed(AUTO_RESUME_MIN_USD-0.5),{share:null,shareOf:none}),[]);
  assert.deepEqual(sessionFlags({...base,signals:{autoResumeUsd:null,longestRetry:null}},{share:null,shareOf:none}),[]);
});

test('the dashboard and the menu bar produce the same flags from one snapshot',()=>{
  const at=Date.parse('2026-11-17T18:40:00Z');
  const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',at)},{host:'Windows',snapshot:ownSnapshot('Windows',at)}],{now:at});
  combined.view.ledger=['Mac','Windows'].map(host=>sampleLedger(at,{host}));
  const summary=summaryOf(combined);
  const page=weekView(summary,{now:at}).flags;
  const titles=new Map(joined(summary).sessions.map(session=>[session.key,session.title]));
  const bar=snapshotFlags(combined);
  assert.ok(page.length>0,'the sample has flags');
  assert.deepEqual(bar.map(flag=>flag.subject),page.map(flag=>titles.get(flag.session)));
  assert.deepEqual(bar.map(flag=>flag.text.split(' ')[0]),page.map(flag=>titles.get(flag.session).split(' ')[0]));
  const last=page.map(flag=>flag.kind).lastIndexOf('retry-loop');
  assert.ok(last<0 || page.slice(last).every(flag=>flag.kind==='retry-loop'),'retry loops come last');
});
