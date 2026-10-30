import {spawn,execFile} from '../lib/cycle-processes.mjs';
import {homedir} from 'node:os';
import {copyFile,readFile,realpath} from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../lib/config.mjs';
import {TIME_ZONE} from '../lib/timezone.mjs';
import {privateFolder} from '../lib/private-folder.mjs';
import {writeJsonAtomic,writeAtomic} from '../lib/atomic-file.mjs';
import {REFUSAL_CODES} from './refusal-codes.mjs';
import {cleanActivity,cleanSettings} from './snapshot-clean.mjs';
import {tokensFromSettings} from './windows-snapshot.mjs';
import {attachTokenHours} from './token-hours.mjs';
import {retainActivityHistory} from './activity-history.mjs';
import {serializeSnapshot,snapshotMaximumBytes} from './snapshot-size.mjs';
import {collectQuota,findCodexExecutable} from './collect-quota.mjs';
import {findWindowsQuotaClient,readWindowsQuotaSnapshot} from './windows-quota.mjs';
import {cleanClaudeTokenSource,unavailableClaudeTokenSource,attachProviderTokenEstimates} from './provider-token-sources.mjs';
import {readClaudeLimits,claudeLimitsSource,ensureClaudeLimitsFolder,withinTime} from './claude-limits.mjs';
import {windowsPowerShellEnvironment,windowsPowerShellFileArguments} from './windows-powershell.mjs';
import {collectSettings} from './read-settings.mjs';
import {collectClaudeUsage} from './read-claude-usage.mjs';
import {collectProjectTokens} from './read-projects.mjs';
import {buildProjectTokens,unavailableProjectTokens} from './project-tokens.mjs';
import {openHistory,readingsFrom,recordReadings,compactHistory} from './limit-history.mjs';

const scripts=path.dirname(fileURLToPath(import.meta.url));
const OTHER={Mac:'Windows',Windows:'Mac'};
export const TIMEZONE=TIME_ZONE;

export function runPowerShellFile(script,{spawnProcess=spawn,exec=execFile}={}) {
  return new Promise((resolve,reject)=>{
    const powershell=path.join(process.env.SystemRoot || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    const child=spawnProcess(powershell,windowsPowerShellFileArguments(script),{windowsHide:true,stdio:['ignore','pipe','ignore'],env:windowsPowerShellEnvironment()});
    let output='',done=false;
    const finish=error=>{if(done)return;done=true;clearTimeout(timer);if(error)reject(error);else resolve(output);};
    const timer=setTimeout(()=>{
      // The cycle may already have stopped the child and refused new processes.
      try {exec(path.join(process.env.SystemRoot || 'C:/Windows','System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});}catch {}
      finish(Error('Screen time reader timeout'));
    },60000);
    child.once('error',finish);
    child.stdout.on('data',data=>{output+=data;if(output.length>16_000_000)finish(Error('Screen time output limit'));});
    child.once('close',code=>finish(code===0?null:Error('Screen time reader failed')));
  });
}

export function defaultReaders(config) {
  const claudeFolder=()=>{
    const configured=process.env.CLAUDE_CONFIG_DIR;
    if(!configured)return path.join(homedir(),'.claude');
    if(!path.isAbsolute(configured))throw Error('CLAUDE_CONFIG_DIR must be absolute');
    return configured;
  };
  return {
    screenTime:async()=>{
      if(config.platform==='mac') {
        const {macActivity}=await import('./mac-activity.mjs');
        return macActivity({raw:true});
      }
      return JSON.parse(await runPowerShellFile(path.join(scripts,'windows-aggregate-activity.ps1')));
    },
    codex:async()=>collectSettings(path.join(homedir(),'.codex'),{cacheDirectory:await realpath(await privateFolder(config.dataFolder,'private-codex'))}),
    codexLimits:()=>collectQuota(config.dataFolder,config.platform==='mac'
      ?{enabled:true,resolveExecutable:()=>findCodexExecutable({runtime:config.dataFolder,configured:config.codexPath})}
      :{enabled:true,resolveExecutable:()=>findWindowsQuotaClient({configured:config.codexPath}),readSnapshot:readWindowsQuotaSnapshot}),
    claudeCode:()=>collectClaudeUsage(claudeFolder()),
    projects:({claude,codex},now)=>collectProjectTokens({claudeFolder:claude?claudeFolder():null,
      codexFolder:codex?path.join(homedir(),'.codex'):null,home:homedir(),now}),
    claudeLimits:async()=>{
      await ensureClaudeLimitsFolder(config.dataFolder);
      return withinTime(readClaudeLimits(config.dataFolder,{enabled:true}),20000);
    },
  };
}

export const OLD_APP_BACKUP='usage.before-hub.json';
async function keepOldAppSnapshot(folder) {
  const previous=await previousSnapshot(path.join(folder,'usage.json'));
  if(!previous || previous.device)return;
  await copyFile(path.join(folder,'usage.json'),path.join(folder,OLD_APP_BACKUP),fsConstants.COPYFILE_EXCL).catch(error=>{if(error.code!=='EEXIST')throw error;});
}

async function recordLimitHistory(config,data,now) {
  const host=config.host;
  let db;
  try {
    db=await openHistory(config.dataFolder);
    recordReadings(db,[
      ...readingsFrom(data.quota,{provider:'codex',observer:host,source:'live'}),
      ...readingsFrom(data.claudeLimits,{provider:'claude',observer:host,source:'live'}),
    ]);
    return {host,status:'ok',checkedAt:now.toISOString(),points:compactHistory(db,{now:now.getTime(),observer:host})};
  } catch {return {host,status:'unavailable',checkedAt:now.toISOString(),points:[]};}
  finally {db?.close();}
}

async function previousSnapshot(file) {
  try {
    const text=await readFile(file,'utf8');
    if(text.length>snapshotMaximumBytes)return null;
    return JSON.parse(text);
  } catch {return null;}
}

export async function buildSnapshot(config,readers,{previous=null,now=new Date()}={}) {
  const at=now.toISOString(),host=config.host,other=OTHER[host];
  const disconnected=h=>({host:h,status:'not-connected'});
  const unavailable=(error)=>({host,status:'unavailable',checkedAt:at,...(REFUSAL_CODES.includes(error?.refusal)?{refusal:error.refusal}:{})});
  const read=async(key,clean)=>{
    if(!config.sources[key])return null;
    try {return await clean(await readers[key]());}
    catch(error) {return {failed:true,error};}
  };
  // Today by project comes from the same logs, so it follows the claudeCode and codex settings.
  const projectSources={claude:config.sources.claudeCode,codex:config.sources.codex};
  const readProjects=async()=>{
    if(!projectSources.claude && !projectSources.codex)return unavailableProjectTokens(host,at,'not-connected');
    try {return buildProjectTokens(await readers.projects(projectSources,now),host,at);}
    catch {return unavailableProjectTokens(host,at);}
  };
  const [activityRead,codexRead,quotaRead,claudeRead,limitsRead,projectTokens]=await Promise.all([
    read('screenTime',raw=>{const {intervals:_i,trackingIntervals:_t,...safe}=cleanActivity(raw,host);return {...safe,checkedAt:at};}),
    read('codex',raw=>{
      const settings={...cleanSettings(raw,host),checkedAt:at};
      const tokens={...attachTokenHours(tokensFromSettings(settings,host),raw.hourTotals),checkedAt:at};
      return {settings,tokens};
    }),
    read('codexLimits',value=>value),
    read('claudeCode',raw=>cleanClaudeTokenSource(raw,host,at,{hours:true})),
    read('claudeLimits',value=>value),
    readProjects(),
  ]);
  const pick=(value,fallback,failed)=>value===null?fallback:value.failed?failed(value.error):value;
  const activity=pick(activityRead,disconnected(host),unavailable);
  const codex=pick(codexRead,{settings:disconnected(host),tokens:disconnected(host)},error=>({settings:unavailable(error),tokens:unavailable(error)}));
  const quota=pick(quotaRead,{status:'not-connected',provider:'Codex',scope:'account',windows:[],history:[],dailyUsageBuckets:[]},
    ()=>({status:'unavailable',provider:'Codex',scope:'account',windows:[],history:[],dailyUsageBuckets:[]}));
  const claude=pick(claudeRead,unavailableClaudeTokenSource(host,at,'not-connected'),()=>unavailableClaudeTokenSource(host,at));
  const claudeLimits=pick(limitsRead,claudeLimitsSource(null,{enabled:false}),
    ()=>({...claudeLimitsSource(null,{enabled:true}),usageCommand:'timed-out'}));
  const data={schema:2,timezone:TIMEZONE,collectedAt:at,
    device:{host,name:config.device.name},
    deviceNames:{[host]:config.device.name},
    activity:[activity,disconnected(other)],combined:{host:'Combined',status:'unavailable',checkedAt:at},
    tokens:[codex.tokens,disconnected(other)],combinedTokens:{host:'All',status:'unavailable',checkedAt:at},
    settings:[codex.settings],combinedSettings:{host:'All',status:'unavailable',checkedAt:at},
    quota,claudeLimits,providerTokenSources:[claude],projectTokens:[projectTokens]};
  const history=Array.isArray(previous?.activityHistory)?previous.activityHistory.filter(row=>row?.host===host):[];
  data.activityHistory=retainActivityHistory(history,data.activity,at).filter(row=>row.host===host);
  const result={data};
  attachProviderTokenEstimates(result);
  const sources=[activity,codex.settings,codex.tokens,quota,claude,claudeLimits].filter(row=>row.status!=='not-connected');
  const sourcesRead=sources.filter(row=>row.status==='ok').length;
  return {data,status:{state:sources.length && sourcesRead===sources.length?'ok':'partial',sourcesRead,sourcesConfigured:sources.length}};
}

export async function collect(config,{readers=defaultReaders(config),now=()=>new Date()}={}) {
  const folder=await privateFolder(config.dataFolder,'public','local');
  const startedAt=now().toISOString();
  await writeJsonAtomic(path.join(folder,'collector.json'),{state:'running',startedAt,intervalSeconds:300});
  try {
    await keepOldAppSnapshot(folder);
    const previous=await previousSnapshot(path.join(folder,'usage.json'));
    const {data,status}=await buildSnapshot(config,readers,{previous,now:now()});
    data.limitHistory=[await recordLimitHistory(config,data,now())];
    const {text,bytes}=serializeSnapshot(data);
    if(bytes>snapshotMaximumBytes)throw Object.assign(Error('Snapshot too large'),{reason:'snapshot-too-large'});
    await writeAtomic(path.join(folder,'usage.json'),text);
    await writeJsonAtomic(path.join(folder,'collector.json'),{...status,startedAt,finishedAt:now().toISOString(),snapshotAt:data.collectedAt,intervalSeconds:300});
    return {data,status};
  } catch(error) {
    await writeJsonAtomic(path.join(folder,'collector.json'),{state:'failed',reason:error.reason??'collection-failed',startedAt,finishedAt:now().toISOString(),intervalSeconds:300});
    throw error;
  }
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const result=await collect(await loadConfig());
    console.log(JSON.stringify(result.status));
  } catch(error) {
    console.error(`Collection failed: ${error.message}`);
    process.exitCode=1;
  }
}
