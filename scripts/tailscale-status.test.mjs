import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectTailscale,summarizeTailscale,tailscaleCandidates,tailscaleSelfAddresses} from './tailscale-status.mjs';

test('Tailscale states never imply peer reachability or expose identity fields',()=>{
  for(const [BackendState,status] of Object.entries({NeedsLogin:'needs-login',NeedsMachineAuth:'needs-device-approval',Stopped:'stopped',Starting:'starting',NoState:'starting',InUseOtherUser:'other-user',Running:'running'})) {
    assert.deepEqual(summarizeTailscale(JSON.stringify({BackendState,Self:{Online:true,DNSName:'private.example'},AuthURL:'https://example.invalid/private-login',User:{secret:'private'},Peer:{secret:'private'}})),
      {version:1,status,peerReachability:'not-checked'});
  }
  assert.equal(summarizeTailscale('{"BackendState":"Running","Self":{"Online":false}}').status,'offline');
});

test('malformed, unexpected and excessive Tailscale output fails closed',()=>{
  for(const value of ['{','null','[]','{}','{"BackendState":{"toString":null}}','{"BackendState":"FutureState"}','{"BackendState":"Running"}',
    '{"BackendState":"Running","Self":{"Online":"true"}}','x'.repeat(1024*1024+1),null])
    assert.equal(summarizeTailscale(value).status,'unavailable');
});

test('discovery is bounded to supported installation locations',()=>{
  assert.equal(tailscaleCandidates('darwin').length,3);
  assert.deepEqual(tailscaleCandidates('win32','D:\\Programs'),['D:\\Programs\\Tailscale\\tailscale.exe']);
  assert.deepEqual(tailscaleCandidates('win32','relative'),[]);
  assert.deepEqual(tailscaleCandidates('linux'),[]);
});

test('readiness only executes bounded read-only status, never login or network changes',async()=>{
  const calls=[];
  const value=await inspectTailscale({platform:'darwin',available:async()=>{},run:async(file,args,options)=>{
    calls.push({file,args,options});return {stdout:'{"BackendState":"NeedsLogin"}'};
  }});
  assert.equal(value.status,'needs-login');assert.equal(calls.length,1);
  assert.deepEqual(calls[0].args,['status','--json','--peers=false']);
  assert.equal(calls[0].options.timeout,8000);assert.equal(calls[0].options.maxBuffer,1024*1024);
  assert.equal(calls[0].options.shell,undefined);
});

test('missing client differs from denied access, failed command and unsupported OS',async()=>{
  const absent=async()=>{throw Object.assign(Error('synthetic'),{code:'ENOENT'});};
  assert.equal((await inspectTailscale({platform:'darwin',available:absent})).status,'not-installed');
  assert.equal((await inspectTailscale({platform:'win32',available:async()=>{throw Error('private error');}})).status,'unavailable');
  assert.equal((await inspectTailscale({platform:'darwin',available:async()=>{},run:async()=>{throw Error('private account detail');}})).status,'unavailable');
  assert.equal((await inspectTailscale({platform:'linux'})).status,'unsupported');
  assert.equal((await inspectTailscale({platform:'win32',programFiles:'relative'})).status,'unavailable');
});

const ipv4='100.101.102.103',ipv6='fd7a:115c:a1e0::1234';
const injected=stdout=>({platform:'darwin',available:async()=>{},run:async()=>({stdout})});
const running=TailscaleIPs=>JSON.stringify({BackendState:'Running',Self:{Online:true,TailscaleIPs}});
const addresses=(status,ipv4=null,ipv6=null)=>({version:1,status,ipv4,ipv6});

test('self addresses use the same single bounded read-only command',async()=>{
  const calls=[];
  const options={platform:'darwin',available:async()=>{},run:async(file,args,options)=>{
    calls.push({file,args,options});return {stdout:running([ipv4,ipv6,'100.101.102.104','fd7a:115c:a1e0::5678'])};
  }};
  assert.deepEqual(await tailscaleSelfAddresses(options),addresses('running',ipv4,ipv6));
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0],{file:tailscaleCandidates('darwin')[0],args:['status','--json','--peers=false'],
    options:{timeout:8000,maxBuffer:1024*1024,killSignal:'SIGKILL',windowsHide:true,encoding:'utf8'}});
  await inspectTailscale(options);
  assert.equal(calls.length,2);
  assert.deepEqual(calls[0],calls[1]);
  assert.deepEqual(await tailscaleSelfAddresses(injected(running([ipv6.toUpperCase()]))),addresses('running',null,ipv6.toUpperCase()));
});

test('only self IP entries can supply addresses',async()=>{
  const raw=JSON.stringify({BackendState:'Running',Self:{Online:true,DNSName:ipv4},
    Peer:{example:{TailscaleIPs:['100.101.102.104','fd7a:115c:a1e0::5678']}},
    DNSName:ipv6,User:{address:ipv4},AuthURL:ipv6});
  assert.deepEqual(await tailscaleSelfAddresses(injected(raw)),addresses('running'));
});

test('non-running and malformed status outputs never supply addresses',async()=>{
  for(const BackendState of ['NeedsLogin','NeedsMachineAuth','Stopped','Starting','NoState','InUseOtherUser','FutureState']) {
    const raw=JSON.stringify({BackendState,Self:{Online:true,TailscaleIPs:[ipv4,ipv6]}});
    assert.deepEqual(await tailscaleSelfAddresses(injected(raw)),addresses(summarizeTailscale(raw).status));
  }
  for(const Online of [false,undefined,'true']) {
    const raw=JSON.stringify({BackendState:'Running',Self:{Online,TailscaleIPs:[ipv4,ipv6]}});
    assert.deepEqual(await tailscaleSelfAddresses(injected(raw)),addresses(summarizeTailscale(raw).status));
  }
  for(const raw of ['{','null','[]','{}','x'.repeat(1024*1024+1),null])
    assert.deepEqual(await tailscaleSelfAddresses(injected(raw)),addresses('unavailable'));
});

test('self addresses are bounded and restricted to Tailscale ranges',async()=>{
  for(const entries of [undefined,null,{},ipv4,[],Array(8).fill(null).concat([ipv4,ipv6])])
    assert.deepEqual(await tailscaleSelfAddresses(injected(running(entries))),addresses('running'));
  for(const entry of ['fd7a:115c:a1e0::1234%en0','8.8.8.8','10.0.0.1','100.63.255.255',
    '100.128.0.0','fc00::1','fd00::1','f'.repeat(40),null,123,{},[]]) {
    assert.deepEqual(await tailscaleSelfAddresses(injected(running([entry]))),addresses('running'));
    assert.deepEqual(await tailscaleSelfAddresses(injected(running([entry,ipv4]))),addresses('running',ipv4));
    assert.deepEqual(await tailscaleSelfAddresses(injected(running([entry,ipv6]))),addresses('running',null,ipv6));
  }
  assert.deepEqual(await tailscaleSelfAddresses(injected(running(Array(7).fill(null).concat(ipv4)))),addresses('running',ipv4));
});

test('discovery and command failures preserve summary status without addresses',async()=>{
  const absent=async()=>{throw Object.assign(Error('synthetic'),{code:'ENOENT'});};
  for(const options of [
    {platform:'darwin',available:absent},
    {platform:'linux'},
    {platform:'win32',programFiles:'relative'},
    {platform:'darwin',available:async()=>{throw Error(ipv4);}},
    {platform:'darwin',available:async()=>{},run:async()=>{throw Error(ipv6);}}
  ]) {
    const summary=await inspectTailscale(options);
    assert.deepEqual(await tailscaleSelfAddresses(options),addresses(summary.status));
  }
});
