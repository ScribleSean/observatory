import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,symlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {buildSnapshot,tokenRoots} from '../scripts/collect.mjs';
import {parseConfig} from '../lib/config.mjs';
import {combine} from '../lib/combine.mjs';
import {collectClaudeUsage} from '../scripts/read-claude-usage.mjs';
import {parseDistributions,wslRoots,readClaudeRoots,readCodexRoots,readProjectRoots,cacheName} from '../scripts/token-roots.mjs';
import {withFolder,testConfig} from './helpers.mjs';

const now=new Date();
const at=offset=>new Date(now.getTime()-60_000+offset*1000).toISOString();
const lines=rows=>rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
const MODEL='claude-opus-5-5';

async function claudeLogs(home,prefix,inputs) {
  const folder=path.join(home,'.claude','projects','-fixture-demo-app');
  await mkdir(folder,{recursive:true});
  await writeFile(path.join(folder,`${prefix}-session.jsonl`),lines(inputs.map((input,index)=>({type:'assistant',timestamp:at(index),
    sessionId:`${prefix}-session`,cwd:`${home}/demo-app`,requestId:`${prefix}-r${index}`,
    message:{id:`${prefix}-m${index}`,role:'assistant',model:MODEL,usage:{input_tokens:input,output_tokens:10,cache_read_input_tokens:0,cache_creation_input_tokens:0}}}))));
}

async function codexLogs(home,prefix,input) {
  const folder=path.join(home,'.codex','sessions','2026','11','01');
  await mkdir(folder,{recursive:true});
  const usage={input_tokens:input,cached_input_tokens:0,output_tokens:10,reasoning_output_tokens:0,total_tokens:input+10};
  await writeFile(path.join(folder,`rollout-${prefix}.jsonl`),lines([
    {type:'session_meta',timestamp:at(0),payload:{id:`${prefix}-thread`,cwd:`${home}/demo-app`}},
    {type:'turn_context',timestamp:at(1),payload:{model:'gpt-5.6',cwd:`${home}/demo-app`,turn_id:`${prefix}-turn`}},
    {type:'event_msg',timestamp:at(2),payload:{type:'token_count',info:{total_token_usage:usage,last_token_usage:usage}}},
  ]));
}

async function pc(folder,{wsl=true}={}) {
  const windows=path.join(folder,'windows');
  await claudeLogs(windows,'win',[100,200]);
  await codexLogs(windows,'win',1000);
  const share=path.join(folder,'share');
  const linux=path.join(share,'Fixture-1','home','fixture-user');
  await mkdir(linux,{recursive:true});
  if(wsl) {
    await claudeLogs(linux,'wsl',[300]);
    await codexLogs(linux,'wsl',2000);
  }
  const own={label:'Windows',claudeFolder:path.join(windows,'.claude'),codexFolder:path.join(windows,'.codex'),home:windows};
  const find=distributions=>wslRoots({distributions,share:name=>path.join(share,name),join:(...parts)=>path.join(...parts)});
  return {own,share,linux,find};
}

const pcConfig=dataFolder=>testConfig(dataFolder,{platform:'windows',host:'Windows',device:{name:'Test PC'},
  sources:{screenTime:false,codex:true,codexLimits:false,claudeCode:true,claudeLimits:false,wsl:true}});

const readersFor=roots=>({
  codex:()=>readCodexRoots(roots,{cacheFor:()=>null}),
  claudeCode:()=>readClaudeRoots(roots),
  projects:({claude,codex},when)=>readProjectRoots(roots,{claude,codex,now:when}),
});

const today=rows=>rows.find(row=>row.status==='ok')?.days.at(-1);
const claudeOf=data=>data.providerTokenSources[0];
const codexOf=data=>data.tokens[0];

test('distribution names come from the registry, with container engines and odd names left out',()=>{
  const output=['','HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{1}',
    '    DistributionName    REG_SZ    Ubuntu-24.04','','HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{2}',
    '    DistributionName    REG_SZ    docker-desktop','    DistributionName    REG_SZ    bad name\\..','    DistributionName    REG_SZ    Ubuntu-24.04',
    'End of search: 3 match(es) found.'].join('\r\n');
  assert.deepEqual(parseDistributions(output),['Ubuntu-24.04']);
  assert.deepEqual(parseDistributions(''),[]);
});

test('the wsl source is a Windows-only opt-in',async()=>{
  const windows={platform:'win32',environment:{LOCALAPPDATA:'C:\\Users\\fixture\\AppData\\Local'}};
  assert.equal(parseConfig({sources:{codex:true}},windows).sources.wsl,false);
  assert.equal(parseConfig({sources:{wsl:true}},windows).sources.wsl,true);
  assert.throws(()=>parseConfig({sources:{wsl:true}},{platform:'darwin'}),/Windows only/);
  let asked=false;
  const ask=async()=>{asked=true;return ['Fixture-1'];};
  const mac=await tokenRoots(testConfig('/unused',{sources:{wsl:true}}),{distributions:ask});
  assert.deepEqual(mac.map(root=>root.label),['Mac']);
  const off=await tokenRoots({...pcConfig('/unused'),sources:{wsl:false}},{distributions:ask});
  assert.deepEqual(off.map(root=>root.label),['Windows']);
  assert.equal(asked,false);
  const failed=await tokenRoots(pcConfig('/unused'),{distributions:async()=>{throw Error('reg failed');}});
  assert.equal(failed.at(-1).unreadable,true,'a failed lookup is Unknown, not an empty list');
});

test('Windows only: totals are the Windows logs alone',async()=>withFolder(async folder=>{
  const {own}=await pc(folder);
  const {data}=await buildSnapshot({...pcConfig(folder),sources:{...pcConfig(folder).sources,wsl:false}},readersFor([own]),{now});
  assert.equal(today([claudeOf(data)]).totalTokens,100+200+20);
  assert.equal(today([codexOf(data)]).totalTokens,1010);
  assert.equal(claudeOf(data).roots,undefined,'nothing extra is stored when WSL is off');
}));

test('Windows plus one WSL distribution: the same day and model are summed once',async()=>withFolder(async folder=>{
  const {own,linux,find}=await pc(folder);
  const roots=[own,...await find(['Fixture-1'])];
  assert.deepEqual(roots.map(root=>root.label),['Windows','WSL Fixture-1']);
  assert.equal(roots[1].home,'/home/fixture-user');
  const {data}=await buildSnapshot(pcConfig(folder),readersFor(roots),{now});
  const claude=today([claudeOf(data)]);
  assert.equal(claude.totalTokens,320+310);
  assert.equal(claude.requestCount,3);
  assert.deepEqual(claude.models.map(row=>[row.model,row.totalTokens]),[[MODEL,630]],'one model row, not two');
  assert.equal(claude.hours.reduce((a,b)=>a+b,0),630);
  const alone=await Promise.all([own.claudeFolder,path.join(linux,'.claude')].map(folder=>collectClaudeUsage(folder)));
  assert.equal(alone.reduce((total,result)=>total+result.days.at(-1).totalTokens,0),claude.totalTokens);
  const codex=today([codexOf(data)]);
  assert.equal(codex.totalTokens,1010+2010);
  assert.deepEqual(codex.models.map(row=>[row.model,row.totalTokens]),[['gpt-5.6',3020]]);
  assert.deepEqual(claudeOf(data).roots,['Windows','WSL Fixture-1']);
  assert.deepEqual(codexOf(data).roots,['Windows','WSL Fixture-1']);
  const projects=data.projectTokens[0];
  assert.equal(projects.status,'ok');
  assert.equal(projects.projects.reduce((total,row)=>total+row.totalTokens,0),630+3020);
  const text=JSON.stringify(data);
  for(const secret of [folder,'fixture-user','\\\\wsl'])assert.ok(!text.includes(secret),secret);
}));

test('a WSL folder that exists but cannot be read makes that provider Unknown',async()=>withFolder(async folder=>{
  const {own,linux,find}=await pc(folder,{wsl:false});
  await codexLogs(linux,'wsl',2000);
  await writeFile(path.join(linux,'.claude'),'');
  const {data}=await buildSnapshot(pcConfig(folder),readersFor([own,...await find(['Fixture-1'])]),{now});
  assert.equal(claudeOf(data).status,'unavailable');
  assert.equal(codexOf(data).status,'ok');
  assert.equal(today([codexOf(data)]).totalTokens,3020);
  assert.equal(data.projectTokens[0].status,'unavailable');
}));

test('a distribution whose share cannot be reached, or whose home is a link, is Unknown, not skipped',async()=>withFolder(async folder=>{
  const {own,share,find}=await pc(folder);
  for(const roots of [await find(['Unreachable-1']),
    await (async()=>{await mkdir(path.join(share,'Linked-1','home'),{recursive:true});await symlink(path.join(share,'Fixture-1','home','fixture-user'),path.join(share,'Linked-1','home','other'),'junction');return find(['Linked-1']);})()]) {
    assert.equal(roots.at(-1).unreadable,true);
    const {data}=await buildSnapshot(pcConfig(folder),readersFor([own,...roots]),{now});
    assert.equal(claudeOf(data).status,'unavailable');
    assert.equal(codexOf(data).status,'unavailable');
  }
}));

test('a linked .claude or .codex in a WSL home is Unknown, and one folder is never read twice',async()=>withFolder(async folder=>{
  const {own,linux,find}=await pc(folder,{wsl:false});
  await symlink(own.claudeFolder,path.join(linux,'.claude'),'junction');
  const roots=[own,...await find(['Fixture-1'])];
  const {data}=await buildSnapshot(pcConfig(folder),readersFor(roots),{now});
  assert.equal(claudeOf(data).status,'unavailable');
  assert.equal(codexOf(data).status,'ok');
  const twice=await buildSnapshot(pcConfig(folder),readersFor([own,{...own,label:'WSL Fixture-1',optional:true,home:'/home/fixture-user'}]),{now});
  assert.equal(codexOf(twice.data).status,'unavailable');
}));

test('an invalid folder setting on the PC stays Unknown with WSL on',async()=>withFolder(async folder=>{
  const {own,find}=await pc(folder);
  const roots=[{...own,claudeFolder:null},...await find(['Fixture-1'])];
  const {data}=await buildSnapshot(pcConfig(folder),readersFor(roots),{now});
  assert.equal(claudeOf(data).status,'unavailable');
  assert.equal(codexOf(data).status,'ok');
  assert.equal(data.projectTokens[0].status,'unavailable');
}));

test('a WSL session in the Windows home is never named after the Windows user',async()=>withFolder(async folder=>{
  const {own,linux,find}=await pc(folder,{wsl:false});
  const user=path.basename(own.home);
  const project=path.join(linux,'.claude','projects','-mnt-c-Users');
  await mkdir(project,{recursive:true});
  await writeFile(path.join(project,'mnt-session.jsonl'),lines([{type:'assistant',timestamp:at(0),sessionId:'mnt-session',cwd:`/mnt/c/Users/${user}`,requestId:'mnt-r0',
    message:{id:'mnt-m0',role:'assistant',model:MODEL,usage:{input_tokens:40,output_tokens:2,cache_read_input_tokens:0,cache_creation_input_tokens:0}}}]));
  const {data}=await buildSnapshot(pcConfig(folder),readersFor([own,...await find(['Fixture-1'])]),{now});
  const projects=data.projectTokens[0];
  assert.equal(projects.status,'ok');
  assert.ok(!JSON.stringify(projects).includes(user),'no Windows user name');
  assert.equal(projects.projects.reduce((total,row)=>total+row.totalTokens,0)+(projects.other?.totalTokens ?? 0),320+1010+42);
}));

test('two users in one distribution are both counted',async()=>withFolder(async folder=>{
  const {own,share,find}=await pc(folder);
  const second=path.join(share,'Fixture-1','home','second-user');
  await claudeLogs(second,'two',[400]);
  const other=path.join(second,'.claude','projects','-home-fixture-user');
  await mkdir(other,{recursive:true});
  await writeFile(path.join(other,'cross.jsonl'),lines([{type:'assistant',timestamp:at(0),sessionId:'cross',cwd:'/home/fixture-user',requestId:'cross-r0',
    message:{id:'cross-m0',role:'assistant',model:MODEL,usage:{input_tokens:0,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:1}}}]));
  const roots=[own,...await find(['Fixture-1'])];
  assert.equal(roots.length,3);
  const {data}=await buildSnapshot(pcConfig(folder),readersFor(roots),{now});
  assert.equal(today([claudeOf(data)]).totalTokens,320+310+410+1);
  assert.ok(!JSON.stringify(data.projectTokens[0]).includes('fixture-user'),'another home in the distribution is not a project name');
  assert.deepEqual(claudeOf(data).roots,['Windows','WSL Fixture-1']);
}));

test('a distribution whose share cannot be listed makes both providers Unknown',async()=>withFolder(async folder=>{
  const {own,share}=await pc(folder);
  await mkdir(path.join(share,'Broken-1-dir'),{recursive:true});
  await writeFile(path.join(share,'Broken-1-dir','home'),'');
  const roots=[own,...await wslRoots({distributions:['Broken-1-dir'],share:name=>path.join(share,name),join:(...parts)=>path.join(...parts)})];
  const {data}=await buildSnapshot(pcConfig(folder),readersFor(roots),{now});
  assert.equal(claudeOf(data).status,'unavailable');
  assert.equal(codexOf(data).status,'unavailable');
}));

test('a distribution with no logs adds nothing and is not listed',async()=>withFolder(async folder=>{
  const {own,find}=await pc(folder,{wsl:false});
  const {data}=await buildSnapshot(pcConfig(folder),readersFor([own,...await find(['Fixture-1'])]),{now});
  assert.equal(today([claudeOf(data)]).totalTokens,320);
  assert.equal(today([codexOf(data)]).totalTokens,1010);
  assert.deepEqual(claudeOf(data).roots,['Windows']);
  assert.equal(data.projectTokens[0].status,'ok');
}));

test('each Codex folder keeps its own cache, named without user or distribution',async()=>withFolder(async folder=>{
  const {own,find}=await pc(folder);
  const roots=[own,...await find(['Fixture-1'])];
  const asked=[];
  await readCodexRoots(roots,{cacheFor:root=>{asked.push(root.optional?cacheName(root):'own');return null;}});
  assert.equal(asked.length,2);
  assert.match(asked[1],/^wsl-[0-9a-f]{12}$/);
  assert.notEqual(cacheName({key:'A\0u'}),cacheName({key:'B\0u'}));
}));

test('the hub adds the Mac and the PC once each, with WSL counted on the PC',async()=>withFolder(async folder=>{
  const {own,find}=await pc(folder);
  const pcSnapshot=(await buildSnapshot(pcConfig(folder),readersFor([own,...await find(['Fixture-1'])]),{now})).data;
  const mac=path.join(folder,'mac');
  await claudeLogs(mac,'mac',[5000]);
  await codexLogs(mac,'mac',7000);
  const macRoots=[{label:'Mac',claudeFolder:path.join(mac,'.claude'),codexFolder:path.join(mac,'.codex'),home:mac}];
  const macConfig=testConfig(folder,{sources:{screenTime:false,codex:true,codexLimits:false,claudeCode:true,claudeLimits:false}});
  const macSnapshot=(await buildSnapshot(macConfig,readersFor(macRoots),{now})).data;
  assert.equal(today([claudeOf(macSnapshot)]).totalTokens,5010,'the Mac reads only its own logs');
  const combined=combine([{host:'Mac',snapshot:macSnapshot},{host:'Windows',snapshot:pcSnapshot}],{now:now.getTime()});
  const byHost=Object.fromEntries(combined.glance.today.map(row=>[row.host,row]));
  assert.equal(byHost.Mac.claudeTokens,5010);
  assert.equal(byHost.Mac.codexTokens,7010);
  assert.equal(byHost.Windows.claudeTokens,630);
  assert.equal(byHost.Windows.codexTokens,3020);
  assert.equal(combined.glance.both.tokens,5010+7010+630+3020);
  const pcClaude=combined.view.providerTokenSources.find(row=>row.host==='Windows');
  assert.deepEqual(pcClaude.roots,['Windows','WSL Fixture-1'],'provenance survives the combine step');
}));
