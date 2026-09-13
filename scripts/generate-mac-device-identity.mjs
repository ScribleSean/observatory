import {generateKeyPair} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {validateDeviceIdentity} from './peer-device-identity.mjs';

// Explicit setup only. No files, Keychain entries, output or network requests.
// The caller owns private persistence and must never log the returned identity.
export async function generateMacDeviceIdentity() {
  if(process.platform!=='darwin')throw Error('Mac device identity generation unavailable');
  try {
    const {privateKey}=await promisify(generateKeyPair)('ec',{namedCurve:'prime256v1'});
    const key=privateKey.export({type:'pkcs8',format:'pem'}).toString();
    const cert=await new Promise((resolve,reject)=>{
      // Fixed system executable/configuration and a clean environment avoid
      // PATH and OPENSSL_CONF overrides. The key uses stdin only.
      const child=execFile('/usr/bin/openssl',['req','-new','-x509','-sha256',
        '-key','/dev/stdin','-days','365','-config','/private/etc/ssl/openssl.cnf','-subj','/CN=Observatory device'],
      {timeout:8000,killSignal:'SIGKILL',maxBuffer:4096,env:{PATH:'/usr/bin:/bin'}},
      (error,stdout)=>error?reject(Error('Certificate creation failed')):resolve(stdout));
      child.stdin.on('error',()=>{});child.stdin.end(key);
    });
    return validateDeviceIdentity({version:1,key,cert});
  } catch {throw Error('Mac device identity generation unavailable');}
}
