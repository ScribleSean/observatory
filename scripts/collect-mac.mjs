import {spawn} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {readFile,writeFile,mkdir,rename,lstat,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {macActivity} from './collect-dashboard.mjs';
import {macSnapshot,macCollectorConfig} from './mac-snapshot.mjs';
import {previousActivityHistory} from './activity-history.mjs';
import {preparePeerCollection} from './peer-collection.mjs';
import {readPairing} from './peer-pairing.mjs';
import {finalizePeerCollection} from './peer-finalize.mjs';
import {privateCollectorDirectory} from './peer-directory.mjs';
import {collectQuota,attachQuota} from './collect-quota.mjs';
import {attachQuotaSync} from './quota-sync.mjs';

const scripts=path.dirname(fileURLToPath(import.meta.url));
function pythonReport(python,script,args) {
  return new Promise((resolve,reject)=>{
    const child=spawn(python,['-I','-B','-X','utf8','-',...args],{stdio:['pipe','pipe','ignore']});
    let output='',done=false;
    const finish=(error)=>{
      if(done)return;done=true;clearTimeout(timer);
      if(error){child.kill();reject(error);return;}
      try{resolve(JSON.parse(output));}catch{reject(Error('Invalid local reader output'));}
    };
    const timer=setTimeout(()=>finish(Error('Local reader timeout')),60000);
    child.once('error',()=>finish(Error('Local reader unavailable')));
    child.stdout.on('data',data=>{output+=data;if(Buffer.byteLength(output)>16_000_000)finish(Error('Local reader output limit'));});
    child.once('close',code=>finish(code===0?null:Error('Local reader failed')));
    child.stdin.on('error',()=>{});child.stdin.end(script);
  });
}

export async function collectMac(runtime,python,peerConfig=null) {
  if(process.platform!=='darwin' || !path.isAbsolute(runtime) || !path.isAbsolute(python || ''))throw Error('Absolute Mac runtime and Python executable required');
  for(const folder of [runtime,path.join(runtime,'public'),path.join(runtime,'public/local')]) {
    await mkdir(folder,{recursive:true,mode:0o700});
    const info=await lstat(folder);
    if(!info.isDirectory() || info.isSymbolicLink())throw Error('Unsafe Mac runtime directory');
  }
  const configFile=path.join(runtime,'collector.config.json');
  const info=await lstat(configFile);
  if(!info.isFile() || info.isSymbolicLink() || info.size>4096)throw Error('Invalid local Mac configuration');
  const config=macCollectorConfig(JSON.parse(await readFile(configFile,'utf8')));
  let savedPairing=null,pairingFailed=false;
  if(!peerConfig)try {savedPairing=await readPairing(runtime);peerConfig=savedPairing?.local??null;}catch{pairingFailed=true;}
  let pairing=null;
  try {if(peerConfig)pairing=preparePeerCollection(peerConfig,'Mac',['Mac']);}catch{}
  const folder=path.join(runtime,'public/local');
  const atomic=async(name,value)=>{
    const temporary=path.join(folder,`.collector-${randomUUID()}.tmp`);
    try{await writeFile(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});await rename(temporary,path.join(folder,name));}
    finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  };
  const startedAt=new Date().toISOString();
  await atomic('collector.json',{state:'running',startedAt,intervalSeconds:300,maxRunSeconds:240});
  const report=async(name,args,prefix='')=>pythonReport(python,prefix+await readFile(path.join(scripts,name),'utf8'),args);
  let previous=[];
  try{previous=await previousActivityHistory(path.join(folder,'usage.json'));}catch{}
  const result=await macSnapshot(config,{
    activity:()=>macActivity({raw:true}),
    codex:async()=>{
      const cache=await privateCollectorDirectory(runtime,'private-codex',true);
      const cacheScript=await readFile(path.join(scripts,'read-settings-cache.py'),'utf8');
      return report('read-settings.py',[path.join(homedir(),'.codex')],
        (pairing?.readerPrefix??'')+`CACHE_DIRECTORY = ${JSON.stringify(cache)}\n`+cacheScript+'\n');
    },
    wispr:()=>report('read-wispr.py',[homedir()]),
    typewhisper:()=>report('read-typewhisper.py',[homedir()],"MODE = 'mac'\n"),
  },previous,new Date().toISOString(),pairing?.config??null);
  if((peerConfig && !pairing) || pairingFailed)result.peer={status:'unavailable'};
  await finalizePeerCollection(runtime,result,savedPairing,previous);
  // Account-wide history belongs to the observing device, not the peer sum.
  let quota;
  try {quota=await collectQuota(runtime,{enabled:config.quota,
    isEnabled:async()=>macCollectorConfig(JSON.parse(await readFile(configFile,'utf8'))).quota});}
  catch {quota={status:'unavailable',provider:'Codex',scope:'account',windows:[],history:[],dailyUsageBuckets:[]};}
  attachQuota(result,quota);
  await attachQuotaSync(runtime,result,{enabled:config.quota});
  const {data,status}=result;
  await atomic('usage.json',data);
  await atomic('collector.json',{...status,startedAt,finishedAt:new Date().toISOString(),snapshotAt:data.collectedAt,intervalSeconds:300,maxRunSeconds:240});
  console.log(JSON.stringify(status));
  return result;
}

// macOS presents /var and /private/var as aliases. Compare filesystem identities,
// not spelling, so launching from an app bundle in a temporary folder still runs.
if(process.argv[1] && process.argv[1]!=='-' && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))collectMac(process.env.OBSERVATORY_RUNTIME || '',process.env.OBSERVATORY_PYTHON)
  .catch(()=>{console.error('Mac collection unavailable');process.exitCode=1;});
