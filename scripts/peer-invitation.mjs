import {randomBytes} from 'node:crypto';
import {isIP} from 'node:net';

const prefix='observatory-pair:v1:';
export const invitationLifetimeMs=10*60*1000;
const fields=['version','address','port','certificateSha256','secret','createdAt','expiresAt'];
const hex256=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const invalid=()=>{throw Error('Invalid or expired pairing invitation');};

// Numeric private addresses avoid DNS rebinding and accidental public listeners.
// IPv6 link-local addresses need interface selection and are not supported yet.
export function isPairingAddress(value) {
  if(typeof value!=='string')return false;
  if(isIP(value)===4) {
    const [a,b]=value.split('.').map(Number);
    return a===10 || (a===172 && b>=16 && b<=31) || (a===192 && b===168) ||
      (a===100 && b>=64 && b<=127);
  }
  return isIP(value)===6 && /^f[cd][a-f0-9]{2}:/i.test(value);
}

export function validateInvitation(value,now=Date.now()) {
  if(!value || typeof value!=='object' || Array.isArray(value) ||
    Object.keys(value).length!==fields.length || fields.some(key=>!Object.hasOwn(value,key)) ||
    value.version!==1 || !isPairingAddress(value.address) ||
    !Number.isInteger(value.port) || value.port<1024 || value.port>65535 ||
    !hex256(value.certificateSha256) || !hex256(value.secret) ||
    !Number.isSafeInteger(now) || !Number.isSafeInteger(value.createdAt) ||
    !Number.isSafeInteger(value.expiresAt) || value.createdAt<0 || value.createdAt>now ||
    value.expiresAt<=now || value.expiresAt-value.createdAt!==invitationLifetimeMs)invalid();
  return Object.fromEntries(fields.map(key=>[key,value[key]]));
}

// This is an out-of-band bearer secret, not a short numeric pairing code.
// Never log the invitation or pass it through a browser URL or command line.
export function createInvitation({address,port,certificateSha256},now=Date.now()) {
  return validateInvitation({version:1,address,port,certificateSha256,
    secret:randomBytes(32).toString('hex'),createdAt:now,expiresAt:now+invitationLifetimeMs},now);
}

export function encodeInvitation(value,now=Date.now()) {
  return prefix+Buffer.from(JSON.stringify(validateInvitation(value,now))).toString('base64url');
}

export function decodeInvitation(text,now=Date.now()) {
  try {
    if(typeof text!=='string' || text.length>2048 || !text.startsWith(prefix))invalid();
    const encoded=text.slice(prefix.length);
    if(!/^[A-Za-z0-9_-]+$/.test(encoded))invalid();
    const json=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(encoded,'base64url'));
    const value=validateInvitation(JSON.parse(json),now);
    // Reject duplicate keys, alternate encodings and ambiguous representations.
    if(encodeInvitation(value,now)!==text)invalid();
    return value;
  } catch {invalid();}
}
