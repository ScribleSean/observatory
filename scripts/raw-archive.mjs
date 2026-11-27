// Keeps every reading for good. Snapshots are rewritten on every tick and readers keep only recent days, so
// after each tick the readings are also appended, as JSON Lines, to dated files under `archive.folder`.
// Nothing here ever deletes or rewrites a line. docs/RAW-ARCHIVE.md describes the files.
//
// A reading is one part of a computer's snapshot: one day of a daily section, one limit-history point, or the
// rest of a section. A part is appended when it changed since the last line for it, at most once an hour
// while it is today's, and at once when it is a past day (its final value) or a new point.
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {writeJsonAtomic} from '../lib/atomic-file.mjs';
import {privateFolder} from '../lib/private-folder.mjs';
import {appClassifier} from '../lib/my-apps.mjs';
import {category} from './snapshot-clean.mjs';

export const ARCHIVE_VERSION=1;
export const TODAY_EVERY_MS=60*60000;
// Parts of the snapshot that only repeat what is elsewhere in it.
const SKIP=new Set(['schema','timezone','collectedAt','device','deviceNames','combined','combinedTokens','combinedSettings']);
const INDEX_FILE='index.json';
const README=`# Observatory raw archive

Every reading Observatory took, kept for good. Observatory only appends here and never deletes.

- One folder per computer (Mac, Windows, Linux), then one folder per year, then one file per day: \`<host>/<YYYY>/<YYYY-MM-DD>.jsonl\`. The day is the day the line was written, in the time zone of the computer that wrote it.
- Each line is one JSON object: \`v\` (format version, ${ARCHIVE_VERSION}), \`archivedAt\` (when it was written), \`host\`, \`collectedAt\` (when the reading was taken), \`section\` (the snapshot section, for example \`providerTokenSources\` or \`modelDrift\`), \`part\` (the provider or tool, or empty), \`date\` (the day a daily reading covers, or null), \`kind\` (\`day\`, \`point\` or \`row\`) and \`value\` (the reading as the snapshot held it).
- A daily reading appears again whenever it changed, at most hourly while it is the current day and once more after the day ended. The last line for a \`host\`, \`section\`, \`part\` and \`date\` is its final value.
- \`point\` lines are single limit readings and appear once each.
- Unknown is never written as zero: a missing value stays missing or null, as in the snapshot.
- On a Mac with screen time on, ActivityWatch's window events are kept too, each once: \`section\` \`activityEvents\`, \`part\` the watcher's bucket, \`kind\` \`event\`, \`date\` the day the event started, and \`value\` {timestamp, duration (seconds), app, label}. \`label\` is the app the user's rules matched, or \`browser\` for a browser window no rule matched, or \`unmatched\` for any other window. Window titles are not written: they are only used, in memory, to match the rules.
- The day totals per app the user's rules name are in the \`activityHistory\` day lines, under \`myApps\` (seconds per app), \`browserUnmatched\` (browser seconds no rule matched) and \`browserHidden\` (of those, the seconds ActivityWatch kept no title for).
`;

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const dayIn=(timeZone,ms)=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);

/** The readings in one computer's snapshot, each with the key that names it across ticks. */
export function readingsOf(snapshot,host) {
  const out=[];
  for(const [section,value] of Object.entries(object(snapshot)?snapshot:{})) {
    if(SKIP.has(section))continue;
    const list=Array.isArray(value)?value.filter(object).filter(row=>row.host===undefined || row.host===host):object(value)?[value]:[];
    for(const row of list) {
      const part=typeof row.provider==='string'?row.provider:'';
      const {days,points,...rest}=row;
      if(Array.isArray(days))for(const day of days.filter(object)) {
        if(typeof day.date!=='string')continue;
        const dayPart=typeof day.tool==='string'?`${part}${part?':':''}${day.tool}`:part;
        out.push({key:`${section}|${dayPart}|${day.date}`,section,part:dayPart,date:day.date,kind:'day',value:day});
      }
      if(Array.isArray(points))for(const point of points.filter(object))
        if(typeof point.t==='string')out.push({key:`${section}|${part}|points`,section,part,date:null,kind:'point',time:point.t,value:point});
      out.push({key:`${section}|${part}|row`,section,part,date:null,kind:'row',value:rest});
    }
  }
  return out;
}

async function readIndex(file) {
  try {
    const value=JSON.parse(await fs.readFile(file,'utf8'));
    return value?.version===ARCHIVE_VERSION && object(value.keys)?value:{version:ARCHIVE_VERSION,keys:{}};
  } catch {return {version:ARCHIVE_VERSION,keys:{}};}
}

/**
 * Appends the new readings of each snapshot to the archive. Returns how many lines were written, or null when
 * no archive folder is set.
 * @param {object} config  parsed settings (archive.folder, dataFolder)
 * @param {{host: string, snapshot: object}[]} snapshots
 */
export async function archiveReadings(config,snapshots,{now=Date.now(),timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone}={}) {
  const root=config.archive?.folder;
  if(!root)return null;
  await fs.mkdir(root,{recursive:true,mode:0o700});
  const readme=path.join(root,'README.md');
  await fs.writeFile(readme,README,{flag:'wx',mode:0o600}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const indexFile=path.join(await privateFolder(config.dataFolder,'private-archive'),INDEX_FILE);
  const index=await readIndex(indexFile);
  const archivedAt=new Date(now).toISOString(),today=dayIn(timeZone,now);
  let written=0;
  for(const {host,snapshot} of snapshots) {
    if(!object(snapshot) || typeof host!=='string')continue;
    const keys=index.keys[host] ??= {};
    const lines=[];
    const base={v:ARCHIVE_VERSION,archivedAt,host,collectedAt:typeof snapshot.collectedAt==='string'?snapshot.collectedAt:null};
    const readings=readingsOf(snapshot,host);
    // Points newer than the newest one archived before this tick are new, whatever order they come in.
    const pointsSince=Object.fromEntries(readings.filter(item=>item.kind==='point').map(item=>[item.key,keys[item.key]?.time ?? null]));
    for(const reading of readings) {
      const old=keys[reading.key];
      if(reading.kind==='point') {
        const since=pointsSince[reading.key];
        if(since && reading.time<=since)continue;
      } else {
        const sum=hash(reading.value);
        if(old?.hash===sum)continue;
        const final=reading.date!==null && reading.date<today;
        if(old && !final && now-Date.parse(old.at)<TODAY_EVERY_MS)continue;
        keys[reading.key]={hash:sum,at:archivedAt};
      }
      lines.push(JSON.stringify({...base,section:reading.section,part:reading.part,date:reading.date,kind:reading.kind,value:reading.value}));
    }
    for(const reading of readings.filter(item=>item.kind==='point'))
      if(!keys[reading.key]?.time || reading.time>keys[reading.key].time)keys[reading.key]={time:reading.time};
    if(!lines.length)continue;
    const folder=path.join(root,host.replace(/[^A-Za-z0-9-]/g,'_'),today.slice(0,4));
    await fs.mkdir(folder,{recursive:true,mode:0o700});
    await fs.appendFile(path.join(folder,`${today}.jsonl`),lines.join('\n')+'\n',{mode:0o600});
    written+=lines.length;
  }
  // The index only saves repeats. Losing it writes some readings twice, never loses one.
  await writeJsonAtomic(indexFile,index);
  return written;
}

const EVENTS_INDEX='activity-events.json';
// An event as the archive keeps it: the app, the label the rules give it, and its times. The title is read to match
// the rules and then dropped, so no window title is written.
const eventValue=(event,classify)=>{
  const data=object(event.data)?event.data:{};
  const app=typeof data.app==='string'?data.app.slice(0,200):null;
  const browser=category(String(data.app))==='Browser';
  const label=classify({app:data.app,title:data.title,browser}) ?? (browser?'browser':'unmatched');
  return {timestamp:new Date(event.timestamp).toISOString(),duration:Math.round(event.duration*1000)/1000,app,label};
};

/**
 * Appends ActivityWatch's window events, each once and without their titles, to the archive. The first run keeps every event the watchers
 * hold. Returns how many lines were written, or null when there is no archive or screen time is not read here.
 * @param {object} config  parsed settings (archive.folder, dataFolder, platform, sources, activity.hosts)
 * @param {{read?: Function, now?: number, timeZone?: string}} [options]  read: scripts/mac-activity.mjs windowEvents
 */
export async function archiveActivityEvents(config,{read=null,now=Date.now(),timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone}={}) {
  const root=config.archive?.folder;
  if(!root || config.platform!=='mac' || !config.sources?.screenTime)return null;
  read??=(await import('./mac-activity.mjs')).windowEvents;
  const indexFile=path.join(await privateFolder(config.dataFolder,'private-archive'),EVENTS_INDEX);
  let index;
  try {index=JSON.parse(await fs.readFile(indexFile,'utf8'));} catch {index=null;}
  if(index?.version!==ARCHIVE_VERSION || !object(index.after))index={version:ARCHIVE_VERSION,after:{}};
  const buckets=await read({after:index.after,hosts:config.activity?.hosts ?? null});
  const classify=appClassifier(config.activity?.apps ?? []);
  const archivedAt=new Date(now).toISOString(),today=dayIn(timeZone,now);
  const base={v:ARCHIVE_VERSION,archivedAt,host:config.host,collectedAt:archivedAt,section:'activityEvents'};
  const lines=[];
  for(const {bucket,events} of buckets)for(const event of events) {
    const value=eventValue(event,classify);
    lines.push(JSON.stringify({...base,part:bucket,date:dayIn(timeZone,Date.parse(value.timestamp)),kind:'event',value}));
    if(!index.after[bucket] || Date.parse(value.timestamp)>Date.parse(index.after[bucket]))index.after[bucket]=value.timestamp;
  }
  if(lines.length) {
    await fs.mkdir(root,{recursive:true,mode:0o700});
    await fs.writeFile(path.join(root,'README.md'),README,{flag:'wx',mode:0o600}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    const folder=path.join(root,config.host.replace(/[^A-Za-z0-9-]/g,'_'),today.slice(0,4));
    await fs.mkdir(folder,{recursive:true,mode:0o700});
    await fs.appendFile(path.join(folder,`${today}.jsonl`),lines.join('\n')+'\n',{mode:0o600});
  }
  // Saved after the lines, so a run stopped between the two writes some events twice and loses none.
  await writeJsonAtomic(indexFile,index);
  return lines.length;
}
