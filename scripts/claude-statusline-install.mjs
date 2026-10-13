#!/usr/bin/env node
// Adds or removes the Observatory status line bridge in Claude Code's settings.
// It changes a file Claude Code owns, so install needs --consent and nothing
// calls this automatically. The earlier status line is saved and restored.
import {lstat,readFile,rename,unlink,writeFile,copyFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {CLAUDE_STATUSLINE_FILE,ensureClaudeLimitsFolder,writeJsonAtomic} from './claude-limits.mjs';

const bridgeName='claude-statusline-bridge.mjs';
const isObject=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const isOurs=line=>isObject(line) && typeof line.command==='string' && line.command.includes(bridgeName);

export function defaultSettingsPath(environment=process.env) {
  const configured=environment.CLAUDE_CONFIG_DIR;
  if(configured && !path.isAbsolute(configured))throw Error('CLAUDE_CONFIG_DIR must be an absolute path');
  return path.join(configured || path.join(homedir(),'.claude'),'settings.json');
}

// Forward slashes and double quotes are accepted by POSIX shells, Git Bash and cmd.
export function bridgeCommand(node,bridge,runtime,platform=process.platform) {
  const values=[node,bridge,runtime];
  const absolute=platform==='win32'?path.win32.isAbsolute:path.posix.isAbsolute;
  if(values.some(value=>typeof value!=='string' || !absolute(value) || /["`$\r\n]/.test(value) || value.includes('\0') || (platform!=='win32' && value.includes('\\'))))
    throw Error('Paths must be absolute and free of quotes and shell characters');
  const quote=value=>`"${platform==='win32'?value.replaceAll('\\','/'):value}"`;
  return `${quote(node)} ${quote(bridge)} --runtime ${quote(runtime)}`;
}

async function readSettings(file) {
  let text;
  try {
    const info=await lstat(file);
    if(!info.isFile() || info.isSymbolicLink() || info.size>4*1024*1024)throw Error('Claude Code settings file is not a plain file');
    text=await readFile(file,'utf8');
  } catch(error) {
    if(error.code==='ENOENT')return {text:null,settings:{}};
    throw error;
  }
  const settings=JSON.parse(text);
  if(!isObject(settings))throw Error('Claude Code settings are not a JSON object');
  return {text,settings};
}

async function writeSettings(file,settings,expectedText) {
  const temporary=path.join(path.dirname(file),`.settings-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary,JSON.stringify(settings,null,2)+'\n',{flag:'wx',mode:0o600});
    // Claude Code can save its settings at any time. Do not overwrite a newer file.
    const current=(await readSettings(file)).text;
    if(current!==expectedText)throw Error('Claude Code settings changed during the update. Nothing was written.');
    await rename(temporary,file);
  } finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

export async function statuslineStatus({runtime,settingsPath=defaultSettingsPath()}) {
  const {settings}=await readSettings(settingsPath);
  return {installed:isOurs(settings.statusLine),otherStatusLine:isObject(settings.statusLine) && !isOurs(settings.statusLine),settingsPath,runtime};
}

export async function installStatusline({runtime,settingsPath=defaultSettingsPath(),node=process.execPath,
  bridge=fileURLToPath(new URL('./'+bridgeName,import.meta.url)),consent=false,now=new Date()}) {
  if(consent!==true)throw Error('Install changes Claude Code settings and needs explicit consent');
  const command=bridgeCommand(node,bridge,runtime);
  const folder=await ensureClaudeLimitsFolder(runtime);
  const {text,settings}=await readSettings(settingsPath);
  const marker=path.join(folder,CLAUDE_STATUSLINE_FILE);
  let previous=settings.statusLine===undefined?null:settings.statusLine;
  if(isOurs(previous)) {
    // Reinstalling keeps the status line saved by the first install.
    try {previous=JSON.parse(await readFile(marker,'utf8')).previous ?? null;}catch{previous=null;}
  }
  if(text!==null)await copyFile(settingsPath,settingsPath+'.observatory-backup');
  await writeJsonAtomic(marker,{installedAt:now.toISOString(),settingsPath,previous});
  try {await writeSettings(settingsPath,{...settings,statusLine:{type:'command',command}},text);}
  catch(error) {if(!isOurs(settings.statusLine))await unlink(marker).catch(()=>{});throw error;}
  return {installed:true,replacedStatusLine:previous!==null,settingsPath};
}

export async function uninstallStatusline({runtime,settingsPath=defaultSettingsPath()}) {
  const folder=await ensureClaudeLimitsFolder(runtime);
  const marker=path.join(folder,CLAUDE_STATUSLINE_FILE);
  const {text,settings}=await readSettings(settingsPath);
  let previous=null;
  try {previous=JSON.parse(await readFile(marker,'utf8')).previous ?? null;}catch{}
  if(isOurs(settings.statusLine)) {
    const next={...settings};
    if(isObject(previous))next.statusLine=previous;else delete next.statusLine;
    await writeSettings(settingsPath,next,text);
  }
  await unlink(marker).catch(error=>{if(error.code!=='ENOENT')throw error;});
  return {installed:false,restoredStatusLine:isOurs(settings.statusLine) && isObject(previous),settingsPath};
}

if(process.argv[1] && path.basename(process.argv[1])==='claude-statusline-install.mjs') {
  const [action,...rest]=process.argv.slice(2);
  const option=name=>{const index=rest.indexOf(name);return index>=0?rest[index+1]:undefined;};
  const options={runtime:option('--runtime') ?? process.env.OBSERVATORY_RUNTIME ?? '',
    ...(option('--settings')?{settingsPath:option('--settings')}:{}),...(option('--node')?{node:option('--node')}:{}),consent:rest.includes('--consent')};
  const run=action==='install'?installStatusline:action==='uninstall'?uninstallStatusline:action==='status'?statuslineStatus:null;
  if(!run || !path.isAbsolute(options.runtime)) {
    console.error('Usage: claude-statusline-install.mjs status|install|uninstall --runtime <absolute folder> [--settings <file>] [--consent]');
    process.exitCode=2;
  } else run(options).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
