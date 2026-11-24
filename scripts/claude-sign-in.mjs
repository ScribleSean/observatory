// Sign in to Claude Code from the menu bar or tray panel: `node scripts/claude-sign-in.mjs`.
// The panel starts this when Claude reads signed out on this computer. It runs `claude auth login --claudeai` with
// the environment every Observatory claude process gets (lib/claude-env.mjs), so a network with its own certificate
// authority works here too. Claude Code opens the browser itself. Progress goes to public/local/sign-in.json as one
// plain line the panel shows: no tokens, no account details and none of claude's own output. A sign-in is confirmed
// with `claude auth status`, then every source is read again so the limits come back.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from '../lib/cycle-processes.mjs';
import {loadConfig} from '../lib/config.mjs';
import {privateFolder} from '../lib/private-folder.mjs';
import {withRunLock} from '../lib/run-lock.mjs';
import {writeJsonAtomic} from '../lib/atomic-file.mjs';
import {certificateSource,claudeEnvironment} from '../lib/claude-env.mjs';
import strings from '../lib/strings.json' with {type:'json'};
import {findClaude} from './claude-usage-command.mjs';

const S=strings.claudeSignIn;
export const SIGN_IN_FILE='sign-in.json';
export const SIGN_IN_SCHEMA='observatory-sign-in/1';
export const LOGIN_ARGUMENTS=Object.freeze(['auth','login','--claudeai']);
export const STATUS_ARGUMENTS=Object.freeze(['auth','status','--json']);
export const LOGIN_TIMEOUT_MS=5*60000;
export const STATUS_TIMEOUT_MS=20000;
const OUTPUT_LIMIT=64*1024;

// Node's names for a certificate it cannot trust, and OpenSSL's wording of the same.
const CERTIFICATE=/UNABLE_TO_GET_ISSUER_CERT(?:_LOCALLY)?|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT|CERT_HAS_EXPIRED|CERT_UNTRUSTED|CERT_SIGNATURE_FAILURE|ERR_TLS_CERT_ALTNAME_INVALID|unable to get (?:local )?issuer certificate|self[- ]signed certificate|certificate has expired|unable to verify the first certificate/i;
const PASTE_CODE=/paste (?:the |your )?(?:code|authorization)|code here|enter (?:the |your )?(?:code|authorization)/i;
const NEEDS_TERMINAL=/raw mode is not supported|not a tty|stdin is not a terminal|requires an interactive|interactive terminal/i;

/**
 * What `claude auth status --json` says, reduced to what Observatory needs. Nothing else of it is kept.
 * @returns {{loggedIn: boolean, subscription: boolean} | null}
 */
export function parseAuthStatus(text) {
  let status;
  try {status=JSON.parse(text);}catch {return null;}
  if(!status || typeof status!=='object' || typeof status.loggedIn!=='boolean')return null;
  // A Claude subscription signs in through claude.ai and is served by Anthropic. A Console account, an API key or a
  // cloud provider has no subscription limits to read.
  const provider=status.apiProvider ?? 'firstParty';
  return {loggedIn:status.loggedIn,subscription:status.loggedIn && status.authMethod==='claude.ai' && provider==='firstParty'};
}

/**
 * The one plain line for how a sign-in ended.
 * @param {{ending: 'exited' | 'failed' | 'timed-out' | 'not-found', code?: number | null, output?: string,
 *   status?: {loggedIn: boolean, subscription: boolean} | null, certificateMissing?: boolean}} result
 * @returns {{state: 'done' | 'failed', reason: string, message: string}}
 */
export function classify({ending,code=null,output='',status=null,certificateMissing=false}) {
  if(ending==='not-found')return {state:'failed',reason:'not-found',message:S.notFound};
  if(status?.subscription)return {state:'done',reason:'signed-in',message:S.done};
  if(status?.loggedIn)return {state:'failed',reason:'console',message:S.console};
  if(CERTIFICATE.test(output))return {state:'failed',reason:'certificate',message:certificateMissing?S.certificateMissing:S.certificate};
  if(ending==='timed-out')return PASTE_CODE.test(output)?{state:'failed',reason:'terminal',message:S.terminal}:{state:'failed',reason:'timed-out',message:S.timedOut};
  if(NEEDS_TERMINAL.test(output))return {state:'failed',reason:'terminal',message:S.terminal};
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
export function runClaude(executable,args,{environment,timeoutMs,cwd,onOutput=()=>{}}) {
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
      stream.on('data',text=>{if(output.length<OUTPUT_LIMIT) {output+=text.slice(0,OUTPUT_LIMIT-output.length);onOutput(output);}});
    }
    child.once('close',(code,signal)=>finish('exited',signal?null:code));
  });
}

export async function authStatus(executable,{environment,cwd,run=runClaude}) {
  const result=await run(executable,STATUS_ARGUMENTS,{environment,cwd,timeoutMs:STATUS_TIMEOUT_MS});
  return result.ending==='exited'?parseAuthStatus(result.output):null;
}

// Reads every source again, waiting for a tick already running to finish first.
async function refreshAll(config,{waitMs=120000}={}) {
  const {tick}=await import('./tick.mjs');
  const until=Date.now()+waitMs;
  for(;;) {
    const result=await tick(config).catch(()=>({busy:false}));
    if(!result?.busy || Date.now()>until)return;
    await new Promise(resolve=>setTimeout(resolve,3000));
  }
}

/**
 * @param {any} config
 * @param {{source?: NodeJS.ProcessEnv, find?: () => Promise<string | null>, run?: typeof runClaude,
 *   refresh?: (config: any) => Promise<unknown>, now?: () => number, loginTimeoutMs?: number}} [options]
 */
export async function signIn(config,{source=process.env,find=()=>findClaude(),run=runClaude,refresh=refreshAll,now=Date.now,loginTimeoutMs=LOGIN_TIMEOUT_MS}={}) {
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
    // Already signed in with a subscription: nothing to do but read the limits again.
    let status=await authStatus(executable,{environment,cwd,run});
    let login={ending:'exited',code:0,output:''};
    if(!status?.subscription) {
      await report('waiting',S.waiting);
      let asked=false;
      login=await run(executable,LOGIN_ARGUMENTS,{environment,cwd,timeoutMs:loginTimeoutMs,onOutput:text=>{
        if(!asked && PASTE_CODE.test(text)) {asked=true;report('waiting',S.waitingCode).catch(()=>{});}
      }});
      await report('waiting',S.checking);
      status=await authStatus(executable,{environment,cwd,run});
    }
    const ended=classify({...login,status,certificateMissing});
    if(ended.state==='done') {
      await report('waiting',S.refreshing);
      try {await refresh(config);}catch {}
    }
    await report(ended.state,ended.message,ended.reason);
    return ended;
  },{staleMs:loginTimeoutMs+2*60000});
  return outcome.busy?{state:'busy',reason:'busy',message:null}:outcome.value;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const result=await signIn(await loadConfig());
    // The reason only, never claude's output.
    console.log(result.reason);
    process.exitCode=result.state==='done' || result.state==='busy'?0:1;
  } catch(error) {
    console.error(`Sign-in stopped: ${error.message}`);
    process.exitCode=1;
  }
}
