// One hand-edited settings file per computer. A source runs only when it is
// listed as true here, which is the consent for reading it.
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const REPO=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const CONFIG_FILE=path.join(REPO,'observatory.config.json');
export const SOURCES=['screenTime','codex','codexLimits','claudeCode','claudeLimits'];
export const PLATFORMS={darwin:'mac',win32:'windows'};
export const HOSTS={mac:'Mac',windows:'Windows'};
export const DEFAULT_PORT=5601;

const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const alias=value=>typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value);
// No control characters in names or paths.
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
  throw Error('Observatory runs on macOS and Windows only');
}

export function parseConfig(raw,{platform=process.platform,environment=process.env}={}) {
  only(raw,['device','sources','hub','dashboard','dataFolder','codexPath'],'Config');
  const local=PLATFORMS[platform];
  if(!local)throw Error('Observatory runs on macOS and Windows only');
  const device=raw.device??{};
  only(device,['name'],'device');
  if(device.name!==undefined && !name(device.name))throw Error('device.name must be a short name');
  only(raw.sources??{},SOURCES,'sources');
  const sources=Object.fromEntries(SOURCES.map(key=>{
    const value=raw.sources?.[key];
    if(value!==undefined && typeof value!=='boolean')throw Error(`sources.${key} must be true or false`);
    return [key,value===true];
  }));
  const hub=raw.hub??{spokes:[]};
  only(hub,['spokes'],'hub');
  if(!Array.isArray(hub.spokes ?? []))throw Error('hub.spokes must be a list');
  const spokes=(hub.spokes??[]).map((spoke,index)=>{
    const where=`hub.spokes[${index}]`;
    only(spoke,['name','ssh','platform','dataFolder'],where);
    if(!alias(spoke.ssh))throw Error(`${where}.ssh must be an SSH host alias`);
    if(!['mac','windows'].includes(spoke.platform))throw Error(`${where}.platform must be "mac" or "windows"`);
    if(spoke.name!==undefined && !name(spoke.name))throw Error(`${where}.name must be a short name`);
    if(spoke.dataFolder!==undefined && (typeof spoke.dataFolder!=='string' || (control.test(spoke.dataFolder) || /['"`$]/.test(spoke.dataFolder)) ||
      !(spoke.platform==='windows'?path.win32.isAbsolute(spoke.dataFolder):path.posix.isAbsolute(spoke.dataFolder))))
      throw Error(`${where}.dataFolder must be an absolute path without quotes`);
    return {name:spoke.name??HOSTS[spoke.platform],ssh:spoke.ssh,platform:spoke.platform,dataFolder:spoke.dataFolder??null};
  });
  // The viewer knows one Mac and one Windows PC.
  const platforms=[local,...spokes.map(spoke=>spoke.platform)];
  if(new Set(platforms).size!==platforms.length)throw Error('Use at most one Mac and one Windows PC in total');
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
  return {platform:local,host:HOSTS[local],codexPath,device:{name:device.name??HOSTS[local]},sources,
    hub:{spokes},role:spokes.length?'hub':'spoke',dashboard:{port},dataFolder};
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
