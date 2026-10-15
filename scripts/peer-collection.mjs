const fields=['pairId','deviceId','comparisonId','comparisonSalt','host'];
const hex=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);

// Pairing is supplied by a trusted private configuration loader, never by the
// dashboard or received payload. The salt travels to Python on stdin only.
export function preparePeerCollection(value,host,codexHosts) {
  if(!value || typeof value!=='object' || Array.isArray(value) ||
    Object.keys(value).length!==fields.length+(Object.hasOwn(value,'codexHosts')?1:0) ||
    !fields.every(key=>Object.hasOwn(value,key)) || Object.keys(value).some(key=>!fields.includes(key) && key!=='codexHosts') ||
    fields.slice(0,4).some(key=>!hex(value[key])) || value.host!==host ||
    !['Mac','Windows'].includes(host) ||
    (Object.hasOwn(value,'codexHosts') && (!Array.isArray(value.codexHosts) || value.codexHosts.length!==1 || value.codexHosts[0]!==host)) ||
    (codexHosts!==undefined && (!Array.isArray(codexHosts) || codexHosts.length!==1 || codexHosts[0]!==host)))throw Error('Invalid private collection pairing');
  const {comparisonSalt,...config}=value;
  delete config.codexHosts;
  return {config,readerPrefix:`INVENTORY_SALT = '${comparisonSalt}'\n`};
}
