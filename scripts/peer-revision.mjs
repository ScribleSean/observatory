const identifiers=['pairId','deviceId','comparisonId','digest'];
const fields=['version',...identifiers,'host','sequence','collectedAt'];
const hex=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const stamp=value=>typeof value==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;

function validate(value,expected,now) {
  if(!value || typeof value!=='object' || Array.isArray(value) ||
    Object.keys(value).length!==fields.length || Object.keys(value).some(key=>!fields.includes(key)) ||
    value.version!==1 || identifiers.some(key=>!hex(value[key])) ||
    ['pairId','deviceId','comparisonId','host'].some(key=>value[key]!==expected[key]) ||
    !Number.isSafeInteger(value.sequence) || value.sequence<1 || !stamp(value.collectedAt) ||
    Date.parse(value.collectedAt)>now+300000)throw Error('Invalid peer revision');
  return Object.fromEntries(fields.map(key=>[key,value[key]]));
}

export function selectPeerRevision(current,incoming,expected,now=Date.now()) {
  if(!Number.isFinite(now) || !expected ||
    !['Mac','Windows'].includes(expected.host) ||
    ['pairId','deviceId','comparisonId'].some(key=>!hex(expected[key])))throw Error('Invalid peer configuration');
  const candidate=validate(incoming,expected,now);
  const prior=current===null?null:validate(current,expected,now);
  const status=revision=>now-Date.parse(revision.collectedAt)>600000?'stale':'fresh';
  if(prior) {
    if(candidate.sequence<prior.sequence)return {action:'keep',reason:'older',status:status(prior),revision:prior};
    if(candidate.sequence===prior.sequence) {
      if(candidate.digest!==prior.digest || candidate.collectedAt!==prior.collectedAt)
        throw Error('Conflicting peer revision');
      return {action:'keep',reason:'duplicate',status:status(prior),revision:prior};
    }
    if(Date.parse(candidate.collectedAt)<Date.parse(prior.collectedAt))throw Error('Regressing peer clock');
  }
  return {action:'replace',reason:'newer',status:status(candidate),revision:candidate};
}
