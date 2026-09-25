const counters=['inputTokens','cacheReadTokens','cacheCreationTokens','outputTokens','totalTokens','requestCount'];
const tokenCounters=counters.slice(0,-1);
const knownModels=new Set([
  'claude-3-haiku','claude-3-opus','claude-3-sonnet','claude-3-5-haiku','claude-3-5-sonnet',
  'claude-3-7-sonnet','claude-haiku-4-5','claude-opus-4','claude-opus-4-1','claude-sonnet-4','claude-sonnet-4-5',
]);

const valid=value=>Number.isSafeInteger(value) && value>=0;
const validDate=value=>typeof value==='string' && /^\d{4}-\d\d-\d\d$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
const modelName=value=>knownModels.has(value)?value:'unknown';

function row(raw,{model=false}={}) {
  if(!raw || typeof raw!=='object' || Array.isArray(raw) || counters.some(key=>!valid(raw[key])) ||
    raw.inputTokens+raw.cacheReadTokens+raw.cacheCreationTokens+raw.outputTokens!==raw.totalTokens) throw Error('Invalid Claude token record');
  if(model && typeof raw.model!=='string') throw Error('Invalid Claude model');
  return {...(model?{model:modelName(raw.model)}:{}),...Object.fromEntries(counters.map(key=>[key,raw[key]]))};
}

// The reader may retain local implementation fields, but this public projection
// copies only counters and known model names. Its result is intentionally kept
// outside Codex token aggregation and peer payloads.
export function cleanClaudeTokenSource(raw,host,checkedAt=new Date().toISOString()) {
  if(!['Mac','Windows'].includes(host) || !Number.isFinite(Date.parse(checkedAt)) ||
    !raw || typeof raw!=='object' || !Array.isArray(raw.days) || raw.days.length>3660) throw Error('Invalid Claude report');
  const seen=new Set();
  const days=raw.days.map(rawDay=>{
    if(!validDate(rawDay?.date) || seen.has(rawDay.date) || !Array.isArray(rawDay.models) || rawDay.models.length>1000) throw Error('Invalid Claude day');
    seen.add(rawDay.date);
    const day={date:rawDay.date,...row(rawDay),models:rawDay.models.map(model=>row(model,{model:true}))};
    for(const key of counters)if(day.models.reduce((total,model)=>total+model[key],0)!==day[key])throw Error('Inconsistent Claude day');
    return day;
  }).sort((a,b)=>a.date.localeCompare(b.date));
  return {provider:'claude-code',host,status:'ok',checkedAt:new Date(checkedAt).toISOString(),scope:'Recorded Claude Code requests',days};
}

export function unavailableClaudeTokenSource(host,checkedAt=new Date().toISOString(),status='unavailable') {
  if(!['Mac','Windows'].includes(host) || !['unavailable','not-connected'].includes(status) || !Number.isFinite(Date.parse(checkedAt))) throw Error('Invalid Claude source status');
  return {provider:'claude-code',host,status,checkedAt:new Date(checkedAt).toISOString(),scope:'Recorded Claude Code requests'};
}

// Must run after peer finalization and other attachments: those flows can
// reconstruct dashboard JSON and intentionally never export provider records.
export function attachProviderTokenSources(result,sources) {
  if(!result?.data || !result?.status || !Array.isArray(sources)) throw Error('Invalid provider attachment');
  result.data.providerTokenSources=sources;
  const configured=sources.filter(source=>source?.status!=='not-connected');
  result.status.sourcesConfigured+=configured.length;
  result.status.sourcesRead+=configured.filter(source=>source.status==='ok').length;
  result.status.state=result.status.sourcesConfigured>0 && result.status.sourcesConfigured===result.status.sourcesRead?'ok':'partial';
  return result;
}
