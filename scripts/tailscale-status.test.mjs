import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectTailscale,summarizeTailscale,tailscaleCandidates} from './tailscale-status.mjs';

test('Tailscale states never imply peer reachability or expose identity fields',()=>{
  for(const [BackendState,status] of Object.entries({NeedsLogin:'needs-login',NeedsMachineAuth:'needs-device-approval',Stopped:'stopped',Starting:'starting',NoState:'starting',InUseOtherUser:'other-user',Running:'running'})) {
    assert.deepEqual(summarizeTailscale(JSON.stringify({BackendState,Self:{Online:true,DNSName:'private.example'},AuthURL:'https://example.invalid/private-login',User:{secret:'private'},Peer:{secret:'private'}})),
      {version:1,status,peerReachability:'not-checked'});
  }
  assert.equal(summarizeTailscale('{"BackendState":"Running","Self":{"Online":false}}').status,'offline');
});

test('malformed, unexpected and excessive Tailscale output fails closed',()=>{
  for(const value of ['{','null','[]','{}','{"BackendState":"FutureState"}','{"BackendState":"Running"}',
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
});
