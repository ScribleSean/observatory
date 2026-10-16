import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
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
    options:{timeout:8000,maxBuffer:1024*1024,killSignal:'SIGKILL',windowsHide:true,encoding:'utf8',env:{...process.env,TERM:'dumb'}}});
  await inspectTailscale(options);
  assert.equal(calls.length,2);
  assert.deepEqual(calls[0],calls[1]);
  assert.deepEqual(await tailscaleSelfAddresses(injected(running([ipv6.toUpperCase()]))),addresses('running',null,ipv6.toUpperCase()));
});

test('macOS status and self addresses copy the current environment and override TERM',async()=>{
  const originalTerm=process.env.TERM;
  try {
    for(const inspect of [inspectTailscale,tailscaleSelfAddresses]) {
      for(const term of [undefined,'xterm-256color']) {
        if(term===undefined)delete process.env.TERM;
        else process.env.TERM=term;
        const expectedEnv={...process.env,TERM:'dumb'};
        let recorded;
        await inspect({platform:'darwin',available:async()=>{},run:async(file,args,options)=>{
          recorded=options;
          return {stdout:running(['100.64.0.1'])};
        }});
        assert.deepEqual(recorded,{timeout:8000,maxBuffer:1024*1024,killSignal:'SIGKILL',windowsHide:true,encoding:'utf8',env:expectedEnv});
        assert.notEqual(recorded.env,process.env);
        assert.equal(process.env.TERM,term);
      }
    }
  }finally {
    if(originalTerm===undefined)delete process.env.TERM;
    else process.env.TERM=originalTerm;
  }
});

test('Windows status and self addresses keep the existing options without env',async()=>{
  for(const inspect of [inspectTailscale,tailscaleSelfAddresses]) {
    let recorded;
    await inspect({platform:'win32',programFiles:'C:\\Program Files',available:async()=>{},run:async(file,args,options)=>{
      recorded=options;
      return {stdout:running(['100.64.0.1'])};
    }});
    assert.equal(Object.hasOwn(recorded,'env'),false);
    assert.deepEqual(recorded,{timeout:8000,maxBuffer:1024*1024,killSignal:'SIGKILL',windowsHide:true,encoding:'utf8'});
  }
});

test('bridge environment runs the macOS CLI without launching its GUI',{skip:process.platform==='win32'},async()=>{
  const execute=promisify(execFile);
  const folder=await mkdtemp(path.join(os.tmpdir(),'tailscale-term-'));
  try {
    const fake=path.join(folder,'Tailscale');
    const failure='The Tailscale GUI failed to start (Tailscale.CLIError error 3.)';
    await writeFile(fake,`#!/bin/sh
if [ -z "$(/usr/bin/printenv TERM)" ]
then
  printf '%s\\n' '${failure}'
  exit 0
fi
printf '%s\\n' '{"BackendState":"Running","Self":{"Online":true,"TailscaleIPs":["100.64.0.1"]}}'
`,{mode:0o700});
    const bridgeEnv={PATH:'/usr/bin:/bin:/usr/sbin:/sbin'};
    for(const key of ['HOME','USER','LOGNAME','LANG','TMPDIR']) {
      if(process.env[key]!==undefined)bridgeEnv[key]=process.env[key];
    }
    const control=await execute(fake,['status','--json','--peers=false'],{env:bridgeEnv,encoding:'utf8'});
    assert.equal(control.stdout.trim(),failure);
    const source=`
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const {inspectTailscale}=await import(process.argv[2])
const execute=promisify(execFile)
const bridgeKeys=JSON.parse(process.argv[3])
// macOS can add this variable at startup, so restore the bridge fixture.
delete process.env.__CF_USER_TEXT_ENCODING
assert.deepEqual(Object.keys(process.env).sort(),bridgeKeys)
assert.equal(Object.hasOwn(process.env,'TERM'),false)
let calls=0
const value=await inspectTailscale({platform:'darwin',available:async()=>{},run:(file,args,options)=>{
  calls++
  assert.deepEqual(Object.keys(options.env).sort(),[...bridgeKeys,'TERM'].sort())
  assert.deepEqual(options.env,{...process.env,TERM:'dumb'})
  return execute(process.argv[1],args,options)
}})
assert.equal(calls,1)
assert.equal(value.status,'running')
console.log(JSON.stringify(value))
`;
    const {stdout}=await execute(process.execPath,['--input-type=module','-e',source,fake,
      new URL('./tailscale-status.mjs',import.meta.url).href,JSON.stringify(Object.keys(bridgeEnv).sort())],
    {env:bridgeEnv,encoding:'utf8',timeout:8000});
    assert.equal(JSON.parse(stdout).status,'running');
  }finally {
    await rm(folder,{recursive:true,force:true});
  }
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
