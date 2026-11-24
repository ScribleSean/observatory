import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROLES} from './roles.mjs';
import {certStoreValue} from './claude-env.mjs';

export const REPO=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const CONFIG_FILE=path.join(REPO,'observatory.config.json');
export const SOURCES=['screenTime','codex','codexLimits','claudeCode','claudeLimits','grokLimits','sessions','wsl'];
// Each engine's tile: auto decides from the readings, off always reads Off, on keeps it shown on a free plan.
export const ENGINE_SETTINGS=['auto','on','off'];
export const ENGINE_IDS=['claude','codex','grok'];
const RETIRED_SOURCES=['agents'];
export const PLATFORMS={darwin:'mac',win32:'windows',linux:'linux'};
export const HOSTS={mac:'Mac',windows:'Windows',linux:'Linux'};
export const DEFAULT_PORT=5601;

const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const alias=value=>typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value);
// oxlint-disable-next-line no-control-regex -- refusing control characters is the point
const control=/[\u0000-\u001f\u007f]/;
const name=value=>typeof value==='string' && value.trim().length>0 && value.length<=64 && !control.test(value);

function only(value,keys,where) {
  if(!object(value))throw Error(`${where} must be an object`);
  const extra=Object.keys(value).filter(key=>!keys.includes(key));
  if(extra.length)throw Error(`${where} has unknown setting ${extra[0]}`);
}

export function defaultDataFolder(platform=process.platform,environment=process.env) {
  if(platform==='darwin')return path.join(homedir(),'Library/Application Support/Observatory');
  if(platform==='win32') {
    const local=environment.LOCALAPPDATA;
    if(!local || !path.win32.isAbsolute(local))throw Error('LOCALAPPDATA is not set');
    return path.win32.join(local,'Observatory');
  }
  if(platform==='linux') {
    const share=environment.XDG_DATA_HOME;
    return share && path.posix.isAbsolute(share)?path.posix.join(share,'observatory'):path.join(homedir(),'.local','share','observatory');
  }
  throw Error('Observatory runs on macOS, Windows and Linux only');
}

export function parseConfig(raw,{platform=process.platform,environment=process.env}={}) {
  only(raw,['device','sources','hub','dashboard','dataFolder','codexPath','grok','engines','sessions','glance','claude'],'Config');
  const local=PLATFORMS[platform];
  if(!local)throw Error('Observatory runs on macOS, Windows and Linux only');
  const device=raw.device??{};
  only(device,['name'],'device');
  if(device.name!==undefined && !name(device.name))throw Error('device.name must be a short name');
  only(raw.sources??{},[...SOURCES,...RETIRED_SOURCES],'sources');
  const sources=Object.fromEntries(SOURCES.map(key=>{
    const value=raw.sources?.[key];
    if(value!==undefined && typeof value!=='boolean')throw Error(`sources.${key} must be true or false`);
    return [key,value===true];
  }));
  if(sources.wsl && local!=='windows')throw Error('sources.wsl works on Windows only');
  const hub=raw.hub??{spokes:[]};
  only(hub,['spokes'],'hub');
  if(!Array.isArray(hub.spokes ?? []))throw Error('hub.spokes must be a list');
  const spokes=(hub.spokes??[]).map((spoke,index)=>{
    const where=`hub.spokes[${index}]`;
    only(spoke,['name','ssh','platform','dataFolder','off'],where);
    if(!alias(spoke.ssh))throw Error(`${where}.ssh must be an SSH host alias`);
    if(!['mac','windows','linux'].includes(spoke.platform))throw Error(`${where}.platform must be "mac", "windows" or "linux"`);
    if(spoke.name!==undefined && !name(spoke.name))throw Error(`${where}.name must be a short name`);
    if(spoke.dataFolder!==undefined && (typeof spoke.dataFolder!=='string' || (control.test(spoke.dataFolder) || /['"`$]/.test(spoke.dataFolder)) ||
      !(spoke.platform==='windows'?path.win32.isAbsolute(spoke.dataFolder):path.posix.isAbsolute(spoke.dataFolder))))
      throw Error(`${where}.dataFolder must be an absolute path without quotes`);
    if(spoke.off!==undefined && typeof spoke.off!=='boolean')throw Error(`${where}.off must be true or false`);
    return {name:spoke.name??HOSTS[spoke.platform],ssh:spoke.ssh,platform:spoke.platform,dataFolder:spoke.dataFolder??null,off:spoke.off===true};
  });
  const platforms=[local,...spokes.map(spoke=>spoke.platform)];
  if(new Set(platforms).size!==platforms.length)throw Error('Use at most one Mac, one Windows PC and one Linux computer in total');
  const dashboard=raw.dashboard??{};
  only(dashboard,['port'],'dashboard');
  const port=dashboard.port??DEFAULT_PORT;
  if(!Number.isInteger(port) || port<1024 || port>65535)throw Error('dashboard.port must be between 1024 and 65535');
  let dataFolder=raw.dataFolder;
  if(dataFolder===undefined)dataFolder=defaultDataFolder(platform,environment);
  else if(typeof dataFolder!=='string' || !(platform==='win32'?path.win32:path.posix).isAbsolute(dataFolder))
    throw Error('dataFolder must be an absolute path');
  const codexPath=raw.codexPath??null;
  if(codexPath!==null && (typeof codexPath!=='string' || control.test(codexPath) || !(platform==='win32'?path.win32:path.posix).isAbsolute(codexPath)))
    throw Error('codexPath must be an absolute path to the codex program');
  const absolute=value=>typeof value==='string' && !control.test(value) && (platform==='win32'?path.win32:path.posix).isAbsolute(value);
  const grok=raw.grok??{};
  only(grok,['appFolder','requestLog'],'grok');
  for(const key of ['appFolder','requestLog'])
    if(grok[key]!==undefined && !absolute(grok[key]))throw Error(`grok.${key} must be an absolute path`);
  // Session titles show in the ledger and stay on the user's computers. false hashes them away.
  const sessions=raw.sessions??{};
  only(sessions,['titles','roles'],'sessions');
  if(sessions.titles!==undefined && typeof sessions.titles!=='boolean')throw Error('sessions.titles must be true or false');
  const roles=parseRoleAliases(sessions.roles);
  // The menu bar icon: a template image the system tints (the default), or the accent color.
  const glance=raw.glance??{};
  only(glance,['accent'],'glance');
  if(glance.accent!==undefined && typeof glance.accent!=='boolean')throw Error('glance.accent must be true or false');
  // claude.caCertificates: the certificate file of a network with its own certificate authority, recorded by setup
  // from the user's shell so the apps' claude processes trust it too (lib/claude-env.mjs). It stays in this file only.
  const claude=raw.claude??{};
  only(claude,['caCertificates','certStore'],'claude');
  if(claude.caCertificates!==undefined && !absolute(claude.caCertificates))throw Error('claude.caCertificates must be an absolute path to a certificate file');
  // claude.certStore: the certificate stores Claude Code starts from (its CLAUDE_CODE_CERT_STORE), recorded by setup.
  if(claude.certStore!==undefined && certStoreValue(claude.certStore)===null)throw Error('claude.certStore must name "system", "bundled" or both');
  const engines=raw.engines??{};
  only(engines,ENGINE_IDS,'engines');
  for(const [key,value] of Object.entries(engines))
    if(!ENGINE_SETTINGS.includes(value))throw Error(`engines.${key} must be "auto", "on" or "off"`);
  return {platform:local,host:HOSTS[local],codexPath,device:{name:device.name??HOSTS[local]},sources,
    grok:{appFolder:grok.appFolder??null,requestLog:grok.requestLog??null},claude:{caCertificates:claude.caCertificates??null,certStore:certStoreValue(claude.certStore)},
    engines:Object.fromEntries(ENGINE_IDS.map(id=>[id,engines[id]??'auto'])),
    hub:{spokes},role:spokes.length?'hub':'spoke',dashboard:{port},dataFolder,sessions:{titles:sessions.titles??true,roles},glance:{accent:glance.accent===true}};
}

// sessions.roles: the user's own title starts and the role each one means ("tidepool notes": "Researcher"),
// for lib/roles.mjs. Personal naming habits live here, never in the code.
export const MAX_ROLE_ALIASES=100;
export function parseRoleAliases(raw) {
  if(raw===undefined)return {};
  if(!object(raw))throw Error('sessions.roles must be an object of title starts and roles');
  const entries=Object.entries(raw);
  if(entries.length>MAX_ROLE_ALIASES)throw Error(`sessions.roles holds at most ${MAX_ROLE_ALIASES} title starts`);
  return Object.fromEntries(entries.map(([start,role])=>{
    if(!name(start) || start.length>64)throw Error('Each sessions.roles title start must be short text');
    if(!ROLES.includes(role))throw Error(`sessions.roles "${start.trim()}" must be one of: ${ROLES.join(', ')}`);
    return [start.trim(),role];
  }));
}

/**
 * This computer's settings as the hub echoes them into view.config (lib/r2-shape.mjs ConfigEcho): no paths,
 * SSH aliases, data folders or program locations.
 * @param {ReturnType<typeof parseConfig>} config
 * @param {string | null} checkedAt
 */
export function configEcho(config,checkedAt=null) {
  return {host:config.host,name:config.device?.name ?? config.host,role:config.role==='hub'?'hub':'spoke',
    sources:Object.fromEntries(SOURCES.map(key=>[key,config.sources?.[key]===true])),
    engines:Object.fromEntries(ENGINE_IDS.map(id=>[id,ENGINE_SETTINGS.includes(config.engines?.[id])?config.engines[id]:'auto'])),
    titles:config.sessions?.titles!==false,roleAliases:{...config.sessions?.roles},checkedAt};
}

export async function loadConfig(file=process.env.OBSERVATORY_CONFIG || CONFIG_FILE,options={}) {
  let text;
  try {text=await readFile(file,'utf8');}
  catch(error) {
    if(error.code==='ENOENT')throw Error(`No settings file at ${file}. Run npm run setup.`);
    throw error;
  }
  let raw;
  try {raw=JSON.parse(text);}catch {throw Error(`${file} is not valid JSON`);}
  return parseConfig(raw,options);
}

export const localFolder=config=>path.join(config.dataFolder,'public','local');
