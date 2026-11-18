import {spawn,execFile} from '../lib/cycle-processes.mjs';
import {homedir} from 'node:os';
import {copyFile,readFile,realpath} from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig,configEcho} from '../lib/config.mjs';
import {TIME_ZONE} from '../lib/timezone.mjs';
import {privateFolder,titleSalt} from '../lib/private-folder.mjs';
import {writeJsonAtomic,writeAtomic} from '../lib/atomic-file.mjs';
import {REFUSAL_CODES} from './refusal-codes.mjs';
import {cleanActivity,cleanSettings,cleanLedgerRow} from './snapshot-clean.mjs';
import {tokensFromSettings} from './windows-snapshot.mjs';
import {attachTokenHours} from './token-hours.mjs';
import {retainActivityHistory} from './activity-history.mjs';
import {serializeSnapshot,snapshotMaximumBytes} from './snapshot-size.mjs';
import {collectQuota,findCodexExecutable} from './collect-quota.mjs';
import {findWindowsQuotaClient,readWindowsQuotaSnapshot} from './windows-quota.mjs';
import {cleanClaudeTokenSource,unavailableClaudeTokenSource,attachProviderTokenEstimates} from './provider-token-sources.mjs';
import {readClaudeLimits,claudeLimitsSource,ensureClaudeLimitsFolder,withinTime} from './claude-limits.mjs';
import {readGrokUsage,notConnected as grokNotConnected} from './grok-usage.mjs';
import {windowsPowerShellEnvironment,windowsPowerShellFileArguments} from './windows-powershell.mjs';
import {readModelDriftRoots} from './read-model-drift.mjs';
import {listDistributions,wslRoots,readClaudeRoots,readCodexRoots,readProjectRoots,cacheName} from './token-roots.mjs';
import {buildProjectTokens,unavailableProjectTokens} from './project-tokens.mjs';
import {openHistory,readingsFrom,recordReadings,compactHistory} from './limit-history.mjs';
import {readSessions} from './read-sessions.mjs';
import {openTokenStore,keepTokenDays} from './token-store.mjs';
import {readLedgerSources} from './sources/index.mjs';
import {buildLedger,WEEK_MS} from './ledger.mjs';
import {joinCommits} from './ledger-commits.mjs';
import {buildLedgerHistory,dateFloorMs} from './ledger-history.mjs';
import {openLedgerStore,historyPlan,datesToBuild,gapKnownFrom,writeHistory,recheckOnMain,historyRow,keepGrokDays} from './ledger-store.mjs';
import {cleanLedgerHistory,LEDGER_HISTORY_SCHEMA} from '../lib/r2-shape.mjs';

// The ledger reads at most this long in one collection. What it read stays cached, so a first run on a
// large history finishes over a few collections instead of holding up this one.
export const LEDGER_READ_MS=150000;
// The commit join's share of the tick (scripts/tick.mjs TICK_DEADLINE_MS): the read above, this, and
// the hub's pulls fit inside it. Repositories not reached in time ship Unknown and are read next time.
export const LEDGER_JOIN_MS=20000;
// A backfill joins a month of commits once, so it gets a longer share, taken from what the read left
// unused. Repositories it does not reach ship Unknown on those days.
export const BACKFILL_JOIN_MS=60000;
// Checking older commits for reaching main again (scripts/ledger-store.mjs recheckOnMain).
export const ONMAIN_RECHECK_MS=10000;

/**
 * How long the commit join may take. The read and the join together stay within LEDGER_READ_MS plus
 * LEDGER_JOIN_MS from when the read started, so a backfill tick ends inside the tick deadline too.
 * @param {{started: number, now: number, backfill: boolean}} times
 */
export function joinMs({started,now,backfill}) {
  if(!backfill)return LEDGER_JOIN_MS;
  return Math.min(BACKFILL_JOIN_MS,Math.max(LEDGER_JOIN_MS,started+LEDGER_READ_MS+LEDGER_JOIN_MS-now));
}

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
      try {exec(path.join(process.env.SystemRoot || 'C:/Windows','System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});}catch {}
      finish(Error('Screen time reader timeout'));
    },60000);
    child.once('error',finish);
    child.stdout.on('data',data=>{output+=data;if(output.length>16_000_000)finish(Error('Screen time output limit'));});
    child.once('close',code=>finish(code===0?null:Error('Screen time reader failed')));
  });
}

export function toolFolder(variable,fallback,environment=process.env) {
  const configured=environment[variable];
  if(!configured)return path.join(homedir(),fallback);
  if(!path.isAbsolute(configured))throw Error(`${variable} must be absolute`);
  return configured;
}

export async function tokenRoots(config,{distributions=listDistributions,findRoots=wslRoots}={}) {
  const folder=(variable,fallback)=>{try {return toolFolder(variable,fallback);} catch {return null;}};
  const own={label:config.host,claudeFolder:folder('CLAUDE_CONFIG_DIR','.claude'),codexFolder:folder('CODEX_HOME','.codex'),home:homedir()};
  if(config.platform!=='windows' || !config.sources.wsl)return [own];
  let names;
  try {names=await distributions();}
  catch {return [own,{label:'WSL',unreadable:true}];}
  return [own,...await findRoots({distributions:names})];
}

export function defaultReaders(config) {
  let pending=null,readDeadline=null;
  const roots=()=>pending??=tokenRoots(config);
  const cacheFor=tool=>async root=>realpath(await privateFolder(config.dataFolder,...(root.optional?[`private-${tool}-roots`,cacheName(root)]:[`private-${tool}`])));
  return {
    screenTime:async()=>{
      if(config.platform==='mac') {
        const {macActivity}=await import('./mac-activity.mjs');
        return macActivity({raw:true});
      }
      return JSON.parse(await runPowerShellFile(path.join(scripts,'windows-aggregate-activity.ps1')));
    },
    codex:async()=>readCodexRoots(await roots(),{cacheFor:cacheFor('codex')}),
    codexLimits:()=>collectQuota(config.dataFolder,config.platform!=='windows'
      ?{enabled:true,resolveExecutable:()=>findCodexExecutable({runtime:config.dataFolder,configured:config.codexPath})}
      :{enabled:true,resolveExecutable:()=>findWindowsQuotaClient({configured:config.codexPath}),readSnapshot:readWindowsQuotaSnapshot}),
    claudeCode:async()=>readClaudeRoots(await roots(),{cacheFor:cacheFor('claude')}),
    modelDrift:async()=>readModelDriftRoots(await roots(),{cacheFor:cacheFor('drift')}),
    projects:async({claude,codex},now)=>readProjectRoots(await roots(),{claude,codex,now}),
    sessions:()=>readSessions({host:config.host,platform:config.platform}),
    // Two weekly windows back, plus a day for a reset that moved. A second call reads the ledger history's
    // backfill or gap (`since` by tool) into the same cache, inside what is left of the same time budget.
    ledger:async(now,{since=null,cache=null}={})=>{
      readDeadline??=Date.now()+LEDGER_READ_MS;
      return readLedgerSources({config,home:homedir(),saveCache:false,cache,
        cacheFile:cache?null:path.join(await privateFolder(config.dataFolder,'private-ledger'),'parse-cache.json'),
        since:since ?? now.getTime()-2*WEEK_MS-86400000,deadline:readDeadline});
    },
    grokLimits:()=>readGrokUsage({appFolder:config.grok?.appFolder ?? null,requestLog:config.grok?.requestLog ?? null,timeZone:TIMEZONE}),
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

const unavailableHistory=(host,status,checkedAt)=>({host,status,checkedAt,schema:LEDGER_HISTORY_SCHEMA,timeZone:TIMEZONE,firstDate:null,sessionsFrom:null,days:[]});

// The ledger row and the daily ledger history, from one read and one commit join. `store` is the private
// history store (scripts/ledger-store.mjs), or null to build the ledger row only.
async function ledgerAndHistory({host,readers,ledgerRead,store,now,limits,live,titles,join=joinCommits,git,started=Date.now()}) {
  const nowMs=now.getTime(),timeZone=TIMEZONE;
  const tools=ledgerRead.tools.map(tool=>tool.source.id);
  let plan=null;
  if(store)try {plan=historyPlan(store,{tools,now:nowMs,timeZone});} catch {plan=null;}
  let extra=null;
  if(plan && Object.keys(plan.extra).length) {
    try {extra=await readers.ledger(now,{since:Object.fromEntries(Object.entries(plan.extra).map(([tool,entry])=>[tool,entry.since])),cache:ledgerRead.cache ?? null});}
    catch {extra=null;}
  }
  // Each tool's history comes from the longer read when it worked, else from the usual window.
  const historyTools=[],unread=[],backfilled=[],held=[];
  for(const tool of ledgerRead.tools) {
    const id=tool.source.id,wanted=plan?.extra[id],more=wanted?extra?.tools.find(row=>row.source.id===id):null;
    if(more?.status==='ok') {
      historyTools.push({source:tool.source,sessions:more.sessions,dates:datesToBuild({today:plan.today,sessions:more.sessions,from:wanted.from,timeZone}),
        unknownBefore:gapKnownFrom({today:plan.today,sessions:more.sessions,from:wanted.from,timeZone})});
      if(wanted.since===0)backfilled.push(id);
    } else if(tool.status==='ok') {
      if(plan)historyTools.push({source:tool.source,sessions:tool.sessions,dates:plan.rebuild});
      if(wanted)held.push(id);
    } else unread.push(id);
  }
  // One commit join for both: every session either read found, over the longest span either needs.
  const sessions=new Map();
  for(const {source,sessions:list} of [...ledgerRead.tools.filter(tool=>tool.status==='ok'),...historyTools])
    for(const session of list)sessions.set(`${source.id}:${session.id}`,{key:`${source.id}:${session.id}`,writes:session.writes,branches:session.branches});
  const firstDate=historyTools.flatMap(tool=>tool.dates).sort((a,b)=>a.localeCompare(b))[0];
  const since=Math.min(nowMs-2*WEEK_MS-86400000,firstDate?dateFloorMs(firstDate):Infinity);
  try {await ledgerRead.cache?.save?.();} catch {}
  let joined=null;
  try {
    joined=await join([...sessions.values()],{since,until:nowMs,...(git?{git}:{}),cache:ledgerRead.cache ?? null,
      deadline:Date.now()+joinMs({started,now:Date.now(),backfill:backfilled.length>0})});
  } catch {joined=null;}
  const {row}=await buildLedger({host,read:ledgerRead,limits,live,now:nowMs,cache:ledgerRead.cache ?? null,
    join:async()=>{if(!joined)throw Error('Commit join failed');return joined;}});
  if(!plan)return {row,history:null};
  // A history that cannot be built or kept reads as unavailable. The ledger row stands either way.
  try {
    writeHistory(store,{...buildLedgerHistory({tools:historyTools,joined,timeZone,titles}),backfilled,held});
    try {await recheckOnMain(store,{today:plan.today,deadline:Date.now()+ONMAIN_RECHECK_MS,...(git?{git}:{})});} catch {}
    return {row,history:historyRow(store,{host,now:nowMs,timeZone,titles,unread,tools})};
  } catch {return {row,history:null};}
}

export async function buildSnapshot(config,readers,{previous=null,now=new Date(),keepDays=null,ledgerStore=null,join,git}={}) {
  const at=now.toISOString(),host=config.host,other=OTHER[host];
  // The Mac and Windows snapshots carry a not-connected row for each other. Linux has no partner row.
  const peer=value=>other?[value(other)]:[];
  const disconnected=h=>({host:h,status:'not-connected'});
  const unavailable=(error)=>({host,status:'unavailable',checkedAt:at,...(REFUSAL_CODES.includes(error?.refusal)?{refusal:error.refusal}:{})});
  const withRoots=(row,raw)=>config.sources.wsl && config.platform==='windows' && Array.isArray(raw?.roots) && row.status==='ok'?{...row,roots:raw.roots}:row;
  const read=async(key,clean)=>{
    if(!config.sources[key])return null;
    try {return await clean(await readers[key]());}
    catch(error) {return {failed:true,error};}
  };
  const projectSources={claude:config.sources.claudeCode,codex:config.sources.codex};
  const readProjects=async()=>{
    if(!projectSources.claude && !projectSources.codex)return unavailableProjectTokens(host,at,'not-connected');
    try {return buildProjectTokens(await readers.projects(projectSources,now),host,at);}
    catch {return unavailableProjectTokens(host,at);}
  };
  // Model drift reads the same Claude Code transcripts, so the claudeCode setting turns it on and off.
  const readDrift=async()=>{
    if(!config.sources.claudeCode || !readers.modelDrift)return {host,status:'not-connected'};
    try {
      const result=await readers.modelDrift();
      return result.status==='ok'?{host,status:'ok',checkedAt:at,days:result.days}:{host,status:result.status==='not-found'?'not-found':'unavailable',checkedAt:at};
    } catch {return {host,status:'unavailable',checkedAt:at};}
  };
  const ledgerOn=Boolean(readers.ledger) && (config.sources.claudeCode || config.sources.codex);
  let ledgerStarted=Date.now();
  const readLedger=async()=>{
    if(!ledgerOn)return null;
    ledgerStarted=Date.now();
    try {return await readers.ledger(now);}
    catch(error) {return {failed:true,error};}
  };
  const [activityRead,codexRead,quotaRead,claudeRead,limitsRead,projectTokens,grokRead,modelDrift,sessionsRead,ledgerRead]=await Promise.all([
    config.platform==='linux'?null:read('screenTime',raw=>{const {intervals:_i,trackingIntervals:_t,...safe}=cleanActivity(raw,host);return {...safe,checkedAt:at};}),
    read('codex',raw=>{
      const settings={...cleanSettings(raw,host),checkedAt:at};
      const tokens=withRoots({...attachTokenHours(tokensFromSettings(settings,host),raw.hourTotals),checkedAt:at},raw);
      return {settings,tokens};
    }),
    read('codexLimits',value=>value),
    read('claudeCode',raw=>withRoots(cleanClaudeTokenSource(raw,host,at,{hours:true}),raw)),
    read('claudeLimits',value=>value),
    readProjects(),
    read('grokLimits',value=>value),
    readDrift(),
    read('sessions',value=>value),
    readLedger(),
  ]);
  const pick=(value,fallback,failed)=>value===null?fallback:value.failed?failed(value.error):value;
  const activity=config.platform==='linux' && config.sources.screenTime
    ?{host,status:'unsupported',checkedAt:at}:pick(activityRead,disconnected(host),unavailable);
  const codex=pick(codexRead,{settings:disconnected(host),tokens:disconnected(host)},error=>({settings:unavailable(error),tokens:unavailable(error)}));
  const quota=pick(quotaRead,{status:'not-connected',provider:'Codex',scope:'account',windows:[],history:[],dailyUsageBuckets:[]},
    ()=>({status:'unavailable',provider:'Codex',scope:'account',windows:[],history:[],dailyUsageBuckets:[]}));
  const kept=(engine,row)=>{
    if(!keepDays || row.status!=='ok' || !Array.isArray(row.days))return row;
    try {return {...row,days:keepDays(engine,row.days)};}
    catch {return row;}
  };
  codex.tokens=kept('codex',codex.tokens);
  const claude=kept('claude',pick(claudeRead,unavailableClaudeTokenSource(host,at,'not-connected'),()=>unavailableClaudeTokenSource(host,at)));
  const claudeLimits=pick(limitsRead,claudeLimitsSource(null,{enabled:false}),
    ()=>({...claudeLimitsSource(null,{enabled:true}),usageCommand:'timed-out'}));
  let grokLimits=pick(grokRead,grokNotConnected(),()=>({...grokNotConnected(),status:'unavailable'}));
  // Grok's request counts per day are kept for good in the history store, since its log covers two weeks.
  if(ledgerStore && Array.isArray(grokLimits?.requests?.days))
    try {grokLimits={...grokLimits,requests:{...grokLimits.requests,days:keepGrokDays(ledgerStore,grokLimits.requests.days)}};} catch {}
  const sessions=pick(sessionsRead,disconnected(host),unavailable);
  let ledger=disconnected(host);
  let ledgerHistory=unavailableHistory(host,ledgerOn?'unavailable':'not-connected',ledgerOn?at:null);
  if(ledgerRead?.failed)ledger={host,status:'unavailable',collectedAt:at};
  else if(ledgerRead) {
    const titles=config.sessions?.titles!==false;
    try {
      // What was read is saved before asking git, so a tick stopped during the join does not read it all again.
      const built=await ledgerAndHistory({host,readers,ledgerRead,store:ledgerStore,now,limits:{claudeLimits,quota},live:sessions,titles,join,git,started:ledgerStarted});
      ledger=cleanLedgerRow(built.row,{titles,salt:titles?null:await titleSalt(config.dataFolder)});
      if(built.history)try {ledgerHistory=cleanLedgerHistory(built.history,{titles});} catch {}
    } catch {ledger={host,status:'unavailable',collectedAt:at};}
    try {await ledgerRead.cache?.save?.();} catch {}
  }
  const data={schema:2,timezone:TIMEZONE,collectedAt:at,
    device:{host,name:config.device.name},
    deviceNames:{[host]:config.device.name},
    activity:[activity,...peer(disconnected)],combined:{host:'Combined',status:'unavailable',checkedAt:at},
    tokens:[codex.tokens,...peer(disconnected)],combinedTokens:{host:'All',status:'unavailable',checkedAt:at},
    settings:[codex.settings],combinedSettings:{host:'All',status:'unavailable',checkedAt:at},
    quota,claudeLimits,grokLimits,providerTokenSources:[claude],projectTokens:[projectTokens],modelDrift:[modelDrift],sessions:[sessions],
    ledger:[ledger,...peer(disconnected)],ledgerHistory:[ledgerHistory],configEcho:configEcho(config,at)};
  const history=Array.isArray(previous?.activityHistory)?previous.activityHistory.filter(row=>row?.host===host):[];
  data.activityHistory=retainActivityHistory(history,data.activity,at).filter(row=>row.host===host);
  const result={data};
  attachProviderTokenEstimates(result);
  const sources=[activity,codex.settings,codex.tokens,quota,claude,claudeLimits,grokLimits].filter(row=>!['not-connected','unsupported'].includes(row.status));
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
    const store=await openTokenStore(config.dataFolder).catch(()=>null);
    const history=await openLedgerStore(config.dataFolder).catch(()=>null);
    let built;
    try {built=await buildSnapshot(config,readers,{previous,now:now(),keepDays:store?(engine,days)=>keepTokenDays(store,engine,days):null,ledgerStore:history});}
    finally {store?.close();history?.close();}
    const {data,status}=built;
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
