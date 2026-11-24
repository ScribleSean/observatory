// Sign in to Claude Code from the menu bar or tray panel: `node scripts/claude-sign-in.mjs`.
// The panel starts this when Claude reads signed out on this computer. It runs `claude auth login --claudeai` with
// the environment every Observatory claude process gets (lib/claude-env.mjs), so a network with its own certificate
// authority works here too. Claude Code opens the browser itself. Progress goes to public/local/sign-in.json as one
// plain line the panel shows: no tokens, no account details and none of claude's own output. A sign-in is confirmed
// with `claude auth status` and one read of the limits, then every source is read again so the limits come back.
// The whole run has a time limit, and quitting the panel (SIGTERM or SIGINT) stops claude and everything it started.
import path from 'node:path';
import {renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn,withCycleDeadline} from '../lib/cycle-processes.mjs';
import {loadConfig} from '../lib/config.mjs';
import {privateFolder} from '../lib/private-folder.mjs';
import {withRunLock} from '../lib/run-lock.mjs';
import {writeJsonAtomic} from '../lib/atomic-file.mjs';
import {certificateSource,claudeEnvironment} from '../lib/claude-env.mjs';
import strings from '../lib/strings.json' with {type:'json'};
import {findClaude,readClaudeUsage} from './claude-usage-command.mjs';
import {ensureClaudeLimitsFolder} from './claude-limits.mjs';

const S=strings.claudeSignIn;
export const SIGN_IN_FILE='sign-in.json';
export const SIGN_IN_SCHEMA='observatory-sign-in/1';
export const LOGIN_ARGUMENTS=Object.freeze(['auth','login','--claudeai']);
export const STATUS_ARGUMENTS=Object.freeze(['auth','status','--json']);
export const LOGIN_TIMEOUT_MS=5*60000;
export const STATUS_TIMEOUT_MS=20000;
export const USAGE_TIMEOUT_MS=30000;
// Reading every source again: a tick already running may be waited for, then one tick runs to its own deadline.
export const REFRESH_WAIT_MS=2*60000;
export const REFRESH_LIMIT_MS=7*60000;
// The longest a whole run takes: two status reads, two limit reads, the login and the refresh, with a minute to spare.
export const runLimitMs=({loginTimeoutMs=LOGIN_TIMEOUT_MS,refreshLimitMs=REFRESH_LIMIT_MS}={})=>
  2*STATUS_TIMEOUT_MS+2*USAGE_TIMEOUT_MS+loginTimeoutMs+refreshLimitMs+60000;
const OUTPUT_LIMIT=64*1024;

// Node's names for a certificate it cannot trust, and OpenSSL's wording of the same.
const CERTIFICATE=/UNABLE_TO_GET_ISSUER_CERT(?:_LOCALLY)?|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT|CERT_HAS_EXPIRED|CERT_UNTRUSTED|CERT_SIGNATURE_FAILURE|ERR_TLS_CERT_ALTNAME_INVALID|unable to get (?:local )?issuer certificate|self[- ]signed certificate|certificate has expired|unable to verify the first certificate/i;
// Claude Code saying it cannot finish in a browser from here. Its "Paste code here if prompted" line is not one of
// these: it prints that in every browser sign-in.
const NEEDS_TERMINAL=/raw mode is not supported|not a tty|stdin is not a terminal|requires an interactive|interactive terminal|browser can(?:no|'|\u2019)t return the sign-in|input ended before a code was pasted|(?:could ?n(?:o|'|\u2019)t|failed to|unable to|cannot|can(?:'|\u2019)t) open (?:a |the |your )?browser/i;

/**
 * What `claude auth status --json` says, reduced to what Observatory needs. Nothing else of it is kept.
 * @returns {{loggedIn: boolean, subscription: boolean, console: boolean} | null}
 */
export function parseAuthStatus(text) {
  let status;
  try {status=JSON.parse(text);}catch {return null;}
  if(!status || typeof status!=='object' || typeof status.loggedIn!=='boolean')return null;
  // A Claude subscription signs in through claude.ai and is served by Anthropic. An Anthropic Console sign-in is the
  // API key that `claude auth login --console` saves. Those, another API key and a cloud provider have no subscription
  // limits to read.
  const provider=status.apiProvider ?? 'firstParty';
  return {loggedIn:status.loggedIn,subscription:status.loggedIn && status.authMethod==='claude.ai' && provider==='firstParty',
    console:status.loggedIn && status.authMethod==='api_key' && status.apiKeySource==='/login managed key' && provider==='firstParty'};
}

/**
 * The one plain line for how a sign-in ended.
 * @param {{ending: 'exited' | 'failed' | 'timed-out' | 'not-found', code?: number | null, output?: string,
 *   status?: {loggedIn: boolean, subscription: boolean, console?: boolean} | null, usage?: string | null, certificateMissing?: boolean}} result
 *   usage: how the one read of the limits ended (readClaudeUsage's status), once auth status reads a subscription.
 * @returns {{state: 'done' | 'failed', reason: string, message: string}}
 */
export function classify({ending,code=null,output='',status=null,usage=null,certificateMissing=false}) {
  if(ending==='not-found')return {state:'failed',reason:'not-found',message:S.notFound};
  if(status?.subscription) {
    // Signed in is only said once the limits read. A read that answers without plan limits is an account with none,
    // or a sign-in that did not stick. A read that could not run (offline, slow) leaves it to the next reading.
    if(usage==='read')return {state:'done',reason:'signed-in',message:S.done};
    if(usage==='signed-out' || usage==='unrecognized')return {state:'failed',reason:'no-limits',message:S.noLimits};
    return {state:'done',reason:'limits-unread',message:S.limitsUnread};
  }
  if(status?.console)return {state:'failed',reason:'console',message:S.console};
  if(status?.loggedIn)return {state:'failed',reason:'not-subscription',message:S.notSubscription};
  if(CERTIFICATE.test(output))return {state:'failed',reason:'certificate',message:certificateMissing?S.certificateMissing:S.certificate};
  if(NEEDS_TERMINAL.test(output))return {state:'failed',reason:'terminal',message:S.terminal};
  if(ending==='timed-out')return {state:'failed',reason:'timed-out',message:S.timedOut};
  if(ending==='exited' && code===0)return {state:'failed',reason:'not-confirmed',message:S.failed};
  return {state:'failed',reason:'failed',message:S.failed};
}

function stop(child) {
  try {
    if(process.platform==='win32' && child.pid)spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true}).on('error',()=>{}).unref();
    else child.kill('SIGKILL');
  } catch {}
}

// Runs claude with a time limit and keeps the first part of what it printed, in memory only. stdin stays open and
// unused, so a prompt waits instead of reading an empty answer.
export function runClaude(executable,args,{environment,timeoutMs,cwd}) {
  return new Promise(resolve=>{
    let output='',done=false,child;
    const finish=(ending,code=null)=>{
      if(done)return;done=true;clearTimeout(timer);
      if(ending!=='exited' && child)stop(child);
      try {child?.stdin?.destroy();}catch {}
      resolve({ending,code,output});
    };
    const timer=setTimeout(()=>finish('timed-out'),timeoutMs);
    try {child=spawn(executable,args,{cwd,env:environment,stdio:['pipe','pipe','pipe'],windowsHide:true});}
    catch {finish('failed');return;}
    child.once('error',()=>finish('failed'));
    child.stdin.on('error',()=>{});
    for(const stream of [child.stdout,child.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data',text=>{if(output.length<OUTPUT_LIMIT)output+=text.slice(0,OUTPUT_LIMIT-output.length);});
    }
    child.once('close',(code,signal)=>finish('exited',signal?null:code));
  });
}

export async function authStatus(executable,{environment,cwd,run=runClaude}) {
  const result=await run(executable,STATUS_ARGUMENTS,{environment,cwd,timeoutMs:STATUS_TIMEOUT_MS});
  return result.ending==='exited'?parseAuthStatus(result.output):null;
}

// Reads every source again, waiting for a tick already running to finish first.
async function refreshAll(config,{waitMs=REFRESH_WAIT_MS}={}) {
  const {tick}=await import('./tick.mjs');
  const until=Date.now()+waitMs;
  for(;;) {
    const result=await tick(config).catch(()=>({busy:false}));
    if(!result?.busy || Date.now()>until)return;
    await new Promise(resolve=>setTimeout(resolve,3000));
  }
}

// The refresh with the tick's own kind of deadline: at the limit, everything it started is stopped and the sign-in
// goes on to its last line.
function bounded(action,limitMs) {
  return new Promise(resolve=>{
    const guard=setTimeout(()=>resolve('timed-out'),limitMs+2000);
    const settle=ending=>{clearTimeout(guard);resolve(ending);};
    withCycleDeadline(action,{deadlineMs:limitMs,onDeadline:()=>settle('timed-out')}).then(()=>settle('read'),()=>settle('failed'));
  });
}

/**
 * @param {any} config
 * @param {{source?: NodeJS.ProcessEnv, find?: () => Promise<string | null>, run?: typeof runClaude, usage?: typeof readClaudeUsage,
 *   refresh?: (config: any) => Promise<unknown>, now?: () => number, loginTimeoutMs?: number, refreshLimitMs?: number,
 *   progress?: {signedIn?: boolean}}} [options]
 */
export async function signIn(config,{source=process.env,find=()=>findClaude(),run=runClaude,usage=readClaudeUsage,refresh=refreshAll,now=Date.now,
  loginTimeoutMs=LOGIN_TIMEOUT_MS,refreshLimitMs=REFRESH_LIMIT_MS,progress={}}={}) {
  const folder=await privateFolder(config.dataFolder,'public','local');
  const file=path.join(folder,SIGN_IN_FILE);
  // One write at a time and in order, so a late progress line never replaces how the sign-in ended.
  let written=Promise.resolve();
  const report=(state,message,reason=null)=>(written=written.catch(()=>{}).then(()=>
    writeJsonAtomic(file,{schema:SIGN_IN_SCHEMA,state,message,...(reason?{reason}:{}),updatedAt:new Date(now()).toISOString()})));
  const locks=await privateFolder(config.dataFolder,'.runtime');
  const outcome=await withRunLock(path.join(locks,'sign-in.lock'),async()=>{
    await report('starting',S.starting);
    const environment=claudeEnvironment(config,source);
    const certificateMissing=certificateSource(config,source).missing;
    let executable=null;
    try {executable=await find();}catch {}
    if(!executable) {
      const ended=classify({ending:'not-found'});
      await report(ended.state,ended.message,ended.reason);
      return ended;
    }
    const cwd=config.dataFolder;
    // The limits read the collector does, once, to see that this sign-in has plan limits to read.
    const readLimits=async()=>{
      try {
        const limitsFolder=await ensureClaudeLimitsFolder(config.dataFolder);
        return (await usage({cwd:limitsFolder,find:async()=>executable,environment,timeoutMs:USAGE_TIMEOUT_MS,now:now()}))?.status ?? 'failed';
      } catch {return 'failed';}
    };
    let status=await authStatus(executable,{environment,cwd,run});
    let limits=status?.subscription?await readLimits():null;
    let login={ending:'exited',code:0,output:''};
    // Signed in with a subscription whose limits read (or cannot be reached just now): nothing to do but read every
    // source again. A subscription whose limits do not read is signed in again.
    if(!status?.subscription || limits==='signed-out' || limits==='unrecognized') {
      await report('waiting',S.waiting);
      login=await run(executable,LOGIN_ARGUMENTS,{environment,cwd,timeoutMs:loginTimeoutMs});
      await report('waiting',S.checking);
      status=await authStatus(executable,{environment,cwd,run});
      limits=status?.subscription?await readLimits():null;
    }
    let ended=classify({...login,status,usage:limits,certificateMissing});
    if(ended.state==='done') {
      // From here a stop from outside ends a sign-in that worked.
      progress.signedIn=true;
      await report('waiting',S.refreshing);
      const refreshed=await bounded(()=>refresh(config),refreshLimitMs);
      if(refreshed==='timed-out' && ended.reason==='signed-in')ended={state:'done',reason:'limits-unread',message:S.limitsUnread};
    }
    await report(ended.state,ended.message,ended.reason);
    return ended;
    // Longer than the longest run, so a second sign-in never takes the lock from one still going.
  },{staleMs:runLimitMs({loginTimeoutMs,refreshLimitMs})+60000});
  return outcome.busy?{state:'busy',reason:'busy',message:null}:outcome.value;
}

// The last line when the run is stopped from outside. Written in one step: the process ends right after. The folder
// is the private one the sign-in made when it started, and the file is new, as every other write here is.
function stopLine(config,state,message,reason) {
  const folder=path.join(config.dataFolder,'public','local');
  const temporary=path.join(folder,`.${SIGN_IN_FILE}-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary,JSON.stringify({schema:SIGN_IN_SCHEMA,state,message,reason,updatedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
    renameSync(temporary,path.join(folder,SIGN_IN_FILE));
  } catch {try {unlinkSync(temporary);}catch {}}
}

/**
 * The sign-in as the panel runs it: with a limit on the whole run, and stopped with the panel. SIGTERM or SIGINT
 * stops claude and every process it started, writes the last line and ends this process. Stopped during the refresh
 * after a sign-in that worked, the last line says signed in, not that the sign-in did not finish.
 * @param {any} config
 * @param {Parameters<typeof signIn>[1] & {exit?: (code: number) => void}} [options]
 */
export function runSignIn(config,{exit=code=>process.exit(code),...options}={}) {
  const progress={signedIn:false};
  const stopped=(message,reason)=>progress.signedIn?stopLine(config,'done',S.limitsUnread,'limits-unread'):stopLine(config,'failed',message,reason);
  return withCycleDeadline(()=>signIn(config,{...options,progress}),{
    deadlineMs:runLimitMs(options),shutdownSignals:['SIGTERM','SIGINT'],
    onDeadline:()=>{stopped(S.timedOut,'timed-out');exit(2);},
    onShutdown:()=>{stopped(S.failed,'stopped');exit(0);},
  });
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  let code=1;
  try {
    const result=await runSignIn(await loadConfig());
    // The reason only, never claude's output.
    console.log(result.reason);
    code=result.state==='done' || result.state==='busy'?0:1;
  } catch(error) {
    console.error(`Sign-in stopped: ${error.message}`);
  }
  // A refresh stopped at its limit may leave work behind, so the process ends here and not when that work does.
  process.exitCode=code;
  process.stdout.write('',()=>process.exit(code));
}
