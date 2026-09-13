import {createPublicKey,verify} from 'node:crypto';

const domain='Workspace Observatory Windows installation receipt v1\n';
const fields=['schema','product','platform','sourceRevision','buildNumber',
  'manifestSha256','ownerSha256','uninstallerSha256'];

function canonicalReceipt(receipt) {
  if(!receipt || typeof receipt!=='object' || Array.isArray(receipt) ||
    Object.keys(receipt).length!==fields.length || fields.some(key=>!Object.hasOwn(receipt,key)) ||
    receipt.schema!==1 || receipt.product!=='WorkspaceObservatorySetup' || receipt.platform!=='windows-x64' ||
    typeof receipt.sourceRevision!=='string' || !/^[a-f0-9]{40}$/.test(receipt.sourceRevision) ||
    !Number.isSafeInteger(receipt.buildNumber) || receipt.buildNumber<1 ||
    ['manifestSha256','ownerSha256','uninstallerSha256'].some(key=>
      typeof receipt[key]!=='string' || !/^[a-f0-9]{64}$/.test(receipt[key])))
    throw Error('Invalid signed installation receipt');
  return Object.fromEntries(fields.map(key=>[key,receipt[key]]));
}

function base64(value,length) {
  if(typeof value!=='string' || value.length!==4*Math.ceil(length/3))throw Error('Invalid receipt signing metadata');
  const bytes=Buffer.from(value,'base64');
  if(bytes.length!==length || bytes.toString('base64')!==value)throw Error('Invalid receipt signing metadata');
  return bytes;
}

// The release signer signs these bytes outside the application. No private key is accepted here.
export function installationReceiptSigningBytes(receipt) {
  return Buffer.from(domain+JSON.stringify(canonicalReceipt(receipt)),'utf8');
}

// trustedPublicKey is pinned application configuration, never a field from the download.
export function authenticateInstallationReceipt(envelopeBytes,trustedPublicKey,previousBuild) {
  if(!Buffer.isBuffer(envelopeBytes) || envelopeBytes.length===0 || envelopeBytes.length>8192)
    throw Error('Invalid receipt envelope size');
  if(!Number.isSafeInteger(previousBuild) || previousBuild<0)throw Error('Invalid previous build');
  const envelope=JSON.parse(envelopeBytes.toString('utf8'));
  if(!envelope || Array.isArray(envelope) || Object.keys(envelope).length!==2 ||
    !Object.hasOwn(envelope,'receipt') || !Object.hasOwn(envelope,'signature'))throw Error('Invalid receipt envelope');
  const receipt=canonicalReceipt(envelope.receipt);
  const key=createPublicKey({key:Buffer.concat([
    Buffer.from('302a300506032b6570032100','hex'),base64(trustedPublicKey,32),
  ]),format:'der',type:'spki'});
  if(!verify(null,installationReceiptSigningBytes(receipt),key,base64(envelope.signature,64)))
    throw Error('Invalid installation receipt signature');
  if(receipt.buildNumber<=previousBuild)throw Error('Signed receipt build must advance');
  return Object.freeze(receipt);
}
