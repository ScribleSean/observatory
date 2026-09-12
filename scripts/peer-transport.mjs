import {execFile} from 'node:child_process';
import path from 'node:path';

const fields=['kind','hostAlias','remoteNode','remoteScript','remoteRuntime'];
function windowsPath(value) {
  return typeof value==='string' && value.length<=1024 && /^[A-Za-z]:[\\/]/.test(value) &&
    !/[\x00-\x1f\x7f]/.test(value) && !value.split(/[\\/]/).some(part=>part==='..' || part==='.') &&
    !value.slice(2).includes(':');
}
export function validatePeerTransport(value) {
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==fields.length ||
    Object.keys(value).some(key=>!fields.includes(key)) || value.kind!=='ssh-windows' ||
    typeof value.hostAlias!=='string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.hostAlias) ||
    !['remoteNode','remoteScript','remoteRuntime'].every(key=>windowsPath(value[key])) ||
    path.win32.basename(value.remoteNode).toLowerCase()!=='node.exe' ||
    path.win32.basename(value.remoteScript)!=='peer-exchange.mjs')throw Error('Invalid private SSH transport');
  return Object.fromEntries(fields.map(key=>[key,value[key]]));
}

function runSSH(args,input) {
  return new Promise((resolve,reject)=>{
    const child=execFile('/usr/bin/ssh',args,{timeout:30000,killSignal:'SIGKILL',maxBuffer:17_000_000},(error,stdout)=>{
      if(error)reject(Error('Private SSH exchange unavailable'));else resolve(stdout);
    });
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}

// Only the Mac initiates transport. Windows receives through its existing SSH
// account and updates its dashboard on its next independent collection cycle.
async function sshRequest(transport,request,endpoint,invoke,limit) {
  const safe=validatePeerTransport(transport);
  const script=endpoint==='setup'?path.win32.join(path.win32.dirname(safe.remoteScript),'peer-setup-endpoint.mjs'):
    endpoint==='quota'?path.win32.join(path.win32.dirname(safe.remoteScript),'quota-exchange.mjs'):safe.remoteScript;
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  const command=`& ${quote(safe.remoteNode)} ${quote(script)} ${quote(safe.remoteRuntime)}; exit $LASTEXITCODE`;
  const encoded=Buffer.from(command,'utf16le').toString('base64');
  const args=['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','PasswordAuthentication=no',
    '-o','KbdInteractiveAuthentication=no','-o','ConnectTimeout=8',safe.hostAlias,
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`];
  const input=JSON.stringify(request);
  if(Buffer.byteLength(input)>limit)throw Error('Private SSH request limit');
  const output=await invoke(args,input);
  if(typeof output!=='string' || Buffer.byteLength(output)>limit)throw Error('Private SSH response limit');
  return JSON.parse(output);
}

export async function sshPeerExchange(transport,record,invoke=runSSH) {
  const response=await sshRequest(transport,{version:1,record},'exchange',invoke,17_000_000);
  if(!response || typeof response!=='object' || Array.isArray(response) || response.version!==1 ||
    Object.keys(response).length!==2 || !Object.hasOwn(response,'record'))throw Error('Invalid private SSH response');
  return response.record; // The caller must validate and commit against saved peer identity.
}

export async function sshQuotaRequest(transport,request,invoke=runSSH) {
  const response=await sshRequest(transport,request,'quota',invoke,1_100_000);
  if(!response || Object.keys(response).length!==3 || response.version!==1 ||
    !['ready','disabled'].includes(response.status) || !Object.hasOwn(response,'record') ||
    ((request.action==='status' || response.status==='disabled') && response.record!==null) ||
    (request.action==='exchange' && response.status==='ready' && !response.record))throw Error('Invalid allowance response');
  return response;
}

export async function sshPeerSetup(transport,pairing,invoke=runSSH) {
  const response=await sshRequest(transport,{version:1,pairing},'setup',invoke,8192);
  if(!response || typeof response!=='object' || Array.isArray(response) || response.version!==1 ||
    Object.keys(response).length!==2 || response.status!=='ready')throw Error('Invalid private setup response');
  return response;
}

export async function sshPeerRepairReadiness(transport,invoke=runSSH) {
  const response=await sshRequest(transport,{version:1,action:'repair-readiness'},'setup',invoke,8192);
  if(!response || typeof response!=='object' || Array.isArray(response) || response.version!==1 ||
    Object.keys(response).length!==3 || response.status!=='repair-ready' ||
    typeof response.nonce!=='string' || !/^[a-f0-9]{64}$/.test(response.nonce))throw Error('Invalid repair readiness response');
  return response.nonce;
}
