import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chmod} from 'node:fs/promises';
import {parseClaudeUsage,parseResetTime,readClaudeUsage,usageEnvironment} from './claude-usage-command.mjs';
import {readClaudeLimits,withinTime} from './claude-limits.mjs';


const now=Date.parse('2026-10-13T22:20:00Z');
const text=(session='23% used · resets Oct 13 at 11:09pm (America/New_York)',week='75% used · resets Oct 16 at 6pm (America/New_York)')=>
  `You are currently using your subscription to power your Claude Code usage\n\nCurrent session: ${session}\nCurrent week (all models): ${week}\n\nWhat's contributing to your limits usage?\nLast 24h · 12 requests · 3 sessions\n  Top skills: /synthetic 1%`;
const envelope=(result=text(),extra={})=>({is_error:false,num_turns:0,total_cost_usd:0,duration_api_ms:0,local_command:'usage',type:'result',result,...extra});

test('reset times are read in their own time zone, with and without minutes', () => {
  assert.equal(parseResetTime('Oct 13 at 11:09pm (America/New_York)',now),Date.parse('2026-10-14T03:09:00Z')/1000);
  assert.equal(parseResetTime('Oct 16 at 6pm (America/New_York)',now),Date.parse('2026-10-16T22:00:00Z')/1000);
  assert.equal(parseResetTime('Oct 14 at 12am (UTC)',now),Date.parse('2026-10-14T00:00:00Z')/1000);
  assert.equal(parseResetTime('Oct 14 at 12:30pm (Asia/Kolkata)',now),Date.parse('2026-10-14T07:00:00Z')/1000);
  assert.equal(parseResetTime('Jan 2 at 9am (UTC)',Date.parse('2026-12-30T10:00:00Z')),null);
  assert.equal(parseResetTime('Jan 2, 9am (UTC)',Date.parse('2026-12-30T10:00:00Z')),null);
  for(const bad of ['tomorrow','Oct 13 at 25pm (UTC)','Oct 13 at 11:99pm (UTC)','Zzz 13 at 1pm (UTC)','Oct 13 at 1pm (Not/A_Zone)','Mar 1 at 1pm (UTC)',undefined])
    assert.equal(parseResetTime(bad,now),null,String(bad));
});

test('reset formats from both ICU variants map to exact epoch seconds', () => {
  for(const separator of [' at ', ', '])for(const year of ['', ', 2026']) {
    for(const [date,time,expected] of [
      ['Oct 16','6pm','2026-10-16T22:00:00Z'],
      ['Oct 13','11:09pm','2026-10-14T03:09:00Z'],
      ['Oct 14','9am','2026-10-14T13:00:00Z'],
      ['Oct 14','9:09am','2026-10-14T13:09:00Z'],
    ])for(const suffix of ['lower','upper','space','narrow']) {
      const formatted=time.replace(/am|pm/,value=>suffix==='lower'?value:
        `${suffix==='space'?' ':suffix==='narrow'?'\u202f':''}${value.toUpperCase()}`);
      const input=`${date}${year}${separator}${formatted} (America/New_York)`;
      assert.equal(parseResetTime(input,now),Date.parse(expected)/1000,input);
    }
  }
  assert.equal(parseResetTime('Oct 16, 6 PM (UTC)',now),Date.parse('2026-10-16T18:00:00Z')/1000);
});

test('omitted years follow the printed time zone across New Year', () => {
  const newYork=Date.parse('2027-01-01T03:00:00Z');
  for(const input of ['Dec 31 at 11pm (America/New_York)','Dec 31, 11pm (America/New_York)'])
    assert.equal(parseResetTime(input,newYork),Date.parse('2027-01-01T04:00:00Z')/1000,input);
  const auckland=Date.parse('2026-12-31T12:00:00Z');
  for(const input of ['Jan 1 at 2am (Pacific/Auckland)','Jan 1, 2027, 2am (Pacific/Auckland)'])
    assert.equal(parseResetTime(input,auckland),Date.parse('2026-12-31T13:00:00Z')/1000,input);
  assert.equal(parseResetTime('Dec 31 at 11pm (UTC)',auckland),Date.parse('2026-12-31T23:00:00Z')/1000);
});

test('explicit years across New Year are used without a next-year retry', () => {
  const december=Date.parse('2026-12-30T10:00:00Z');
  for(const separator of [' at ', ', ']) {
    for(const [time,expected] of [['9am','2027-01-02T09:00:00Z'],['6:09pm','2027-01-02T18:09:00Z']])
      assert.equal(parseResetTime(`Jan 2, 2027${separator}${time} (UTC)`,december),Date.parse(expected)/1000);
    assert.equal(parseResetTime(`Jan 2, 2026${separator}9am (UTC)`,december),null);
  }
});

test('malformed reset times and nonexistent calendar dates are refused', () => {
  for(const bad of ['Oct 16 6pm (UTC)','Oct 16,6pm (UTC)','Oct 16, 18:00 (UTC)',
    'Oct 16, 26, 6pm (UTC)','Oct 16, 6pm','Oct 16, 6pm (UTC) extra',
    'Oct 16, 6pm (Not/A_Zone)','Oct 16, 6  PM (UTC)','Oct 16, 6\tPM (UTC)',
    'Oct 16, 6Pm (UTC)','Oct 0, 6pm (UTC)','Oct 32, 6pm (UTC)','Oct 16, 0pm (UTC)',
    'Oct 16, 13pm (UTC)','Oct 16, 6:60pm (UTC)'])assert.equal(parseResetTime(bad,now),null,bad);
  const february=Date.parse('2026-02-28T10:00:00Z');
  for(const year of ['', ', 2026'])for(const separator of [' at ', ', '])for(const zone of ['UTC','America/New_York'])
    assert.equal(parseResetTime(`Feb 30${year}${separator}6pm (${zone})`,february),null);
});

test('reset window boundaries stay exclusive with and without a year', () => {
  const reference=Date.parse('2026-10-13T18:00:00Z');
  for(const year of ['', ', 2026']) {
    for(const date of ['Oct 12','Oct 22'])assert.equal(parseResetTime(`${date}${year}, 6pm (UTC)`,reference),null);
    assert.equal(parseResetTime(`Oct 12${year}, 6:01pm (UTC)`,reference),Date.parse('2026-10-12T18:01:00Z')/1000);
    assert.equal(parseResetTime(`Oct 22${year}, 5:59pm (UTC)`,reference),Date.parse('2026-10-22T17:59:00Z')/1000);
  }
});

test('comma reset lines return both windows with LF and CRLF endings', () => {
  const result=text('23% used · resets Oct 13, 11:09pm (America/New_York)',
    '75% used · resets Oct 16, 6pm (America/New_York)');
  for(const ending of ['\n','\r\n'])assert.deepEqual(parseClaudeUsage(envelope(result.replaceAll('\n',ending)),now),
    {rate_limits:{five_hour:{used_percentage:23,resets_at:Date.parse('2026-10-14T03:09:00Z')/1000},
      seven_day:{used_percentage:75,resets_at:Date.parse('2026-10-16T22:00:00Z')/1000}}});
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

test('a collection with the source on stores the command reading, and with it off runs nothing', async t => {
  const runtime=realpathSync(await mkdtemp(path.join(tmpdir(),'observatory-claude-usage-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  let runs=0;
  const readUsage=async({cwd})=>{runs++;assert.equal(cwd,path.join(runtime,'claude-limits'));return {status:'read',usage:parseClaudeUsage(envelope(),now)};};
  const disconnected=await readClaudeLimits(runtime,{now,readUsage});
  assert.equal(disconnected.status,'not-connected');
  assert.equal(Object.hasOwn(disconnected,'usageCommand'),false);
  assert.equal(runs,0);
  await mkdir(path.join(runtime,'claude-limits'),{mode:0o700});
  const source=await readClaudeLimits(runtime,{now,enabled:true,readUsage});
  assert.equal(runs,1);
  assert.equal(source.status,'ok');
  assert.deepEqual(source.windows.map(window=>[window.window,window.remainingPercent]),[['five_hour',77],['seven_day',25]]);
  assert.doesNotMatch(await readFile(path.join(runtime,'claude-limits/limits.json'),'utf8'),/synthetic|subscription/);
  const failing=await readClaudeLimits(runtime,{now:now+60000,enabled:true,readUsage:async()=>{throw Error('synthetic failure');}});
  assert.equal(failing.status,'ok');
  assert.equal((await readClaudeLimits(runtime,{now:now+60000,enabled:true,readUsage:async()=>({status:'unrecognized',usage:null})})).windows.length,2);
});

test('the command gets a fixed small environment and never a parent session\'s variables', () => {
  const source={HOME:'/synthetic/home',PATH:'/synthetic/bin',CLAUDECODE:'1',CLAUDE_CODE_ENTRYPOINT:'synthetic',ANTHROPIC_API_KEY:'synthetic',CLAUDE_CONFIG_DIR:'/synthetic/config',SECRET:'synthetic'};
  assert.deepEqual(usageEnvironment(source,'darwin'),{HOME:'/synthetic/home',PATH:'/synthetic/bin',CLAUDE_CONFIG_DIR:'/synthetic/config'});
  assert.deepEqual(usageEnvironment({...source,USERPROFILE:'C:\\Users\\synthetic'},'win32'),{USERPROFILE:'C:\\Users\\synthetic',PATH:'/synthetic/bin',CLAUDE_CONFIG_DIR:'/synthetic/config'});
});

test('a working command is read, and a parent session variable never reaches it', {skip:process.platform==='win32' && 'Requires POSIX executable scripts and signal handling'}, async t => {
  const folder=realpathSync(await mkdtemp(path.join(tmpdir(),'observatory-claude-ok-')));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const fake=path.join(folder,'claude');
  const reply=JSON.stringify(envelope(text('23% used · resets Oct 13 at 11:09pm (America/New_York)','75% used · resets Oct 16 at 6pm (America/New_York)')));
  await writeFile(fake,`#!${process.execPath}\nif(process.env.CLAUDECODE||process.env.SYNTHETIC_PARENT){process.exit(3);}process.stdout.write(${JSON.stringify(reply)});\n`);
  await chmod(fake,0o700);
  const parsed=(await readClaudeUsage({cwd:folder,now,find:async()=>fake,environment:usageEnvironment({...process.env,CLAUDECODE:'1',SYNTHETIC_PARENT:'1'})})).usage;
  assert.deepEqual(Object.keys(parsed.rate_limits),['five_hour','seven_day']);
  assert.equal((await readClaudeUsage({cwd:folder,now,find:async()=>fake,environment:{...process.env,SYNTHETIC_PARENT:'1'}})).usage,null);
});

test('a limits read that never settles is cut off', async () => {
  await assert.rejects(withinTime(new Promise(()=>{}),50),/Timed out/);
  assert.equal(await withinTime(Promise.resolve('ok'),50),'ok');
});
test('readClaudeUsage reports timed-out and force-stops a command that ignores a stop request', {skip:process.platform==='win32' && 'Requires POSIX executable scripts and signal handling'}, async t => {
  const folder=realpathSync(await mkdtemp(path.join(tmpdir(),'observatory-claude-hang-')));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const fake=path.join(folder,'claude'),pidFile=path.join(folder,'pid');
  await writeFile(fake,`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});setInterval(()=>{},1000);\n`);
  await chmod(fake,0o700);
  const started=Date.now();
  assert.deepEqual(await readClaudeUsage({cwd:folder,find:async()=>fake,timeoutMs:1500}),{status:'timed-out',usage:null});
  assert.ok(Date.now()-started<5000,'the reader must settle near its limit');
  const pid=Number(await readFile(pidFile,'utf8'));
  let alive=true;
  for(let attempt=0;attempt<100 && alive;attempt++) {try {process.kill(pid,0);await new Promise(resolve=>setTimeout(resolve,20));}catch {alive=false;}}
  assert.equal(alive,false,'the stuck command must be gone');
});

test('readClaudeUsage reports missing executables and relative working directories', async () => {
  assert.deepEqual(await readClaudeUsage({cwd:tmpdir(),find:async()=>null}),{status:'not-found',usage:null});
  let finds=0;
  for(const cwd of [undefined,'relative'])assert.deepEqual(await readClaudeUsage({cwd,find:async()=>{finds++;return null;}}),{status:'failed',usage:null});
  assert.equal(finds,0);
});

test('readClaudeUsage reports only a status and sanitized reading from fake commands', {skip:process.platform==='win32' && 'Requires POSIX executable scripts and signal handling'}, async t => {
  const folder=realpathSync(await mkdtemp(path.join(tmpdir(),'observatory-claude-outcomes-')));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const fake=path.join(folder,'claude');
  const cases=[
    ["process.stdout.write("+JSON.stringify(JSON.stringify(envelope()))+")",'read'],
    ['process.exit(3)','failed'],
    ["process.kill(process.pid,'SIGKILL')",'failed'],
    ["process.stdout.write('synthetic non-JSON output')",'unrecognized'],
    ["process.stdout.write("+JSON.stringify(JSON.stringify(envelope('No limit lines')))+")",'unrecognized'],
    ["process.stdout.write("+JSON.stringify(JSON.stringify(envelope(text(),{num_turns:1})))+")",'unrecognized'],
    ["process.stdout.write('é'.repeat(600000))",'failed'],
  ];
  for(const [body,status] of cases) {
    await writeFile(fake,`#!${process.execPath}\n${body}\n`);
    await chmod(fake,0o700);
    assert.deepEqual(await readClaudeUsage({cwd:folder,now,find:async()=>fake}),
      {status,usage:status==='read'?parseClaudeUsage(envelope(),now):null});
  }
  assert.deepEqual(await readClaudeUsage({cwd:folder,find:async()=>path.join(folder,'missing')}),{status:'failed',usage:null});
  assert.deepEqual(await readClaudeUsage({cwd:folder,find:async()=>{throw Error('synthetic');}}),{status:'failed',usage:null});
});
