import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chmod} from 'node:fs/promises';
import {parseClaudeUsage,parseResetTime,runClaudeUsage,usageEnvironment} from './claude-usage-command.mjs';
import {readClaudeLimits,withinTime} from './claude-limits.mjs';

import {setLimitsConsent,clearLimitsConsent} from './claude-limits-consent.mjs';

const now=Date.parse('2026-10-13T22:20:00Z');
const text=(session='23% used · resets Oct 13 at 11:09pm (America/New_York)',week='75% used · resets Oct 16 at 6pm (America/New_York)')=>
  `You are currently using your subscription to power your Claude Code usage\n\nCurrent session: ${session}\nCurrent week (all models): ${week}\n\nWhat's contributing to your limits usage?\nLast 24h · 12 requests · 3 sessions\n  Top skills: /synthetic 1%`;
const envelope=(result=text(),extra={})=>({is_error:false,num_turns:0,total_cost_usd:0,duration_api_ms:0,local_command:'usage',type:'result',result,...extra});

test('reset times are read in their own time zone, with and without minutes', () => {
  assert.equal(parseResetTime('Oct 13 at 11:09pm (America/New_York)',now),Date.parse('2026-10-14T03:09:00Z')/1000);
  assert.equal(parseResetTime('Oct 16 at 6pm (America/New_York)',now),Date.parse('2026-10-16T22:00:00Z')/1000);
  assert.equal(parseResetTime('Oct 14 at 12am (UTC)',now),Date.parse('2026-10-14T00:00:00Z')/1000);
  assert.equal(parseResetTime('Oct 14 at 12:30pm (Asia/Kolkata)',now),Date.parse('2026-10-14T07:00:00Z')/1000);
  assert.equal(parseResetTime('Jan 2 at 9am (UTC)',Date.parse('2026-12-30T10:00:00Z')),Date.parse('2027-01-02T09:00:00Z')/1000);
  for(const bad of ['tomorrow','Oct 13 at 25pm (UTC)','Oct 13 at 11:99pm (UTC)','Zzz 13 at 1pm (UTC)','Oct 13 at 1pm (Not/A_Zone)','Mar 1 at 1pm (UTC)',undefined])
    assert.equal(parseResetTime(bad,now),null,String(bad));
});

test('the two limit lines become status line fields and nothing else is kept', () => {
  const parsed=parseClaudeUsage(envelope(),now);
  assert.deepEqual(parsed,{rate_limits:{five_hour:{used_percentage:23,resets_at:Date.parse('2026-10-14T03:09:00Z')/1000},
    seven_day:{used_percentage:75,resets_at:Date.parse('2026-10-16T22:00:00Z')/1000}}});
  assert.doesNotMatch(JSON.stringify(parsed),/synthetic|requests|sessions/);
});

test('output that is not the free local command result is refused', () => {
  for(const bad of [envelope(text(),{num_turns:1}),envelope(text(),{total_cost_usd:0.01}),envelope(text(),{is_error:true}),
    envelope(text(),{local_command:'other'}),envelope(text(),{local_command:undefined}),envelope(42),envelope('x'.repeat(20001)),null,'text'])
    assert.equal(parseClaudeUsage(bad,now),null);
  assert.equal(parseClaudeUsage(envelope('Usage is not available for API key sign-in'),now),null);
  assert.equal(parseClaudeUsage(envelope(text('140% used · resets Oct 13 at 11:09pm (America/New_York)','75% used')),now),null);
  assert.deepEqual(Object.keys(parseClaudeUsage(envelope(text('23% used','75% used · resets Oct 16 at 6pm (America/New_York)')),now).rate_limits),['seven_day']);
});

test('a collection with consent stores the command reading and one without consent runs nothing', async t => {
  const runtime=realpathSync(await mkdtemp(path.join(tmpdir(),'observatory-claude-usage-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  let runs=0;
  const readUsage=async({cwd})=>{runs++;assert.equal(cwd,path.join(runtime,'claude-limits'));return parseClaudeUsage(envelope(),now);};
  assert.equal((await readClaudeLimits(runtime,{now,readUsage})).status,'not-connected');
  assert.equal(runs,0);
  await mkdir(path.join(runtime,'claude-limits'));
  await writeFile(path.join(runtime,'claude-limits/statusline.json'),'{"previous":null}');
  const source=await readClaudeLimits(runtime,{now,readUsage});
  assert.equal(runs,1);
  assert.equal(source.status,'ok');
  assert.deepEqual(source.windows.map(window=>[window.window,window.remainingPercent]),[['five_hour',77],['seven_day',25]]);
  assert.doesNotMatch(await readFile(path.join(runtime,'claude-limits/limits.json'),'utf8'),/synthetic|subscription/);
  const failing=await readClaudeLimits(runtime,{now:now+60000,readUsage:async()=>{throw Error('synthetic failure');}});
  assert.equal(failing.status,'ok');
  assert.equal((await readClaudeLimits(runtime,{now:now+60000,readUsage:async()=>null})).windows.length,2);
});

test('the command gets a fixed small environment and never a parent session\'s variables', () => {
  const source={HOME:'/synthetic/home',PATH:'/synthetic/bin',CLAUDECODE:'1',CLAUDE_CODE_ENTRYPOINT:'synthetic',ANTHROPIC_API_KEY:'synthetic',CLAUDE_CONFIG_DIR:'/synthetic/config',SECRET:'synthetic'};
  assert.deepEqual(usageEnvironment(source,'darwin'),{HOME:'/synthetic/home',PATH:'/synthetic/bin',CLAUDE_CONFIG_DIR:'/synthetic/config'});
  assert.deepEqual(usageEnvironment({...source,USERPROFILE:'C:\\Users\\synthetic'},'win32'),{USERPROFILE:'C:\\Users\\synthetic',PATH:'/synthetic/bin',CLAUDE_CONFIG_DIR:'/synthetic/config'});
});

test('a command that ignores a stop request cannot outlive the time limit', {skip:process.platform==='win32'}, async t => {
  const folder=realpathSync(await mkdtemp(path.join(tmpdir(),'observatory-claude-hang-')));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const fake=path.join(folder,'claude'),pidFile=path.join(folder,'pid');
  await writeFile(fake,`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});setInterval(()=>{},1000);\n`);
  await chmod(fake,0o700);
  const started=Date.now();
  assert.equal(await runClaudeUsage({cwd:folder,find:async()=>fake,timeoutMs:400}),null);
  assert.ok(Date.now()-started<3000,'the reader must settle near its limit');
  const pid=Number(await readFile(pidFile,'utf8'));
  let alive=true;
  for(let attempt=0;attempt<100 && alive;attempt++) {try {process.kill(pid,0);await new Promise(resolve=>setTimeout(resolve,20));}catch {alive=false;}}
  assert.equal(alive,false,'the stuck command must be gone');
});

test('a working command is read, and a parent session variable never reaches it', {skip:process.platform==='win32'}, async t => {
  const folder=realpathSync(await mkdtemp(path.join(tmpdir(),'observatory-claude-ok-')));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const fake=path.join(folder,'claude');
  const reply=JSON.stringify(envelope(text('23% used · resets Oct 13 at 11:09pm (America/New_York)','75% used · resets Oct 16 at 6pm (America/New_York)')));
  await writeFile(fake,`#!${process.execPath}\nif(process.env.CLAUDECODE||process.env.SYNTHETIC_PARENT){process.exit(3);}process.stdout.write(${JSON.stringify(reply)});\n`);
  await chmod(fake,0o700);
  const parsed=await runClaudeUsage({cwd:folder,now,find:async()=>fake,environment:usageEnvironment({...process.env,CLAUDECODE:'1',SYNTHETIC_PARENT:'1'})});
  assert.deepEqual(Object.keys(parsed.rate_limits),['five_hour','seven_day']);
  assert.equal(await runClaudeUsage({cwd:folder,now,find:async()=>fake,environment:{...process.env,SYNTHETIC_PARENT:'1'}}),null);
});

test('a limits read that never settles is cut off', async () => {
  await assert.rejects(withinTime(new Promise(()=>{}),50),/Timed out/);
  assert.equal(await withinTime(Promise.resolve('ok'),50),'ok');
});
test('consent alone runs usage and clearing it stops collection', async t => {
  const runtime=realpathSync(await mkdtemp(path.join(tmpdir(),'observatory-consent-usage-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  await setLimitsConsent({runtime,consent:true});
  let runs=0;
  const readUsage=async()=>{runs++;return parseClaudeUsage(envelope(),now);};
  assert.equal((await readClaudeLimits(runtime,{now,readUsage})).status,'ok');
  assert.equal(runs,1);
  await clearLimitsConsent({runtime});
  assert.equal((await readClaudeLimits(runtime,{now,readUsage})).status,'not-connected');
  assert.equal(runs,1);
});
