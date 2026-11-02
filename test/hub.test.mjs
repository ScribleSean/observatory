import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {runHub,recombine,MAX_PEER_BYTES} from '../scripts/hub.mjs';
import {combine} from '../lib/combine.mjs';
import {serializeSnapshot,snapshotHistoryBudget} from '../scripts/snapshot-size.mjs';
import {pullCommand,pushCommand,sshEnvironment,sshTransport,stagedName,MAX_FILE_BYTES} from '../scripts/hub-transport.mjs';

const staged=stagedName('00000000-0000-0000-0000-000000000000');
import {withFolder,ownSnapshot,testConfig} from './helpers.mjs';

const pc={name:'PC',ssh:'my-pc',platform:'windows',dataFolder:null};
const now=Date.parse('2026-10-21T17:00:00Z');

async function seed(folder,file,value) {
  const local=path.join(folder,'public','local');
  await mkdir(local,{recursive:true,mode:0o700});
  await writeFile(path.join(local,file),JSON.stringify(value));
}
const read=async(folder,file)=>JSON.parse(await readFile(path.join(folder,'public','local',file),'utf8'));

function fakeTransport(snapshotText) {
  const pushed=[];
  return {pushed,
    pull:async()=>{if(snapshotText instanceof Error)throw snapshotText;return snapshotText;},
    push:async(spoke,text)=>{pushed.push({spoke:spoke.name,text});}};
}

test('the hub pulls the spoke, writes combined.json, and writes it back',()=>withFolder(async folder=>{
  await seed(folder,'usage.json',ownSnapshot('Mac',now));
  const transport=fakeTransport(JSON.stringify(ownSnapshot('Windows',now)));
  const config=testConfig(folder,{role:'hub',hub:{spokes:[pc]}});
  const combined=await runHub(config,{transport,now:()=>now});
  assert.deepEqual(combined.hub.spokes,[{name:'PC',host:'Windows',pull:'ok',push:'ok'}]);
  const saved=await read(folder,'combined.json');
  assert.equal(saved.generatedAt,combined.generatedAt);
  assert.equal(transport.pushed.length,1);
  assert.equal(JSON.parse(transport.pushed[0].text).generatedAt,combined.generatedAt);
  assert.equal(saved.glance.today.length,2);
  assert.equal(saved.glance.today[1].name,'Test PC');
  assert.equal(typeof saved.glance.both.tokens,'number');
}));

test('an unreachable spoke keeps its last copy, marked stale, and is not written to',()=>withFolder(async folder=>{
  await seed(folder,'usage.json',ownSnapshot('Mac',now));
  const config=testConfig(folder,{role:'hub',hub:{spokes:[pc]}});
  await runHub(config,{transport:fakeTransport(JSON.stringify(ownSnapshot('Windows',now-3600000))),now:()=>now-3600000});
  const transport=fakeTransport(Error('unreachable'));
  const combined=await runHub(config,{transport,now:()=>now});
  assert.deepEqual(combined.hub.spokes,[{name:'PC',host:'Windows',pull:'unreachable',push:'skipped'}]);
  assert.equal(transport.pushed.length,0);
  const pcDevice=combined.devices.find(device=>device.host==='Windows');
  assert.equal(pcDevice.stale,true);
  assert.equal(pcDevice.error,'unreachable');
  assert.equal(combined.glance.today[1].tokens,null);
  assert.equal(combined.glance.both.tokens,null);
}));

test('a spoke that never answered is Unknown',()=>withFolder(async folder=>{
  await seed(folder,'usage.json',ownSnapshot('Mac',now));
  const config=testConfig(folder,{role:'hub',hub:{spokes:[pc]}});
  const combined=await runHub(config,{transport:fakeTransport(Error('unreachable')),now:()=>now});
  assert.equal(combined.glance.today[1].missing,true);
  assert.ok(combined.glance.lines.some(line=>line.includes('PC: Unknown')));
}));

test('a snapshot about another computer is refused',()=>withFolder(async folder=>{
  await seed(folder,'usage.json',ownSnapshot('Mac',now));
  const config=testConfig(folder,{role:'hub',hub:{spokes:[pc]}});
  const combined=await runHub(config,{transport:fakeTransport(JSON.stringify(ownSnapshot('Mac',now))),now:()=>now});
  assert.equal(combined.hub.spokes[0].pull,'snapshot is for another computer');
  const garbage=await runHub(config,{transport:fakeTransport('not json'),now:()=>now});
  assert.equal(garbage.hub.spokes[0].pull,'invalid snapshot');
}));

test('a null Claude day fails only the peer read, carries its previous data and saves fresh local data',()=>withFolder(async folder=>{
  const config=testConfig(folder,{role:'hub',hub:{spokes:[pc]}});
  await seed(folder,'usage.json',ownSnapshot('Mac',now-600000));
  await runHub(config,{transport:fakeTransport(JSON.stringify(ownSnapshot('Windows',now-600000))),now:()=>now-600000});
  const local=ownSnapshot('Mac',now);
  await seed(folder,'usage.json',local);
  const peer=ownSnapshot('Windows',now);
  peer.providerTokenSources[0].days.push(null);
  const transport=fakeTransport(JSON.stringify(peer));
  await runHub(config,{transport,now:()=>now});
  const saved=await read(folder,'combined.json');
  assert.deepEqual(saved.hub.spokes,[{name:'PC',host:'Windows',pull:'invalid snapshot',push:'skipped'}]);
  assert.equal(saved.snapshots.Mac.collectedAt,local.collectedAt);
  assert.equal(saved.snapshots.Windows.collectedAt,ownSnapshot('Windows',now-600000).collectedAt);
  assert.equal(saved.devices[1].error,'invalid snapshot');
  assert.equal(typeof saved.glance.today[0].tokens,'number');
  assert.equal(transport.pushed.length,0);
}));

test('an oversized peer is refused, keeps its previous data and the dashboard file stays readable',()=>withFolder(async folder=>{
  const config=testConfig(folder,{role:'hub',hub:{spokes:[pc]}});
  await seed(folder,'usage.json',ownSnapshot('Mac',now));
  await runHub(config,{transport:fakeTransport(JSON.stringify(ownSnapshot('Windows',now-600000))),now:()=>now-600000});
  const peer=ownSnapshot('Windows',now);
  peer.tokens[0].roots=['x'.repeat(8_200_000)];
  const transport=fakeTransport(JSON.stringify(peer));
  await runHub(config,{transport,now:()=>now});
  const text=await readFile(path.join(folder,'public','local','combined.json'),'utf8');
  assert.ok(Buffer.byteLength(text)<MAX_FILE_BYTES);
  const saved=JSON.parse(text);
  assert.deepEqual(saved.hub.spokes,[{name:'PC',host:'Windows',pull:'snapshot is too large',push:'skipped'}]);
  assert.equal(saved.devices[1].error,'snapshot is too large');
  assert.equal(saved.snapshots.Windows.collectedAt,ownSnapshot('Windows',now-600000).collectedAt);
  assert.equal(transport.pushed.length,0);
}));

function longHistory(snapshot,host,count) {
  const categories=Object.fromEntries(Array.from({length:40},(_,index)=>[`Category ${index}`,1234.5]));
  const days=Array.from({length:count},(_,index)=>({date:new Date(now-(count-1-index)*86400000).toISOString().slice(0,10),
    seconds:1234.5,trackedSeconds:1234.5,hours:Array(24).fill(51.4),categories}));
  snapshot.activityHistory=[{host,status:'ok',checkedAt:new Date(now).toISOString(),days}];
  return days;
}

test('a peer the collector sized to its budget is accepted with its oldest history trimmed to fit',()=>withFolder(async folder=>{
  const config=testConfig(folder,{role:'hub',hub:{spokes:[pc]}});
  await seed(folder,'usage.json',ownSnapshot('Mac',now));
  const peer=ownSnapshot('Windows',now);
  const days=longHistory(peer,'Windows',20000);
  const sized=serializeSnapshot(peer);
  assert.ok(sized.bytes>MAX_PEER_BYTES && sized.bytes<=snapshotHistoryBudget);
  const combined=await runHub(config,{transport:fakeTransport(sized.text),now:()=>now});
  assert.equal(combined.hub.spokes[0].pull,'ok');
  const kept=combined.snapshots.Windows.activityHistory[0].days;
  assert.ok(kept.length>0 && kept.length<peer.activityHistory[0].days.length);
  assert.equal(kept.at(-1).date,days.at(-1).date);
  const text=await readFile(path.join(folder,'public','local','combined.json'),'utf8');
  assert.ok(Buffer.byteLength(text)<MAX_FILE_BYTES);
}));

test('large snapshots on both computers lose their oldest history so the dashboard file stays readable',()=>withFolder(async folder=>{
  const config=testConfig(folder,{role:'hub',hub:{spokes:[pc]}});
  const sized=host=>{
    const snapshot=ownSnapshot(host,now);
    longHistory(snapshot,host,40000);
    const {text,bytes}=serializeSnapshot(snapshot);
    assert.ok(bytes>MAX_FILE_BYTES/2 && bytes<=snapshotHistoryBudget);
    return text;
  };
  const own=sized('Mac'),peer=sized('Windows');
  const seeded=JSON.parse(own).activityHistory[0].days;
  await seed(folder,'usage.json',JSON.parse(own));
  for(const run of [()=>runHub(config,{transport:fakeTransport(peer),now:()=>now}),()=>recombine(config,{now:()=>now})]) {
    const combined=await run();
    assert.ok(combined.snapshots.Windows.activityHistory[0].days.length>0);
    const kept=combined.snapshots.Mac.activityHistory[0].days;
    assert.ok(kept.length>0 && kept.length<seeded.length);
    assert.equal(kept.at(-1).date,seeded.at(-1).date);
    const text=await readFile(path.join(folder,'public','local','combined.json'),'utf8');
    assert.ok(Buffer.byteLength(text)<MAX_FILE_BYTES,`combined.json is ${Buffer.byteLength(text)} bytes`);
  }
}));

test('a delayed hub transfer keeps the newest observations per computer across spoke refreshes',()=>withFolder(async folder=>{
  const config=testConfig(folder,{platform:'windows',host:'Windows',device:{name:'PC'}});
  const copy=(observed,generated)=>({...combine([{host:'Mac',snapshot:ownSnapshot('Mac',observed)},
    {host:'Windows',snapshot:ownSnapshot('Windows',now-600000)}],{now:generated,generatedBy:'Mac'}),hub:{role:'hub'}});
  await seed(folder,'combined.json',copy(now-600000,now-600000));
  const local=ownSnapshot('Windows',now+300000);
  await seed(folder,'usage.json',local);
  await recombine(config,{now:()=>now+300000});
  const incoming=copy(now,now);
  await seed(folder,'combined.incoming.json',incoming);
  const merged=await recombine(config,{now:()=>now+360000});
  assert.equal(merged.snapshots.Mac.collectedAt,incoming.snapshots.Mac.collectedAt);
  assert.equal(merged.snapshots.Windows.collectedAt,local.collectedAt);
  assert.equal(merged.hub.hubWroteAt,incoming.generatedAt);
  await seed(folder,'combined.incoming.json',copy(now-600000,now+400000));
  const again=await recombine(config,{now:()=>now+420000});
  assert.equal(again.snapshots.Mac.collectedAt,incoming.snapshots.Mac.collectedAt);
  const bad=copy(now+450000,now+450000);
  bad.snapshots.Mac.providerTokenSources[0].days.push(null);
  await seed(folder,'combined.incoming.json',bad);
  const safe=await recombine(config,{now:()=>now+480000});
  assert.equal(safe.snapshots.Mac.collectedAt,incoming.snapshots.Mac.collectedAt);
  assert.equal(safe.snapshots.Windows.collectedAt,local.collectedAt);
}));

test('a spoke recombines its fresh snapshot with the hub rows it was sent',()=>withFolder(async folder=>{
  const hubCopy=await withFolder(async hub=>{
    await seed(hub,'usage.json',ownSnapshot('Mac',now));
    const transport=fakeTransport(JSON.stringify(ownSnapshot('Windows',now-600000)));
    await runHub(testConfig(hub,{role:'hub',hub:{spokes:[pc]}}),{transport,now:()=>now});
    return transport.pushed[0].text;
  });
  await seed(folder,'combined.json',JSON.parse(hubCopy));
  const fresh=ownSnapshot('Windows',now+300000);
  await seed(folder,'usage.json',fresh);
  const config=testConfig(folder,{platform:'windows',host:'Windows',device:{name:'PC'}});
  const combined=await recombine(config,{now:()=>now+300000});
  assert.equal(combined.hub.role,'spoke');
  assert.equal(combined.devices.find(d=>d.host==='Windows').collectedAt,fresh.collectedAt);
  assert.equal(combined.devices.find(d=>d.host==='Mac').collectedAt,ownSnapshot('Mac',now).collectedAt);
  assert.equal(combined.glance.today.length,2);
}));

test('a spoke on its own shows only itself',()=>withFolder(async folder=>{
  await seed(folder,'usage.json',ownSnapshot('Windows',now));
  const combined=await recombine(testConfig(folder,{platform:'windows',host:'Windows',device:{name:'PC'}}),{now:()=>now});
  assert.equal(combined.glance.today.length,1);
  assert.equal(combined.glance.both,null);
}));

test('Windows commands run PowerShell with no Node and no inline paths from the hub',()=>{
  const decode=command=>Buffer.from(command.split(' ').at(-1),'base64').toString('utf16le');
  assert.match(decode(pullCommand(pc)),/\$env:LOCALAPPDATA 'Observatory'/);
  assert.match(decode(pullCommand(pc)),/ToBase64String/);
  const push=decode(pushCommand(pc,1234,staged));
  assert.match(push,/\.Length -ne 1234\)\{Remove-Item -LiteralPath \$s -Force; exit 4\}/);
  assert.throws(()=>pushCommand(pc,0,staged),/empty/);
  assert.match(push,/Join-Path \$HOME '\.observatory-combined\.0{8}-0{4}-0{4}-0{4}-0{12}\.incoming'/);
  assert.throws(()=>pushCommand(pc,10,"x'; rm -rf ~"),/bad staging name/);
  assert.match(push,/\[IO\.File\]::Replace/);
  assert.match(decode(pullCommand({...pc,dataFolder:"D:\\it's"})),/'D:\\it''s'/);
});

test('Mac spoke commands use sh and base64',()=>{
  const mac={name:'Mac',ssh:'mac',platform:'mac',dataFolder:null};
  assert.match(pullCommand(mac),/base64 < "\$f"/);
  assert.match(pushCommand(mac,99,staged),/test "\$\(wc -c < "\$s"\)" -eq 99 \|\| \{ rm -f "\$s"; exit 4; \}; mkdir -p "\$d" && mv -f/);
  assert.match(pullCommand({...mac,dataFolder:"/Users/it's"}),/'\/Users\/it'\\''s'/);
});

test('the transport pulls base64 over SSH and pushes a copied file, then swaps it in',async()=>{
  const calls=[];
  const text=JSON.stringify({collectedAt:'2026-10-21T17:00:00Z',note:'é ✓'});
  let copied=null,local=null;
  const transport=sshTransport(async(alias,command)=>{
    calls.push({alias,command});
    return Buffer.from(text).toString('base64')+'\r\n';
  },async(alias,file,name)=>{copied=await readFile(file,'utf8');local=file;calls.push({alias,copy:true,name});});
  assert.equal(await transport.pull(pc),text);
  await transport.push(pc,text);
  assert.equal(calls[0].alias,'my-pc');
  assert.equal(copied,text);
  assert.deepEqual(calls.slice(1).map(call=>call.copy?'copy':'swap'),['copy','swap'],'the swap runs after the copy');
  await assert.rejects(readFile(local),{code:'ENOENT'},'the local copy is removed');
  assert.ok(Buffer.from(calls[2].command.split(' ').at(-1),'base64').toString('utf16le').includes(calls[1].name),'the swap uses the copied name');
});

test('a failed swap removes its staged copy and still fails',async()=>{
  const commands=[];
  const transport=sshTransport(async(alias,command)=>{commands.push(command);if(commands.length===1)throw Error('timed out');},async()=>{});
  await assert.rejects(transport.push({...pc,platform:'mac'},'{}'),/timed out/);
  assert.match(commands[1],/^rm -f "\$HOME\/\.observatory-combined\.[0-9a-f-]{36}\.incoming"$/);
});

test('a pulled snapshot from the future or of another schema is refused, and the last copy kept',()=>withFolder(async folder=>{
  await seed(folder,'usage.json',ownSnapshot('Mac',now));
  const config=testConfig(folder,{role:'hub',hub:{spokes:[pc]}});
  await runHub(config,{transport:fakeTransport(JSON.stringify(ownSnapshot('Windows',now-600000))),now:()=>now-600000});
  const future=ownSnapshot('Windows',now,snapshot=>({...snapshot,collectedAt:new Date(now+3600000).toISOString()}));
  const combined=await runHub(config,{transport:fakeTransport(JSON.stringify(future)),now:()=>now});
  assert.equal(combined.hub.spokes[0].pull,'snapshot is dated in the future');
  assert.equal(combined.devices[1].collectedAt,ownSnapshot('Windows',now-600000).collectedAt);
  const other=await runHub(config,{transport:fakeTransport(JSON.stringify({...ownSnapshot('Windows',now),schema:3})),now:()=>now});
  assert.equal(other.hub.spokes[0].pull,'invalid snapshot');
}));

test('write-back lands in an inbox that the spoke merges under its own lock',()=>withFolder(async folder=>{
  const decode=command=>Buffer.from(command.split(' ').at(-1),'base64').toString('utf16le');
  assert.match(decode(pushCommand(pc,10,staged)),/'combined\.incoming\.json'/);
  assert.match(pushCommand({name:'Mac',ssh:'m',platform:'mac',dataFolder:null},10,staged),/combined\.incoming\.json"$/);
  assert.doesNotMatch(decode(pushCommand(pc,10,staged)),/'\.combined\.incoming'/);
  assert.doesNotMatch(pushCommand({name:'Mac',ssh:'m',platform:'mac',dataFolder:null},10,staged),/\/\.combined\.incoming"/);
  const hubCopy=await withFolder(async hub=>{
    await seed(hub,'usage.json',ownSnapshot('Mac',now));
    const transport=fakeTransport(JSON.stringify(ownSnapshot('Windows',now-600000)));
    await runHub(testConfig(hub,{role:'hub',hub:{spokes:[pc]}}),{transport,now:()=>now});
    return JSON.parse(transport.pushed[0].text);
  });
  const config=testConfig(folder,{platform:'windows',host:'Windows',device:{name:'PC'}});
  await seed(folder,'usage.json',ownSnapshot('Windows',now+60000));
  await seed(folder,'combined.incoming.json',hubCopy);
  const merged=await recombine(config,{now:()=>now+60000});
  assert.ok(merged.devices.some(device=>device.host==='Mac'));
  assert.equal(merged.hub.hubWroteAt,hubCopy.generatedAt);
  const older={...hubCopy,generatedAt:new Date(now-3600000).toISOString(),snapshots:{}};
  await seed(folder,'combined.incoming.json',older);
  const again=await recombine(config,{now:()=>now+120000});
  assert.ok(again.devices.some(device=>device.host==='Mac'));
}));

test('a failed write-back is saved in combined.json',()=>withFolder(async folder=>{
  await seed(folder,'usage.json',ownSnapshot('Mac',now));
  const transport={pull:async()=>JSON.stringify(ownSnapshot('Windows',now)),push:async()=>{throw Error('timed out');}};
  await runHub(testConfig(folder,{role:'hub',hub:{spokes:[pc]}}),{transport,now:()=>now});
  const saved=await read(folder,'combined.json');
  assert.deepEqual(saved.hub.spokes,[{name:'PC',host:'Windows',pull:'ok',push:'timed out'}]);
}));

test('ssh and scp get a fixed environment, so a SendEnv line cannot forward other variables', () => {
  const source={HOME:'/h',USER:'u',PATH:'/bin',SSH_AUTH_SOCK:'/s',LANG:'en_US.UTF-8',LC_ALL:'C',CLAUDECODE:'1',ANTHROPIC_API_KEY:'synthetic',GITHUB_TOKEN:'synthetic'};
  assert.deepEqual(sshEnvironment(source,'darwin'),{HOME:'/h',USER:'u',PATH:'/bin',SSH_AUTH_SOCK:'/s'});
  const windows=sshEnvironment({USERPROFILE:'C:\\Users\\u',SystemRoot:'C:\\Windows',Path:'C:\\Windows',OPENAI_API_KEY:'synthetic'},'win32');
  assert.deepEqual(windows,{USERPROFILE:'C:\\Users\\u',SystemRoot:'C:\\Windows',Path:'C:\\Windows'});
});
