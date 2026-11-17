import test from 'node:test';
import assert from 'node:assert/strict';
import {historyView,HEAT_WEEKS} from '../lib/view-history.mjs';
import {combine} from '../lib/combine.mjs';
import {ownSnapshot} from './helpers.mjs';

const now=Date.parse('2026-10-21T17:00:00Z');
const HOUR=3600000,DAY=24*HOUR;
const {view}=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',snapshot:ownSnapshot('Windows',now)}],{now});
const point=(p,w,d,at,left,reset)=>({p,w,d,o:'Mac',t:new Date(at).toISOString(),r:left,x:new Date(reset).toISOString()});
// Two 5-hour blocks a day for three days, one of them spent, and three weekly windows, one of them spent.
function limitHistory() {
  const points=[];
  for(let day=0;day<3;day++)for(const [slot,left] of [[0,62],[1,day===1?0:35]]) {
    const reset=now-day*DAY-slot*5*HOUR-HOUR;
    points.push(point('claude','five_hour',300,reset-4*HOUR,90,reset),point('claude','five_hour',300,reset-HOUR,left,reset));
  }
  for(const [week,left] of [[0,40],[1,0.2],[2,31]]) {
    const reset=now+2*DAY-week*7*DAY;
    points.push(point('claude','seven_day',10080,reset-6*DAY,88,reset),point('claude','seven_day',10080,Math.min(now-HOUR,reset-HOUR),left,reset));
  }
  points.push(point('codex','primary',300,now-3*HOUR,100,now+2*HOUR),point('codex','primary',300,now-2*HOUR,100,now+3*HOUR));
  return [{host:'Mac',status:'ok',points}];
}
const full={...view,limitHistory:limitHistory()};

test('the totals row adds every computer and tool over the range',()=>{
  const month=historyView(full,{range:'month',now});
  assert.deepEqual(month.figures.map(figure=>figure.label),
    ['Output tokens','At API prices','Cache hit','Sessions, 14 days','Branches merged, 14 days','Claude weeks that ran out']);
  const days=[...view.tokens,...view.providerTokenSources].flatMap(row=>row.days).filter(day=>day.date>'2026-09-21');
  const sum=field=>days.reduce((total,day)=>total+day[field],0);
  const [output,usd,cache,sessions,merged,weeks]=month.figures.map(figure=>figure.value);
  assert.match(output,/^\d+(\.\d)?[MB]$/);
  assert.equal(usd,`$${Math.round(days.reduce((total,day)=>total+day.apiEstimate.usd,0)).toLocaleString('en-US')}`);
  assert.equal(cache,`${Math.round(sum('cacheReadTokens')/(sum('cacheReadTokens')+sum('inputTokens')+sum('cacheCreationTokens'))*100)}%`);
  assert.deepEqual([sessions,merged,weeks],['400','48','1 of 3']);
  assert.equal(month.computers,'Test Mac, Test PC');
});

test('a longer range than the records reach counts what is recorded, and Unknown stays Unknown',()=>{
  const year=historyView(full,{range:'year',now});
  assert.equal(year.models.count,40,'the sample holds 40 days');
  const blank=historyView({...full,tokens:[],providerTokenSources:[],ledger:[],limitHistory:[]},{now});
  assert.deepEqual(blank.figures.map(figure=>figure.value),['Unknown','Unknown','Unknown','Unknown','Unknown','Unknown']);
  assert.deepEqual(blank.figures.map(figure=>figure.label).slice(3),['Sessions','Branches merged','Weeks that ran out']);
  assert.deepEqual([blank.models,blank.hours,blank.blocks,blank.pair],[null,null,null,null]);
  assert.ok(blank.heat.cells.every(cell=>cell.level===null && cell.title.endsWith('No records')));
  const unpriced=structuredClone(full);
  unpriced.tokens[0].days[2].apiEstimate.usd=null;
  assert.equal(historyView(unpriced,{now}).figures[1].value,'Unknown');
});

test('the heatmap covers a year of weeks ending today, and a day with no record is not a zero',()=>{
  const {heat}=historyView(full,{now});
  assert.equal(heat.weeks,HEAT_WEEKS);
  assert.equal(heat.cells.at(-1).date,'2026-10-21');
  assert.equal(heat.cells.at(-1).weekday,3,'a Wednesday');
  assert.equal(heat.cells[0].weekday,0);
  assert.equal(heat.cells.filter(cell=>cell.level!==null).length,40);
  assert.ok(heat.cells.filter(cell=>cell.level!==null).every(cell=>cell.level>=1 && cell.level<=4));
  assert.deepEqual(new Set(heat.cells.filter(cell=>cell.level!==null).map(cell=>cell.level)).size>=3,true);
  assert.match(heat.cells.at(-1).title,/^Oct 21: \$[\d,.]+$/);
  assert.ok(heat.months.length>=11 && heat.months.at(-1).text==='Oct');
  const zero=structuredClone(full);
  for(const row of [...zero.tokens,...zero.providerTokenSources])row.days[5].apiEstimate.usd=0;
  assert.equal(historyView(zero,{now}).heat.cells.find(cell=>cell.date==='2026-10-16').level,0);
});

test('by model stacks the largest models and by hour adds each hour of the day',()=>{
  const {models,hours}=historyView(full,{now});
  assert.deepEqual(models.series.map(part=>part.label),['Opus','Sonnet','gpt-6-astra','gpt-5.6-terra']);
  assert.equal(models.count,30);
  assert.ok(models.series.every(part=>part.values.length===30));
  assert.equal(models.last,'Oct 21');
  assert.ok(models.max>0);
  assert.equal(hours.bars.length,24);
  assert.deepEqual(hours.ticks.map(tick=>tick.text),['12 AM','6 AM','12 PM','6 PM']);
  assert.ok(hours.bars[14].value>hours.bars[3].value,'the sample works in the afternoon');
  const many=structuredClone(full);
  many.tokens[0].days[1].models.push({...many.tokens[0].days[1].models[0],model:'gpt-7-nova'});
  assert.equal(historyView(many,{now}).models.series.at(-1).label,'Other');
});

test('5-hour blocks group by day, mark the ones that hit the limit and skip windows nobody used',()=>{
  const {blocks,engines,engine}=historyView(full,{now});
  assert.deepEqual(engines,[{id:'claude',name:'Claude'},{id:'codex',name:'Codex'}]);
  assert.equal(engine,'claude');
  assert.equal(blocks.aside,'Last 7 days, 1 hit the limit');
  assert.deepEqual(blocks.days.map(day=>day.label),['Mon','Tue','Wed']);
  assert.deepEqual(blocks.days.flatMap(day=>day.blocks.map(block=>[block.used,block.hit])),[[65,false],[38,false],[100,true],[38,false],[65,false],[38,false]]);
  assert.equal(historyView(full,{now,engine:'codex'}).blocks,null,'a full window with a moving reset is not a block');
});

test('spent and shipped pairs each ledger day across both weeks',()=>{
  const {pair}=historyView(full,{now});
  assert.ok(pair.days.length>=11 && pair.days.length<=14);
  assert.ok(pair.days.every((day,index)=>index===0 || day.date>pair.days[index-1].date));
  assert.ok(pair.maxUsd>0 && pair.maxMain>0);
  assert.match(pair.days[0].label,/^[A-Z][a-z]{2} \d+: \$[\d,.]+ spent, \d+ commits$/);
});

test('a session active on both sides of the reset counts once in Sessions',()=>{
  const at=offset=>new Date(now+offset).toISOString();
  const listed=id=>({id,title:null,startedAt:at(-3600000),lastActiveAt:at(-60000),running:false,state:null,ratePerHour:null,
    tokens:{input:1,output:1,cacheRead:0,cacheWrite:0},apiUsd:1,models:[],subagents:0,kinds:[],fanout:[],
    shipped:{estimated:true,commits:0,onMain:0,merges:0,prsOpen:null,repos:[]},signals:{}});
  const part=(key,start,sessions)=>({key,start:at(start),end:at(start+7*86400000),windowKnown:true,apiUsd:sessions.length,
    sessionCount:sessions.length,sessions,other:null,days:[]});
  const ledger=[{host:'Mac',status:'ok',collectedAt:at(0),tools:[{tool:'claude',name:'Claude Code',limitEngine:'claude',status:'ok',periods:[
    part('current',-86400000,[listed('aaaaaaaaaaaa'),listed('bbbbbbbbbbbb')]),part('previous',-8*86400000,[listed('aaaaaaaaaaaa')])]}]}];
  const figures=historyView({...full,ledger},{range:'month',now}).figures;
  assert.equal(figures.find(figure=>figure.label.startsWith('Sessions')).value,'2');
});
