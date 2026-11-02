import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {privateFolder} from '../lib/private-folder.mjs';
import {estimate} from './api-estimate.mjs';

// Claude Code deletes transcripts after 30 days by default, so each computer keeps
// its own daily token totals here for good. Only daily counts are kept, never log text.
export const ENGINES=['claude','codex'];
const SCHEMA=`CREATE TABLE IF NOT EXISTS token_days (
  engine TEXT NOT NULL CHECK (engine IN ('claude','codex')),
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  total INTEGER NOT NULL CHECK (total >= 0),
  day TEXT NOT NULL CHECK (length(day) <= 100000),
  PRIMARY KEY (engine, date)
) WITHOUT ROWID`;

export async function openTokenStore(dataFolder) {
  const folder=await privateFolder(dataFolder,'private-history');
  const db=new DatabaseSync(path.join(folder,'tokens.sqlite'));
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE;');
  db.exec(SCHEMA);
  return db;
}

const date=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
// Prices are applied when the days are shown, so a saved day follows the current price table.
const unpriced=({apiEstimate:_day,...day})=>Array.isArray(day.models)?{...day,models:day.models.map(({apiEstimate:_model,...model})=>model)}:day;
const priced=day=>{
  if(!Array.isArray(day.models))return day;
  const models=day.models.map(model=>({...model,apiEstimate:estimate([model])}));
  return {...day,models,apiEstimate:estimate(models)};
};

// A day read now replaces the saved one unless it counts fewer tokens, which happens once
// some of that day's logs are deleted. Returns every saved day for the engine, oldest first.
export function keepTokenDays(db,engine,days) {
  if(!ENGINES.includes(engine))throw Error('Unknown token engine');
  const saved=db.prepare('SELECT total FROM token_days WHERE engine=? AND date=?');
  const write=db.prepare('INSERT OR REPLACE INTO token_days (engine,date,total,day) VALUES (?,?,?,?)');
  db.exec('BEGIN');
  try {
    for(const day of days) {
      if(!date(day?.date) || !Number.isSafeInteger(day.totalTokens) || day.totalTokens<0)continue;
      const prior=saved.get(engine,day.date);
      if(prior && prior.total>day.totalTokens)continue;
      write.run(engine,day.date,day.totalTokens,JSON.stringify(unpriced(day)));
    }
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
  return db.prepare('SELECT day FROM token_days WHERE engine=? ORDER BY date').all(engine).map(row=>priced(JSON.parse(row.day)));
}
