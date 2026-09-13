import {lstat,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {attachQuotaSync} from './quota-sync.mjs';

// Called under the platform collector lock. Never make unrelated sources look
// freshly collected just because an allowance observation changed.
export async function refreshAllowances(runtime,{enabled,readQuota,sync=attachQuotaSync}) {
  if(!path.isAbsolute(runtime) || typeof enabled!=='boolean' || typeof readQuota!=='function')throw Error('Invalid allowance refresh');
  const folder=path.join(runtime,'public/local'),file=path.join(folder,'usage.json');
  for(const directory of [runtime,path.join(runtime,'public'),folder]) {
    const info=await lstat(directory);
    if(!info.isDirectory() || info.isSymbolicLink())throw Error('Unsafe allowance snapshot directory');
  }
  let info;
  try {info=await lstat(file);}catch(error) {if(error.code==='ENOENT')return {needsFullCollection:true};throw error;}
  if(!info.isFile() || info.isSymbolicLink() || info.size>32_000_000)throw Error('Unsafe allowance snapshot');
  const original=await readFile(file,'utf8');
  const data=JSON.parse(original);
  if(!data || data.schema!==2 || typeof data.collectedAt!=='string' || !Number.isFinite(Date.parse(data.collectedAt)))throw Error('Invalid saved snapshot');
  const result={data,status:{state:'ok',mode:'allowances-only'}};
  data.quota=await readQuota();
  await sync(runtime,result,{enabled});
  const next=JSON.stringify(data);
  if(Buffer.byteLength(next)>32_000_000)throw Error('Allowance snapshot too large');
  // Detect unexpected external writers as well as respecting the caller lock.
  const current=await lstat(file);
  if(!current.isFile() || current.isSymbolicLink() || await readFile(file,'utf8')!==original)throw Error('Snapshot changed during allowance refresh');
  const temporary=path.join(folder,`.allowances-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary,next,{flag:'wx',mode:0o600});
    await rename(temporary,file);
  } finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return result;
}
