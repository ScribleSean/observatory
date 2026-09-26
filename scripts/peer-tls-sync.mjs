import tls from 'node:tls';
import {X509Certificate,createHash} from 'node:crypto';
import {isPairingAddress} from './peer-invitation.mjs';
import {readPeerTrust} from './peer-tls-trust.mjs';
import {readDeviceIdentity} from './peer-device-identity.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {exchangePeerRequest} from './peer-exchange.mjs';
import {exchangeQuota} from './quota-exchange.mjs';
import {readPairing} from './peer-pairing.mjs';
import {isDeepStrictEqual} from 'node:util';

const protocol='observatory-sync/1',limit=17_000_000;
const fingerprint=cert=>createHash('sha256').update(cert.raw).digest('hex');
const unavailable=()=>Error('Trusted sync listener unavailable');

// Explicit lifecycle only. A setup claim cannot start this listener without
// previously saved pairing configuration, local identity and peer trust.
export async function startTrustedSyncListener(runtime,{address,port=0},{createServer=tls.createServer,expectedPairing}={}) {
  if(!isPairingAddress(address) || !Number.isInteger(port) ||
    (port!==0 && (port<1024 || port>65535)))throw unavailable();
  const state=await withPeerStateLock(runtime,async()=>{
    const trust=await readPeerTrust(runtime),identity=await readDeviceIdentity(runtime);
    if(!trust || !identity)throw unavailable();
    if(expectedPairing && (!isDeepStrictEqual(await readPairing(runtime),expectedPairing) ||
      !isDeepStrictEqual(expectedPairing.localEndpoint,{kind:'tls',address,port})))throw unavailable();
    return {trust,identity};
  });
  const peerFingerprint=fingerprint(new X509Certificate(state.trust.peerCertificate));
  const sockets=new Set(),exchanges=new Set();let server,closing;
  const close=()=>{
    if(closing)return closing;
    for(const socket of sockets)socket.destroy();
    closing=(async()=>{
      await new Promise(resolve=>{if(server)server.close(()=>resolve());else resolve();});
      await Promise.allSettled([...exchanges]);
    })();
    return closing;
  };
  try {
    server=createServer({key:state.identity.key,cert:state.identity.cert,ca:state.trust.peerCertificate,
      requestCert:true,rejectUnauthorized:true,minVersion:'TLSv1.3',maxVersion:'TLSv1.3',
      ALPNProtocols:[protocol],handshakeTimeout:8000,allowHalfOpen:true},socket=>{
      socket.on('error',()=>{});
      const peer=socket.getPeerCertificate();
      if(!socket.authorized || socket.alpnProtocol!==protocol || !peer.raw ||
        fingerprint(new X509Certificate(peer.raw))!==peerFingerprint){socket.destroy();return;}
      const chunks=[];let size=0;
      socket.on('data',chunk=>{
        size+=chunk.length;
        if(size>limit){socket.destroy();return;}
        chunks.push(chunk);
      });
      socket.once('end',()=>{
        const exchange=withPeerStateLock(runtime,async()=>{
          // Read trust again under the same lock as record acceptance. An open
          // TLS connection cannot outlive revocation or a generation change.
          const current=await readPeerTrust(runtime);
          if(expectedPairing && !isDeepStrictEqual(await readPairing(runtime),expectedPairing))throw unavailable();
          if(socket.destroyed || !current || current.pairId!==state.trust.pairId ||
            current.localDeviceId!==state.trust.localDeviceId || current.peerDeviceId!==state.trust.peerDeviceId ||
            current.localCertificateSha256!==state.trust.localCertificateSha256 ||
            fingerprint(new X509Certificate(current.peerCertificate))!==peerFingerprint)throw unavailable();
          const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
          let response;
          if(request?.channel==='quota') {
            if(size>1_100_000 || request.version!==1 || Object.keys(request).length!==3 || !Object.hasOwn(request,'request'))throw unavailable();
            response=await exchangeQuota(runtime,request.request);
          } else response=await exchangePeerRequest(runtime,request);
          const bytes=JSON.stringify(response);
          if(Buffer.byteLength(bytes)>limit || socket.destroyed)throw unavailable();
          socket.end(bytes);
        }).catch(()=>socket.destroy());
        exchanges.add(exchange);void exchange.finally(()=>exchanges.delete(exchange));
      });
    });
    server.on('connection',socket=>{
      if(sockets.size>=2){socket.destroy();return;}
      sockets.add(socket);
      const deadline=setTimeout(()=>socket.destroy(),30000);
      socket.once('close',()=>{sockets.delete(socket);clearTimeout(deadline);});
    });
    server.on('tlsClientError',()=>{});
    server.on('error',()=>{void close();});
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen({host:address,port,exclusive:true},()=>{server.removeListener('error',reject);resolve();});
    });
    return {port:server.address().port,close,isListening:()=>server.listening && !closing};
  } catch {await close();throw unavailable();}
}
