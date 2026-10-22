// Import limit history kept by earlier versions into the limit history store.
// - The Codex limits archive (private-quota/*.sqlite): every saved observation.
// - Saved snapshots (usage.json, usage.before-hub.json, MigrationArchives):
//   the Codex history samples, and the Claude Code and Codex readings they hold.
// Each reading keeps its original observation time and is labelled with the file
// it came from. Running the import again adds nothing new, because a reading that
// is already stored is left alone.
import {DatabaseSync} from 'node:sqlite';
import {lstat,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../lib/config.mjs';
import {openHistory,readingsFrom,recordReadings} from './limit-history.mjs';

const MAX_FILE=16_000_000;
const OTHER={Mac:'Windows',Windows:'Mac'};

async function plainFile(file) {
  try {
    const info=await lstat(file);
    return info.isFile() && !info.isSymbolicLink() && info.size<=MAX_FILE;
  } catch {return false;}
}

async function files(folder,match,depth=2) {
  let entries;
  try {entries=await readdir(folder,{withFileTypes:true});}catch {return [];}
  const found=[];
  for(const entry of entries) {
    const full=path.join(folder,entry.name);
    if(entry.isDirectory() && depth>0)found.push(...await files(full,match,depth-1));
    else if(entry.isFile() && match(entry.name))found.push(full);
  }
  return found.sort((a,b)=>a.localeCompare(b));
}

// Codex readings saved by the limits store, observed on this computer.
export function codexArchiveReadings(databaseFile,{observer,label}) {
  let db;
  try {db=new DatabaseSync(databaseFile,{readOnly:true});}catch {return [];}
  try {
    const tables=new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name));
    const readings=[];
    const add=(record,source)=>readings.push(...readingsFrom({...record,status:'ok'},{provider:'codex',observer,source}));
    if(tables.has('quota_archive'))
      for(const row of db.prepare("SELECT record FROM quota_archive WHERE kind='observation' ORDER BY observed_at").iterate()) {
        try {add(JSON.parse(row.record),label);}catch {}
      }
    if(tables.has('quota_state')) {
      const row=db.prepare('SELECT record FROM quota_state WHERE slot=1').get();
      try {
        const samples=JSON.parse(row?.record ?? 'null')?.history?.samples;
        if(Array.isArray(samples))for(const sample of samples)add(sample,label);
      } catch {}
    }
    return readings;
  } finally {db.close();}
}

// Readings held inside one saved snapshot.
export function snapshotReadings(snapshot,{observer,label}) {
  if(!snapshot || typeof snapshot!=='object')return [];
  const readings=[];
  const quota=snapshot.quota;
  readings.push(...readingsFrom(quota,{provider:'codex',observer,source:label}));
  if(Array.isArray(quota?.history))for(const sample of quota.history)
    readings.push(...readingsFrom({...sample,status:'ok'},{provider:'codex',observer,source:label}));
  readings.push(...readingsFrom(snapshot.claudeLimits,{provider:'claude',observer,source:label}));
  // A paired computer's shared Codex reading, from the full app. It was observed over there.
  const peer=snapshot.peerQuota;
  if(peer && typeof peer==='object') {
    const host=['Mac','Windows'].includes(peer.host)?peer.host:OTHER[observer];
    readings.push(...readingsFrom(peer.quota ?? peer,{provider:'codex',observer:host,source:`${label} (shared from ${host})`}));
  }
  return readings;
}

export async function importHistory(config,{log=()=>{}}={}) {
  const data=config.dataFolder,observer=config.host;
  const db=await openHistory(data);
  const report=[];
  try {
    for(const file of await files(path.join(data,'private-quota'),name=>name.endsWith('.sqlite'),0)) {
      const label=`codex archive ${path.basename(file)}`;
      const added=recordReadings(db,codexArchiveReadings(file,{observer,label:'codex archive'}));
      report.push({source:label,added});
    }
    const snapshots=[
      ...await files(path.join(data,'public','local'),name=>/^usage(\..+)?\.json$/.test(name),0),
      ...await files(path.join(data,'MigrationArchives'),name=>name==='snapshot.json'),
      ...await files(path.join(data,'Backups'),name=>name.endsWith('.json')),
    ];
    for(const file of snapshots) {
      if(!await plainFile(file))continue;
      let snapshot;
      try {snapshot=JSON.parse(await readFile(file,'utf8'));}catch {continue;}
      const label=`snapshot ${path.relative(data,file).split(path.sep).join('/')}`;
      const added=recordReadings(db,snapshotReadings(snapshot,{observer,label}));
      report.push({source:label,added});
    }
  } finally {db.close();}
  for(const row of report)log(`${row.source}: ${row.added} new readings`);
  return report;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const report=await importHistory(await loadConfig(),{log:console.log});
    console.log(`Imported ${report.reduce((total,row)=>total+row.added,0)} new readings.`);
  } catch(error) {console.error(`Import failed: ${error.message}`);process.exitCode=1;}
}
