import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {buildSnapshot} from '../scripts/collect.mjs';
import {collectClaudeUsage} from '../scripts/read-claude-usage.mjs';
import {openTokenStore,keepTokenDays} from '../scripts/token-store.mjs';
import {combine,SUM_LABEL} from '../lib/combine.mjs';
import {tokensView} from '../lib/view-tokens.mjs';
import {withFolder,testConfig} from './helpers.mjs';

// Both computers lose their oldest Claude Code logs. The saved daily totals must keep those days,
// and the combined All view must add each computer's days and carry the "not deduplicated" label.
const usage=(input,output)=>({input_tokens:input,cache_read_input_tokens:0,cache_creation_input_tokens:0,output_tokens:output});
const reply=(id,timestamp,values)=>JSON.stringify({type:'assistant',timestamp,requestId:`r-${id}`,
  message:{role:'assistant',id:`m-${id}`,model:'claude-sonnet-4-20250514',usage:values,content:'synthetic'}})+'\n';
const quiet={screenTime:false,codex:false,codexLimits:false,claudeCode:true,claudeLimits:false};
const NOW='2026-10-21T12:00:00Z';
const LATER='2026-10-21T12:05:00Z';

// One computer: an old day (1000+200 on Mac, 5000+500 on Windows) and a recent day (300+40, 700+60).
async function computer(folder,host,[oldIn,oldOut],[newIn,newOut]) {
  const claude=path.join(folder,host,'claude'),data=path.join(folder,host,'data');
  await mkdir(path.join(claude,'projects','fictional'),{recursive:true});
  const old=path.join(claude,'projects','fictional','old.jsonl');
  await writeFile(old,reply(`${host}-a`,'2026-09-20T15:00:00Z',usage(oldIn,oldOut)));
  await writeFile(path.join(claude,'projects','fictional','new.jsonl'),reply(`${host}-b`,'2026-10-20T15:00:00Z',usage(newIn,newOut)));
  const config=testConfig(data,{host,platform:host==='Mac'?'mac':'windows',device:{name:`Test ${host}`},sources:quiet});
  const run=async(at,keep)=>{
    const store=keep?await openTokenStore(data):null;
    try {
      const {data:snapshot}=await buildSnapshot(config,{claudeCode:()=>collectClaudeUsage(claude)},
        {now:new Date(at),keepDays:store?(engine,days)=>keepTokenDays(store,engine,days):null});
      return snapshot;
    } finally {store?.close();}
  };
  return {run,deleteOld:()=>rm(old)};
}

const both=async(folder,keep)=>{
  const mac=await computer(folder,'Mac',[1000,200],[300,40]);
  const pc=await computer(folder,'Windows',[5000,500],[700,60]);
  await mac.run(NOW,true);await pc.run(NOW,true);
  await mac.deleteOld();await pc.deleteOld();
  const at=Date.parse(LATER);
  const combined=combine([{host:'Mac',snapshot:await mac.run(LATER,keep)},{host:'Windows',snapshot:await pc.run(LATER,keep)}],{now:at,generatedBy:'Mac'});
  return {combined,at};
};
const days=block=>Object.fromEntries(block.days.map(day=>[day.date,day.total]));

test('after both computers delete their old logs, All still counts every saved day and labels the sum',()=>withFolder(async folder=>{
  const {combined,at}=await both(folder,true);
  const all=tokensView(combined.view,{host:'All',period:'all',now:at}).claude;
  assert.equal(all.status,'ok');
  assert.deepEqual(days(all),{'2026-09-20':1200+5500,'2026-10-20':340+760});
  assert.equal(all.totals.total,1200+5500+340+760);
  assert.deepEqual(all.byDevice.map(row=>[row.host,row.total]),[['Mac',1540],['Windows',6260]]);
  assert.equal(all.byDevice.reduce((sum,row)=>sum+row.total,0),all.totals.total);
  const mac=tokensView(combined.view,{host:'Mac',period:'all',now:at}).claude;
  assert.deepEqual(days(mac),{'2026-09-20':1200,'2026-10-20':340});
  assert.equal(combined.glance.both.label,SUM_LABEL);
  assert.ok(combined.glance.lines.some(line=>line.includes('not deduplicated')));
}));

test('without the saved daily totals the deleted days would vanish from All',()=>withFolder(async folder=>{
  const {combined,at}=await both(folder,false);
  const all=tokensView(combined.view,{host:'All',period:'all',now:at}).claude;
  assert.deepEqual(days(all),{'2026-10-20':340+760});
}));
