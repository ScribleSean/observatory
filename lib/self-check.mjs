// Observatory's own check of what it read: every metric that should have a value on a computer that is on, and
// does not. It reads only the combined snapshot, so it sees exactly what the dashboard shows.
// A computer turned off on purpose is skipped, and so is a source its settings turn off.
import {latestProfile} from './drift.mjs';

const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const rows=value=>Array.isArray(value)?value.filter(object):[];

// Statuses that are a value: read, or not something this platform has.
const FINE=new Set(['ok','unsupported']);
// Without a settings echo the computer's sources are not known, so a source it never set up is not a problem.
const NOT_SET_UP=new Set(['not-connected']);

// Each per-computer row in the view, with the settings that turn it on and what the dashboard calls it.
export const METRICS=Object.freeze([
  {key:'activity',label:'Screen time',on:(sources,host)=>sources.screenTime && host!=='Linux'},
  {key:'activityHistory',label:'Screen time history',on:(sources,host)=>sources.screenTime && host!=='Linux'},
  {key:'tokens',label:'Codex tokens',on:sources=>sources.codex},
  {key:'settings',label:'Codex model, effort and speed',on:sources=>sources.codex},
  {key:'providerTokenSources',label:'Claude Code tokens',on:sources=>sources.claudeCode},
  {key:'modelDrift',label:'Model drift (Claude Code model, effort and speed)',on:sources=>sources.claudeCode},
  {key:'projectTokens',label:'Project tokens',on:sources=>sources.claudeCode || sources.codex},
  {key:'ledger',label:'Sessions ledger',on:sources=>sources.claudeCode || sources.codex},
  {key:'ledgerHistory',label:'Sessions history',on:sources=>sources.claudeCode || sources.codex},
  {key:'limitHistory',label:'Limit history',on:sources=>sources.claudeLimits || sources.codexLimits || sources.grokLimits},
]);
// Account limits are read by the hub alone, one row each.
export const ACCOUNT_METRICS=Object.freeze([
  {key:'claudeLimits',label:'Claude Code limits',source:'claudeLimits'},
  {key:'grokLimits',label:'Grok limits',source:'grokLimits'},
  {key:'quota',label:'Codex limits',source:'codexLimits'},
]);

/**
 * Every metric that reads Unknown or stale on a computer that is on.
 * @param {object} combined  combined.json
 * @returns {{key: string, host: string, machine: string, metric: string, label: string, status: string, since: string | null}[]}
 */
export function findProblems(combined) {
  const view=object(combined?.view)?combined.view:{};
  const echoes=rows(view.config);
  const hub=echoes.find(row=>row.role==='hub')?.host ?? combined?.generatedBy ?? null;
  const problems=[];
  const add=(device,metric,label,status)=>problems.push({key:`${device.host}/${metric}`,host:device.host,machine:device.name ?? device.host,metric,label,status,
    since:typeof device.collectedAt==='string'?device.collectedAt:null});
  for(const device of rows(combined?.devices)) {
    if(typeof device.host!=='string' || device.state==='off')continue;
    // An old snapshot makes every metric on it old, so it is one problem, not one per metric.
    if(device.state!=='current') {add(device,'snapshot','Snapshot',device.state==='missing'?'missing':'stale');continue;}
    const echo=echoes.find(row=>row.host===device.host);
    const sources=object(echo?.sources)?echo.sources:null;
    for(const {key,label,on} of METRICS) {
      if(sources && !on(sources,device.host))continue;
      const row=rows(view[key]).find(item=>item.host===device.host);
      const status=typeof row?.status==='string'?row.status:'missing';
      if(FINE.has(status) || (!sources && (NOT_SET_UP.has(status) || !row)))continue;
      add(device,key,label,status);
    }
    // Drift read fine but gave no model, effort or speed: the setup table would say Unknown.
    const drift=rows(view.modelDrift).find(item=>item.host===device.host);
    if((!sources || sources.claudeCode) && drift?.status==='ok') {
      const profile=latestProfile(drift);
      for(const [field,label] of [['model','Claude Code model'],['effort','Claude Code effort'],['speed','Claude Code speed']])
        if(!profile?.[field])add(device,`claude-${field}`,label,'unknown');
    }
    if(device.host===hub && sources)
      for(const {key,label,source} of ACCOUNT_METRICS) {
        if(!sources[source])continue;
        const status=typeof view[key]?.status==='string'?view[key].status:'missing';
        if(!FINE.has(status))add(device,key,label,status);
      }
  }
  return problems;
}
