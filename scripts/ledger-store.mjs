// The ledger history's private store: private-history/ledger.sqlite, beside tokens.sqlite. It keeps one
// day per tool and date with every session in it, the ids of the commits counted that day (to check them
// again for reaching main) and Grok's request count per day, for as long as the folder exists. The
// snapshot's ledgerHistory row is shaped from it (historyRow) and trimmed by lib/r2-shape.mjs.
//
// How days change (docs/R2-PLAN.md): each collection rebuilds the last REDERIVE_DAYS from transcripts
// and git. Older days are frozen, except that commits on main are checked again for ONMAIN_RECHECK_DAYS
// from the stored commit ids. The first collection for a tool backfills every day its transcripts still
// hold, and a collector that was off for a while fills the gap the same way.
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {privateFolder} from '../lib/private-folder.mjs';
import {LEDGER_HISTORY_SCHEMA,SESSION_DAY_TOP,SESSION_DAYS,REDERIVE_DAYS,ONMAIN_RECHECK_DAYS,MAX_DAY_REPOS,MAX_SESSION_MODELS,
  MAX_SESSION_KINDS,MAX_SESSION_REPOS} from '../lib/r2-shape.mjs';
import {dayKey} from './read-projects.mjs';
import {addDays,datesFrom,dateFloorMs} from './ledger-history.mjs';
import {gitRunner,defaultBranch} from './ledger-commits.mjs';
import {knownSum,round} from './ledger.mjs';

const SCHEMA=`
CREATE TABLE IF NOT EXISTS ledger_days (
  tool TEXT NOT NULL CHECK (length(tool) <= 32),
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  day TEXT NOT NULL,
  PRIMARY KEY (tool, date)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ledger_commits (
  repo TEXT NOT NULL,
  sha TEXT NOT NULL,
  tool TEXT NOT NULL,
  date TEXT NOT NULL,
  session TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  on_main INTEGER,
  PRIMARY KEY (repo, sha)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ledger_commits_day ON ledger_commits (tool, date);
CREATE TABLE IF NOT EXISTS ledger_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS grok_days (
  date TEXT PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  count INTEGER NOT NULL CHECK (count >= 0)
) WITHOUT ROWID;`;

export const STORE_FILE='ledger.sqlite';
// Grok days kept in the snapshot: about ten years.
const GROK_DAYS_MAX=3660;
const RECHECK_MS=10000;

export async function openLedgerStore(dataFolder) {
  const folder=await privateFolder(dataFolder,'private-history');
  const db=new DatabaseSync(path.join(folder,STORE_FILE));
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE;');
  db.exec(SCHEMA);
  return db;
}

const meta=(db,key)=>db.prepare('SELECT value FROM ledger_meta WHERE key=?').get(key)?.value ?? null;
const setMeta=(db,key,value)=>db.prepare('INSERT OR REPLACE INTO ledger_meta (key,value) VALUES (?,?)').run(key,String(value));
const transaction=(db,work)=>{
  db.exec('BEGIN');
  try {const result=work();db.exec('COMMIT');return result;}
  catch(error) {db.exec('ROLLBACK');throw error;}
};

// The first date rebuilt on each collection.
export const rebuildFrom=today=>addDays(today,-(REDERIVE_DAYS-1));

/**
 * What this collection must read for each tool beyond the usual window. `extra` names, per tool id, the
 * time to read transcripts from (0 for every transcript) and the first date to rebuild (null: from the
 * first request found), for a tool to backfill or whose history has a gap. Every tool rebuilds `rebuild`.
 * @param {DatabaseSync} db
 * @param {{tools: string[], now: number, timeZone: string}} options
 */
export function historyPlan(db,{tools,now,timeZone}) {
  const today=dayKey(now,timeZone),from=rebuildFrom(today);
  const extra={};
  for(const tool of tools) {
    if(meta(db,`backfilled:${tool}`)!=='1') {extra[tool]={since:0,from:null};continue;}
    const through=meta(db,`through:${tool}`);
    if(through && through<addDays(from,-1))extra[tool]={since:dateFloorMs(addDays(through,1)),from:addDays(through,1)};
  }
  return {today,rebuild:datesFrom(from,today),extra};
}

// The dates a tool rebuilds from what was read: `from` to today, or from its first request when backfilling.
export function datesToBuild({today,sessions,from,timeZone}) {
  if(from===null) {
    const first=Math.min(...sessions.flatMap(session=>session.requests.map(request=>request.at)));
    const start=Number.isFinite(first)?dayKey(first,timeZone):today;
    return datesFrom(start<rebuildFrom(today)?start:rebuildFrom(today),today);
  }
  return datesFrom(from<rebuildFrom(today)?from:rebuildFrom(today),today);
}

/**
 * Replaces the given days and their commits. `backfilled` marks a tool whose every transcript was read.
 * `held` names tools whose gap could not be read this time: their days are written, but the date they
 * are complete through stays, so the gap is read again next time.
 * @param {DatabaseSync} db
 * @param {{days: object[], commits: object[], backfilled?: string[], held?: string[]}} built  From scripts/ledger-history.mjs.
 */
export function writeHistory(db,{days,commits,backfilled=[],held=[]}) {
  const putDay=db.prepare('INSERT OR REPLACE INTO ledger_days (tool,date,day) VALUES (?,?,?)');
  const dropCommits=db.prepare('DELETE FROM ledger_commits WHERE tool=? AND date=?');
  const putCommit=db.prepare('INSERT OR REPLACE INTO ledger_commits (repo,sha,tool,date,session,repo_name,on_main) VALUES (?,?,?,?,?,?,?)');
  transaction(db,()=>{
    const through=new Map();
    for(const day of days) {
      putDay.run(day.tool,day.date,JSON.stringify(day));
      dropCommits.run(day.tool,day.date);
      if(!(through.get(day.tool)>=day.date))through.set(day.tool,day.date);
    }
    for(const commit of commits)
      putCommit.run(commit.repo,commit.sha,commit.tool,commit.date,commit.session,commit.repoName,commit.onMain===null?null:commit.onMain?1:0);
    for(const [tool,date] of through)if(!held.includes(tool) && !(meta(db,`through:${tool}`)>=date))setMeta(db,`through:${tool}`,date);
    for(const tool of backfilled)setMeta(db,`backfilled:${tool}`,1);
  });
}

// A stored day's commits on main, counted again from its commit rows. Values that were Unknown stay so.
export function applyOnMain(day,rows) {
  const count=(session,repo)=>rows.filter(row=>row.session===session && row.repo_name===repo && row.on_main===1).length;
  for(const session of day.sessions)for(const ship of session.ship)
    if(ship.onMain!==null && ship.commits!==null)ship.onMain=count(session.id,ship.repo);
  const ships=day.sessions.flatMap(session=>session.ship);
  for(const repo of day.repos)repo.onMain=knownSum(ships.filter(ship=>ship.repo===repo.repo).map(ship=>ship.onMain));
  day.ship.onMain=knownSum(ships.map(ship=>ship.onMain));
  return day;
}

/**
 * Checks commits that were not on main, from days past the rebuild window and inside ONMAIN_RECHECK_DAYS,
 * and updates the days whose count changed. Returns how many commits reached main since.
 * @param {DatabaseSync} db
 * @param {{today: string, git?: Function, deadline?: number, exists?: Function, clock?: Function}} options
 */
export async function recheckOnMain(db,{today,git=gitRunner(),deadline=Date.now()+RECHECK_MS,exists=fs.existsSync,clock=Date.now}) {
  const from=addDays(today,-(ONMAIN_RECHECK_DAYS-1)),until=rebuildFrom(today);
  const waiting=db.prepare('SELECT repo,sha,tool,date FROM ledger_commits WHERE on_main=0 AND date>=? AND date<?').all(from,until);
  const byRepo=new Map();
  for(const row of waiting) {
    if(!byRepo.has(row.repo))byRepo.set(row.repo,[]);
    byRepo.get(row.repo).push(row);
  }
  const landed=[];
  for(const [repo,rows] of byRepo) {
    if(clock()>=deadline)break;
    if(!exists(repo))continue;
    const base=await defaultBranch(git,repo);
    if(!base || clock()>=deadline)continue;
    const oldest=rows.reduce((first,row)=>row.date<first?row.date:first,rows[0].date);
    const reached=await git(repo,['rev-list',`--since=@${Math.floor(dateFloorMs(oldest)/1000)}`,'--end-of-options',base]);
    if(reached===null)continue;
    const onMain=new Set(reached.split('\n').filter(Boolean));
    landed.push(...rows.filter(row=>onMain.has(row.sha)));
  }
  if(!landed.length)return 0;
  const mark=db.prepare('UPDATE ledger_commits SET on_main=1 WHERE repo=? AND sha=?');
  const dayRows=db.prepare('SELECT session,repo_name,on_main FROM ledger_commits WHERE tool=? AND date=?');
  const getDay=db.prepare('SELECT day FROM ledger_days WHERE tool=? AND date=?');
  const putDay=db.prepare('UPDATE ledger_days SET day=? WHERE tool=? AND date=?');
  transaction(db,()=>{
    for(const row of landed)mark.run(row.repo,row.sha);
    const days=new Set(landed.map(row=>`${row.tool}\0${row.date}`));
    for(const key of days) {
      const [tool,date]=key.split('\0');
      const saved=getDay.get(tool,date);
      if(!saved)continue;
      putDay.run(JSON.stringify(applyOnMain(JSON.parse(saved.day),dayRows.all(tool,date))),tool,date);
    }
  });
  return landed.length;
}

// Keeps the first `max` of a list sorted largest first, and sums the rest into one row named `other`.
function capped(rows,max,key,merge) {
  if(rows.length<=max)return rows;
  const kept=rows.slice(0,max-1),rest=rows.slice(max-1);
  const existing=kept.find(row=>row[key]==='other');
  const folded=merge(existing?[existing,...rest]:rest);
  return [...kept.filter(row=>row!==existing),{...folded,[key]:'other'}];
}
const sumOf=(rows,field)=>knownSum(rows.map(row=>row[field]));

function listedSession(session,titles) {
  return {...session,title:titles?session.title ?? null:null,
    models:capped(session.models,MAX_SESSION_MODELS,'model',rows=>({apiUsd:round(sumOf(rows,'apiUsd')),outputTokens:sumOf(rows,'outputTokens')})),
    kinds:capped(session.kinds,MAX_SESSION_KINDS,'kind',rows=>({apiUsd:round(sumOf(rows,'apiUsd')),subagents:rows.reduce((sum,row)=>sum+row.subagents,0)})),
    ship:session.ship.slice(0,MAX_SESSION_REPOS)};
}
const shipOf=ships=>({commits:sumOf(ships,'commits'),onMain:sumOf(ships,'onMain'),merges:sumOf(ships,'merges')});

// Folds sessions into a day's `other`, with a compact row each.
export function foldSessions(day,sessions) {
  if(!sessions.length)return day.other;
  const prior=day.other ?? {count:0,apiUsd:0,subagents:0,ship:{commits:0,onMain:0,merges:0},rows:[]};
  const ships=sessions.map(session=>shipOf(session.ship));
  return {count:prior.count+sessions.length,apiUsd:round(knownSum([prior.apiUsd,...sessions.map(session=>session.apiUsd)])),
    subagents:prior.subagents+sessions.reduce((sum,session)=>sum+session.kinds.reduce((total,kind)=>total+kind.subagents,0),0),
    ship:shipOf([prior.ship,...ships]),
    rows:[...prior.rows,...sessions.map((session,index)=>[session.id,session.apiUsd,ships[index].commits,ships[index].onMain])]};
}

// One stored day as the snapshot carries it.
export function snapshotDay(day,{listSessions,titles,frozen}) {
  const {sessions,other:_other,...rest}=day;
  const listed=listSessions?sessions.slice(0,SESSION_DAY_TOP):[];
  const shaped={...rest,frozen,repos:day.repos.slice(0,MAX_DAY_REPOS),sessions:listed.map(session=>listedSession(session,titles)),other:null};
  shaped.other=foldSessions(shaped,sessions.slice(listed.length));
  return shaped;
}

/**
 * This computer's ledgerHistory row from the store. Tools in `unread` could not be read this time, so
 * their rebuild days with no stored record read as unavailable.
 * @param {DatabaseSync} db
 * @param {{host: string, now: number, timeZone: string, titles: boolean, unread?: string[]}} options
 */
export function historyRow(db,{host,now,timeZone,titles,unread=[]}) {
  const today=dayKey(now,timeZone),frozenBefore=rebuildFrom(today),listFrom=addDays(today,-(SESSION_DAYS-1));
  const stored=db.prepare('SELECT tool,day FROM ledger_days WHERE date<=? ORDER BY date,tool').all(today);
  const days=stored.map(row=>{
    const day=JSON.parse(row.day);
    return snapshotDay(day,{listSessions:day.date>=listFrom,titles,frozen:day.date<frozenBefore});
  });
  const have=new Set(days.map(day=>`${day.tool}\0${day.date}`));
  for(const tool of unread)for(const date of datesFrom(frozenBefore,today)) {
    if(have.has(`${tool}\0${date}`))continue;
    days.push({date,tool,status:'unavailable',frozen:false,apiUsd:null,sessionCount:null,subagents:null,
      tokens:{input:null,output:null,cacheRead:null,cacheWrite:null},models:[],kinds:[],origins:[],repos:[],
      ship:{commits:null,onMain:null,merges:null},sessions:[],other:null});
  }
  days.sort((a,b)=>a.date.localeCompare(b.date) || a.tool.localeCompare(b.tool));
  const firstDate=days[0]?.date ?? null;
  const listed=days.filter(day=>day.date>=listFrom);
  return {host,status:'ok',checkedAt:new Date(now).toISOString(),schema:LEDGER_HISTORY_SCHEMA,timeZone,firstDate,
    sessionsFrom:firstDate===null?null:listed[0]?.date ?? null,days};
}

/**
 * Keeps Grok's request counts per day for good. The log only covers recent days and its oldest day may be
 * cut short, so a day keeps the larger of its saved and new counts. Returns every saved day, oldest first.
 * @param {DatabaseSync} db
 * @param {{date: string, count: number | null}[]} days
 */
export function keepGrokDays(db,days) {
  const put=db.prepare('INSERT INTO grok_days (date,count) VALUES (?,?) ON CONFLICT(date) DO UPDATE SET count=max(count,excluded.count)');
  transaction(db,()=>{
    for(const day of days)
      if(typeof day?.date==='string' && /^\d{4}-\d\d-\d\d$/.test(day.date) && Number.isSafeInteger(day.count) && day.count>=0)put.run(day.date,day.count);
  });
  return db.prepare('SELECT date,count FROM grok_days ORDER BY date DESC LIMIT ?').all(GROK_DAYS_MAX).reverse().map(row=>({date:row.date,count:row.count}));
}
