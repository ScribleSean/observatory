import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {runHub,recombine} from '../scripts/hub.mjs';
import {pullCommand,pushCommand,sshTransport} from '../scripts/hub-transport.mjs';
import {withFolder,ownSnapshot,testConfig} from './helpers.mjs';

const pc={name:'PC',ssh:'windows-codex',platform:'windows',dataFolder:null};
const now=Date.parse('2026-10-21T17:00:00Z');

async function seed(folder,file,value) {
  const local=path.join(folder,'public','local');
  await mkdir(local,{recursive:true});
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
  // The spoke's own device name wins over the hub's label for it.
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
  const push=decode(pushCommand(pc,1234));
  assert.match(push,/if\(\$b\.Length -ne 1234\)\{exit 4\}/);
  assert.throws(()=>pushCommand(pc,0),/empty/);
  assert.match(push,/FromBase64String/);
  assert.match(push,/\[IO\.File\]::Replace/);
  assert.match(decode(pullCommand({...pc,dataFolder:"D:\\it's"})),/'D:\\it''s'/);
});

test('Mac spoke commands use sh and base64',()=>{
  const mac={name:'Mac',ssh:'mac',platform:'mac',dataFolder:null};
  assert.match(pullCommand(mac),/base64 < "\$f"/);
  assert.match(pushCommand(mac,99),/base64 -D > "\$t" && test "\$\(wc -c < "\$t"\)" -eq 99 && mv -f/);
  assert.match(pullCommand({...mac,dataFolder:"/Users/it's"}),/'\/Users\/it'\\''s'/);
});

test('the SSH transport moves bytes as base64 both ways',async()=>{
  const calls=[];
  const text=JSON.stringify({collectedAt:'2026-10-21T17:00:00Z',note:'é ✓'});
  const transport=sshTransport(async(alias,command,input)=>{
    calls.push({alias,command,input});
    return input===undefined || input===''?Buffer.from(text).toString('base64')+'\r\n':'';
  });
  assert.equal(await transport.pull(pc),text);
  await transport.push(pc,text);
  assert.equal(calls[0].alias,'windows-codex');
  assert.equal(Buffer.from(calls[1].input,'base64').toString('utf8'),text);
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
