import test from 'node:test';
import assert from 'node:assert/strict';
import {combine,ownRows,carriedDevice,sum,SUM_LABEL} from '../lib/combine.mjs';
import {ownSnapshot} from './helpers.mjs';

const now=Date.parse('2026-10-21T17:00:00Z');

test('rows a computer received from a paired device are not reused',()=>{
  const mac=ownSnapshot('Mac',now);
  mac.tokens.push({host:'Windows',status:'ok',days:[{date:'2026-10-21',totalTokens:999}]});
  const rows=ownRows(mac,'Mac');
  assert.ok(rows.tokens.every(row=>row.host==='Mac'));
  assert.ok(rows.activity.every(row=>row.host==='Mac'));
});

test('two fresh computers combine into per-device numbers and a labeled sum',()=>{
  const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',snapshot:ownSnapshot('Windows',now)}],{now,generatedBy:'Mac'});
  assert.equal(combined.schema,'observatory-combined/1');
  const [mac,pc]=combined.glance.today;
  assert.equal(mac.name,'Test Mac');assert.equal(pc.name,'Test PC');
  assert.equal(typeof mac.seconds,'number');assert.equal(typeof pc.seconds,'number');
  assert.equal(combined.glance.both.label,SUM_LABEL);
  assert.equal(combined.glance.both.seconds,mac.seconds+pc.seconds);
  assert.equal(combined.glance.both.tokens,mac.tokens+pc.tokens);
  assert.ok(combined.glance.lines.some(line=>line.includes('not deduplicated')));
  // The merged view keeps exactly one row per host for the viewer.
  assert.deepEqual(combined.view.activity.map(row=>row.host).sort(),['Mac','Windows']);
  assert.deepEqual(combined.view.tokens.map(row=>row.host).sort(),['Mac','Windows']);
  assert.equal(combined.devices.every(device=>!device.stale),true);
});

test('limits are never added: the freshest reading wins',()=>{
  const older=ownSnapshot('Mac',now,snapshot=>({...snapshot,quota:{...snapshot.quota,checkedAt:new Date(now-30*60000).toISOString(),
    windows:snapshot.quota.windows.map(row=>({...row,remainingPercent:10}))}}));
  const newer=ownSnapshot('Windows',now,snapshot=>({...snapshot,quota:{...snapshot.quota,checkedAt:new Date(now-60000).toISOString(),
    windows:snapshot.quota.windows.map(row=>({...row,remainingPercent:70}))}}));
  const combined=combine([{host:'Mac',snapshot:older},{host:'Windows',snapshot:newer}],{now});
  assert.equal(combined.view.quota.observedOn,'Windows');
  const codex=combined.glance.limits.filter(row=>row.provider==='codex' && row.remaining!==null);
  assert.ok(codex.length>0);
  assert.ok(codex.every(row=>row.remaining===70 && row.from==='Windows'));
});

test('a missing computer is Unknown, and so is the sum, never zero',()=>{
  const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',name:'PC',snapshot:null,error:'unreachable'}],{now});
  const pc=combined.glance.today[1];
  assert.equal(pc.missing,true);
  assert.equal(pc.seconds,null);assert.equal(pc.tokens,null);
  assert.equal(combined.glance.both.seconds,null);assert.equal(combined.glance.both.tokens,null);
  assert.ok(combined.glance.lines.some(line=>line.includes('PC: Unknown')));
  assert.ok(combined.glance.lines.some(line=>line.startsWith('  Both: Unknown')));
  assert.equal(combined.view.activity.find(row=>row.host==='Windows').status,'unavailable');
  assert.equal(combined.devices[1].stale,true);
});

test('an unplugged computer shows its age and Unknown for today, not zero',()=>{
  const pc=ownSnapshot('Windows',now-2*3600000);
  const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',snapshot:pc,error:'unreachable'}],{now});
  const row=combined.glance.today[1];
  assert.equal(row.freshness.stale,true);
  assert.equal(row.seconds,null);
  assert.equal(row.tokens,null);
  assert.equal(combined.glance.both.tokens,null);
  assert.equal(combined.devices[1].stale,true);
});

test('a spoke can recombine from a device carried in combined.json',()=>{
  const first=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',snapshot:ownSnapshot('Windows',now)}],{now});
  const carried=carriedDevice(JSON.parse(JSON.stringify(first)),'Mac');
  assert.equal(carried.name,'Test Mac');
  const again=combine([carried,{host:'Windows',snapshot:ownSnapshot('Windows',now)}],{now});
  assert.equal(again.glance.today[0].seconds,first.glance.today[0].seconds);
  assert.equal(again.glance.today[0].tokens,first.glance.today[0].tokens);
});

test('one computer alone has no sum line',()=>{
  const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)}],{now});
  assert.equal(combined.glance.both,null);
  assert.ok(!combined.glance.lines.some(line=>line.includes('Both')));
  assert.equal(combined.view.activity.find(row=>row.host==='Windows').status,'not-connected');
});

test('sum is Unknown when any part is Unknown',()=>{
  assert.equal(sum([1,2]),3);
  assert.equal(sum([1,null]),null);
  assert.equal(sum([]),null);
});

test('two entries for the same host are refused',()=>{
  assert.throws(()=>combine([{host:'Mac',snapshot:null},{host:'Mac',snapshot:null}],{now}),/distinct host/);
});

test('a limit reading dated in the future does not win',()=>{
  const ahead=ownSnapshot('Windows',now,snapshot=>({...snapshot,quota:{...snapshot.quota,checkedAt:new Date(now+3600000).toISOString(),
    windows:snapshot.quota.windows.map(row=>({...row,remainingPercent:5}))}}));
  const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',snapshot:ahead}],{now});
  assert.equal(combined.view.quota.observedOn,'Mac');
});

test('menu lines carry clock times, never an age that goes out of date',()=>{
  const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',snapshot:ownSnapshot('Windows',now)}],{now});
  assert.ok(combined.glance.lines.some(line=>line.includes('as of ')));
  assert.ok(!combined.glance.lines.some(line=>/ ago\b|Updated/.test(line)));
});

test('one computer gets its largest categories and cost by provider, and an unknown part keeps the total unknown',()=>{
  const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)}],{now});
  const mac=combined.glance.today[0];
  assert.ok(mac.categories.length>0 && mac.categories.every(row=>row.seconds>0));
  assert.ok(mac.categories.every((row,index,list)=>index===0 || list[index-1].seconds>=row.seconds));
  assert.equal(typeof mac.costs.claude,'number');
  assert.equal(typeof mac.costs.codex,'number');
  assert.equal(Math.round((mac.costs.claude+mac.costs.codex)*100),Math.round(mac.usd*100));
  const noClaudePrice=ownSnapshot('Mac',now,s=>({...s,providerTokenSources:s.providerTokenSources.map(row=>({...row,days:row.days.map(day=>({...day,apiEstimate:undefined}))}))}));
  const unknown=combine([{host:'Mac',snapshot:noClaudePrice}],{now}).glance.today[0];
  if(unknown.claudeTokens>0)assert.equal(unknown.usd,null);
});

test('agent rows in an older snapshot are dropped and never reach the menu or the page',()=>{
  const now=Date.parse('2026-10-21T17:00:00Z');
  const at=new Date(now).toISOString();
  const old=ownSnapshot('Windows',now,s=>({...s,agentActivity:[{host:'Windows',status:'ok',checkedAt:at,claudeStatus:'ok',codexStatus:'ok',
    sessions:[{tool:'claude-code',status:'waiting',project:'secret-project',name:'Private session',updatedAt:at}],jobs:[]}]}));
  const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',snapshot:old}],{now});
  const text=JSON.stringify(combined);
  for(const gone of ['agentActivity','secret-project','Private session','waiting on you','"waiting"','"agents"'])assert.ok(!text.includes(gone),gone);
  assert.ok(!combined.glance.lines.includes('Agents'));
});
