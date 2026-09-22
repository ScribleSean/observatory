import {cleanQuotaObservation} from './quota-history.mjs';

const statuses=new Set(['ok','stale','unavailable','needs-auth','unsupported','rate-limited','not-connected']);
const stamp=value=>typeof value==='string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

// Peer data has already passed the authenticated exchange validator. Keep the
// browser boundary defensive as snapshots may still be hand-edited or old.
export function cleanPeerQuotaForDisplay(raw,now=Date.now()) {
  if(!raw || !['Mac','Windows'].includes(raw.host) || !statuses.has(raw.status) ||
    !Number.isSafeInteger(now) || now<0 || (raw.windows!==undefined && !Array.isArray(raw.windows)) ||
    (raw.history!==undefined && !Array.isArray(raw.history)) || raw.windows?.length>32 || raw.history?.length>10000)return null;
  const current=raw.windows?.length ? cleanQuotaObservation({checkedAt:raw.checkedAt,windows:raw.windows},now) : null;
  const history=(raw.history||[]).flatMap(sample=>{
    const cleaned=cleanQuotaObservation(sample,now);
    return cleaned?[{...cleaned,windows:cleaned.windows.filter(window=>window.bucket==='codex')}]:[];
  }).filter(sample=>sample.windows.length);
  return {host:raw.host,status:raw.status,checkedAt:current?.checkedAt,receivedAt:stamp(raw.receivedAt),
    windows:(current?.windows||[]).filter(window=>window.bucket==='codex'),history};
}
