import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,readdir,rm,symlink,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {attachClaudeLimits,claudeLimitsSource,extractClaudeLimits,mergeClaudeLimits,readClaudeLimits,recordClaudeLimits} from './claude-limits.mjs';
import {ownLine} from './claude-statusline-bridge.mjs';
import {bridgeCommand,installStatusline,statuslineStatus,uninstallStatusline} from './claude-statusline-install.mjs';

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
  const source=await readClaudeLimits(runtime,{now:now+1000,readUsage:async()=>null});
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
  const options={runtime,settingsPath,node:'/synthetic/node',bridge:'/synthetic/scripts/claude-statusline-bridge.mjs'};
  await assert.rejects(installStatusline(options),/consent/);
  assert.deepEqual(JSON.parse(await readFile(settingsPath,'utf8')).statusLine,earlier);
  assert.deepEqual(await installStatusline({...options,consent:true}),{installed:true,replacedStatusLine:true,settingsPath});
  const installed=JSON.parse(await readFile(settingsPath,'utf8'));
  assert.equal(installed.model,'synthetic');
  const quoted=process.platform==='win32'?runtime.replaceAll('\\','/'):runtime;
  assert.equal(installed.statusLine.command,`"/synthetic/node" "/synthetic/scripts/claude-statusline-bridge.mjs" --runtime "${quoted}"`);
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
  const options={runtime,settingsPath,node:'/synthetic/node',bridge:'/synthetic/scripts/claude-statusline-bridge.mjs',consent:true};
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
