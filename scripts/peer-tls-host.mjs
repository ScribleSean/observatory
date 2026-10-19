import {X509Certificate} from 'node:crypto';
import {constants,lstatSync} from 'node:fs';
import {lstat,open,unlink,rmdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {createPairingConfigurations,validatePairing,readPairing} from './peer-pairing.mjs';
import {validatePeerTransport} from './peer-transport.mjs';
import {readDeviceIdentity} from './peer-device-identity.mjs';
import {readPeerTrust} from './peer-tls-trust.mjs';
import {commitConfirmedTLSPairing} from './peer-tls-setup.mjs';
import {setupConfigurationDigest,legacySetupConfigurationDigest} from './peer-tls-setup-message.mjs';
import {privateSyncDirectory} from './peer-directory.mjs';
import {withPeerStateLock,acquireHostCommitLease} from './peer-lock.mjs';
import {startPairingListener} from './peer-tls-listener.mjs';
import {validRepairNonce,readRepairConsent} from './peer-repair-consent.mjs';
import {hostCommitFile,hostCommitUnfinished,readHostCommit} from './peer-tls-host-commit.mjs';

const fail=()=>Error('Confirmed host setup unavailable');
const fingerprint=pem=>new X509Certificate(pem).fingerprint256.replaceAll(':','').toLowerCase();
const offerFile='tls-offer.json',ackFile='tls-acknowledgement.json',limit=8192;

async function readStored(directory,name,bound=limit) {
  const filename=path.join(directory,name);
  let before;
  try {before=await lstat(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(!before.isFile() || before.isSymbolicLink() || before.nlink!==1 || before.size>bound ||
    (process.platform!=='win32' && (before.mode&0o077)))throw fail();
  const file=await open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const opened=await file.stat();
    if(opened.dev!==before.dev || opened.ino!==before.ino || opened.size!==before.size)throw fail();
    const bytes=Buffer.alloc(bound+1),{bytesRead}=await file.read(bytes,0,bytes.length,0),after=await file.stat();
    if(bytesRead!==before.size || after.size!==before.size || after.mtimeMs!==before.mtimeMs)throw fail();
    try {
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead)));
      if(!value || typeof value!=='object' || Array.isArray(value))throw fail();
      return value;
    }
    catch {throw fail();}
  } finally {await file.close();}
}

async function saveIdentical(directory,name,value) {
  const saved=await readStored(directory,name);
  if(saved!==null) {if(!isDeepStrictEqual(name===offerFile?validatePairing(saved):saved,value))throw fail();return;}
  const bytes=JSON.stringify(value);
  if(Buffer.byteLength(bytes)>limit)throw fail();
  const file=await open(path.join(directory,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
  try {await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  if(!isDeepStrictEqual(await readStored(directory,name),value))throw fail();
}

function complementary(pair,transport,localFingerprint) {
  const {comparisonSalt,...peer}=pair.local;
  return validatePairing({version:1,local:{...pair.peer,comparisonSalt},peer,transport,
    localEndpoint:pair.transport,
    peerCertificateSha256:localFingerprint,...(pair.repair?{repair:pair.repair}:{})});
}

// Call only after local confirmation of the certificate from the claimed TLS
// connection. Endpoints come from explicit setup.
export const prepareHostTLSSetup=(runtime,request)=>withPeerStateLock(runtime,()=>prepareHostTLSSetupLocked(runtime,request));
async function prepareHostTLSSetupLocked(runtime,request,onPrepared,beforeCommit) {
  const host=process.platform==='darwin'?'Mac':process.platform==='win32'?'Windows':null;
  if(!host || !request || typeof request!=='object' || Array.isArray(request) ||
    Object.keys(request).length!==(Object.hasOwn(request,'peerRepairNonce')?5:4) ||
    !['localEndpoint','peerEndpoint','peerCertificate','peerCertificateSha256'].every(key=>Object.hasOwn(request,key)) ||
    (Object.hasOwn(request,'peerRepairNonce') && request.peerRepairNonce!==null && !validRepairNonce(request.peerRepairNonce)))throw fail();
  const nonce=await readRepairConsent(runtime),localKey=host==='Mac'?'mac':'windows',peerKey=host==='Mac'?'windows':'mac';
  const repair=nonce || request.peerRepairNonce?{...(nonce?{[localKey]:nonce}:{}),
    ...(request.peerRepairNonce?{[peerKey]:request.peerRepairNonce}:{})}:undefined;
  const localEndpoint=validatePeerTransport(request.localEndpoint),peerEndpoint=validatePeerTransport(request.peerEndpoint);
  if(localEndpoint.kind!=='tls' || peerEndpoint.kind!=='tls')throw fail();
  const identity=await readDeviceIdentity(runtime);
  if(!identity)throw fail();
  const localFingerprint=fingerprint(identity.cert);
  let pair=await readPairing(runtime);
  if(!pair)pair=validatePairing({...createPairingConfigurations()[host],
    transport:peerEndpoint,localEndpoint,peerCertificateSha256:request.peerCertificateSha256,...(repair?{repair}:{})});
  if(!isDeepStrictEqual(pair.repair,repair) || pair.local.host!==host || !isDeepStrictEqual(pair.transport,peerEndpoint) || !isDeepStrictEqual(pair.localEndpoint,localEndpoint) ||
    pair.peerCertificateSha256!==request.peerCertificateSha256)throw fail();
  const claim={pairId:pair.local.pairId,localCertificateSha256:localFingerprint,
    peerCertificate:request.peerCertificate,peerCertificateSha256:request.peerCertificateSha256};
  if(beforeCommit)await beforeCommit(pair);
  await commitConfirmedTLSPairing(runtime,{pairing:pair,claim});
  const offer=complementary(pair,localEndpoint,localFingerprint),directory=await privateSyncDirectory(runtime);
  await saveIdentical(directory,offerFile,offer);
  await privateSyncDirectory(runtime);
  if(onPrepared)await onPrepared();
  return offer;
}

async function hostState(runtime) {
  const pair=await readPairing(runtime),trust=await readPeerTrust(runtime),directory=await privateSyncDirectory(runtime);
  if(!pair?.peerCertificateSha256 || !pair.localEndpoint || !trust)throw fail();
  const raw=await readStored(directory,offerFile);
  if(!raw)throw fail();
  const offer=validatePairing(raw);
  if(!isDeepStrictEqual(offer,complementary(pair,pair.localEndpoint,trust.localCertificateSha256)))throw fail();
  const receipt={version:1,pairId:pair.local.pairId,deviceId:pair.peer.deviceId,
    peerCertificateSha256:pair.peerCertificateSha256,digest:setupConfigurationDigest(offer)};
  const ack=await readStored(directory,ackFile);
  if(ack!==null && !isDeepStrictEqual(ack,receipt) &&
    !isDeepStrictEqual(ack,{...receipt,digest:legacySetupConfigurationDigest(offer)}))throw fail();
  return {directory,offer,receipt,acknowledged:ack!==null};
}

// Returns private configuration only to the local setup controller. A saved
// acknowledgement proves receipt, not that the remote app is currently online.
export const readHostTLSSetup=runtime=>withPeerStateLock(runtime,async()=>{
  const state=await hostState(runtime);
  return {pairing:state.offer,acknowledged:state.acknowledged};
});

// Listener supplies the fingerprint from the actual TLS socket, not JSON.
export const recordHostTLSAcknowledgement=(runtime,{peerCertificateSha256,digest})=>withPeerStateLock(runtime,async()=>{
  const state=await hostState(runtime);
  if(peerCertificateSha256!==state.receipt.peerCertificateSha256 || digest!==state.receipt.digest)throw fail();
  if(!state.acknowledged)await saveIdentical(state.directory,ackFile,state.receipt);
  await privateSyncDirectory(runtime);
  if(await hostCommitUnfinished(runtime)) {
    const marker=await readHostCommit(state.directory);
    if(marker.pairId===state.receipt.pairId && marker.peerCertificateSha256===state.receipt.peerCertificateSha256)
      await clearCommit(state.directory);
  }
  return {version:1,status:'acknowledged'};
});

async function removeNext(directory) {
  const filename=path.join(directory,hostCommitFile+'.next');
  let info;
  try {info=await lstat(filename,{bigint:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
  if(!info.isFile() || info.isSymbolicLink() || info.nlink!==1n)return;
  await unlink(filename);
}
async function syncDirectory(directory) {
  if(process.platform==='win32')return;
  const folder=await open(directory,constants.O_RDONLY);
  try {await folder.sync();}finally{await folder.close();}
}
async function clearCommit(directory) {
  await unlink(path.join(directory,hostCommitFile));
  await removeNext(directory);
  await syncDirectory(directory);
}
async function writeCommit(runtime,marker,replace=false,beforeMarker) {
  const directory=await privateSyncDirectory(runtime);
  await removeNext(directory);
  const bytes=Buffer.from(JSON.stringify(marker));
  if(bytes.length>4096)throw fail();
  const filename=path.join(directory,hostCommitFile+'.next');
  const file=await open(filename,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
  try {
    if(beforeMarker)await beforeMarker();
    if((await file.write(bytes)).bytesWritten!==bytes.length)throw fail();
    await file.sync();
  } finally {await file.close();}
  const target=path.join(directory,hostCommitFile);
  if(!replace) {
    try {await lstat(target);throw fail();}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  await rename(filename,target);
  await syncDirectory(directory);
  await privateSyncDirectory(runtime);
}
async function commitAcknowledged(runtime,marker) {
  try {
    const state=await hostState(runtime);
    return state.acknowledged && state.receipt.pairId===marker.pairId &&
      state.receipt.peerCertificateSha256===marker.peerCertificateSha256;
  } catch {return false;}
}
async function removeCreatedDirectory(directory) {
  await rmdir(directory).catch(error=>{if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code))throw error;});
}
export async function recoverHostCommit(runtime) {
  try {lstatSync(path.join(runtime,'private-sync',hostCommitFile));}
  catch(error) {
    if(error.code==='ENOENT') {
      try {lstatSync(path.join(runtime,'private-sync',hostCommitFile+'.next'));}
      catch(nextError){if(nextError.code==='ENOENT')return {status:'none'};}
    }
  }
  try {
    return await withPeerStateLock(runtime,async()=>{
      const lease=await acquireHostCommitLease(runtime);
      if(!lease)return {status:'pending'};
      try {
        if(!await hostCommitUnfinished(runtime)) {
          const directory=await privateSyncDirectory(runtime),filename=path.join(directory,hostCommitFile+'.next');
          let info;
          try {info=await lstat(filename);}catch(error){if(error.code==='ENOENT')return {status:'none'};throw error;}
          if(!info.isFile() || info.isSymbolicLink() || info.nlink!==1)return {status:'unavailable'};
          await unlink(filename);
          return {status:'rolled-back'};
        }
        const directory=await privateSyncDirectory(runtime),marker=await readHostCommit(directory);
        if(await commitAcknowledged(runtime,marker)) {
          await clearCommit(directory);return {status:'completed'};
        }
        let unavailable=false;
        for(const name of marker.created) {
          const filename=path.join(directory,name);
          let info;
          try {info=await lstat(filename,{bigint:true});}
          catch(error){if(error.code==='ENOENT')continue;throw error;}
          if(!info.isFile() || info.isSymbolicLink() || info.nlink!==1n){unavailable=true;continue;}
          const identity=marker.files[name];
          if(identity) {
            if(String(info.dev)!==identity.dev || String(info.ino)!==identity.ino)continue;
          } else {
            try {
              const raw=await readStored(directory,name);
              if(name==='tls-trust.json') {
                if(raw?.pairId!==marker.pairId || raw.localCertificateSha256!==marker.localCertificateSha256 ||
                  fingerprint(raw.peerCertificate)!==marker.peerCertificateSha256)throw fail();
              } else {
                const pair=validatePairing(raw);
                if(pair.local.pairId!==marker.pairId || pair.peerCertificateSha256!==
                  (name===offerFile?marker.localCertificateSha256:marker.peerCertificateSha256))throw fail();
              }
            } catch {unavailable=true;continue;}
          }
          const current=await lstat(filename,{bigint:true});
          if(current.dev!==info.dev || current.ino!==info.ino)continue;
          await unlink(filename);
        }
        if(unavailable)return {status:'unavailable'};
        await clearCommit(directory);
        if(marker.directoryCreated)await removeCreatedDirectory(directory);
        return {status:'rolled-back'};
      } finally {lease.release();}
    });
  } catch(error) {return {status:error.errcode===5?'pending':'unavailable'};}
}

// Native host controller entrypoint. Starts only on an explicit setup action.
// Reopening after restart requires a new invitation and local confirmation,
// while the saved offer and acknowledgement remain bound to the same peer.
export async function startHostTLSSetup(runtime,{address,port=0},options={}) {
  const identity=await readDeviceIdentity(runtime);
  if(!identity)throw fail();
  const localFingerprint=fingerprint(identity.cert);
  let lease=null,marker=null,rollbackPromise,firstMarkerPending=false,confirming=0;
  // A confirmation rolls back its own failure, so a listener close during it leaves the rollback to that path.
  const guarded=async action=>{confirming++;try {return await action();}finally{confirming--;}};
  const created=new Map(),directory=path.join(runtime,'private-sync');
  const release=()=>{lease?.release();lease=null;};
  const rollback=()=>withPeerStateLock(runtime,()=>rollbackPromise??=(async()=>{
    try {
      if(!marker)return;
      if(!await hostCommitUnfinished(runtime)) {
        if(!firstMarkerPending)return;
        await removeNext(directory);
        if(marker.directoryCreated)await removeCreatedDirectory(directory);
        return;
      }
      if(await commitAcknowledged(runtime,marker))return;
      for(const [filename,identity] of created) {
        let current;
        try {current=await lstat(filename,{bigint:true});}catch(error){if(error.code==='ENOENT')continue;throw error;}
        if(current.isFile() && !current.isSymbolicLink() && current.nlink===1n &&
          current.dev===identity.dev && current.ino===identity.ino)await unlink(filename);
      }
      await clearCommit(directory);
      if(marker.directoryCreated)await removeCreatedDirectory(directory);
    } finally {release();}
  })());
  const listener=await startPairingListener({address,port,identity},{createServer:options.createServer,
    sessionOptions:options.sessionOptions,setExpiry:options.setExpiry,onClose:()=>confirming?undefined:rollback(),
    onAcknowledged:async ack=>{
      const result=await recordHostTLSAcknowledgement(runtime,ack);
      if(!await hostCommitUnfinished(runtime))release();
      return result;
    }});
  return {
    invitation:listener.invitation,status:listener.status,pending:listener.pending,cancel:async()=>{await listener.cancel();await rollback();},
    confirm:(claimId,request)=>guarded(()=>withPeerStateLock(runtime,async()=>{
      const pending=listener.pending(),current=await readDeviceIdentity(runtime);
      if(!pending || pending.claimId!==claimId || listener.pending()?.claimId!==claimId ||
        !current || fingerprint(current.cert)!==localFingerprint ||
        request?.localEndpoint?.address!==address)throw fail();
      // Refuse a malformed request before the claim, so it does not use up the invitation.
      try {
        if(validatePeerTransport(request.localEndpoint).kind!=='tls' ||
          validatePeerTransport(request.peerEndpoint).kind!=='tls')throw fail();
      } catch {throw fail();}
      if(await hostCommitUnfinished(runtime))await recoverHostCommit(runtime);
      if(await hostCommitUnfinished(runtime))throw fail();
      lease=await acquireHostCommitLease(runtime);
      if(!lease)throw fail();
      let directoryExisted=true;
      try {await lstat(directory);}catch(error){if(error.code!=='ENOENT'){release();throw fail();}directoryExisted=false;}
      try {
        const handle=listener.claimSetup(claimId);
        const absent=[];
        for(const name of ['pairing.json','tls-trust.json',offerFile]) {
          const filename=path.join(directory,name);
          try {await lstat(filename);}catch(error){if(error.code!=='ENOENT')throw error;absent.push(filename);}
        }
        const capture=async()=>{
          // These writers create files exclusively without renaming them. Capture
          // partial writes too, while the same peer state lock is still held.
          const captures=await Promise.allSettled(absent.map(async filename=>{
            if(created.has(filename))return;
            let info;
            try {info=await lstat(filename,{bigint:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
            if(!info.isFile() || info.isSymbolicLink())throw fail();
            created.set(filename,info);
          }));
          if(captures.some(result=>result.status==='rejected'))throw fail();
        };
        let offer;
        try {
          offer=await prepareHostTLSSetupLocked(runtime,{...request,peerCertificate:pending.peerCertificate,
            peerCertificateSha256:pending.peerCertificateSha256,peerRepairNonce:pending.peerRepairNonce},async()=>{
            await capture();
            marker.files=Object.fromEntries(marker.created.map(name=>{
              const info=created.get(path.join(directory,name));
              return [name,{dev:String(info.dev),ino:String(info.ino)}];
            }));
            await writeCommit(runtime,marker,true);
            // Function-only test seam, never populated by the JSON controller.
            if(options.beforePublish)await options.beforePublish();
          },async pair=>{
            marker={version:1,pairId:pair.local.pairId,localCertificateSha256:localFingerprint,
              peerCertificateSha256:pending.peerCertificateSha256,directoryCreated:!directoryExisted,
              created:absent.map(filename=>path.basename(filename)),files:{}};
            firstMarkerPending=true;
            await privateSyncDirectory(runtime,true);
            // Function-only test seam, never populated by the JSON controller.
            await writeCommit(runtime,marker,false,options.beforeMarker);
            firstMarkerPending=false;
          });
        } finally {await capture();}
        return listener.publishSetup(handle,offer);
      } catch {
        await listener.cancel();
        await rollback();
        throw fail();
      }
    })),
  };
}
