import {quotaHistoryMaxGapMs,sameQuotaReset} from './quota-timing.mjs';

// One byte per display pixel, independent of archive length. Native consumers
// tint this mask with their theme ink: 0 empty, 1 solid, 2 dashed, 3 observation.
// Pixels are drawing instructions, never fabricated percentage observations.
export function rasterQuotaTimeline(records,{from,to,bucket,window,width=1024,height=160}={}) {
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<=from||to>8640000000000000||
    !Number.isInteger(width)||width<2||width>1024||!Number.isInteger(height)||height<2||height>160||
    typeof bucket!=='string'||!['primary','secondary'].includes(window))throw Error('Invalid chart range');
  const pixels=new Uint8Array(width*height);
  let previous=null,missing=false,lastTime=-1,observations=0,gaps=0,segments=0,scanned=0;
  let firstAt=null,lastAt=null,minUsed=null,maxUsed=null;
  const point=(at,used)=>({x:Math.round((at-from)/(to-from)*(width-1)),y:Math.round((100-used)/100*(height-1))});
  const put=(x,y,ink)=>{
    const index=y*width+x,old=pixels[index];
    if(old===0||ink===3||(ink===1&&old===2))pixels[index]=ink;
  };
  const stroke=(a,b,dashed)=>{
    const steps=Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y));
    for(let step=0;step<=steps;step++) {
      if(dashed&&step%7>=3)continue;
      const fraction=steps===0?0:step/steps;
      put(Math.round(a.x+(b.x-a.x)*fraction),Math.round(a.y+(b.y-a.y)*fraction),dashed?2:1);
    }
  };
  for(const record of records) {
    scanned++;
    const at=Date.parse(record?.checkedAt);
    if(!Number.isFinite(at)){missing=true;continue;}
    if(at<lastTime)throw Error('Archive timeline must be ordered');
    lastTime=at;
    if(at<from||at>to)continue;
    const row=record.windows?.find(value=>value.bucket===bucket&&value.window===window);
    const remaining=row?.remainingPercent;
    if(typeof remaining!=='number'||!Number.isFinite(remaining)||remaining<0||remaining>100) {missing=true;continue;}
    const used=100-remaining,current={at,used,reset:row.resetsAt,point:point(at,used)};
    if(previous&&at>previous.at&&used>=previous.used&&sameQuotaReset(previous.reset,current.reset)) {
      const gap=missing||at-previous.at>quotaHistoryMaxGapMs;
      stroke(previous.point,current.point,gap);
      if(gap)gaps++;
    } else segments++;
    put(current.point.x,current.point.y,3);
    observations++;firstAt??=at;lastAt=at;
    minUsed=Math.min(minUsed??used,used);maxUsed=Math.max(maxUsed??used,used);
    previous=current;missing=false;
  }
  return {version:1,width,height,from,to,encoding:'ink-mask-u8',pixels:Buffer.from(pixels).toString('base64'),
    scanned,observations,gaps,segments,firstAt,lastAt,minUsed,maxUsed};
}
