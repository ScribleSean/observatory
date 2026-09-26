// Temporary, explicitly enabled test instrumentation. Never import from production.
import childProcess from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {promisify} from 'node:util';

const traceFile=process.env.OBSERVATORY_PAIRING_TRACE_FILE;
const origin=Number(process.env.OBSERVATORY_PAIRING_TRACE_ORIGIN);
if(!path.isAbsolute(traceFile??'') || !Number.isSafeInteger(origin) || origin<=0)
  throw Error('Explicit pairing timing configuration required');
const phases=['initial','repeat','corrupt','revoked'];
const childPhase=process.env.OBSERVATORY_PAIRING_TRACE_PHASE;
if(childPhase!==undefined && !phases.includes(childPhase))throw Error('Invalid pairing timing phase');
let launched=0;

const failure=error=>!error?'none':error.code==='ETIMEDOUT'?'timeout':
  error.killed || error.signal?'terminated':
  Number.isInteger(error.code) || Number.isInteger(error.status)?'exit':
  ['ENOENT','EACCES','ENOEXEC'].includes(error.code)?'launch':'error';
function start(label) {
  const began=performance.now();
  const emit=value=>appendFileSync(traceFile,JSON.stringify({label,...value})+'\n',{mode:0o600});
  emit({event:'start',atMs:Date.now()-origin});
  let ended=false;
  return error=>{
    if(ended)return;
    ended=true;
    emit({event:'end',atMs:Date.now()-origin,durationMs:Math.round((performance.now()-began)*10)/10,
      failure:failure(error)});
  };
}
const isACL=(file,args)=>typeof file==='string' && path.basename(file).toLowerCase()==='powershell.exe' &&
  Array.isArray(args) && args.some(value=>typeof value==='string' && path.basename(value)==='private-sync-acl.ps1');
const aclLabel=()=>childPhase?`child-${childPhase}-acl`:
  launched===0?'parent-setup-acl':`parent-after-${phases[Math.min(launched,4)-1]}-acl`;
const originalExecFile=childProcess.execFile;
const originalAsync=promisify(originalExecFile);
childProcess.execFile=function(file,args,...rest) {
  if(!isACL(file,args))return originalExecFile.call(this,file,args,...rest);
  const end=start(aclLabel()),callback=typeof rest.at(-1)==='function'?rest.pop():null;
  try {
    return originalExecFile.call(this,file,args,...rest,function(error,...output) {
      end(error);
      if(callback)callback.call(this,error,...output);
    });
  } catch(error) {end(error);throw error;}
};
// Keep Node's {stdout, stderr}, rejection and promise.child behavior intact.
childProcess.execFile[promisify.custom]=function(file,args,...rest) {
  if(!isACL(file,args))return originalAsync.call(this,file,args,...rest);
  const end=start(aclLabel());
  try {
    const pending=originalAsync.call(this,file,args,...rest);
    pending.then(()=>end(),error=>end(error));
    return pending;
  } catch(error) {end(error);throw error;}
};

const originalSync=childProcess.execFileSync;
childProcess.execFileSync=function(file,args,options) {
  if(file!==process.execPath || !Array.isArray(args) || args.length!==1 ||
    !['collect-mac.mjs','collect-windows.mjs'].includes(path.basename(args[0])))
    return originalSync.apply(this,arguments);
  const phase=phases[launched++];
  if(!phase)throw Error('Unexpected additional diagnostic collector call');
  const end=start(`collector-${phase}`);
  try {
    const output=originalSync.call(this,file,args,{...options,env:{...(options?.env??process.env),
      OBSERVATORY_PAIRING_TRACE_PHASE:phase}});
    end();return output;
  } catch(error) {end(error);throw error;}
};
syncBuiltinESMExports();
