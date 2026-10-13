import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseClaudeUsage,parseResetTime} from './claude-usage-command.mjs';
import {readClaudeLimits} from './claude-limits.mjs';

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
