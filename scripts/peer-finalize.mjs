import {mergePeerPayloads} from './peer-payload.mjs';
import {sshPeerExchange} from './peer-transport.mjs';
import {tlsPeerExchange} from './peer-tls-outbound.mjs';
import {assertPairingActive} from './peer-revocation.mjs';

function unavailableConfiguredPeerSources(result,pairing) {
  const data=result.data;
  if(!data || typeof data!=='object' || Array.isArray(data))return;
  const unavailable=(sources,hosts)=>Array.isArray(sources) && sources.map(source=>
    hosts.includes(source?.host) && source.status==='not-connected'?{...source,status:'unavailable'}:source);
  data.activity=unavailable(data.activity,[pairing.peer.host]);
  data.tokens=unavailable(data.tokens,pairing.peer.codexHosts);
  if(result.status && Number.isInteger(result.status.sourcesRead) && Number.isInteger(result.status.sourcesConfigured)) {
    const sources=['activity','tokens','settings','dictation'].flatMap(key=>Array.isArray(data[key])?data[key]:[])
      .filter(source=>source?.status!=='not-connected');
    result.status={...result.status,sourcesRead:sources.filter(source=>source.status==='ok').length,
      sourcesConfigured:sources.length,state:sources.length && sources.every(source=>source.status==='ok')?'ok':'partial'};
  }
}

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
    else if(transport==='unavailable')unavailableConfiguredPeerSources(result,pairing);
    result.peer={status:peer?'merged':'waiting',sequence:local.revision.sequence,transport};
  } catch {result.peer={status:'unavailable'};}
  return result;
}
