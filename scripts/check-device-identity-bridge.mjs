import tls from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {validateDeviceIdentity} from './peer-device-identity.mjs';
import {startPairingListener} from './peer-tls-listener.mjs';
import {requestPeerClaim} from './peer-tls-client.mjs';

// Explicit synthetic interoperability check, never called during collection.
// Identities arrive only through the native parent's private stdin pipe.
async function main() {
  if(process.argv.length!==2 || process.platform!=='win32')throw Error('Unsupported bridge test');
  let size=0;const chunks=[];
  for await(const chunk of process.stdin) {
    size+=chunk.length;if(size>32768)throw Error('Bridge input limit');chunks.push(chunk);
  }
  const bytes=Buffer.concat(chunks);
  let request;
  try {request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  finally {bytes.fill(0);for(const chunk of chunks)chunk.fill(0);}
  if(!request || Object.keys(request).length!==3 || request.version!==1)throw Error('Invalid bridge input');
  const host=validateDeviceIdentity(request.host),guest=validateDeviceIdentity(request.guest);
  if(host.cert===guest.cert)throw Error('Distinct test identities required');
  const createServer=(options,callback)=>{
    const server=tls.createServer(options,callback),listen=server.listen.bind(server);
    server.listen=(binding,ready)=>listen({...binding,host:'127.0.0.1'},ready);
    return server;
  };
  const listener=await startPairingListener({address:'10.0.0.2',identity:host},{createServer});
  try {
    const response=await requestPeerClaim(listener.invitation,host.cert,guest,
      {connect:options=>tls.connect({...options,host:'127.0.0.1'})});
    const pending=listener.pending();
    const expected=new X509Certificate(guest.cert).fingerprint256.replaceAll(':','').toLowerCase();
    if(response.status!=='awaiting-confirmation' || pending?.peerCertificateSha256!==expected)
      throw Error('Bridge claim failed');
    const confirmed=await listener.confirm(pending.claimId);
    if(confirmed.peerCertificateSha256!==expected || listener.status()!=='inactive')throw Error('Bridge confirmation failed');
  } finally {await listener.cancel();}
  process.stdout.write('device-identity-bridge: passed\n');
}
const deadline=setTimeout(()=>{process.stderr.write('Device identity bridge failed\n');process.exit(1);},15000);
main().catch(()=>{process.stderr.write('Device identity bridge failed\n');process.exitCode=1;})
  .finally(()=>clearTimeout(deadline));
