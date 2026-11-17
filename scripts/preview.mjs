import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLocalServer} from '../serve-local.mjs';
import {combine} from '../lib/combine.mjs';
import {ownSnapshot} from '../test/helpers.mjs';
import {syntheticSessions} from '../test/synthetic-sessions.mjs';

const now=Date.now();
const dataFolder=await mkdtemp(path.join(tmpdir(),'observatory-preview-'));
await mkdir(path.join(dataFolder,'public','local'),{recursive:true});
const ago=minutes=>new Date(now-minutes*60000).toISOString();
const NAMES={Mac:'Studio Mac',Windows:'Desk PC'};
const named=host=>snapshot=>({...snapshot,device:{host,name:NAMES[host]},deviceNames:{[host]:NAMES[host]}});
const mac=ownSnapshot('Mac',now,named('Mac'));
const pc=ownSnapshot('Windows',now-4*60000,named('Windows'));
// How fast each fictional week spends its weekly limit. One Claude week runs out, and the current one is on pace to.
const WEEK_PACE={claude:[0.2,0.34,0.22,0.25,0.325],codex:[0.07,0.09,0.06,0.08,0.07]};
function fictionalHistory(host) {
  const points=[];
  let seed=11;
  const random=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
  const start=now-32*86400000-137*60000;
  for(const [p,w5,ww] of [['claude','five_hour','seven_day'],['codex','primary','secondary']]) {
    let reset5=start,left5=100,resetWeek=start,leftWeek=100;
    for(let t=start;t<=now-60000;t+=(now-t<=2*3600000?5:15)*60000) {
      const date=new Date(t),hour=date.getHours(),day=date.getDay();
      const working=hour>=8 && hour<23;
      if(t-reset5>=5*3600000) {reset5=t;left5=100;}
      if(t-resetWeek>=7*86400000) {resetWeek=t;leftWeek=100;}
      const burn=working?(p==='claude'?1.6:0.9)*random():0;
      left5=Math.max(0,left5-burn*2.2);leftWeek=Math.max(0,leftWeek-burn*WEEK_PACE[p][Math.floor((t-start)/(7*86400000))%5]);
      const uses=host==='Mac'?working:working && day>0 && day<6 && hour>=9 && hour<18;
      if(!uses || (host!=='Mac' && t+4*60000>now-4*60000))continue;
      const at=new Date(t+(host==='Mac'?0:4*60000)).toISOString();
      points.push({p,w:w5,o:host,t:at,r:Math.round(left5*10)/10,x:new Date(reset5+5*3600000).toISOString(),d:300},
        {p,w:ww,o:host,t:at,r:Math.round(leftWeek*10)/10,x:new Date(resetWeek+7*86400000).toISOString(),d:10080});
    }
    if(host==='Mac')points.push({p,w:w5,o:host,t:new Date(now-60000).toISOString(),r:Math.round(left5*10)/10,x:new Date(reset5+5*3600000).toISOString(),d:300},
      {p,w:ww,o:host,t:new Date(now-60000).toISOString(),r:Math.round(leftWeek*10)/10,x:new Date(resetWeek+7*86400000).toISOString(),d:10080});
  }
  return [{host,status:'ok',checkedAt:new Date(now).toISOString(),points}];
}
mac.limitHistory=fictionalHistory('Mac');pc.limitHistory=fictionalHistory('Windows');
for(const [key,provider] of [['claudeLimits','claude'],['quota','codex']]) {
  const source=mac[key];
  if(!source?.windows)continue;
  const latest=new Map();
  for(const point of mac.limitHistory[0].points)if(point.p===provider)latest.set(point.w,point);
  source.status='ok';source.checkedAt=new Date(now-60000).toISOString();
  delete source.history;
  source.windows=source.windows.map(row=>{
    const point=latest.get(row.window);
    if(!point)return row;
    let reset=Date.parse(point.x);
    while(reset<=now)reset+=(point.d ?? 300)*60000;
    return {...row,remainingPercent:point.r,resetsAt:new Date(reset).toISOString(),checkedAt:source.checkedAt};
  });
}

const untracked=day=>({...day,seconds:0,trackedSeconds:0,hours:Array(24).fill(0),categories:{},apps:{}});
const gapDate=mac.activity.find(row=>row.host==='Mac')?.days?.[3]?.date;
for(const snapshot of [mac,pc])for(const row of [...(snapshot.activity??[]),...(snapshot.activityHistory??[]),snapshot.combined].filter(Boolean))
  if(Array.isArray(row.days))row.days=row.days.map(day=>day.date===gapDate?untracked(day):day);

// A year of token days for the History page: the sample's days repeated into the past, with fewer recorded days further back.
function fictionalYear(row,seed) {
  if(!Array.isArray(row.days) || row.days.length<2)return row;
  const random=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
  const newest=Date.parse(`${row.days[0].date}T12:00:00Z`);
  const older=[];
  for(let index=row.days.length;index<365;index++) {
    const date=new Date(newest-index*86400000);
    const weekend=date.getUTCDay()%6===0;
    const recorded=(index>250?0.3:index>120?0.62:0.94)*(weekend?0.5:1);
    if(random()<recorded)older.push({...row.days[1+index%(row.days.length-1)],date:date.toISOString().slice(0,10)});
  }
  return {...row,days:[...row.days,...older]};
}
// The sample's days repeat a fixed pattern, which draws as a sawtooth. Real use is uneven: quiet weekends,
// a level that drifts, the odd heavy day and a model mix that moves. Totals stay the sum of their parts.
const COUNTS=['inputTokens','cacheReadTokens','cacheCreationTokens','outputTokens','reasoningOutputTokens','requestCount'];
function scaled(item,factor) {
  const out={...item};
  for(const field of COUNTS)if(typeof out[field]==='number')out[field]=Math.round(out[field]*factor);
  out.totalTokens=out.inputTokens+out.cacheReadTokens+out.cacheCreationTokens+out.outputTokens;
  if(item.apiEstimate)out.apiEstimate={...item.apiEstimate,usd:item.apiEstimate.usd*factor,coveredTokens:out.totalTokens,
    parts:Object.fromEntries(Object.entries(item.apiEstimate.parts).map(([part,value])=>[part,value*factor]))};
  return out;
}
function unevenDays(row,seed) {
  if(!Array.isArray(row.days))return row;
  const random=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
  let drift=1,mix=0.55;
  const days=row.days.map(day=>{
    if(!Array.isArray(day.models) || day.models.length===0)return day;
    const weekend=new Date(`${day.date}T12:00:00Z`).getUTCDay()%6===0;
    drift=Math.min(1.5,Math.max(0.55,drift+(random()-0.5)*0.3));
    mix=Math.min(0.85,Math.max(0.25,mix+(random()-0.5)*0.2));
    const heavy=random()<0.09?1.5+random():1;
    const level=(weekend?0.15+random()*0.4:0.6+random()*0.75)*drift*heavy;
    const share=index=>day.models.length===1?1:index===0?mix:(1-mix)/(day.models.length-1);
    const models=day.models.map((model,index)=>scaled(model,level*share(index)*day.models.length));
    const sum=field=>models.reduce((total,model)=>total+model[field],0);
    const out={...day,models};
    for(const field of [...COUNTS,'totalTokens'])if(typeof day[field]==='number')out[field]=sum(field);
    if(day.apiEstimate)out.apiEstimate={...day.apiEstimate,usd:models.reduce((total,model)=>total+model.apiEstimate.usd,0),coveredTokens:out.totalTokens,
      parts:Object.fromEntries(Object.keys(day.apiEstimate.parts).map(part=>[part,models.reduce((total,model)=>total+model.apiEstimate.parts[part],0)]))};
    if(Array.isArray(day.hours)) {
      // Each hour moves a little, and the hours still add up to the day.
      const rough=day.hours.map(value=>value*(0.55+random()*0.9));
      const whole=rough.reduce((total,value)=>total+value,0);
      const hours=rough.map(value=>whole?Math.floor(value*out.totalTokens/whole):0);
      const last=hours.findLastIndex(value=>value>0);
      if(last>=0)hours[last]+=out.totalTokens-hours.reduce((total,value)=>total+value,0);
      out.hours=hours;
    }
    return out;
  });
  return {...row,days};
}
for(const [snapshot,seed] of [[mac,3],[pc,5]])for(const key of ['tokens','providerTokenSources'])
  snapshot[key]=snapshot[key].map((row,index)=>unevenDays(fictionalYear(row,seed+index*2+(key==='tokens'?0:11)),97+seed*13+index*5+(key==='tokens'?0:29)));

mac.collectedAt=ago(1);pc.collectedAt=ago(4);
// PREVIEW_COLLISION=folder|branch|repo shows the same-repo line with fictional sessions. Without it no line appears.
if(process.env.PREVIEW_COLLISION) {
  const row=(host,sessions)=>[{host,status:'ok',checkedAt:ago(1),sessions}];
  const scene=syntheticSessions(process.env.PREVIEW_COLLISION);
  mac.sessions=row('Mac',scene.Mac);pc.sessions=row('Windows',scene.Windows);
}
const devices=process.env.PREVIEW_ONE?[{host:'Mac',snapshot:mac}]:[{host:'Mac',snapshot:mac},{host:'Windows',snapshot:pc}];
const combined=combine(devices,{now,generatedBy:'Mac'});
await writeFile(path.join(dataFolder,'public','local','combined.json'),JSON.stringify(combined));
if(process.env.PREVIEW_OUT) {
  await writeFile(process.env.PREVIEW_OUT,JSON.stringify(combined));
  console.log(`Fictional combined.json written to ${process.env.PREVIEW_OUT}`);
  process.exit(0);
}
const port=Number(process.env.PORT || 5602);
createLocalServer({dataFolder}).listen(port,'127.0.0.1',()=>console.log(`Fictional preview: http://127.0.0.1:${port}`));
