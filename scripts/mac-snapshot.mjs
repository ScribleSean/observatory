import {cleanActivity,cleanSettings} from './collect-dashboard.mjs';
import {tokensFromSettings} from './windows-snapshot.mjs';
import {cleanWispr} from './wispr.mjs';
import {retainActivityHistory} from './activity-history.mjs';
import {createPeerPayload} from './peer-payload.mjs';

export function macCollectorConfig(raw) {
  const keys=['activity','codex','wispr','typewhisper','quota','receipts','benchmarks'];
  if(!raw || typeof raw!=='object' || Array.isArray(raw) ||
    Object.keys(raw).some(key=>!keys.includes(key) || typeof raw[key]!=='boolean'))throw Error('Invalid local Mac source settings');
  // Accept the retired boolean only for reading existing configuration.
  return {activity:raw.activity!==false,codex:raw.codex!==false,wispr:raw.wispr===true,quota:raw.quota===true,
    receipts:raw.receipts===true,benchmarks:raw.benchmarks===true};
}

export async function macSnapshot(rawConfig,readers,previous=[],at=new Date().toISOString(),peerConfig=null) {
  const config=macCollectorConfig(rawConfig);
  if(!Number.isFinite(Date.parse(at)))throw Error('Invalid collection time');
  const disconnected=host=>({host,status:'not-connected'});
  const unavailable=host=>({host,status:'unavailable',checkedAt:at});
  let peerActivity,peerCodex;
  const read=async(key,clean)=>{
    if(!config[key])return disconnected('Mac');
    try{return {...clean(await readers[key]()),checkedAt:at};}catch{return unavailable('Mac');}
  };
  const [activity,settings,wispr]=await Promise.all([
    read('activity',raw=>{
      const {intervals,trackingIntervals,...safe}=cleanActivity(raw,'Mac');
      if(peerConfig)peerActivity={...raw,status:'ok'};
      return safe;
    }),
    read('codex',raw=>{
      const safe=cleanSettings(raw,'Mac');tokensFromSettings(safe,'Mac');
      if(peerConfig)peerCodex={...safe,inventory:raw.inventory};
      return safe;
    }),
    read('wispr',raw=>cleanWispr(raw,'Mac')),
  ]);
  let tokens=settings.status==='ok'?null:{host:'Mac',status:settings.status,checkedAt:at};
  if(!tokens)try{tokens={...tokensFromSettings(settings,'Mac'),checkedAt:at};}catch{tokens=unavailable('Mac');}
  const data={schema:2,timezone:'America/New_York',collectedAt:at,
    activity:[activity,disconnected('Windows')],combined:unavailable('Combined'),
    tokens:[tokens,disconnected('Windows'),disconnected('Ubuntu')],combinedTokens:unavailable('All'),
    settings:[settings],combinedSettings:unavailable('All'),
    dictation:[{...wispr,source:'Wispr Flow'}],
    agents:[],agentSource:disconnected('Local'),quota:disconnected('Codex account'),localModel:disconnected('Ubuntu')};
  data.activityHistory=retainActivityHistory(previous,data.activity,at);
  const sources=[...data.activity,...data.tokens,...data.settings,...data.dictation].filter(source=>source.status!=='not-connected');
  const sourcesRead=sources.filter(source=>source.status==='ok').length;
  const result={data,status:{state:sources.length && sourcesRead===sources.length?'ok':'partial',sourcesRead,sourcesConfigured:sources.length}};
  if(peerConfig) {
    // This separate return value must never be included in dashboard JSON.
    // Failed peer export must not prevent independent local collection.
    try {
      if(peerConfig.host!=='Mac')throw Error('Wrong local peer identity');
      result.peer={status:'ready',payload:createPeerPayload({collectedAt:new Date(at).toISOString(),
        activity:peerActivity || {status:activity.status},codex:[peerCodex || {host:'Mac',status:settings.status}],
        dictation:[{...wispr,source:'Wispr Flow'}]},peerConfig)};
    } catch {result.peer={status:'unavailable'};}
  }
  return result;
}
