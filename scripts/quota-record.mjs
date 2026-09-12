import {isDeepStrictEqual} from 'node:util';
import {parseSharedQuota} from './quota-peer.mjs';

export function parseQuotaRecord(record,host,now=Date.now()) {
  if(!record || Object.keys(record).length!==3 || record.version!==1 ||
      !Number.isSafeInteger(record.sequence) || record.sequence<1 || !Object.hasOwn(record,'payload'))
    throw Error('Invalid allowance record');
  const payload=parseSharedQuota(JSON.stringify(record.payload),{host,generation:record.payload?.generation,enabled:true,now});
  return {version:1,sequence:record.sequence,payload};
}

export function selectQuotaRecord(previous,incoming) {
  if(previous && incoming.sequence<previous.sequence)return previous;
  if(previous && incoming.sequence===previous.sequence) {
    if(!isDeepStrictEqual(previous,incoming))throw Error('Conflicting allowance revision');
    return previous;
  }
  return incoming;
}
