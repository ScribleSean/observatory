import {lstat} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {listQuotaArchives,readQuotaArchive} from './quota-store.mjs';

const hex=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const time=value=>Number.isSafeInteger(value) && value>=0 && value<=8640000000000000;

// Native-process stdin/stdout only. Do not mount this on a web or peer route.
// No provider discovery, authentication, collection or deletion is performed.
export async function quotaArchiveControl(runtime,request) {
  if(!path.isAbsolute(runtime) || !request || Array.isArray(request) || typeof request!=='object')throw Error('Invalid archive request');
  const keys=Object.keys(request);
  if(request.action==='accounts') {
    if(keys.some(key=>!['action','after','limit'].includes(key)) ||
      (request.after!==undefined && request.after!==null && !hex(request.after)) ||
      (request.limit!==undefined && (!Number.isSafeInteger(request.limit) || request.limit<1 || request.limit>100)))throw Error('Invalid account request');
  } else if(request.action==='page') {
    if(keys.some(key=>!['action','scope','kind','from','to','after','limit'].includes(key)) || !hex(request.scope) ||
      !['observation','daily','poll'].includes(request.kind) || !time(request.from) || !time(request.to) || request.from>request.to ||
      (request.limit!==undefined && (!Number.isSafeInteger(request.limit) || request.limit<1 || request.limit>200)) ||
      (request.after!==undefined && request.after!==null && (typeof request.after!=='object' ||
        Object.keys(request.after).sort().join(',')!=='at,id' || !time(request.after.at) || !Number.isSafeInteger(request.after.id) || request.after.id<1)))throw Error('Invalid page request');
  } else throw Error('Invalid archive action');
  // Merely opening History must not initialize storage for a never-enabled source.
  const directory=await lstat(runtime);
  if(!directory.isDirectory() || directory.isSymbolicLink())throw Error('Invalid runtime');
  try {await lstat(path.join(runtime,'private-quota','state.sqlite'));}
  catch(error) {
    if(error.code!=='ENOENT')throw error;
    return request.action==='accounts'?{version:1,accounts:[],next:null,storageBytes:0,storageLimitBytes:8*1024*1024*1024}:
      {version:1,records:[],next:null};
  }
  const {action,...query}=request;
  return {version:1,...await (action==='accounts'?listQuotaArchives(runtime,query):readQuotaArchive(runtime,query))};
}

async function main() {
  const args=process.argv.slice(2);
  if(args.length!==2 || args[0]!=='--runtime')throw Error('Invalid arguments');
  const chunks=[];let bytes=0;
  const timer=setTimeout(()=>process.exit(1),15000);
  try {
    for await(const chunk of process.stdin) {
      bytes+=chunk.length;if(bytes>2048)throw Error('Request too large');chunks.push(chunk);
    }
    const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    process.stdout.write(JSON.stringify(await quotaArchiveControl(args[1],request))+'\n');
  } finally {clearTimeout(timer);}
}
if(process.argv[1] && process.argv[1]!=='-' && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))main().catch(()=>{
  process.stderr.write('Saved allowance history could not be read. No history was deleted.\n');process.exitCode=1;
});
