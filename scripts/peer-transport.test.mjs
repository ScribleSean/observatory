import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePeerTransport,sshPeerExchange,sshPeerSetup,sshPeerRepairReadiness} from './peer-transport.mjs';
import {createPairingConfigurations,validatePairing} from './peer-pairing.mjs';

const transport=()=>({kind:'ssh-windows',hostAlias:'windows-codex',remoteNode:'C:/Apps/Observatory/node.exe',
  remoteScript:'C:/Apps/Observatory/peer-exchange.mjs',remoteRuntime:"C:/Users/Example's Account/Observatory"});
test('explicit TLS addresses work for either host and cannot enter SSH execution',async()=>{
  const value={kind:'tls',address:'100.64.0.2',port:43128};
  for(const pair of Object.values(createPairingConfigurations()))
    assert.deepEqual(validatePairing({...pair,transport:value}).transport,value);
  for(const change of [{address:'example.com'},{address:'8.8.8.8'},{port:0},{port:65536},{extra:true}])
    assert.throws(()=>validatePeerTransport({...value,...change}));
  assert.throws(()=>validatePeerTransport(Object.assign([],value)));
  for(const key of Object.keys(value)) {
    const inherited={...value};delete inherited[key];
    Object.setPrototypeOf(inherited,{[key]:value[key]});inherited.extra=true;
    assert.throws(()=>validatePeerTransport(inherited));
  }
  let invoked=false;
  await assert.rejects(sshPeerExchange(value,{},async()=>{invoked=true;}));
  assert.equal(invoked,false);
});
test('SSH uses verified keys, bounded fixed commands, and stdin for private records',async()=>{
  const record={privateFixture:'not-an-argument'};
  const result=await sshPeerExchange(transport(),record,async(args,input)=>{
    assert.ok(args.includes('StrictHostKeyChecking=yes'));assert.ok(args.includes('BatchMode=yes'));
    assert.ok(args.includes('PasswordAuthentication=no'));assert.ok(args.includes('KbdInteractiveAuthentication=no'));
    assert.ok(!args.join(' ').includes(record.privateFixture));assert.deepEqual(JSON.parse(input),{version:1,record});
    const command=Buffer.from(args.at(-1).split(' ').at(-1),'base64').toString('utf16le');
    assert.ok(command.includes("Example''s Account"));assert.ok(!command.includes(record.privateFixture));
    return JSON.stringify({version:1,record:{response:'fixture'}});
  });
  assert.deepEqual(result,{response:'fixture'});
});
test('transport rejects command-like aliases, traversal, unexpected executables and protocol fields',async()=>{
  for(const change of [{hostAlias:'-oProxyCommand=bad'},{hostAlias:'host;bad'},
    {remoteNode:'C:/Apps/cmd.exe'},{remoteRuntime:'C:/../private'},{remoteScript:'C:/Apps/other.mjs'},
    {remoteRuntime:'C:/Apps/stream:alternate'},{extra:true}])assert.throws(()=>validatePeerTransport({...transport(),...change}));
  await assert.rejects(sshPeerExchange(transport(),{},async()=>'{"version":1,"record":{},"extra":true}'));
  await assert.rejects(sshPeerExchange(transport(),{},async()=>{throw Error('offline');}));
});
test('only the Mac pairing can opt in to Windows SSH transport',()=>{
  const pair=createPairingConfigurations();
  assert.deepEqual(validatePairing({...pair.Mac,transport:transport()}).transport,transport());
  assert.throws(()=>validatePairing({...pair.Windows,transport:transport()}));
});

test('setup uses only the fixed sibling endpoint and sends private configuration on stdin',async()=>{
  const pairing=createPairingConfigurations().Windows;
  const result=await sshPeerSetup(transport(),pairing,async(args,input)=>{
    const command=Buffer.from(args.at(-1).split(' ').at(-1),'base64').toString('utf16le');
    assert.ok(command.includes('peer-setup-endpoint.mjs'));
    assert.ok(!command.includes('peer-exchange.mjs'));
    assert.ok(args.includes('StrictHostKeyChecking=yes'));
    assert.ok(args.includes('BatchMode=yes'));
    assert.ok(!command.includes(pairing.local.comparisonSalt));
    assert.deepEqual(JSON.parse(input),{version:1,pairing});
    return '{"version":1,"status":"ready"}';
  });
  assert.deepEqual(result,{version:1,status:'ready'});
  await assert.rejects(sshPeerSetup(transport(),pairing,async()=>'{"version":1,"status":"ready","extra":true}'));
});

test('repair readiness only queries the setup endpoint and rejects malformed confirmations',async()=>{
  const nonce='a'.repeat(64);
  const valid={version:1,status:'repair-ready',nonce};
  assert.equal(await sshPeerRepairReadiness(transport(),async(args,input)=>{
    const command=Buffer.from(args.at(-1).split(' ').at(-1),'base64').toString('utf16le');
    assert.ok(command.includes('peer-setup-endpoint.mjs'));
    assert.ok(!command.includes('peer-repair.mjs'));
    assert.ok(!command.includes('--confirm-local-retirement'));
    assert.ok(args.includes('StrictHostKeyChecking=yes'));
    assert.ok(args.includes('BatchMode=yes'));
    assert.deepEqual(JSON.parse(input),{version:1,action:'repair-readiness'});
    return JSON.stringify(valid);
  }),nonce);
  for(const response of [null,[],{...valid,version:2},{...valid,status:'ready'},
    {...valid,nonce:'PRIVATE'},{...valid,nonce:'A'.repeat(64)},{...valid,extra:true}]) {
    await assert.rejects(sshPeerRepairReadiness(transport(),async()=>JSON.stringify(response)));
  }
  await assert.rejects(sshPeerRepairReadiness(transport(),async()=>'x'.repeat(8193)),/response limit/);
  await assert.rejects(sshPeerRepairReadiness(transport(),async()=>{throw Error('offline');}),/offline/);
});
