import {combineTokens,verifyHostInventory} from './combine-tokens.mjs';

const hex=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const hosts=['Mac','Windows','Ubuntu'];
const fields=['version','comparisonId','host','status','keys','parents'];

// Private peer evidence only. comparisonId identifies a shared salt generation,
// not the salt itself. Neither comparison keys nor the salt belong in usage.json.
export function validatePeerInventory(value,expectedHost,comparisonId) {
  if(!hosts.includes(expectedHost) || !hex(comparisonId) || !value ||
    typeof value!=='object' || Array.isArray(value) ||
    Object.keys(value).length!==fields.length || Object.keys(value).some(key=>!fields.includes(key)) ||
    value.version!==1 || value.host!==expectedHost || value.comparisonId!==comparisonId ||
    !['ok','incomplete'].includes(value.status))throw Error('Invalid peer comparison evidence');
  for(const key of ['keys','parents'])if(!Array.isArray(value[key]) || value[key].length>40000 ||
    value[key].some(item=>!hex(item)))throw Error('Invalid peer comparison evidence');
  return {status:value.status,keys:[...new Set(value.keys)].sort(),parents:[...new Set(value.parents)].sort()};
}

export function combinePeerTokens(sources,evidence,comparisonId,expectedHosts,evidenceHosts=expectedHosts) {
  // Pairing defines metric coverage separately from ancestry-only evidence.
  if(!Array.isArray(expectedHosts) || !Array.isArray(evidenceHosts) ||
    ![2,3].includes(evidenceHosts.length) || new Set(evidenceHosts).size!==evidenceHosts.length ||
    evidenceHosts.some(host=>!hosts.includes(host)) || expectedHosts.some(host=>!evidenceHosts.includes(host)) ||
    !Array.isArray(evidence) || evidence.length!==evidenceHosts.length)
    return {host:'All',status:'unverified'};
  const inventories={};
  try {
    for(const host of evidenceHosts) {
      const matches=evidence.filter(row=>row?.host===host);
      if(matches.length!==1)throw Error('Missing peer evidence');
      inventories[host]=validatePeerInventory(matches[0],host,comparisonId);
      if(inventories[host].status!=='ok')throw Error('Incomplete peer evidence');
    }
  } catch {return {host:'All',status:'unverified'};}
  const verification=verifyHostInventory(sources,inventories,expectedHosts);
  if(verification.status!=='verified')return {host:'All',status:verification.status,verification};

  // The wire inventories flatten per-session edges. Conservatively follow
  // connected host inventories, including hosts whose counters are not counted.
  const ancestry=Object.entries(inventories).map(([host,row])=>({host,keys:[...row.keys,...row.parents]}));
  for(const host of expectedHosts) {
    const reached=new Set([host]),keys=new Set(ancestry.find(row=>row.host===host).keys);
    let changed=true;
    while(changed) {
      changed=false;
      for(const row of ancestry)if(!reached.has(row.host) && row.keys.some(key=>keys.has(key))) {
        reached.add(row.host);row.keys.forEach(key=>keys.add(key));changed=true;
      }
    }
    if(expectedHosts.some(other=>other!==host && reached.has(other)))
      return {host:'All',status:'overlap',verification:{status:'overlap'}};
  }
  // A parent absent from every supplied inventory may hide another bridge.
  const knownKeys=new Set(Object.values(inventories).flatMap(row=>row.keys));
  if(Object.values(inventories).some(row=>row.parents.some(parent=>!knownKeys.has(parent))))
    return {host:'All',status:'unverified'};
  return combineTokens(sources,inventories,expectedHosts);
}
