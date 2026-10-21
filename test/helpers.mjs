import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sampleSnapshot} from '../lib/sample-snapshot.mjs';

export async function withFolder(action) {
  const folder=await mkdtemp(path.join(tmpdir(),'observatory-test-'));
  try {return await action(folder);}
  finally {await rm(folder,{recursive:true,force:true});}
}

// One computer's own snapshot, cut from the fictional sample. Rows about the
// other computer become not-connected, as a fresh collection writes them.
export function ownSnapshot(host,now=Date.now(),change=snapshot=>snapshot) {
  const sample=sampleSnapshot(now);
  const other=host==='Mac'?'Windows':'Mac';
  const keep=rows=>(rows??[]).filter(row=>row.host===host);
  const snapshot={...sample,
    device:{host,name:host==='Mac'?'Test Mac':'Test PC'},
    activity:[...keep(sample.activity),{host:other,status:'not-connected'}],
    tokens:[...keep(sample.tokens),{host:other,status:'not-connected'}],
    settings:keep(sample.settings),dictation:[],
    providerTokenSources:keep(sample.providerTokenSources),
    activityHistory:keep(sample.activityHistory)};
  return change(snapshot);
}

export function testConfig(dataFolder,overrides={}) {
  return {platform:'mac',host:'Mac',device:{name:'Test Mac'},
    sources:{screenTime:true,codex:true,codexLimits:true,claudeCode:true,claudeLimits:true},
    hub:{spokes:[]},role:'spoke',dashboard:{port:5601},dataFolder,...overrides};
}
