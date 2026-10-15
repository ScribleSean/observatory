import {REFUSAL_CODES} from './peer-directory.mjs';
import {cleanActivity,cleanSettings} from './snapshot-clean.mjs';
import {attachTokenHours} from './token-hours.mjs';
import {tokensFromSettings} from './windows-snapshot.mjs';
import {cleanWispr} from './wispr.mjs';
import {retainActivityHistory} from './activity-history.mjs';
import {createPeerPayload} from './peer-payload.mjs';

// Project one set of completed native reads into the public dashboard and,
// optionally, a separate private peer payload. No source is scanned again here.
export function windowsSnapshot(raw,previous=[],at=new Date().toISOString(),peerConfig=null) {
  if(!Number.isFinite(Date.parse(at)))throw Error('Invalid collection time');
  const disconnected=host=>({host,status:'not-connected'});
  const unavailable=host=>({host,status:'unavailable',checkedAt:at});
  const clean=(source,host,transform,accepted=['ok'])=>{
    const checkedAt=typeof source?.checkedAt==='string' && Number.isFinite(Date.parse(source.checkedAt))?source.checkedAt:at;
    if(source?.status==='not-connected')return {...disconnected(host),checkedAt};
    try {
      if(!accepted.includes(source?.status))throw Error('Source unavailable');
      return {...transform(source),checkedAt};
    } catch {return {...unavailable(host),checkedAt,...(REFUSAL_CODES.includes(source?.refusal)?{refusal:source.refusal}:{})};}
  };
  const settingsSource=(source,host)=>clean(source,host,value=>{
    const safe=cleanSettings(value,host);tokensFromSettings(safe,host);return safe;
  });
  const hourTotals=raw.localSettings?.hourTotals;
  const localSettings=settingsSource(raw.localSettings,'Windows');
  const windows=clean(raw.windows,'Windows',value=>{
    const {intervals,trackingIntervals,...safe}=cleanActivity(value,'Windows');return safe;
  });
  const wispr=clean(raw.wispr,'Windows',value=>cleanWispr(value,'Windows'),['ok','not-found','ambiguous','unavailable']);
  const tokenSource=source=>source.status==='ok'?{...tokensFromSettings(source,source.host),checkedAt:source.checkedAt}:
    {host:source.host,status:source.status,checkedAt:source.checkedAt,...(REFUSAL_CODES.includes(source.refusal)?{refusal:source.refusal}:{})};
  const data={schema:2,timezone:'America/New_York',collectedAt:at,
    activity:[disconnected('Mac'),windows],combined:unavailable('Combined'),
    tokens:[disconnected('Mac'),attachTokenHours(tokenSource(localSettings),hourTotals)],combinedTokens:unavailable('All'),
    settings:[localSettings],combinedSettings:unavailable('All'),
    dictation:[{...wispr,source:'Wispr Flow'}],agents:[],agentSource:disconnected('Local'),
    quota:disconnected('Codex account'),localModel:disconnected('Ubuntu')};
  data.activityHistory=retainActivityHistory(previous,data.activity,at);
  const sources=[...data.activity,...data.tokens,...data.settings,...data.dictation].filter(source=>source.status!=='not-connected');
  const read=sources.filter(source=>source.status==='ok').length;
  const result={data,status:{state:sources.length && read===sources.length?'ok':'partial',sourcesRead:read,sourcesConfigured:sources.length}};
  if(peerConfig) {
    try {
      if(peerConfig.host!=='Windows')throw Error('Wrong local peer identity');
      const codex=[localSettings.status==='ok'?{...localSettings,inventory:raw.localSettings.inventory}:localSettings];
      result.peer={status:'ready',payload:createPeerPayload({collectedAt:new Date(at).toISOString(),
        activity:windows.status==='ok'?raw.windows:windows,codex,
        dictation:data.dictation},peerConfig)};
    } catch {result.peer={status:'unavailable'};}
  }
  return result;
}
