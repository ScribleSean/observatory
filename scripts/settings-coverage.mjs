export function settingsCoverage(model, rows) {
  const fields=['inputTokens','cacheReadTokens','cacheCreationTokens','outputTokens','totalTokens'];
  const valid=n=>typeof n==='number' && Number.isFinite(n) && n>=0;
  const total=key=>rows.reduce((sum,row)=>sum+(valid(row[key])?row[key]:NaN),0);
  if (!rows.length || model.inferred) return {status:'missing', rows:[], knownTokens:0};
  if (fields.some(key=>!valid(model[key]) || !Number.isFinite(total(key)) || total(key)>model[key]))
    return {status:'unreconciled',rows:[],knownTokens:0};
  const knownTokens=total('totalTokens');
  return {status:fields.every(key=>total(key)===model[key])?'matched':'partial',rows,knownTokens};
}
