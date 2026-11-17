import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildSnapshot,collect,defaultReaders} from '../scripts/collect.mjs';
import {runHub,recombine} from '../scripts/hub.mjs';
import {pullCommand,pushCommand,stagedName} from '../scripts/hub-transport.mjs';
import {parseConfig} from '../lib/config.mjs';
import {combine} from '../lib/combine.mjs';
import {withFolder,ownSnapshot,testConfig} from './helpers.mjs';

const now=Date.parse('2026-10-21T17:00:00Z');
const at=new Date(now);
const staged=stagedName('00000000-0000-0000-0000-000000000000');
const box={name:'Build box',ssh:'build-box',platform:'linux',dataFolder:null};

const linuxConfig=(folder,overrides={})=>testConfig(folder,{platform:'linux',host:'Linux',device:{name:'Build box'},
  sources:{screenTime:false,codex:true,codexLimits:true,claudeCode:true,claudeLimits:true,sessions:true},...overrides});

const day={inputTokens:100,cacheReadTokens:400,cacheCreationTokens:50,outputTokens:50,totalTokens:600,requestCount:3};
const readers={
  codex:async()=>({profiles:[],tools:[],tokenProfiles:[],hourTotals:[]}),
  codexLimits:async()=>({status:'ok',provider:'Codex',scope:'account',checkedAt:at.toISOString(),windows:[{bucket:'codex',window:'primary',durationMinutes:300,remainingPercent:80,resetsAt:'2099-01-01T00:00:00Z'}]}),
  claudeCode:async()=>({provider:'claude-code',status:'ok',days:[{date:'2026-10-21',...day,models:[{model:'claude-sonnet-4-5',...day}]}]}),
  claudeLimits:async()=>{throw Error('no CLI');},
  projects:async()=>({claude:null,codex:null}),
  sessions:async()=>({host:'Linux',status:'ok',checkedAt:at.toISOString(),sessions:[]}),
};

// A Linux computer's snapshot, made by the collector itself from fictional readers.
async function linuxSnapshot(folder,when=at) {
  const {data}=await buildSnapshot(linuxConfig(folder),readers,{now:when});
  return data;
}

test('a Linux snapshot is about this computer only and has no screen time',async()=>{
  const {data,status}=await buildSnapshot(linuxConfig('/unused'),readers,{now:at});
  assert.equal(data.device.host,'Linux');
  assert.deepEqual(data.device,{host:'Linux',name:'Build box'});
  assert.deepEqual(data.activity,[{host:'Linux',status:'not-connected'}]);
  assert.deepEqual(data.tokens.map(row=>row.host),['Linux']);
  assert.equal(data.sessions[0].status,'ok');
  assert.equal(JSON.stringify(data).includes('"Mac"'),false);
  assert.equal(JSON.stringify(data).includes('"Windows"'),false);
  assert.equal(status.state,'partial');
});

test('screen time turned on in a Linux settings file reads unsupported, and is not counted as a failed source',async()=>{
  let called=false;
  const config=linuxConfig('/unused',{sources:{screenTime:true,codex:true,codexLimits:false,claudeCode:true,claudeLimits:false}});
  const {data,status}=await buildSnapshot(config,{...readers,screenTime:async()=>{called=true;return {};}},{now:at});
  assert.equal(called,false);
  assert.equal(data.activity[0].host,'Linux');
  assert.equal(data.activity[0].status,'unsupported');
  assert.equal(data.activity[0].seconds,undefined);
  assert.equal(status.sourcesConfigured,status.sourcesRead);
});

test('Linux settings read the Codex and Claude Code readers with every other source missing',async()=>{
  const config=linuxConfig('/unused',{sources:{screenTime:false,codex:true,codexLimits:false,claudeCode:true,claudeLimits:false,sessions:false}});
  const called=[];
  const spy=Object.fromEntries(Object.entries(readers).map(([key,read])=>[key,()=>{called.push(key);return read();}]));
  const {data}=await buildSnapshot(config,spy,{now:at});
  assert.ok(called.includes('codex') && called.includes('claudeCode'));
  assert.ok(!called.includes('sessions') && !called.includes('codexLimits') && !called.includes('claudeLimits'));
  assert.equal(data.providerTokenSources[0].status,'ok');
  assert.equal(data.tokens[0].host,'Linux');
  assert.equal(data.sessions[0].status,'not-connected');
  assert.equal(data.quota.status,'not-connected');
});

test('on a Linux computer with no tool folders at all, collection finishes and each source reads Unknown, not an error',{skip:process.platform!=='linux' && 'reads a real Linux home folder'},async()=>{
  const home=await mkdtemp(path.join(tmpdir(),'observatory-home-'));
  const saved={HOME:process.env.HOME,CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR,CODEX_HOME:process.env.CODEX_HOME};
  try {
    process.env.HOME=home;
    delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CODEX_HOME;
    await withFolder(async folder=>{
      const config=linuxConfig(path.join(folder,'data'),{sources:{screenTime:true,codex:true,codexLimits:false,claudeCode:true,claudeLimits:false,sessions:true}});
      const result=await collect(config,{now:()=>at,readers:{...defaultReaders(config),
        sessions:async()=>({host:'Linux',status:'unavailable',checkedAt:at.toISOString(),sessions:[]})}});
      assert.equal(result.data.device.host,'Linux');
      assert.equal(result.data.activity[0].status,'unsupported');
      for(const row of [result.data.tokens[0],result.data.providerTokenSources[0]])
        assert.ok(['not-found','unavailable','not-connected'].includes(row.status),`${row.host} ${row.status}`);
      assert.equal(result.data.tokens[0].days,undefined);
      const saved=JSON.parse(await readFile(path.join(config.dataFolder,'public','local','usage.json'),'utf8'));
      assert.equal(saved.device.host,'Linux');
    });
  } finally {
    for(const [key,value] of Object.entries(saved)) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
    await rm(home,{recursive:true,force:true});
  }
});

test('a Mac hub pulls a Linux spoke the same way as a PC and labels it by its device name',()=>withFolder(async folder=>{
  await mkdir(path.join(folder,'public','local'),{recursive:true,mode:0o700});
  await writeFile(path.join(folder,'public','local','usage.json'),JSON.stringify(ownSnapshot('Mac',now)));
  const pushed=[],pulled=[];
  const transport={pull:async spoke=>{pulled.push(spoke.ssh);return JSON.stringify(await linuxSnapshot(folder));},
    push:async(spoke,text)=>{pushed.push({spoke:spoke.name,text});}};
  const config=testConfig(folder,{role:'hub',hub:{spokes:[box]}});
  const combined=await runHub(config,{transport,now:()=>now});
  assert.deepEqual(pulled,['build-box']);
  assert.deepEqual(combined.hub.spokes,[{name:'Build box',host:'Linux',pull:'ok',push:'ok'}]);
  assert.equal(pushed.length,1);
  assert.deepEqual(combined.devices.map(device=>[device.host,device.name]),[['Mac','Test Mac'],['Linux','Build box']]);
  assert.ok(combined.snapshots.Linux);
  assert.equal(combined.glance.today[1].host,'Linux');
  assert.match(combined.glance.lines.join('\n'),/^ {2}Build box: /m);
  assert.equal(combined.view.deviceNames.Linux,'Build box');
  assert.ok(combined.view.providerTokenSources.some(row=>row.host==='Linux'));
  const saved=JSON.parse(await readFile(path.join(folder,'public','local','combined.json'),'utf8'));
  assert.equal(saved.devices.length,2);
}));

test('a computer nobody set up as Linux adds no Linux rows to the combined view',()=>{
  const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',snapshot:ownSnapshot('Windows',now)}],{now,generatedBy:'Mac'});
  assert.deepEqual(combined.view.activity.map(row=>row.host).sort(),['Mac','Windows']);
  assert.deepEqual(combined.view.tokens.map(row=>row.host).sort(),['Mac','Windows']);
  assert.equal(combined.view.deviceNames.Linux,undefined);
});

test('an unreachable Linux spoke keeps its last copy, marked stale, and shows Unknown',()=>withFolder(async folder=>{
  await mkdir(path.join(folder,'public','local'),{recursive:true,mode:0o700});
  await writeFile(path.join(folder,'public','local','usage.json'),JSON.stringify(ownSnapshot('Mac',now)));
  const config=testConfig(folder,{role:'hub',hub:{spokes:[box]}});
  await runHub(config,{transport:{pull:async()=>JSON.stringify(await linuxSnapshot(folder,new Date(now-3600000))),push:async()=>{}},now:()=>now-3600000});
  const combined=await runHub(config,{transport:{pull:async()=>{throw Error('unreachable');},push:async()=>{throw Error('never');}},now:()=>now});
  assert.deepEqual(combined.hub.spokes,[{name:'Build box',host:'Linux',pull:'unreachable',push:'skipped'}]);
  const device=combined.devices.find(row=>row.host==='Linux');
  assert.equal(device.stale,true);
  assert.equal(device.name,'Build box');
  assert.equal(combined.glance.today[1].tokens,null);
}));

test('a snapshot from a Mac is refused when the Linux spoke is asked',()=>withFolder(async folder=>{
  await mkdir(path.join(folder,'public','local'),{recursive:true,mode:0o700});
  await writeFile(path.join(folder,'public','local','usage.json'),JSON.stringify(ownSnapshot('Mac',now)));
  const config=testConfig(folder,{role:'hub',hub:{spokes:[box]}});
  const combined=await runHub(config,{transport:{pull:async()=>JSON.stringify(ownSnapshot('Mac',now)),push:async()=>{}},now:()=>now});
  assert.equal(combined.hub.spokes[0].pull,'snapshot is for another computer');
}));

test('a Linux spoke recombines its fresh snapshot with the hub rows it was sent',()=>withFolder(async folder=>{
  const local=path.join(folder,'public','local');
  await mkdir(local,{recursive:true,mode:0o700});
  await writeFile(path.join(local,'usage.json'),JSON.stringify(await linuxSnapshot(folder)));
  const hubView=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Linux',snapshot:await linuxSnapshot(folder)}],{now,generatedBy:'Mac'});
  await writeFile(path.join(local,'combined.incoming.json'),JSON.stringify({...hubView,hub:{role:'hub',spokes:[]}}));
  const combined=await recombine(linuxConfig(folder),{now:()=>now});
  assert.deepEqual(combined.devices.map(device=>device.host),['Linux','Mac']);
  assert.equal(combined.hub.role,'spoke');
}));

test('Linux spoke commands use sh and base64, and look in XDG_DATA_HOME first',()=>{
  const pull=pullCommand(box);
  assert.match(pull,/base64 < "\$f"/);
  assert.match(pull,/"\$\{XDG_DATA_HOME:-\$HOME\/\.local\/share\}\/observatory"\/public\/local\/usage\.json/);
  assert.doesNotMatch(pull,/Library/);
  const push=pushCommand(box,99,staged);
  assert.match(push,/d="\$\{XDG_DATA_HOME:-\$HOME\/\.local\/share\}\/observatory"\/public\/local/);
  assert.match(push,/combined\.incoming\.json"$/);
  assert.match(pullCommand({...box,dataFolder:"/srv/it's"}),/'\/srv\/it'\\''s'/);
});

test('a Linux computer names itself, and combine refuses an unknown host',()=>{
  assert.equal(parseConfig({device:{name:'Build box'}},{platform:'linux',environment:{}}).device.name,'Build box');
  assert.throws(()=>combine([{host:'Plan9',snapshot:null}],{now}),/distinct host/);
});
