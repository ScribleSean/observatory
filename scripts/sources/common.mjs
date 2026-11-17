import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {readLines} from './jsonl.mjs';
export {cleanTitle} from './pure.mjs';

export const MAX_FILES=20000;
export class Deadline extends Error {constructor() {super('Ledger read ran out of time');this.reason='slow';}}

// Files under root whose name matches, written at or after `since`. Links are not followed. Only those
// count toward maxFiles, so years of old transcripts never stop a read. Older matches go to `older`
// when it is given.
export async function walkFiles(root,{since=0,match=()=>true,maxFiles=MAX_FILES,older=null}={}) {
  const found=[];
  const walk=async folder=>{
    let entries;
    try {entries=await fs.readdir(folder,{withFileTypes:true});}
    catch(error) {if(['ENOENT','ENOTDIR'].includes(error.code))return;throw error;}
    for(const entry of entries) {
      const full=path.join(folder,entry.name);
      if(entry.isSymbolicLink())continue;
      if(entry.isDirectory()) {await walk(full);continue;}
      if(!entry.isFile() || !match(entry.name))continue;
      let info;
      try {info=await fs.stat(full);}
      catch(error) {if(error.code==='ENOENT')continue;throw error;}
      if(info.mtimeMs<since) {older?.push({file:full,info:{size:info.size,mtimeMs:info.mtimeMs,ino:info.ino}});continue;}
      found.push({file:full,info:{size:info.size,mtimeMs:info.mtimeMs,ino:info.ino}});
      if(found.length>maxFiles)throw Error('Too many transcript files');
    }
  };
  await walk(root);
  return found.sort((a,b)=>a.file.localeCompare(b.file));
}

// Runs work over items a few at a time. Once the deadline passes no new item starts, and the
// call throws Deadline after the running ones finish, so whatever was read is still cached.
export async function eachLimited(items,limit,deadline,work) {
  let next=0,late=false;
  const worker=async()=>{
    while(next<items.length) {
      if(Date.now()>deadline) {late=true;return;}
      await work(items[next++]);
    }
  };
  await Promise.all(Array.from({length:Math.max(1,Math.min(limit,items.length))},worker));
  if(late)throw new Deadline();
}

const MARK_BYTES=4096;
// A file that has not changed for this long is finished for now, so its last line is read even
// without a newline.
export const QUIET_MS=5000;

// What was already read, fingerprinted: the first 4 KB and the 4 KB before `offset`. A file that only
// grew keeps both. One that was rewritten (a resumed or forked session that starts the same way, or
// a copy put in its place) almost never does, so it is read again from the start instead of resumed.
async function markOf(file,offset) {
  let handle;
  try {
    handle=await fs.open(file,'r');
    const hash=createHash('sha1');
    for(const start of [0,Math.max(0,offset-MARK_BYTES)]) {
      const length=Math.min(MARK_BYTES,offset-start);
      const buffer=Buffer.alloc(Math.max(0,length));
      const {bytesRead}=length>0?await handle.read(buffer,0,length,start):{bytesRead:0};
      hash.update(buffer.subarray(0,bytesRead)).update('|');
    }
    return hash.digest('hex').slice(0,16);
  } catch {return null;}
  finally {await handle?.close();}
}

// Reads one transcript through the parse cache: unchanged files are not opened, grown files are read
// from where the last read stopped once the part already read is the same, anything else from the start.
export async function parseWithCache(file,info,{cache,fresh,keep,each,big=null,now=Date.now()}) {
  const saved=cache.lookup(file,info);
  if(saved?.unchanged)return saved.state;
  const resume=saved && saved.mark && saved.mark===await markOf(file,saved.offset)?saved:null;
  const state=resume?.state ?? fresh();
  const final=now-info.mtimeMs>=QUIET_MS;
  const {offset}=await readLines(file,{offset:resume?.offset ?? 0,keep,final,big:big && (text=>big(state,text))},event=>each(state,event));
  cache.store(file,{...info,offset,state,mark:await markOf(file,offset)});
  return state;
}
