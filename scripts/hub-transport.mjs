// The hub reads one file from a spoke and writes one file back, over the
// SSH alias the user already set up. No Node is needed on the remote side.
// Files travel as base64 so console code pages cannot change the bytes.
import {execFile} from 'node:child_process';

export const MAX_FILE_BYTES=16_000_000;
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

export function pushCommand(spoke) {
  if(spoke.platform==='windows') return encoded([
    "$ErrorActionPreference='Stop'",
    `$d=Join-Path ${windowsFolder(spoke)} 'public\\local'`,
    'New-Item -ItemType Directory -Force -Path $d | Out-Null',
    '$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())',
    "$t=Join-Path $d ('.combined-'+[guid]::NewGuid().ToString()+'.tmp')",
    "$f=Join-Path $d 'combined.json'",
    '[IO.File]::WriteAllBytes($t,$b)',
    'if(Test-Path -LiteralPath $f){[IO.File]::Replace($t,$f,[NullString]::Value)}else{[IO.File]::Move($t,$f)}',
  ].join('; '));
  return `d=${macFolder(spoke)}/public/local; mkdir -p "$d" && t="$d/.combined-$$.tmp" && base64 -D > "$t" && mv -f "$t" "$d/combined.json"`;
}

export function runSSH(alias,command,input='') {
  const ssh=process.platform==='win32'?'ssh.exe':'/usr/bin/ssh';
  return new Promise((resolve,reject)=>{
    const child=execFile(ssh,[...SSH_OPTIONS,alias,command],{timeout:30000,killSignal:'SIGKILL',
      maxBuffer:Math.ceil(MAX_FILE_BYTES*4/3)+1024,windowsHide:true},(error,stdout)=>{
      if(error)reject(Object.assign(Error(error.killed?'timed out':'unreachable'),{code:error.code}));
      else resolve(stdout);
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(input);
  });
}

// The transport the hub uses. Tests pass a fake with the same two methods.
export function sshTransport(invoke=runSSH) {
  return {
    async pull(spoke) {
      const output=await invoke(spoke.ssh,pullCommand(spoke));
      const bytes=Buffer.from(String(output).trim(),'base64');
      if(!bytes.length || bytes.length>MAX_FILE_BYTES)throw Error('no snapshot');
      return bytes.toString('utf8');
    },
    async push(spoke,text) {
      if(Buffer.byteLength(text)>MAX_FILE_BYTES)throw Error('combined file too large');
      await invoke(spoke.ssh,pushCommand(spoke),Buffer.from(text).toString('base64'));
    },
  };
}
