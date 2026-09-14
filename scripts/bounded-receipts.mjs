import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readAgentReceipts} from './agent-receipts.mjs';

const worker=fileURLToPath(import.meta.url);
const unavailable=reason=>({agents:[],source:{status:'unavailable',checkedAt:new Date().toISOString(),skipped:0,limited:false,reason}});

// Directory opening can block inside the OS, where a Promise timeout cannot
// cancel it. Isolate this optional read so other sources can still be saved.
export function readBoundedReceipts(directory,{timeoutMs=15000,spawnProcess=spawn}={}) {
  if(typeof directory!=='string' || !path.isAbsolute(directory) || Buffer.byteLength(directory)>4096 ||
    /[\r\n\0]/.test(directory) || !Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>60000)
    throw Error('Invalid receipt read');
  return new Promise(resolve=>{
    let child,timer,settled=false,output='';
    const finish=(value,reason='worker-failed')=>{
      if(settled)return;
      settled=true;clearTimeout(timer);
      child?.stdin.destroy();child?.stdout.destroy();
      if(child && child.exitCode===null)child.kill('SIGKILL');
      child?.unref();
      resolve(value??unavailable(reason));
    };
    try {child=spawnProcess(process.execPath,[worker,'--worker'],{windowsHide:true,stdio:['pipe','pipe','ignore']});}
    catch {finish(null,'worker-start-failed');return;}
    timer=setTimeout(()=>finish(null,'read-timeout'),timeoutMs);
    child.on('error',()=>finish(null,'worker-start-failed'));
    child.stdin.on('error',()=>finish(null,'worker-input-failed'));
    child.stdout.on('error',()=>finish(null,'worker-output-failed'));
    child.stdout.on('data',bytes=>{
      output+=bytes;
      if(Buffer.byteLength(output)>1_000_000)finish(null,'worker-output-limit');
    });
    child.on('close',code=>{
      if(code!==0){finish();return;}
      try {
        const value=JSON.parse(output);
        if(!Array.isArray(value.agents) || value.agents.length>128 ||
          !['ok','partial','unavailable'].includes(value.source?.status))throw Error('Invalid receipt result');
        finish(value);
      } catch {finish(null,'worker-invalid-output');}
    });
    child.stdin.end(JSON.stringify(directory));
  });
}

if(process.argv[1]===worker && process.argv[2]==='--worker') {
  let input='';
  for await(const chunk of process.stdin) {
    input+=chunk;
    if(Buffer.byteLength(input)>8192)throw Error('Receipt input limit');
  }
  const directory=JSON.parse(input);
  if(typeof directory!=='string' || !path.isAbsolute(directory))throw Error('Invalid receipt directory');
  process.stdout.write(JSON.stringify(await readAgentReceipts(directory)));
}
