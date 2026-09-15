import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { summarizeTracked } from './activity-timeline.mjs';
import { retainActivityHistory } from './activity-history.mjs';
import { combineTokens, combineSettings } from './combine-tokens.mjs';
import { estimate } from './api-estimate.mjs';

// Fixed fictional fixtures. Never read configuration, device records or credentials.
export function demoData() {
  const collectedAt='2026-09-08T20:00:00.000Z';
  const dates=Array.from({length:14},(_,i)=>new Date(Date.UTC(2026,7,26+i)).toISOString().slice(0,10));
  const at=(date,hour)=>Date.parse(`${date}T${String(hour).padStart(2,'0')}:00:00Z`);
  const makeActivity=(host,selected)=>{
    const rows=[],tracking=[];
    selected.forEach((date,i)=>{
      if(date==='2026-09-02') return;
      const offset=host==='Windows'?2:0;
      tracking.push({start:at(date,13+offset),end:at(date,20),category:'Other'});
      if(date==='2026-09-03') return;
      rows.push({start:at(date,13+offset),end:at(date,14+offset),category:'AI apps',app:host==='Mac'?'ChatGPT / Codex':'Antigravity'},
        {start:at(date,15+offset),end:at(date,16+offset)+(i%3)*600000,category:'Editors',app:host==='Mac'?'Cursor':'VS Code'},
        {start:at(date,19),end:at(date,19)+900000,category:host==='Mac'?'Browser':'Terminal',app:host==='Mac'?'Safari':'Terminal'});
    });
    const start=`${selected[0]}T04:00:00.000Z`,end=collectedAt;
    return {host,status:'ok',checkedAt:collectedAt,start,end,...summarizeTracked(rows,tracking,start,end),rows,tracking};
  };
  const mac=makeActivity('Mac',dates),windows=makeActivity('Windows',dates);
  const combined={host:'Combined',status:'ok',checkedAt:collectedAt,start:mac.start,end:mac.end,
    ...summarizeTracked([...mac.rows,...windows.rows],[...mac.tracking,...windows.tracking],mac.start,mac.end)};
  const safe=({rows,tracking,...row})=>row;
  const full=[combined,safe(mac),safe(windows)];
  const live=full.map(r=>({...r,start:`${dates[7]}T04:00:00.000Z`,days:r.days.filter(d=>d.date>=dates[7])}));
  const tokens=['Mac','Ubuntu','Windows'].map((host,h)=>({host,status:'ok',checkedAt:collectedAt,days:dates.map((date,i)=>{
    const models=['gpt-6-astra','gpt-5.6-terra'].map((model,m)=>{
      const scale=(h+1)*(i%4+1)*(m+1);
      const counts={inputTokens:1200*scale,cacheReadTokens:6800*scale,cacheCreationTokens:0,outputTokens:400*scale,reasoningOutputTokens:100*scale,totalTokens:8400*scale};
      return {model,inferred:false,...counts,apiEstimate:estimate([{model,inferred:false,...counts}])};
    });
    return {date,...Object.fromEntries(['inputTokens','cacheReadTokens','cacheCreationTokens','outputTokens','reasoningOutputTokens','totalTokens'].map(k=>[k,models.reduce((n,m)=>n+m[k],0)])),models,apiEstimate:estimate(models)};
  })}));
  const settings=tokens.map(source=>({host:source.host,status:'ok',checkedAt:collectedAt,snapshotStable:true,
    profiles:source.days.flatMap(d=>d.models.map(m=>({...m,date:d.date,effort:m.model==='gpt-6-astra'?'medium':'high',speed:'standard'}))),
    tools:dates.flatMap((date,i)=>[
      {date,category:'Shell',tool:'exec_command',namespace:'functions',count:12+i},
      {date,category:'File edits',tool:'apply_patch',namespace:'functions',count:3+i%5},
      {date,category:'Browser',tool:'js',namespace:'mcp__cua_repl',count:2+i%3},
    ])}));
  const inventories=Object.fromEntries(tokens.map((s,i)=>[s.host,{status:'ok',keys:[String(i+1).repeat(64)],parents:[]}]));
  return {demo:true,schema:2,timezone:'America/New_York',collectedAt,
    dictation:['Mac','Windows'].map((host,h)=>({host,source:'Wispr Flow',status:'ok',checkedAt:collectedAt,calendar:'America/New_York',scope:'retained-history-records',days:dates.filter((_,i)=>i%4!==0).map((date,i)=>({date,transcriptions:3+i+h,words:42*(i+1+h),audioSeconds:20*(i+1+h),wordRecords:3+i+h,audioRecords:3+i+h,engines:[]}))})),
    combined:live[0],activity:live.slice(1),activityHistory:retainActivityHistory([],full,collectedAt),
    tokens,combinedTokens:combineTokens(tokens,inventories),settings,combinedSettings:combineSettings(tokens,settings),
    agents:[
      {id:'synthetic-review',model:'example-reviewer',role:'Subagent',status:'completed',seconds:24,total:4800,recordedAt:collectedAt},
      {id:'synthetic-timeout',model:'example-researcher',role:'Subagent',status:'failed',failure:'Response timed out. Cause not established.',seconds:120,total:null,recordedAt:collectedAt},
      {id:'synthetic-coordinator',model:'example-coordinator',role:'Coordinator',status:'completed',seconds:46,total:9200,recordedAt:collectedAt},
    ],
    agentSource:{status:'ok',checkedAt:collectedAt,skipped:0,limited:false},
    quota:{status:'ok',checkedAt:collectedAt,windows:[{bucket:'Example allowance',window:'Five-hour',remainingPercent:72,durationMinutes:300,resetsAt:'2026-09-09T00:00:00Z'},{bucket:'Example allowance',window:'Weekly',remainingPercent:58,durationMinutes:10080,resetsAt:'2026-09-14T00:00:00Z'}],
      history:Array.from({length:25},(_,i)=>({checkedAt:new Date(Date.parse(collectedAt)-(24-i)*300000).toISOString(),windows:[
        {bucket:'Example allowance',window:'Five-hour',remainingPercent:96-i,durationMinutes:300,resetsAt:'2026-09-09T00:00:00Z'},
        {bucket:'Example allowance',window:'Weekly',remainingPercent:64-i*.25,durationMinutes:10080,resetsAt:'2026-09-14T00:00:00Z'},
      ]}))},
    localModel:{status:'ok',checkedAt:collectedAt,records:[{model:'example-local-model',status:'complete',recordedAt:collectedAt,seconds:31,input:120,cached:0,output:60,ttft:null,peakGpuMiB:6200}]},
  };
}
export async function writeDemo(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    await writeFile(path.join(dir, 'usage.json'), JSON.stringify(demoData()), {flag:'wx',mode:0o600});
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return {code:1,message:'Snapshot already exists. Not overwritten. Use a separate checkout to create a demo.'};
  }
  return {code:0,message:'Synthetic demo written. An existing snapshot is never overwritten.'};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await writeDemo(fileURLToPath(new URL('../public/local/', import.meta.url)));
  console.log(result.message);
  process.exitCode = result.code;
}
