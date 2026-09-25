import {cleanSettings} from './collect-dashboard.mjs';
import {estimate} from './api-estimate.mjs';

const fields=['inputTokens','cacheReadTokens','cacheCreationTokens','outputTokens','reasoningOutputTokens','totalTokens'];

// Both token and settings views come from the same read of saved log events.
export function tokensFromSettings(raw,host) {
  const settings=cleanSettings(raw,host);
  const profiles=settings.tokenProfiles || settings.profiles;
  const days=new Map();
  for(const profile of profiles) {
    if(fields.some(key=>profile[key]===null) ||
      profile.inputTokens+profile.cacheReadTokens+profile.cacheCreationTokens+profile.outputTokens!==profile.totalTokens ||
      profile.reasoningOutputTokens>profile.outputTokens)throw Error('Inconsistent saved token counters');
    const day=days.get(profile.date) || {date:profile.date,models:new Map(),...Object.fromEntries(fields.map(key=>[key,0]))};
    const model=day.models.get(profile.model) || {model:profile.model,inferred:profile.model==='unknown',...Object.fromEntries(fields.map(key=>[key,0]))};
    for(const key of fields) {day[key]+=profile[key];model[key]+=profile[key];}
    day.models.set(profile.model,model);days.set(profile.date,day);
  }
  return {host,status:'ok',reader:'saved-log-events',scope:settings.tokenProfiles ? 'All retained saved Codex logs only' : 'Recent saved Codex logs only',
    days:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(day=>{
      const models=[...day.models.values()].map(model=>({...model,apiEstimate:estimate([model])}));
      return {...day,models,apiEstimate:estimate(models)};
    })};
}

export function windowsCollectorConfig(raw={}) {
  const distro=raw.wslDistribution;
  const quotaDistro=raw.quotaWslDistribution;
  if(distro!==undefined && distro!==null && (typeof distro!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(distro)))throw Error('Invalid WSL distribution');
  if(quotaDistro!==undefined && quotaDistro!==null && (typeof quotaDistro!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(quotaDistro)))throw Error('Invalid quota WSL distribution');
  for(const key of ['activity','codex','claude','wispr','typewhisper','quota'])if(raw[key]!==undefined && typeof raw[key]!=='boolean')throw Error('Invalid source setting');
  return {activity:raw.activity!==false,codex:raw.codex!==false,claude:raw.claude===true,wispr:raw.wispr===true,wslDistribution:distro || null,quota:raw.quota===true,quotaWslDistribution:quotaDistro || null};
}
