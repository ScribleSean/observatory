import {isDeepStrictEqual} from 'node:util';
import {parseSharedQuota} from './quota-peer.mjs';

export const quotaClockSkewMs=300000;

export function parseQuotaRecord(record,host,now=Date.now()) {
  if(!Number.isSafeInteger(now) || now<0 || !Number.isFinite(new Date(now).getTime()))throw Error('Invalid allowance clock');
  if(!record || Object.keys(record).length!==3 || record.version!==1 ||
      !Number.isSafeInteger(record.sequence) || record.sequence<1 || !Object.hasOwn(record,'payload'))
    throw Error('Invalid allowance record');
  // Validate retained history relative to its source observation, not the
  // receiver's wall clock. Preserve timestamps and bound future clock skew.
  const dates=[record.payload?.checkedAt,record.payload?.dailyCheckedAt].map(Date.parse).filter(Number.isFinite);
  const observed=dates.length?Math.max(...dates):now;
  if(observed>now+quotaClockSkewMs)throw Error('Allowance source clock too far ahead');
  const payload=parseSharedQuota(JSON.stringify(record.payload),{host,generation:record.payload?.generation,enabled:true,now:observed});
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
