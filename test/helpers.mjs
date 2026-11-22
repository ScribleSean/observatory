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
// one entry per column (a <g> of bar paths, or an Unknown mark with no bars), each bar {cls, x, y, width, height}.
// A bar is a path of absolute x,y pairs, so its box is the min and max of its points.
export function barPlots(markup) {
  const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,value])=>[key,value]));
  const box=d=>{
    const pairs=[...d.matchAll(/(-?[\d.]+(?:e-?\d+)?),(-?[\d.]+(?:e-?\d+)?)/g)].map(([,x,y])=>[Number(x),Number(y)]);
    const xs=pairs.map(([x])=>x),ys=pairs.map(([,y])=>y);
    return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
  };
  return [...markup.matchAll(/<svg class="bars"[^>]*>([\s\S]*?)<\/svg>/g)].map(([,body])=>
    [...body.matchAll(/<g[^>]*>([\s\S]*?)<\/g>|<g[^>]*\/>|<rect class="unk[^>]*>(?:<\/rect>)?/g)].map(([,inner])=>
      [...(inner??'').matchAll(/<path [^>]*>/g)].map(([tag])=>attrs(tag)).filter(path=>path.class?.startsWith('bar '))
        .map(path=>({cls:path.class.slice(4),...box(path.d)}))));
}

