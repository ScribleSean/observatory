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
const {DashboardView,routeFromHash,hashOf,shownPeriod,settledRoute}=await server.ssrLoadModule('/app/viewer/dashboard.tsx');
const {useSkin}=await server.ssrLoadModule('/app/viewer/skin.ts');
const {weekView}=await import('../lib/view-week.mjs');

const now=Date.parse('2026-10-21T17:00:00Z');
const both=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',snapshot:ownSnapshot('Windows',now)}],{now});
const noPc=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',name:'PC',snapshot:null,error:'unreachable'}],{now});
const history=detail=>({view:'history',detail:detail ?? null,session:null});
const render=({combined,route,...props})=>renderToStaticMarkup(createElement(DashboardView,{loaded:true,now,css:'',className:'',onRoute:()=>{},
  summary:combined?summaryOf(combined):null,history:route?.view==='history'?combined:null,route,...props}));

test('the home page is the week: the limit, its sessions, what shipped, what is running and what is worth a look',()=>{
  const html=render({combined:both});
  const week=weekView(summaryOf(both),{now});
  assert.ok(html.includes('data-hero'));
  assert.ok(html.includes(week.headline.title) && html.includes(week.headline.usedText));
  for(const meter of week.meters)assert.ok(html.includes(meter.label),meter.label);
  for(const title of ['Sessions by share of the week','Shipped this week','Running now','Worth a look','This week','Last week'])assert.ok(html.includes(title),title);
  for(const tool of week.tools)assert.ok(html.includes(`>${tool.name}</button>`),tool.name);
  for(const row of week.table.rows)assert.ok(html.includes(row.title),row.title);
  for(const helper of ['not deduplicated','API-equivalent','Checked','Screen time today'])assert.ok(!html.includes(helper),helper);
  assert.ok(!html.includes('NaN') && !html.includes('undefined'));
  assert.ok(html.includes('aria-current="page"'));
  assert.ok(!html.includes('class="hi"') && !html.includes('role="dialog"'),'no history and no panel drawn on the home page');
});

test('the same-repo line shows the closest overlap, counts the rest, and hides when the summary is old',async()=>{
  const {syntheticSessions}=await import('./synthetic-sessions.mjs');
  const scene=syntheticSessions('folder');
  const twin=scene.Mac.slice(0,2).map(row=>({...row,repoId:'0123456789ab',repo:'tide-charts'}));
  const sessions=[{host:'Mac',status:'ok',checkedAt:new Date(now).toISOString(),sessions:[...scene.Mac,...twin]}];
  const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now,snapshot=>({...snapshot,sessions}))}],{now});
  const [first]=combined.glance.collisions;
  assert.equal(combined.glance.collisions.length,2);
  const html=render({combined});
  assert.ok(html.includes(first.line) && html.includes('and 1 more'));
  assert.ok(!html.includes(combined.glance.collisions[1].line));
  assert.ok(!render({combined:both}).includes('Agents in one repository'),'no overlap draws nothing');
  assert.ok(!render({combined,now:now+60*60000}).includes(first.line),'an old summary hides the line');
});

test('the headline is the scarcer engine, and a limit that is not known reads Unknown, never 0%',()=>{
  const html=render({combined:both});
  const week=weekView(summaryOf(both),{now});
  assert.equal(week.headline.engine,both.glance.forecast.scarce.engine);
  assert.match(html,new RegExp(`data-hero="">${week.headline.usedText}<`));
  // The sample's Claude reading is old, so its windows have no current number.
  const stale=week.meters.filter(meter=>meter.used===null);
  assert.ok(stale.length>0);
  assert.ok(html.includes('class="ob-num ob-unknown">Unknown<'));
  assert.ok(!/>0% used</.test(html));
});

test('a session opens as a panel over the week, and an id that is gone opens nothing',()=>{
  const week=weekView(summaryOf(both),{now});
  const row=week.table.rows[0];
  const html=render({combined:both,route:{view:'week',detail:null,session:row.key}});
  assert.ok(html.includes('role="dialog"') && html.includes('aria-modal="true"'));
  const panel=html.slice(html.indexOf('role="dialog"'));
  for(const text of [row.title,'Share of the week','Where it went','Shipped','Close'])assert.ok(panel.includes(text),text);
  assert.ok(!panel.includes('NaN') && !panel.includes('undefined'));
  assert.ok(!render({combined:both,route:{view:'week',detail:null,session:'Mac.claude.000000000000'}}).includes('role="dialog"'));
});

test('last week shows what it shipped and when it ended, without what is running now',()=>{
  const html=render({combined:both,initialPeriod:'previous'});
  assert.ok(html.includes('Shipped last week') && html.includes('Ended '));
  assert.ok(!html.includes('Running now') && !html.includes('Shipped this week'));
  assert.ok(!html.includes('NaN') && !html.includes('undefined'));
});

test('history renders from combined.json with its totals and charts',()=>{
  const html=render({combined:both,route:history()});
  for(const title of ['Output tokens','At API prices','Cache hit','Every day','By model','By hour','Spent and shipped','30 days','Year'])assert.ok(html.includes(title),title);
  for(const more of ['Limits','Screen time','Tokens','Drift'])assert.ok(html.includes(`>${more}</button>`),more);
  assert.ok(!html.includes('NaN') && !html.includes('undefined'));
  assert.ok(!html.includes('Sessions by share of the week'));
});

for(const detail of ['limits','activity','tokens','drift']) {
  test(`the ${detail} detail renders under history`,()=>{
    const html=render({combined:both,route:history(detail)});
    assert.ok(html.includes('class="hi-detail"'));
    assert.ok(html.includes('aria-pressed="true"'));
    assert.ok(!/\((Mac|Windows|macOS)\)/.test(html));
    assert.ok(!html.includes('NaN') && !html.includes('undefined'));
  });
}

test('history waits for its data instead of drawing Unknown',()=>{
  const html=renderToStaticMarkup(createElement(DashboardView,{loaded:true,now,css:'',className:'',onRoute:()=>{},summary:summaryOf(both),history:null,route:history('limits')}));
  assert.ok(html.includes('Loading'));
  assert.ok(!html.split('<main')[1].includes('>Unknown<'));
});

test('a missing computer is named with its reason, and only then',()=>{
  const html=render({combined:noPc});
  assert.ok(html.includes('No snapshot'));
  assert.ok(html.includes('Last pull failed: unreachable'));
  assert.ok(!render({combined:both}).includes('ob-chips'),'nothing to warn about, no chips');
});

test('unknown hashes open the week, old section links open history, and only the read-only pages exist',()=>{
  assert.deepEqual(routeFromHash('#tokens'),{view:'history',detail:'tokens',session:null});
  assert.deepEqual(routeFromHash('#history/drift'),{view:'history',detail:'drift',session:null});
  assert.deepEqual(routeFromHash('#history'),{view:'history',detail:null,session:null});
  assert.deepEqual(routeFromHash('#session/Mac.claude.0a1b2c3d4e5f'),{view:'week',detail:null,session:'Mac.claude.0a1b2c3d4e5f'});
  for(const hash of ['','#week','#settings','#sources','#history/settings'])assert.equal(routeFromHash(hash).session,null,hash);
  assert.equal(routeFromHash('#settings').view,'week');
  assert.equal(routeFromHash('#history/settings').detail,null);
  for(const hash of ['#history','#history/limits','#session/Mac.claude.0a1b2c3d4e5f'])assert.equal(hashOf(routeFromHash(hash)),hash);
  assert.equal(hashOf(routeFromHash('#week')),'');
  const html=render({combined:both,route:history('limits')});
  for(const removed of ['Settings','Dictation','Check for updates','Sources'])assert.ok(!html.includes(`>${removed}<`),removed);
});

test('loading and first run show one calm line, not pages of Unknown',()=>{
  const loading=render({combined:null,loaded:false});
  assert.ok(loading.includes('Loading'));
  assert.ok(!loading.includes('<nav'));
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
  const html=render({combined,route:history('tokens')});
  for(const text of ['By project','demo-app','190M','$96','sample-site','Subagents 64%','Subagents Unknown','+1 more','>8M<'])assert.ok(html.includes(text),text);
  assert.ok(html.indexOf('demo-app')<html.indexOf('sample-site'),'largest project first');
  assert.ok(!html.includes('NaN') && !html.includes('undefined'));
});

test('the tokens page ranks today\'s sessions with the subagents inside each',()=>{
  const model=tokens=>[{model:'claude-unpriced-9',inputTokens:tokens,cacheReadTokens:0,cacheCreationTokens:0,outputTokens:0,totalTokens:tokens}];
  const session=(id,provider,tokens,subagentTokens,subagents=[])=>({id,provider,start:'2026-10-21T13:02:00.000Z',end:'2026-10-21T14:40:00.000Z',totalTokens:tokens,
    subagentTokens,subagents,subagentCount:subagentTokens===null?null:subagents.length,usd:null,models:model(tokens)});
  const row={host:'Mac',status:'ok',checkedAt:new Date(now).toISOString(),date:'2026-10-21',timeZone:'America/New_York',providers:['claude','codex'],other:null,projects:[
    {name:'demo-app',totalTokens:150e6,subagentTokens:90e6,usd:null,sessionCount:1,sessions:[
      session('a1b2c3d4e5','claude',150e6,90e6,[{id:'1111111111',totalTokens:60e6},{id:'2222222222',totalTokens:21e6}])]},
    {name:'sample-site',totalTokens:50e6,subagentTokens:null,usd:null,sessionCount:1,sessions:[session('f6a7b8c9d0','codex',50e6,null)]}]};
  const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now,snapshot=>({...snapshot,projectTokens:[row]}))}],{now});
  const html=render({combined,route:history('tokens')});
  const card=html.slice(html.indexOf('Where it went'),html.indexOf('By project'));
  for(const text of ['Where it went','demo-app','Claude Code, 9:02 AM to 10:40 AM','150M','75%','Main conversation','60M','40%','Subagent 1','Subagent 2','21M','Other subagents','9M','sample-site','Codex, ','25%'])
    assert.ok(card.includes(text),text);
  assert.ok(card.indexOf('demo-app')<card.indexOf('sample-site'),'largest session first');
  assert.equal(card.split('<details').length-1,1,'a session with an Unknown split has nothing to open');
  assert.ok(!card.includes('NaN') && !card.includes('undefined') && !card.includes('1111111111'));
});

test('last week falls back to this week once no computer has it, and the toggle goes away',()=>{
  const summary=summaryOf(both);
  for(const row of summary.week.ledger)for(const tool of row.tools ?? [])tool.periods=(tool.periods ?? []).filter(part=>part.key!=='previous');
  const html=render({combined:both,summary,initialPeriod:'previous'});
  assert.ok(html.includes('Shipped this week') && !html.includes('Shipped last week'));
  assert.ok(!html.includes('>Last week<'),'no way into a week that is gone');
  assert.equal(shownPeriod('previous',false),'current');
  assert.equal(shownPeriod('previous',true),'previous');
});

test('the page behind an open session panel is inert, and a session that is gone leaves the address',()=>{
  const row=weekView(summaryOf(both),{now}).table.rows[0];
  const open=render({combined:both,route:{view:'week',detail:null,session:row.key}});
  assert.match(open,/<header[^>]*\binert=""/);
  assert.match(open,/<main[^>]*\binert=""/);
  assert.ok(!/\binert=/.test(render({combined:both})),'nothing is inert without the panel');
  const gone={view:'week',detail:null,session:'Mac.claude.000000000000'};
  assert.ok(!/\binert=/.test(render({combined:both,route:gone})),'a missing session leaves the page usable');
  assert.deepEqual(settledRoute(gone,{ready:true,found:false}),{view:'week',detail:null,session:null});
  assert.equal(settledRoute(gone,{ready:false,found:false}),null,'nothing moves before the data has loaded');
  assert.equal(settledRoute({view:'week',detail:null,session:row.key},{ready:true,found:true}),null);
  assert.equal(hashOf(settledRoute(gone,{ready:true,found:false})),'');
});
