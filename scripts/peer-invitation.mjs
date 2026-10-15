import {randomBytes} from 'node:crypto';

const prefix='observatory-pair:v1:';
export const defaultSyncPort=43128;
export const invitationLifetimeMs=10*60*1000;
const fields=['version','address','port','certificateSha256','secret','createdAt','expiresAt'];
const hex256=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const invalid=()=>{throw Error('Invalid or expired pairing invitation');};

export function isPairingAddress(value) {
  if(typeof value!=='string' || value.length>39 || /[^a-f0-9:.]/i.test(value))return false;
  if(value.includes('.')) {
    const parts=value.split('.');
    if(parts.length!==4 || parts.some(part=>!/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part)>255))return false;
    const [a,b]=parts.map(Number);
    return a===10 || (a===172 && b>=16 && b<=31) || (a===192 && b===168) ||
      (a===100 && b>=64 && b<=127);
  }
  const halves=value.split('::');
  if(halves.length>2 || !halves[0])return false;
  const groups=halves.flatMap(half=>half?half.split(':'):[]);
  if(groups.some(group=>!/^[a-f0-9]{1,4}$/i.test(group)))return false;
  if(halves.length===1?groups.length!==8:groups.length<2 || groups.length>7)return false;
  const first=parseInt(groups[0],16);
  return first>=0xfc00 && first<=0xfdff;
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
    if(encodeInvitation(value,now)!==text)invalid();
    return value;
  } catch {invalid();}
}
