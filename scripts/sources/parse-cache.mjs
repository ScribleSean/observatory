// What the ledger adapters already read, so a collection re-reads only files that changed. An entry is
// keyed by the file's path and holds its size, modification time, file id (inode), the byte offset read
// up to, a fingerprint of what was read (scripts/sources/common.mjs) and the adapter's state for the file
// at that offset. A file with the same size, time and id is not opened. One that grew (transcripts are
// append-only) is read from the offset when the fingerprint still matches. Anything else is read again
// from the start. The cache lives in the private data folder, which only this user can read.
import {readFile} from 'node:fs/promises';
import {writeJsonAtomic} from '../../lib/atomic-file.mjs';

const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);

export function parseCache(raw,version) {
  const files=new Map(),extra=new Map(),touched=new Set(),used=new Set();
  if(object(raw) && raw.version===version && object(raw.files)) {
    for(const [file,entry] of Object.entries(raw.files))
      if(object(entry) && Number.isSafeInteger(entry.size) && typeof entry.mtimeMs==='number' && Number.isSafeInteger(entry.offset))files.set(file,entry);
    if(object(raw.extra))for(const [key,value] of Object.entries(raw.extra))extra.set(key,value);
  }
  let hits=0,resumed=0,read=0;
  return {
    // The saved state for a file, how it may be used, or null to read it from the start.
    lookup(file,{size,mtimeMs,ino}) {
      touched.add(file);
      const entry=files.get(file);
      if(!entry)return null;
      // A different file id is a different file, whatever its size and time.
      if(entry.ino!==undefined && entry.ino!==null && ino!==undefined && entry.ino!==ino)return null;
      if(entry.size===size && entry.mtimeMs===mtimeMs) {hits++;return {state:entry.state,offset:entry.offset,unchanged:true};}
      if(size>=entry.size && mtimeMs>=entry.mtimeMs && entry.offset<=size) {resumed++;return {state:entry.state,offset:entry.offset,mark:entry.mark ?? null,unchanged:false};}
      return null;
    },
    store(file,{size,mtimeMs,ino=null,offset,state,mark=null}) {
      touched.add(file);
      read++;
      files.set(file,{size,mtimeMs,ino,offset,state,mark});
    },
    get:key=>{used.add(key);return extra.get(key);},
    set:(key,value)=>{used.add(key);extra.set(key,value);},
    stats:()=>({hits,resumed,read}),
    // Only files seen in this collection are kept, so entries for deleted or old files fall away.
    toJSON:()=>({version,files:Object.fromEntries([...files].filter(([file])=>touched.has(file))),
      extra:Object.fromEntries([...extra].filter(([key])=>used.has(key)))}),
  };
}

export async function openParseCache(file,version) {
  let raw=null;
  if(file)try {raw=JSON.parse(await readFile(file,'utf8'));} catch {raw=null;}
  const cache=parseCache(raw,version);
  return {...cache,save:async()=>{if(file)await writeJsonAtomic(file,cache.toJSON());}};
}

// An in-memory cache for tests and one-off reads.
export const memoryCache=(version=1)=>({...parseCache(null,version),save:async()=>{}});
