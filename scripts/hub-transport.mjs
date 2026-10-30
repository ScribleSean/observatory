// Pulls travel as base64 on standard output so console code pages cannot change the bytes.
// Pushes travel by scp: Windows OpenSSH can stall input piped into PowerShell, so nothing is piped.
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from '../lib/cycle-processes.mjs';

export const MAX_FILE_BYTES=16_000_000;
// The copy lands in the remote home folder first, where scp needs no path for either platform.
// Each push has its own name, so an overrunning earlier swap cannot move or delete a newer copy.
export const stagedName=(id=randomUUID())=>`.observatory-combined.${id}.incoming`;
const checkStaged=name=>{if(!/^\.observatory-combined\.[0-9a-f-]{36}\.incoming$/.test(name))throw Error('bad staging name');return name;};
const SSH_OPTIONS=['-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes',
  '-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no','-o','ForwardAgent=no','-o','ForwardX11=no',
  '-o','ClearAllForwardings=yes','-o','ControlMaster=no','-o','ControlPath=none'];

const powerShellQuote=value=>"'"+value.replace(/['‘-‛]/g,c=>c+c)+"'";
const shellQuote=value=>"'"+value.replace(/'/g,"'\\''")+"'";

function windowsFolder(spoke) {
  return spoke.dataFolder?powerShellQuote(spoke.dataFolder):"(Join-Path $env:LOCALAPPDATA 'Observatory')";
}
function macFolder(spoke) {
  return spoke.dataFolder?shellQuote(spoke.dataFolder):'"$HOME/Library/Application Support/Observatory"';
}

const encoded=script=>`powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script,'utf16le').toString('base64')}`;

export function pullCommand(spoke) {
  if(spoke.platform==='windows') return encoded([
    "$ErrorActionPreference='Stop'",
    `$f=Join-Path ${windowsFolder(spoke)} 'public\\local\\usage.json'`,
    `if((Get-Item -LiteralPath $f).Length -gt ${MAX_FILE_BYTES}){exit 3}`,
    '[Console]::Out.Write([Convert]::ToBase64String([IO.File]::ReadAllBytes($f)))',
  ].join('; '));
  return `f=${macFolder(spoke)}/public/local/usage.json; test "$(wc -c < "$f")" -le ${MAX_FILE_BYTES} && base64 < "$f"`;
}

// The expected size is checked before
// replacing, so a cut-off or empty copy changes nothing.
export function pushCommand(spoke,bytes,name) {
  if(!Number.isSafeInteger(bytes) || bytes<1)throw Error('combined file is empty');
  checkStaged(name);
  if(spoke.platform==='windows') return encoded([
    "$ErrorActionPreference='Stop'",
    `$s=Join-Path $HOME '${name}'`,
    `if((Get-Item -LiteralPath $s).Length -ne ${bytes}){Remove-Item -LiteralPath $s -Force; exit 4}`,
    `$d=Join-Path ${windowsFolder(spoke)} 'public\\local'`,
    'New-Item -ItemType Directory -Force -Path $d | Out-Null',
    // The last step also uses this push's own name, so overlapping swaps never share a file.
    `$t=Join-Path $d '${name}'`,
    "$f=Join-Path $d 'combined.incoming.json'",
    'Move-Item -LiteralPath $s -Destination $t -Force',
    // A reader can hold the file for a moment, so retry the replace briefly.
    'for($i=0;$i -lt 8;$i++){try{if(Test-Path -LiteralPath $f){[IO.File]::Replace($t,$f,[NullString]::Value)}else{[IO.File]::Move($t,$f)};break}catch{if($i -eq 7){throw};Start-Sleep -Milliseconds (100*($i+1))}}',
  ].join('; '));
  return `s="$HOME/${name}"; d=${macFolder(spoke)}/public/local; test "$(wc -c < "$s")" -eq ${bytes} || { rm -f "$s"; exit 4; }; mkdir -p "$d" && mv -f "$s" "$d/${name}" && mv -f "$d/${name}" "$d/combined.incoming.json"`;
}

function run(program,args) {
  return new Promise((resolve,reject)=>{
    const child=execFile(program,args,{timeout:30000,killSignal:'SIGKILL',
      maxBuffer:Math.ceil(MAX_FILE_BYTES*4/3)+1024,windowsHide:true},(error,stdout)=>{
      if(error)reject(Object.assign(Error(error.killed?'timed out':'unreachable'),{code:error.code}));
      else resolve(stdout);
    });
    child.stdin.on('error',()=>{});
    child.stdin.end();
  });
}

export function runSSH(alias,command) {
  return run(process.platform==='win32'?'ssh.exe':'/usr/bin/ssh',[...SSH_OPTIONS,alias,command]);
}

export function runSCP(alias,file,name) {
  return run(process.platform==='win32'?'scp.exe':'/usr/bin/scp',[...SSH_OPTIONS,'-q',file,`${alias}:${checkStaged(name)}`]);
}

export function discardCommand(spoke,name) {
  checkStaged(name);
  return spoke.platform==='windows'?encoded(`Remove-Item -LiteralPath (Join-Path $HOME '${name}') -Force -ErrorAction SilentlyContinue`):`rm -f "$HOME/${name}"`;
}

export function sshTransport(invoke=runSSH,copy=runSCP) {
  return {
    async pull(spoke) {
      const output=await invoke(spoke.ssh,pullCommand(spoke));
      const bytes=Buffer.from(String(output).trim(),'base64');
      if(!bytes.length || bytes.length>MAX_FILE_BYTES)throw Error('no snapshot');
      return bytes.toString('utf8');
    },
    async push(spoke,text) {
      if(Buffer.byteLength(text)>MAX_FILE_BYTES)throw Error('combined file too large');
      const bytes=Buffer.from(text);
      const name=stagedName();
      const folder=await mkdtemp(path.join(tmpdir(),'observatory-push-'));
      try {
        const file=path.join(folder,'combined.json');
        await writeFile(file,bytes,{mode:0o600});
        await copy(spoke.ssh,file,name);
        await invoke(spoke.ssh,pushCommand(spoke,bytes.length,name));
      } catch(error) {
        // Best effort: a copy that was not swapped in should not stay in the remote home.
        await invoke(spoke.ssh,discardCommand(spoke,name)).catch(()=>{});
        throw error;
      } finally {await rm(folder,{recursive:true,force:true});}
    },
  };
}
