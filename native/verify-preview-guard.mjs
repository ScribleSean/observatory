import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

assert.equal(process.argv.length,3,'Expected the preview-only executable path');
const executable=path.resolve(process.argv[2]);
const rejected=[[],['--show'],['--enable-login'],['--preview','--enable-login'],
  ['--preview-quota-archive','unexpected'],['--preview-light'],['--test-lifecycle'],
  ['--capture-dashboard'],['--test-lifecycle','--capture-dashboard','unexpected']];
for(const args of rejected) {
  const result=spawnSync(executable,args,{encoding:'utf8',timeout:5000,killSignal:'SIGKILL',maxBuffer:4096});
  assert.ifError(result.error);
  assert.equal(result.status,64,`Unsafe launch was not refused: ${JSON.stringify(args)}`);
  assert.equal(result.stdout.trim(),'Preview-only build requires an explicit isolated preview mode');
}
console.log(`${rejected.length} unsafe preview launch modes refused`);
