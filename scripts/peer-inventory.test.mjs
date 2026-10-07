import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePeerInventory,combinePeerTokens} from './peer-inventory.mjs';

const comparisonId='a'.repeat(64), hosts=['Mac','Windows'];
const counts={inputTokens:10,cacheReadTokens:0,cacheCreationTokens:0,outputTokens:2,reasoningOutputTokens:0,totalTokens:12};
const sources=()=>hosts.map(host=>({host,status:'ok',days:[{date:'2026-09-09',...counts,models:[{model:'unknown',inferred:true,...counts}]}]}));
const evidence=()=>hosts.map((host,i)=>({version:1,comparisonId,host,status:'ok',keys:[String(i).repeat(64)],parents:[]}));
const evidenceHosts=[...hosts,'Ubuntu'];
const retiredEvidence=()=>[...evidence(),{version:1,comparisonId,host:'Ubuntu',status:'ok',keys:['2'.repeat(64)],parents:[]}];

test('same-generation disjoint peer inventories permit totals without exporting evidence',()=>{
  const result=combinePeerTokens(sources(),evidence(),comparisonId,hosts);
  assert.equal(result.status,'ok');assert.equal(result.days[0].totalTokens,24);
  for(const secret of [comparisonId,'0'.repeat(64),'1'.repeat(64),'comparisonId','parents'])
    assert.ok(!JSON.stringify(result).includes(secret));
});

test('salt rotation or mismatched generations cannot falsely establish disjointness',()=>{
  const rows=evidence();rows[1].comparisonId='b'.repeat(64);
  assert.equal(combinePeerTokens(sources(),rows,comparisonId,hosts).status,'unverified');
  assert.equal(combinePeerTokens(sources(),evidence(),'b'.repeat(64),hosts).status,'unverified');
});

test('raw metadata, wrong identity, oversized evidence and malformed hashes are rejected',()=>{
  for(const patch of [{prompt:'PRIVATE'},{salt:'PRIVATE'},{host:'Ubuntu'},{version:2},
    {keys:['raw-session-id']},{parents:['PRIVATE']},{keys:Array(40001).fill('0'.repeat(64))}])
    assert.throws(()=>validatePeerInventory({...evidence()[0],...patch},'Mac',comparisonId));
  assert.throws(()=>validatePeerInventory(null,'Mac',comparisonId));
});

test('missing, duplicate and incomplete evidence withholds totals',()=>{
  assert.equal(combinePeerTokens(sources(),[],comparisonId,hosts).status,'unverified');
  assert.equal(combinePeerTokens(sources(),[evidence()[0],evidence()[0]],comparisonId,hosts).status,'unverified');
  const rows=evidence();rows[1].status='incomplete';
  assert.equal(combinePeerTokens(sources(),rows,comparisonId,hosts).status,'unverified');
});

test('a missing parent session cannot establish native disjointness',()=>{
  const rows=evidence();rows[1].parents=['2'.repeat(64)];
  const readings=sources(),before=JSON.stringify({readings,rows});
  const result=combinePeerTokens(readings,rows,comparisonId,hosts);
  assert.equal(result.status,'unverified');
  assert.equal(result.days,undefined);
  assert.equal(JSON.stringify({readings,rows}),before);
});

test('ancestry-only evidence bridges native hosts without a retired token source',()=>{
  const cases=[
    ['Mac to Ubuntu to Windows',rows=>{rows[2].parents=rows[0].keys;rows[1].parents=rows[2].keys;}],
    ['Windows to Ubuntu to Mac',rows=>{rows[2].parents=rows[1].keys;rows[0].parents=rows[2].keys;}],
    ['native siblings',rows=>{rows[0].parents=rows[2].keys;rows[1].parents=rows[2].keys;}],
    ['copied sessions',rows=>{rows[2].keys=[...rows[0].keys,...rows[1].keys];}],
    ['multiple retired steps',rows=>{rows[2].keys.push('3'.repeat(64));rows[2].parents=['0'.repeat(64),'2'.repeat(64)];rows[1].parents=['3'.repeat(64)];}],
    ['flattened branches cannot prove disjointness',rows=>{rows[2].parents=[...rows[0].keys,...rows[1].keys];}],
  ];
  for(const [name,mutate] of cases) {
    const rows=retiredEvidence(),readings=sources();mutate(rows);
    const before=JSON.stringify({rows,readings,hosts,evidenceHosts});
    const result=combinePeerTokens(readings,rows,comparisonId,hosts,evidenceHosts);
    assert.equal(result.status,'overlap',name);
    assert.equal(result.days,undefined,name);
    assert.deepEqual(combinePeerTokens([...readings].reverse(),[...rows].reverse(),comparisonId,
      [...hosts].reverse(),[...evidenceHosts].reverse()),result,name);
    assert.equal(JSON.stringify({rows,readings,hosts,evidenceHosts}),before,name);
    for(const secret of ['keys','parents','comparisonId',...'0123'.split('').map(key=>key.repeat(64))])
      assert.ok(!JSON.stringify(result).includes(secret),name);
  }
});

test('complete retired evidence touching only one native permits only native counters',()=>{
  for(const mutate of [()=>{},rows=>{rows[2].parents=rows[0].keys;},rows=>{rows[1].parents=rows[2].keys;},
    rows=>{rows[0].keys.push('3'.repeat(64));rows[0].parents=['3'.repeat(64)];},rows=>{rows[2].keys=[];}]) {
    const rows=retiredEvidence();mutate(rows);
    const result=combinePeerTokens(sources(),rows,comparisonId,hosts,evidenceHosts);
    assert.equal(result.status,'ok');assert.equal(result.verification.status,'verified');
    assert.equal(result.days[0].totalTokens,24);
  }
});

test('ancestry coverage comes from configuration and never from the evidence that arrived',()=>{
  for(const rows of [evidence(),[...evidence(),retiredEvidence()[0]],
    [...retiredEvidence(),retiredEvidence()[2]]])
    assert.equal(combinePeerTokens(sources(),rows,comparisonId,hosts,evidenceHosts).status,'unverified');
  assert.equal(combinePeerTokens(sources(),retiredEvidence(),comparisonId,hosts).status,'unverified');
  for(const scope of [null,[],['Mac','Ubuntu'],['Mac','Windows','Windows'],['Mac','Windows','Other']])
    assert.equal(combinePeerTokens(sources(),retiredEvidence(),comparisonId,hosts,scope).status,'unverified');
  const extra=[...sources(),{...sources()[0],host:'Ubuntu'}];
  assert.equal(combinePeerTokens(extra,retiredEvidence(),comparisonId,hosts,evidenceHosts).status,'unavailable');
});

test('retired evidence remains strict about completeness, identity and salt generation',()=>{
  for(const patch of [{status:'incomplete'},{status:'unavailable'},{comparisonId:'b'.repeat(64)},
    {version:2},{host:'Windows'},{salt:'PRIVATE'},{keys:['raw-session-id']},{parents:['PRIVATE']},
    {parents:null},{keys:Array(40001).fill('2'.repeat(64))}]) {
    const rows=retiredEvidence();Object.assign(rows[2],patch);
    const before=JSON.stringify(rows);
    const result=combinePeerTokens(sources(),rows,comparisonId,hosts,evidenceHosts);
    assert.equal(result.status,'unverified');assert.equal(result.days,undefined);
    assert.equal(JSON.stringify(rows),before);
  }
});

test('an unresolved retired parent withholds totals even without a known native overlap',()=>{
  for(const connected of [false,true]) {
    const rows=retiredEvidence();rows[2].parents=['3'.repeat(64)];
    if(connected)rows[1].parents=rows[2].keys;
    const result=combinePeerTokens(sources(),rows,comparisonId,hosts,evidenceHosts);
    assert.equal(result.status,'unverified');assert.equal(result.days,undefined);
  }
});

test('shared sessions and cross-host parents still block combined totals',()=>{
  const shared=evidence();shared[1].keys=shared[0].keys;
  assert.equal(combinePeerTokens(sources(),shared,comparisonId,hosts).status,'overlap');
  const parent=evidence();parent[1].parents=parent[0].keys;
  assert.equal(combinePeerTokens(sources(),parent,comparisonId,hosts).status,'overlap');
  const duplicate=evidence()[0];duplicate.keys.push(duplicate.keys[0]);
  assert.equal(validatePeerInventory(duplicate,'Mac',comparisonId).keys.length,1);
});
