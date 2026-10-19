const forbiddenNames=new Set(['usage.json','collector.json','collector.config.json','local.config.json','.env','__pycache__','webviewcache','node_modules','.git',
  'private-quota','private-codex','private-sync','private-repair']);

export function forbiddenPackageName(name) {
  return forbiddenNames.has(name.toLowerCase()) || /\.(pdb|jsonl|(?:sqlite3?|db)(?:-wal|-shm|-journal)?)$/i.test(name) ||
    /^private-sync-retired-/i.test(name) || /^private-device-identity(?:$|-)/i.test(name) || /^\.env\./i.test(name);
}

function lowerAscii(bytes) {
  const copy=Buffer.from(bytes);
  for(let i=0;i<copy.length;i++)if(copy[i]>=65 && copy[i]<=90)copy[i]+=32;
  return copy;
}

export function containsBuildPath(bytes,roots) {
  const markers=roots.filter(value=>typeof value==='string' && value.length>5)
    .flatMap(value=>[value,value.replaceAll('\\','/'),value.replaceAll('/','\\')])
    .flatMap(value=>[value,JSON.stringify(value).slice(1,-1)])
    .flatMap(value=>[lowerAscii(Buffer.from(value)),lowerAscii(Buffer.from(value,'utf16le'))]);
  const folded=lowerAscii(bytes);
  return markers.some(marker=>folded.includes(marker));
}
