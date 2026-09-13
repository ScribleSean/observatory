import tls from 'node:tls';
import {createHash,X509Certificate} from 'node:crypto';
import {InvitationSession} from './peer-invitation-session.mjs';
import {isPairingAddress,invitationLifetimeMs} from './peer-invitation.mjs';

const failure=()=>Error('Pairing listener unavailable');
function deviceCertificate(raw) {
  if(!raw || raw.length>16384)throw failure();
  const cert=new X509Certificate(raw),now=Date.now();
  const key=cert.publicKey,type=key.asymmetricKeyType,details=key.asymmetricKeyDetails;
  if(!cert.checkIssued(cert) || !cert.verify(key) ||
    !(Date.parse(cert.validFrom)<=now && now<Date.parse(cert.validTo)) ||
    !(type==='rsa' && details.modulusLength>=2048 ||
      type==='ec' && ['prime256v1','secp384r1'].includes(details.namedCurve)))throw failure();
  return createHash('sha256').update(cert.raw).digest('hex');
}

// Explicit setup only. No auto-start, discovery, file writes or trust activation.
export async function startPairingListener({address,port=0,identity},
  {createServer=tls.createServer}={}) {
  if(!isPairingAddress(address) || !Number.isInteger(port) ||
    (port!==0 && (port<1024 || port>65535)) || !identity ||
    typeof identity.key!=='string' || identity.key.length>16384 ||
    typeof identity.cert!=='string' || identity.cert.length>16384)throw failure();
  let fingerprint;
  try {fingerprint=deviceCertificate(identity.cert);}catch{throw failure();}
  const session=new InvitationSession(),sockets=new Set();
  let pending=null,attempts=0,server,expiry,closing;
  const close=()=>{
    session.cancel();pending=null;clearTimeout(expiry);
    if(closing)return closing;
    for(const socket of sockets)socket.destroy();
    closing=new Promise(resolve=>{if(server)server.close(()=>resolve());else resolve();});
    return closing;
  };
  try {
    server=createServer({key:identity.key,cert:identity.cert,requestCert:true,
      // New devices have no CA trust yet. TLS proves possession of the presented
      // key. The checks below require a valid self-signed device certificate,
      // the invitation secret and subsequent local approval. No data is shared.
      rejectUnauthorized:false,minVersion:'TLSv1.3',maxVersion:'TLSv1.3',
      ALPNProtocols:['observatory-pair/1'],handshakeTimeout:8000,allowHalfOpen:true},socket=>{
      let peerFingerprint;
      socket.on('error',()=>{});
      try {
        if(socket.alpnProtocol!=='observatory-pair/1' || session.status()!=='waiting')throw failure();
        peerFingerprint=deviceCertificate(socket.getPeerCertificate().raw);
      } catch {socket.destroy();return;}
      let size=0,claimed=false,acknowledged=false;
      const chunks=[],deadline=setTimeout(()=>socket.destroy(),8000);
      socket.once('close',()=>{
        clearTimeout(deadline);
        if(claimed && !acknowledged)void close();
      });
      socket.on('data',chunk=>{
        size+=chunk.length;
        if(size>1024){socket.destroy();return;}
        chunks.push(chunk);
      });
      socket.once('end',()=>{
        try {
          const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
          if(!request || Object.keys(request).length!==3 || request.version!==1 ||
            request.action!=='claim' || !Object.hasOwn(request,'secret'))throw failure();
          pending=session.claim(request.secret,peerFingerprint);claimed=true;
          socket.end(JSON.stringify({version:1,status:'awaiting-confirmation'}),()=>{acknowledged=true;});
        } catch {socket.destroy();}
      });
    });
    server.on('connection',socket=>{
      attempts++;
      if(sockets.size>=4 || attempts>64){socket.destroy();if(attempts>64)void close();return;}
      sockets.add(socket);socket.once('close',()=>sockets.delete(socket));
      // Covers sockets that never complete TLS as well as slow application input.
      const deadline=setTimeout(()=>socket.destroy(),8000);
      socket.once('close',()=>clearTimeout(deadline));
    });
    server.on('tlsClientError',()=>{});
    server.on('error',()=>{void close();});
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen({host:address,port,exclusive:true},()=>{
        server.removeListener('error',reject);resolve();
      });
    });
    const invitation=session.issue({address,port:server.address().port,certificateSha256:fingerprint});
    expiry=setTimeout(()=>{void close();},invitationLifetimeMs);
    return {
      invitation,
      status:()=>session.status(),
      pending:()=>session.status()==='confirming' && pending?{...pending}:null,
      cancel:close,
      confirm:async claimId=>{
        const result=session.confirm(claimId);
        await close();
        return result;
      },
    };
  } catch {await close();throw failure();}
}
