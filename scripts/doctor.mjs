// npm run doctor: what stands between this computer and a reading, one plain line each and one fix for each
// problem. `npm run setup` runs it at the end. It only reads: it never signs in, uses no token and changes no file.
// The certificate probe opens a TLS connection to Anthropic the way Claude Code does (Node's own certificates plus
// NODE_EXTRA_CA_CERTS) and closes it before anything is sent.
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import tls from 'node:tls';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CONFIG_FILE,loadConfig} from '../lib/config.mjs';
import {certificateSource,claudeEnvironment,shellCertificateFile} from '../lib/claude-env.mjs';
import {findClaude} from './claude-usage-command.mjs';
import {authStatus} from './claude-sign-in.mjs';
import strings from '../lib/strings.json' with {type:'json'};

export const PROBE_HOSTS=Object.freeze(['api.anthropic.com','claude.ai']);
const S=strings.claudeSignIn;
const CERTIFICATE_CODES=new Set(['UNABLE_TO_GET_ISSUER_CERT','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','CERT_HAS_EXPIRED','CERT_UNTRUSTED','CERT_SIGNATURE_FAILURE','ERR_TLS_CERT_ALTNAME_INVALID']);

/**
 * Whether a TLS connection to `host` is trusted with Node's built-in certificates plus `extra` (a PEM file's text).
 * @returns {Promise<'trusted' | 'certificate' | 'unreachable'>}
 */
export function probeTls(host,{extra=null,port=443,timeoutMs=5000,connect=tls.connect}={}) {
  return new Promise(resolve=>{
    let done=false,socket;
    const finish=result=>{if(done)return;done=true;clearTimeout(timer);try {socket?.destroy();}catch {}resolve(result);};
    const timer=setTimeout(()=>finish('unreachable'),timeoutMs);
    try {
      socket=connect({host,port,servername:host,ca:extra?[...tls.rootCertificates,extra]:[...tls.rootCertificates],rejectUnauthorized:true},()=>finish('trusted'));
      socket.once('error',error=>finish(CERTIFICATE_CODES.has(error?.code)?'certificate':'unreachable'));
    } catch {finish('unreachable');}
  });
}

/**
 * The checks, as {ok, text, fix?}: ok true is fine, false needs the fix, null is a note.
 * @param {{config?: any, configError?: string | null, source?: NodeJS.ProcessEnv, platform?: NodeJS.Platform,
 *   find?: () => Promise<string | null>, status?: (executable: string, environment: object) => Promise<{loggedIn: boolean, subscription: boolean} | null>,
 *   probe?: (host: string, extra: string | null) => Promise<'trusted' | 'certificate' | 'unreachable'>, readCa?: (file: string) => Promise<string>}} options
 */
export async function doctor({config=null,configError=null,source=process.env,platform=process.platform,find=()=>findClaude(),
  status=(executable,environment)=>authStatus(executable,{environment,cwd:config?.dataFolder}),
  probe=(host,extra)=>probeTls(host,{extra}),readCa=file=>readFile(file,'utf8')}={}) {
  const lines=[];
  const add=(ok,text,fix=null)=>lines.push({ok,text,...(fix?{fix}:{})});
  const panel=platform==='darwin'?'the menu bar panel':platform==='win32'?'the tray panel':null;
  if(!config) {
    add(false,'Settings could not be read'+(configError?`: ${configError}`:'.'),'Run npm run setup.');
    return lines;
  }
  add(true,`Settings: ${config.device?.name ?? config.host}, ${config.role==='hub'?'combining computers':'this computer'}`);
  if(!config.sources?.claudeLimits) {
    add(null,'Claude limits are off (sources.claudeLimits), so Claude Code is not checked.');
    return lines;
  }

  // Certificates: what the apps get (the file recorded by setup) and what this shell has.
  const shell=shellCertificateFile(source,platform);
  const recorded=config.claude?.caCertificates ?? null;
  const ca=certificateSource(config,source,platform);
  if(ca.missing && !ca.file)add(false,'The certificate file recorded by setup is missing.','Set NODE_EXTRA_CA_CERTS to your network\'s certificate file and run npm run setup again.');
  else if(shell && shell!==recorded)add(false,'This shell trusts an extra certificate file that the menu bar and tray apps do not know about.','Run npm run setup again to record it.');
  else if(recorded)add(true,'Claude Code gets the certificate file recorded by setup.');

  const executable=await find().catch(()=>null);
  if(!executable) {
    add(false,'Claude Code was not found.','Install Claude Code, run claude once in a terminal, then run npm run doctor again.');
    return lines;
  }
  add(true,'Claude Code is installed.');

  // A TLS probe with what claude would trust. Only a certificate failure is reported: offline is not a problem here.
  let extra=null;
  if(ca.file)try {extra=await readCa(ca.file);}catch {}
  let trust='unreachable';
  for(const host of PROBE_HOSTS) {
    trust=await probe(host,extra).catch(()=>'unreachable');
    if(trust!=='trusted')break;
  }
  if(trust==='certificate')add(false,'Claude Code cannot trust this network\'s certificate, so sign-in and limit reads fail.',S.certificate);
  else if(trust==='trusted')add(true,'Claude Code can reach Anthropic over this network.');
  else add(null,'Anthropic could not be reached just now, so the certificate check was skipped.');

  const signed=await status(executable,claudeEnvironment(config,source,platform)).catch(()=>null);
  if(!signed)add(null,'Claude Code\'s sign-in could not be read.');
  else if(signed.subscription)add(true,'Signed in to Claude with a subscription.');
  else if(signed.loggedIn)add(false,'Signed in with an Anthropic Console account, which has no subscription limits to read.','Sign in with your Claude subscription: claude auth login --claudeai');
  else add(false,'Claude Code is signed out.',panel?`Use Sign in to Claude in ${panel}, or run claude auth login --claudeai.`:'Run claude auth login --claudeai.');
  return lines;
}

export function describe(lines) {
  return lines.map(line=>`  ${line.ok===true?'ok  ':line.ok===false?'fix ':'note'}  ${line.text}${line.fix?`\n        ${line.fix}`:''}`).join('\n');
}

export async function runDoctor({log=console.log,configFile=process.env.OBSERVATORY_CONFIG || CONFIG_FILE,...options}={}) {
  let config=null,configError=null;
  if(existsSync(configFile))try {config=await loadConfig(configFile);}catch(error) {configError=error.message;}
  const lines=await doctor({config,configError,...options});
  log(describe(lines));
  return lines;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    console.log('Observatory check');
    const lines=await runDoctor();
    process.exitCode=lines.some(line=>line.ok===false)?1:0;
  } catch(error) {
    console.error(`Check stopped: ${error.message}`);
    process.exitCode=1;
  }
}
