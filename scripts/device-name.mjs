import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import path from 'node:path';

export async function readDeviceName(runtime) {
  let file;
  try {
    const target=path.join(runtime,'device.json'),before=await lstat(target);
    if(!before.isFile() || before.isSymbolicLink() || before.size>1024)return null;
    file=await open(target,constants.O_RDONLY | (constants.O_NOFOLLOW??0) | constants.O_NONBLOCK);
    const info=await file.stat();
    if(!info.isFile() || info.dev!==before.dev || info.ino!==before.ino || info.size>1024)return null;
    const buffer=Buffer.alloc(1025),{bytesRead}=await file.read(buffer,0,1025,0);
    if(bytesRead>1024)return null;
    const value=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));
    if(!value || Array.isArray(value) || typeof value!=='object' || Object.keys(value).length!==1 || typeof value.name!=='string')return null;
    const name=value.name.replace(/^[\s\u0085]+|[\s\u0085]+$/gu,'');
    if(!name || name.length>32 || /[\p{Cc}\p{Cf}\p{Cs}/\\:]/u.test(name))return null;
    return name;
  } catch {return null;}
  finally {if(file)await file.close().catch(()=>{});}
}

export function attachDeviceName(data,host,name) {
  delete data.deviceNames;
  if(typeof name==='string' && ['Mac','Windows'].includes(host))data.deviceNames={[host]:name};
}
