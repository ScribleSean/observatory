import {execFile} from 'node:child_process';
import {access} from 'node:fs/promises';
import {constants,realpathSync} from 'node:fs';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const execute=promisify(execFile);
const limit=1024*1024;
const result=status=>({version:1,status,peerReachability:'not-checked'});

// Never return authentication URLs, account identities, addresses or peer lists.
export function summarizeTailscale(raw) {
  if(typeof raw!=='string' || Buffer.byteLength(raw)>limit)return result('unavailable');
  let data;
  try {data=JSON.parse(raw);}catch{return result('unavailable');}
  if(!data || typeof data!=='object' || Array.isArray(data) || typeof data.BackendState!=='string')return result('unavailable');
  const states={NeedsLogin:'needs-login',NeedsMachineAuth:'needs-device-approval',Stopped:'stopped',Starting:'starting',NoState:'starting',InUseOtherUser:'other-user'};
  if(data.BackendState==='Running')return result(data.Self?.Online===true?'running':data.Self?.Online===false?'offline':'unavailable');
  return result(Object.hasOwn(states,data.BackendState)?states[data.BackendState]:'unavailable');
}

export function tailscaleCandidates(platform=process.platform,programFiles=process.env.ProgramFiles) {
  if(platform==='darwin')return ['/Applications/Tailscale.app/Contents/MacOS/Tailscale','/opt/homebrew/bin/tailscale','/usr/local/bin/tailscale'];
  if(platform==='win32') {
    const root=programFiles??'C:\\Program Files';
    if(!/^[A-Za-z]:[\\/]/.test(root) || /[\x00-\x1f]/.test(root))return [];
    return [path.win32.join(root,'Tailscale','tailscale.exe')];
  }
  return [];
}

export async function inspectTailscale({platform=process.platform,programFiles=process.env.ProgramFiles,
  available=async file=>{await access(file,constants.X_OK);},run=execute}={}) {
  if(!['darwin','win32'].includes(platform))return result('unsupported');
  const candidates=tailscaleCandidates(platform,programFiles);
  if(!candidates.length)return result('unavailable');
  for(const candidate of candidates) {
    try {await available(candidate);}catch(error){
      if(error.code==='ENOENT' || error.code==='ENOTDIR')continue;
      return result('unavailable');
    }
    try {
      const {stdout}=await run(candidate,['status','--json','--peers=false'],
        {timeout:8000,maxBuffer:limit,killSignal:'SIGKILL',windowsHide:true,encoding:'utf8'});
      return summarizeTailscale(stdout);
    }catch{return result('unavailable');}
  }
  return result('not-installed');
}

if(process.argv[1] && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) {
  if(process.argv.length!==2){process.stderr.write('This check takes no arguments.\n');process.exitCode=1;}
  else inspectTailscale().then(value=>process.stdout.write(JSON.stringify(value)+'\n'))
    .catch(()=>{process.stderr.write('Tailscale status unavailable.\n');process.exitCode=1;});
}
