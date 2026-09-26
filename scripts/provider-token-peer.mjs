import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {cleanClaudeTokenSource,unavailableClaudeTokenSource} from './provider-token-sources.mjs';
import {selectPeerRevision} from './peer-revision.mjs';

export const providerTokenLimit=17_000_000;
export const exactProviderFields=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) &&
  Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
export const providerGeneration=value=>typeof value==='string' && /^[a-f0-9]{32}$/.test(value);
export const providerClock=now=>Number.isSafeInteger(now) && now>=0 && Number.isFinite(new Date(now).getTime());
const digest=payload=>createHash('sha256').update(JSON.stringify(payload)).digest('hex');

// Incoming sources must already be the public allowlisted projection. The
// expected host comes from the saved pairing, never from the incoming record.
export function parseProviderTokenSource(raw,host,now=Date.now()) {
  if(!providerClock(now) || !raw || typeof raw.checkedAt!=='string' ||
    !Number.isFinite(Date.parse(raw.checkedAt)) || Date.parse(raw.checkedAt)>now+300000)
    throw Error('Invalid provider source time');
  const safe=raw.status==='ok'?cleanClaudeTokenSource(raw,host,raw.checkedAt):
    unavailableClaudeTokenSource(host,raw.checkedAt,raw.status);
  if(!isDeepStrictEqual(raw,safe))throw Error('Invalid provider source fields');
  return safe;
}

export function parseProviderTokenRecord(raw,identity,now=Date.now()) {
  if(!exactProviderFields(raw,['version','revision','payload']) || raw.version!==1 ||
    !exactProviderFields(raw.payload,['version','generation','source']) || raw.payload.version!==1 ||
    !providerGeneration(raw.payload.generation) || Buffer.byteLength(JSON.stringify(raw))>providerTokenLimit)
    throw Error('Invalid provider record');
  const payload={version:1,generation:raw.payload.generation,source:parseProviderTokenSource(raw.payload.source,identity.host,now)};
  const {revision}=selectPeerRevision(null,raw.revision,identity,now);
  if(revision.collectedAt!==payload.source.checkedAt || revision.digest!==digest(payload))throw Error('Provider record integrity mismatch');
  return {version:1,revision,payload};
}

export function createProviderTokenRecord(source,identity,generation,sequence,now=Date.now()) {
  const payload={version:1,generation,source:parseProviderTokenSource(source,identity.host,now)};
  return parseProviderTokenRecord({version:1,payload,revision:{version:1,pairId:identity.pairId,
    deviceId:identity.deviceId,comparisonId:identity.comparisonId,host:identity.host,
    sequence,collectedAt:source.checkedAt,digest:digest(payload)}},identity,now);
}

export function parseProviderTokenRequest(request,identity) {
  const keys=['version','action','pairId','deviceId',...(request?.action==='exchange'?['record']:[])];
  if(!exactProviderFields(request,keys) || request.version!==1 || !['status','exchange'].includes(request.action) ||
    request.pairId!==identity.pairId || request.deviceId!==identity.deviceId ||
    (request.action==='exchange' && !exactProviderFields(request.record,['version','revision','payload'])))throw Error('Invalid provider exchange request');
  return request;
}

export function parseProviderTokenReply(response,request) {
  if(!['status','exchange'].includes(request?.action) || !exactProviderFields(response,['version','status','record']) || response.version!==1 ||
    !['ready','disabled'].includes(response.status) ||
    ((request.action==='status' || response.status==='disabled') && response.record!==null) ||
    (request.action==='exchange' && response.status==='ready' && !response.record))throw Error('Invalid provider exchange response');
  return response;
}
