import {randomUUID} from 'node:crypto';
import {rename,unlink,writeFile} from 'node:fs/promises';
import path from 'node:path';

// Write a whole file or nothing: readers never see a half-written file.
export async function writeAtomic(file,text) {
  const temporary=path.join(path.dirname(file),`.${path.basename(file)}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary,text,{flag:'wx',mode:0o600,flush:true});
    // On Windows a reader, antivirus or the indexer can hold the target open for a moment.
    for(let attempt=0;;attempt++) {
      try {await rename(temporary,file);break;}
      catch(error) {
        if(attempt>=8 || !['EPERM','EACCES','EBUSY'].includes(error.code))throw error;
        await new Promise(resolve=>setTimeout(resolve,50*2**Math.min(attempt,5)));
      }
    }
  } finally {
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}

export const writeJsonAtomic=(file,value)=>writeAtomic(file,JSON.stringify(value));
