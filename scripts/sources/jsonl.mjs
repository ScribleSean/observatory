// Reads the complete lines of an append-only JSONL file from a byte offset. A line still being
// written (no newline yet) is left for the next read, so the returned offset is always the end of a
// whole line and a later read can resume there. With `final`, for a file that has stopped changing,
// a last line without a newline is read too when it is a whole JSON object.
import fs from 'node:fs/promises';

const CHUNK=4*1024*1024;
const NEWLINE=0x0a;
const EDGE=64*1024;
export const MAX_LINE_BYTES=16*1024*1024;

const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);

// keep: markers as strings. A line is parsed only when it holds one of them, which skips the large
// attachment and request lines without decoding them. A line over maxLineBytes is never parsed:
// big(text) gets its first and last 64 KB instead.
export async function readLines(file,{offset=0,keep=[],maxLineBytes=MAX_LINE_BYTES,big=null,final=false}={},each) {
  const markers=keep.map(text=>Buffer.from(text));
  const wanted=line=>!markers.length || markers.some(marker=>line.indexOf(marker)>=0);
  let handle;
  try {handle=await fs.open(file,'r');}
  catch(error) {if(error.code==='ENOENT')return {offset,size:0,missing:true};throw error;}
  try {
    const {size}=await handle.stat();
    if(size<offset)return {offset:0,size,shrunk:true};
    const finish=line=>{
      if(!wanted(line))return;
      let event;
      try {event=JSON.parse(line.toString('utf8'));} catch {return;}
      if(object(event))each(event);
    };
    const buffer=Buffer.allocUnsafe(CHUNK);
    // readAt: where the next chunk starts. done: the end of the last whole line handled.
    // parts: the start of a line that crosses a chunk edge. head: set while skipping a line too long to parse.
    let readAt=offset,done=offset,parts=[],partBytes=0,head=null;
    while(readAt<size) {
      const chunkStart=readAt;
      const {bytesRead}=await handle.read(buffer,0,Math.min(CHUNK,size-readAt),readAt);
      if(!bytesRead)break;
      readAt+=bytesRead;
      let start=0;
      for(;;) {
        const end=buffer.indexOf(NEWLINE,start);
        if(end<0 || end>=bytesRead)break;
        const piece=buffer.subarray(start,end);
        if(head!==null) {
          if(big)big(head+Buffer.concat([...parts,piece]).subarray(-EDGE).toString('utf8'));
          head=null;
        } else finish(parts.length?Buffer.concat([...parts,piece]):piece);
        parts=[];partBytes=0;
        done=chunkStart+end+1;
        start=end+1;
      }
      if(start<bytesRead) {
        const rest=Buffer.from(buffer.subarray(start,bytesRead));
        if(head===null) {
          parts.push(rest);partBytes+=rest.length;
          if(partBytes>maxLineBytes) {head=Buffer.concat(parts).subarray(0,EDGE).toString('utf8');parts=[];}
        } else parts=[Buffer.concat([...parts,rest]).subarray(-EDGE)];
      }
    }
    if(final && head===null && parts.length && readAt===size) {
      const line=Buffer.concat(parts);
      let event=null;
      try {event=JSON.parse(line.toString('utf8'));} catch {}
      if(object(event)) {
        if(wanted(line))each(event);
        done=size;
      }
    }
    return {offset:done,size};
  } finally {await handle.close();}
}
