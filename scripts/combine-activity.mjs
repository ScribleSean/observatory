import {categories,appLabels,summarizeTracked} from './activity-timeline.mjs';

const unavailable=()=>({host:'Combined',status:'unavailable'});

export function combineActivity(sources) {
  if(!Array.isArray(sources) || sources.length!==2 ||
    ['Mac','Windows'].some(host=>sources.filter(source=>source?.host===host).length!==1))return unavailable();
  try {
    const windows=sources.map(source=>{
      const start=Date.parse(source.start),end=Date.parse(source.end);
      if(source.status!=='ok' || !Number.isFinite(start) || !Number.isFinite(end) ||
        end<=start || end-start>7*86400000+1000)throw Error('Invalid source window');
      return {start,end};
    });
    const start=Math.max(...windows.map(window=>window.start));
    const end=Math.min(...windows.map(window=>window.end));
    if(end<=start)return unavailable();
    const rows=(source,key,tracking=false)=>{
      const values=source[key];
      if(!Array.isArray(values) || values.length>200000)throw Error('Invalid normalized intervals');
      return values.map(row=>{
        if(!row || !Number.isFinite(row.start) || !Number.isFinite(row.end) || row.end<row.start ||
          (!tracking && !categories.includes(row.category)))throw Error('Invalid normalized interval');
        return {start:Math.max(start,row.start),end:Math.min(end,row.end),
          category:tracking?'Other':row.category,
          app:!tracking && appLabels.includes(row.app)?row.app:'Unknown app'};
      }).filter(row=>row.end>row.start);
    };
    const intervals=sources.flatMap(source=>rows(source,'intervals'));
    const tracking=sources.every(source=>Array.isArray(source.trackingIntervals))
      ?sources.flatMap(source=>rows(source,'trackingIntervals',true)):undefined;
    const lo=new Date(start).toISOString(),hi=new Date(end).toISOString();
    return {host:'Combined',status:'ok',start:lo,end:hi,...summarizeTracked(intervals,tracking,lo,hi)};
  } catch { return unavailable(); }
}
