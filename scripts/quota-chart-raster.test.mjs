import test from 'node:test';
import assert from 'node:assert/strict';
import {rasterQuotaTimeline} from './quota-chart-raster.mjs';
const start=Date.parse('2025-01-01T12:00:00Z');
const row=(seconds,remaining=50,reset='same')=>({checkedAt:new Date(start+seconds*1000).toISOString(),
  windows:[{bucket:'codex',window:'primary',remainingPercent:remaining,resetsAt:reset}]});
const draw=(records,extra={})=>rasterQuotaTimeline(records,{from:start,to:start+1200000,bucket:'codex',window:'primary',width:121,height:101,...extra});
test('contiguous observations use solid ink and retain exact extrema',()=>{
  const image=draw([row(0,80),row(300,70)]),pixels=Buffer.from(image.pixels,'base64');
  assert.equal(image.observations,2);assert.equal(image.gaps,0);
  assert.equal(image.minUsed,20);assert.equal(image.maxUsed,30);
  assert.ok(pixels.includes(1));assert.ok(!pixels.includes(2));
});
test('short explicit failures and long missing windows are dashed, not zeros',()=>{
  for(const records of [[row(0),{checkedAt:row(60).checkedAt,status:'unavailable'},row(300)], [row(0),row(900)]]) {
    const image=draw(records),pixels=Buffer.from(image.pixels,'base64');
    assert.equal(image.observations,2);assert.equal(image.gaps,1);assert.ok(pixels.includes(2));
    assert.ok(!pixels.includes(1));assert.equal(image.minUsed,50);assert.equal(image.maxUsed,50);
  }
});
test('unknown edges have no invented endpoint, and resets have no bridge',()=>{
  const image=draw([{checkedAt:row(0).checkedAt,status:'unavailable'},row(300),row(600,90,'next'),{checkedAt:row(1200).checkedAt,status:'unavailable'}]);
  const pixels=Buffer.from(image.pixels,'base64');
  assert.equal(image.observations,2);assert.equal(image.segments,2);assert.equal(image.gaps,0);
  assert.equal(pixels.filter(value=>value!==0).length,2);
  assert.equal(image.firstAt,start+300000);assert.equal(image.lastAt,start+600000);
});
test('large archives are consumed once into a fixed-size mask without truncation',()=>{
  function* records(){for(let index=0;index<100001;index++)yield row(index);}
  const image=draw(records(),{to:start+100000000,width:1024,height:160});
  assert.equal(image.observations,100001);assert.equal(image.scanned,100001);
  assert.equal(Buffer.from(image.pixels,'base64').length,1024*160);
  assert.equal(image.lastAt,start+100000000);assert.equal(image.gaps,0);
});
test('invalid ranges and out-of-order timelines fail instead of misrepresenting coverage',()=>{
  assert.throws(()=>draw([],{width:2000}));
  assert.throws(()=>draw([],{to:start}));
  assert.throws(()=>draw([row(300),row(0)]));
});
