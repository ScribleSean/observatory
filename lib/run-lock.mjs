import {link,readFile,rename,stat,unlink,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

// One run at a time per computer. The lock file is created whole with link(),
// which fails if the name exists, so it is never seen empty. A lock whose
// process has gone, or one older than the stale age, is taken over by first
// renaming it to a unique name, so two takers cannot both win.
const alive=pid=>{try {process.kill(pid,0);return true;}catch(error) {return error.code==='EPERM';}};
const FRESH_MS=30000;

async function claim(file,now) {
  const temporary=`${file}.${randomUUID()}.tmp`;
  await writeFile(temporary,JSON.stringify({pid:process.pid,startedAt:new Date(now()).toISOString()}),{mode:0o600});
  try {await link(temporary,file);return true;}
  catch(error) {if(['EEXIST','EPERM'].includes(error.code))return false;throw error;}
  finally {await unlink(temporary).catch(()=>{});}
}

async function stale(file,staleMs,now) {
  let info;
  try {info=await stat(file);}catch {return true;}
  const age=now()-info.mtimeMs;
  if(age>=staleMs)return true;
  let owner=null;
  try {owner=JSON.parse(await readFile(file,'utf8'));}catch {}
  // An unreadable lock that is still young belongs to someone. Leave it.
  if(!owner || !Number.isInteger(owner.pid))return age>=FRESH_MS;
  return !alive(owner.pid);
}

export async function withRunLock(file,action,{staleMs=10*60000,now=Date.now}={}) {
  let held=await claim(file,now);
  if(!held && await stale(file,staleMs,now)) {
    const aside=`${file}.${randomUUID()}.stale`;
    try {await rename(file,aside);await unlink(aside).catch(()=>{});held=await claim(file,now);}
    catch {held=false;}
  }
  if(!held)return {busy:true};
  try {return {busy:false,value:await action()};}
  finally {await unlink(file).catch(()=>{});}
}
