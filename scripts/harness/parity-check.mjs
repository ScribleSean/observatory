// Read-only check that this computer matches what the Mac does. Run it on the computer you want to check,
// with the Observatory checkout as the folder: node scripts/harness/parity-check.mjs [--expect <commit>] [--json]
// It reads the settings file, the data folder, the saved histories and the dashboard on 127.0.0.1.
// It writes nothing, installs nothing and starts nothing. Exit code 1 means at least one FAIL.
// Each line is PASS, FAIL or SKIP (a check that does not apply here, or whose files are not there yet, with the reason).
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {loadConfig,localFolder,REPO} from '../../lib/config.mjs';
import {SUM_LABEL} from '../../lib/combine.mjs';
import {DEVICE_FRESH_MS as FRESH_MS} from '../../lib/freshness.mjs';

const args=process.argv.slice(2);
const expectAt=args.indexOf('--expect');
const expected=expectAt>=0?args[expectAt+1]:null;
if(expectAt>=0 && !/^[0-9a-f]{7,40}$/.test(expected ?? '')) {console.error('--expect needs a commit hash of at least 7 hex characters');process.exit(2);}
const asJson=args.includes('--json');
const results=[];
const record=(id,status,detail)=>results.push({id,status,detail});
const pass=(id,detail)=>record(id,'PASS',detail);
const fail=(id,detail)=>record(id,'FAIL',detail);
const skip=(id,detail)=>record(id,'SKIP',detail);
const json=file=>{try {return JSON.parse(readFileSync(file,'utf8'));}catch {return null;}};
const ageText=ms=>`${Math.round(ms/60000)} min old`;
// Waits as long as the collector does when the collector is writing at the same moment.
const openRead=file=>{try {const db=new DatabaseSync(file,{readOnly:true});db.exec('PRAGMA busy_timeout=5000');return db;}catch {return null;}};

let config;
// PARITY_CHECK_AS_MAC is for the tests only: it lets Linux read a Mac-style settings file.
try {config=await loadConfig(undefined,process.env.PARITY_CHECK_AS_MAC?{platform:'darwin'}:{});}
catch(error) {fail('settings file',error.message);}

if(expected) {
  try {
    const head=execFileSync('git',['rev-parse','HEAD'],{cwd:REPO,encoding:'utf8'}).trim();
    if(head.startsWith(expected))pass('revision',head.slice(0,7));else fail('revision',`checkout is ${head.slice(0,7)}, expected ${expected}`);
  } catch {fail('revision','git could not read this checkout');}
}

if(config) {
  const host=config.host;
  pass('settings file',`${host}, data folder ${config.dataFolder}`);

  // The Mac turns these on by default after npm run setup, so the PC should match.
  const wanted=['screenTime','codex','codexLimits','claudeCode','claudeLimits'];
  const off=wanted.filter(key=>!config.sources[key]);
  if(off.length)fail('sources on as on the Mac',`off here: ${off.join(', ')}`);else pass('sources on as on the Mac',wanted.join(', '));

  const folder=localFolder(config);
  const usage=json(path.join(folder,'usage.json'));
  if(!usage)fail('own snapshot usage.json','missing or not JSON');
  else {
    const at=Date.parse(usage.collectedAt),age=Date.now()-at;
    const problems=[];
    if(usage.schema!==2)problems.push(`schema ${usage.schema}`);
    if(usage.device?.host!==host)problems.push(`host ${usage.device?.host}`);
    if(!Number.isFinite(at) || age>FRESH_MS || age<-FRESH_MS)problems.push(`collected ${Number.isFinite(at)?ageText(age):'at an unknown time'}`);
    if(problems.length)fail('own snapshot usage.json',problems.join(', '));else pass('own snapshot usage.json',`schema 2, ${host}, ${ageText(age)}`);
    const own=(usage.tokens??[]).find(row=>row.host===host);
    const claude=(usage.providerTokenSources??[]).find(row=>row.provider==='claude-code' && row.host===host);
    for(const [id,row] of [['Codex tokens read',own],['Claude Code tokens read',claude]])
      if(['ok','stale'].includes(row?.status))pass(id,`status ${row.status}`);else fail(id,`status ${row?.status ?? 'missing'}`);
    const activity=(usage.activity??[]).find(row=>row.host===host);
    if(['ok','stale'].includes(activity?.status))pass('screen time read',`status ${activity.status}`);else fail('screen time read',`status ${activity?.status ?? 'missing'}`);
  }

  // Claude Code deletes transcripts after 30 days, so the saved daily totals must hold older days.
  const tokenFile=path.join(config.dataFolder,'private-history','tokens.sqlite');
  const tokenDb=existsSync(tokenFile)?openRead(tokenFile):null;
  if(!tokenDb){if(existsSync(tokenFile))fail('daily token history kept','file exists but could not be opened read-only');else skip('daily token history kept','no saved totals yet (written on the first cycle)');}
  else {
    try {
      const rows=tokenDb.prepare('SELECT engine,COUNT(*) AS days,MIN(date) AS first FROM token_days GROUP BY engine').all();
      const oldest=rows.find(row=>row.engine==='claude')?.first ?? '9999';
      const cutoff=new Date(Date.now()-31*86400000).toISOString().slice(0,10);
      const text=rows.map(row=>`${String(row.engine)} ${String(row.days)} days from ${String(row.first)}`).join(', ');
      if(!rows.length)fail('daily token history kept','the store has no days');
      else if(oldest<cutoff)pass('daily token history kept',`${text} (Claude Code reaches past 30 days, so deleted logs are covered)`);
      else skip('daily token history kept',`${text} (Claude Code is younger than 30 days or absent, so it cannot show deleted days are kept yet)`);
    } catch(error) {fail('daily token history kept',error.message);}
    finally {tokenDb.close();}
  }

  // The older-history import adds readings whose source starts with "snapshot " or "codex archive".
  const limitFile=path.join(config.dataFolder,'private-limits','history.sqlite');
  const limitDb=existsSync(limitFile)?openRead(limitFile):null;
  if(!limitDb) {if(existsSync(limitFile))fail('limit history kept','file exists but could not be opened read-only');else skip('limit history kept','no limit readings yet');}
  else {
    try {
      const {n,first}=limitDb.prepare('SELECT COUNT(*) AS n,MIN(observed_at) AS first FROM limit_readings').get();
      const imported=limitDb.prepare("SELECT COUNT(*) AS n FROM limit_readings WHERE source LIKE 'snapshot %' OR source LIKE 'codex archive%'").get().n;
      // Both questions are asked before anything is recorded, so one check never gets two answers.
      if(n>0)pass('limit history kept',`${String(n)} readings since ${new Date(Number(first)).toISOString().slice(0,10)}, ${String(imported)} from older history`);else fail('limit history kept','the store has no readings');
      if(imported>0)pass('older history imported','readings with an older-history source are present');else skip('older history imported','no imported readings here (fine on a computer with no older app data)');
    } catch(error) {fail('limit history kept',error.message);}
    finally {limitDb.close();}
  }

  // Two computers: the combined file on this computer lists both and labels the sum.
  const combined=json(path.join(folder,'combined.json'));
  if(!combined)skip('combined view lists both computers','no combined.json (no second computer set up or first cycle not done)');
  else {
    const hosts=(combined.devices??[]).map(device=>device.host).sort((a,b)=>a.localeCompare(b)).join(',');
    const generated=Date.parse(combined.generatedAt);
    const stale=(combined.devices??[]).filter(device=>{const at=Date.parse(device.collectedAt);return device.stale || !Number.isFinite(at) || Date.now()-at>FRESH_MS || at-Date.now()>FRESH_MS;}).map(device=>device.host);
    if(!Number.isFinite(generated) || Math.abs(Date.now()-generated)>FRESH_MS)stale.push('combined.json itself');
    if(hosts==='Mac,Windows')pass('combined view lists both computers','Mac and Windows');else fail('combined view lists both computers',`found ${hosts||'none'}`);
    if(stale.length)fail('both computers fresh',`not fresh: ${stale.join(', ')}`);else pass('both computers fresh','both collected and combined within 15 minutes');
    const both=combined.glance?.both,per=combined.glance?.today??[];
    if(!both)fail('Both sum labeled and equal to its parts','no Both line');
    else {
      const parts=per.map(row=>row.tokens);
      // A computer whose tokens are unknown makes the sum unknown too, never a smaller number.
      const unknown=parts.some(value=>typeof value!=='number');
      const sum=unknown?null:parts.reduce((a,b)=>a+b,0);
      const problems=[];
      if(per.length!==2)problems.push(`${per.length} per-computer rows, expected 2`);
      if(both.label!==SUM_LABEL)problems.push(`label is ${JSON.stringify(both.label)}`);
      if(!(combined.glance.lines??[]).some(line=>line.includes(SUM_LABEL)))problems.push('menu text lacks the label');
      if(unknown?both.tokens!==null:both.tokens!==sum)problems.push(`tokens ${both.tokens} is not the sum ${sum} of the per-computer numbers`);
      if(problems.length)fail('Both sum labeled and equal to its parts',problems.join(', '));else pass('Both sum labeled and equal to its parts',`${SUM_LABEL}, tokens ${both.tokens}`);
    }
  }

  // Windows only: the tray app, its Start menu entry and its login entry, all read without changing anything.
  if(process.platform==='win32') {
    const exe=path.join(REPO,'build','windows','ObservatoryGlance.exe');
    if(existsSync(exe))pass('tray app built',`${exe}, ${statSync(exe).size} bytes`);else fail('tray app built',`${exe} is missing, run npm run setup`);
    const programs=process.env.APPDATA?path.join(process.env.APPDATA,'Microsoft','Windows','Start Menu','Programs','Observatory.lnk'):null;
    if(programs && existsSync(programs))pass('Start menu entry',programs);else fail('Start menu entry','Observatory.lnk is missing');
    try {
      const out=execFileSync('reg.exe',['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','/v','ObservatoryGlance'],{encoding:'utf8',windowsHide:true});
      if(out.toLowerCase().includes(path.join(REPO,'build','windows','ObservatoryGlance.exe').toLowerCase()))pass('starts at login','Run entry points at this checkout');else fail('starts at login','Run entry does not point at this checkout\'s tray app');
    } catch {fail('starts at login','no Run entry named ObservatoryGlance');}
    const settings=json(path.join(REPO,'build','windows','glance.json'));
    if(settings)pass('tray settings file','glance.json readable');else fail('tray settings file','glance.json missing or not JSON');
    try {
      const out=execFileSync('tasklist.exe',['/FI','IMAGENAME eq ObservatoryGlance.exe','/NH'],{encoding:'utf8',windowsHide:true});
      if(out.includes('ObservatoryGlance.exe'))pass('tray app running','process found');else skip('tray app running','not running now (start it from the Start menu, not from a Claude session)');
    } catch {skip('tray app running','tasklist unavailable');}
  } else skip('tray app, Start menu entry, login entry','Windows only');

  // The dashboard on 127.0.0.1, GET only. Skipped when it is not running.
  const base=`http://127.0.0.1:${config.dashboard.port}`;
  let page=null;
  try {page=await fetch(`${base}/`,{signal:AbortSignal.timeout(3000)});}
  catch {skip('dashboard answers on 127.0.0.1',`nothing listening on port ${config.dashboard.port}`);}
  if(page) {
    try {
      const data=await fetch(`${base}/local/usage.json`,{signal:AbortSignal.timeout(3000)});
      if(page.ok && data.ok)pass('dashboard answers on 127.0.0.1',`port ${config.dashboard.port}`);else fail('dashboard answers on 127.0.0.1',`page ${page.status}, data ${data.status}`);
    } catch {fail('dashboard answers on 127.0.0.1','the page answered but its data did not');}
  }
}

if(asJson)console.log(JSON.stringify({platform:process.platform,results},null,2));
else {
  for(const row of results)console.log(`${row.status.padEnd(4)}  ${row.id}: ${row.detail}`);
  const count=status=>results.filter(row=>row.status===status).length;
  console.log(`\n${count('PASS')} pass, ${count('FAIL')} fail, ${count('SKIP')} skipped.`);
}
process.exitCode=results.some(row=>row.status==='FAIL')?1:0;
