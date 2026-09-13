import tls from 'node:tls';
import {createHash,X509Certificate} from 'node:crypto';
import {validateInvitation} from './peer-invitation.mjs';
import {validatePairing} from './peer-pairing.mjs';
import {setupConfigurationDigest} from './peer-tls-setup-message.mjs';
import {isDeepStrictEqual} from 'node:util';

const protocol='observatory-pair/1';
const failure=()=>Error('Authenticated pairing connection unavailable');
const fingerprint=raw=>createHash('sha256').update(raw).digest('hex');

// Bootstrap retrieves only the public certificate. No client identity or
// application data is sent, and the out-of-band pin is mandatory. The actual
// claim uses normal certificate validation with this exact trust anchor.
export async function discoverPeerCertificate(invitation,{connect=tls.connect,timeoutMs=8000,signal}={}) {
  const safe=validateInvitation(invitation);
  if(!Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>8000 || signal?.aborted)throw failure();
  return new Promise((resolve,reject)=>{
    let socket,done=false;
    const abort=()=>finish(failure());
    const finish=(error,result)=>{
      if(done)return;
      done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);socket?.destroy();
      if(error)reject(failure());else resolve(result);
    };
    const timer=setTimeout(abort,timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    try {
      socket=connect({host:safe.address,port:safe.port,rejectUnauthorized:false,
        minVersion:'TLSv1.3',maxVersion:'TLSv1.3',ALPNProtocols:[protocol]});
      socket.once('secureConnect',()=>{
        try {
          validateInvitation(safe);
          const raw=socket.getPeerCertificate().raw;
          if(socket.alpnProtocol!==protocol || !raw || raw.length>16384 ||
            fingerprint(raw)!==safe.certificateSha256)throw failure();
          finish(null,new X509Certificate(raw).toString());
        } catch {finish(failure());}
      });
      socket.once('error',abort);socket.once('close',abort);
    } catch {finish(failure());}
  });
}

export async function claimFromInvitation(invitation,identity,options={}) {
  const timeoutMs=options.timeoutMs??8000,started=performance.now();
  const certificate=await discoverPeerCertificate(invitation,{...options,timeoutMs});
  const remaining=Math.floor(timeoutMs-(performance.now()-started));
  if(remaining<1 || options.signal?.aborted)throw failure();
  return requestPeerClaim(invitation,certificate,identity,{...options,timeoutMs:remaining});
}

// The certificate may be obtained over an untrusted discovery channel. Its DER
// fingerprint must match the out-of-band invitation before it becomes a CA.
// The supplied identity must be a private, locally owned TLS client identity.
export async function requestPeerClaim(invitation,certificatePem,identity,options={}) {
  return pairingRequest(invitation,certificatePem,identity,{version:1,action:'claim',secret:invitation?.secret},response=>{
    if(!response || Object.keys(response).length!==2 || response.version!==1 ||
      response.status!=='awaiting-confirmation')throw failure();
    return {status:'awaiting-confirmation'};
  },options);
}

// The controller supplies the local source scope selected by this user. A
// remote proposal may not expand it, and may not change the invitation pin.
export async function requestPeerSetup(invitation,certificatePem,identity,expected,options={}) {
  if(!expected || !['Mac','Windows'].includes(expected.host) || typeof expected.includeUbuntu!=='boolean' ||
    (expected.host==='Mac' && expected.includeUbuntu))throw failure();
  return pairingRequest(invitation,certificatePem,identity,{version:1,action:'setup'},response=>{
    if(response?.version!==1)throw failure();
    if(response.status==='awaiting-confirmation' && Object.keys(response).length===2)return {status:response.status};
    if(response.status!=='configuration' || Object.keys(response).length!==3 || !Object.hasOwn(response,'pairing'))throw failure();
    const pairing=validatePairing(response.pairing);
    if(pairing.transport?.kind!=='tls' || pairing.peerCertificateSha256!==invitation.certificateSha256 ||
      pairing.local.host!==expected.host || !isDeepStrictEqual(pairing.local.codexHosts,
        expected.includeUbuntu?['Windows','Ubuntu']:[expected.host]))throw failure();
    return {status:'configuration',pairing};
  },options);
}

// Only call after the local controller has verified its durable pairing commit.
export async function acknowledgePeerSetup(invitation,certificatePem,identity,pairing,options={}) {
  if(pairing?.peerCertificateSha256!==invitation?.certificateSha256)throw failure();
  return pairingRequest(invitation,certificatePem,identity,
    {version:1,action:'acknowledge',digest:setupConfigurationDigest(pairing)},response=>{
      if(response?.version!==1 || response.status!=='acknowledged' || Object.keys(response).length!==2)throw failure();
      return {status:'acknowledged'};
    },options);
}

async function pairingRequest(invitation,certificatePem,identity,request,validateResponse,
  {connect=tls.connect,timeoutMs=8000,signal}={}) {
  let safe,certificate;
  try {
    safe=validateInvitation(invitation);
    if(typeof certificatePem!=='string' || Buffer.byteLength(certificatePem)>16384 ||
      !identity || typeof identity.key!=='string' || typeof identity.cert!=='string' ||
      identity.key.length>16384 || identity.cert.length>16384 ||
      !Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>8000 || signal?.aborted)throw failure();
    certificate=new X509Certificate(certificatePem);
    if(fingerprint(certificate.raw)!==safe.certificateSha256)throw failure();
  } catch {throw failure();}

  return new Promise((resolve,reject)=>{
    let socket,done=false,total=0;
    const chunks=[];
    const abort=()=>finish(failure());
    const finish=(error,result)=>{
      if(done)return;
      done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);socket?.destroy();
      if(error)reject(failure());else resolve(result);
    };
    const timer=setTimeout(()=>finish(failure()),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    try {
      socket=connect({host:safe.address,port:safe.port,
        ca:certificate.toString(),key:identity.key,cert:identity.cert,
        rejectUnauthorized:true,minVersion:'TLSv1.3',maxVersion:'TLSv1.3',
        ALPNProtocols:[protocol],
        // Trust is the exact out-of-band device certificate, not a DNS name.
        checkServerIdentity:(_host,peer)=>
          peer.raw && fingerprint(peer.raw)===safe.certificateSha256?undefined:failure()});
      socket.once('secureConnect',()=>{
        try {
          validateInvitation(safe);
          const peer=socket.getPeerCertificate();
          if(!socket.authorized || socket.alpnProtocol!==protocol || !peer.raw ||
            fingerprint(peer.raw)!==safe.certificateSha256)throw failure();
          // No invitation bytes are written before all authentication checks.
          socket.end(JSON.stringify(request)+'\n');
        } catch {finish(failure());}
      });
      socket.on('data',chunk=>{
        total+=chunk.length;
        if(total>8192){finish(failure());return;}
        chunks.push(chunk);
      });
      socket.once('end',()=>{
        try {
          const response=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
          finish(null,validateResponse(response));
        } catch {finish(failure());}
      });
      socket.once('error',()=>finish(failure()));
      socket.once('close',()=>{if(!done)finish(failure());});
    } catch {finish(failure());}
  });
}
