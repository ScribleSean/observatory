import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sampleSnapshot} from '../lib/sample-snapshot.mjs';

export async function withFolder(action) {
  const folder=await mkdtemp(path.join(tmpdir(),'observatory-test-'));
  try {return await action(folder);}
  finally {await rm(folder,{recursive:true,force:true});}
}

export function ownSnapshot(host,now=Date.now(),change=snapshot=>snapshot) {
  const sample=sampleSnapshot(now);
  const other=host==='Mac'?'Windows':'Mac';
  const keep=rows=>(rows??[]).filter(row=>row.host===host);
  const snapshot={...sample,schema:2,
    device:{host,name:host==='Mac'?'Test Mac':'Test PC'},
    activity:[...keep(sample.activity),{host:other,status:'not-connected'}],
    tokens:[...keep(sample.tokens),{host:other,status:'not-connected'}],
    settings:keep(sample.settings),
    providerTokenSources:keep(sample.providerTokenSources),
    activityHistory:keep(sample.activityHistory),
    modelDrift:keep(sample.modelDrift),
    ledger:keep(sample.ledger)};
  return change(snapshot);
}

export function testConfig(dataFolder,overrides={}) {
  return {platform:'mac',host:'Mac',device:{name:'Test Mac'},
    sources:{screenTime:true,codex:true,codexLimits:true,claudeCode:true,claudeLimits:true},
    hub:{spokes:[]},role:'spoke',dashboard:{port:5601},dataFolder,...overrides};
}

// The bar plots in server-rendered markup (BarPlot in app/viewer/r2/views/parts.tsx): one list per <svg class="bars">,
// one entry per column (a <g> of bar rects, or an Unknown mark with no bars), each bar {cls, x, y, width, height}.
export function barPlots(markup) {
  const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,value])=>[key,value]));
  return [...markup.matchAll(/<svg class="bars"[^>]*>([\s\S]*?)<\/svg>/g)].map(([,body])=>
    [...body.matchAll(/<g[^>]*>([\s\S]*?)<\/g>|<g[^>]*\/>|<rect class="unk[^>]*>(?:<\/rect>)?/g)].map(([,inner])=>
      [...(inner??'').matchAll(/<rect [^>]*>/g)].map(([tag])=>attrs(tag)).filter(rect=>rect.class?.startsWith('bar '))
        .map(rect=>({cls:rect.class.slice(4),x:Number(rect.x),y:Number(rect.y),width:Number(rect.width),height:Number(rect.height)}))));
}
