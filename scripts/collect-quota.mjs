import {access,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {readQuotaState,updateQuotaState} from './quota-store.mjs';
import {readAccountSnapshot} from './read-quota.mjs';
import {windowsPowerShellEnvironment} from './windows-powershell.mjs';
import {quotaPace} from './quota-pace.mjs';

const execute=promisify(execFile);
const disconnected=()=>({status:'not-connected',provider:'Codex',scope:'account',windows:[],history:[],dailyUsageBuckets:[]});

export async function findCodexExecutable() {
  let candidates=[];
  if(process.platform==='darwin') {
    candidates=['/Applications',path.join(homedir(),'Applications')].flatMap(root=>
      ['ChatGPT.app','Codex.app'].map(app=>path.join(root,app,'Contents/Resources/codex')));
  } else if(process.platform==='win32') {
    const powershell=path.join(process.env.SystemRoot || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    const {stdout}=await execute(powershell,['-NoProfile','-NonInteractive','-Command',
      "Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1 -ExpandProperty InstallLocation"],
    {windowsHide:true,timeout:10000,maxBuffer:4096,env:windowsPowerShellEnvironment()});
    const root=stdout.trim();
    if(path.isAbsolute(root) && !root.includes('\n') && !root.includes('\r'))candidates=[path.join(root,'app/resources/codex.exe')];
  }
  for(const file of candidates) {
    try {
      const resolved=await realpath(file),info=await lstat(resolved);
      if(!info.isFile())continue;
      await access(resolved,constants.X_OK);return resolved;
    } catch {}
  }
  throw Error('Installed Codex client unavailable');
}

function project(state,now) {
  const history=state.history;
  if(!history || history.status==='not-connected')return {...disconnected(),status:'unavailable',latestReadStatus:'waiting',nextAttemptAt:new Date(state.nextAttemptAt).toISOString()};
  // Loading retained history is not a failed poll. Keep a successful sample
  // healthy for two five-minute polling intervals without changing its time.
  const age=now-Date.parse(history.asOf);
  const status=history.latestReadStatus==='ok' && ['ok','stale'].includes(history.status)?
    (Number.isFinite(age) && age>=0 && age<600000?'ok':'stale'):history.status;
  // Do not expose the salt, account scope key, revision or private store path.
  const projected = {status,provider:'Codex',scope:'account',checkedAt:history.asOf,
    latestReadStatus:history.latestReadStatus,nextAttemptAt:new Date(state.nextAttemptAt).toISOString(),
    windows:history.samples.at(-1)?.windows || [],
    history:history.samples.filter(row=>Date.parse(row.checkedAt)>=Date.parse(history.asOf)-86400000),
    accountUsageCheckedAt:history.dailyAsOf,dailyUsageBuckets:history.dailyUsageBuckets};
  return {...projected,pace:quotaPace(projected,now)};
}

export async function collectQuota(runtime,{enabled=false,isEnabled=async()=>enabled,resolveExecutable=findCodexExecutable,readSnapshot=readAccountSnapshot,clock=Date.now}={}) {
  if(typeof enabled!=='boolean')throw Error('Invalid quota source setting');
  if(!enabled) {
    try {await lstat(path.join(runtime,'private-quota'));}
    catch(error) {if(error.code==='ENOENT')return disconnected();throw error;}
    const state=await readQuotaState(runtime,clock());
    await updateQuotaState(runtime,{revision:state.revision,enabled:false},clock());
    return disconnected();
  }
  const before=await readQuotaState(runtime,clock());
  if(before.nextAttemptAt>clock())return project(before,clock());
  let observation;
  try {observation=await readSnapshot(await resolveExecutable(),before.salt);}
  catch(error) {
    observation={status:['needs-auth','unsupported','rate-limited'].includes(error.status)?error.status:'unavailable'};
    if(typeof error.scope==='string' && /^[a-f0-9]{64}$/.test(error.scope))observation.scope=error.scope;
  }
  if(await isEnabled()!==true) {
    await updateQuotaState(runtime,{revision:before.revision,enabled:false},clock());
    return disconnected();
  }
  const now=clock();
  const failures=observation.status==='ok'?0:Math.min(32,before.failures+1);
  const delay=failures?Math.min(900000,60000*2**Math.min(failures-1,4)):300000;
  const scope=observation.scope || before.history?.scope || randomBytes(32).toString('hex');
  const state=await updateQuotaState(runtime,{revision:before.revision,scope,observation,
    nextAttemptAt:now+delay,failures},now);
  return project(state,now);
}

export function attachQuota(result,quota) {
  result.data.quota=quota;
  if(quota.status!=='not-connected') {
    result.status.sourcesConfigured++;
    if(quota.status==='ok')result.status.sourcesRead++;
    result.status.state=result.status.sourcesConfigured===result.status.sourcesRead?'ok':'partial';
  }
  return result;
}
