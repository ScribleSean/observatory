import {rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {withCycleDeadline} from '../lib/cycle-processes.mjs';
import {loadConfig} from '../lib/config.mjs';
import {privateFolder} from '../lib/private-folder.mjs';
import {withRunLock} from '../lib/run-lock.mjs';
import {writeJsonAtomic} from '../lib/atomic-file.mjs';
import {glanceView} from '../lib/glance-view.mjs';
import {TIME_ZONE} from '../lib/timezone.mjs';
import {collect} from './collect.mjs';
import {runHub,recombine} from './hub.mjs';

// The flags shown in the menu bar and tray: lib/ledger-flags.mjs pools every computer's sessions per tool.
export async function glanceFlags(combined) {
  try {
    const {snapshotFlags}=await import('../lib/ledger-flags.mjs');
    return snapshotFlags(combined);
  } catch {return null;}
}

// The menu bar and tray apps draw public/local/glance.json and nothing else. When it cannot be made, the old
// file is removed so the apps fall back to combined.json rather than show an older glance.
export async function writeGlance(config,combined,{now=Date.now(),flags=glanceFlags}={}) {
  const file=path.join(await privateFolder(config.dataFolder,'public','local'),'glance.json');
  try {
    const timeZone=combined.view?.timezone ?? TIME_ZONE;
    const view=glanceView(combined,{now,timeZone,flags:await flags(combined,{now,timeZone}),settings:{titles:config.sessions?.titles!==false}});
    await writeJsonAtomic(file,view);
    return 'ok';
  } catch(error) {
    await rm(file,{force:true});
    return error.message;
  }
}

export async function tick(config,{collectStep=collect,hubStep=runHub,spokeStep=recombine,glanceStep=writeGlance}={}) {
  const lockFolder=await privateFolder(config.dataFolder,'.runtime');
  return withRunLock(path.join(lockFolder,'tick.lock'),async()=>{
    const result={role:config.role,collect:'ok'};
    try {result.sources=(await collectStep(config)).status;}
    catch(error) {result.collect=error.message;}
    const combined=config.role==='hub'?await hubStep(config):await spokeStep(config);
    result.combined=combined.generatedAt;
    result.title=combined.glance.title;
    result.glance=await glanceStep(config,combined);
    if(combined.hub?.spokes)result.spokes=combined.hub.spokes;
    return result;
  });
}

export const TICK_DEADLINE_MS=4*60000;

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const outcome=await withCycleDeadline(async()=>tick(await loadConfig()),{
      deadlineMs:TICK_DEADLINE_MS,shutdownSignals:['SIGTERM','SIGINT'],onDeadline:()=>{console.error('Tick stopped at its deadline');process.exit(2);},
    });
    console.log(JSON.stringify(outcome.busy?{busy:true}:outcome.value));
  } catch(error) {
    console.error(`Tick failed: ${error.message}`);
    process.exitCode=1;
  }
}
