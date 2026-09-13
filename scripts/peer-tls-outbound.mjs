import tls from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validatePeerTransport} from './peer-transport.mjs';
import {readPairing} from './peer-pairing.mjs';
import {readPeerTrust} from './peer-tls-trust.mjs';
import {readDeviceIdentity} from './peer-device-identity.mjs';
import {readPeerState} from './peer-store.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {readQuotaState} from './quota-store.mjs';
import {createSharedQuota} from './quota-peer.mjs';

const limit=17_000_000;
const failure=()=>Error('Trusted peer exchange unavailable');
export async function tlsPeerExchange(runtime,transport,record,{connect=tls.connect}={}) {
  record=structuredClone(record);
  return trustedRequest(runtime,transport,{version:1,record},{connect,limit,
    authorize:async pairing=>{
      if(!isDeepStrictEqual(await readPeerState(runtime,pairing.local,Date.now(),'local'),record))throw failure();
    },decode:response=>{
      if(!response || Object.keys(response).length!==2 || response.version!==1 || !Object.hasOwn(response,'record'))throw failure();
      return response.record;
    }});
}

export async function tlsQuotaRequest(runtime,transport,request,{connect=tls.connect}={}) {
  request=structuredClone(request);
  return trustedRequest(runtime,transport,{version:1,channel:'quota',request},{connect,limit:1_100_000,
    authorize:async pairing=>{
      const keys=request?.action==='status'?['version','action','pairId','deviceId']:['version','action','pairId','deviceId','record'];
      if(!request || request.version!==1 || !['status','exchange'].includes(request.action) ||
        Object.keys(request).length!==keys.length || keys.some(key=>!Object.hasOwn(request,key)) ||
        request.pairId!==pairing.local.pairId || request.deviceId!==pairing.local.deviceId)throw failure();
      const state=await readQuotaState(runtime),history=state.history;
      if(!state.sharing.enabled || state.sharing.pairingId!==pairing.local.pairId)throw failure();
      if(request.action==='exchange') {
        const payload=createSharedQuota({status:history.status,checkedAt:history.asOf,history:history.samples,
          accountUsageCheckedAt:history.dailyAsOf,dailyUsageBuckets:history.dailyUsageBuckets},
          {enabled:true,host:pairing.local.host,generation:state.sharing.generation});
        if(!request.record || Object.keys(request.record).length!==3 || request.record.version!==1 ||
          !['version','sequence','payload'].every(key=>Object.hasOwn(request.record,key)) ||
          !Number.isSafeInteger(request.record.sequence) || request.record.sequence<1 || request.record.sequence>state.revision ||
          !isDeepStrictEqual(request.record.payload,payload))throw failure();
      }
    },decode:response=>{
      if(!response || Object.keys(response).length!==3 || response.version!==1 ||
        !['ready','disabled'].includes(response.status) || !Object.hasOwn(response,'record') ||
        ((request.action==='status' || response.status==='disabled') && response.record!==null) ||
        (request.action==='exchange' && response.status==='ready' && !response.record))throw failure();
      return response;
    }});
}

async function trustedRequest(runtime,transport,request,{connect,limit,authorize,decode}) {
  const safe=validatePeerTransport(transport);
  if(safe.kind!=='tls')throw failure();
  const state=await withPeerStateLock(runtime,async()=>{
    const pairing=await readPairing(runtime),trust=await readPeerTrust(runtime),identity=await readDeviceIdentity(runtime);
    if(!pairing || !trust || !identity || !isDeepStrictEqual(pairing.transport,safe))throw failure();
    await authorize(pairing);
    return {trust,identity};
  });
  const input=JSON.stringify(request);
  if(Buffer.byteLength(input)>limit)throw failure();
  const expected=new X509Certificate(state.trust.peerCertificate).fingerprint256;
  // Do not hold the local peer lock while waiting on the network. Both devices
  // may initiate simultaneously, and the receiver needs its own local lock.
  return new Promise((resolve,reject)=>{
    let socket,done=false,sent=false,size=0;const chunks=[];
    const finish=(error,value)=>{
      if(done)return;done=true;clearTimeout(deadline);socket?.destroy();
      if(error)reject(failure());else resolve(value);
    };
    const deadline=setTimeout(()=>finish(failure()),30000);
    try {
      socket=connect({host:safe.address,port:safe.port,key:state.identity.key,cert:state.identity.cert,
        ca:state.trust.peerCertificate,rejectUnauthorized:true,minVersion:'TLSv1.3',maxVersion:'TLSv1.3',
        ALPNProtocols:['observatory-sync/1'],
        checkServerIdentity:(_host,cert)=>cert.fingerprint256===expected?undefined:failure()});
      socket.once('secureConnect',()=>{
        void withPeerStateLock(runtime,async()=>{
          if(!socket.authorized || socket.alpnProtocol!=='observatory-sync/1' ||
            socket.getPeerCertificate().fingerprint256!==expected ||
            !isDeepStrictEqual(await readPeerTrust(runtime),state.trust) ||
            !isDeepStrictEqual((await readPairing(runtime))?.transport,safe))throw failure();
          await authorize(await readPairing(runtime));
        }).then(()=>{if(!done){sent=true;socket.end(input);}}).catch(()=>finish(failure()));
      });
      socket.on('data',chunk=>{
        if(!sent){finish(failure());return;}
        size+=chunk.length;if(size>limit){finish(failure());return;}chunks.push(chunk);
      });
      socket.once('end',()=>{
        try {
          if(!sent)throw failure();
          const response=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
          // Storage validates received records and revision ordering again.
          finish(null,decode(response));
        } catch {finish(failure());}
      });
      socket.once('error',()=>finish(failure()));
      socket.once('close',()=>{if(!done)finish(failure());});
    } catch {finish(failure());}
  });
}
