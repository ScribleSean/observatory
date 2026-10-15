import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {refreshAllowances} from './refresh-allowances.mjs';

test('allowance refresh loads saved localModel and leaves leftover checkpoints unchanged',async t=>{
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-saved-allowances-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'public/local/usage.json'),folder=path.join(root,'.runtime/private-repair');
  await mkdir(path.dirname(file),{recursive:true});await mkdir(folder,{recursive:true});
  const saved={schema:2,collectedAt:'2026-09-09T12:00:00.000Z',activityHistory:[],
    tokens:[{host:'Ubuntu',status:'ok',days:[]}],quota:{status:'stale'},futureField:{preserved:true},
    localModel:{host:'Ubuntu',status:'ok',records:[{model:'fixture',output:2}]}};
  await writeFile(file,JSON.stringify(saved));
  const leftovers={'retirement-snapshot.json':'{fictional incomplete snapshot',
    'retirement-receipt.json':'{"fictional":"conflicting receipt"}\r\n'};
  for(const [name,bytes] of Object.entries(leftovers))await writeFile(path.join(folder,name),bytes);
  const quota={status:'not-connected'};
  const result=await refreshAllowances(root,{enabled:false,readQuota:async()=>quota,sync:async()=>{}});
  assert.equal(result.status.state,'ok');
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{...saved,quota});
  for(const [name,bytes] of Object.entries(leftovers))assert.deepEqual(await readFile(path.join(folder,name)),Buffer.from(bytes));
});
