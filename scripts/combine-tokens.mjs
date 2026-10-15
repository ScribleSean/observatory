import {estimate} from './api-estimate.mjs';
import {settingsCoverage} from './settings-coverage.mjs';

const fields = ['inputTokens','cacheReadTokens','cacheCreationTokens','outputTokens','reasoningOutputTokens','totalTokens'];
const valid = n => Number.isSafeInteger(n) && n >= 0;
const empty = () => Object.fromEntries(fields.map(k=>[k,0]));
const add = (target, row) => fields.forEach(k=>{target[k]+=row[k];});

export function verifyHostInventory(sources, inventories, expectedHosts=['Mac','Windows']) {
  // Pair configuration defines coverage. Never infer it from whichever peers responded.
  if (!Array.isArray(expectedHosts) || expectedHosts.length!==2 ||
      new Set(expectedHosts).size!==expectedHosts.length ||
      !['Mac','Windows'].every(host=>expectedHosts.includes(host)) ||
      expectedHosts.some(host=>!['Mac','Windows'].includes(host)) ||
      !Array.isArray(sources) || sources.length!==expectedHosts.length ||
      expectedHosts.some(host=>sources.filter(s=>s?.host===host).length!==1) ||
      sources.some(s=>s?.status!=='ok' || !Array.isArray(s.days))) return {status:'unavailable'};
  if (!inventories || typeof inventories!=='object') return {status:'unverified'};
  const rows = sources.map(s=>inventories[s.host]);
  if (rows.some(r=>r?.status!=='ok' || !Array.isArray(r.keys) || !Array.isArray(r.parents) ||
    [...r.keys,...r.parents].some(k=>typeof k!=='string' || !/^[a-f0-9]{64}$/.test(k)))) return {status:'unverified'};
  if (rows.some((r,i)=>!r.keys.length && sources[i].days.some(d=>d.totalTokens>0))) return {status:'unverified'};
  let sharedSessions=0, crossHostParents=0;
  rows.forEach((a,i)=>rows.slice(0,i).forEach(b=>{
    const aKeys=new Set(a.keys), bKeys=new Set(b.keys);
    sharedSessions += [...aKeys].filter(k=>bKeys.has(k)).length;
    crossHostParents += new Set(a.parents.filter(k=>bKeys.has(k))).size;
    crossHostParents += new Set(b.parents.filter(k=>aKeys.has(k))).size;
    crossHostParents += new Set(a.parents.filter(k=>b.parents.includes(k))).size;
  }));
  return {status:sharedSessions || crossHostParents?'overlap':'verified',sharedSessions,crossHostParents};
}

export function combineTokens(sources, inventories, expectedHosts) {
  const verification = verifyHostInventory(sources,inventories,expectedHosts);
  if (verification.status !== 'verified') return {host:'All',status:verification.status,verification};
  const days=new Map();
  for (const source of sources) for (const row of source.days) {
    // A successful source read with no row means no recorded usage on that day.
    // A malformed row is unknown, never silently treated as zero.
    if (fields.some(k=>!valid(row[k])) || !Array.isArray(row.models) ||
        row.models.some(m=>fields.some(k=>!valid(m[k]))) ||
        fields.some(k=>row.models.reduce((n,m)=>n+m[k],0)!==row[k]))
      return {host:'All',status:'inconsistent',verification};
    const day=days.get(row.date) || {date:row.date,...empty(),models:new Map()};
    add(day,row);
    if(fields.some(k=>!valid(day[k])))return {host:'All',status:'inconsistent',verification};
    for (const m of row.models) {
      const key=m.model+':'+Boolean(m.inferred);
      const model=day.models.get(key) || {model:m.model,inferred:Boolean(m.inferred),...empty()};
      add(model,m);
      if(fields.some(k=>!valid(model[k])))return {host:'All',status:'inconsistent',verification};
      day.models.set(key,model);
    }
    days.set(row.date,day);
  }
  return {host:'All',status:'ok',verification,days:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(d=>{
    const models=[...d.models.values()].map(m=>({...m,apiEstimate:estimate([m])}));
    return {...d,models,apiEstimate:estimate(models)};
  })};
}

export function combineSettings(sources, settings) {
  const profiles=new Map();
  for (const source of sources) {
    const detail=settings.find(s=>s.host===source.host);
    if (detail?.status!=='ok' || detail.snapshotStable===false) continue;
    for (const day of source.days || []) for (const model of day.models) {
      const rows=settingsCoverage(model,(detail.profiles||[]).filter(p=>p.date===day.date && p.model===model.model)).rows;
      for (const row of rows) {
        const key=[row.date,row.model,row.effort,row.speed].join(':');
        const profile=profiles.get(key) || {date:row.date,model:row.model,effort:row.effort,speed:row.speed,...empty()};
        add(profile,row);profiles.set(key,profile);
      }
    }
  }
  return {host:'All',status:'ok',profiles:[...profiles.values()]};
}
