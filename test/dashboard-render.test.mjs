import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {combine} from '../lib/combine.mjs';
import {refusalText} from '../lib/view-sources.mjs';
import {ownSnapshot} from './helpers.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const load=specifier=>import(specifier);
const {createServer}=await load('vite');
const {default:react}=await load('@vitejs/plugin-react');
const server=await createServer({configFile:false,root,server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[react()]});
after(()=>server.close());
const {DashboardView,sectionFromHash}=await server.ssrLoadModule('/app/viewer/dashboard.tsx');
const {SourcesView}=await server.ssrLoadModule('/app/viewer/sources/SourcesView.tsx');
const {useSkin}=await server.ssrLoadModule('/app/viewer/skin.ts');

const now=Date.parse('2026-10-21T17:00:00Z');
const both=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',snapshot:ownSnapshot('Windows',now)}],{now});
const noPc=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',name:'PC',snapshot:null,error:'unreachable'}],{now});
const render=props=>renderToStaticMarkup(createElement(DashboardView,{loaded:true,now,limitStyle:'bar',css:'',className:'',onSectionChange:()=>{},...props}));

for(const section of ['limits','activity','tokens','sources']) {
  test(`the ${section} page renders from combined.json`,()=>{
    const html=render({combined:both,section});
    for(const title of ['Limits','Screen time today','API-equivalent cost today'])assert.ok(html.includes(title),title);
    assert.ok(!/>Agents</.test(html),'no Agents tab or tile');
    assert.ok(html.includes('both computers, not deduplicated'));
    assert.ok(!html.includes('NaN'));
    assert.ok(!html.includes('undefined'));
  });
}

test('a missing computer shows no snapshot and the reason, and no total, never zero',()=>{
  const html=render({combined:noPc,section:'limits'});
  assert.ok(html.includes('No snapshot'));
  assert.ok(html.includes('Last pull failed: unreachable'));
  const tiles=html.slice(html.indexOf('Screen time today'),html.indexOf('ob-tabs'));
  assert.ok(!tiles.includes('class="ob-hero"'),'an Unknown total is not drawn as a headline');
  assert.ok(!/>(0m|\$0\.00)</.test(tiles),'never zero');
});

test('a computer with an old reading shows when it was last seen, not its numbers',()=>{
  const old=structuredClone(both);
  const pc=old.glance.today.find(device=>device.host==='Windows');
  pc.freshness={stale:true};pc.collectedAt=new Date(now-80*60000).toISOString();
  const html=render({combined:old,section:'limits'});
  assert.ok(html.includes('last seen'));
  const tiles=html.slice(html.indexOf('Screen time today'),html.indexOf('ob-tabs'));
  assert.ok(!tiles.includes('class="ob-hero"'),'no total that includes a hidden, old number');
});

test('two computers on the next day show no numbers as today',()=>{
  const html=render({combined:both,section:'limits',now:now+26*3600000});
  const tiles=html.slice(html.indexOf('Screen time today'),html.indexOf('ob-tabs'));
  assert.ok(!/class="ob-num">[^<]*(\d+h|\d+m|\$)/.test(tiles),'no duration or cost from yesterday');
  assert.ok(tiles.includes('last seen'));
});

test('limits are listed scarcest first and unknown ones share one line',()=>{
  const html=render({combined:both,section:'limits'});
  const tile=html.slice(html.indexOf('ob-tile-limits'),html.indexOf('ob-tile-time'));
  const values=[...tile.matchAll(/class="ob-num(?: warn)?">(\d+)%</g)].map(match=>Number(match[1]));
  assert.ok(values.length>1);
  assert.deepEqual(values,[...values].sort((a,b)=>a-b));
});

test('without combined.json the page says how to get one',()=>{
  const html=render({combined:null,section:'limits'});
  assert.ok(html.includes('No combined.json yet'));
  assert.ok(!html.includes('Cost today'));
});

test('unknown hashes open Limits and only the read-only pages exist',()=>{
  assert.equal(sectionFromHash('#tokens'),'tokens');
  assert.equal(sectionFromHash('#settings'),'limits');
  assert.equal(sectionFromHash('#setup'),'limits');
  const html=render({combined:both,section:'limits'});
  for(const removed of ['Settings','Dictation','Check for updates'])assert.ok(!html.includes(`>${removed}<`),removed);
});

test('source refusals are described, not copied',()=>{
  for(const refusal of ['synthetic-private-code','ancestor-refused']) {
    const html=renderToStaticMarkup(createElement(SourcesView,{now,snapshot:{activity:[{host:'Mac',status:'unavailable',refusal,checkedAt:'2026-10-21T16:58:00Z'}]}}));
    assert.ok(!html.includes(refusal));
    assert.ok(html.includes(refusalText(refusal)));
  }
});

test('the skin hook returns Sage',()=>{
  const seen=[];
  const Probe=()=>{seen.push(useSkin());return null;};
  renderToStaticMarkup(createElement(Probe));
  assert.equal(seen[0].skinId,'sage');
  assert.match(seen[0].css,/--ob-background/);
});

test('staleness is judged when the page draws, not when the file was written',()=>{
  const at=new Date(now).toISOString();
  const mac=ownSnapshot('Mac',now,s=>({...s,collectedAt:at}));
  const combined=combine([{host:'Mac',snapshot:mac}],{now});
  const later=render({combined,section:'limits',now:now+3600000});
  assert.ok(later.includes('as of'));
  const nextDay=render({combined,section:'limits',now:now+26*3600000});
  assert.ok(nextDay.includes('Last update was'));
  const time=nextDay.slice(nextDay.indexOf('Screen time today'),nextDay.indexOf('ob-tabs'));
  assert.ok(!time.includes('class="ob-hero"'),'yesterday is not shown as today');
});

test('a 30-day chart labels Mondays only, a week labels weekdays, and Unknown is a stub, not a zero',async()=>{
  const {BarChart}=await server.ssrLoadModule('/app/viewer/components/charts.tsx');
  const days=(count,value)=>Array.from({length:count},(_,index)=>{const date=new Date(Date.UTC(2026,8,22+index)).toISOString().slice(0,10);return {label:date.slice(5),date,value:value(index)};});
  const chart=data=>renderToStaticMarkup(createElement(BarChart,{title:'Screen time by day',data,series:'accent',formatValue:String}));
  const labels=html=>[...html.matchAll(/<text class="ob-bars-label"[^>]*>([^<]*)<\/text>/g)].map(match=>match[1]);
  const month=chart(days(30,index=>index===3?null:index===4?0:index*60));
  assert.deepEqual(labels(month),['Sep 28','Oct 5','Oct 12','Oct 19']);
  assert.equal((month.match(/data-unknown=/g) ?? []).length,1);
  assert.ok(!month.includes('data-bar="4"'),'a recorded zero draws no bar');
  const gap=chart(days(30,index=>index===5?undefined:index*60));
  assert.ok(!gap.includes('data-bar="5"') && !gap.includes('data-unknown="5"'),'a day with no record draws nothing');
  assert.ok(gap.includes('>No records<'),'and says so in the table');
  assert.ok(!month.includes('>Show values<'),'exact values are in hover titles and a table for screen readers');
  assert.ok(month.includes('class="ob-visually-hidden"><table>'));
  assert.deepEqual(labels(chart(days(7,index=>index))),['Tue','Wed','Thu','Fri','Sat','Sun','Mon']);
  const hours=Array.from({length:24},(_,hour)=>({label:String(hour),value:hour}));
  assert.ok(labels(chart(hours)).length<=6);
});

test('loading and first run show one calm message, not pages of Unknown',()=>{
  const loading=render({combined:null,loaded:false,section:'limits'});
  assert.ok(loading.includes('Loading'));
  assert.ok(!loading.includes('ob-tabs'));
  const first=render({combined:null,loaded:true,section:'limits'});
  assert.ok(first.includes('Waiting for the first collection'));
  assert.ok(first.includes('npm run tick'));
  assert.ok(!first.includes('>Unknown<'));
});

test('the tokens page shows today by project, with sessions, subagent share and the sessions not listed',()=>{
  const model=tokens=>[{model:'claude-opus-5-5',inputTokens:tokens,cacheReadTokens:0,cacheCreationTokens:0,outputTokens:0,totalTokens:tokens}];
  const session=(id,start,end,tokens,subagentTokens)=>({id,provider:'claude',start,end,totalTokens:tokens,subagentTokens,usd:1,models:model(tokens)});
  const row={host:'Mac',status:'ok',checkedAt:new Date(now).toISOString(),date:'2026-10-21',timeZone:'America/New_York',providers:['claude'],other:null,projects:[
    {name:'demo-app',totalTokens:190e6,subagentTokens:null,usd:96,sessionCount:3,sessions:[
      session('a1b2c3d4e5','2026-10-21T13:02:00.000Z','2026-10-21T14:40:00.000Z',121e6,77.44e6),
      session('f6a7b8c9d0','2026-10-21T12:10:00.000Z','2026-10-21T12:55:00.000Z',61e6,null)]},
    {name:'sample-site',totalTokens:74e6,subagentTokens:0,usd:38,sessionCount:1,sessions:[]}]};
  const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now,snapshot=>({...snapshot,projectTokens:[row]}))}],{now});
  const html=render({combined,section:'tokens'});
  for(const text of ['Today by project','demo-app','190M','$96','sample-site','subagents 64%','subagents Unknown','+1 more','>8M<'])assert.ok(html.includes(text),text);
  assert.ok(html.indexOf('demo-app')<html.indexOf('sample-site'),'largest project first');
  assert.ok(!html.includes('NaN') && !html.includes('undefined'));
});
