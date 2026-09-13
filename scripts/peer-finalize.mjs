import {mergePeerPayloads} from './peer-payload.mjs';
import {sshPeerExchange} from './peer-transport.mjs';
import {tlsPeerExchange} from './peer-tls-outbound.mjs';
import {assertPairingActive} from './peer-revocation.mjs';

// A sync failure must not replace a valid standalone dashboard with an error.
export async function finalizePeerCollection(runtime,result,pairing,previous=[],now=Date.now(),{exchangeTLS=tlsPeerExchange}={}) {
  if(!pairing || result.peer?.status!=='ready')return result;
  try {
    const {publishLocalPayload,readPeerState,acceptPeerState,assertCurrentPeerConfig}=await import('./peer-store.mjs');
    const local=await publishLocalPayload(runtime,result.peer.payload,pairing.local,now);
    let transport='not-configured';
    if(pairing.transport && (pairing.transport.kind==='tls' || process.platform==='darwin')) {
      try {
        await assertPairingActive(runtime);
        await assertCurrentPeerConfig(runtime,pairing.local);
        const incoming=pairing.transport.kind==='tls'?await exchangeTLS(runtime,pairing.transport,local):
          await sshPeerExchange(pairing.transport,local);
        await acceptPeerState(runtime,incoming,pairing.peer,Date.now());
        transport='ok';
      } catch {transport='unavailable';}
    }
    const peer=await readPeerState(runtime,pairing.peer,now);
    await assertPairingActive(runtime);
    await assertCurrentPeerConfig(runtime,pairing.local);
    if(peer)result.data=mergePeerPayloads(local.payload,peer.payload,pairing.local,pairing.peer,previous,now);
    result.peer={status:peer?'merged':'waiting',sequence:local.revision.sequence,transport};
  } catch {result.peer={status:'unavailable'};}
  return result;
}
