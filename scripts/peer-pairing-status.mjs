import {constants,realpathSync} from 'node:fs';
import {lstat,open,readdir,realpath,rename,unlink} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateSyncDirectory} from './peer-directory.mjs';
import {readPairing} from './peer-pairing.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {assertPeerNotRevoked} from './peer-revocation.mjs';
import {readPeerTrust} from './peer-tls-trust.mjs';
import {readPeerState} from './peer-store.mjs';

const result=state=>({version:1,state});
const states=['unpaired','revoked','establishing-trust','active-sync','sync-stale','unavailable'];
const filename='pairing-status.json',limit=1024;
const fail=()=>Error('Pairing status unavailable');

export async function readPairingStatus(runtime,now=Date.now()) {
  try {
    let directory;
    try {directory=await privateSyncDirectory(runtime);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(directory) {
      try {await assertPeerNotRevoked(directory);}
      catch {await lstat(path.join(directory,'revoked'));return result('revoked');}
    }
    const pairing=await readPairing(runtime);
    if(!pairing)return result(!directory || !(await readdir(directory)).length?'unpaired':'unavailable');
    if(pairing.transport?.kind==='tls' && !await readPeerTrust(runtime))return result('establishing-trust');
    const record=await readPeerState(runtime,pairing.peer,now);
    if(!record)return result('establishing-trust');
    const age=now-Date.parse(record.revision.collectedAt);
    return result(age>=-60000 && age<=600000?'active-sync':'sync-stale');
  } catch {return result('unavailable');}
}

function guard(info) {
  if(!info.isFile() || info.isSymbolicLink() || info.nlink!==1 || info.size>limit ||
    (process.platform!=='win32' && ((info.mode&0o077) || info.uid!==process.getuid())))throw fail();
  return info;
}
const same=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs','mode','nlink','uid'].every(key=>a[key]===b[key]);
async function targetInfo(name) {
  try {return guard(await lstat(name));}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function readFileValue(name) {
  const before=await targetInfo(name);
  if(!before)throw fail();
  const file=await open(name,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    if(!same(before,guard(await file.stat())))throw fail();
    const bytes=Buffer.alloc(limit+1),{bytesRead}=await file.read(bytes,0,bytes.length,0);
    if(bytesRead!==before.size || !same(before,guard(await file.stat())) ||
      !same(before,guard(await lstat(name))))throw fail();
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead)));
    if(!value || Array.isArray(value) || Object.keys(value).length!==3 ||
      !['version','state','checkedAt'].every(key=>Object.hasOwn(value,key)) || value.version!==1 ||
      !states.includes(value.state) || typeof value.checkedAt!=='string' || !Number.isFinite(Date.parse(value.checkedAt)))throw fail();
    return value;
  } finally {await file.close();}
}

export async function writePairingStatus(runtime,now=Date.now()) {
  let status=await readPairingStatus(runtime,now);
  const name=path.join(runtime,filename),checkedAt=new Date(now).toISOString();
  const bytes=JSON.stringify({...status,checkedAt});
  await targetInfo(name);
  const temporary=path.join(runtime,`${filename}.${randomBytes(16).toString('hex')}.tmp`);
  let created=false,renamed=false;
  try {
    const file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
    created=true;
    try {
      await file.writeFile(bytes);await file.sync();
      await withPeerStateLock(runtime,async()=>{
        let revoked=false;
        try {await lstat(path.join(runtime,'private-sync','revoked'));revoked=true;}
        catch(error) {if(error.code!=='ENOENT')throw error;}
        if(revoked && status.state!=='revoked') {
          status=result('revoked');
          await file.truncate(0);
          await file.write(JSON.stringify({...status,checkedAt}),0,'utf8');
          await file.sync();
        }
        await file.close();
        await targetInfo(name);
        await rename(temporary,name);renamed=true;
      });
    } finally {await file.close();}
  } finally {if(created && !renamed)await unlink(temporary);}
  return status;
}

export async function readPairingStatusFile(runtime,now=Date.now()) {
  try {
    const value=await readFileValue(path.join(runtime,filename)),age=now-Date.parse(value.checkedAt);
    if(!Number.isFinite(age) || age>120000 || age< -60000)throw fail();
    return result(value.state);
  } catch {return result('unavailable');}
}

async function main() {
  const args=process.argv.slice(2);
  if(args.length!==2 || args[0]!=='--runtime' || !path.isAbsolute(args[1]) || await realpath(args[1])!==args[1])throw fail();
  process.stdout.write(JSON.stringify(await readPairingStatus(args[1]))+'\n');
}
if(process.argv[1] && process.argv[1]!=='-' && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))
  main().catch(()=>{process.stderr.write('Pairing status unavailable.\n');process.exitCode=1;});
