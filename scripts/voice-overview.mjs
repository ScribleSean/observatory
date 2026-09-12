import {cleanWispr,summarizeWispr} from './wispr.mjs';

const hosts=['Mac','Windows'];
const tools=['Wispr Flow','ChatGPT'];
const validDay=value=>typeof value==='string' && /^\d{4}-\d\d-\d\d$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;

// A view projection, not a new collector. Never infer voice from app activity.
// Aggregate-only Wispr stores lack evidence for cross-device deduplication.
/**
 * @param {any[]} raw
 * @param {{host?:string,tool?:string,period?:string,date?:string|null}} options
 */
export function voiceOverview(raw=[],{host='All',tool='All',period='week',date=null}={}) {
  if(!Array.isArray(raw) || !['All',...hosts].includes(host) || !['All',...tools].includes(tool) ||
    !['day','week','all'].includes(period) || (date!==null && !validDay(date)))throw Error('Invalid voice scope');
  const sources=(host==='All'?hosts:[host]).flatMap(device=>(tool==='All'?tools:[tool]).map(provider=>{
    const base={host:device,source:provider};
    if(provider==='ChatGPT')return {...base,status:'not-supported',days:[],checkedAt:null};
    const matches=raw.filter(row=>row?.host===device && row?.source===provider);
    if(matches.length!==1)return {...base,status:matches.length?'ambiguous':'not-connected',days:[],checkedAt:null};
    try {
      const safe=cleanWispr(matches[0],device);
      const checkedAt=typeof matches[0].checkedAt==='string' && Number.isFinite(Date.parse(matches[0].checkedAt))?matches[0].checkedAt:null;
      return {...base,status:safe.status,days:safe.days??[],checkedAt};
    } catch {return {...base,status:'unavailable',days:[],checkedAt:null};}
  }));
  const dates=[...new Set(sources.flatMap(row=>row.days.map(day=>day.date)))].sort();
  const end=date??dates.at(-1)??null;
  const start=end && period!=='all'?new Date(Date.parse(end+'T12:00:00Z')-(period==='week'?6:0)*86400000).toISOString().slice(0,10):null;
  const breakdown=sources.map(source=>{
    const days=source.days.filter(day=>period==='all' || (start && end && day.date>=start && day.date<=end));
    const totals=summarizeWispr({...source,days});
    const safe=totals && ['transcriptions','words','audioSeconds','wordRecords','audioRecords'].every(key=>
      Number.isFinite(totals[key]) && totals[key]>=0 && totals[key]<=Number.MAX_SAFE_INTEGER);
    return {host:source.host,source:source.source,status:source.status,checkedAt:source.checkedAt,days,
      records:safe?totals.transcriptions:null,words:safe&&totals.wordRecords>0?totals.words:null,
      audioSeconds:safe&&totals.audioRecords>0?totals.audioSeconds:null,
      wordRecords:safe?totals.wordRecords:null,audioRecords:safe?totals.audioRecords:null};
  });
  return {version:1,host,tool,period,start,end,dates,sources:breakdown,
    // No supported reader currently establishes all-tools speech-only time.
    voiceSeconds:null,coverage:'partial',reportingSources:breakdown.filter(source=>source.records!==null).length,
    daily:breakdown.flatMap(source=>source.days.map(day=>({host:source.host,source:source.source,date:day.date,
      audioSeconds:day.audioRecords>0?day.audioSeconds:null,words:day.wordRecords>0?day.words:null,records:day.transcriptions})))
      .sort((a,b)=>a.date.localeCompare(b.date)||a.source.localeCompare(b.source)||a.host.localeCompare(b.host))};
}
