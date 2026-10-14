import assert from 'node:assert/strict';
import test from 'node:test';
import {lstat,mkdtemp,readFile,readdir,rm,symlink,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {claudeLimitsConsent,claudeStatuslineInstalled,attachClaudeLimits,claudeLimitsSource,extractClaudeLimits,mergeClaudeLimits,readClaudeLimits,recordClaudeLimits} from './claude-limits.mjs';
import {ownLine} from './claude-statusline-bridge.mjs';
import {bridgeCommand,installStatusline,statuslineStatus,uninstallStatusline} from './claude-statusline-install.mjs';

import {setLimitsConsent,clearLimitsConsent,limitsConsentStatus} from './claude-limits-consent.mjs';

const run=promisify(execFile);
const now=Date.parse('2026-03-10T15:00:00Z'),seconds=now/1000;
const input=(five=23.5,seven=41.2)=>({session_id:'synthetic',cwd:'/synthetic/project',transcript_path:'/synthetic/transcript.jsonl',
  model:{display_name:'Synthetic'},rate_limits:{
    five_hour:{used_percentage:five,resets_at:seconds+7200},seven_day:{used_percentage:seven,resets_at:seconds+3*86400}}});
async function folder(t) {
  const root=realpathSync(await mkdtemp(path.join(tmpdir(),'observatory-claude-limits-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  return root;
}

async function bridgeFixture(t) {
  const bridge=path.join(await folder(t),'claude-statusline-bridge.mjs');
  await writeFile(bridge,'// Synthetic bridge\n');
  return bridge;
}

test('extraction keeps only percentages and reset times', () => {
  const record=extractClaudeLimits(input(),now);
  assert.deepEqual(record,{observedAt:seconds,windows:{
    five_hour:{usedPercentage:23.5,resetsAt:seconds+7200,observedAt:seconds},
    seven_day:{usedPercentage:41.2,resetsAt:seconds+3*86400,observedAt:seconds}}});
  assert.doesNotMatch(JSON.stringify(record),/synthetic|project|transcript/i);
});

test('missing, malformed and impossible readings are rejected', () => {
  for(const value of [null,{},{rate_limits:null},{rate_limits:{}},{rate_limits:{five_hour:{used_percentage:'23',resets_at:seconds+60}}},
    {rate_limits:{five_hour:{used_percentage:120,resets_at:seconds+60}}},{rate_limits:{five_hour:{used_percentage:-1,resets_at:seconds+60}}},
    {rate_limits:{five_hour:{used_percentage:10,resets_at:seconds-60}}},{rate_limits:{five_hour:{used_percentage:10,resets_at:seconds+30*86400}}},
    {rate_limits:{five_hour:{used_percentage:Number.NaN,resets_at:seconds+60}}}])
    assert.equal(extractClaudeLimits(value,now),null);
  const partial=extractClaudeLimits({rate_limits:{seven_day:{used_percentage:5,resets_at:seconds+60}}},now);
  assert.deepEqual(Object.keys(partial.windows),['seven_day']);
});

test('several sessions keep the higher reading within one reset period', () => {
  const first=extractClaudeLimits(input(40,10),now);
  const lower=extractClaudeLimits(input(35,12),now+60000);
  const merged=mergeClaudeLimits(first,lower,now+60000);
  assert.equal(merged.windows.five_hour.usedPercentage,40);
  assert.equal(merged.windows.five_hour.observedAt,seconds+60);
  assert.equal(merged.windows.seven_day.usedPercentage,12);
  const later=input(2,12);later.rate_limits.five_hour.resets_at=seconds+7200+18000;
  assert.equal(mergeClaudeLimits(merged,extractClaudeLimits(later,now+120000),now+120000).windows.five_hour.usedPercentage,2);
  assert.deepEqual(mergeClaudeLimits({windows:'bad'},first,now),first);
  assert.equal(mergeClaudeLimits(first,null,now).windows.five_hour.usedPercentage,40);
});

test('the snapshot source separates off, missing, current, old and reset readings', () => {
  const record=extractClaudeLimits(input(),now);
  assert.deepEqual(claudeLimitsSource(record,{enabled:false,now}),{provider:'Claude Code',scope:'account',status:'not-connected',windows:[]});
  assert.equal(claudeLimitsSource(null,{enabled:true,now}).status,'unavailable');
  const current=claudeLimitsSource(record,{enabled:true,now:now+60000});
  assert.equal(current.status,'ok');
  assert.equal(current.checkedAt,'2026-03-10T15:00:00.000Z');
  assert.deepEqual(current.windows,[
    {bucket:'claude',window:'five_hour',durationMinutes:300,remainingPercent:76.5,resetsAt:'2026-03-10T17:00:00.000Z'},
    {bucket:'claude',window:'seven_day',durationMinutes:10080,remainingPercent:58.8,resetsAt:'2026-03-13T15:00:00.000Z'}]);
  assert.equal(claudeLimitsSource(record,{enabled:true,now:now+30*60000}).status,'stale');
  const afterReset=claudeLimitsSource(record,{enabled:true,now:now+3*3600000});
  assert.deepEqual(afterReset.windows.map(window=>window.window),['seven_day']);
  assert.equal(claudeLimitsSource(record,{enabled:true,now:now+10*86400000}).status,'unavailable');
  assert.equal(claudeLimitsSource({observedAt:seconds+9999,windows:{five_hour:{usedPercentage:1,resetsAt:seconds+99999,observedAt:seconds+9999}}},{enabled:true,now}).status,'unavailable');
});

test('recording writes one small private file and reading needs the install marker', async t => {
  const runtime=await folder(t);
  assert.equal(await recordClaudeLimits(runtime,{rate_limits:{}},now),null);
  await recordClaudeLimits(runtime,input(),now);
  assert.deepEqual(await readdir(path.join(runtime,'claude-limits')),['limits.json']);
  assert.doesNotMatch(await readFile(path.join(runtime,'claude-limits/limits.json'),'utf8'),/synthetic|project|transcript/i);
  assert.equal((await readClaudeLimits(runtime,{now})).status,'not-connected');
  await writeFile(path.join(runtime,'claude-limits/statusline.json'),'{"previous":null}');
  // Tests never start the real Claude Code command.
  const source=await readClaudeLimits(runtime,{now:now+1000,readUsage:async()=>({status:'unrecognized',usage:null})});
  assert.equal(source.status,'ok');
  const result={data:{}};attachClaudeLimits(result,source);
  assert.equal(result.data.claudeLimits.windows.length,2);
});

test('a linked folder or file is refused', {skip:process.platform==='win32'}, async t => {
  const runtime=await folder(t),elsewhere=await folder(t);
  await symlink(elsewhere,path.join(runtime,'claude-limits'));
  await assert.rejects(recordClaudeLimits(runtime,input(),now),/Unsafe/);
  const second=await folder(t);
  await mkdir(path.join(second,'claude-limits'));
  await writeFile(path.join(elsewhere,'marker.json'),'{"previous":null}');
  await symlink(path.join(elsewhere,'marker.json'),path.join(second,'claude-limits/statusline.json'));
  assert.equal((await readClaudeLimits(second,{now})).status,'not-connected');
});

test('install needs consent, saves the earlier status line and uninstall restores it', async t => {
  const runtime=await folder(t),home=await folder(t);
  const settingsPath=path.join(home,'settings.json');
  const earlier={type:'command',command:'echo earlier',padding:0};
  await writeFile(settingsPath,JSON.stringify({model:'synthetic',statusLine:earlier}));
  const options={runtime,settingsPath,node:'/synthetic/node',bridge:await bridgeFixture(t)};
  await assert.rejects(installStatusline(options),/consent/);
  assert.deepEqual(JSON.parse(await readFile(settingsPath,'utf8')).statusLine,earlier);
  assert.deepEqual(await installStatusline({...options,consent:true}),{installed:true,replacedStatusLine:true,settingsPath});
  const installed=JSON.parse(await readFile(settingsPath,'utf8'));
  assert.equal(installed.model,'synthetic');
  // The installer writes forward slashes on Windows, so the command also runs in Git Bash.
  const quoted=process.platform==='win32'?runtime.replaceAll('\\','/'):runtime;
  assert.equal(installed.statusLine.command,`"/synthetic/node" "${process.platform==='win32'?options.bridge.replaceAll('\\','/'):options.bridge}" --runtime "${quoted}"`);
  assert.deepEqual(JSON.parse(await readFile(settingsPath+'.observatory-backup','utf8')).statusLine,earlier);
  assert.equal((await statuslineStatus({runtime,settingsPath})).installed,true);
  await installStatusline({...options,consent:true});
  assert.deepEqual(JSON.parse(await readFile(path.join(runtime,'claude-limits/statusline.json'),'utf8')).previous,earlier);
  assert.deepEqual(await uninstallStatusline({runtime,settingsPath}),{installed:false,restoredStatusLine:true,settingsPath});
  assert.deepEqual(JSON.parse(await readFile(settingsPath,'utf8')),{model:'synthetic',statusLine:earlier});
  assert.equal((await readClaudeLimits(runtime,{now})).status,'not-connected');
});

test('install without an earlier status line or settings file, and refusal of bad input', async t => {
  const runtime=await folder(t),home=await folder(t);
  const settingsPath=path.join(home,'settings.json');
  const options={runtime,settingsPath,node:'/synthetic/node',bridge:await bridgeFixture(t),consent:true};
  assert.equal((await installStatusline(options)).replacedStatusLine,false);
  await uninstallStatusline({runtime,settingsPath});
  assert.deepEqual(JSON.parse(await readFile(settingsPath,'utf8')),{});
  await writeFile(settingsPath,'[1,2]');
  await assert.rejects(installStatusline(options),/not a JSON object/);
  assert.equal(await readFile(settingsPath,'utf8'),'[1,2]');
  await writeFile(settingsPath,'{not json');
  await assert.rejects(installStatusline(options));
  assert.equal(await readFile(settingsPath,'utf8'),'{not json');
  assert.throws(()=>bridgeCommand('/a/node','/a/b"c.mjs','/r'),/Paths/);
  assert.throws(()=>bridgeCommand('node','/a/b.mjs','/r'),/Paths/);
  assert.equal(bridgeCommand('C:\\a\\node.exe','C:\\a\\b.mjs','C:\\r','win32'),'"C:/a/node.exe" "C:/a/b.mjs" --runtime "C:/r"');
});

test('the bridge records limits and prints the earlier status line output', async t => {
  const runtime=await folder(t);
  const bridge=fileURLToPath(new URL('./claude-statusline-bridge.mjs',import.meta.url));
  const fresh=()=>{const value=input();const at=Math.floor(Date.now()/1000);
    value.rate_limits.five_hour.resets_at=at+7200;value.rate_limits.seven_day.resets_at=at+86400;return JSON.stringify(value);};
  const invoke=text=>{const child=run(process.execPath,[bridge,'--runtime',runtime],{timeout:15000});child.child.stdin.end(text);return child;};
  assert.equal((await invoke(fresh())).stdout,'5h 77% left · 7d 59% left\n');
  assert.equal(JSON.parse(await readFile(path.join(runtime,'claude-limits/limits.json'),'utf8')).windows.five_hour.usedPercentage,23.5);
  await writeFile(path.join(runtime,'claude-limits/statusline.json'),JSON.stringify({previous:{type:'command',command:`"${process.execPath}" -e "process.stdout.write('earlier line')"`}}));
  assert.equal((await invoke(fresh())).stdout,'earlier line');
  assert.equal((await invoke('not json')).stdout,'earlier line');
  assert.equal(ownLine({},Date.now()),'');
});

test('cost extraction validates bounds and rounds to cents without inventing missing values', () => {
  for(const usd of [0,1.236,10000]) {
    const sessionCost={usd:Math.round(usd*100)/100,observedAt:seconds};
    assert.deepEqual(extractClaudeLimits({cost:{total_cost_usd:usd}},now),{observedAt:seconds,windows:{},sessionCost});
    assert.deepEqual(extractClaudeLimits({...input(),cost:{total_cost_usd:usd}},now).sessionCost,sessionCost);
  }
  for(const cost of [undefined,null,{},'bad',{total_cost_usd:'1'},{total_cost_usd:NaN},
    {total_cost_usd:Infinity},{total_cost_usd:-1},{total_cost_usd:10000.01}]) {
    assert.equal(extractClaudeLimits({cost},now),null);
    assert.deepEqual(extractClaudeLimits({...input(),cost},now),extractClaudeLimits(input(),now));
  }
});

test('stored costs are sanitized independently of windows and determine the newest observation', () => {
  const record=extractClaudeLimits(input(),now);
  const cost={usd:1.236,observedAt:seconds+60,private:'synthetic'};
  assert.deepEqual(mergeClaudeLimits({...record,sessionCost:cost},null,now),
    {...record,observedAt:seconds+60,sessionCost:{usd:1.24,observedAt:seconds+60}});
  assert.deepEqual(mergeClaudeLimits({sessionCost:cost},null,now),
    {observedAt:seconds+60,windows:{},sessionCost:{usd:1.24,observedAt:seconds+60}});
  for(const sessionCost of [null,[],{usd:'1',observedAt:seconds},{usd:NaN,observedAt:seconds},
    {usd:-1,observedAt:seconds},{usd:10000.01,observedAt:seconds},
    ...[0,-1,seconds+61,seconds+0.5,Number.MAX_SAFE_INTEGER+1,'1'].map(observedAt=>({usd:1,observedAt}))]) {
    assert.deepEqual(mergeClaudeLimits({...record,sessionCost},null,now),record);
    assert.equal(mergeClaudeLimits({windows:{},sessionCost},null,now),null);
  }
});

test('cost freshness and consent do not change window status or checked time', () => {
  const record=extractClaudeLimits({...input(),cost:{total_cost_usd:2.34}},now);
  for(const age of [599,600,601]) {
    const source=claudeLimitsSource(record,{enabled:true,now:now+age*1000});
    const {sessionCost,...windowSource}=source;
    assert.deepEqual(windowSource,claudeLimitsSource(extractClaudeLimits(input(),now),{enabled:true,now:now+age*1000}));
    if(age===599)assert.deepEqual(sessionCost,{usd:2.34,observedAt:new Date(now).toISOString()});
    else assert.equal(Object.hasOwn(source,'sessionCost'),false);
  }
  assert.deepEqual(claudeLimitsSource(record,{enabled:false,now}),
    {provider:'Claude Code',scope:'account',status:'not-connected',windows:[]});
  const later=now+4*86400000;
  const cost={usd:0,observedAt:later/1000};
  assert.deepEqual(claudeLimitsSource({...record,sessionCost:cost},{enabled:true,now:later}),
    {provider:'Claude Code',scope:'account',status:'unavailable',windows:[],sessionCost:{usd:0,observedAt:new Date(later).toISOString()}});
  const source=claudeLimitsSource({...record,sessionCost:{usd:1,observedAt:seconds+600}},{enabled:true,now:now+600000});
  assert.equal(source.status,'stale');
  assert.equal(source.checkedAt,new Date(now).toISOString());
  assert.equal(source.sessionCost.usd,1);
});

test('cost merges use newest observation with next winning ties and absence preserving the cost', () => {
  const record=(usd,at)=>extractClaudeLimits({cost:{total_cost_usd:usd}},at);
  const first=record(3,now),later=record(1,now+1000);
  assert.deepEqual(mergeClaudeLimits(first,later,now+1000),later);
  assert.deepEqual(mergeClaudeLimits(later,first,now+1000),later);
  assert.deepEqual(mergeClaudeLimits(first,record(2,now),now),record(2,now));
  const windows=extractClaudeLimits(input(),now+1000);
  assert.deepEqual(mergeClaudeLimits(first,windows,now+1000),{...windows,sessionCost:first.sessionCost});
  assert.equal(Object.hasOwn(mergeClaudeLimits(windows,windows,now+1000),'sessionCost'),false);
});

test('the bridge stores only windows and cost and prints nothing for cost alone', async t => {
  const bridge=fileURLToPath(new URL('./claude-statusline-bridge.mjs',import.meta.url));
  for(const kind of ['both','windows','cost']) {
    const runtime=await folder(t),at=Math.floor(Date.now()/1000);
    const value={...input(),cost:{total_cost_usd:1.236,private:'synthetic'},extra:'synthetic'};
    value.rate_limits.five_hour.resets_at=at+7200;
    value.rate_limits.seven_day.resets_at=at+86400;
    if(kind==='windows')delete value.cost;
    if(kind==='cost')delete value.rate_limits;
    const child=run(process.execPath,[bridge,'--runtime',runtime],{timeout:15000});
    child.child.stdin.end(JSON.stringify(value));
    assert.equal((await child).stdout,kind==='cost'?'':'5h 77% left · 7d 59% left\n');
    const stored=JSON.parse(await readFile(path.join(runtime,'claude-limits/limits.json'),'utf8'));
    assert.ok(stored.observedAt>=at && stored.observedAt<=Math.floor(Date.now()/1000));
    assert.deepEqual(stored,extractClaudeLimits(value,stored.observedAt*1000));
    assert.equal(Object.hasOwn(stored,'sessionCost'),kind!=='windows');
    if(kind==='cost')assert.deepEqual(claudeLimitsSource(stored,{enabled:true,now:stored.observedAt*1000}),
      {provider:'Claude Code',scope:'account',status:'unavailable',windows:[],
        sessionCost:{usd:1.24,observedAt:new Date(stored.observedAt*1000).toISOString()}});
  }
  assert.equal(ownLine({cost:{total_cost_usd:1}},now),'');
});

test('usage readings after bridge storage preserve cost and cannot inject a replacement', async t => {
  const {parseClaudeUsage}=await import('./claude-usage-command.mjs');
  const usage=parseClaudeUsage({is_error:false,num_turns:0,total_cost_usd:0,duration_api_ms:0,local_command:'usage',type:'result',
    result:'Current session: 30% used · resets Mar 10 at 5pm (UTC)'},now);
  assert.ok(usage);
  for(const extra of [{},{cost:{total_cost_usd:99}}]) {
    const runtime=await folder(t);
    const saved=await recordClaudeLimits(runtime,{...input(),cost:{total_cost_usd:1.23}},now);
    await writeFile(path.join(runtime,'claude-limits/statusline.json'),'{"previous":null}');
    const source=await readClaudeLimits(runtime,{now:now+1000,readUsage:async()=>({status:'read',usage:{...usage,...extra}})});
    const stored=JSON.parse(await readFile(path.join(runtime,'claude-limits/limits.json'),'utf8'));
    assert.deepEqual(stored.sessionCost,saved.sessionCost);
    assert.equal(stored.windows.five_hour.usedPercentage,30);
    assert.deepEqual(source.sessionCost,{usd:1.23,observedAt:new Date(now).toISOString()});
  }
});

test('explicit consent writes exactly its timestamp and leaves status line consent independent', async t => {
  const runtime=await folder(t),file=path.join(runtime,'claude-limits/consent.json');
  const none={given:false,consentMarker:false,statusLine:false};
  assert.deepEqual(await clearLimitsConsent({runtime}),none);
  for(const consent of [undefined,false,1,'true'])await assert.rejects(setLimitsConsent({runtime,consent}),/consent/);
  assert.deepEqual(await readdir(runtime),[]);
  await assert.rejects(setLimitsConsent({runtime:'relative',consent:true}),/Absolute/);
  assert.deepEqual(await setLimitsConsent({runtime,consent:true,now:new Date(now)}),{given:true,consentMarker:true,statusLine:false});
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{consent:true,givenAt:new Date(now).toISOString()});
  assert.equal(await claudeStatuslineInstalled(runtime),false);
  await writeFile(path.join(runtime,'claude-limits/statusline.json'),'{}');
  assert.deepEqual(await clearLimitsConsent({runtime}),{given:true,consentMarker:false,statusLine:true});
  assert.equal(await claudeStatuslineInstalled(runtime),true);
});

test('invalid consent markers do not grant consent', async t => {
  const runtime=await folder(t),directory=path.join(runtime,'claude-limits');
  await mkdir(directory);
  const file=path.join(directory,'consent.json');
  for(const text of ['{"consent":false}','{bad','[]','null','{"consent":"true"}','{"consent":true}'+ ' '.repeat(4096)]) {
    await writeFile(file,text);
    assert.deepEqual(await claudeLimitsConsent(runtime),{given:false,consentMarker:false,statusLine:false});
  }
  await writeFile(file,'{"consent":true}'.padEnd(4096,' '));
  assert.equal((await limitsConsentStatus({runtime})).given,true);
  assert.deepEqual(await claudeLimitsConsent(null),{given:false,consentMarker:false,statusLine:false});
});

test('linked consent is ignored and cannot be cleared', {skip:process.platform==='win32'}, async t => {
  const runtime=await folder(t),target=path.join(await folder(t),'marker.json');
  await mkdir(path.join(runtime,'claude-limits'));
  await writeFile(target,'{"consent":true}');
  const file=path.join(runtime,'claude-limits/consent.json');
  await symlink(target,file);
  assert.equal((await limitsConsentStatus({runtime})).given,false);
  await assert.rejects(clearLimitsConsent({runtime}),/plain file/);
  assert.equal((await lstat(file)).isSymbolicLink(),true);
  assert.equal(await readFile(target,'utf8'),'{"consent":true}');
});

test('a directory consent marker is ignored and cannot be cleared', async t => {
  const runtime=await folder(t),file=path.join(runtime,'claude-limits/consent.json');
  await mkdir(file,{recursive:true});
  assert.equal((await limitsConsentStatus({runtime})).given,false);
  await assert.rejects(clearLimitsConsent({runtime}),/plain file/);
  assert.equal((await lstat(file)).isDirectory(),true);
});

test('uninstall preserves independent consent and status reports it', async t => {
  const runtime=await folder(t),settingsPath=path.join(await folder(t),'settings.json');
  await setLimitsConsent({runtime,consent:true,now:new Date(now)});
  const file=path.join(runtime,'claude-limits/consent.json'),before=await readFile(file,'utf8');
  await installStatusline({runtime,settingsPath,bridge:await bridgeFixture(t),consent:true});
  assert.deepEqual((await statuslineStatus({runtime,settingsPath})).limitsConsent,{given:true,consentMarker:true,statusLine:true});
  await uninstallStatusline({runtime,settingsPath});
  assert.equal(await readFile(file,'utf8'),before);
  assert.deepEqual((await statuslineStatus({runtime,settingsPath})).limitsConsent,{given:true,consentMarker:true,statusLine:false});
  assert.equal(Object.hasOwn(await statuslineStatus({settingsPath}),'limitsConsent'),false);
});

for(const kind of ['relative','missing','directory','link','wrong name'])test(`bridge rejects ${kind} without writes`,
  {skip:kind==='link' && process.platform==='win32'}, async t => {
    const runtime=await folder(t),home=await folder(t),settingsPath=path.join(home,'settings.json');
    const text='{"model":"synthetic"}\n';
    await writeFile(settingsPath,text);
    let bridge=path.join(await folder(t),'claude-statusline-bridge.mjs');
    if(kind==='relative')bridge='claude-statusline-bridge.mjs';
    if(kind==='directory')await mkdir(bridge);
    if(kind==='link')await symlink(await bridgeFixture(t),bridge);
    if(kind==='wrong name') {bridge=path.join(path.dirname(bridge),'other.mjs');await writeFile(bridge,'');}
    await assert.rejects(installStatusline({runtime,settingsPath,bridge,consent:true}),/Bridge/);
    const script=fileURLToPath(new URL('./claude-statusline-install.mjs',import.meta.url));
    await assert.rejects(run(process.execPath,[script,'install','--runtime',runtime,'--settings',settingsPath,'--bridge',bridge,'--consent']),error=>error.code===1);
    assert.equal(await readFile(settingsPath,'utf8'),text);
    assert.deepEqual(await readdir(home),['settings.json']);
    assert.deepEqual(await readdir(runtime),[]);
  });

test('installer CLI accepts an absolute bridge file', async t => {
  const runtime=await folder(t),settingsPath=path.join(await folder(t),'settings.json'),bridge=await bridgeFixture(t);
  const script=fileURLToPath(new URL('./claude-statusline-install.mjs',import.meta.url));
  await run(process.execPath,[script,'install','--runtime',runtime,'--settings',settingsPath,'--bridge',bridge,'--consent']);
  assert.equal(JSON.parse(await readFile(settingsPath,'utf8')).statusLine.command,bridgeCommand(process.execPath,bridge,runtime));
});

test('consent CLI requires consent and supports set status and clear', async t => {
  const runtime=await folder(t),script=fileURLToPath(new URL('./claude-limits-consent.mjs',import.meta.url));
  const invoke=(...args)=>run(process.execPath,[script,...args],{env:{...process.env,OBSERVATORY_RUNTIME:runtime}});
  await assert.rejects(invoke('set','--runtime',runtime),error=>error.code===2 && error.stderr.trim().split('\n').length===1);
  assert.deepEqual(await readdir(runtime),[]);
  assert.equal(JSON.parse((await invoke('set','--runtime',runtime,'--consent')).stdout).given,true);
  assert.equal(JSON.parse((await invoke('status')).stdout).given,true);
  assert.equal(JSON.parse((await invoke('clear')).stdout).given,false);
  assert.equal(JSON.parse((await invoke('status')).stdout).given,false);
  await mkdir(path.join(runtime,'claude-limits/consent.json'));
  await assert.rejects(invoke('clear'),error=>error.code===1 && !error.stderr.includes(runtime));
  for(const args of [['unknown'],['set','--consent','--runtime','relative'],['status','--unknown'],['status','--runtime']])
    await assert.rejects(invoke(...args),error=>error.code===2);
});


test('reproduces the stale reading after the usage command from build 41', async t => {
  const earlier=now-40*60000;
  for(const outcome of ['read','not-found','failed','timed-out','unrecognized','throws']) {
    const runtime=await folder(t);
    const saved=await recordClaudeLimits(runtime,input(),earlier);
    await setLimitsConsent({runtime,consent:true,now:new Date(earlier)});
    const readUsage=async()=>{
      if(outcome==='throws')throw Error('synthetic private failure');
      return {status:outcome,usage:outcome==='read'?input():null};
    };
    const source=await readClaudeLimits(runtime,{now,readUsage});
    assert.deepEqual(source,{...claudeLimitsSource(saved,{enabled:true,now}),
      status:outcome==='read'?'ok':'stale',checkedAt:new Date(outcome==='read'?now:earlier).toISOString(),
      usageCommand:outcome==='throws'?'failed':outcome});
  }
});

test('invalid usage results fail without exposing details or inventing a reading', async t => {
  const runtime=await folder(t);
  await setLimitsConsent({runtime,consent:true,now:new Date(now)});
  for(const result of [null,undefined,'synthetic',[],{},input(),{status:'/synthetic/private',usage:null},
    {status:'not-found',usage:input()}]) {
    assert.deepEqual(await readClaudeLimits(runtime,{now,readUsage:async()=>result}),
      {provider:'Claude Code',scope:'account',status:'unavailable',windows:[],usageCommand:'failed'});
  }
  // A reading the store cannot use counts as not recognized.
  for(const usage of [{},'synthetic',null])assert.deepEqual(await readClaudeLimits(runtime,{now,readUsage:async()=>({status:'read',usage})}),
    {provider:'Claude Code',scope:'account',status:'unavailable',windows:[],usageCommand:'unrecognized'});
  for(const status of ['not-found','failed','timed-out','unrecognized']) {
    assert.deepEqual(await readClaudeLimits(runtime,{now,readUsage:async()=>({status,usage:null})}),
      {provider:'Claude Code',scope:'account',status:'unavailable',windows:[],usageCommand:status});
  }
});

test('a recording error reports failed without exposing the error or command details', async t => {
  const runtime=await folder(t);
  await setLimitsConsent({runtime,consent:true,now:new Date(now)});
  await mkdir(path.join(runtime,'claude-limits/limits.json'));
  assert.deepEqual(await readClaudeLimits(runtime,{now,readUsage:async()=>({status:'read',usage:input()})}),
    {provider:'Claude Code',scope:'account',status:'unavailable',windows:[],usageCommand:'failed'});
});


test('a linked limits folder cannot grant consent or run usage', {skip:process.platform==='win32'}, async t => {
  const runtime=await folder(t),target=await folder(t);
  await writeFile(path.join(target,'consent.json'),JSON.stringify({consent:true,givenAt:new Date(now).toISOString()}));
  await writeFile(path.join(target,'statusline.json'),'{"previous":null}');
  await symlink(target,path.join(runtime,'claude-limits'));
  assert.deepEqual(await claudeLimitsConsent(runtime),{given:false,consentMarker:false,statusLine:false});
  assert.equal(await claudeStatuslineInstalled(runtime),false);
  let runs=0;
  const source=await readClaudeLimits(runtime,{now,readUsage:async()=>{runs++;return {status:'read',usage:input()};}});
  assert.deepEqual(source,{provider:'Claude Code',scope:'account',status:'not-connected',windows:[]});
  assert.equal(runs,0);
});

test('invalid runtimes and missing or plain file limits folders cannot grant consent', async t => {
  const missing=await folder(t),file=await folder(t);
  await writeFile(path.join(file,'claude-limits'),'{}');
  for(const runtime of [undefined,null,42,{},'',path.relative(process.cwd(),missing),missing,file]) {
    assert.deepEqual(await claudeLimitsConsent(runtime),{given:false,consentMarker:false,statusLine:false});
    assert.equal(await claudeStatuslineInstalled(runtime),false);
    let runs=0;
    const source=await readClaudeLimits(runtime,{now,readUsage:async()=>{runs++;return {status:'read',usage:input()};}});
    assert.equal(source.status,'not-connected');
    assert.equal(runs,0);
  }
});
