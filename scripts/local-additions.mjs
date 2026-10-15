import {attachTokenHours} from './token-hours.mjs';
import {REFUSAL_CODES} from './refusal-codes.mjs';

const rows=['activity','tokens','settings','dictation'];
export function captureLocalAdditions(data,host) {
  const tokens=data.tokens?.find(row=>row.host===host);
  return {hours:(tokens?.days??[]).filter(day=>Array.isArray(day.hours)).map(day=>({date:day.date,hours:[...day.hours]})),
    refusals:rows.flatMap(key=>(data[key]??[]).filter(row=>row.host===host && row.status!=='ok' && REFUSAL_CODES.includes(row.refusal))
      .map(row=>({key,source:row.source,refusal:row.refusal})))};
}

export function reapplyLocalAdditions(data,host,captured) {
  if(!['Mac','Windows'].includes(host))return;
  if(data.tokens)data.tokens=data.tokens.map(row=>row.host===host?attachTokenHours(row,captured.hours):row);
  for(const {key,source,refusal} of captured.refusals) {
    if(!rows.includes(key) || !REFUSAL_CODES.includes(refusal))continue;
    for(const row of data[key]??[])if(row.host===host && row.source===source && row.status!=='ok')row.refusal=refusal;
  }
}
