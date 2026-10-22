import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../lib/config.mjs';
import {privateFolder} from '../lib/private-folder.mjs';
import {withRunLock} from '../lib/run-lock.mjs';
import {collect} from './collect.mjs';
import {runHub,recombine} from './hub.mjs';

export async function tick(config,{collectStep=collect,hubStep=runHub,spokeStep=recombine}={}) {
  const lockFolder=await privateFolder(config.dataFolder,'.runtime');
  return withRunLock(path.join(lockFolder,'tick.lock'),async()=>{
    const result={role:config.role,collect:'ok'};
    try {result.sources=(await collectStep(config)).status;}
    catch(error) {result.collect=error.message;}
    const combined=config.role==='hub'?await hubStep(config):await spokeStep(config);
    result.combined=combined.generatedAt;
    result.title=combined.glance.title;
    if(combined.hub?.spokes)result.spokes=combined.hub.spokes;
    return result;
  });
}

export const TICK_DEADLINE_MS=4*60000;

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  setTimeout(()=>{console.error('Tick stopped at its deadline');process.exit(2);},TICK_DEADLINE_MS).unref();
  try {
    const outcome=await tick(await loadConfig());
    console.log(JSON.stringify(outcome.busy?{busy:true}:outcome.value));
  } catch(error) {
    console.error(`Tick failed: ${error.message}`);
    process.exitCode=1;
  }
}
