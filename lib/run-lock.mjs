import {link,readFile,rename,stat,unlink,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

// One run at a time per computer.
// - The lock is created whole with link(), which fails if the name exists, so it is never seen empty.
// - Each lock carries a random token. Release deletes the lock only while it still holds ours.
// - A stale lock (its process gone, or older than the stale age) is taken over by moving it
//   aside first and checking the moved file is the one judged stale. If another process got
//   there first, its fresh lock is put back and this run reports busy.
const alive=pid=>{try {process.kill(pid,0);return true;}catch(error) {return error.code==='EPERM';}};
const FRESH_MS=30000;
const read=file=>readFile(file,'utf8').catch(()=>null);

async function claim(file,now) {
  const token=randomUUID();
  const temporary=`${file}.${token}.tmp`;
  await writeFile(temporary,JSON.stringify({pid:process.pid,token,startedAt:new Date(now()).toISOString()}),{mode:0o600});
  try {await link(temporary,file);return token;}
  catch(error) {if(['EEXIST','EPERM'].includes(error.code))return null;throw error;}
  finally {await unlink(temporary).catch(()=>{});}
}

// The lock's text if it is stale, otherwise null.
async function staleText(file,staleMs,now) {
  let info;
  try {info=await stat(file);}catch {return null;}
  const text=await read(file);
  if(text===null)return null;
  const age=now()-info.mtimeMs;
  if(age>=staleMs)return text;
  let owner=null;
  try {owner=JSON.parse(text);}catch {}
  // An unreadable lock that is still young belongs to someone. Leave it.
  if(!owner || !Number.isInteger(owner.pid))return age>=FRESH_MS?text:null;
  return alive(owner.pid)?null:text;
}

async function takeOver(file,judged,now) {
  const aside=`${file}.${randomUUID()}.stale`;
  try {await rename(file,aside);}catch {return null;}
  const moved=await read(aside);
  if(moved!==judged) {
    // Someone else's fresh lock: put it back if the name is still free.
    await link(aside,file).catch(()=>{});
    await unlink(aside).catch(()=>{});
    return null;
  }
  await unlink(aside).catch(()=>{});
  return claim(file,now);
}

async function release(file,token) {
  const text=await read(file);
  let owner=null;
  try {owner=JSON.parse(text);}catch {}
  if(owner?.token===token)await unlink(file).catch(()=>{});
}

export async function withRunLock(file,action,{staleMs=10*60000,now=Date.now}={}) {
  let token=await claim(file,now);
  if(!token) {
    const judged=await staleText(file,staleMs,now);
    if(judged!==null)token=await takeOver(file,judged,now);
  }
  if(!token)return {busy:true};
  try {return {busy:false,value:await action()};}
  finally {await release(file,token);}
}
