import {existsSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {appNames} from '../app-names.mjs';
import {assertObservatoryStopped} from './migrate-data.mjs';

export function checkInstallTarget({applicationsFolders,dataParent,runningProcesses}) {
  assertObservatoryStopped(runningProcesses,'Quit the earlier Observatory app first.');
  const receipt=path.join(dataParent,appNames.visible.dataFolder,'observatory-migration.json');
  if(existsSync(path.join(dataParent,appNames.legacy.dataFolder)) &&
    (!existsSync(receipt) || !lstatSync(receipt).isFile()))
    throw Error('Migrate the earlier data folder first: node native/mac/migrate-data.mjs copy --confirm-app-quit');
  return {legacyBundles:applicationsFolders.map(folder=>path.join(folder,appNames.legacy.macBundle)).filter(existsSync)};
}
