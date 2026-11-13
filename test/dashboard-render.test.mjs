import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {combine} from '../lib/combine.mjs';
import {summaryOf} from '../lib/summary.mjs';
import {ownSnapshot} from './helpers.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const load=specifier=>import(specifier);
const {createServer}=await load('vite');
const {default:react}=await load('@vitejs/plugin-react');
const server=await createServer({configFile:false,root,server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[react()]});
after(()=>server.close());
const {DashboardView,sectionFromHash}=await server.ssrLoadModule('/app/viewer/dashboard.tsx');
const {useSkin}=await server.ssrLoadModule('/app/viewer/skin.ts');

const now=Date.parse('2026-10-21T17:00:00Z');
const both=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',snapshot:ownSnapshot('Windows',now)}],{now});
const noPc=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',name:'PC',snapshot:null,error:'unreachable'}],{now});
const render=({combined,...props})=>renderToStaticMarkup(createElement(DashboardView,{loaded:true,now,css:'',className:'',onSectionChange:()=>{},
  summary:combined?summaryOf(combined):null,history:props.section?combined:null,section:null,...props}));

test('the home page is one sentence and one number per engine, with no helper text',()=>{
  const html=render({combined:both});
  const outlook=both.glance.forecast;
  assert.ok(html.includes('data-hero'));
  assert.ok(html.includes(outlook.sentence));
  for(const engine of outlook.engines)assert.ok(html.includes(engine.name),engine.name);
  for(const helper of ['not deduplicated','API-equivalent','Checked','Screen time today'])assert.ok(!html.includes(helper),helper);
  assert.ok(!html.includes('NaN') && !html.includes('undefined'));
  assert.ok(html.includes('aria-expanded="false"'),'history is closed until asked for');
  assert.ok(!html.includes('<main>'),'no history drawn on the home page');
});

test('the home numbers match the forecast, scarcer engine first',()=>{
  const numbers=[...render({combined:both}).matchAll(/class="fc-big[^"]*"[^>]*>(\d+%|Unknown)</g)].map(match=>match[1]);
  const engines=[...both.glance.forecast.engines].sort((a,b)=>a.engine===both.glance.forecast.scarce?.engine?-1:b.engine===both.glance.forecast.scarce?.engine?1:0);
  assert.deepEqual(numbers,engines.map(engine=>engine.remaining===null?'Unknown':`${Math.round(engine.remaining)}%`));
});

for(const section of ['limits','activity','tokens']) {
  test(`the ${section} history renders from combined.json`,()=>{
    const html=render({combined:both,section});
    assert.ok(html.includes('aria-expanded="true"'));
    assert.ok(html.includes('<main>'));
    assert.ok(!/\((Mac|Windows|macOS)\)/.test(html));
    assert.ok(!html.includes('NaN') && !html.includes('undefined'));
  });
}

test('history waits for its data instead of drawing Unknown',()=>{
  const html=renderToStaticMarkup(createElement(DashboardView,{loaded:true,now,css:'',className:'',onSectionChange:()=>{},summary:summaryOf(both),history:null,section:'limits'}));
  assert.ok(html.includes('Loading'));
  assert.ok(!html.split('<main>')[1].includes('>Unknown<'),'the home sentence may say Unknown; the history may not');
});

test('a missing computer is named with its reason, and only then',()=>{
  const html=render({combined:noPc});
  assert.ok(html.includes('No snapshot'));
  assert.ok(html.includes('Last pull failed: unreachable'));
  assert.ok(!render({combined:both}).includes('ob-chips'),'nothing to warn about, no chips');
});

test('unknown hashes open the home page and only the read-only pages exist',()=>{
  assert.equal(sectionFromHash('#tokens'),'tokens');
  assert.equal(sectionFromHash('#settings'),null);
  assert.equal(sectionFromHash('#sources'),null);
  const html=render({combined:both,section:'limits'});
  for(const removed of ['Settings','Dictation','Check for updates','Sources'])assert.ok(!html.includes(`>${removed}<`),removed);
});

test('loading and first run show one calm line, not pages of Unknown',()=>{
  const loading=render({combined:null,loaded:false});
  assert.ok(loading.includes('Loading'));
  assert.ok(!loading.includes('ob-history-nav'));
  const first=render({combined:null,loaded:true});
  assert.ok(first.includes('Waiting for the first reading'));
  assert.ok(!first.includes('>Unknown<'));
  assert.ok(first.split(/\s+/).length<80,'a title, not a page of text');
});

test('the skin hook returns Sage',()=>{
  const seen=[];
  const Probe=()=>{seen.push(useSkin());return null;};
  renderToStaticMarkup(createElement(Probe));
  assert.equal(seen[0].skinId,'sage');
  assert.match(seen[0].css,/--ob-background/);
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
  for(const text of ['By project','demo-app','190M','$96','sample-site','Subagents 64%','Subagents Unknown','+1 more','>8M<'])assert.ok(html.includes(text),text);
  assert.ok(html.indexOf('demo-app')<html.indexOf('sample-site'),'largest project first');
  assert.ok(!html.includes('NaN') && !html.includes('undefined'));
});
