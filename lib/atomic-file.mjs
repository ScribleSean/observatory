import {randomUUID} from 'node:crypto';
import {rename,unlink,writeFile} from 'node:fs/promises';
import path from 'node:path';

// Write a whole file or nothing: readers never see a half-written file.
export async function writeAtomic(file,text) {
  const temporary=path.join(path.dirname(file),`.${path.basename(file)}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary,text,{flag:'wx',mode:0o600,flush:true});
    await rename(temporary,file);
  } finally {
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}

export const writeJsonAtomic=(file,value)=>writeAtomic(file,JSON.stringify(value));
