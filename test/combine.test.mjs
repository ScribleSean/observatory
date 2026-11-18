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

test('combined rows retain only consumed fields, including nested rows and limit readings',()=>{
  const peer=ownSnapshot('Windows',now);
  const expected=combine([{host:'Windows',snapshot:peer}],{now});
  const plant=value=>{
    if(Array.isArray(value))value.forEach(plant);
    else if(value && typeof value==='object') {
      for(const [key,nested] of Object.entries(value))if(!['categories','apps'].includes(key))plant(nested);
      value.prompt={token:'private-marker'};
    }
  };
  for(const key of ['activity','tokens','settings','providerTokenSources','activityHistory','quota','claudeLimits','grokLimits'])plant(peer[key]);
  const combined=combine([{host:'Windows',snapshot:peer}],{now});
  assert.deepEqual(combined,expected);
  assert.ok(!JSON.stringify(combined).includes('private-marker'));
  assert.equal(combined.snapshots.Windows.tokens[0].days[0].totalTokens,peer.tokens[0].days[0].totalTokens);
  assert.equal(combined.snapshots.Windows.tokens[0].days[0].models[0].model,peer.tokens[0].days[0].models[0].model);
});

test('an approved scalar field cannot carry a nested private object',()=>{
  const peer=ownSnapshot('Windows',now);
  peer.tokens[0].days[0].totalTokens={token:'private-marker'};
  assert.throws(()=>ownRows(peer,'Windows'),/invalid snapshot/);
});

test('each computer uses its own date for today across midnight',()=>{
  const at=Date.parse('2026-10-22T00:30:00Z');
  const snapshot=(host,timezone,date,amount)=>({schema:2,collectedAt:new Date(at).toISOString(),timezone,device:{host,name:host},
    activity:[{host,status:'ok',days:[{date,seconds:amount,trackedSeconds:amount,categories:{Editors:amount}}]}],
    tokens:[{host,status:'ok',days:[{date,totalTokens:amount*10,cacheReadTokens:amount*4,apiEstimate:{usd:amount}}]}],
    providerTokenSources:[{host,provider:'claude-code',status:'ok',days:[{date,totalTokens:amount*20,cacheReadTokens:amount*8,apiEstimate:{usd:amount*2}}]}]});
  const mac=snapshot('Mac','America/Los_Angeles','2026-10-21',10);
  const pc=snapshot('Windows','Asia/Tokyo','2026-10-22',20);
  for(const devices of [[{host:'Mac',snapshot:mac},{host:'Windows',snapshot:pc}],[{host:'Windows',snapshot:pc},{host:'Mac',snapshot:mac}]]) {
    const combined=combine(devices,{now:at});
    for(const [index,amount] of [10,20].entries()) {
      const row=combined.glance.today.find(row=>row.host===['Mac','Windows'][index]);
      assert.equal(row.seconds,amount);
      assert.equal(row.codexTokens,amount*10);
      assert.equal(row.claudeTokens,amount*20);
      assert.equal(row.usd,amount*3);
      assert.deepEqual(row.categories,[{name:'Editors',seconds:amount}]);
    }
    assert.equal(combined.glance.both.seconds,30);
    // The headline leaves cache reads out and keeps them as their own sum.
    assert.equal(combined.glance.both.tokens,540);
    assert.equal(combined.glance.both.cacheReadTokens,360);
    assert.equal(combined.glance.both.usd,90);
  }
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
  assert.ok(combined.glance.lines.some(line=>line.startsWith('  All: Unknown')));
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

test('a Grok source with a limit wins over a newer one with requests only',()=>{
  const mac=ownSnapshot('Mac',now),pc=ownSnapshot('Windows',now);
  pc.grokLimits={status:'ok',provider:'Grok',scope:'account',checkedAt:new Date(now).toISOString(),windows:[],
    requests:{timeZone:'UTC',checkedAt:new Date(now).toISOString(),days:[{date:'2026-01-01',count:2}]}};
  const combined=combine([{host:'Mac',snapshot:mac},{host:'Windows',snapshot:pc}],{now});
  assert.equal(combined.view.grokLimits.observedOn,'Mac');
  assert.equal(combined.view.grokLimits.windows.length,1);
});

test('an engine set off in the config reads Off in the combined view',()=>{
  const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)}],{now,engines:{codex:'off'}});
  const codex=combined.glance.forecast.engines.find(engine=>engine.engine==='codex');
  assert.equal(codex.figure,'Off');
  assert.ok(combined.glance.limits.filter(row=>row.provider==='codex').every(row=>row.remaining===null && row.off));
  assert.ok(!combined.glance.forecast.menu?.startsWith('Codex'));
});

test('an expired Grok limit does not win over a live request count',()=>{
  const mac=ownSnapshot('Mac',now),pc=ownSnapshot('Windows',now);
  mac.grokLimits={...mac.grokLimits,validUntil:new Date(now-60000).toISOString()};
  pc.grokLimits={status:'ok',provider:'Grok',scope:'account',checkedAt:new Date(now).toISOString(),windows:[],
    requests:{timeZone:'UTC',checkedAt:new Date(now).toISOString(),days:[{date:'2026-01-01',count:2}]}};
  assert.equal(combine([{host:'Mac',snapshot:mac},{host:'Windows',snapshot:pc}],{now}).view.grokLimits.observedOn,'Windows');
});

test('combine passes each computer\'s ledger history and settings echo through, and applies the hub\'s titles setting',async()=>{
  const {sampleR2Combined}=await import('../lib/sample-r2.mjs');
  const now=Date.parse('2026-11-18T15:00:00Z');
  const fixture=sampleR2Combined(now);
  const withHistory=host=>ownSnapshot(host,now,snapshot=>({...snapshot,
    ledgerHistory:[fixture.view.ledgerHistory.find(row=>row.host===host),{...fixture.view.ledgerHistory[2],host:'Linux'}],
    configEcho:{...fixture.view.config.find(row=>row.host===host),dataFolder:'/fictional/private'}}));
  const combined=combine([{host:'Mac',snapshot:withHistory('Mac')},{host:'Windows',snapshot:withHistory('Windows')}],{now,generatedBy:'Mac'});
  assert.deepEqual(combined.view.ledgerHistory.map(row=>[row.host,row.status]),[['Mac','ok'],['Windows','ok']]);
  assert.deepEqual(combined.view.ledgerHistory[0],fixture.view.ledgerHistory[0],'kept as that computer wrote it');
  assert.deepEqual(combined.snapshots.Mac.ledgerHistory.length,1,'another computer\'s row in a snapshot is dropped');
  assert.deepEqual(combined.view.config.map(row=>row.host),['Mac','Windows']);
  assert.ok(!JSON.stringify(combined.view.config).includes('/fictional'));
  const titled=combined.view.ledgerHistory[0].days.flatMap(day=>day.sessions).filter(session=>session.title);
  assert.ok(titled.length>0);
  const off=combine([{host:'Mac',snapshot:withHistory('Mac')}],{now,generatedBy:'Mac',titles:false});
  assert.ok(off.view.ledgerHistory[0].days.flatMap(day=>day.sessions).every(session=>session.title===null),'a hub with titles off shows none');
  assert.equal(off.view.ledgerHistory[1].status,'not-connected','a computer not set up reads not connected');
  // A broken row is unavailable, not dropped, and a snapshot without one reads not connected.
  const broken=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now,snapshot=>({...snapshot,ledgerHistory:[{host:'Mac',status:'ok',days:'many'}]}))}],{now,generatedBy:'Mac'});
  assert.equal(broken.view.ledgerHistory[0].status,'unavailable');
  const none=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)}],{now,generatedBy:'Mac'});
  assert.equal(none.view.ledgerHistory[0].status,'not-connected');
  assert.deepEqual(none.view.config,[]);
  // The hub's carried copy of a computer reads back the same.
  const {carriedDevice:carried}=await import('../lib/combine.mjs');
  const again=combine([{host:'Mac',snapshot:withHistory('Mac')},carried(combined,'Windows')],{now,generatedBy:'Mac'});
  assert.deepEqual(again.view.ledgerHistory[1],combined.view.ledgerHistory[1]);
  assert.deepEqual(again.view.config[1],combined.view.config[1]);
  // A computer that turns Codex off in its own settings adds no Codex days on the hub, even from days it kept.
  const tools=row=>row.days.reduce((count,day)=>({...count,[day.tool]:(count[day.tool] ?? 0)+1}),{});
  assert.deepEqual(tools(combined.view.ledgerHistory[1]),{claude:60,codex:20});
  const codexOff=host=>ownSnapshot(host,now,snapshot=>({...withHistory(host),configEcho:{...withHistory(host).configEcho,sources:{...withHistory(host).configEcho.sources,codex:false}}}));
  const spokeOff=combine([{host:'Mac',snapshot:withHistory('Mac')},{host:'Windows',snapshot:codexOff('Windows')}],{now,generatedBy:'Mac'});
  assert.deepEqual(tools(spokeOff.view.ledgerHistory[1]),{claude:60});
});

test('each computer\'s state is decided once, and a computer that is Off stays Off on every computer that carries its copy',()=>{
  const now=Date.parse('2026-11-18T12:40:00Z');
  const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',snapshot:ownSnapshot('Windows',now-5*3600000),off:true}],{now});
  assert.deepEqual(combined.devices.map(device=>[device.host,device.state]),[['Mac','current'],['Windows','off']]);
  assert.equal(combined.devices[1].stateLabel,'Off');
  assert.match(combined.devices[0].stateLabel,/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}:\d\d (AM|PM)$/);
  const copy=JSON.parse(JSON.stringify(combined));
  assert.equal(carriedDevice(copy,'Windows').off,true);
  assert.equal(carriedDevice(copy,'Mac').off,undefined);
  const late=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',snapshot:ownSnapshot('Windows',now-5*3600000),error:'unreachable'}],{now});
  assert.equal(late.devices[1].state,'late','unreachable but on still shows the time of its last reading');
});
