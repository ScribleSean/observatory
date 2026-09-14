import {constants} from 'node:fs';
import {open,opendir,lstat} from 'node:fs/promises';
import path from 'node:path';
const numeric = n => typeof n==='number' && Number.isFinite(n) && n>=0 ? n : null;
const valid = v => v && typeof v==='object' && !Array.isArray(v) && typeof v.conversationId==='string' && v.conversationId.length>0 && v.conversationId.length<=256;

export function cleanReceipts(rows) {
  const latest=new Map();
  // Continued conversations report cumulative snapshots, not additive requests.
  for(const row of rows) {
    if(!valid(row.value) || !Number.isFinite(row.modified) || !Number.isFinite(new Date(row.modified).getTime())) continue;
    const prior=latest.get(row.value.conversationId);
    if(!prior || row.modified>prior.modified || (row.modified===prior.modified && String(row.name||'')>String(prior.name||''))) latest.set(row.value.conversationId,row);
  }
  return [...latest.values()].sort((a,b)=>b.modified-a.modified || String(a.name||'').localeCompare(String(b.name||''))).map(({value:v,modified},i)=>({
    id:`review-${i+1}`,
    model:typeof v.requestedModel==='string' && /^[a-zA-Z0-9._-]{1,100}$/.test(v.requestedModel)?v.requestedModel:'unknown',
    role:['Coordinator','Subagent','Unknown'].includes(v.role)?v.role:v.isSubagent===true?'Subagent':'Unknown',
    status:v.status==='SUCCESS'?'completed':'failed',
    failure:v.status!=='SUCCESS' && typeof v.error==='string' && /timeout/i.test(v.error)?'Response timed out. Cause not established.':null,
    seconds:numeric(v.elapsedSeconds),recordedAt:new Date(modified).toISOString(),
    ...Object.fromEntries([['input','input_tokens'],['output','output_tokens'],['cache','cache_read_tokens'],['total','total_tokens']].map(([to,from])=>[to,v.status==='SUCCESS'?numeric(v.usage?.[from]):null])),
  }));
}

export async function readAgentReceipts(directory) {
  const rows=[];
  let scanned=0,matched=0,skipped=0,bytes=0,limited=false;
  try {
    const info=await lstat(directory);
    if(!info.isDirectory() || info.isSymbolicLink()) {
      return {agents:[],source:{status:'unavailable',checkedAt:new Date().toISOString(),skipped,limited,reason:'unsafe-directory'}};
    }
    const entries=await opendir(directory);
    for await(const entry of entries) {
      if(++scanned>10000){limited=true;break;}
      if(!entry.name.endsWith('.usage.json')) continue;
      if(++matched>128){limited=true;break;}
      if(!entry.isFile() || entry.isSymbolicLink()){skipped++;continue;}
      let file;
      try {
        file=await open(path.join(directory,entry.name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
        const before=await file.stat();
        if(!before.isFile() || before.size>1024*1024){skipped++;continue;}
        if(bytes+before.size>8*1024*1024){limited=true;break;}
        // Read at most the validated size plus one byte, even if the file grows.
        const buffer=Buffer.alloc(before.size+1);
        const {bytesRead}=await file.read(buffer,0,buffer.length,0);
        const after=await file.stat();
        bytes+=bytesRead;
        if(bytesRead!==before.size || after.size!==before.size || after.mtimeMs!==before.mtimeMs){skipped++;continue;}
        const value=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));
        if(!valid(value)){skipped++;continue;}
        rows.push({value,modified:before.mtimeMs,name:entry.name});
      } catch {skipped++;} finally {await file?.close();}
    }
  } catch(error) {
    // Emit only fixed diagnostic categories. Never persist OS error messages,
    // receipt names, configured paths or other private filesystem details.
    const reason=['EACCES','EPERM'].includes(error?.code)?'access-denied':
      error?.code==='ENOENT'?'directory-missing':'directory-read-failed';
    return {agents:cleanReceipts(rows),source:{status:rows.length?'partial':'unavailable',checkedAt:new Date().toISOString(),skipped,limited,reason}};
  }
  return {agents:cleanReceipts(rows),source:{status:skipped||limited?'partial':'ok',checkedAt:new Date().toISOString(),skipped,limited}};
}
