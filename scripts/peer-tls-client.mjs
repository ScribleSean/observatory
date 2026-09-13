import tls from 'node:tls';
import {createHash,X509Certificate} from 'node:crypto';
import {validateInvitation} from './peer-invitation.mjs';

const protocol='observatory-pair/1';
const failure=()=>Error('Authenticated pairing connection unavailable');
const fingerprint=raw=>createHash('sha256').update(raw).digest('hex');

// The certificate may be obtained over an untrusted discovery channel. Its DER
// fingerprint must match the out-of-band invitation before it becomes a CA.
// The supplied identity must be a private, locally owned TLS client identity.
export async function requestPeerClaim(invitation,certificatePem,identity,
  {connect=tls.connect,timeoutMs=8000}={}) {
  let safe,certificate;
  try {
    safe=validateInvitation(invitation);
    if(typeof certificatePem!=='string' || Buffer.byteLength(certificatePem)>16384 ||
      !identity || typeof identity.key!=='string' || typeof identity.cert!=='string' ||
      identity.key.length>16384 || identity.cert.length>16384 ||
      !Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>8000)throw failure();
    certificate=new X509Certificate(certificatePem);
    if(fingerprint(certificate.raw)!==safe.certificateSha256)throw failure();
  } catch {throw failure();}

  return new Promise((resolve,reject)=>{
    let socket,done=false,total=0;
    const chunks=[];
    const finish=(error,result)=>{
      if(done)return;
      done=true;clearTimeout(timer);socket?.destroy();
      if(error)reject(failure());else resolve(result);
    };
    const timer=setTimeout(()=>finish(failure()),timeoutMs);
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
          socket.end(JSON.stringify({version:1,action:'claim',secret:safe.secret})+'\n');
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
          if(!response || Object.keys(response).length!==2 || response.version!==1 ||
            response.status!=='awaiting-confirmation')throw failure();
          finish(null,{status:'awaiting-confirmation'});
        } catch {finish(failure());}
      });
      socket.once('error',()=>finish(failure()));
      socket.once('close',()=>{if(!done)finish(failure());});
    } catch {finish(failure());}
  });
}
