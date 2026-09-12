import {spawn,execFile} from 'node:child_process';
import {readFile,writeFile,mkdir,rename,lstat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {cleanWispr} from './wispr.mjs';
import {cleanDictation} from './typewhisper.mjs';
import {previousActivityHistory} from './activity-history.mjs';
import {windowsCollectorConfig} from './windows-snapshot.mjs';
import {windowsSnapshot} from './windows-dashboard.mjs';
import {preparePeerCollection} from './peer-collection.mjs';
import {readPairing} from './peer-pairing.mjs';
import {finalizePeerCollection} from './peer-finalize.mjs';
import {privateCollectorDirectory} from './peer-directory.mjs';
import {collectQuota,attachQuota} from './collect-quota.mjs';
import {attachQuotaSync} from './quota-sync.mjs';
import {findWindowsQuotaClient,readWindowsQuotaSnapshot} from './windows-quota.mjs';

const scripts=path.dirname(fileURLToPath(import.meta.url));
const unavailable=host=>({host,status:'unavailable',checkedAt:new Date().toISOString()});
const disconnected=host=>({host,status:'not-connected'});

function run(file,args,input='') {
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{windowsHide:true,stdio:['pipe','pipe','ignore']});
    let output='',done=false;
    const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(output);};
    const stop=()=>{
      if(child.pid && child.exitCode===null)execFile(path.join(process.env.SystemRoot || 'C:/Windows','System32/taskkill.exe'),
        ['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});
    };
    const timer=setTimeout(()=>{stop();finish(Error('Reader timeout'));},60000);
    child.once('error',finish);
    child.stdout.on('data',data=>{output+=data;if(Buffer.byteLength(output)>16_000_000){stop();finish(Error('Reader output limit'));}});
    child.once('close',code=>finish(code===0?null:Error('Reader unavailable')));
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}

export async function collectWindows(runtime,peerConfig=null) {
  if(process.platform!=='win32' || !path.isAbsolute(runtime))throw Error('Native Windows runtime required');
  const config=windowsCollectorConfig(JSON.parse(await readFile(path.join(runtime,'collector.config.json'),'utf8')));
  let savedPairing=null,pairingFailed=false;
  if(!peerConfig)try {savedPairing=await readPairing(runtime);peerConfig=savedPairing?.local??null;}catch{pairingFailed=true;}
  let pairing=null;
  try {if(peerConfig)pairing=preparePeerCollection(peerConfig,'Windows',config.wslDistribution?['Windows','Ubuntu']:['Windows']);}catch{}
  const folder=path.join(runtime,'public/local');
  await mkdir(folder,{recursive:true});
  if((await lstat(folder)).isSymbolicLink())throw Error('Unsafe runtime directory');
  const startedAt=new Date().toISOString();
  const atomic=async(name,value)=>{const file=path.join(folder,name);await writeFile(file+'.tmp',JSON.stringify(value),{mode:0o600});await rename(file+'.tmp',file);};
  await atomic('collector.json',{state:'running',startedAt,intervalSeconds:300,maxRunSeconds:240});
  const guarded=async(host,action)=>{try{return {...await action(),checkedAt:new Date().toISOString()};}catch{return unavailable(host);}};
  const python=process.env.OBSERVATORY_PYTHON || path.join(process.env.SystemRoot || 'C:/Windows','py.exe');
  const pythonArgs=path.basename(python).toLowerCase()==='py.exe'?['-3','-B','-X','utf8','-']:['-B','-X','utf8','-'];
  const wsl=path.join(process.env.SystemRoot || 'C:/Windows','System32/wsl.exe');
  const settingsScript=(pairing?.readerPrefix??'')+await readFile(path.join(scripts,'read-settings.py'),'utf8');
  const [localSettings,ubuntuSettings,windows,wispr,typewhisper]=await Promise.all([guarded('Windows',async()=>{
    if(!config.codex)return disconnected('Windows');
    const cache=await privateCollectorDirectory(runtime,'private-codex',true);
    const cacheScript=await readFile(path.join(scripts,'read-settings-cache.py'),'utf8');
    return {...JSON.parse(await run(python,[...pythonArgs,path.join(homedir(),'.codex')],
      `CACHE_DIRECTORY = ${JSON.stringify(cache)}\n`+cacheScript+'\n'+settingsScript)),host:'Windows'};
  }),guarded('Ubuntu',async()=>{
    if(!config.wslDistribution || !config.codex)return disconnected('Ubuntu');
    const prefix=['--distribution',config.wslDistribution,'--exec'];
    const home=(await run(wsl,[...prefix,'/usr/bin/printenv','HOME'])).trim();
    if(!/^\/home\/[A-Za-z0-9_.-]+$/.test(home))throw Error('Unsupported WSL home');
    // Invoking wsl.exe starts the selected installed distro. No terminal is required.
    return {...JSON.parse(await run(wsl,[...prefix,'/usr/bin/timeout','55s','python3','-',home+'/.codex'],settingsScript)),host:'Ubuntu'};
  }),guarded('Windows',async()=>{
    if(!config.activity)return disconnected('Windows');
    const powershell=path.join(process.env.SystemRoot || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    const raw=JSON.parse(await run(powershell,['-NoProfile','-NonInteractive','-File',path.join(scripts,'windows-aggregate-activity.ps1')]));
    return {...raw,host:'Windows',status:'ok'};
  }),guarded('Windows',async()=>{
    if(!config.wispr)return {...disconnected('Windows'),source:'Wispr Flow'};
    const script="MODE = 'windows'\n"+await readFile(path.join(scripts,'read-wispr.py'),'utf8');
    return cleanWispr(JSON.parse(await run(python,[...pythonArgs,homedir()],script)),'Windows');
  }),guarded('Windows',async()=>{
    if(!config.typewhisper)return disconnected('Windows');
    const script="MODE = 'windows'\n"+await readFile(path.join(scripts,'read-typewhisper.py'),'utf8');
    return cleanDictation(JSON.parse(await run(python,[...pythonArgs,homedir()],script)),'Windows');
  })]);
  let previous=[];
  try{previous=await previousActivityHistory(path.join(folder,'usage.json'));}catch{}
  const collectedAt=new Date().toISOString();
  const result=windowsSnapshot({localSettings,ubuntuSettings,windows,wispr,typewhisper},previous,collectedAt,pairing?.config??null);
  if((peerConfig && !pairing) || pairingFailed)result.peer={status:'unavailable'};
  await finalizePeerCollection(runtime,result,savedPairing,previous);
  let quota;
  try {quota=await collectQuota(runtime,{enabled:config.quota,
    resolveExecutable:()=>findWindowsQuotaClient(config.quotaWslDistribution),readSnapshot:readWindowsQuotaSnapshot,
    isEnabled:async()=>{
      const current=windowsCollectorConfig(JSON.parse(await readFile(path.join(runtime,'collector.config.json'),'utf8')));
      return current.quota && current.quotaWslDistribution===config.quotaWslDistribution;
    }});}
  catch {quota={status:'unavailable',provider:'Codex',scope:'account',windows:[],history:[],dailyUsageBuckets:[]};}
  attachQuota(result,quota);
  await attachQuotaSync(runtime,result,{enabled:config.quota});
  const {data,status}=result;
  await atomic('usage.json',data);
  await atomic('collector.json',{...status,startedAt,finishedAt:new Date().toISOString(),
    snapshotAt:data.collectedAt,intervalSeconds:300,maxRunSeconds:240});
  console.log(JSON.stringify(status));
  return result;
}

if(process.argv[1]===fileURLToPath(import.meta.url))collectWindows(process.env.OBSERVATORY_RUNTIME || '').catch(()=>{console.error('Windows collection unavailable');process.exitCode=1;});
