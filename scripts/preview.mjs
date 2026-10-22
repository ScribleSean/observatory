// Serve the dashboard with fictional data, for working on the pages.
// Writes nothing outside a temporary folder.
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLocalServer} from '../serve-local.mjs';
import {combine} from '../lib/combine.mjs';
import {ownSnapshot} from '../test/helpers.mjs';

const now=Date.now();
const dataFolder=await mkdtemp(path.join(tmpdir(),'observatory-preview-'));
await mkdir(path.join(dataFolder,'public','local'),{recursive:true});
const ago=minutes=>new Date(now-minutes*60000).toISOString();
const NAMES={Mac:'Studio Mac',Windows:'Desk PC'};
const named=host=>snapshot=>({...snapshot,device:{host,name:NAMES[host]},deviceNames:{[host]:NAMES[host]}});
const mac=ownSnapshot('Mac',now,named('Mac'));
const pc=ownSnapshot('Windows',now-4*60000,named('Windows'));
function fictionalHistory(host) {
  const points=[];
  let seed=11;
  const random=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
  const start=now-30*86400000-137*60000;
  for(const [p,w5,ww] of [['claude','five_hour','seven_day'],['codex','primary','secondary']]) {
    let reset5=start,left5=100,resetWeek=start,leftWeek=100;
    for(let t=start;t<=now-60000;t+=(now-t<=2*3600000?5:15)*60000) {
      const date=new Date(t),hour=date.getHours(),day=date.getDay();
      const working=hour>=8 && hour<23;
      if(t-reset5>=5*3600000) {reset5=t;left5=100;}
      if(t-resetWeek>=7*86400000) {resetWeek=t;leftWeek=100;}
      const burn=working?(p==='claude'?1.6:0.9)*random():0;
      left5=Math.max(0,left5-burn*2.2);leftWeek=Math.max(0,leftWeek-burn*0.12);
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

mac.collectedAt=ago(1);pc.collectedAt=ago(4);
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
