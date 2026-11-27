// My apps: the user's own rules label screen time per app or site, every local ActivityWatch watcher is read so
// history stays continuous, older days are labeled one chunk per run, browser time no rule matched is reported
// and checked, and the labels and raw window events reach the raw archive. All names here are fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {parseAppRules,appClassifier,rulesKey,ruleLabels} from '../lib/my-apps.mjs';
import {parseConfig} from '../lib/config.mjs';
import {localActivityPairs,firstRecorded} from '../scripts/activity-buckets.mjs';
import {macActivity,windowEvents} from '../scripts/mac-activity.mjs';
import {cleanActivity} from '../scripts/snapshot-clean.mjs';
import {retainActivityHistory,settleMyApps,addMyAppsChunk,dayStart,BACKFILL_DAYS} from '../scripts/activity-history.mjs';
import {buildSnapshot} from '../scripts/collect.mjs';
import {archiveActivityEvents,archiveReadings} from '../scripts/raw-archive.mjs';
import {findProblems,unmatchedBrowser} from '../lib/self-check.mjs';
import {ticketFor} from '../scripts/self-check.mjs';
import {ownRows} from '../lib/combine.mjs';
import {withFolder,testConfig} from './helpers.mjs';

const mac={platform:'darwin',environment:{}};
const RULES=parseAppRules([
  {label:'Code host',title:'· Code Host$'},
  {label:'Tide notes',title:'^Tide Notes'},
  {label:'Lantern',app:'^Lantern( Preview)?$'},
  {label:'Lantern',title:'^Lantern dashboard'},
  {label:'Field guide',app:'^Notes$',title:'field guide'},
]);

test('rules are checked, and the code ships none: no settings means no labels',()=>{
  assert.deepEqual(parseConfig({},mac).activity,{hosts:null,apps:[]});
  const config=parseConfig({activity:{hosts:['old-name','new-name.local'],apps:[{label:' Lantern ',app:'lantern'}]}},mac);
  assert.deepEqual(config.activity,{hosts:['old-name','new-name.local'],apps:[{label:'Lantern',app:'lantern',title:null}]});
  for(const [raw,error] of [
    [{activity:{apps:{}}},/activity.apps must be a list/],
    [{activity:{apps:[{label:'x'}]}},/needs app, title or both/],
    [{activity:{apps:[{label:'x',title:'('}]}},/not a valid regular expression/],
    [{activity:{apps:[{label:'',app:'x'}]}},/label must be a short name/],
    [{activity:{apps:[{label:'x',app:'x',url:'y'}]}},/unknown setting url/],
    [{activity:{hosts:['bad name']}},/activity.hosts must be a list/],
    [{activity:{other:true}},/activity has unknown setting other/],
  ])assert.throws(()=>parseConfig(raw,mac),error);
  assert.equal(rulesKey([]),null);
  assert.notEqual(rulesKey(RULES),rulesKey(RULES.slice(1)),'changing the rules changes the key');
  assert.deepEqual(ruleLabels(RULES),['Code host','Tide notes','Lantern','Field guide']);
});

test('a title-only rule matches browser windows, an app rule that app, and the first match wins',()=>{
  const label=appClassifier(RULES);
  assert.equal(label({app:'Safari',title:'Tide Notes: week 3',browser:true}),'Tide notes');
  assert.equal(label({app:'Chat',title:'Tide Notes: week 3',browser:false}),null,'a chat named after a site is not time on the site');
  assert.equal(label({app:'Lantern Preview',title:'',browser:false}),'Lantern');
  assert.equal(label({app:'Safari',title:'lantern dashboard',browser:true}),'Lantern','case is ignored');
  assert.equal(label({app:'Notes',title:'Field guide draft',browser:false}),'Field guide');
  assert.equal(label({app:'Notes',title:'Groceries',browser:false}),null,'app and title must both match');
  assert.equal(label({app:'Safari',title:'Tide Notes · Code Host',browser:true}),'Code host','the first matching rule wins');
  assert.equal(label({app:undefined,title:undefined,browser:true}),null);
});

const at=(minutes,base='2026-11-20T15:00:00Z')=>new Date(Date.parse(base)+minutes*60000).toISOString();
const bucket=(id,type,hostname,created,updated)=>({id,type,hostname,created,last_updated:updated,data:{}});
const BUCKETS=[
  bucket('aw-watcher-window_old-name','currentwindow','old-name','2026-09-05T00:00:00Z','2026-10-11T00:00:00Z'),
  bucket('aw-watcher-afk_old-name','afkstatus','old-name','2026-09-05T00:00:00Z','2026-10-23T00:00:00Z'),
  bucket('aw-watcher-window_new-name.local','currentwindow','new-name.local','2026-10-23T00:00:00Z','2026-11-26T00:00:00Z'),
  bucket('aw-watcher-afk_new-name.local','afkstatus','new-name.local','2026-10-23T00:00:00Z','2026-11-26T00:00:00Z'),
  bucket('aw-watcher-window_far-synced-from-far','currentwindow','far','2026-09-01T00:00:00Z','2026-11-26T00:00:00Z'),
];

test('every local watcher running during the read is paired, whatever its name, and activity.hosts narrows them',()=>{
  const ms=Date.parse;
  const old=localActivityPairs(BUCKETS,{since:ms('2026-09-20T00:00:00Z'),until:ms('2026-09-26T00:00:00Z')});
  assert.deepEqual(old,[{window:'aw-watcher-window_old-name',afk:'aw-watcher-afk_old-name'}],'a read in September uses the old name');
  const across=localActivityPairs(BUCKETS,{since:ms('2026-10-08T00:00:00Z'),until:ms('2026-10-25T00:00:00Z')});
  assert.equal(across.length,4,'a read across the rename pairs both names');
  assert.ok(across.every(pair=>!pair.window.includes('synced')),'a synced bucket is another computer');
  const named=localActivityPairs(BUCKETS,{hosts:['new-name.local'],since:ms('2026-10-08T00:00:00Z'),until:ms('2026-10-25T00:00:00Z')});
  assert.deepEqual(named,[{window:'aw-watcher-window_new-name.local',afk:'aw-watcher-afk_new-name.local'}],'with hosts set, only the named watchers are read');
  assert.equal(firstRecorded(BUCKETS),ms('2026-09-05T00:00:00Z'));
  assert.equal(firstRecorded(BUCKETS,{hosts:['new-name.local']}),ms('2026-10-23T00:00:00Z'));
});

// ActivityWatch as a function: window events per bucket, every moment active unless `away` says otherwise.
function activityWatch(events,{buckets=BUCKETS}={}) {
  const calls=[];
  const request=async(suffix,body)=>{
    calls.push(suffix);
    if(suffix==='/buckets/')return Object.fromEntries(buckets.map(item=>[item.id,item]));
    if(suffix==='/query/') {
      const window=JSON.parse(body.query[0].match(/query_bucket\(("[^"]*")\)/)[1]);
      const [start,end]=body.timeperiods[0].split('/').map(Date.parse);
      return [(events[window] ?? []).filter(event=>Date.parse(event.timestamp)>=start && Date.parse(event.timestamp)<end)];
    }
    const match=suffix.match(/^\/buckets\/([^/]+)\/events\?limit=(-?\d+)(?:&start=(.+))?$/);
    if(match) {
      const list=[...(events[decodeURIComponent(match[1])] ?? [])].reverse();
      const since=match[3]?Date.parse(decodeURIComponent(match[3])):null;
      const shown=since===null?list:list.filter(event=>Date.parse(event.timestamp)>=since);
      return match[2]==='-1'?shown:shown.slice(0,Number(match[2]));
    }
    throw Error(`unexpected ${suffix}`);
  };
  return {request,calls};
}
const event=(minutes,durationMinutes,app,title,base)=>({id:minutes,timestamp:at(minutes,base),duration:durationMinutes*60,data:{app,title}});

test('a read labels each window, counts browser time no rule matched, and two watchers seeing the same window count once',async()=>{
  const busy=[
    event(0,30,'Safari','Tide Notes: chapter 2'),
    event(30,20,'Safari','A video site'),
    event(50,10,'Lantern','Lantern'),
    event(60,15,'Chat','Tide Notes plan'),
    event(75,6,'Safari','excluded'),
  ];
  // The renamed watcher ran beside the old one for a while and saw the same windows.
  const {request}=activityWatch({'aw-watcher-window_new-name.local':busy,'aw-watcher-window_old-name':busy.slice(0,2)},
    {buckets:BUCKETS.map(item=>({...item,created:'2026-09-05T00:00:00Z',last_updated:'2026-11-26T00:00:00Z'}))});
  const raw=await macActivity({raw:true,rules:RULES,request,start:new Date('2026-11-20T05:00:00Z'),end:new Date('2026-11-21T05:00:00Z')});
  assert.ok(raw.intervals.every(row=>!('title' in row)),'titles stay in ActivityWatch');
  const day=cleanActivity(raw,'Mac').days.find(item=>item.date==='2026-11-20');
  assert.equal(day.seconds,81*60);
  assert.deepEqual(day.myApps,{'Tide notes':30*60,Lantern:10*60});
  assert.equal(day.browserUnmatched,26*60,'only browser time counts as unmatched');
  assert.equal(day.browserHidden,6*60,'time ActivityWatch kept no title for is counted apart');
  const plain=cleanActivity(await macActivity({raw:true,request,start:new Date('2026-11-20T05:00:00Z'),end:new Date('2026-11-21T05:00:00Z')}),'Mac').days.find(item=>item.date==='2026-11-20');
  assert.equal(plain.myApps,undefined,'with no rules there are no labels');
});

test('a rule change relabels from the current read, older days are labeled one chunk per run back to the first recorded day',()=>{
  const day=(date,extra={})=>({date,seconds:3600,hours:Array(24).fill(150),categories:{Browser:3600},apps:{},...extra});
  const dates=['2026-11-01','2026-11-02','2026-11-06','2026-11-10','2026-11-11','2026-11-12','2026-11-13','2026-11-14','2026-11-15','2026-11-16'];
  const old=day('2026-11-01',{myApps:{Gone:10},browserUnmatched:5});
  const previous={host:'Mac',status:'ok',days:[old,...dates.slice(1).map(date=>day(date))],myAppsKey:'older-rules',myAppsFrom:'2026-11-01'};
  const windowStart='2026-11-10T14:00:00.000Z';
  const row={...previous,days:previous.days.map(item=>item.date>='2026-11-10'?{...item,myApps:{Lantern:600},browserUnmatched:3000}:item)};
  const first=settleMyApps(row,previous,{key:'new-rules',rules:2,windowStart});
  assert.equal(first.row.myAppsFrom,'2026-11-11','the read\'s first day is partial');
  assert.equal(first.row.days.find(item=>item.date==='2026-11-01').myApps,undefined,'labels from older rules are dropped');
  assert.equal(first.row.days.find(item=>item.date==='2026-11-10').myApps,undefined);
  assert.deepEqual(first.row.days.find(item=>item.date==='2026-11-12').myApps,{Lantern:600});
  assert.deepEqual([first.chunk.start.getTime(),first.chunk.end.getTime()],[dayStart('2026-11-05'),dayStart('2026-11-11')]);
  assert.equal(BACKFILL_DAYS,6);
  const read={days:[day('2026-11-03',{myApps:{Outside:1}}),day('2026-11-06',{myApps:{'Tide notes':900},browserUnmatched:2700}),day('2026-11-10',{myApps:{},browserUnmatched:3600})],firstRecorded:Date.parse('2026-11-02T12:00:00Z')};
  const labeled=addMyAppsChunk(first.row,first.chunk,read);
  assert.deepEqual(labeled.days.find(item=>item.date==='2026-11-06').myApps,{'Tide notes':900});
  assert.ok(labeled.days.every(item=>!item.myApps?.Outside),'a day outside the chunk is not touched');
  assert.deepEqual(labeled.days.find(item=>item.date==='2026-11-10').myApps,{},'a labeled day with no match is labeled, not missing');
  assert.equal(labeled.myAppsFrom,'2026-11-05');
  assert.equal(labeled.myAppsFirst,'2026-11-02');
  const next=settleMyApps({...labeled},labeled,{key:'new-rules',rules:2,windowStart});
  assert.deepEqual([next.chunk.start.getTime(),next.chunk.end.getTime()],[dayStart('2026-10-30'),dayStart('2026-11-05')],'the next run labels the 6 days before');
  const done=settleMyApps({...labeled,myAppsFrom:'2026-10-30'},{...labeled,myAppsFrom:'2026-10-30'},{key:'new-rules',rules:2,windowStart});
  assert.equal(done.chunk,null,'labeling stops at the first recorded day');
  const unread=settleMyApps({host:'Mac',status:'ok',days:labeled.days},labeled,{key:'new-rules',rules:2,windowStart:null});
  assert.equal(unread.row.myAppsFrom,'2026-11-05','a run that read nothing keeps the labels as they were');
  assert.deepEqual(unread.row.days.find(item=>item.date==='2026-11-06').myApps,{'Tide notes':900});
  const off=settleMyApps(labeled,labeled,{key:null,rules:0,windowStart});
  assert.ok(off.row.days.every(item=>item.myApps===undefined) && off.row.myAppsKey===undefined,'removing the rules removes the labels');
});

test('the collector labels the current read and one older chunk, and the labels pass into the combined view',async()=>{
  const now=new Date('2026-11-20T17:00:00Z');
  const week={host:'Mac',status:'ok',start:'2026-11-13T17:00:00.000Z',end:now.toISOString(),
    intervals:[{start:'2026-11-19T15:00:00Z',end:'2026-11-19T16:00:00Z',category:'Browser',app:'Safari',label:'Tide notes'},
      {start:'2026-11-19T16:00:00Z',end:'2026-11-19T16:30:00Z',category:'Browser',app:'Safari',label:null}],
    trackingIntervals:[],labels:['Tide notes']};
  const asked=[];
  const readers={screenTime:async()=>week,
    activityRange:async(start,end)=>{asked.push([start.toISOString(),end.toISOString()]);
      return {start:start.toISOString(),end:end.toISOString(),intervals:[{start:'2026-11-10T15:00:00Z',end:'2026-11-10T15:20:00Z',category:'Browser',app:'Safari',label:'Tide notes'}],
        trackingIntervals:[],labels:['Tide notes'],firstRecorded:Date.parse('2026-09-05T12:00:00Z')};}};
  const config=testConfig('/unused',{sources:{screenTime:true},activity:{hosts:null,apps:[{label:'Tide notes',app:null,title:'^Tide Notes'}]}});
  const previous={activityHistory:[{host:'Mac',status:'ok',days:[{date:'2026-11-10',seconds:1200,hours:Array(24).fill(50),categories:{Browser:1200},apps:{}}]}]};
  const {data}=await buildSnapshot(config,readers,{previous,now});
  const history=data.activityHistory.find(row=>row.host==='Mac');
  assert.deepEqual(history.days.find(day=>day.date==='2026-11-19').myApps,{'Tide notes':3600});
  assert.equal(history.days.find(day=>day.date==='2026-11-19').browserUnmatched,1800);
  assert.deepEqual(asked,[[new Date(dayStart('2026-11-08')).toISOString(),new Date(dayStart('2026-11-14')).toISOString()]]);
  assert.deepEqual(history.days.find(day=>day.date==='2026-11-10').myApps,{'Tide notes':1200},'an older day is labeled from the chunk');
  assert.equal(history.days.find(day=>day.date==='2026-11-10').seconds,1200,'labeling never changes a day\'s screen time');
  assert.deepEqual([history.myAppsRules,history.myAppsFrom,history.myAppsFirst],[1,'2026-11-08','2026-09-05']);
  const view=ownRows({...data,collectedAt:now.toISOString()},'Mac',{now:now.getTime()});
  const shown=view.activityHistory[0];
  assert.deepEqual(shown.days.find(day=>day.date==='2026-11-19').myApps,{'Tide notes':3600});
  assert.equal(shown.myAppsRules,1);
  assert.equal(shown.myAppsKey,undefined,'the rules\' key stays on the computer');
  const failing=await buildSnapshot(config,{...readers,activityRange:async()=>{throw Error('ActivityWatch unavailable');}},{previous,now});
  assert.equal(failing.data.activityHistory[0].myAppsFrom,'2026-11-14','a failed older read leaves the history as the current read made it');
});

test('the self-check lists browser time that stays mostly unmatched, and its ticket says what to do',()=>{
  const day=(date,browser,unmatched)=>({date,seconds:browser,categories:{Browser:browser},myApps:{},browserUnmatched:unmatched});
  const history=days=>({host:'Mac',status:'ok',myAppsRules:3,days});
  const echo={host:'Mac',name:'Mac',role:'hub',sources:{screenTime:true,codex:false,codexLimits:false,claudeCode:false,claudeLimits:false,grokLimits:false}};
  const combined=row=>({generatedBy:'Mac',devices:[{host:'Mac',name:'Mac',state:'current',collectedAt:'2026-11-26T17:55:00Z'}],
    view:{config:[echo],activity:[{host:'Mac',status:'ok'}],activityHistory:[row]}});
  const high=history(['20','21','22','23','24','25','26'].map(d=>day(`2026-11-${d}`,3600,2400)));
  assert.deepEqual(unmatchedBrowser(high),{days:7,browser:7*3600,unmatched:7*2400,hidden:0,share:2400/3600});
  assert.deepEqual(findProblems(combined(high)).map(problem=>problem.key),['Mac/myAppsUnmatched']);
  const low=history(['24','25','26'].map(d=>day(`2026-11-${d}`,3600,600)));
  assert.deepEqual(findProblems(combined(low)),[],'mostly matched is fine');
  assert.deepEqual(findProblems(combined(history([day('2026-11-26',1200,1200)]))),[],'under an hour of browser time says nothing yet');
  assert.deepEqual(findProblems(combined({...high,myAppsRules:0})),[],'with no rules there is nothing to match');
  const ticket=ticketFor(findProblems(combined(high))[0],testConfig('/unused',{role:'hub'}));
  assert.ok(ticket.job.includes('activity.apps') && ticket.job.includes('URL watcher'));
  assert.ok(!/[|\r\n]/.test(ticket.job) && ticket.job.length<=400);
  const hidden=history(high.days.map(item=>({...item,browserHidden:2000})));
  const [problem]=findProblems(combined(hidden));
  assert.equal(problem.status,'hidden','mostly no title to match reads hidden');
  const told=ticketFor(problem,testConfig('/unused',{role:'hub'}));
  assert.ok(told.job.includes('exclude_title') && told.job.includes('Ask the owner') && told.job.length<=400);
});

const lines=async root=>{
  const out=[];
  for(const host of await readdir(root,{withFileTypes:true}))if(host.isDirectory())
    for(const year of await readdir(path.join(root,host.name)))
      for(const file of await readdir(path.join(root,host.name,year)))
        out.push(...(await readFile(path.join(root,host.name,year,file),'utf8')).trim().split('\n').map(line=>JSON.parse(line)));
  return out;
};

test('raw window events are archived once each with their app and label, never their title, the newest one only after another follows it',()=>withFolder(async folder=>{
  const root=path.join(folder,'archive');
  const config={...testConfig(folder,{activity:{hosts:null,apps:RULES}}),archive:{folder:root}};
  const base='2026-11-26T15:00:00Z';
  const events={'aw-watcher-window_new-name.local':[event(0,5,'Safari','Tide Notes',base),event(5,5,'Lantern','Lantern',base),event(7,2,'Safari','Private page',base),
    event(9,1,'Chat','Secret plan',base),event(10,1,'Safari','Still open',base)]};
  const {request}=activityWatch(events);
  const read=options=>windowEvents({...options,request});
  const now=Date.parse('2026-11-26T16:00:00Z');
  assert.equal(await archiveActivityEvents(config,{read,now,timeZone:'UTC'}),4);
  let all=await lines(root);
  assert.deepEqual(all.map(line=>[line.section,line.kind,line.part,line.date,line.value.app,line.value.label]),[
    ['activityEvents','event','aw-watcher-window_new-name.local','2026-11-26','Safari','Tide notes'],
    ['activityEvents','event','aw-watcher-window_new-name.local','2026-11-26','Lantern','Lantern'],
    ['activityEvents','event','aw-watcher-window_new-name.local','2026-11-26','Safari','browser'],
    ['activityEvents','event','aw-watcher-window_new-name.local','2026-11-26','Chat','unmatched']]);
  assert.deepEqual(Object.keys(all[0].value).sort(),['app','duration','label','timestamp']);
  assert.equal(all[0].value.duration,300);
  const written=JSON.stringify(all);
  for(const title of ['Tide Notes','Private page','Secret plan'])assert.ok(!written.includes(title),`the title "${title}" is never written`);
  assert.equal(await archiveActivityEvents(config,{read,now:now+60000,timeZone:'UTC'}),0,'nothing new, nothing written');
  events['aw-watcher-window_new-name.local'].push(event(11,3,'Safari','Next',base));
  assert.equal(await archiveActivityEvents(config,{read,now:now+120000,timeZone:'UTC'}),1,'the open event is written once a newer one follows');
  all=await lines(root);
  assert.deepEqual([all.at(-1).value.label,JSON.stringify(all).includes('Still open')],['browser',false]);
  assert.equal(await archiveActivityEvents({...config,platform:'windows'},{read,now,timeZone:'UTC'}),null,'only a Mac reads ActivityWatch here');
  assert.equal(await archiveActivityEvents({...config,archive:{folder:null}},{read,now,timeZone:'UTC'}),null);
}));

test('each day\'s seconds per app reach the archive with the screen time history',()=>withFolder(async folder=>{
  const root=path.join(folder,'archive');
  const config={...testConfig(folder),archive:{folder:root}};
  const history=retainActivityHistory([],[{host:'Mac',status:'ok',start:'2026-11-24T05:00:00.000Z',end:'2026-11-26T17:00:00.000Z',
    days:[{date:'2026-11-25',seconds:7200,hours:Array(24).fill(300),categories:{Browser:7200},apps:{},myApps:{'Tide notes':3600},browserUnmatched:3600}]}],'2026-11-26T17:00:00.000Z');
  const snapshot={schema:2,collectedAt:'2026-11-26T17:00:00.000Z',activityHistory:history};
  await archiveReadings(config,[{host:'Mac',snapshot}],{now:Date.parse('2026-11-26T17:00:00Z'),timeZone:'UTC'});
  const day=(await lines(root)).find(line=>line.section==='activityHistory' && line.date==='2026-11-25');
  assert.deepEqual([day.value.myApps,day.value.browserUnmatched],[{'Tide notes':3600},3600]);
}));
