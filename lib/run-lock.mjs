import {open,readFile,unlink,stat} from 'node:fs/promises';

// One run at a time per computer. A lock older than the stale age, or one whose
// process has gone, is taken over.
const alive=pid=>{try {process.kill(pid,0);return true;}catch(error) {return error.code==='EPERM';}};

export async function withRunLock(file,action,{staleMs=10*60000,now=Date.now}={}) {
  let handle;
  for(let attempt=0;attempt<2 && !handle;attempt++) {
    try {handle=await open(file,'wx',0o600);}
    catch(error) {
      if(error.code!=='EEXIST')throw error;
      let owner=null;
      try {owner=JSON.parse(await readFile(file,'utf8'));}catch {}
      const age=now()-(await stat(file).then(info=>info.mtimeMs,()=>now()));
      if(owner && Number.isInteger(owner.pid) && alive(owner.pid) && age<staleMs)return {busy:true};
      await unlink(file).catch(()=>{});
    }
  }
  if(!handle)return {busy:true};
  try {
    await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date(now()).toISOString()}));
    await handle.close();handle=null;
    return {busy:false,value:await action()};
  } finally {
    await handle?.close().catch(()=>{});
    await unlink(file).catch(()=>{});
  }
}
