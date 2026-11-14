// Turns daily per-model histograms into a calm trend and the days that differ from the model's own
// recent normal. The normal for a day is the median of the days before it (up to BASELINE_DAYS), and
// the spread is the scaled median absolute deviation (never under MIN_SPREAD_SHARE of the normal, or 1
// per 100 for retries), so one odd day cannot move the line it is judged by.

export const BINS_PER_OCTAVE=6;
export const EFFORTS=['low','medium','high','xhigh','max'];
// Known Claude families only, in either name order, with an optional release date. Anything else (a
// gateway or proxy slug could name a client or project) is not counted.
export const MODEL_NAME=/^claude-(?:\d+-){0,2}(?:opus|sonnet|haiku|fable)(?:-\d+){0,3}$/;
// A dated name and its alias are one model: claude-sonnet-4-5-20250929 joins claude-sonnet-4-5.
export const modelKey=model=>model.replace(/-\d{8}$/,'');
// A day needs this many retries before its retry rate is judged, so one retry on a quiet day is not drift.
export const MIN_RETRIES=3;
export const BASELINE_DAYS=28;
export const MIN_BASELINE_DAYS=7;
// A day needs this many replies (and this many samples of a measure) before it is judged at all.
export const MIN_REPLIES=20;
export const MIN_SAMPLES=10;
export const THRESHOLD=3;
// The spread never counts as smaller than this share of the normal, so small wobbles on a very
// steady model are not flagged. With 6 bins per octave one bin is about 12 percent.
export const MIN_SPREAD_SHARE=0.15;
export const METRICS=['thinking','replySeconds','outputTokens','retries'];

export const binOf=value=>Math.max(0,Math.floor(BINS_PER_OCTAVE*Math.log2(1+value)));
export const valueOfBin=bin=>2**((bin+0.5)/BINS_PER_OCTAVE)-1;

const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);

function histogramOf(pairs) {
  const map=new Map();
  if(!Array.isArray(pairs))return map;
  for(let index=0;index+1<pairs.length;index+=2) {
    const bin=pairs[index],count=pairs[index+1];
    if(Number.isSafeInteger(bin) && bin>=0 && bin<1000 && Number.isSafeInteger(count) && count>0)map.set(bin,(map.get(bin) ?? 0)+count);
  }
  return map;
}

function addHistogram(into,pairs) {
  for(const [bin,count] of histogramOf(pairs))into.set(bin,(into.get(bin) ?? 0)+count);
}

export function histogramMedian(map) {
  const total=[...map.values()].reduce((sum,count)=>sum+count,0);
  if(!total)return {value:null,count:0};
  let seen=0;
  for(const bin of [...map.keys()].sort((a,b)=>a-b)) {
    seen+=map.get(bin);
    if(seen*2>=total)return {value:valueOfBin(bin),count:total};
  }
  return {value:null,count:0};
}

const median=values=>{
  const sorted=[...values].sort((a,b)=>a-b);
  const middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
};

// Rows from every computer, merged into model -> date -> totals. Each computer reads only its own
// transcripts, so adding them counts no reply twice.
export function mergeDriftRows(rows) {
  const models=new Map();
  for(const row of Array.isArray(rows)?rows:[]) {
    if(!object(row) || row.status!=='ok' || !Array.isArray(row.days))continue;
    for(const day of row.days) {
      if(!object(day) || typeof day.date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Array.isArray(day.models))continue;
      for(const entry of day.models) {
        if(!object(entry) || !MODEL_NAME.test(entry.model ?? ''))continue;
        const key=modelKey(entry.model);
        const dates=models.get(key) ?? new Map();
        models.set(key,dates);
        const total=dates.get(day.date) ?? {replies:0,retries:0,thinking:new Map(),replySeconds:new Map(),outputTokens:new Map(),efforts:{}};
        dates.set(day.date,total);
        if(Number.isSafeInteger(entry.replies) && entry.replies>0)total.replies+=entry.replies;
        if(Number.isSafeInteger(entry.retries) && entry.retries>0)total.retries+=entry.retries;
        for(const key of ['thinking','replySeconds','outputTokens'])addHistogram(total[key],entry[key]);
        if(object(entry.efforts))for(const [name,count] of Object.entries(entry.efforts))
          if([...EFFORTS,'other','unset'].includes(name) && Number.isSafeInteger(count) && count>0)total.efforts[name]=(total.efforts[name] ?? 0)+count;
      }
    }
  }
  return models;
}

function dayValue(total,metric) {
  if(total.replies<MIN_REPLIES)return null;
  if(metric==='retries')return 100*total.retries/total.replies;
  const {value,count}=histogramMedian(total[metric]);
  return count>=MIN_SAMPLES?value:null;
}

const topEffort=efforts=>{
  const entries=Object.entries(efforts).filter(([name])=>name!=='unset');
  const total=entries.reduce((sum,[,count])=>sum+count,0);
  if(!total)return null;
  const [name,count]=entries.sort((a,b)=>b[1]-a[1])[0];
  return {name,share:count/total};
};

// Every model with its daily series and flags, busiest model first. `dates` are the calendar days
// shown, oldest first, so a day with no replies is a gap rather than a zero.
export function driftView(rows,{dates}) {
  const result=[];
  for(const [model,byDate] of mergeDriftRows(rows)) {
    const series={},flags=[];
    for(const metric of METRICS) {
      const points=[];
      const history=[];
      const allDates=[...new Set([...byDate.keys(),...dates])].sort((a,b)=>a.localeCompare(b));
      for(const date of allDates) {
        const total=byDate.get(date);
        const value=total?dayValue(total,metric):null;
        const since=lastDays(date,BASELINE_DAYS+1)[0];
        const window=history.filter(item=>item.date<date && item.date>=since);
        let center=null,spread=null,z=null;
        if(window.length>=MIN_BASELINE_DAYS) {
          center=median(window.map(item=>item.value));
          const mad=median(window.map(item=>Math.abs(item.value-center)));
          spread=Math.max(1.4826*mad,MIN_SPREAD_SHARE*center,metric==='retries'?1:0);
          if(value!==null && spread>0)z=(value-center)/spread;
        }
        if(dates.includes(date)) {
          const flagged=z!==null && Math.abs(z)>=THRESHOLD && (metric!=='retries' || total.retries>=MIN_RETRIES);
          points.push({date,value,center,low:center===null?null:Math.max(0,center-THRESHOLD*spread),high:center===null?null:center+THRESHOLD*spread,
            // zero-ok: the reader saw every transcript, so a day with none had no replies.
            replies:total?.replies ?? 0,flagged});
          if(flagged) {
            const usual=window.reduce((efforts,item)=>{for(const [name,count] of Object.entries(item.efforts))efforts[name]=(efforts[name] ?? 0)+count;return efforts;},{});
            const now=topEffort(total.efforts),before=topEffort(usual);
            const effortChanged=Boolean(now && before && (now.name!==before.name || Math.abs(now.share-before.share)>=0.2));
            flags.push({date,metric,value,center,direction:value>center?'up':'down',z,effort:effortChanged?{now,before}:null});
          }
        }
        if(value!==null)history.push({date,value,efforts:total.efforts});
      }
      series[metric]=points;
    }
    const replies=[...byDate.entries()].filter(([date])=>dates.includes(date)).reduce((sum,[,total])=>sum+total.replies,0);
    if(replies>0)result.push({model,replies,series,flags:flags.sort((a,b)=>b.date.localeCompare(a.date))});
  }
  return result.sort((a,b)=>b.replies-a.replies || a.model.localeCompare(b.model));
}

const shortDate=date=>new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
// "Nov 3" for one day, "Nov 3–5" for a run inside one month, "Oct 30–Nov 2" for a run across two.
export function runLabel(first,last) {
  if(first===last)return shortDate(first);
  return `${shortDate(first)}–${first.slice(0,7)===last.slice(0,7)?Number(last.slice(8)):shortDate(last)}`;
}

// The last `count` calendar days ending on `today` (YYYY-MM-DD), oldest first.
export function lastDays(today,count) {
  const [year,month,day]=today.split('-').map(Number);
  return Array.from({length:count},(_,index)=>new Date(Date.UTC(year,month-1,day-(count-1-index))).toISOString().slice(0,10));
}
