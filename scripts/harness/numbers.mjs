// Checks the dashboard's numbers against the raw logs on every computer that feeds it.
// Usage: node scripts/harness/numbers.mjs [--data <url-or-file>] [--remote windows=<ssh alias>,wsl=<ssh alias>] [--no-raw]
// Tokens: today and the last 7 days per computer and provider, within 1%. Screen time: no hour above 60 minutes,
// for each computer and for any sum the dashboard draws. Limits: one lowest number across the summary.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {activityView} from '../../lib/view-activity.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
const option=(name,fallback)=>{const at=args.indexOf(name);return at>=0?args[at+1]:fallback;};
const source=option('--data','http://127.0.0.1:5601/local/combined.json');
const remotes=Object.fromEntries((option('--remote','')).split(',').filter(Boolean).map(pair=>pair.split('=')));
const TOLERANCE=0.01;

const load=async()=>/^https?:/.test(source)?(await fetch(source)).json():JSON.parse(readFileSync(source,'utf8'));
const data=await load();
const view=data.view;
const timeZone=view.timezone ?? 'UTC';
const counter=readFileSync(path.join(here,'raw-tokens.mjs'));

function raw(where,cutoff) {
  // These go onto another computer's command line, so only plain values pass.
  if(!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(cutoff) || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(timeZone) || (where!=='local' && !/^[A-Za-z0-9][\w.-]*$/.test(where)))
    throw Error('refusing an unexpected time zone, time or ssh alias');
  const argv=[timeZone,'8',cutoff];
  const out=where==='local'
    ? execFileSync(process.execPath,[path.join(here,'raw-tokens.mjs'),...argv],{encoding:'utf8',maxBuffer:1e8})
    : execFileSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10',where,`node --input-type=module - ${argv.join(' ')}`],{input:counter,encoding:'utf8',maxBuffer:1e8});
  return JSON.parse(out);
}

const merge=(...parts)=>{
  const out={claude:{},codex:{}};
  for(const part of parts)for(const provider of ['claude','codex'])for(const [date,row] of Object.entries(part[provider])) {
    const into=out[provider][date] ??= {total:0,cacheRead:0,other:0};
    for(const key of Object.keys(into))into[key]+=row[key];
  }
  return out;
};

const rows=key=>Array.isArray(view[key])?view[key]:[];
const dataDays=(host,provider)=>{
  const row=provider==='claude'
    ? rows('providerTokenSources').find(r=>r.host===host && r.provider==='claude-code')
    : rows('tokens').find(r=>r.host===host);
  return {checkedAt:row?.checkedAt ?? null,days:Object.fromEntries((row?.days ?? []).map(d=>[d.date,d]))};
};

const dates=(end,count)=>Array.from({length:count},(_,i)=>new Intl.DateTimeFormat('en-CA',{timeZone}).format(new Date(Date.parse(end)-i*86400000)));
const within=(a,b)=>Math.abs(a-b)<=Math.max(1000,TOLERANCE*Math.max(a,b));

const report={source:/^https?:/.test(source)?'live':path.basename(source),generatedAt:data.generatedAt,tokens:[],hours:[],limits:{},ok:true};
const hosts=(data.devices ?? []).map(device=>device.host);
for(const host of args.includes('--no-raw')?[]:hosts) {
  const cutoff=dataDays(host,'claude').checkedAt ?? dataDays(host,'codex').checkedAt ?? data.generatedAt;
  let counted;
  try {
    counted=host==='Mac' ? raw('local',cutoff)
      : host==='Windows' && remotes.windows ? merge(raw(remotes.windows,cutoff),...(remotes.wsl?[raw(remotes.wsl,cutoff)]:[]))
      : null;
  } catch(error) {report.tokens.push({host,error:error.message.split('\n')[0]});report.ok=false;continue;}
  if(!counted)continue;
  for(const provider of ['claude','codex']) {
    const {days}=dataDays(host,provider);
    for(const [label,span] of [['today',1],['7 days',7]]) {
      const keys=dates(cutoff,span);
      const sum=(table,field)=>keys.reduce((total,date)=>total+(table[date]?.[field] ?? 0),0);
      const rawTotal=sum(counted[provider],'total');
      const shown=sum(days,'totalTokens');
      const ok=within(rawTotal,shown);
      report.tokens.push({host,provider,span:label,raw:rawTotal,rawCacheRead:sum(counted[provider],'cacheRead'),dashboard:shown,ok});
      if(!ok)report.ok=false;
    }
  }
}

// Screen time: no bar the Activity page draws may hold more than an hour, for each computer and for All.
for(const host of [...hosts,'All']) {
  const hourly=activityView(view,{host,period:'day',now:Date.parse(data.generatedAt)}).hourly;
  const worst=hourly?Math.max(0,...hourly.map(bar=>bar.value ?? 0)):0;
  report.hours.push({host,maxMinutes:Math.round(worst/60),drawn:hourly!==null,ok:worst<=3600+1});
}
if(report.hours.some(row=>!row.ok))report.ok=false;

// Headline tokens leave cache reads out: each computer's headline must match the raw count without them.
for(const device of data.glance?.today ?? []) {
  const rows=report.tokens.filter(row=>row.host===device.host && row.span==='today' && !row.error);
  if(rows.length<2)continue;
  const expected=rows.reduce((sum,row)=>sum+row.raw-row.rawCacheRead,0);
  const ok=within(expected,device.tokens ?? -1);
  report.tokens.push({host:device.host,provider:'headline',span:'today',raw:expected,dashboard:device.tokens,ok});
  if(!ok)report.ok=false;
}

// Limits: the menu bar title, the summary and the forecast all name the same engine and number.
const forecast=data.glance?.forecast ?? null;
const scarce=forecast?.scarce ?? null;
report.limits={title:data.glance?.title ?? null,menu:forecast?.menu ?? null,scarce:scarce?`${scarce.name} ${Math.round(scarce.remaining)}%`:null,
  sentence:forecast?.sentence ?? null,lowest:data.glance?.lowest ?? null};
report.limits.ok=forecast!==null && report.limits.menu===report.limits.scarce && report.limits.title===report.limits.menu &&
  forecast.engines.every(engine=>engine.remaining===null || typeof engine.remaining==='number');
if(!report.limits.ok)report.ok=false;

console.log(JSON.stringify(report,null,1));
process.exitCode=report.ok?0:1;
