import {isDeepStrictEqual} from 'node:util';
import {cleanActivity,cleanSettings} from './collect-dashboard.mjs';
import {tokensFromSettings} from './windows-snapshot.mjs';
import {cleanWispr} from './wispr.mjs';
import {validatePeerInventory,combinePeerTokens} from './peer-inventory.mjs';
import {combineActivity} from './combine-activity.mjs';
import {combineSettings} from './combine-tokens.mjs';
import {retainActivityHistory} from './activity-history.mjs';

const counters=['inputTokens','cacheReadTokens','cacheCreationTokens','outputTokens','reasoningOutputTokens','totalTokens'];
const validDate=value=>typeof value==='string' && /^\d{4}-\d\d-\d\d$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
const timestamp=value=>typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
const absent=(host,status='unavailable')=>({host,status});
const unavailableStatus=value=>['unavailable','not-connected'].includes(value);

function configuration(config) {
  if(!config || !['Mac','Windows'].includes(config.host) || !/^[a-f0-9]{64}$/.test(config.comparisonId) ||
    !Array.isArray(config.codexHosts) || ![1,2].includes(config.codexHosts.length) ||
    new Set(config.codexHosts).size!==config.codexHosts.length || !config.codexHosts.includes(config.host) ||
    config.codexHosts.some(host=>host!==config.host && !(config.host==='Windows' && host==='Ubuntu')))
    throw Error('Invalid peer payload configuration');
}

function activity(raw,host) {
  if(unavailableStatus(raw?.status))return absent(host,raw.status);
  if(raw?.status!=='ok' || !Array.isArray(raw.intervals))throw Error('Invalid peer activity');
  const safe=cleanActivity(raw,host);
  const intervals=safe.intervals.map(row=>({...row,start:new Date(row.start).toISOString(),end:new Date(row.end).toISOString()}));
  const result={host,status:'ok',start:new Date(Date.parse(safe.start)).toISOString(),
    end:new Date(Date.parse(safe.end)).toISOString(),latestEvent:safe.latestEvent,intervals};
  if(safe.trackingIntervals)result.trackingIntervals=safe.trackingIntervals.map(row=>({
    start:new Date(row.start).toISOString(),end:new Date(row.end).toISOString()}));
  return result;
}

function codex(raw,host,comparisonId) {
  if(unavailableStatus(raw?.status))return absent(host,raw.status);
  if(raw?.status!=='ok' || !Array.isArray(raw.profiles) || raw.profiles.length>50000 ||
    !Array.isArray(raw.tools) || raw.tools.length>100000)throw Error('Invalid peer Codex data');
  const safe=cleanSettings(raw,host);
  if(safe.profiles.length!==raw.profiles.length || safe.tools.length!==raw.tools.length ||
    safe.profiles.some(row=>!validDate(row.date) || counters.some(key=>!Number.isSafeInteger(row[key]))) ||
    safe.tools.some(row=>!validDate(row.date)))throw Error('Invalid peer counters');
  const tokens=tokensFromSettings(safe,host);
  if(tokens.days.some(row=>counters.some(key=>!Number.isSafeInteger(row[key]))))throw Error('Overflowed peer counters');
  const evidence={version:1,comparisonId,host,status:raw.inventory?.status,
    keys:raw.inventory?.keys,parents:raw.inventory?.parents};
  const inventory=validatePeerInventory(evidence,host,comparisonId);
  return {...safe,inventory};
}

// Outbound construction strips fields through the existing source cleaners.
// Only this private payload carries intervals and keyed comparison inventories.
export function createPeerPayload(raw,config) {
  configuration(config);
  if(!raw || !timestamp(raw.collectedAt) || !Array.isArray(raw.codex) || raw.codex.length!==config.codexHosts.length)
    throw Error('Invalid peer payload');
  const sources=config.codexHosts.map(host=>{
    const matches=raw.codex.filter(row=>row?.host===host);
    if(matches.length!==1)throw Error('Missing peer source');
    return codex(matches[0],host,config.comparisonId);
  });
  const names=['Wispr Flow'];
  if(!Array.isArray(raw.dictation) || raw.dictation.length!==names.length)throw Error('Invalid peer dictation');
  const dictation=names.map(source=>{
    const matches=raw.dictation.filter(row=>row?.source===source);
    if(matches.length!==1)throw Error('Missing peer dictation');
    return {...cleanWispr(matches[0],config.host),source};
  });
  return {version:1,host:config.host,comparisonId:config.comparisonId,collectedAt:raw.collectedAt,
    activity:activity(raw.activity,config.host),codex:sources,dictation};
}

// Incoming bytes must already have an authenticated transport identity. Reject
// any difference from the allowlisted form instead of silently accepting extras.
export function parsePeerPayload(text,config,now=Date.now()) {
  if(typeof text!=='string' || Buffer.byteLength(text)>16_000_000 || !Number.isFinite(now))throw Error('Invalid peer payload size');
  const raw=JSON.parse(text),safe=createPeerPayload(raw,config);
  if(!isDeepStrictEqual(raw,safe) || Date.parse(safe.collectedAt)>now+300000)throw Error('Invalid peer payload fields');
  return safe;
}

// Pure dashboard construction shared by both native collectors. Callers retain
// private peer state separately and publish only this sanitized projection.
export function mergePeerPayloads(local,peer,localConfig,peerConfig,previous=[],now=Date.now()) {
  if(localConfig.host===peerConfig.host || localConfig.comparisonId!==peerConfig.comparisonId)throw Error('Invalid peer pair');
  const payloads=[parsePeerPayload(JSON.stringify(local),localConfig,now),parsePeerPayload(JSON.stringify(peer),peerConfig,now)]
    .sort((a,b)=>a.host.localeCompare(b.host));
  const checked=source=>({...source,checkedAt:payloads.find(p=>p.host===(source.host==='Ubuntu'?'Windows':source.host)).collectedAt});
  const normalized=payloads.map(p=>checked(p.activity.status==='ok'?cleanActivity(p.activity,p.host):p.activity));
  const activity=normalized.map(({intervals,trackingIntervals,...safe})=>safe);
  const settings=payloads.flatMap(p=>p.codex.map(({inventory,...safe})=>checked(safe)));
  const tokens=settings.map(source=>source.status==='ok'?{...tokensFromSettings(source,source.host),checkedAt:source.checkedAt}:{...absent(source.host,source.status),checkedAt:source.checkedAt});
  const expectedHosts=[...localConfig.codexHosts,...peerConfig.codexHosts];
  const evidence=payloads.flatMap(p=>p.codex.filter(row=>row.status==='ok').map(row=>({version:1,comparisonId:p.comparisonId,host:row.host,...row.inventory})));
  const fresh=payloads.every(p=>now-Date.parse(p.collectedAt)<=600000);
  const combined=fresh?combineActivity(normalized):absent('Combined');
  const combinedTokens=fresh?combinePeerTokens(tokens,evidence,localConfig.comparisonId,expectedHosts):absent('All');
  const combinedSettings=combinedTokens.status==='ok'?combineSettings(tokens,settings):absent('All');
  if(!tokens.some(source=>source.host==='Ubuntu'))tokens.push(absent('Ubuntu','not-connected'));
  const collectedAt=new Date(now).toISOString();
  const data={schema:2,timezone:'America/New_York',collectedAt,activity,combined,tokens,combinedTokens,settings,combinedSettings,
    dictation:payloads.flatMap(p=>p.dictation.map(checked)),agents:[],agentSource:absent('Local','not-connected'),
    quota:absent('Codex account','not-connected'),localModel:absent('Ubuntu','not-connected')};
  data.activityHistory=['Combined','Mac','Windows'].map(host=>{
    const source=host==='Combined'?combined:activity.find(row=>row.host===host);
    const asOf=host==='Combined'?payloads.map(p=>p.collectedAt).sort()[0]:source.checkedAt;
    return retainActivityHistory(previous,[source],asOf).find(row=>row.host===host);
  });
  return data;
}
