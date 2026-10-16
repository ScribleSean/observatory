import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,realpath,mkdir,writeFile,readFile,readdir,lstat,rm,symlink,link,open,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {appNames} from '../native/app-names.mjs';

const script = path.resolve('native/windows/migrate-data.ps1');
const windows = {skip: process.platform !== 'win32'};
const quote = value => "'" + value.replace(/['\u2018\u2019\u201a\u201b]/g, character => character.repeat(2)) + "'";
const ps = code => spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',code], {encoding:'utf8'});
const hex = c => c.repeat(64);

// These checks run on every platform without invoking Windows or touching app data.
test('migration uses named identities and stream copies', async () => {
  const source = await readFile(script,'utf8');
  for (const name of ['migrate-data','check-update-startup','test-installer','verify-update-staging']) {
    const text = await readFile(`native/windows/${name}.ps1`,'utf8');
    assert.match(text,/\. \(Join-Path \$PSScriptRoot 'app-names.ps1'\)/);
    assert.match(text,/= Read-AppNames/);
  }
  const helper = await readFile('native/windows/app-names.ps1','utf8');
  assert.match(helper,/Get-Content -LiteralPath .* -Raw/);
  assert.match(helper,/Invalid app names/);
  assert.doesNotMatch(source.slice(source.indexOf('function Digest'),source.indexOf('function PrivateFolder')),/ConvertTo-Json/);
  assert.match(source,/\$names\.legacy\.dataFolder/);
  assert.match(source,/\$names\.visible\.dataFolder/);
  assert.match(source,/Mutex\]::TryOpenExisting/);
  assert.match(source,/Semaphore\]::TryOpenExisting/);
  assert.doesNotMatch(source,/Copy-Item|\[(?:System\.)?IO\.File\]::Copy|Remove-Item\s/i);
  assert.deepEqual(source.split('\n').filter(line => /Remove-ItemProperty/.test(line)).map(line => line.trim()),
    ['Remove-ItemProperty -LiteralPath $RunKey -Name $names.internal.windowsStartupName']);
  assert.match(source,/FileMode\]::CreateNew/);
  assert.match(source,/Flush\(\$true\)/);
});

test('runtime guards retain the legacy names from the shared names file', async () => {
  const identity = await readFile('native/windows/AppIdentity.cs','utf8');
  for (const [constant,value] of [['LegacyDataName',appNames.legacy.dataFolder],['LegacyTestName',appNames.legacy.windowsTestName]]) {
    assert.equal(identity.match(new RegExp(`internal const string ${constant} = "([^"]+)"`))?.[1],value);
    assert.ok((await readFile('native/windows/RuntimeOverride.cs','utf8')).includes('AppIdentity.'+constant));
  }
});

async function fixture(t) {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(),'observatory-migration-')));
  t.after(() => rm(parent,{recursive:true,force:true}));
  const legacy = path.join(parent,appNames.legacy.dataFolder);
  const target = path.join(parent,appNames.visible.dataFolder);
  const stage = path.join(parent,'.'+appNames.visible.dataFolder+'-migration');
  const runKey = 'HKCU:\\Software\\WorkspaceObservatoryTests\\'+randomUUID();
  await mkdir(legacy);
  await writeFile(path.join(legacy,'settings.json'),'{"synthetic":true}\n');
  return {parent,legacy,target,stage,runKey,appId:'MigrationTest'+randomUUID(),processName:'MigrationTest'+randomUUID()};
}
function run(f,{action='copy',confirm=true,env={},extra=[],shell='powershell.exe',spawnProcess=spawnSync,testOptions=true,allowElevated=true}={}) {
  return spawnProcess(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,
    '-Action',action,'-Parent',f.parent,...(testOptions?['-RunKey',f.runKey,'-AppIdOverride',f.appId,'-ProcessNameOverride',f.processName,...(extra.includes('-SettingsPath')?[]:['-SettingsPath',path.join(f.parent,'claude-settings.json')])]:[]),...(allowElevated?['-AllowElevatedTestRun']:[]),...(confirm?['-ConfirmAppQuit']:[]),...extra],
  {encoding:'utf8',input:'',env:{...process.env,OBSERVATORY_MIGRATION_TEST:'1',OBSERVATORY_MIGRATION_STOP_AFTER_ASIDE:'',OBSERVATORY_MIGRATION_STOP_AFTER:'',OBSERVATORY_MIGRATION_STOP_BEFORE_SWITCH:'',OBSERVATORY_MIGRATION_TOUCH_TARGET:'',OBSERVATORY_MIGRATION_WEBVIEW_WAIT_MS:'',...env},timeout:120000});
}
function success(result,state) {
  assert.equal(result.status,0,result.stderr || result.error?.message);
  assert.equal(result.stderr,'');
  const output = JSON.parse(result.stdout);
  assert.equal(output.state,state);
  assert.equal(output.notes,'alternate data streams are not copied. Hard links outside private-* are copied as separate files');
  return output;
}
function refused(result,pattern) {
  assert.equal(result.status,1,result.stdout+result.stderr);
  assert.equal(result.stdout,'');
  assert.equal(result.stderr.trim().split(/\r?\n/).length,1);
  assert.match(result.stderr,/^Migration refused \((input|running|folders|manifest|lock|stage|copy|verify|acl|login|switch)\): /);
  if(pattern)assert.match(result.stderr,pattern);
}
async function snapshot(root) {
  const entries = {};
  async function walk(directory) {
    for(const name of (await readdir(directory)).sort()) {
      const full = path.join(directory,name),info = await lstat(full,{bigint:true});
      const relative = path.relative(root,full);
      entries[relative] = {mtime:info.mtimeNs,type:info.isDirectory()?'directory':'file'};
      if(info.isDirectory())await walk(full);
      else if(!info.isSymbolicLink())entries[relative].bytes = await readFile(full);
    }
  }
  await walk(root);
  return entries;
}

test('copies synthetic pairing, quota, settings and nested data with protected ACLs',windows,async t => {
  const f = await fixture(t);
  const {privateSyncDirectory} = await import('./peer-directory.mjs');
  const {readPairing} = await import('./peer-pairing.mjs');
  const {readQuotaState,updateQuotaState} = await import('./quota-store.mjs');
  await privateSyncDirectory(f.legacy,true);
  const side = host => ({pairId:hex('a'),deviceId:hex(host==='Mac'?'b':'c'),comparisonId:hex('d'),host,codexHosts:[host]});
  const pairing = {version:1,local:{...side('Windows'),comparisonSalt:hex('e')},peer:side('Mac')};
  await writeFile(path.join(f.legacy,'private-sync','pairing.json'),JSON.stringify(pairing),{mode:0o600});
  const now = Date.now(),initial = await readQuotaState(f.legacy,now);
  await updateQuotaState(f.legacy,{revision:initial.revision,scope:hex('f'),
    observation:{status:'ok',checkedAt:new Date(now).toISOString(),windows:[{bucket:'codex',window:'primary',remainingPercent:60}]}},now);
  await mkdir(path.join(f.legacy,'nested','ordinary'),{recursive:true});
  await writeFile(path.join(f.legacy,'nested','ordinary','synthetic.txt'),'fictional bytes');
  await writeFile(path.join(f.legacy,'viewer.json'),'{"synthetic":true}');
  await mkdir(path.join(f.legacy,'updates'));
  await writeFile(path.join(f.legacy,'updates','installed-envelope.json'),'{"synthetic":"old receipt"}');
  const paired = await readPairing(f.legacy),quota = await readQuotaState(f.legacy,now);
  const before = await snapshot(f.legacy);
  success(run(f,{action:'status',confirm:false}),'missing');
  assert.deepEqual(await snapshot(f.legacy),before);
  success(run(f),'migrated');
  assert.deepEqual(await snapshot(f.legacy),before);
  await assert.rejects(readFile(path.join(f.target,'updates','installed-envelope.json')),{code:'ENOENT'});
  assert.deepEqual(await readPairing(f.target),paired);
  assert.deepEqual(await readQuotaState(f.target,now),quota);
  await privateSyncDirectory(f.target,false);
  assert.deepEqual(await readFile(path.join(f.target,'settings.json')),before['settings.json'].bytes);
  assert.equal(await readFile(path.join(f.target,'nested','ordinary','synthetic.txt'),'utf8'),'fictional bytes');
  const record = JSON.parse(await readFile(path.join(f.target,'observatory-migration.json'),'utf8'));
  assert.equal(record.schema,1);
  assert.equal(record.loginWasOn,false);
  assert.deepEqual(record.skipped,['updates\\installed-envelope.json']);
  assert.match(record.manifestSha256,/^[a-f0-9]{64}$/);
  const migrated = await snapshot(f.parent);
  success(run(f),'already-migrated');
  assert.deepEqual(await snapshot(f.parent),migrated);
});

test('copy requires quit confirmation without writes',windows,async t => {
  const f = await fixture(t),before = await snapshot(f.parent);
  refused(run(f,{confirm:false}),/Confirm/);
  assert.deepEqual(await snapshot(f.parent),before);
});

test('target with data is refused without writes',windows,async t => {
  const f = await fixture(t);
  await mkdir(f.target);
  await writeFile(path.join(f.target,'keep.json'),'synthetic destination');
  const before = await snapshot(f.parent);
  refused(run(f),/holds data/);
  assert.deepEqual(await snapshot(f.parent),before);
});

test('legacy junction is refused without following it',windows,async t => {
  const f = await fixture(t),outside = path.join(f.parent,'synthetic-outside');
  await mkdir(outside);
  await writeFile(path.join(outside,'keep'),'synthetic outside');
  try { await symlink(outside,path.join(f.legacy,'junction'),'junction'); }
  catch { t.skip('Junction creation is unavailable'); return; }
  const before = await snapshot(f.parent);
  const result = run(f);
  refused(result,/relative paths: junction/);
  assert.ok(!result.stderr.includes(f.parent));
  assert.deepEqual(await snapshot(f.parent),before);
});

test('interrupted copy resumes with the abandoned stage moved aside',windows,async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.legacy,'a'),'synthetic a');
  await writeFile(path.join(f.legacy,'b'),'synthetic b');
  const before = await snapshot(f.legacy);
  refused(run(f,{env:{OBSERVATORY_MIGRATION_STOP_AFTER:'2'}}),/interrupted/);
  await writeFile(path.join(f.stage,'stale.observatory-partial'),'synthetic partial');
  success(run(f),'migrated');
  assert.deepEqual(await snapshot(f.legacy),before);
  await assert.rejects(readFile(path.join(f.target,'stale.observatory-partial')),{code:'ENOENT'});
  const stale = (await readdir(f.parent)).find(name => name.includes('-migration-stale-'));
  assert.equal(await readFile(path.join(f.parent,stale,'stale.observatory-partial'),'utf8'),'synthetic partial');
  for(const name of ['a','b','settings.json'])assert.deepEqual(await readFile(path.join(f.target,name)),before[name].bytes);
});

test('installer receipt is preserved in both the target and retained folder',windows,async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.target,'updates'),{recursive:true});
  await mkdir(path.join(f.legacy,'updates'));
  await writeFile(path.join(f.legacy,'updates','installed-envelope.json'),'synthetic old receipt');
  const receipt = Buffer.from('{"synthetic":"new installer receipt"}');
  await writeFile(path.join(f.target,'updates','installed-envelope.json'),receipt);
  const before = await snapshot(f.target);
  success(run(f,{action:'status'}),'installer-receipt-only');
  success(run(f),'migrated');
  const aside = (await readdir(f.parent)).filter(name => name.startsWith('.'+appNames.visible.dataFolder+'-installer-receipt-'));
  assert.equal(aside.length,1);
  assert.deepEqual(await snapshot(path.join(f.parent,aside[0])),before);
  assert.deepEqual(await readFile(path.join(f.target,'updates','installed-envelope.json')),receipt);
});

test('empty target is retained when switching directories',windows,async t => {
  const f = await fixture(t);
  await mkdir(f.target);
  success(run(f,{action:'status'}),'empty');
  success(run(f),'migrated');
  const aside = (await readdir(f.parent)).find(name => name.startsWith('.'+appNames.visible.dataFolder+'-empty-'));
  assert.ok(aside);
  assert.deepEqual(await readdir(path.join(f.parent,aside)),[]);
});

test('login intent is read only from an isolated temporary registry key',windows,async t => {
  const f = await fixture(t);
  const executable = path.join(f.parent,'Programs',appNames.legacy.productName,appNames.internal.windowsExecutable);
  t.after(() => {
    const removed = ps(`Remove-Item -LiteralPath ${quote(f.runKey)} -Recurse -Force -ErrorAction Stop`);
    assert.equal(removed.status,0,removed.stderr);
  });
  const created = ps(`$ErrorActionPreference='Stop'\nNew-Item -Path ${quote(f.runKey)} -Force | Out-Null\nNew-ItemProperty -LiteralPath ${quote(f.runKey)} -Name ${quote(appNames.internal.windowsStartupName)} -Value ${quote('"'+executable+'" --background')} -PropertyType String | Out-Null`);
  assert.equal(created.status,0,created.stderr);
  success(run(f),'migrated');
  const record = JSON.parse(await readFile(path.join(f.target,'observatory-migration.json'),'utf8'));
  assert.equal(record.loginWasOn,true);
  const retained = ps(`Get-ItemPropertyValue -LiteralPath ${quote(f.runKey)} -Name ${quote(appNames.internal.windowsStartupName)}`);
  assert.notEqual(retained.status,0);
  assert.equal(record.loginWasOn,true);
});

for (const folder of ['target','stage']) {
  test(`${folder} file is refused without writes`,windows,async t => {
    const f = await fixture(t);
    await writeFile(f[folder],'synthetic conflicting file');
    const before = await snapshot(f.parent);
    refused(run(f),/file or a reparse point/);
    assert.deepEqual(await snapshot(f.parent),before);
  });
}

test('resuming moves the stale stage aside and restores write times',windows,async t => {
  const f = await fixture(t);
  await mkdir(f.stage);
  await writeFile(path.join(f.stage,'settings.json'),'stale synthetic bytes');
  const before = await snapshot(f.legacy);
  success(run(f),'migrated');
  const stale = (await readdir(f.parent)).find(name => name.includes('-migration-stale-'));
  assert.equal(await readFile(path.join(f.parent,stale,'settings.json'),'utf8'),'stale synthetic bytes');
  assert.deepEqual((await snapshot(f.target))['settings.json'],before['settings.json']);
  assert.deepEqual(await snapshot(f.legacy),before);
});

test('extra staging files move aside and are retained',windows,async t => {
  const f = await fixture(t);
  await mkdir(f.stage);
  await writeFile(path.join(f.stage,'unowned.txt'),'synthetic unowned bytes');
  success(run(f),'migrated');
  const stale = (await readdir(f.parent)).find(name => name.includes('-migration-stale-'));
  assert.equal(await readFile(path.join(f.parent,stale,'unowned.txt'),'utf8'),'synthetic unowned bytes');
});

test('changed legacy data refuses the switch',windows,async t => {
  const f = await fixture(t);
  const {privateSyncDirectory} = await import('./peer-directory.mjs');
  await privateSyncDirectory(f.legacy,true);
  const wrapper = path.join(f.parent,'synthetic-acl.ps1');
  const realAcl = path.resolve('scripts/private-sync-acl.ps1');
  await writeFile(wrapper,`param([string]$Directory,[switch]$Initialize)\n$arguments = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',${quote(realAcl)},'-Directory',$Directory)\nif ($Initialize) { $arguments += '-Initialize' }\n& powershell.exe @arguments\nif ($LASTEXITCODE -ne 0) { exit 1 }\nif ($Initialize) { [IO.File]::WriteAllText(${quote(path.join(f.legacy,'settings.json'))}, 'synthetic changed data') }\n`);
  refused(run(f,{extra:['-AclScript',wrapper]}),/The earlier data folder changed during the copy/);
  await assert.rejects(lstat(f.target),{code:'ENOENT'});
});

for (const relative of ['private-unknown','nested/private-sync','Private-Sync','private-sync-retired-ABC']) {
  test(`unknown private directory ${relative} refuses at manifest`,windows,async t => {
    const f = await fixture(t);
    await mkdir(path.join(f.legacy,relative),{recursive:true});
    refused(run(f),/Migration refused \(manifest\): Unknown private folder/);
  });
}

for (const suffix of ['-journal','-wal']) {
test(`leftover ${suffix} has its own refusal reason`,windows,async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.legacy,'private-repair'));
  await writeFile(path.join(f.legacy,'private-repair','operation.sqlite'+suffix),'synthetic');
  refused(run(f),/^Migration refused \(lock\): An earlier pairing exchange left an unfinished database journal in the earlier folder\. Start and quit the Mac app once, then run again\.\r?\n?$/);
});

}

test('exclusive operation database handle refuses',windows,async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.legacy,'private-repair'));
  const database = path.join(f.legacy,'private-repair','operation.sqlite');
  const file = await open(database,'w');
  await file.close();
  const ready = path.join(f.parent,'ready');
  const child = spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    `$h=[IO.File]::Open(${quote(database)},'Open','ReadWrite','None')\ntry { [IO.File]::WriteAllText(${quote(ready)},'ready')\n[Console]::ReadLine() | Out-Null } finally { $h.Dispose() }`],{stdio:['pipe','pipe','pipe']});
  t.after(() => {
    // Release every handle so a failed assertion cannot keep the test process alive.
    child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();
    child.kill();child.unref();
  });
  let prepared = false;
  for (let i=0;i<100;i++) {
    try { await readFile(ready); prepared=true; break; } catch {}
    await new Promise(resolve => setTimeout(resolve,100));
  }
  assert.ok(prepared,'exclusive holder became ready');
  refused(run(f),/Migration refused \(lock\): The Mac pairing exchange/);
  child.stdin.end('\n');
  await new Promise(resolve => child.once('exit',resolve));
});

test('exclusive collection lock refuses',windows,async t => {
  const f = await fixture(t);
  const database = path.join(f.legacy,'collection.lock');
  const file = await open(database,'w');
  await file.close();
  const ready = path.join(f.parent,'ready');
  const child = spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    `$h=[IO.File]::Open(${quote(database)},'Open','ReadWrite','None')\ntry { [IO.File]::WriteAllText(${quote(ready)},'ready')\n[Console]::ReadLine() | Out-Null } finally { $h.Dispose() }`],{stdio:['pipe','pipe','pipe']});
  t.after(() => {
    // Release every handle so a failed assertion cannot keep the test process alive.
    child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();
    child.kill();child.unref();
  });
  let prepared = false;
  for (let i=0;i<100;i++) {
    try { await readFile(ready); prepared=true; break; } catch {}
    await new Promise(resolve => setTimeout(resolve,100));
  }
  assert.ok(prepared,'exclusive holder became ready');
  refused(run(f),/Migration refused \(running\): The earlier app's collector is still running\. Quit it and run again\./);
  child.stdin.end('\n');
  await new Promise(resolve => child.once('exit',resolve));
});

test('receipt switch crash recovers from retained receipt',windows,async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.target,'updates'),{recursive:true});
  await writeFile(path.join(f.target,'updates','installed-envelope.json'),'synthetic receipt');
  refused(run(f,{env:{OBSERVATORY_MIGRATION_STOP_BEFORE_SWITCH:'1'}}),/^Migration refused \(switch\): The synthetic migration was interrupted before switching\.\r?\n?$/);
  await assert.rejects(lstat(f.target),{code:'ENOENT'});
  const record = JSON.parse(await readFile(path.join(f.stage,'observatory-migration.json'),'utf8'));
  assert.match(record.aside,/^\.Observatory-installer-receipt-\d{8}T\d{13}Z$/);
  const aside = path.join(f.parent,record.aside);
  assert.ok((await lstat(aside)).isDirectory());
  assert.equal(await readFile(path.join(aside,'updates','installed-envelope.json'),'utf8'),'synthetic receipt');
  success(run(f),'migrated');
  assert.equal(await readFile(path.join(f.target,'updates','installed-envelope.json'),'utf8'),'synthetic receipt');
});

test('target changed immediately before the switch is refused and retained',windows,async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.target,'updates'),{recursive:true});
  const receipt = path.join(f.target,'updates','installed-envelope.json');
  await writeFile(receipt,'synthetic receipt');
  const child = run(f,{spawnProcess:spawn,env:{OBSERVATORY_MIGRATION_TOUCH_TARGET:'1'}});
  t.after(() => {
    child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();
    child.kill();child.unref();
  });
  let stdout = '',stderr = '',changed = false;
  const extra = path.join(f.target,'second-file.json');
  const status = await new Promise((resolve,reject) => {
    child.on('error',reject);
    child.stderr.on('data',data => { stderr += data; });
    child.stdout.on('data',data => {
      stdout += data;
      if (!changed && /migration-target-check-ready\r?\n/.test(stdout)) {
        changed = true;
        writeFile(extra,'synthetic concurrent data').then(() => child.stdin.end('target-change-complete\n'),reject);
      }
    });
    child.on('close',resolve);
  });
  assert.ok(changed,'migration reached the target check');
  assert.equal(stdout.trim(),'migration-target-check-ready');
  refused({status,stdout:'',stderr},/Migration refused \(switch\): The destination changed during the copy\./);
  assert.equal(await readFile(extra,'utf8'),'synthetic concurrent data');
  assert.equal(await readFile(receipt,'utf8'),'synthetic receipt');
  assert.ok((await lstat(f.stage)).isDirectory());
  assert.equal((await readdir(f.parent)).filter(name => name.startsWith('.'+appNames.visible.dataFolder+'-installer-receipt-')).length,0);
});

test('changed source retains stale stage and copies fresh bytes',windows,async t => {
  const f = await fixture(t);
  refused(run(f,{env:{OBSERVATORY_MIGRATION_STOP_AFTER:'1'}}),/Migration refused \(copy\):/);
  await writeFile(path.join(f.legacy,'settings.json'),'changed synthetic source');
  success(run(f),'migrated');
  const stale = (await readdir(f.parent)).filter(name => /-migration-stale-\d{8}T\d{6}Z-[a-f0-9]{4}$/.test(name));
  assert.equal(stale.length,1);
  assert.equal(await readFile(path.join(f.target,'settings.json'),'utf8'),'changed synthetic source');
});

test('hard linked private staged file refuses without disclosing its name',windows,async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.stage,'private-sync'),{recursive:true});
  const outside = path.join(f.parent,'synthetic-link-source');
  await writeFile(outside,'synthetic');
  await link(outside,path.join(f.stage,'private-sync','secret-name'));
  refused(run(f),/Migration refused \(manifest\): Hard links/);
  assert.ok(!run(f).stderr.includes('secret-name'));
});

test('Unicode and bracket paths copy literally and SSH uses install product names',windows,async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.legacy,'資料 [folder]'));
  await writeFile(path.join(f.legacy,'資料 [folder]','café [a].txt'),'synthetic unicode');
  const result = success(run(f),'migrated');
  const ssh = {};
  for (const [side,names] of [['from',appNames.legacy],['to',appNames.visible]]) {
    ssh[side] = {remoteNode:path.join(f.parent,'Programs',names.productName,'Runtime','node.exe'),
      remoteScript:path.join(f.parent,'Programs',names.productName,'Collector','scripts','peer-exchange.mjs'),
      remoteRuntime:path.join(f.parent,names.dataFolder)};
  }
  assert.deepEqual(result.ssh,ssh);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.target,'observatory-migration.json'),'utf8')).ssh,ssh);
  assert.equal(await readFile(path.join(f.target,'資料 [folder]','café [a].txt'),'utf8'),'synthetic unicode');
});

// The canonical manifest text the migration script must produce, computed independently.
async function canonicalDigest(root) {
  const {createHash} = await import('node:crypto');
  const {stat} = await import('node:fs/promises');
  const lines = [];
  async function walk(relative) {
    for (const name of await readdir(path.join(root,relative))) {
      const rel = relative ? relative+'\\'+name : name, full = path.join(root,rel);
      const info = await stat(full,{bigint:true});
      const ticks = (info.mtimeNs/100n+621355968000000000n).toString();
      const hex = Buffer.from(rel,'utf8').toString('hex');
      if (info.isDirectory()) { lines.push([hex,'directory','0',ticks,''].join('\t')); await walk(rel); }
      else lines.push([hex,'file',info.size.toString(),ticks,createHash('sha256').update(await readFile(full)).digest('hex')].join('\t'));
    }
  }
  await walk('');
  lines.sort((a,b)=>a<b?-1:a>b?1:0);
  const text = lines.join('\n');
  return {text,digest:createHash('sha256').update(text,'utf8').digest('hex')};
}

test('PowerShell editions produce identical canonical digest',windows,async t => {
  if (spawnSync('pwsh',['-NoProfile','-Command','$PSVersionTable.PSVersion.ToString()']).status !== 0) {
    t.skip('PowerShell 7 is unavailable'); return;
  }
  const f = await fixture(t);
  await mkdir(path.join(f.legacy,'資料 [folder]'));
  await writeFile(path.join(f.legacy,'資料 [folder]','café.txt'),'synthetic');
  const expected = await canonicalDigest(f.legacy);
  const old = success(run(f,{action:'status'}),'missing');
  const modern = success(run(f,{action:'status',shell:'pwsh'}),'missing');
  assert.equal(old.manifestSha256,expected.digest,'Windows PowerShell 5.1 digest differs from the canonical text:\n'+expected.text+'\n'+JSON.stringify(old));
  assert.equal(modern.manifestSha256,expected.digest,'PowerShell 7 digest differs from the canonical text:\n'+expected.text+'\n'+JSON.stringify(modern));
});

test('saved login intent survives an interrupted copy and a stale stage',windows,async t => {
  const f = await fixture(t);
  const executable = path.join(f.parent,'Programs',appNames.legacy.productName,appNames.internal.windowsExecutable);
  t.after(() => ps(`Remove-Item -LiteralPath ${quote(f.runKey)} -Recurse -Force -ErrorAction SilentlyContinue`));
  const created = ps(`$ErrorActionPreference='Stop'\nNew-Item -Path ${quote(f.runKey)} -Force | Out-Null\nNew-ItemProperty -LiteralPath ${quote(f.runKey)} -Name ${quote(appNames.internal.windowsStartupName)} -Value ${quote('"'+executable+'" --background')} -PropertyType String | Out-Null\nNew-ItemProperty -LiteralPath ${quote(f.runKey)} -Name Unrelated -Value preserved -PropertyType String | Out-Null`);
  assert.equal(created.status,0,created.stderr);
  assert.equal(success(run(f,{action:'status'}),'missing').loginWasOn,true);
  refused(run(f,{env:{OBSERVATORY_MIGRATION_STOP_AFTER:'1'}}),/Migration refused \(copy\):/);
  assert.equal(JSON.parse(await readFile(path.join(f.stage,'login-state.json'),'utf8')).loginWasOn,true);
  assert.notEqual(ps(`Get-ItemPropertyValue -LiteralPath ${quote(f.runKey)} -Name ${quote(appNames.internal.windowsStartupName)}`).status,0);
  assert.equal(ps(`Get-ItemPropertyValue -LiteralPath ${quote(f.runKey)} -Name Unrelated`).stdout.trim(),'preserved');
  assert.equal(success(run(f,{action:'status'}),'missing').loginWasOn,true);
  await writeFile(path.join(f.legacy,'settings.json'),'changed synthetic data');
  refused(run(f,{env:{OBSERVATORY_MIGRATION_STOP_AFTER_ASIDE:'1'}}),/interrupted after moving the stage aside/);
  assert.equal(JSON.parse(await readFile(path.join(f.parent,'.'+appNames.visible.dataFolder+'-migration-login.json'),'utf8')).loginWasOn,true);
  await assert.rejects(lstat(f.stage),{code:'ENOENT'});
  assert.equal(success(run(f),'migrated').loginWasOn,true);
  assert.equal(JSON.parse(await readFile(path.join(f.target,'observatory-migration.json'),'utf8')).loginWasOn,true);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.target,'login-state-carried.json'),'utf8')),{schema:1,loginWasOn:true});
  await assert.rejects(lstat(path.join(f.parent,'.'+appNames.visible.dataFolder+'-migration-login.json')),{code:'ENOENT'});
  await assert.rejects(lstat(path.join(f.target,'login-state.json')),{code:'ENOENT'});
});


test('test options and interruption hooks are gated and running checks surround the switch', async () => {
  const source = await readFile(script,'utf8');
  assert.match(source,/\$testEnvironment = \$env:OBSERVATORY_MIGRATION_TEST -ceq '1'/);
  for (const option of ['AllowElevatedTestRun','AppIdOverride','ProcessNameOverride','RunKey','AclScript','SettingsPath']) {
    assert.ok(source.includes("'"+option+"'"));
  }
  assert.match(source,/if \(-not \$testEnvironment -and \$PSBoundParameters.ContainsKey\(\$option\)\) \{ Refuse 'Test-only options need the test environment\.'/);
  for (const hook of ['STOP_AFTER','STOP_BEFORE_SWITCH','TOUCH_TARGET','STOP_AFTER_ASIDE','WEBVIEW_WAIT_MS']) {
    assert.match(source,new RegExp('if \\(\\$testEnvironment -and \\$env:OBSERVATORY_MIGRATION_'+hook+'(?: | -and|\\))'));
  }
  assert.equal(source.match(/^    CheckRunning$/gm)?.length,3);
  assert.match(source,/ExchangeLock\r?\n    CollectionLock\r?\n    CheckRunning\r?\n    \$step = 'manifest'/);
  assert.match(source,/CheckRunning\r?\n    \$step = 'switch'\r?\n    SaveJson \$recordPath \$record\r?\n    if \(\$state -ne 'missing'\) \{\r?\n        \[IO.Directory\]::Move/);
  assert.match(source,/Get-CimInstance Win32_Process/);
  assert.match(source,/StartsWith\(\$runtime, \[StringComparison\]::OrdinalIgnoreCase\)/);
  assert.ok(source.indexOf('SaveLogin $carriedLoginPath') < source.indexOf('[IO.Directory]::Move($Stage, $stale)'));
  assert.match(await readFile('native/windows/package.ps1','utf8'),/Join-Path \$candidate \$names.internal.windowsPackageFolder/);
  assert.match(await readFile('native/windows/app-names.ps1','utf8'),/'windowsPackageFolder'/);
});

function elevated() {
  const result = ps('([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)');
  assert.equal(result.status,0,result.stderr);
  return result.stdout.trim() === 'True';
}

test('elevated migration without the test allowance refuses without writes',windows,async t => {
  if (!elevated()) { t.skip('This process is not elevated, so the administrator refusal cannot be exercised'); return; }
  const f = await fixture(t),before = await snapshot(f.parent);
  const result = run(f,{allowElevated:false});
  refused(result,/^Migration refused \(input\): Run without administrator rights\.\r?\n?$/);
  assert.deepEqual(await snapshot(f.parent),before);
});

test('test-only parameters without the test environment refuse without writes',windows,async t => {
  const f = await fixture(t),before = await snapshot(f.parent);
  for (const extra of [['-AllowElevatedTestRun'],['-AppIdOverride',f.appId],['-ProcessNameOverride',f.processName],['-RunKey',f.runKey],['-AclScript',path.join(f.parent,'unused.ps1')],['-SettingsPath',path.join(f.parent,'unused.json')]]) {
    refused(run(f,{testOptions:false,allowElevated:false,extra,env:{OBSERVATORY_MIGRATION_TEST:''}}),/^Migration refused \(input\): Test-only options need the test environment\.\r?\n?$/);
  }
  assert.deepEqual(await snapshot(f.parent),before);
});

test('leftover target hook without the test environment completes with stdin closed',windows,async t => {
  if (elevated()) { t.skip('A production-mode run requires a non-elevated Windows process'); return; }
  const f = await fixture(t);
  await mkdir(f.target);
  // Redirect default user paths as well as the explicit data parent to synthetic folders.
  await mkdir(path.join(f.parent,'.claude'));
  await writeFile(path.join(f.parent,'.claude','settings.json'),'{}');
  // A saved false intent avoids reading or changing the real startup registry key.
  await writeFile(path.join(f.parent,'.'+appNames.visible.dataFolder+'-migration-login.json'),'{"schema":1,"loginWasOn":false}');
  let result;
  // Real runs refuse every bridge, including brief bridges from parallel tests or Claude Code.
  for (let attempt = 0; attempt < 10; attempt++) {
    result = run(f,{testOptions:false,allowElevated:false,env:{USERPROFILE:f.parent,LOCALAPPDATA:f.parent,OBSERVATORY_MIGRATION_TEST:'',OBSERVATORY_MIGRATION_TOUCH_TARGET:'1',OBSERVATORY_MIGRATION_STOP_AFTER:'invalid',OBSERVATORY_MIGRATION_STOP_AFTER_ASIDE:'1',OBSERVATORY_MIGRATION_STOP_BEFORE_SWITCH:'1',OBSERVATORY_MIGRATION_WEBVIEW_WAIT_MS:'invalid'}});
    if (result.status !== 1 || !result.stderr.includes('close Claude Code sessions that show the Observatory status line') || attempt === 9) break;
    await new Promise(resolve => setTimeout(resolve,2000));
  }
  success(result,'migrated');
});

for (const variant of ['legacy runtime','visible runtime','status line','unrelated status line','web view','unrelated web view','closing web view','legacy prefix web view','visible prefix web view','separator web view','quoted web view','external collector']) {
  test(`running check scopes a synthetic ${variant} process`,windows,async t => {
    let child;
    t.after(async () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise(resolve => child.once('close',resolve));
        child.kill();
        await exited;
      }
    });
    const f = await fixture(t);
    let executable = process.execPath;
    let childScript = path.join(f.parent,variant.includes('status line')?'claude-statusline-bridge.mjs':'wait.mjs');
    if (variant === 'external collector') {
      childScript = path.join(f.parent,'Programs',appNames.legacy.productName,'Collector','scripts','wait.mjs');
      await mkdir(path.dirname(childScript),{recursive:true});
      executable = path.join(f.parent,'nodejs','node.exe');
      await mkdir(path.dirname(executable));
      await copyFile(process.execPath,executable);
    }
    await writeFile(childScript,`process.stdout.write('ready\\n')\nsetTimeout(() => {}, ${variant === 'closing web view' ? 1000 : 120000})\n`);
    if (variant === 'legacy runtime' || variant === 'visible runtime') {
      executable = path.join(f.parent,'Programs',variant === 'legacy runtime'?appNames.legacy.productName:appNames.visible.productName,'Runtime','node.exe');
      await mkdir(path.dirname(executable),{recursive:true});
      await copyFile(process.execPath,executable);
    }
    if (variant.includes('web view')) {
      executable = path.join(f.parent,'msedgewebview2.exe');
      await copyFile(process.execPath,executable);
    }
    let runtime = variant.startsWith('unrelated') ? path.join(f.parent,'unrelated') : f.legacy;
    if (variant === 'legacy prefix web view') runtime = f.legacy+' Installer Test\\WebViewCache';
    if (variant === 'visible prefix web view') runtime = f.target+' Installer Test\\WebViewCache';
    if (variant === 'separator web view') runtime += '\\';
    if (variant === 'quoted web view') runtime = '"'+runtime+'"';
    child = spawn(executable,[childScript,'--runtime',runtime.replaceAll('\\','/').toUpperCase()],{stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject) => {
      child.once('error',reject);
      child.once('exit',() => reject(new Error('Synthetic process exited before readiness')));
      child.stdout.once('data',resolve);
    });
    const before = await snapshot(f.parent);
    if (variant.startsWith('unrelated') || variant.includes('prefix')) {
      success(run(f,{action:'status'}),'missing');
    } else if (variant === 'closing web view') {
      success(run(f,{env:{OBSERVATORY_MIGRATION_WEBVIEW_WAIT_MS:'5000'}}),'migrated');
      return;
    } else if (variant.includes('web view')) {
      const started = Date.now();
      refused(run(f,{env:{OBSERVATORY_MIGRATION_WEBVIEW_WAIT_MS:'500'}}),/The earlier app's web view is still closing\. Wait a minute and run again\./);
      assert.ok(Date.now()-started >= 500,'matching web view receives a grace period');
      assert.ok(Date.now()-started < 30000,'test override avoids the production wait');
    } else {
      refused(run(f),/^Migration refused \(running\): Quit every Observatory app and close Claude Code sessions that show the Observatory status line, then run again\.\r?\n?$/);
    }
    assert.deepEqual(await snapshot(f.parent),before);
  });
}

for (const [label,settings,expected] of [
  ['earlier folder',f => ({statusLine:{command:`node "${path.join(f.legacy,'claude-statusline-bridge.mjs')}"`}}),true],
  ['new folder',f => ({statusLine:{command:`node "${path.join(f.target,'claude-statusline-bridge.mjs')}"`}}),false],
  ['unrelated command',f => ({statusLine:{command:`echo "${f.legacy}"`}}),false],
  ['missing',null,'Unknown'],
  ['unreadable JSON',() => 'invalid','Unknown'],
]) {
  test(`status line reports ${label}`,windows,async t => {
    const f = await fixture(t),settingsPath = path.join(f.parent,'synthetic-settings.json');
    if (settings) {
      const value = settings(f);
      await writeFile(settingsPath,typeof value === 'string'?value:JSON.stringify(value));
    }
    assert.equal(success(run(f,{action:'status',extra:['-SettingsPath',settingsPath]}),'missing').statusLineTargetsEarlierFolder,expected);
    const copied = success(run(f,{extra:['-SettingsPath',settingsPath]}),'migrated');
    assert.equal(copied.nextStep,expected === true ? 'Run the status line install again with the new data folder.' : undefined);
  });
}


test('ordinary hard links become separate copied files',windows,async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.legacy,'first.txt'),'synthetic linked data');
  await link(path.join(f.legacy,'first.txt'),path.join(f.legacy,'second.txt'));
  success(run(f),'migrated');
  assert.equal((await lstat(path.join(f.target,'first.txt'))).nlink,1);
  assert.equal((await lstat(path.join(f.target,'second.txt'))).nlink,1);
  await writeFile(path.join(f.target,'first.txt'),'synthetic changed data');
  assert.equal(await readFile(path.join(f.target,'second.txt'),'utf8'),'synthetic linked data');
  assert.equal(await readFile(path.join(f.legacy,'first.txt'),'utf8'),'synthetic linked data');
});

for (const [label,content,reason] of [
  ['invalid schema','{"schema":2,"loginWasOn":true}','Invalid saved login state'],
  ['invalid JSON','invalid','Invalid saved login state'],
]) {
  test(`saved login refusal names the repair file for ${label}`,windows,async t => {
    const f = await fixture(t);
    const name = '.'+appNames.visible.dataFolder+'-migration-login.json';
    await writeFile(path.join(f.parent,name),content);
    const result = run(f);
    refused(result);
    assert.ok(result.stderr.includes(reason));
    assert.ok(result.stderr.includes(name));
    assert.ok(result.stderr.includes('Restore it to {"schema":1,"loginWasOn":true} or false as it was, do not delete it.'));
    assert.equal(await readFile(path.join(f.parent,name),'utf8'),content);
  });
}

test('quote helper doubles all five PowerShell single quote characters', () => {
  for (const mark of ["'",'\u2018','\u2019','\u201a','\u201b']) {
    assert.equal(quote('a'+mark+'b'),"'a"+mark+mark+"b'");
  }
});

test('real runs refuse every bridge and lock probes follow folder validation', async () => {
  const source = await readFile(script,'utf8');
  assert.match(source,/if \(\[string\]\$process.CommandLine -like '\*claude-statusline-bridge.mjs\*'\) \{\s*if \(-not \$testEnvironment -or \(TargetsDataFolder \(\[string\]\$process.CommandLine\)\)\) \{ \$running = \$true \}/);
  assert.match(source,/SafeDirectory \$Legacy \$true\s+CollectionLock/);
  const probe = source.slice(source.indexOf('function CollectionLock'),source.indexOf('function MoveCarriedLogin'));
  assert.ok(probe.indexOf('SafeDirectory $Legacy $true') < probe.indexOf('Item $collectionLock'));
  assert.match(probe,/ReparsePoint\) \{ Refuse 'The earlier collection.lock is a link\.'/);
  assert.match(probe,/FileAccess\]::Read, \[IO.FileShare\]::None/);
});

for (const [label,content] of [
  ['spaces','{ "schema" : 1, "loginWasOn" : true }'],
  ['newline','{"schema":1,"loginWasOn":true}\n'],
  ['CRLF','{\r\n "schema":1,\r\n "loginWasOn":true\r\n}\r\n'],
  ['BOM','\ufeff{"schema":1,"loginWasOn":true}'],
]) {
  test(`carried login accepts ${label}`,windows,async t => {
    const f = await fixture(t);
    await writeFile(path.join(f.parent,'.'+appNames.visible.dataFolder+'-migration-login.json'),content);
    assert.equal(success(run(f),'migrated').loginWasOn,true);
    assert.equal(await readFile(path.join(f.target,'login-state-carried.json'),'utf8'),content);
  });
}

// Load only the named functions, never the migration entry point or its default paths.
async function functionsSource(names) {
  const source = await readFile(script,'utf8');
  return names.map(name => {
    const start = source.indexOf('function '+name+'(');
    assert.ok(start >= 0,name);
    return source.slice(start,source.indexOf('\nfunction ',start));
  }).join('\n');
}

test('SaveLogin refuses a different boolean without replacing the carried file',windows,async t => {
  const f = await fixture(t),carried = path.join(f.parent,'.'+appNames.visible.dataFolder+'-migration-login.json');
  const content = '{"schema":1,"loginWasOn":false}';
  await writeFile(carried,content);
  const functions = await functionsSource(['Refuse','Item','LoginRepair','ValidLogin','SaveLogin']);
  const result = ps(`$ErrorActionPreference='Stop'\n${functions}\n$carriedLoginPath=${quote(carried)}\ntry { SaveLogin $carriedLoginPath @{schema=1;loginWasOn=$true} } catch { [Console]::Error.WriteLine($_.Exception.Message)\nexit 1 }`);
  assert.equal(result.status,1);
  assert.ok(result.stderr.includes(carried));
  assert.match(result.stderr,/does not match this run/);
  assert.equal(await readFile(carried,'utf8'),content);
});

for (const name of ['login-state.json','observatory-migration.json']) {
  test(`invalid stage ${name} names its actual repair path`,windows,async t => {
    const f = await fixture(t);
    await mkdir(f.stage);
    const saved = path.join(f.stage,name);
    await writeFile(saved,'invalid');
    const result = run(f);
    refused(result,/Invalid saved login state/);
    assert.ok(result.stderr.includes(saved));
    assert.ok(result.stderr.includes('Writing .'+appNames.visible.dataFolder+'-migration-login.json with the right value overrides it.'));
    await writeFile(path.join(f.parent,'.'+appNames.visible.dataFolder+'-migration-login.json'),'{"schema":1,"loginWasOn":false}');
    success(run(f),'migrated');
  });
}

test('collection lock links refuse before opening the link',windows,async t => {
  const f = await fixture(t),outside = path.join(f.parent,'synthetic-lock');
  await writeFile(outside,'synthetic');
  await symlink(outside,path.join(f.legacy,'collection.lock'),'file');
  refused(run(f),/The earlier collection.lock is a link\./);
  assert.equal(await readFile(outside,'utf8'),'synthetic');
});

test('a carried file that cannot move leaves migration successful and retries on rerun',windows,async t => {
  const f = await fixture(t),carried = path.join(f.parent,'.'+appNames.visible.dataFolder+'-migration-login.json');
  await writeFile(carried,'{"schema":1,"loginWasOn":false}');
  const child = spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    `$h=[IO.File]::Open(${quote(carried)},'Open','Read','Read')\ntry { [Console]::Out.WriteLine('ready')\n[Console]::ReadLine() | Out-Null } finally { $h.Dispose() }`],{stdio:['pipe','pipe','pipe']});
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('close',resolve));
      child.kill();
      await exited;
    }
  });
  await new Promise((resolve,reject) => {
    child.once('error',reject);
    child.once('exit',() => reject(new Error('File holder exited before readiness')));
    child.stdout.once('data',resolve);
  });
  assert.equal(success(run(f),'migrated').note,'The login state file stayed beside the data folder.');
  assert.equal(success(run(f),'already-migrated').note,'The login state file stayed beside the data folder.');
  assert.equal(JSON.parse(await readFile(carried,'utf8')).loginWasOn,false);
  const exited = new Promise(resolve => child.once('close',resolve));
  child.stdin.end('\n');
  await exited;
  success(run(f),'already-migrated');
  await assert.rejects(lstat(carried),{code:'ENOENT'});
  const moved = path.join(f.target,'login-state-carried.json');
  const before = await readFile(moved,'utf8');
  await writeFile(carried,'{"schema":1,"loginWasOn":true}');
  success(run(f),'already-migrated');
  assert.equal(await readFile(moved,'utf8'),before);
  assert.equal(JSON.parse(await readFile(carried,'utf8')).loginWasOn,true);
});

test('folder boundaries distinguish quoted installer paths in both PowerShell editions',windows,async t => {
  const f = await fixture(t);
  const functions = await functionsSource(['CommandTargetsFolder']);
  for (const shell of ['powershell.exe','pwsh']) {
    for (const folder of [f.legacy,f.target]) {
      for (const [command,expected] of [
        ['node "'+folder+' Installer Test\\WebViewCache"',false],
        ['node "'+folder+'"',true],
        ['node "'+folder+'\\"',true],
        ['node '+folder,true],
        ['node '+folder+' --flag',true],
        ['node "'+folder.replaceAll('\\','/').toUpperCase()+'/WebViewCache"',true],
        ['node "'+folder+'Other"',false],
      ]) {
        const result = spawnSync(shell,['-NoProfile','-NonInteractive','-Command',
          `$ErrorActionPreference='Stop'\n${functions}\nCommandTargetsFolder ${quote(command)} ${quote(folder)}`],{encoding:'utf8'});
        assert.equal(result.status,0,result.stderr || result.error?.message);
        assert.equal(result.stdout.trim(),expected ? 'True' : 'False',shell+': '+command);
      }
    }
  }
});

for (const shell of ['powershell.exe','pwsh']) {
  test(`saved login validation is strict in ${shell}`,windows,async t => {
    const f = await fixture(t);
    const carried = path.join(f.parent,'.'+appNames.visible.dataFolder+'-migration-login.json');
    const functions = await functionsSource(['Refuse','Item','LoginRepair','ValidLogin','SaveLogin']);
    const invalid = [
      '{"schema":1,"loginWasOn":true,"extra":0}',
      '{"schema":"1","loginWasOn":true}',
      '{"Schema":1,"loginWasOn":true}',
      '',
      '{"schema":1.0,"loginWasOn":true}',
      '{"schema":1.5,"loginWasOn":true}',
      '{"schema":true,"loginWasOn":true}',
      '{"schema":1,"loginWasOn":"true"}',
      '[{"schema":1,"loginWasOn":true}]',
      '[{"schema":1,"loginWasOn":true},{"schema":1,"loginWasOn":true}]',
    ];
    const valid = ['{"schema":1,"loginWasOn":true}\n','\ufeff{"schema":1,"loginWasOn":false}\r\n'];
    for (const content of [...invalid,...valid]) {
      const accepted = valid.includes(content);
      await writeFile(carried,content);
      const saved = spawnSync(shell,['-NoProfile','-NonInteractive','-Command',
        `$ErrorActionPreference='Stop'\n${functions}\n$carriedLoginPath=${quote(carried)}\ntry { SaveLogin $carriedLoginPath @{schema=1;loginWasOn=$${content.includes('false')?'false':'true'}} } catch { [Console]::Error.WriteLine($_.Exception.Message)\nexit 1 }`],{encoding:'utf8'});
      assert.equal(saved.status,accepted?0:1,saved.stderr || saved.error?.message);
      if (!accepted) assert.ok(saved.stderr.includes(carried));
      const result = run(f,{shell,action:'status'});
      if (accepted) assert.equal(success(result,'missing').loginWasOn,content.includes('true'));
      else refused(result,/Invalid saved login state/);
      assert.equal(await readFile(carried,'utf8'),content);
    }
    await rm(carried);
    await mkdir(f.stage);
    for (const name of ['login-state.json','observatory-migration.json']) {
      const file = path.join(f.stage,name);
      for (const content of [...invalid,...valid]) {
        await writeFile(file,content);
        const accepted = valid.includes(content) || (name === 'observatory-migration.json' && [invalid[0],'{"Schema":1,"loginWasOn":true}'].includes(content));
        const result = run(f,{shell,action:'status'});
        if (accepted) success(result,'missing');
        else {
          refused(result,/Invalid saved login state/);
          assert.ok(result.stderr.includes(file));
        }
      }
      await rm(file);
    }
  });
}

test('carried login links stay beside the folder after switching and on rerun',windows,async t => {
  const f = await fixture(t);
  const carried = path.join(f.parent,'.'+appNames.visible.dataFolder+'-migration-login.json');
  const outside = path.join(f.parent,'synthetic-login-target.json');
  const content = 'Not JSON, must never be read as login state';
  await writeFile(outside,content);
  try { await symlink(outside,carried,'file'); }
  catch (error) {
    if (['EPERM','EACCES','ENOTSUP'].includes(error.code)) { t.skip('Windows symbolic link creation is unavailable: '+error.code); return; }
    throw error;
  }
  const before = await snapshot(f.parent);
  const result = run(f);
  refused(result);
  assert.equal(result.stderr.trim(),`Migration refused (login): The saved login state is a link in ${carried}. Replace the link with a regular file that holds {"schema":1,"loginWasOn":true} or false as it was.`);
  assert.deepEqual(await snapshot(f.parent),before);
  await rm(carried);
  await mkdir(f.target);
  const child = run(f,{spawnProcess:spawn,env:{OBSERVATORY_MIGRATION_TOUCH_TARGET:'1'}});
  t.after(() => {
    child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();
    child.kill();child.unref();
  });
  let stdout = '',stderr = '',changed = false;
  const status = await new Promise((resolve,reject) => {
    child.on('error',reject);
    child.stderr.on('data',data => { stderr += data; });
    child.stdout.on('data',data => {
      stdout += data;
      if (!changed && /migration-target-check-ready\r?\n/.test(stdout)) {
        changed = true;
        // Replace only the synthetic carried file after its saved-state read.
        rm(carried).then(() => symlink(outside,carried,'file'))
          .then(() => child.stdin.end('target-change-complete\n'),reject);
      }
    });
    child.on('close',resolve);
  });
  assert.ok(changed,'migration reached the target check');
  const output = stdout.replace(/^migration-target-check-ready\r?\n/,'');
  assert.equal(success({status,stdout:output,stderr},'migrated').note,'The login state file is a link and was left beside the data folder.');
  assert.equal(success(run(f),'already-migrated').note,'The login state file is a link and was left beside the data folder.');
  assert.ok((await lstat(carried)).isSymbolicLink());
  assert.equal(await readFile(outside,'utf8'),content);
  await assert.rejects(lstat(path.join(f.target,'login-state-carried.json')),{code:'ENOENT'});
});
