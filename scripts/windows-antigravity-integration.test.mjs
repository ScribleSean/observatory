import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectWindows} from './collect-windows.mjs';
import {collectConfiguredAntigravityAllowance} from './collect-antigravity-allowance.mjs';
import {packagedWindowsAllowanceHelper,runWindowsAntigravityCommand,readWindowsAntigravityAllowance} from './windows-antigravity-allowance.mjs';

const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../native/windows/bin/Release/net10.0-windows/win-x64');
const helper=path.join(app,'WorkspaceObservatory.exe');
const skip=process.platform!=='win32'?'Native Windows fixture required':!existsSync(helper)?'Build the native apphost before this acceptance test':false;
const config={activity:false,codex:false,claude:false,wispr:false,quota:false,antigravity:true};
async function until(check,label,limit=15000) {
  const end=Date.now()+limit;
  while(!await check()) {if(Date.now()>end)throw Error(label);await new Promise(resolve=>setTimeout(resolve,20));}
}
async function gone(directory,roles,limit=6000) {
  const deadline=Date.now()+limit;
  for(const role of roles) {
    const pid=Number(await readFile(path.join(directory,`${role}.pid`),'utf8'));
    assert.ok(Number.isSafeInteger(pid) && pid>0);
    await until(()=>{try{process.kill(pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}},`${role} remained alive`,Math.max(1,deadline-Date.now()));
  }
}
async function fixture(t) {
  const root=await mkdtemp(path.join(tmpdir(),'observatory-allowance-fixture-')),directory=path.join(root,'collector');
  await mkdir(directory);await writeFile(path.join(directory,'.synthetic'),'fictional only');
  await writeFile(path.join(directory,'collector.config.json'),JSON.stringify(config));
  const owned=[];
  t.after(async()=>{
    for(const child of owned)if(child.exitCode===null && child.signalCode===null) {
      const closed=once(child,'close');child.kill();await closed;
    }
    const marked=['native-parent','node','owner','root','child','grandchild'].filter(role=>existsSync(path.join(directory,`${role}.pid`)));
    await gone(directory,marked,35000);
    await rm(root,{recursive:true,force:true});
  });
  return {directory,owned};
}
function reader(directory,owned,scenario='owner-json') {
  return options=>collectConfiguredAntigravityAllowance({...options,
    resolveExecutable:async()=>path.join(directory,'agy.exe'),windowsRead:options=>readWindowsAntigravityAllowance({...options,helper,
      run:(exe,settings)=>runWindowsAntigravityCommand(exe,{...settings,spawnProcess:(file,args,settings)=>{
        assert.equal(file,helper);assert.deepEqual(args,['--antigravity-usage',path.join(directory,'agy.exe')]);
        const child=spawn(file,['--test-antigravity-process',scenario,directory],settings);owned.push(child);return child;
      }})})});
}

test('fictional Windows collector uses the native lease, validates JSON and preserves other source boundaries',{skip},async t=>{
  const {directory,owned}=await fixture(t);
  assert.equal(await packagedWindowsAllowanceHelper({capability:helper,scripts:path.join(app,'Collector','scripts')}),helper);
  const closed=await collectWindows(directory);
  assert.equal(closed.data.providerAllowances[0].status,'unsupported');assert.equal(owned.length,0);
  const result=await collectWindows(directory,null,{readAntigravity:reader(directory,owned)});
  assert.equal(result.status.sourcesConfigured,1);assert.equal(result.status.sourcesRead,1);
  assert.equal(result.data.providerAllowances[0].status,'ok');assert.equal(result.data.providerAllowances[0].windows[0].remainingPercent,75);
  assert.equal(result.data.quota.status,'not-connected');assert.ok(result.data.tokens.every(source=>source.status==='not-connected'));
  assert.equal(JSON.stringify(result.peer??{}).includes('providerAllowances'),false);
  const saved=JSON.parse(await readFile(path.join(directory,'public/local/usage.json'),'utf8'));
  assert.equal(JSON.stringify(saved).includes('PRIVATE'),false);
  await gone(directory,['owner','root','child','grandchild']);
  await collectWindows(directory,null,{quotaOnly:true,readAntigravity:()=>assert.fail('Quota-only polled this provider')});
  const refreshed=JSON.parse(await readFile(path.join(directory,'public/local/usage.json'),'utf8'));
  assert.deepEqual(refreshed.providerAllowances,saved.providerAllowances);assert.equal(refreshed.collectedAt,saved.collectedAt);
  await writeFile(path.join(directory,'collector.config.json'),JSON.stringify({...config,antigravity:false}));
  const disabled=await collectWindows(directory,null,{readAntigravity:options=>collectConfiguredAntigravityAllowance({...options,
    resolveExecutable:()=>assert.fail('Disabled discovery'),windowsRead:()=>assert.fail('Disabled reader')})});
  assert.equal(disabled.data.providerAllowances[0].status,'not-connected');assert.equal(disabled.status.sourcesConfigured,0);
});

test('Windows cancellation after a fictional response prevents publication',{skip},async t=>{
  const {directory,owned}=await fixture(t),abort=new AbortController();
  const read=reader(directory,owned);
  await assert.rejects(collectWindows(directory,null,{signal:abort.signal,readAntigravity:async options=>{
    const result=await read(options);abort.abort();return result;
  }}));
  assert.equal(existsSync(path.join(directory,'public/local/usage.json')),false);
  await gone(directory,['owner','root','child','grandchild']);
});

test('native parent death propagates through Node and helper leases to the owned fictional tree',{skip,timeout:45000},async t=>{
  const {directory,owned}=await fixture(t);
  const started=performance.now();
  const parent=spawn(helper,['--test-antigravity-process','collector-parent',directory,process.execPath],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  owned.push(parent);parent.stdout.resume();parent.stderr.resume();
  await until(()=>existsSync(path.join(directory,'ready')),'Native lease chain did not become ready');
  const killedAt=performance.now(),closed=once(parent,'close');parent.kill();await closed;
  await gone(directory,['native-parent','node','owner','root','child','grandchild']);
  assert.ok(performance.now()-killedAt<6000,'Entire post-kill cleanup exceeded six seconds');
  assert.ok(performance.now()-started<24000,'Cleanup must precede the 25s natural command timeout, including startup');
  assert.equal(existsSync(path.join(directory,'public/local/usage.json')),false);
});

test('Node collector death closes its helper lease and kills the fictional descendants',{skip,timeout:45000},async t=>{
  const {directory,owned}=await fixture(t);
  const bridge=new URL('./windows-antigravity-allowance.mjs',import.meta.url).href;
  const script=`import {spawn} from 'node:child_process';
    import {writeFile} from 'node:fs/promises';import path from 'node:path';
    import {runWindowsAntigravityCommand} from ${JSON.stringify(bridge)};
    const [directory,helper]=process.argv.slice(1);
    await writeFile(path.join(directory,'node.pid'),String(process.pid));
    await runWindowsAntigravityCommand(path.join(directory,'agy.exe'),{helper,spawnProcess:(file,args,options)=>{
      if(file!==helper || args[0]!=='--antigravity-usage' || args[1]!==path.join(directory,'agy.exe'))throw Error('Wrong fixture command');
      return spawn(file,['--test-antigravity-process','owner-chain',directory],options);
    }}).catch(()=>{process.exitCode=1;});`;
  const started=performance.now();
  const node=spawn(process.execPath,['--input-type=module','--eval',script,directory,helper],{windowsHide:true,stdio:'ignore'});
  owned.push(node);
  await until(()=>existsSync(path.join(directory,'ready')),'Node lease chain did not become ready');
  const killedAt=performance.now(),closed=once(node,'close');node.kill();await closed;
  await gone(directory,['node','owner','root','child','grandchild']);
  assert.ok(performance.now()-killedAt<6000,'Entire post-kill cleanup exceeded six seconds');
  assert.ok(performance.now()-started<24000,'Cleanup must precede the 25s natural command timeout, including startup');
});


test('native owner EOF during a pending configuration read prevents any allowance callback or helper launch',{skip,timeout:45000},async t=>{
  const {directory,owned}=await fixture(t);
  await writeFile(path.join(directory,'collector.config.json'),JSON.stringify({...config,antigravity:false}));
  const started=performance.now();
  const parent=spawn(helper,['--test-antigravity-process','collector-parent-before-read',directory,process.execPath],
    {windowsHide:true,stdio:['ignore','pipe','pipe']});
  owned.push(parent);parent.stdout.resume();parent.stderr.resume();
  await until(()=>existsSync(path.join(directory,'before-read-ready')),'Configuration read barrier was not reached');
  const killedAt=performance.now(),closed=once(parent,'close');parent.kill();await closed;
  await gone(directory,['native-parent','node']);
  assert.ok(performance.now()-killedAt<6000,'Owner EOF must stop Node promptly');
  assert.ok(performance.now()-started<24000,'Owner EOF must precede the fictional 30s watchdog');
  for(const file of ['late-allowance-callback','owner.pid','root.pid','public/local/usage.json'])
    assert.equal(existsSync(path.join(directory,file)),false,file+' must remain absent after owner EOF');
});
